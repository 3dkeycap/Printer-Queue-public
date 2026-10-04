import { getDb, nowIso } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { normalizeComments } from './parts.service.js';
import { getSettings, updateSettings } from './settings.service.js';

const log = createLogger('packing');

/**
 * « J'ai packé la commande » : la personne met les pièces dans un bac
 * (« commande #1234 ») sans expédier. Pour chaque article on enregistre
 * combien sont dans le bac et pourquoi il en manque. Les pièces mises dans le
 * bac passent en Imprimé avec le tag « Packé par X ». On peut compléter plus
 * tard : chaque passage est gardé dans l'historique.
 */

const packTag = (packer) => `Packé par ${packer}`;

const findOrder = ({ orderId, shopifyId }) => {
  const db = getDb();
  const order = orderId
    ? db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(orderId))
    : db.prepare(`SELECT * FROM orders WHERE source = 'shopify' AND external_id = ?`).get(String(shopifyId));
  if (!order) throw notFound("Commande inconnue de l'app (pas encore synchronisée ?)");
  return order;
};

/** Note de l'acheteur + personnalisation (propriétés Shopify, variations Etsy). */
export const buyerDetails = (order, items) => {
  const details = [];
  if (order.note) details.push({ label: 'Note du client', value: order.note });
  for (const item of items) {
    let raw = null;
    try {
      raw = item.raw_payload ? JSON.parse(item.raw_payload) : null;
    } catch {
      raw = null;
    }
    for (const prop of raw?.properties ?? []) {
      const name = String(prop.name ?? '');
      if (!name || name.startsWith('_') || prop.value === undefined || prop.value === '') continue;
      details.push({ label: `${item.title} — ${name}`, value: String(prop.value) });
    }
    for (const variation of raw?.variations ?? []) {
      if (/personal/i.test(String(variation.formatted_name ?? ''))) {
        details.push({ label: `${item.title} — Personnalisation`, value: String(variation.formatted_value ?? '') });
      }
    }
  }
  return details;
};

/** Tout ce que la fenêtre de pack affiche pour une commande. */
export const getPackingView = (where) => {
  const db = getDb();
  const order = findOrder(where);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  const parts = db.prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY order_item_id, unit_index').all(order.id);
  const history = db
    .prepare('SELECT * FROM packs WHERE order_id = ? ORDER BY id DESC')
    .all(order.id)
    .map((pack) => ({ ...pack, items: JSON.parse(pack.items || '[]'), complete: Boolean(pack.complete) }));
  const lastReasons = new Map((history[0]?.items ?? []).map((line) => [line.order_item_id, line.reason ?? null]));
  const settings = getSettings();

  return {
    order: {
      id: order.id,
      number: order.order_number,
      source: order.source,
      customer: order.customer_name,
      placedAt: order.placed_at,
      shippedAt: order.shipped_at,
      chitchats: order.chitchats_shipment_id ? 'true' : order.chitchats_import_status === 'error' ? 'failed' : 'false',
      chitchatsError: order.chitchats_import_error,
      packNote: order.pack_note ?? '',
    },
    buyerDetails: buyerDetails(order, items),
    items: items.map((item) => {
      const own = parts.filter((part) => part.order_item_id === item.id);
      const statuses = {};
      for (const part of own) statuses[part.status] = (statuses[part.status] ?? 0) + 1;
      return {
        id: item.id,
        title: item.title,
        variant: item.variant_title,
        sku: item.sku,
        image: item.image_url,
        total: own.length || Number(item.quantity) || 1,
        packed: own.filter((part) => part.packed_at).length,
        notPrinted: own.some((part) => part.not_printed),
        statuses,
        lastReason: lastReasons.get(item.id) ?? null,
      };
    }),
    history,
    packers: settings['production.packers'] ?? [],
    reasons: settings['production.missingReasons'] ?? [],
  };
};

/**
 * Enregistre un passage de pack.
 * @param {{ packer: string, items: { orderItemId: number, packed: number, reason?: string }[] }} body
 */
