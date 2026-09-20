import { getDb, nowIso } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { listColors, resolveColorKey } from './colors.js';

const log = createLogger('ingest');

/**
 * @typedef {Object} NormalizedItem
 * @property {string} externalId   line item / transaction id
 * @property {string} title
 * @property {string} [sku]
 * @property {string} [variantTitle]
 * @property {number} quantity
 * @property {number} [unitPrice]
 * @property {string[]} [colorHints] free text used to detect the resin colour
 * @property {object} [raw]
 *
 * @typedef {Object} NormalizedOrder
 * @property {'shopify'|'etsy'|'manual'} source
 * @property {string} externalId
 * @property {string} [orderNumber]
 * @property {string} [customerName]
 * @property {string} [customerEmail]
 * @property {string} [shippingCountry]
 * @property {string} [placedAt] ISO date
 * @property {number} [totalPrice]
 * @property {string} [currency]
 * @property {boolean} [isPriority]
 * @property {NormalizedItem[]} items
 * @property {object} [raw]
 */

/**
 * Upserts one normalised order and explodes every line item into individual
 * parts: quantity 3 => 3 rows in `parts`.
 * Idempotent - re-running a sync never duplicates a part because of the
 * UNIQUE (order_item_id, unit_index) constraint.
 *
 * @param {NormalizedOrder} order
 * @returns {{orderId:number, orderCreated:boolean, partsCreated:number, partsUpdated:number}}
 */
