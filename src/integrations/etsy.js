import { config } from '../config.js';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from '../domain/settings.service.js';
import { ensureFreshEtsyToken } from './etsyOAuth.js';

const log = createLogger('etsy');

const COLOR_VARIATION_NAMES = ['color', 'colour', 'couleur', 'resin', 'primary color', 'finish'];

/** Etsy transaction -> normalised item. */
export const normalizeTransaction = (transaction) => {
  const variations = transaction.variations ?? [];
  const colorHints = variations
    .filter((variation) =>
      COLOR_VARIATION_NAMES.includes(String(variation.formatted_name ?? '').toLowerCase().replace(':', '')),
    )
    .map((variation) => variation.formatted_value);

  const variantTitle = variations
    .map((variation) => `${variation.formatted_name} ${variation.formatted_value}`.trim())
    .join(' / ');

  return {
    externalId: String(transaction.transaction_id),
    title: transaction.title ?? 'Pièce sans nom',
    sku: transaction.sku ?? null,
    variantTitle: variantTitle || null,
    quantity: Number(transaction.quantity ?? 1),
    unitPrice: Number(transaction.price?.amount ?? 0) / Number(transaction.price?.divisor ?? 1),
    colorHints: [...colorHints, variantTitle, transaction.sku].filter(Boolean),
    raw: transaction,
  };
};

/** Etsy receipt -> normalised order. */
export const normalizeReceipt = (receipt) => ({
  source: 'etsy',
  externalId: String(receipt.receipt_id),
  orderNumber: String(receipt.receipt_id),
  customerName: receipt.name ?? receipt.buyer_email ?? 'Client Etsy',
  customerEmail: receipt.buyer_email ?? null,
  shippingCountry: receipt.country_iso ?? null,
  placedAt: receipt.created_timestamp
    ? new Date(Number(receipt.created_timestamp) * 1000).toISOString()
    : new Date().toISOString(),
  totalPrice: Number(receipt.grandtotal?.amount ?? 0) / Number(receipt.grandtotal?.divisor ?? 1),
  currency: receipt.grandtotal?.currency_code ?? 'CAD',
  isPriority: false,
  note: receipt.message_from_buyer ?? null,
  items: (receipt.transactions ?? []).map(normalizeTransaction),
  raw: receipt,
});

export const isConfigured = (settings = getSettings()) =>
  Boolean(settings['etsy.shopId'] && settings['etsy.apiKey'] && settings['etsy.accessToken']);

/** Récupère les commandes payées et non expédiées. */
export const fetchOrders = async ({ since } = {}) => {
  const settings = getSettings();
  if (!settings['etsy.enabled']) {
    log.info('etsy sync disabled in settings');
    return [];
  }
  if (!isConfigured(settings)) {
    log.warn('etsy credentials missing, skipping');
    return [];
  }

  // Le token d'accès expire toutes les heures chez Etsy, bien avant le
  // prochain cycle du cron (5 min) ne s'en aperçoive autrement : on le
  // renouvelle ici de manière proactive quand un refresh token est
  // disponible (connexion faite via le bouton OAuth).
  await ensureFreshEtsyToken();
  const freshSettings = getSettings();

  const url = new URL(`${config.etsy.apiBase}/shops/${freshSettings['etsy.shopId']}/receipts`);
  url.searchParams.set('was_paid', 'true');
  url.searchParams.set('was_shipped', 'false');
  url.searchParams.set('limit', '100');
  if (since) url.searchParams.set('min_created', String(Math.floor(new Date(since).getTime() / 1000)));

  const payload = await requestJson(url.toString(), {
    headers: {
      'x-api-key': freshSettings['etsy.apiKey'],
      Authorization: `Bearer ${freshSettings['etsy.accessToken']}`,
    },
  });

  const receipts = payload?.results ?? [];
  log.info('receipts fetched', { count: receipts.length });
  return receipts.map(normalizeReceipt);
};
