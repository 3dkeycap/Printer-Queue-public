import { getDb, getSetting, nowIso, setSetting } from '../db/index.js';
import { ingestOrders } from '../domain/ingest.js';
import { createLogger } from '../lib/logger.js';
import * as etsy from '../integrations/etsy.js';
import * as shopify from '../integrations/shopify.js';
import { backfillShopifyImages } from '../domain/shopifyImages.js';
import { syncMarketplaceFulfillment } from '../domain/fulfillment.js';
import { getSettings } from '../domain/settings.service.js';

const log = createLogger('sync:orders');

const SOURCES = { shopify, etsy };

const startRun = (source, trigger) => {
  const info = getDb()
    .prepare(
      `INSERT INTO sync_runs (source, trigger, status, started_at) VALUES (?, ?, 'running', ?)`,
    )
    .run(source, trigger, nowIso());
  return Number(info.lastInsertRowid);
};

/**
 * Résumé lisible d'une synchro, affiché dans le journal (Réglages →
 * Synchronisation) et joint aux signalements de bug.
 * Ex. « 12 commandes vues · 2 nouvelles · 5 pièces créées · 3 traitées dans Shopify → expédiées · 4 photos ajoutées »
 */
export const syncMessage = (source, summary = {}, fulfillment = {}, images = {}) => {
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const shop = source === 'shopify' ? 'Shopify' : 'Etsy';
  const parts = [
    plural(summary.ordersSeen ?? 0, 'commande vue', 'commandes vues'),
    plural(summary.ordersCreated ?? 0, 'nouvelle', 'nouvelles'),
    plural(summary.partsCreated ?? 0, 'pièce créée', 'pièces créées'),
  ];
  if (fulfillment.shipped) parts.push(`${plural(fulfillment.shipped, 'traitée', 'traitées')} dans ${shop} → expédiée${fulfillment.shipped > 1 ? 's' : ''}`);
  if (fulfillment.error) parts.push(`suivi des expéditions ${shop} en échec : ${fulfillment.error}`);
  if (images.updated) parts.push(plural(images.updated, 'photo ajoutée', 'photos ajoutées'));
  return parts.join(' · ');
};

const finishRun = (runId, status, summary = {}, message = null) => {
  const db = getDb();
  const run = db.prepare('SELECT started_at FROM sync_runs WHERE id = ?').get(runId);
  const finishedAt = nowIso();
  db.prepare(
    `UPDATE sync_runs SET status = @status, finished_at = @finishedAt,
       duration_ms = @duration, orders_seen = @ordersSeen, orders_created = @ordersCreated,
       parts_created = @partsCreated, parts_updated = @partsUpdated, message = @message
     WHERE id = @id`,
  ).run({
    id: runId,
    status,
    finishedAt,
    duration: new Date(finishedAt).getTime() - new Date(run.started_at).getTime(),
    ordersSeen: summary.ordersSeen ?? 0,
    ordersCreated: summary.ordersCreated ?? 0,
    partsCreated: summary.partsCreated ?? 0,
    partsUpdated: summary.partsUpdated ?? 0,
    message,
  });
};

/**
 * Polls one marketplace and ingests everything it returns.
 * @param {'shopify'|'etsy'} source
 */
export const syncSource = async (source, { trigger = 'cron' } = {}) => {
  const integration = SOURCES[source];
  if (!integration) throw new Error(`Unknown source "${source}"`);

  const runId = startRun(source, trigger);
  const cursorKey = `cursor:${source}`;
  const lookbackDays = getSettings()['schedule.lookbackDays'];
  const since =
    getSetting(cursorKey) ?? new Date(Date.now() - lookbackDays * 86400000).toISOString();

  try {
    const orders = await integration.fetchOrders({ since });
    const summary = ingestOrders(orders);

    // On n'avance le curseur QUE si on a vraiment vu des commandes, et on le
    // base sur leur date réelle (pas sur l'heure actuelle). Avancer sur une
    // horloge murale même quand `orders` est vide (identifiants absents,
    // boutique pas encore configurée, aucune commande dans la fenêtre...)
    // rétrécissait la fenêtre de recherche à chaque tick pour ne plus jamais
    // revoir les commandes plus anciennes : un bug réel qui a fait disparaître
    // des commandes existantes une fois la boutique enfin connectée.
    if (orders.length) {
      const overlapMs = 10 * 60000;
      const latestPlacedAt = orders.reduce(
        (max, order) => (order.placedAt && order.placedAt > max ? order.placedAt : max),
        orders[0].placedAt ?? since,
      );
      const nextCursor = new Date(new Date(latestPlacedAt).getTime() - overlapMs).toISOString();
      if (!since || nextCursor > since) setSetting(cursorKey, nextCursor);
    }

    // commandes traitées dans la boutique -> expédiées ici aussi (best-effort)
    const fulfillment = await syncMarketplaceFulfillment(source).catch((error) => {
      log.warn('fulfillment sync failed', { source, error: error.message });
      return { shipped: 0, error: error.message };
    });
    // photos des commandes Shopify déjà importées sans photo (best-effort)
    const images =
      source === 'shopify'
        ? await backfillShopifyImages().catch((error) => {
            log.warn('image backfill failed', { error: error.message });
            return { updated: 0 };
          })
        : { updated: 0 };

    const message = syncMessage(source, summary, fulfillment, images);
    finishRun(runId, 'success', summary, message);
    log.info('sync done', { source, ...summary, shippedInShop: fulfillment.shipped, photos: images.updated });
    return { source, status: 'success', ...summary, message };
  } catch (error) {
    finishRun(runId, 'error', {}, error.message);
    log.error('sync failed', { source, error: error.message });
    return { source, status: 'error', message: error.message };
  }
};

/** Polls every marketplace, sequentially (rate limits are per-shop anyway). */
export const syncAllSources = async ({ trigger = 'cron' } = {}) => {
  const results = [];
  for (const source of Object.keys(SOURCES)) {
    results.push(await syncSource(source, { trigger }));
  }
  return results;
};
