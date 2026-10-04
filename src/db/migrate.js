import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getDb, getSetting, nowIso, setSetting } from './index.js';
import { createLogger } from '../lib/logger.js';
import { LEGACY_STATUS_MAP } from '../domain/statuses.js';

const require = createRequire(import.meta.url);
const log = createLogger('migrate');

const SCHEMA_PATH = new URL('./schema.sql', import.meta.url);
const SEED_COLORS = require('./colors.seed.json');

/**
 * Applies the schema (idempotent) and seeds the resin catalogue.
 * Safe to call on every boot of every container.
 */
/** `ALTER TABLE ... ADD COLUMN` idempotent (SQLite n'a pas de IF NOT EXISTS). */
const addColumnIfMissing = (db, table, column, definition) => {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info('column added', { table, column });
  return true;
};

/**
 * Avant la colonne `not_printed`, une ligne « à ne pas imprimer » ne créait
 * aucune pièce (ou elle était supprimée) : elle n'apparaissait nulle part.
 * Une seule fois, on recrée ces pièces, marquées « pas imprimé ici », pour
 * qu'elles soient dans « Tout » (on les expédie quand même).
 */
const restoreSkippedItems = (db) => {
  const items = db
    .prepare(
      `SELECT i.*, o.shipped_at, o.is_priority FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.source <> 'manual' AND NOT EXISTS (SELECT 1 FROM parts p WHERE p.order_item_id = i.id)`,
    )
    .all();
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT INTO parts (order_id, order_item_id, unit_index, name, sku, variant_title, color_key, status,
                        priority, not_printed, status_changed_at, shipped_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 'unassigned'), ?, ?, 1, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const item of items) {
      for (let unit = 1; unit <= Math.max(Number(item.quantity) || 1, 1); unit += 1) {
        insert.run(
          item.order_id, item.id, unit, item.title, item.sku, item.variant_title, item.color_key,
          item.shipped_at ? 'SHIPPED' : 'TO_PRINT', item.is_priority ? 1 : 0, ts, item.shipped_at ?? null, ts, ts,
        );
      }
    }
  })();
  if (items.length) log.info('not-printed items restored for the All view', { items: items.length });
};

const MOCK_DATA_PURGED_KEY = 'internal.mockDataPurged';

/**
 * Nettoyage automatique et définitif des commandes fabriquées par l'ancien
 * générateur de démo (`INTEGRATION_MODE=mock`, retiré du code depuis). Ces
 * commandes marquaient leur payload brut avec `"mock": true` - un marqueur
 * qu'aucune commande Shopify ou Etsy réelle ne peut porter, donc ce nettoyage
 * ne touche jamais une vraie commande.
 *
 * Ne s'exécute qu'une seule fois (flag en base) : au premier démarrage de
 * chaque conteneur après cette mise à jour, sur une base qui contiendrait
 * encore des données du mode démo d'une version antérieure.
 */
