import crypto from 'node:crypto';
import { getDb, nowIso } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSettings } from './settings.service.js';

/**
 * Inventaire = « il faut en racheter ». On crée un objet (nom + quantité à
 * laquelle il faut scanner) : on obtient une carte avec un code QR. Quand il n'en
 * reste plus que cette quantité, on scanne le code : l'objet passe tout seul à
 * « à racheter » ; une fois commandé, on le remet à « ok ».
 */

export const DEFAULT_HOST = 'http://3dkeycap.local';

/**
 * Nom d'hôte saisi dans les réglages -> adresse de base des codes QR.
 * « 3dkeycap.local », « 3dkeycap.local:8080 » ou « http://192.168.1.50:8080/ » sont acceptés :
 * sans schéma on met http:// (l'atelier est en HTTP sur le réseau local).
 */
export const normalizeBaseUrl = (value) => {
  let text = String(value ?? '').trim();
  if (!text) return DEFAULT_HOST;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  return text.replace(/\/+$/, '');
};

const baseUrl = () => normalizeBaseUrl(getSettings()['inventory.scanUrl']);

/** Adresse encodée dans le code QR d'un objet. */
export const scanUrl = (token) => `${baseUrl()}/r/${token}`;

const event = (db, itemId, kind, note = null) =>
  db.prepare('INSERT INTO inventory_events (item_id, kind, note, created_at) VALUES (?, ?, ?, ?)').run(itemId, kind, note, nowIso());

const present = (row) => ({
  id: row.id,
  name: row.name,
  reorder_at: row.reorder_at,
  notes: row.notes,
  status: row.status,
  flagged_at: row.flagged_at,
  scan_count: row.scan_count,
  ordered_at: row.ordered_at,
  created_at: row.created_at,
  scan_url: scanUrl(row.token),
});

const cleanName = (value) => {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw badRequest("Le nom de l'objet est obligatoire");
  if (name.length > 80) throw badRequest("Le nom de l'objet est trop long (80 caractères maximum)");
  return name;
};

const cleanThreshold = (value) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0 || number > 100000) throw badRequest('La quantité doit être un nombre entier (0 ou plus)');
  return number;
};

const find = (id) => {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE id = ?').get(Number(id));
  if (!row) throw notFound(`Objet ${id} introuvable`);
  return row;
};

/** « À racheter » d'abord (le plus ancien signalement en premier), puis les autres par nom. */
export const listItems = () =>
  getDb()
    .prepare(
      `SELECT * FROM inventory_items
       ORDER BY (status = 'reorder') DESC, CASE WHEN status = 'reorder' THEN flagged_at END ASC, name COLLATE NOCASE ASC`,
    )
    .all()
    .map(present);

export const getItem = (id) => present(find(id));

export const createItem = ({ name, reorder_at, notes = null } = {}) => {
  const db = getDb();
  const row = {
    name: cleanName(name),
    reorder_at: cleanThreshold(reorder_at ?? 1),
    notes: String(notes ?? '').trim() || null,
    token: crypto.randomBytes(9).toString('base64url'),
    ts: nowIso(),
  };
  const info = db
    .prepare(
      `INSERT INTO inventory_items (name, reorder_at, notes, token, created_at, updated_at)
       VALUES (@name, @reorder_at, @notes, @token, @ts, @ts)`,
    )
    .run(row);
  event(db, Number(info.lastInsertRowid), 'created');
  return getItem(info.lastInsertRowid);
};

export const updateItem = (id, patch = {}) => {
  const db = getDb();
  const current = find(id);
  db.prepare('UPDATE inventory_items SET name = @name, reorder_at = @reorder_at, notes = @notes, updated_at = @ts WHERE id = @id').run({
    id: current.id,
    name: patch.name === undefined ? current.name : cleanName(patch.name),
    reorder_at: patch.reorder_at === undefined ? current.reorder_at : cleanThreshold(patch.reorder_at),
    notes: patch.notes === undefined ? current.notes : String(patch.notes ?? '').trim() || null,
    ts: nowIso(),
  });
  return getItem(current.id);
};

export const deleteItem = (id) => {
  const info = getDb().prepare('DELETE FROM inventory_items WHERE id = ?').run(Number(id));
  if (!info.changes) throw notFound(`Objet ${id} introuvable`);
  return { deleted: Number(id) };
};

const flag = (row, { kind }) => {
  const db = getDb();
  const ts = nowIso();
  const already = row.status === 'reorder';
  db.transaction(() => {
    db.prepare(
      `UPDATE inventory_items SET status = 'reorder', flagged_at = COALESCE(CASE WHEN status = 'reorder' THEN flagged_at END, @ts),
                                  scan_count = scan_count + @inc, updated_at = @ts WHERE id = @id`,
    ).run({ id: row.id, ts, inc: kind === 'scan' ? 1 : 0 });
    // l'ancien état sert à annuler un scan par erreur
    event(db, row.id, kind, JSON.stringify({ already }));
  })();
  return already;
};

/**
 * Scan du code QR (téléphone). Un 2e scan d'un objet déjà « à racheter » ne
 * change rien (on ne remet pas la date à zéro) mais est compté et renvoyé.
 */
export const scanByToken = (token) => {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  if (!row) throw notFound('Code inconnu : cette carte ne correspond plus à aucun objet.');
  const already = flag(row, { kind: 'scan' });
  const item = getItem(row.id);
  return { item, alreadyFlagged: already, flaggedAt: item.flagged_at };
};

/** « Je me suis trompé » juste après un scan : remet l'état d'avant (seulement si ce scan l'avait changé). */
export const undoScan = (token) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  if (!row) throw notFound('Code inconnu');
  const last = db.prepare('SELECT * FROM inventory_events WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
  let already = true;
  try {
    already = JSON.parse(last?.note ?? '{}').already;
  } catch {
    already = true;
  }
  if (last?.kind !== 'scan' || already) return { item: getItem(row.id), undone: false };
  db.transaction(() => {
    db.prepare(`UPDATE inventory_items SET status = 'ok', flagged_at = NULL, scan_count = MAX(scan_count - 1, 0), updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    event(db, row.id, 'undo', 'scan annulé');
  })();
  return { item: getItem(row.id), undone: true };
};

/** Signalement à la main depuis le tableau de bord (sans scanner). */
export const flagItem = (id) => {
  const row = find(id);
  flag(row, { kind: 'flag' });
  return getItem(id);
};

/** « Commandé » : l'objet repasse à « ok » et on garde la date de la commande. */
export const markOrdered = (id) => {
  const db = getDb();
  const row = find(id);
  db.transaction(() => {
    db.prepare(`UPDATE inventory_items SET status = 'ok', flagged_at = NULL, ordered_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), row.id);
    event(db, row.id, 'ordered');
  })();
  return getItem(id);
};

/** Objet d'un code QR (ou null) : sert à la page de scan, sans rien modifier. */
export const itemByToken = (token) => {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  return row ? present(row) : null;
};
