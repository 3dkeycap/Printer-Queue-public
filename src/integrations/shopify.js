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

/*
 * Photos produits. Deux sources, dans cet ordre :
 *  1. GraphQL `LineItem.image` : la photo de la ligne de commande (variante
 *     achetée), lisible avec le seul scope read_orders ;
 *  2. REST /products/{id}.json : demande read_products, souvent absent. Au
 *     premier refus (403), on arrête de l'appeler pour la durée du process.
 * Best-effort : une erreur ne bloque jamais la synchro.
 */
const productImageCache = new Map();
let productsApiForbidden = false;

const graphqlUrl = (settings) =>
  `https://${settings['shopify.shopDomain']}/admin/api/${settings['shopify.apiVersion']}/graphql.json`;

/** { [lineItemId]: url } pour une liste d'id de commandes Shopify (REST, numériques). */
export const fetchLineItemImages = async (orderIds, settings) => {
  const images = {};
  const ids = [...new Set(orderIds.map(String).filter((id) => /^\d+$/.test(id)))];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).map((id) => `gid://shopify/Order/${id}`);
    try {
      const payload = await requestJson(graphqlUrl(settings), {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': settings['shopify.accessToken'], 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query ($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { lineItems(first: 100) { nodes { id image { url } } } } } }`,
          variables: { ids: batch },
        }),
        retries: 1,
      });
      if (payload?.errors?.length) log.warn('graphql line item images', { error: payload.errors[0]?.message });
      for (const order of payload?.data?.nodes ?? []) {
        for (const line of order?.lineItems?.nodes ?? []) {
          const lineId = String(line.id ?? '').split('/').pop();
          if (lineId && line.image?.url) images[lineId] = line.image.url;
        }
      }
    } catch (error) {
      log.warn('failed to fetch line item images', { error: error.message });
    }
  }
  return images;
};

/** Photo principale d'un produit (REST, scope read_products). */
export const fetchProductImage = async (productId, settings) => {
  if (!productId || productsApiForbidden) return null;
  if (productImageCache.has(productId)) return productImageCache.get(productId);

  try {
    const url = `https://${settings['shopify.shopDomain']}/admin/api/${settings['shopify.apiVersion']}/products/${productId}.json?fields=id,image`;
    const payload = await requestJson(url, {
      headers: { 'X-Shopify-Access-Token': settings['shopify.accessToken'] },
      retries: 1,
    });
    const imageUrl = payload?.product?.image?.src ?? null;
    productImageCache.set(productId, imageUrl);
    return imageUrl;
  } catch (error) {
    if (error.status === 403 || error.status === 401) {
      productsApiForbidden = true;
      log.info('shopify products API not allowed (scope read_products missing): line item images only');
    } else {
      log.warn('failed to fetch product image', { productId, error: error.message });
    }
    return null;
  }
};

/** Ajoute `imageUrl` à chaque article, sans jamais faire échouer la synchro. */
export const attachProductImages = async (orders, settings) => {
  const lineImages = await fetchLineItemImages(orders.map((order) => order.externalId), settings);
  for (const order of orders) {
    for (const item of order.items) {
      item.imageUrl = lineImages[item.externalId] ?? (await fetchProductImage(item.productId, settings));
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
