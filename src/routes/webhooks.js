import crypto from 'node:crypto';
import { Router } from 'express';
import { getDb, nowIso } from '../db/index.js';
import { getSettings } from '../domain/settings.service.js';
import { asyncRoute } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { normalizeShipment, verifyWebhookSecret } from '../integrations/chitchats.js';
import { attachProductImages, normalizeOrder } from '../integrations/shopify.js';
import { ingestOrder } from '../domain/ingest.js';
import { applyShipment } from '../jobs/syncShipments.js';

const log = createLogger('webhooks');
export const webhooksRouter = Router();

const record = (provider, topic, externalId, payload) => {
  const info = getDb()
    .prepare(
      `INSERT INTO webhook_events (provider, topic, external_id, payload, status, received_at)
       VALUES (?, ?, ?, ?, 'received', ?)`,
    )
    .run(provider, topic, externalId ? String(externalId) : null, JSON.stringify(payload ?? {}), nowIso());
  return Number(info.lastInsertRowid);
};

const settle = (id, status, result) => {
  getDb()
    .prepare('UPDATE webhook_events SET status = ?, result = ? WHERE id = ?')
    .run(status, typeof result === 'string' ? result : JSON.stringify(result), id);
};

/**
 * Chit Chats -> parts become SHIPPED.
 * Configure the hook on their side with the `X-Webhook-Secret` header set to
 * CHITCHATS_WEBHOOK_SECRET.
 */
webhooksRouter.post(
  '/chitchats',
  asyncRoute((req, res) => {
    if (!verifyWebhookSecret(req.headers['x-webhook-secret'])) {
      log.warn('rejected webhook: bad secret');
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const shipment = normalizeShipment(req.body ?? {});
    const eventId = record('chitchats', req.body?.event ?? 'shipment.updated', shipment.id, req.body);

    const result = applyShipment(shipment, { actor: 'chitchats:webhook' });
    settle(eventId, result.matched ? 'processed' : 'ignored', result);

    return res.status(result.matched ? 200 : 202).json({ received: true, ...result });
  }),
);

/**
 * Optional Shopify orders/create hook: parts appear instantly, no 5 min wait.
 * Shopify signs webhook bodies with the app's OAuth Client secret (there is
 * no separate webhook secret to configure).
 */
webhooksRouter.post(
  '/shopify',
  asyncRoute(async (req, res) => {
    const settings = getSettings();
    const secret = settings['shopify.apiSecret'];
    if (secret) {
      const digest = crypto.createHmac('sha256', secret).update(req.rawBody ?? Buffer.alloc(0)).digest('base64');
      const provided = String(req.headers['x-shopify-hmac-sha256'] ?? '');
      const valid =
        provided.length === digest.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(digest));
      if (!valid) {
        log.warn('rejected shopify webhook: bad HMAC');
        return res.status(401).json({ error: 'Invalid HMAC' });
      }
    }

    const topic = String(req.headers['x-shopify-topic'] ?? 'orders/create');
    const eventId = record('shopify', topic, req.body?.id, req.body);
    const order = normalizeOrder(req.body ?? {});
    await attachProductImages([order], settings);
    const result = ingestOrder(order);
    settle(eventId, 'processed', result);

    return res.json({ received: true, ...result });
  }),
);

/** Etsy has no order webhook: exposed for a custom relay / Zapier bridge. */
webhooksRouter.post(
  '/etsy',
  asyncRoute(async (req, res) => {
    const eventId = record('etsy', 'receipt.created', req.body?.receipt_id, req.body);
    const { normalizeReceipt, attachListingImages } = await import('../integrations/etsy.js');
    const order = normalizeReceipt(req.body ?? {});
    await attachListingImages([order], getSettings());
    const result = ingestOrder(order);
    settle(eventId, 'processed', result);
    return res.json({ received: true, ...result });
  }),
);
