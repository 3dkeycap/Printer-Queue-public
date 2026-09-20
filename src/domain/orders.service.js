import { getDb, nowIso } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { config } from '../config.js';

const log = createLogger('orders');

export const listOrders = ({ limit = 100, offset = 0, source, q, scope } = {}) => {
  const db = getDb();
  const where = [];
  const params = { limit: Math.min(Number(limit) || 100, 500), offset: Number(offset) || 0 };

  if (source) {
    where.push('o.source = @source');
    params.source = source;
  }
  if (scope === 'open') where.push('o.shipped_at IS NULL');
  if (q) {
    where.push('(o.order_number LIKE @q OR o.customer_name LIKE @q OR o.external_id LIKE @q)');
    params.q = `%${q}%`;
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `SELECT o.*,
              COUNT(p.id) AS parts_total,
              SUM(CASE WHEN p.status = 'SHIPPED' THEN 1 ELSE 0 END) AS parts_shipped,
              SUM(CASE WHEN p.status IN ('DONE','IN_INVENTORY','SHIPPED') THEN 1 ELSE 0 END) AS parts_done
       FROM orders o
       LEFT JOIN parts p ON p.order_id = o.id
       ${clause}
       GROUP BY o.id
       ORDER BY COALESCE(o.placed_at, o.created_at) DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all(params);

  return rows.map((row) => ({ ...row, is_priority: Boolean(row.is_priority), raw_payload: undefined }));
};

export const getOrder = (id) => {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(id));
  if (!order) throw notFound(`Order ${id} not found`);
  const parts = db
    .prepare(
      `SELECT p.*, COALESCE(c.name, 'Non assigné') AS color_name, COALESCE(c.hex, '#7C7364') AS color_hex
       FROM parts p LEFT JOIN resin_colors c ON c.key = p.color_key
       WHERE p.order_id = ? ORDER BY p.order_item_id, p.unit_index`,
    )
    .all(order.id);
  return { ...order, is_priority: Boolean(order.is_priority), parts };
};

/**
 * Finds the local order matching a Chit Chats shipment.
 * Chit Chats only carries a free-form `order_id` / `reference`, so we try the
 * order number, then the marketplace id, then the recipient name.
 */
export const findOrderForShipment = (shipment) => {
  const db = getDb();
  const candidates = [shipment.order_id, shipment.reference, shipment.name, shipment.order_number]
    .filter(Boolean)
    .map((value) => String(value).trim());

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/^#/, '');
    const row = db
      .prepare(
        `SELECT * FROM orders
         WHERE order_number = @raw OR order_number = @cleaned OR order_number = '#' || @cleaned
            OR external_id = @raw OR external_id = @cleaned
         ORDER BY id DESC LIMIT 1`,
      )
      .get({ raw: candidate, cleaned });
    if (row) return row;
  }

  if (shipment.to_name) {
    const row = db
      .prepare(
        `SELECT * FROM orders WHERE customer_name = ? AND shipped_at IS NULL
         ORDER BY COALESCE(placed_at, created_at) DESC LIMIT 1`,
      )
      .get(String(shipment.to_name).trim());
    if (row) return row;
  }
  return null;
};

const SHIPPABLE_FROM_PRODUCTION = ['DONE', 'IN_INVENTORY'];

/**
 * Marks every part of an order as SHIPPED and stores the tracking info.
 * Parts still in production are only shipped when SHIP_ALL_PARTS_ON_SHIPMENT
 * is enabled; otherwise they stay on the board and the mismatch is reported.
 */
export const markOrderShipped = (orderId, shipment, { actor = 'chitchats' } = {}) => {
  const db = getDb();
  const ts = nowIso();
  const shipAll = config.chitchats.shipAllParts;

  const run = db.transaction(() => {
    const parts = db
      .prepare(`SELECT id, status FROM parts WHERE order_id = ? AND status <> 'SHIPPED'`)
      .all(orderId);

    const shipped = [];
    const skipped = [];

    for (const part of parts) {
      if (!shipAll && !SHIPPABLE_FROM_PRODUCTION.includes(part.status)) {
        skipped.push(part);
        continue;
      }
      db.prepare(
        `UPDATE parts SET status = 'SHIPPED', status_changed_at = @ts, shipped_at = @ts,
                          printed_at = COALESCE(printed_at, @ts), updated_at = @ts
         WHERE id = @id`,
      ).run({ id: part.id, ts });
      db.prepare(
        `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at)
         VALUES (?, ?, 'SHIPPED', ?, ?, ?)`,
      ).run(
        part.id,
        part.status,
        actor,
        `Chit Chats ${shipment.id ?? ''} ${shipment.tracking_number ? `- suivi ${shipment.tracking_number}` : ''}`.trim(),
        ts,
      );
      shipped.push(part.id);
    }

    db.prepare(
      `UPDATE orders SET chitchats_shipment_id = COALESCE(@shipmentId, chitchats_shipment_id),
                         tracking_number = COALESCE(@tracking, tracking_number),
                         carrier = COALESCE(@carrier, carrier),
                         shipped_at = COALESCE(shipped_at, @ts),
                         updated_at = @ts
       WHERE id = @id`,
    ).run({
      id: orderId,
      shipmentId: shipment.id ? String(shipment.id) : null,
      tracking: shipment.tracking_number ?? shipment.tracking ?? null,
      carrier: shipment.carrier ?? shipment.postage_type ?? null,
      ts,
    });

    return { orderId, shipped: shipped.length, skipped: skipped.length };
  });

  const result = run();
  if (result.skipped) {
    log.warn('order shipped while parts were still in production', result);
  }
  return result;
};
