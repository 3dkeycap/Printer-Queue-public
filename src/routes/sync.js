import { Router } from 'express';
import { getDb } from '../db/index.js';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { syncAllSources, syncSource } from '../jobs/syncOrders.js';
import { syncShipments } from '../jobs/syncShipments.js';

export const syncRouter = Router();

/** Manual "sync now" button of the dashboard. */
syncRouter.post(
  '/run',
  asyncRoute(async (req, res) => {
    const source = (req.query.source ?? req.body?.source ?? 'all').toLowerCase();
    if (source === 'all') {
      const orders = await syncAllSources({ trigger: 'manual' });
      const shipments = await syncShipments({ trigger: 'manual' });
      return res.json({ orders, shipments });
    }
    if (source === 'chitchats') {
      return res.json({ shipments: await syncShipments({ trigger: 'manual' }) });
    }
    if (!['shopify', 'etsy'].includes(source)) throw badRequest(`Unknown source "${source}"`);
    return res.json({ orders: [await syncSource(source, { trigger: 'manual' })] });
  }),
);

syncRouter.get('/runs', (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit ?? '30', 10) || 30, 200);
  const items = getDb()
    .prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
    .all(limit);
  res.json({ items });
});

syncRouter.get('/webhooks', (req, res) => {
  const items = getDb()
    .prepare('SELECT id, provider, topic, external_id, status, result, received_at FROM webhook_events ORDER BY id DESC LIMIT 50')
    .all();
  res.json({ items });
});
