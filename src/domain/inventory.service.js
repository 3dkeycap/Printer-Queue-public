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

export const DEFAULT_HOST = 'http://192.168.1.223:8080';

/**
 * Nom d'hôte saisi dans les réglages -> adresse de base des codes QR.
 * « 192.168.1.223:8080 », « 3dkeycap.local » ou « http://192.168.1.223:8080/ » sont acceptés :
 * sans schéma on met http:// (l'atelier est en HTTP sur le réseau local).
 */
export const normalizeBaseUrl = (value) => {
  let text = String(value ?? '').trim();
  if (!text) return DEFAULT_HOST;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  return text.replace(/\/+$/, '');
};

const baseUrl = () => normalizeBaseUrl(getSettings()['inventory.scanUrl']);

/** Page « ajouter un objet » pensée pour le téléphone (on se promène et on ajoute). */
export const newItemUrl = () => `${baseUrl()}/inventory/new`;

/** Adresse encodée dans le code QR d'un objet. */
export const scanUrl = (token) => `${baseUrl()}/r/${token}`;

const event = (db, itemId, kind, note = null) =>
  db.prepare('INSERT INTO inventory_events (item_id, kind, note, created_at) VALUES (?, ?, ?, ?)').run(itemId, kind, note, nowIso());

const QUESTION_TYPES = ['choice', 'text', 'number'];
const MAX_QUESTIONS = 6;

const parseJson = (text, fallback) => {
  try {
    const value = JSON.parse(text ?? '');
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

/** Noms des résines proposées quand une question est « Couleurs de résine » (catalogue actuel). */
const resinColorChoices = () =>
  getDb()
    .prepare(`SELECT name FROM resin_colors WHERE is_active = 1 AND key <> 'unassigned' ORDER BY sort_order, name`)
    .all()
    .map((row) => row.name);

/**
 * Questions posées au scan : « quelle couleur manque ? » (choix dans une liste ou parmi les
 * résines, une ou plusieurs réponses), un texte libre ou un nombre. Un objet sans question se
 * signale tout seul dès le scan, comme avant.
 */
const cleanQuestions = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw badRequest('Les questions doivent être une liste');
  if (value.length > MAX_QUESTIONS) throw badRequest(`${MAX_QUESTIONS} questions au maximum par objet`);
  return value.map((raw, index) => {
    const label = String(raw?.label ?? '').trim().replace(/\s+/g, ' ');
    if (!label) throw badRequest(`La question ${index + 1} n’a pas de titre`);
    if (label.length > 60) throw badRequest(`Le titre de la question ${index + 1} est trop long (60 caractères maximum)`);
    const type = QUESTION_TYPES.includes(raw?.type) ? raw.type : 'choice';
    const question = { id: `q${index}`, label, type };
    if (type === 'choice') {
      question.multiple = Boolean(raw?.multiple);
      question.colors = Boolean(raw?.colors);
      if (!question.colors) {
        const list = Array.isArray(raw?.choices) ? raw.choices : String(raw?.choices ?? '').split(/[,\n]/);
        question.choices = [...new Set(list.map((choice) => String(choice).trim()).filter(Boolean))].slice(0, 40);
        if (!question.choices.length) throw badRequest(`Ajoute au moins un choix à « ${label} »`);
      }
    }
    return question;
  });
};

/** Les questions telles que la page de scan les affiche (les résines sont lues à ce moment-là). */
const presentQuestions = (row) =>
  parseJson(row.questions, []).map((question) =>
    question.type === 'choice' && question.colors ? { ...question, choices: resinColorChoices() } : question,
  );

/** Réponses du scan -> [{ label, value }] ; une réponse manquante ou hors liste est refusée. */
const cleanAnswers = (row, answers) => {
  const given = answers && typeof answers === 'object' ? answers : {};
  return presentQuestions(row).map((question) => {
    const raw = given[question.id];
    let value;
    if (question.type === 'number') {
      const number = Number(String(raw ?? '').replace(',', '.'));
      if (String(raw ?? '').trim() === '' || !Number.isFinite(number) || Math.abs(number) > 1e9) throw badRequest(`Indique un nombre pour « ${question.label} »`);
      value = String(number);
    } else if (question.type === 'text') {
      value = String(raw ?? '').trim().slice(0, 200);
      if (!value) throw badRequest(`Réponds à « ${question.label} »`);
    } else {
      const picked = (Array.isArray(raw) ? raw : [raw]).map((item) => String(item ?? '').trim()).filter(Boolean);
      if (!picked.length) throw badRequest(`Choisis une réponse pour « ${question.label} »`);
      if (!question.multiple && picked.length > 1) throw badRequest(`Une seule réponse possible pour « ${question.label} »`);
      if (picked.some((item) => !question.choices.includes(item))) throw badRequest(`Réponse inconnue pour « ${question.label} »`);
      value = picked.join(', ');
    }
    return { label: question.label, value };
  });
};

const cleanSupplier = (value) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length > 80) throw badRequest('« Commander chez » est trop long (80 caractères maximum)');
  return text || null;
};