export const savePack = (where, { packer, items = [], note } = {}) => {
  const name = String(packer ?? '').trim();
  if (!name) throw badRequest('Choisis qui a packé la commande');
  const db = getDb();
  const order = findOrder(where);
  const ts = nowIso();
  const lines = [];

  const run = db.transaction(() => {
    for (const line of items) {
      const own = db
        .prepare('SELECT * FROM parts WHERE order_id = ? AND order_item_id = ? ORDER BY packed_at IS NULL, unit_index')
        .all(order.id, Number(line.orderItemId));
      if (!own.length) continue;
      const title = own[0].name;
      const target = Math.min(Math.max(Number.parseInt(line.packed, 10) || 0, 0), own.length);
      const already = own.filter((part) => part.packed_at);

      if (target > already.length) {
        // on met dans le bac d'abord celles déjà imprimées, puis les autres
        const candidates = own
          .filter((part) => !part.packed_at)
          .sort((a, b) => Number(b.status === 'DONE') - Number(a.status === 'DONE'));
        for (const part of candidates.slice(0, target - already.length)) {
          const tags = normalizeComments([...String(part.comment ?? '').split('\n'), packTag(name)]);
          const toDone = !['DONE', 'SHIPPED'].includes(part.status);
          db.prepare(
            `UPDATE parts SET packed_at = @ts, packed_by = @name, comment = @tags, updated_at = @ts,
                    status = CASE WHEN @toDone THEN 'DONE' ELSE status END,
                    status_changed_at = CASE WHEN @toDone THEN @ts ELSE status_changed_at END,
                    printed_at = COALESCE(printed_at, @ts)
              WHERE id = @id`,
          ).run({ id: part.id, ts, name, tags, toDone: toDone ? 1 : 0 });
          db.prepare(
            `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(part.id, part.status, toDone ? 'DONE' : part.status, `pack:${name}`, `Mise dans le bac (commande ${order.order_number ?? order.id})`, ts);
        }
      } else if (target < already.length) {
        // correction : moins de pièces dans le bac que ce qui était noté
        for (const part of already.slice(target)) {
          const tags = normalizeComments(String(part.comment ?? '').split('\n').filter((tag) => !tag.startsWith('Packé par ')));
          db.prepare('UPDATE parts SET packed_at = NULL, packed_by = NULL, comment = ?, updated_at = ? WHERE id = ?').run(tags, ts, part.id);
        }
      }

      // pas dans le bac -> retour dans « À imprimer » (même un article en stock : il faut le refaire)
      if (target < own.length) {
        const missingParts = db
          .prepare('SELECT * FROM parts WHERE order_id = ? AND order_item_id = ? AND packed_at IS NULL')
          .all(order.id, Number(line.orderItemId));
        for (const part of missingParts) {
          const back = ['DONE', 'FAILED'].includes(part.status);
          db.prepare(
            `UPDATE parts SET not_printed = 0, updated_at = @ts,
                    status = CASE WHEN @back THEN 'TO_PRINT' ELSE status END,
                    status_changed_at = CASE WHEN @back THEN @ts ELSE status_changed_at END
              WHERE id = @id`,
          ).run({ id: part.id, ts, back: back ? 1 : 0 });
          if (back || part.not_printed) {
            db.prepare(
              `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            ).run(part.id, part.status, back ? 'TO_PRINT' : part.status, `pack:${name}`, `Manquante au bac : remise dans « À imprimer »`, ts);
          }
        }
      }

      const reason = target < own.length ? String(line.reason ?? '').trim() || null : null;
      lines.push({ order_item_id: Number(line.orderItemId), title, packed: target, total: own.length, reason });
    }

    const complete = lines.length > 0 && lines.every((line) => line.packed >= line.total);
    const cleanNote = note === undefined ? undefined : String(note ?? '').trim() || null;
    db.prepare('INSERT INTO packs (order_id, packer, items, complete, note, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      order.id,
      name,
      JSON.stringify(lines),
      complete ? 1 : 0,
      cleanNote ?? null,
      ts,
    );
    if (cleanNote !== undefined) db.prepare('UPDATE orders SET pack_note = ?, updated_at = ? WHERE id = ?').run(cleanNote, ts, order.id);
    return complete;
  });

  const complete = run();
  // un nouveau nom rejoint la liste des personnes
  const packers = getSettings()['production.packers'] ?? [];
  if (!packers.includes(name)) updateSettings({ 'production.packers': [...packers, name] });
  log.info('order packed', { orderId: order.id, packer: name, complete });
  return getPackingView({ orderId: order.id });
};

export const addPacker = (rawName) => {
  const name = String(rawName ?? '').trim();
  if (!name) throw badRequest('Nom vide');
  const packers = getSettings()['production.packers'] ?? [];
  if (!packers.includes(name)) updateSettings({ 'production.packers': [...packers, name] });
  return { packers: getSettings()['production.packers'] };
};

/** Dernier passage par commande, pour la vue « Tout ». { [orderId]: { packer, at, complete, missing[] } } */
export const latestPacks = (orderIds) => {
  if (!orderIds.length) return {};
  const rows = getDb()
    .prepare(
      `SELECT * FROM packs WHERE id IN (
         SELECT MAX(id) FROM packs WHERE order_id IN (${orderIds.map(() => '?').join(',')}) GROUP BY order_id)`,
    )
    .all(...orderIds);
  const result = {};
  for (const pack of rows) {
    const items = JSON.parse(pack.items || '[]');
    result[pack.order_id] = {
      packer: pack.packer,
      at: pack.created_at,
      complete: Boolean(pack.complete),
      note: pack.note ?? null,
      missing: items
        .filter((line) => line.packed < line.total)
        .map((line) => ({ order_item_id: line.order_item_id, title: line.title, missing: line.total - line.packed, reason: line.reason })),
    };
  }
  return result;
};