const purgeLegacyMockData = (db) => {
  if (getSetting(MOCK_DATA_PURGED_KEY)) return;

  const stale = db
    .prepare(`SELECT id FROM orders WHERE raw_payload LIKE '%"mock":true%' OR raw_payload LIKE '%"mock": true%'`)
    .all();

  if (stale.length) {
    const partsCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM parts WHERE order_id IN (${stale.map(() => '?').join(',')})`,
      )
      .get(...stale.map((o) => o.id)).n;

    const del = db.prepare('DELETE FROM orders WHERE id = ?');
    const run = db.transaction(() => {
      for (const order of stale) del.run(order.id);
    });
    run();

    log.info('legacy demo orders purged automatically', { orders: stale.length, parts: partsCount });
  }

  setSetting(MOCK_DATA_PURGED_KEY, '1');
};

const CURSOR_RATCHET_FIXED_KEY = 'internal.cursorRatchetFixed';

/**
 * Répare une bonne fois pour toutes les curseurs de synchro (`cursor:shopify`,
 * `cursor:etsy`) corrompus par un bug corrigé dans cette version : le curseur
 * avançait sur l'horloge murale à chaque cycle, même quand 0 commande était
 * trouvée ou que la boutique n'était pas encore configurée. Résultat : la
 * fenêtre de recherche se rétrécissait à quelques minutes et ne revoyait plus
 * jamais les commandes plus anciennes, même après avoir enfin connecté la
 * boutique. On efface simplement le curseur pour forcer un nouveau balayage
 * complet sur la fenêtre de rattrapage configurée (14 jours par défaut).
 */
const resetCorruptedSyncCursors = (db) => {
  if (getSetting(CURSOR_RATCHET_FIXED_KEY)) return;

  const info = db.prepare(`DELETE FROM settings WHERE key LIKE 'cursor:%'`).run();
  if (info.changes) {
    log.info('stale sync cursors reset (fixes a bug that shrank the lookback window every cycle)', {
      cursors: info.changes,
    });
  }

  setSetting(CURSOR_RATCHET_FIXED_KEY, '1');
};

export const migrate = () => {
  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  // la vue est recréée à chaque démarrage pour suivre l'évolution des colonnes
  db.exec('DROP VIEW IF EXISTS v_parts_full');
  db.exec(schema);

  // bases créées avant l'ajout des colonnes UV / commentaire
  addColumnIfMissing(db, 'parts', 'uv', 'TEXT');
  addColumnIfMissing(db, 'parts', 'comment', 'TEXT');
  addColumnIfMissing(db, 'order_items', 'image_url', 'TEXT');
  // import automatique des commandes dans Chit Chats : résultat et raison d'un échec
  addColumnIfMissing(db, 'orders', 'chitchats_import_status', 'TEXT');
  addColumnIfMissing(db, 'orders', 'chitchats_import_error', 'TEXT');
  addColumnIfMissing(db, 'orders', 'chitchats_import_at', 'TEXT');
  // pièce expédiée d'ici mais pas imprimée ici (article en stock, supplément…) :
  // absente de « À imprimer », visible dans « Tout »
  // pack : pièce mise dans le bac, par qui
  addColumnIfMissing(db, 'parts', 'packed_at', 'TEXT');
  addColumnIfMissing(db, 'parts', 'packed_by', 'TEXT');
  const notPrintedAdded = addColumnIfMissing(db, 'parts', 'not_printed', 'INTEGER NOT NULL DEFAULT 0');
  if (notPrintedAdded) restoreSkippedItems(db);

  // statuts retirés en v2 (FILE_READY, IN_INVENTORY) -> équivalent actuel
  for (const [legacy, replacement] of Object.entries(LEGACY_STATUS_MAP)) {
    const info = db.prepare('UPDATE parts SET status = ? WHERE status = ?').run(replacement, legacy);
    if (info.changes) log.info('legacy status migrated', { legacy, replacement, parts: info.changes });
  }

  // ancienne adresse Chit Chats par défaut (devinée) -> la vraie page de recherche
  db.prepare(`DELETE FROM settings WHERE key = 'chitchats.shipUrlTemplate' AND value = ?`).run(
    'https://chitchats.com/clients/{clientId}/shipments?q={order}',
  );

  purgeLegacyMockData(db);
  resetCorruptedSyncCursors(db);

  const insertColor = db.prepare(
    `INSERT INTO resin_colors (key, name, hex, aliases, sort_order, updated_at)
     VALUES (@key, @name, @hex, @aliases, @sort_order, @updated_at)
     ON CONFLICT (key) DO UPDATE SET
       name = excluded.name,
       hex = CASE WHEN resin_colors.hex = '' THEN excluded.hex ELSE resin_colors.hex END,
       aliases = excluded.aliases,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
  );

  const seed = db.transaction(() => {
    for (const color of SEED_COLORS) {
      insertColor.run({
        key: color.key,
        name: color.name,
        hex: color.hex,
        aliases: JSON.stringify(color.aliases ?? []),
        sort_order: color.sort_order ?? 100,
        updated_at: nowIso(),
      });
    }
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', '1', ?)
       ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
    ).run(nowIso());
  });

  seed();
  log.info('schema applied', { colors: SEED_COLORS.length });
  return db;
};

// `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  log.info('migration finished');
}