export const ingestOrder = (order) => {
  const db = getDb();
  const colors = listColors();
  const ts = nowIso();

  const run = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM orders WHERE source = ? AND external_id = ?')
      .get(order.source, String(order.externalId));

    let orderId;
    let orderCreated = false;

    if (existing) {
      orderId = existing.id;
      db.prepare(
        `UPDATE orders SET
           order_number = COALESCE(@orderNumber, order_number),
           customer_name = COALESCE(@customerName, customer_name),
           customer_email = COALESCE(@customerEmail, customer_email),
           shipping_country = COALESCE(@shippingCountry, shipping_country),
           placed_at = COALESCE(@placedAt, placed_at),
           total_price = COALESCE(@totalPrice, total_price),
           currency = COALESCE(@currency, currency),
           is_priority = @isPriority,
           note = COALESCE(@note, note),
           raw_payload = COALESCE(@raw, raw_payload),
           updated_at = @ts
         WHERE id = @id`,
      ).run({
        id: orderId,
        orderNumber: order.orderNumber ?? null,
        customerName: order.customerName ?? null,
        customerEmail: order.customerEmail ?? null,
        shippingCountry: order.shippingCountry ?? null,
        placedAt: order.placedAt ?? null,
        totalPrice: order.totalPrice ?? null,
        currency: order.currency ?? null,
        isPriority: order.isPriority ? 1 : existing.is_priority,
        note: order.note ?? null,
        raw: order.raw ? JSON.stringify(order.raw) : null,
        ts,
      });
    } else {
      const info = db
        .prepare(
          `INSERT INTO orders (source, external_id, order_number, customer_name, customer_email,
                               shipping_country, placed_at, total_price, currency, is_priority,
                               note, raw_payload, created_at, updated_at)
           VALUES (@source, @externalId, @orderNumber, @customerName, @customerEmail,
                   @shippingCountry, @placedAt, @totalPrice, @currency, @isPriority,
                   @note, @raw, @ts, @ts)`,
        )
        .run({
          source: order.source,
          externalId: String(order.externalId),
          orderNumber: order.orderNumber ?? null,
          customerName: order.customerName ?? null,
          customerEmail: order.customerEmail ?? null,
          shippingCountry: order.shippingCountry ?? null,
          placedAt: order.placedAt ?? null,
          totalPrice: order.totalPrice ?? null,
          currency: order.currency ?? null,
          isPriority: order.isPriority ? 1 : 0,
          note: order.note ?? null,
          raw: order.raw ? JSON.stringify(order.raw) : null,
          ts,
        });
      orderId = Number(info.lastInsertRowid);
      orderCreated = true;
    }

    let partsCreated = 0;
    let partsUpdated = 0;

    for (const item of order.items ?? []) {
      const quantity = Math.max(Number.parseInt(item.quantity, 10) || 1, 1);
      const colorKey = resolveColorKey(
        [item.variantTitle, item.sku, item.title, ...(item.colorHints ?? [])],
        colors,
      );

      const existingItem = db
        .prepare('SELECT * FROM order_items WHERE order_id = ? AND external_id = ?')
        .get(orderId, String(item.externalId));

      let itemId;
      if (existingItem) {
        itemId = existingItem.id;
        db.prepare(
          `UPDATE order_items SET title = @title, sku = @sku, variant_title = @variantTitle,
                                  quantity = @quantity, unit_price = @unitPrice, color_key = @colorKey,
                                  raw_payload = COALESCE(@raw, raw_payload), updated_at = @ts
           WHERE id = @id`,
        ).run({
          id: itemId,
          title: item.title,
          sku: item.sku ?? null,
          variantTitle: item.variantTitle ?? null,
          quantity,
          unitPrice: item.unitPrice ?? null,
          colorKey,
          raw: item.raw ? JSON.stringify(item.raw) : null,
          ts,
        });
      } else {
        const info = db
          .prepare(
            `INSERT INTO order_items (order_id, external_id, title, sku, variant_title, quantity,
                                      unit_price, color_key, raw_payload, created_at, updated_at)
             VALUES (@orderId, @externalId, @title, @sku, @variantTitle, @quantity,
                     @unitPrice, @colorKey, @raw, @ts, @ts)`,
          )
          .run({
            orderId,
            externalId: String(item.externalId),
            title: item.title,
            sku: item.sku ?? null,
            variantTitle: item.variantTitle ?? null,
            quantity,
            unitPrice: item.unitPrice ?? null,
            colorKey,
            raw: item.raw ? JSON.stringify(item.raw) : null,
            ts,
          });
        itemId = Number(info.lastInsertRowid);
      }

      // --- granularity: one row per physical object ---------------------
      const known = db
        .prepare('SELECT unit_index FROM parts WHERE order_item_id = ?')
        .all(itemId)
        .map((row) => row.unit_index);

      for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
        if (known.includes(unitIndex)) {
          partsUpdated += 1;
          continue;
        }
        const info = db
          .prepare(
            `INSERT INTO parts (order_id, order_item_id, unit_index, name, sku, variant_title,
                                color_key, status, priority, status_changed_at, created_at, updated_at)
             VALUES (@orderId, @itemId, @unitIndex, @name, @sku, @variantTitle,
                     @colorKey, 'TO_PRINT', @priority, @ts, @ts, @ts)`,
          )
          .run({
            orderId,
            itemId,
            unitIndex,
            name: item.title,
            sku: item.sku ?? null,
            variantTitle: item.variantTitle ?? null,
            colorKey,
            priority: order.isPriority ? 1 : 0,
            ts,
          });
        db.prepare(
          `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at)
           VALUES (?, NULL, 'TO_PRINT', 'worker', ?, ?)`,
        ).run(
          info.lastInsertRowid,
          `Importé depuis ${order.source} (commande ${order.orderNumber ?? order.externalId})`,
          ts,
        );
        partsCreated += 1;
      }

      if (known.length > quantity) {
        log.warn('line item quantity decreased, existing parts kept', {
          orderId,
          itemId,
          known: known.length,
          quantity,
        });
      }
    }

    return { orderId, orderCreated, partsCreated, partsUpdated };
  });

  return run();
};

export const ingestOrders = (orders) => {
  const summary = { ordersSeen: 0, ordersCreated: 0, partsCreated: 0, partsUpdated: 0 };
  for (const order of orders) {
    const result = ingestOrder(order);
    summary.ordersSeen += 1;
    summary.ordersCreated += result.orderCreated ? 1 : 0;
    summary.partsCreated += result.partsCreated;
    summary.partsUpdated += result.partsUpdated;
  }
  return summary;
};
