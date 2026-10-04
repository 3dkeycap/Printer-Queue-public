import { getDb, nowIso } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { fetchLineItemImages, isConfigured } from '../integrations/shopify.js';
import { getSettings } from './settings.service.js';

const log = createLogger('shopify:images');

// commandes déjà tentées sans résultat : on ne redemande pas à chaque cycle
const tried = new Map(); // externalId -> timestamp
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Rattrapage des photos : les commandes Shopify déjà importées sans photo
 * (avant que la récupération marche, ou sorties de la fenêtre de synchro) la
 * reçoivent ici, par lots, à la fin de chaque synchro Shopify.
 */
export const backfillShopifyImages = async ({ limit = 100, fetchImages = fetchLineItemImages } = {}) => {
  const settings = getSettings();
  if (!isConfigured(settings)) return { updated: 0 };
  const db = getDb();
  const now = Date.now();

  const orders = db
    .prepare(
      `SELECT DISTINCT o.external_id
         FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.source = 'shopify' AND i.image_url IS NULL
          AND EXISTS (SELECT 1 FROM parts p WHERE p.order_item_id = i.id AND p.status <> 'SHIPPED')
        ORDER BY o.id DESC`,
    )
    .all()
    .map((row) => row.external_id)
    .filter((id) => now - (tried.get(id) ?? 0) > RETRY_AFTER_MS)
    .slice(0, limit);
  if (!orders.length) return { updated: 0 };

  const images = await fetchImages(orders, settings);
  for (const id of orders) tried.set(id, now);

  const update = db.prepare(
    `UPDATE order_items SET image_url = ?, updated_at = ?
      WHERE external_id = ? AND image_url IS NULL
        AND order_id IN (SELECT id FROM orders WHERE source = 'shopify')`,
  );
  let updated = 0;
  db.transaction(() => {
    for (const [lineItemId, url] of Object.entries(images)) updated += update.run(url, nowIso(), lineItemId).changes;
  })();
  if (updated) log.info('product photos added to existing orders', { updated });
  return { updated };
};
