import { config, isMock } from '../config.js';
import { getDb, getSetting, nowIso, setSetting } from '../db/index.js';
import { ingestOrders } from '../domain/ingest.js';
import { createLogger } from '../lib/logger.js';
import * as etsy from '../integrations/etsy.js';
import * as shopify from '../integrations/shopify.js';

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
  const since =
    getSetting(cursorKey) ??
    new Date(Date.now() - config.integrations.lookbackDays * 86400000).toISOString();

  try {
    // In mock mode the seed advances on every run so each cycle brings new orders.
    const mockSeed = Number(getSetting(`mock_seed:${source}`, '0')) + 1;
    const orders = await integration.fetchOrders({
      since,
      mockSeed,
      mockCount: source === 'shopify' ? 2 : 1,
    });

    const summary = ingestOrders(orders);
    if (isMock()) setSetting(`mock_seed:${source}`, mockSeed);
    // Re-poll with a small overlap so an order created during the request is not missed.
    setSetting(cursorKey, new Date(Date.now() - 10 * 60000).toISOString());

    finishRun(runId, 'success', summary);
    log.info('sync done', { source, ...summary });
    return { source, status: 'success', ...summary };
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
