import { config, isMock } from '../config.js';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { generateMockOrders } from './mock-data.js';

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

export const isConfigured = () =>
  Boolean(config.etsy.shopId && config.etsy.apiKey && config.etsy.accessToken);

/** Fetches unshipped, paid receipts. */
export const fetchOrders = async ({ since, mockSeed = 1, mockCount = 1 } = {}) => {
  if (isMock()) {
    log.debug('mock mode, generating orders', { mockSeed, mockCount });
    return generateMockOrders('etsy', mockSeed, mockCount);
  }
  if (!isConfigured()) {
    log.warn('etsy credentials missing, skipping');
    return [];
  }

  const url = new URL(`${config.etsy.apiBase}/shops/${config.etsy.shopId}/receipts`);
  url.searchParams.set('was_paid', 'true');
  url.searchParams.set('was_shipped', 'false');
  url.searchParams.set('limit', '100');
  if (since) url.searchParams.set('min_created', String(Math.floor(new Date(since).getTime() / 1000)));

  const payload = await requestJson(url.toString(), {
    headers: {
      'x-api-key': config.etsy.apiKey,
      Authorization: `Bearer ${config.etsy.accessToken}`,
    },
  });

  const receipts = payload?.results ?? [];
  log.info('receipts fetched', { count: receipts.length });
  return receipts.map(normalizeReceipt);
};
