import { getDb, nowIso } from '../db/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('cancellation');

/**
 * Commande annulée (Shopify : `cancelled_at`, Etsy : reçu « canceled ») : ses
 * pièces ne doivent plus être à imprimer. On ne les supprime pas (l'historique
 * et la vue « Tout » les gardent, marquées « Annulée ») : le drapeau
 * `parts.cancelled` les sort du tableau « À imprimer » et de ses compteurs.
 * Les pièces déjà expédiées ne changent pas. Idempotent.
 *
 * @returns {number} nombre de pièces retirées de la file
 */
export const cancelOrder = (orderId, { at = nowIso(), db = getDb() } = {}) =>
  db.transaction(() => {
    db.prepare('UPDATE orders SET cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?').run(at, at, orderId);
    const parts = db
      .prepare(`SELECT id, status FROM parts WHERE order_id = ? AND cancelled = 0 AND status <> 'SHIPPED'`)
      .all(orderId);
    const flag = db.prepare('UPDATE parts SET cancelled = 1 WHERE id = ?');
    const event = db.prepare(
      `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, 'worker', ?, ?)`,
    );
    for (const part of parts) {
      flag.run(part.id);
      event.run(part.id, part.status, part.status, 'Commande annulée : retirée de « À imprimer »', at);
    }
    if (parts.length) log.info('cancelled order removed from the queue', { orderId, parts: parts.length });
    return parts.length;
  })();
