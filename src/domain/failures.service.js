import { getDb, nowIso } from '../db/index.js';

/**
 * Historique des impressions et taux d'échec par fichier.
 *
 * Un « échec » ne reste pas dans une colonne : la pièce retourne tout de suite
 * dans « À imprimer » (voir setStatus), et chaque résultat est consigné ici.
 *  - failed  : clic sur Échec
 *  - success : la pièce passe à Imprimé (annulé si on la ressort de Imprimé)
 * Taux d'échec d'un fichier = échecs / (échecs + réussites).
 */

/** Photo de la pièce au moment du résultat. */
const snapshot = (db, part) => {
  const order = db.prepare('SELECT order_number, source FROM orders WHERE id = ?').get(part.order_id);
  return {
    part_id: part.id,
    name: part.name,
    sku: part.sku ?? null,
    variant_title: part.variant_title ?? null,
    color_key: part.color_key ?? null,
    order_number: order?.order_number ?? null,
    source: order?.source ?? null,
  };
};

/**
 * À appeler à chaque changement de statut d'une pièce (dans la même
 * transaction). `at` sert au rattrapage de l'historique existant.
 */
export const recordTransition = (db, part, from, to, { actor = 'system', at = nowIso() } = {}) => {
  if (to === 'FAILED') {
    // un « Imprimé » retiré pour cause d'échec n'était pas une vraie réussite
    if (from === 'DONE') revokeLastSuccess(db, part.id);
    insert(db, part, 'failed', actor, at);
  } else if (to === 'DONE' && from !== 'SHIPPED') {
    insert(db, part, 'success', actor, at);
  } else if (from === 'DONE' && (to === 'TO_PRINT' || to === 'PRINTING')) {
    // remis en arrière après un mauvais clic : pas une réussite
    revokeLastSuccess(db, part.id);
  }
};

const insert = (db, part, outcome, actor, at) => {
  const s = snapshot(db, part);
  db.prepare(
    `INSERT INTO print_results (part_id, outcome, name, sku, variant_title, color_key, order_number, source, actor, created_at)
     VALUES (@part_id, @outcome, @name, @sku, @variant_title, @color_key, @order_number, @source, @actor, @at)`,
  ).run({ ...s, outcome, actor, at });
};

const revokeLastSuccess = (db, partId) => {
  db.prepare(
    `DELETE FROM print_results WHERE id = (
       SELECT id FROM print_results WHERE part_id = ? AND outcome = 'success' ORDER BY id DESC LIMIT 1
     )`,
  ).run(partId);
};

/** Rejoue part_events une seule fois pour reconstituer l'historique d'avant cette fonction. */
export const backfillPrintResults = (db) => {
  const parts = db.prepare('SELECT DISTINCT part_id AS id FROM part_events').all();
  const events = db.prepare(
    'SELECT from_status, to_status, actor, created_at FROM part_events WHERE part_id = ? ORDER BY id',
  );
  const getPart = db.prepare('SELECT * FROM parts WHERE id = ?');
  let count = 0;
  for (const { id } of parts) {
    const part = getPart.get(id);
    if (!part) continue; // pièce supprimée : plus de photo possible
    for (const event of events.all(id)) {
      recordTransition(db, part, event.from_status, event.to_status, { actor: event.actor, at: event.created_at });
    }
    count += 1;
  }
  return count;
};

const rate = (failures, attempts) => (attempts ? failures / attempts : 0);

/** Fichiers (nom de pièce) avec leurs échecs, tentatives et détail par couleur. */
export const getFailureReport = ({ limit = 300 } = {}) => {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT r.name, r.color_key,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex,
              SUM(r.outcome = 'failed') AS failures,
              SUM(r.outcome = 'success') AS successes,
              MAX(CASE WHEN r.outcome = 'failed' THEN r.created_at END) AS last_failure
         FROM print_results r
         LEFT JOIN resin_colors c ON c.key = r.color_key
        GROUP BY r.name, r.color_key`,
    )
    .all();

  const files = new Map();
  for (const row of rows) {
    const file = files.get(row.name) ?? { name: row.name, failures: 0, successes: 0, lastFailure: null, colors: [] };
    file.failures += row.failures;
    file.successes += row.successes;
    if (row.last_failure && (!file.lastFailure || row.last_failure > file.lastFailure)) file.lastFailure = row.last_failure;
    file.colors.push({
      key: row.color_key,
      name: row.color_name,
      hex: row.color_hex,
      failures: row.failures,
      attempts: row.failures + row.successes,
      rate: rate(row.failures, row.failures + row.successes),
    });
    files.set(row.name, file);
  }

  const list = [...files.values()]
    .map((file) => ({
      ...file,
      attempts: file.failures + file.successes,
      rate: rate(file.failures, file.failures + file.successes),
      colors: file.colors.sort((a, b) => b.failures - a.failures || b.attempts - a.attempts),
    }))
    .filter((file) => file.failures > 0)
    .sort((a, b) => b.rate - a.rate || b.failures - a.failures || a.name.localeCompare(b.name));

  const history = db
    .prepare(
      `SELECT r.id, r.part_id, r.name, r.sku, r.variant_title, r.color_key, r.order_number, r.source, r.actor, r.created_at,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex
         FROM print_results r
         LEFT JOIN resin_colors c ON c.key = r.color_key
        WHERE r.outcome = 'failed'
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`,
    )
    .all(Math.min(Math.max(Number(limit) || 300, 1), 2000));

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(outcome = 'failed'), 0) AS failures, COALESCE(SUM(outcome = 'success'), 0) AS successes
         FROM print_results`,
    )
    .get();

  return {
    totals: {
      failures: totals.failures,
      attempts: totals.failures + totals.successes,
      rate: rate(totals.failures, totals.failures + totals.successes),
    },
    files: list,
    history,
  };
};
