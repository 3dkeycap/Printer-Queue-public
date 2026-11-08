import { getDb, nowIso } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { ApiError } from '../lib/http.js';
import { getSettings } from './settings.service.js';
import { createReceiptShipment, fetchReceiptShipments, isConfigured } from '../integrations/etsy.js';

const log = createLogger('etsy-tracking');

/**
 * Suivi Chit Chats -> Etsy. Quand une commande Etsy part avec Chit Chats, son numéro de suivi est envoyé à Etsy
 * tout seul (plus de copier-coller) : Etsy marque la commande expédiée et prévient l'acheteur.
 */

/** Transporteur au nom que connaît Etsy ; « other » quand on ne sait pas. */
export const etsyCarrier = (carrier) => {
  const text = String(carrier ?? '').toLowerCase();
  if (text.includes('usps')) return 'usps';
  if (text.includes('canada') || text.includes('chit_chats') || text.includes('chit chats')) return 'canada-post';
  if (text.includes('fedex')) return 'fedex';
  if (text.includes('dhl')) return 'dhl-express';
  if (/\bups\b/.test(text)) return 'ups';
  return 'other';
};

const record = (orderId, { ok, error = null }) =>
  getDb()
    .prepare('UPDATE orders SET etsy_tracking_at = ?, etsy_tracking_error = ?, updated_at = ? WHERE id = ?')
    .run(ok ? nowIso() : null, error, nowIso(), orderId);

const explain = (error) => {
  if (error instanceof ApiError) {
    const text = JSON.stringify(error.body ?? {});
    if (error.status === 403 || /scope|transactions_w/i.test(text)) {
      return 'Etsy refuse d’écrire : reconnecte Etsy (Réglages → Boutiques → Etsy → Reconnecter via OAuth) pour accorder transactions_w';
    }
    return `Etsy a refusé le suivi (${error.status}) : ${error.body?.error ?? error.body?.message ?? 'raison inconnue'}`;
  }
  return `Etsy injoignable (${error.message})`;
};

/** Envoie le suivi d'une commande Etsy ; renvoie { status: 'sent' | 'already' | 'skipped' | 'error', error? }. */
export const pushEtsyTracking = async (orderId, { send = createReceiptShipment, list = fetchReceiptShipments } = {}) => {
  const settings = getSettings();
  const order = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(Number(orderId));
  if (!order || order.source !== 'etsy' || !order.tracking_number || order.etsy_tracking_at) return { status: 'skipped' };
  if (!settings['etsy.pushTracking'] || !settings['etsy.enabled'] || !isConfigured(settings)) return { status: 'skipped' };

  const tracking = String(order.tracking_number).trim();
  try {
    // déjà saisi à la main dans Etsy : rien à refaire (pas de 2e envoi à l'acheteur)
    const existing = await list(order.external_id);
    if (existing.some((shipment) => String(shipment.tracking_code ?? '').trim() === tracking)) {
      record(order.id, { ok: true });
      return { status: 'already' };
    }
    try {
      await send(order.external_id, { trackingCode: tracking, carrierName: etsyCarrier(order.carrier) });
    } catch (error) {
      // transporteur inconnu d'Etsy : on renvoie avec « other » plutôt que d'échouer
      if (!(error instanceof ApiError) || error.status !== 400 || etsyCarrier(order.carrier) === 'other') throw error;
      await send(order.external_id, { trackingCode: tracking, carrierName: 'other' });
    }
    record(order.id, { ok: true });
    log.info('tracking sent to etsy', { orderId: order.id, tracking });
    return { status: 'sent' };
  } catch (error) {
    const reason = explain(error);
    record(order.id, { ok: false, error: reason });
    log.warn('tracking not sent to etsy', { orderId: order.id, reason });
    return { status: 'error', error: reason };
  }
};

/** Filet de sécurité (job des expéditions) : renvoie ce qui n'est pas encore parti, au plus 10 commandes par passage. */
export const pushPendingEtsyTracking = async (options) => {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT id FROM orders WHERE source = 'etsy' AND tracking_number IS NOT NULL AND etsy_tracking_at IS NULL
          AND COALESCE(shipped_at, updated_at) >= ? ORDER BY id DESC LIMIT 10`,
    )
    .all(since);
  const counts = { sent: 0, already: 0, error: 0, skipped: 0 };
  for (const row of rows) counts[(await pushEtsyTracking(row.id, options)).status] += 1;
  return counts;
};
