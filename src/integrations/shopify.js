import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from '../domain/settings.service.js';

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
    productId: lineItem.product_id ?? null,
    raw: lineItem,
  };
};

// product_id -> URL de la photo principale (ou null si le produit n'en a pas).
// En mémoire pour la durée de vie du process : la fenêtre de synchro revoit
// souvent les mêmes commandes ouvertes d'un cycle à l'autre, ça évite de
// refaire un appel API pour un produit déjà résolu.
const productImageCache = new Map();

/** Photo principale d'un produit Shopify. Best-effort : une erreur ne bloque jamais la synchro. */
export const fetchProductImage = async (productId, settings) => {
  if (!productId) return null;
  if (productImageCache.has(productId)) return productImageCache.get(productId);

  try {
    const url = `https://${settings['shopify.shopDomain']}/admin/api/${settings['shopify.apiVersion']}/products/${productId}.json?fields=id,image`;
    const payload = await requestJson(url, {
      headers: { 'X-Shopify-Access-Token': settings['shopify.accessToken'] },
    });
    const imageUrl = payload?.product?.image?.src ?? null;
    productImageCache.set(productId, imageUrl);
    return imageUrl;
  } catch (error) {
    log.warn('failed to fetch product image', { productId, error: error.message });
    return null;
  }
};

/** Ajoute `imageUrl` à chaque article, sans jamais faire échouer la synchro. */
export const attachProductImages = async (orders, settings) => {
  for (const order of orders) {
    for (const item of order.items) {
      item.imageUrl = await fetchProductImage(item.productId, settings);
    }
  }
  return orders;
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

export const isConfigured = (settings = getSettings()) =>
  Boolean(settings['shopify.shopDomain'] && settings['shopify.accessToken']);

/**
 * Récupère les commandes non honorées créées depuis `since`.
 * @param {{since?: string}} options
 */
export const fetchOrders = async ({ since } = {}) => {
  const settings = getSettings();
  if (!settings['shopify.enabled']) {
    log.info('shopify sync disabled in settings');
    return [];
  }
  if (!isConfigured(settings)) {
    log.warn('shopify credentials missing, skipping');
    return [];
  }

  const url = new URL(
    `https://${settings['shopify.shopDomain']}/admin/api/${settings['shopify.apiVersion']}/orders.json`,
  );
  url.searchParams.set('status', 'any');
  url.searchParams.set('fulfillment_status', 'unfulfilled');
  url.searchParams.set('limit', '250');
  if (since) url.searchParams.set('created_at_min', since);

  const payload = await requestJson(url.toString(), {
    headers: {
      'X-Shopify-Access-Token': settings['shopify.accessToken'],
      'Content-Type': 'application/json',
    },
  });

  const orders = payload?.orders ?? [];
  log.info('orders fetched', { count: orders.length });
  const normalized = orders.map(normalizeOrder);
  await attachProductImages(normalized, settings);
  return normalized;
};
