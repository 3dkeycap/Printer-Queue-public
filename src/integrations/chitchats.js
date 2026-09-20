import crypto from 'node:crypto';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from '../domain/settings.service.js';

const log = createLogger('chitchats');

/** Statuts Chit Chats signifiant « le colis a quitté l'atelier ». */
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

export const isConfigured = (settings = getSettings()) =>
  Boolean(settings['chitchats.clientId'] && settings['chitchats.accessToken']);

/** Normalise le payload REST et le payload webhook dans une seule forme. */
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
 * Vérifie le secret partagé d'un webhook entrant.
 * Chit Chats ne signe pas ses payloads : on s'appuie sur un en-tête secret,
 * comparé à temps constant.
 */
export const verifyWebhookSecret = (providedSecret) => {
  const expected = getSettings()['chitchats.webhookSecret'];
  if (!expected) return true; // vérification désactivée
  const a = Buffer.from(String(providedSecret ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Relit les expéditions récentes : filet de sécurité si un webhook est perdu. */
export const fetchShipments = async ({ since } = {}) => {
  const settings = getSettings();
  if (!isConfigured(settings)) {
    log.warn('chit chats credentials missing, skipping');
    return [];
  }

  const url = new URL(`${settings['chitchats.apiBase']}/clients/${settings['chitchats.clientId']}/shipments`);
  url.searchParams.set('limit', '100');
  if (since) url.searchParams.set('since', since);

  const payload = await requestJson(url.toString(), {
    headers: {
      Authorization: settings['chitchats.accessToken'],
      'Content-Type': 'application/json',
    },
  });

  const shipments = payload?.shipments ?? payload?.data ?? [];
  log.info('shipments fetched', { count: shipments.length });
  return shipments.map(normalizeShipment);
};

/** Relit un envoi précis (pour confirmer un payload webhook incomplet). */
export const fetchShipment = async (shipmentId) => {
  const settings = getSettings();
  if (!isConfigured(settings)) return null;
  const payload = await requestJson(
    `${settings['chitchats.apiBase']}/clients/${settings['chitchats.clientId']}/shipments/${shipmentId}`,
    { headers: { Authorization: settings['chitchats.accessToken'] } },
  );
  return payload ? normalizeShipment(payload) : null;
};
