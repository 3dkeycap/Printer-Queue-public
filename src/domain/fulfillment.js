import { getDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { fetchFulfilledOrders, isConfigured as shopifyConfigured } from '../integrations/shopify.js';
import { fetchShippedReceipts } from '../integrations/etsy.js';
import { markOrderShipped } from './orders.service.js';
import { getSettings } from './settings.service.js';

const log = createLogger('fulfillment');

/** Commandes encore ouvertes dans l'app pour une boutique (au moins une pièce pas expédiée). */
const openOrders = (source) =>
  getDb()
    .prepare(
      `SELECT id, external_id, COALESCE(placed_at, created_at) AS placed FROM orders
        WHERE source = ? AND shipped_at IS NULL
          AND EXISTS (SELECT 1 FROM parts p WHERE p.order_id = orders.id AND p.status <> 'SHIPPED')`,
    )
    .all(source);

/**
 * Commande traitée / expédiée dans Shopify ou Etsy -> toutes ses pièces
 * passent en Expédié dans l'app (même celles pas marquées imprimées).
 */
export const syncMarketplaceFulfillment = async (source, { fetchers = {} } = {}) => {
  const open = openOrders(source);
  if (!open.length) return { shipped: 0 };

  let done = [];
  if (source === 'shopify') {
    if (!fetchers.shopify && !shopifyConfigured(getSettings())) return { shipped: 0 };
    done = await (fetchers.shopify ?? fetchFulfilledOrders)(open.map((order) => order.external_id));
  } else if (source === 'etsy') {
    const since = open.reduce((min, order) => (order.placed && order.placed < min ? order.placed : min), open[0].placed);
    done = await (fetchers.etsy ?? fetchShippedReceipts)({ since });
  }

  const byExternal = new Map(open.map((order) => [String(order.external_id), order]));
  const label = source === 'shopify' ? 'Shopify' : 'Etsy';
  let shipped = 0;
  for (const entry of done) {
    const order = byExternal.get(String(entry.id));
    if (!order) continue;
    markOrderShipped(
      order.id,
      { tracking_number: entry.trackingNumber, carrier: entry.carrier, note: `Commande traitée dans ${label}` },
      { actor: source, shipAll: true },
    );
    shipped += 1;
  }
  if (shipped) log.info('orders fulfilled in the marketplace marked shipped', { source, orders: shipped });
  return { shipped };
};
