import { config, isMock } from '../config.js';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { generateMockOrders } from './mock-data.js';

const log = createLogger('shopify');

const COLOR_PROPERTY_NAMES = ['color', 'colour', 'couleur', 'resin', 'résine', 'resin color', 'finish'];

/** Shopify line item -> normalised item (colour hints come from 3 places). */
export const normalizeLineItem = (lineItem) => {
  const propertyHints = (lineItem.properties ?? [])
    .filter((prop) => COLOR_PROPERTY_NAMES.includes(String(prop.name ?? '').toLowerCase()))
    .map((prop) => prop.value);

  return {
    externalId: String(lineItem.id),
    title: lineItem.title ?? lineItem.name ?? 'Pièce sans nom',
    sku: lineItem.sku ?? null,
    variantTitle: lineItem.variant_title ?? null,
    quantity: Number(lineItem.quantity ?? 1),
    unitPrice: Number(lineItem.price ?? 0),
    colorHints: [...propertyHints, lineItem.variant_title, lineItem.sku].filter(Boolean),
    raw: lineItem,
  };
};

/** Shopify order -> normalised order. Exported for the webhook route + tests. */
export const normalizeOrder = (order) => ({
  source: 'shopify',
  externalId: String(order.id),
  orderNumber: order.name ?? `#${order.order_number ?? order.id}`,
  customerName:
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') ||
    order.shipping_address?.name ||
    'Client Shopify',
  customerEmail: order.email ?? order.customer?.email ?? null,
  shippingCountry: order.shipping_address?.country_code ?? null,
  placedAt: order.created_at ?? new Date().toISOString(),
  totalPrice: Number(order.total_price ?? 0),
  currency: order.currency ?? 'CAD',
  isPriority: (order.tags ?? '').toLowerCase().includes('rush'),
  note: order.note ?? null,
  items: (order.line_items ?? [])
    .filter((item) => item.requires_shipping !== false)
    .map(normalizeLineItem),
  raw: order,
});

export const isConfigured = () =>
  Boolean(config.shopify.shopDomain && config.shopify.accessToken);

/**
 * Fetches unfulfilled orders created since `since`.
 * @param {{since?: string, mockSeed?: number, mockCount?: number}} options
 */
export const fetchOrders = async ({ since, mockSeed = 1, mockCount = 2 } = {}) => {
  if (isMock()) {
    log.debug('mock mode, generating orders', { mockSeed, mockCount });
    return generateMockOrders('shopify', mockSeed, mockCount);
  }
  if (!isConfigured()) {
    log.warn('shopify credentials missing, skipping');
    return [];
  }

  const url = new URL(
    `https://${config.shopify.shopDomain}/admin/api/${config.shopify.apiVersion}/orders.json`,
  );
  url.searchParams.set('status', 'any');
  url.searchParams.set('fulfillment_status', 'unfulfilled');
  url.searchParams.set('limit', '250');
  if (since) url.searchParams.set('created_at_min', since);

  const payload = await requestJson(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': config.shopify.accessToken,
      'Content-Type': 'application/json',
    },
  });

  const orders = payload?.orders ?? [];
  log.info('orders fetched', { count: orders.length });
  return orders.map(normalizeOrder);
};