const cleanUnit = (value) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (text.length > 20) throw badRequest("L'unité est trop longue (20 caractères maximum)");
  return text || null;
};

const cleanOrderQty = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0 || number > 1000000) throw badRequest('La quantité à commander doit être un nombre entier (0 ou plus)');
  return number;
};

const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 2_500_000; // ~1,8 Mo : le navigateur réduit la photo avant l'envoi

/** Photo de l'objet : data URL (déjà réduite par le navigateur), null / '' pour la retirer. */
const cleanImage = (value) => {
  if (value === null || value === '') return null;
  const text = String(value);
  if (!IMAGE_URL.test(text)) throw badRequest('La photo doit être une image JPEG, PNG ou WebP');
  if (text.length > MAX_IMAGE_CHARS) throw badRequest('La photo est trop lourde (2 Mo maximum)');
  return text;
};

const present = (row, { withImage = false } = {}) => ({
  id: row.id,
  name: row.name,
  reorder_at: row.reorder_at,
  notes: row.notes,
  status: row.status,
  flagged_at: row.flagged_at,
  scan_count: row.scan_count,
  ordered_at: row.ordered_at,
  created_at: row.created_at,
  order_qty: row.order_qty ?? null,
  unit: row.unit ?? null,
  supplier: row.supplier ?? null,
  has_image: Boolean(row.image),
  ...(withImage ? { image: row.image ?? null } : {}),
  questions: presentQuestions(row),
  flag_details: parseJson(row.flag_details, []),
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

/** Objets avec leur photo, pour les étiquettes imprimables (la liste normale ne transporte pas les photos). */
export const listItemsForCards = (ids = []) =>
  getDb()
    .prepare(`SELECT * FROM inventory_items ORDER BY name COLLATE NOCASE ASC`)
    .all()
    .filter((row) => !ids.length || ids.includes(row.id))
    .map((row) => present(row, { withImage: true }));

/** Photo d'un objet : { mime, buffer } ou null. */
export const itemImage = (id) => {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(find(id).image ?? '');
  return match ? { mime: match[1], buffer: Buffer.from(match[2], 'base64') } : null;
};

export const createItem = ({ name, reorder_at, notes = null, questions, order_qty, supplier, image, unit } = {}) => {
  const db = getDb();
  const row = {
    name: cleanName(name),
    reorder_at: cleanThreshold(reorder_at ?? 1),
    notes: String(notes ?? '').trim() || null,
    questions: JSON.stringify(cleanQuestions(questions)),
    order_qty: cleanOrderQty(order_qty),
    unit: cleanUnit(unit),
    supplier: cleanSupplier(supplier),
    image: image ? cleanImage(image) : null,
    token: crypto.randomBytes(9).toString('base64url'),
    ts: nowIso(),
  };
  const info = db
    .prepare(
      `INSERT INTO inventory_items (name, reorder_at, notes, questions, order_qty, unit, supplier, image, token, created_at, updated_at)
       VALUES (@name, @reorder_at, @notes, @questions, @order_qty, @unit, @supplier, @image, @token, @ts, @ts)`,
    )
    .run(row);
  event(db, Number(info.lastInsertRowid), 'created');
  return getItem(info.lastInsertRowid);
};

export const updateItem = (id, patch = {}) => {
  const db = getDb();
  const current = find(id);
  db.prepare('UPDATE inventory_items SET name = @name, reorder_at = @reorder_at, notes = @notes, questions = @questions, order_qty = @order_qty, unit = @unit, supplier = @supplier, image = @image, updated_at = @ts WHERE id = @id').run({
    id: current.id,
    name: patch.name === undefined ? current.name : cleanName(patch.name),
    reorder_at: patch.reorder_at === undefined ? current.reorder_at : cleanThreshold(patch.reorder_at),
    notes: patch.notes === undefined ? current.notes : String(patch.notes ?? '').trim() || null,
    questions: patch.questions === undefined ? current.questions : JSON.stringify(cleanQuestions(patch.questions)),
    order_qty: patch.order_qty === undefined ? current.order_qty : cleanOrderQty(patch.order_qty),
    unit: patch.unit === undefined ? current.unit : cleanUnit(patch.unit),
    supplier: patch.supplier === undefined ? current.supplier : cleanSupplier(patch.supplier),
    image: patch.image === undefined ? current.image : cleanImage(patch.image),
    ts: nowIso(),
  });
  return getItem(current.id);
};

export const deleteItem = (id) => {
  const info = getDb().prepare('DELETE FROM inventory_items WHERE id = ?').run(Number(id));
  if (!info.changes) throw notFound(`Objet ${id} introuvable`);
  return { deleted: Number(id) };
};

const flag = (row, { kind, answers = null }) => {
  const db = getDb();
  const ts = nowIso();
  const already = row.status === 'reorder';
  db.transaction(() => {
    // ce qui manque (couleur, quantité…) s'accumule jusqu'à la commande
    const details = parseJson(row.flag_details, []);
    if (answers) details.push({ at: ts, answers });
    db.prepare(
      `UPDATE inventory_items SET status = 'reorder', flagged_at = COALESCE(CASE WHEN status = 'reorder' THEN flagged_at END, @ts),
                                  scan_count = scan_count + @inc, flag_details = @details, updated_at = @ts WHERE id = @id`,
    ).run({ id: row.id, ts, inc: kind === 'scan' ? 1 : 0, details: JSON.stringify(details.slice(-50)) });
    // l'ancien état sert à annuler un scan par erreur
    event(db, row.id, kind, JSON.stringify({ already, detail: Boolean(answers) }));
  })();
  return already;
};

/**
 * Scan du code QR (téléphone). Un 2e scan d'un objet déjà « à racheter » ne
 * change rien (on ne remet pas la date à zéro) mais est compté et renvoyé.
 */
export const scanByToken = (token, answers) => {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  if (!row) throw notFound('Code inconnu : cette carte ne correspond plus à aucun objet.');
  // un objet avec questions n'est signalé qu'avec les réponses (la page de scan les demande d'abord)
  const hasQuestions = parseJson(row.questions, []).length > 0;
  const already = flag(row, { kind: 'scan', answers: hasQuestions ? cleanAnswers(row, answers) : null });
  const item = getItem(row.id);
  return { item, alreadyFlagged: already, flaggedAt: item.flagged_at };
};

/** « Je me suis trompé » juste après un scan : remet l'état d'avant (seulement si ce scan l'avait changé). */
export const undoScan = (token) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  if (!row) throw notFound('Code inconnu');
  const last = db.prepare('SELECT * FROM inventory_events WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(row.id);
  let note = {};
  try {
    note = JSON.parse(last?.note ?? '{}');
  } catch {
    note = {};
  }
  if (last?.kind !== 'scan') return { item: getItem(row.id), undone: false };
  const wasAlready = note.already !== false; // note illisible : on ne touche pas à l'état
  if (wasAlready && !note.detail) return { item: getItem(row.id), undone: false };
  db.transaction(() => {
    const details = parseJson(row.flag_details, []);
    if (note.detail) details.pop();
    if (wasAlready) {
      db.prepare('UPDATE inventory_items SET flag_details = ?, scan_count = MAX(scan_count - 1, 0), updated_at = ? WHERE id = ?').run(JSON.stringify(details), nowIso(), row.id);
    } else {
      db.prepare(`UPDATE inventory_items SET status = 'ok', flagged_at = NULL, flag_details = ?, scan_count = MAX(scan_count - 1, 0), updated_at = ? WHERE id = ?`).run(JSON.stringify(details), nowIso(), row.id);
    }
    event(db, row.id, 'undo', 'scan annulé');
  })();
  return { item: getItem(row.id), undone: true };
};

/** Signalement à la main depuis le tableau de bord (sans scanner). */
export const flagItem = (id, answers) => {
  const row = find(id);
  // comme au scan : un objet avec questions se signale avec ce qui manque
  const hasQuestions = parseJson(row.questions, []).length > 0;
  flag(row, { kind: 'flag', answers: hasQuestions ? cleanAnswers(row, answers) : null });
  return getItem(id);
};

/** « Commandé » : l'objet repasse à « ok » et on garde la date de la commande. */
export const markOrdered = (id) => {
  const db = getDb();
  const row = find(id);
  db.transaction(() => {
    db.prepare(`UPDATE inventory_items SET status = 'ok', flagged_at = NULL, flag_details = '[]', ordered_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), row.id);
    event(db, row.id, 'ordered');
  })();
  return getItem(id);
};

/** Objet d'un code QR (ou null) : sert à la page de scan, sans rien modifier. */
export const itemByToken = (token) => {
  const row = getDb().prepare('SELECT * FROM inventory_items WHERE token = ?').get(String(token ?? ''));
  return row ? present(row) : null;
};
