import crypto from 'node:crypto';
import { config, isMock } from '../config.js';
import { getDb } from '../db/index.js';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { generateMockShipments } from './mock-data.js';

const log = createLogger('chitchats');

/** Chit Chats statuses that mean "the parcel physically left the farm". */
export const SHIPPED_STATUSES = new Set([
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'ready_for_pickup',
  'picked_up',
  'completed',
]);

export const isShippedStatus = (status) =>
  SHIPPED_STATUSES.has(String(status ?? '').toLowerCase().replace(/\s+/g, '_'));

export const isConfigured = () =>
  Boolean(config.chitchats.clientId && config.chitchats.accessToken);

/** Normalises both the REST payload and the webhook payload into one shape. */
export const normalizeShipment = (payload = {}) => {
  const shipment = payload.shipment ?? payload;
  return {
    id: shipment.id ?? shipment.shipment_id ?? null,
    status: shipment.status ?? shipment.shipment_status ?? null,
    order_id: shipment.order_id ?? shipment.reference ?? shipment.name ?? null,
    to_name: shipment.to_name ?? shipment.recipient_name ?? null,
    tracking_number: shipment.tracking_number ?? shipment.tracking_code ?? null,
    carrier: shipment.postage_type ?? shipment.carrier ?? null,
    shipped_at: shipment.shipped_at ?? shipment.updated_at ?? null,
    raw: shipment,
  };
};

/**
 * Verifies the shared secret of an incoming webhook.
 * Chit Chats does not sign its payloads, so we rely on a secret header that
 * you configure on their side (and compare in constant time).
 */
export const verifyWebhookSecret = (providedSecret) => {
  const expected = config.chitchats.webhookSecret;
  if (!expected) return true; // verification disabled
  const a = Buffer.from(String(providedSecret ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Polls recent shipments. Used as a safety net when a webhook is missed.
 * In mock mode it fabricates shipments for orders that are fully produced,
 * which is exactly the scenario the dashboard needs to demo.
 */
export const fetchShipments = async ({ since } = {}) => {
  if (isMock()) {
    const candidates = getDb()
      .prepare(
        `SELECT o.* FROM orders o
         WHERE o.shipped_at IS NULL
           AND EXISTS (SELECT 1 FROM parts p WHERE p.order_id = o.id)
           AND NOT EXISTS (
             SELECT 1 FROM parts p WHERE p.order_id = o.id
               AND p.status NOT IN ('DONE','IN_INVENTORY','SHIPPED')
           )
         LIMIT 5`,
      )
      .all();
    return generateMockShipments(candidates).map(normalizeShipment);
  }

  if (!isConfigured()) {
    log.warn('chit chats credentials missing, skipping');
    return [];
  }

  const url = new URL(`${config.chitchats.apiBase}/clients/${config.chitchats.clientId}/shipments`);
  url.searchParams.set('limit', '100');
  if (since) url.searchParams.set('since', since);

  const payload = await requestJson(url.toString(), {
    headers: {
      Authorization: config.chitchats.accessToken,
      'Content-Type': 'application/json',
    },
  });

  const shipments = payload?.shipments ?? payload?.data ?? [];
  log.info('shipments fetched', { count: shipments.length });
  return shipments.map(normalizeShipment);
};

/** Fetches a single shipment (used to confirm a thin webhook payload). */
export const fetchShipment = async (shipmentId) => {
  if (isMock() || !isConfigured()) return null;
  const payload = await requestJson(
    `${config.chitchats.apiBase}/clients/${config.chitchats.clientId}/shipments/${shipmentId}`,
    { headers: { Authorization: config.chitchats.accessToken } },
  );
  return payload ? normalizeShipment(payload) : null;
};
