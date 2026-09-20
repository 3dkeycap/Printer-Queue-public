import { getDb, nowIso } from '../db/index.js';
import { findOrderForShipment, markOrderShipped } from '../domain/orders.service.js';
import { createLogger } from '../lib/logger.js';
import { fetchShipments, isShippedStatus } from '../integrations/chitchats.js';

const log = createLogger('sync:shipments');

/**
 * Applies one Chit Chats shipment to the local database:
 * finds the order, flips its parts to SHIPPED and stores the tracking number.
 * Shared by the webhook route and the reconciliation cron.
 */
export const applyShipment = (shipment, { actor = 'chitchats' } = {}) => {
  if (!isShippedStatus(shipment.status)) {
    return { matched: false, reason: `status "${shipment.status}" is not a shipped status` };
  }

  const order = findOrderForShipment(shipment);
  if (!order) {
    log.warn('no local order matches shipment', {
      shipmentId: shipment.id,
      orderRef: shipment.order_id,
      toName: shipment.to_name,
    });
    return { matched: false, reason: 'no matching order' };
  }

  const result = markOrderShipped(order.id, shipment, { actor });
  log.info('shipment applied', { shipmentId: shipment.id, orderId: order.id, ...result });
  return { matched: true, order, ...result };
};

/** Cron safety net: re-reads recent shipments in case a webhook was missed. */
export const syncShipments = async ({ trigger = 'cron' } = {}) => {
  const db = getDb();
  const startedAt = nowIso();
  const info = db
    .prepare(`INSERT INTO sync_runs (source, trigger, status, started_at) VALUES ('chitchats', ?, 'running', ?)`)
    .run(trigger, startedAt);
  const runId = Number(info.lastInsertRowid);

  try {
    const shipments = await fetchShipments({});
    let applied = 0;
    let parts = 0;

    for (const shipment of shipments) {
      const result = applyShipment(shipment, { actor: 'chitchats:poll' });
      if (result.matched) {
        applied += 1;
        parts += result.shipped ?? 0;
      }
    }

    const finishedAt = nowIso();
    db.prepare(
      `UPDATE sync_runs SET status = 'success', finished_at = ?, duration_ms = ?,
         orders_seen = ?, orders_created = 0, parts_updated = ?, message = ?
       WHERE id = ?`,
    ).run(
      finishedAt,
      new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      shipments.length,
      parts,
      `${applied} commande(s) expédiée(s)`,
      runId,
    );

    log.info('shipment sync done', { shipments: shipments.length, applied, parts });
    return { status: 'success', shipments: shipments.length, applied, parts };
  } catch (error) {
    db.prepare(`UPDATE sync_runs SET status = 'error', finished_at = ?, message = ? WHERE id = ?`).run(
      nowIso(),
      error.message,
      runId,
    );
    log.error('shipment sync failed', { error: error.message });
    return { status: 'error', message: error.message };
  }
};
