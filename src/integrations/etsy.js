import { config } from '../config.js';
import { ApiError, requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings, updateSettings } from '../domain/settings.service.js';
import { detectEtsyShop, ensureFreshEtsyToken, etsyApiKeyHeader } from './etsyOAuth.js';

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
    listingId: transaction.listing_id ?? null,
    listingImageId: transaction.listing_image_id ?? null,
    raw: transaction,
  };
};

// `${listingId}:${listingImageId}` -> URL de la photo (ou null). En mémoire
// pour la durée de vie du process, même logique que côté Shopify.
const listingImageCache = new Map();

/** Photo d'une annonce Etsy. Best-effort : une erreur ne bloque jamais la synchro. */
export const fetchListingImage = async (listingId, listingImageId, settings) => {
  if (!listingId || !listingImageId) return null;
  const cacheKey = `${listingId}:${listingImageId}`;
  if (listingImageCache.has(cacheKey)) return listingImageCache.get(cacheKey);

  try {
    const url = `${config.etsy.apiBase}/listings/${listingId}/images/${listingImageId}`;
    const payload = await requestJson(url, {
      headers: {
        'x-api-key': etsyApiKeyHeader(settings),
        Authorization: `Bearer ${settings['etsy.accessToken']}`,
      },
    });
    const imageUrl = payload?.url_570xN ?? payload?.url_fullxfull ?? null;
    listingImageCache.set(cacheKey, imageUrl);
    return imageUrl;
  } catch (error) {
    log.warn('failed to fetch listing image', { listingId, listingImageId, error: error.message });
    return null;
  }
};

/** Ajoute `imageUrl` à chaque article, sans jamais faire échouer la synchro. */
export const attachListingImages = async (orders, settings) => {
  for (const order of orders) {
    for (const item of order.items) {
      item.imageUrl = await fetchListingImage(item.listingId, item.listingImageId, settings);
    }
  }
  return orders;
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

/** Le shared secret est-il fourni (champ dédié, ou « keystring:secret » collé dans la clé) ? */
const hasSharedSecret = (settings) =>
  Boolean(String(settings['etsy.sharedSecret'] ?? '').trim() || String(settings['etsy.apiKey'] ?? '').includes(':'));

/** Message d'Etsy (« error ») si présent. */
const etsyMessage = (error) => {
  const body = error?.body ?? {};
  return body.error_description ?? body.error ?? body.message ?? body.raw ?? null;
};

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

  if (!hasSharedSecret(freshSettings)) {
    // Etsy refuse maintenant tout appel sans « keystring:shared secret » : inutile d'insister
    throw new Error(
      'Etsy exige le « Shared secret » de ton app (Etsy → Your Apps) : ajoute-le dans Réglages → Boutiques → Etsy. Sans lui, Etsy répond 403.',
    );
  }

  const fetchReceipts = (shopId) => {
    const url = new URL(`${config.etsy.apiBase}/shops/${shopId}/receipts`);
    url.searchParams.set('was_paid', 'true');
    url.searchParams.set('was_shipped', 'false');
    url.searchParams.set('limit', '100');
    if (since) url.searchParams.set('min_created', String(Math.floor(new Date(since).getTime() / 1000)));
    return requestJson(url.toString(), {
      headers: {
        'x-api-key': etsyApiKeyHeader(freshSettings),
        Authorization: `Bearer ${freshSettings['etsy.accessToken']}`,
      },
    });
  };

  let payload;
  try {
    payload = await fetchReceipts(freshSettings['etsy.shopId']);
  } catch (error) {
    if (!(error instanceof ApiError) || ![401, 403, 404].includes(error.status)) throw error;
    // Shop ID mal recopié ? On demande à Etsy la boutique du compte connecté et on réessaie une fois.
    const shop = await detectEtsyShop(freshSettings).catch(() => null);
    if (shop && shop.shopId !== String(freshSettings['etsy.shopId'])) {
      log.warn('etsy shop id corrected from the connected account', { from: freshSettings['etsy.shopId'], to: shop.shopId });
      updateSettings({ 'etsy.shopId': shop.shopId });
      payload = await fetchReceipts(shop.shopId);
    } else {
      const detail = etsyMessage(error);
      const hint =
        error.status === 401
          ? 'connexion expirée : clique « Reconnecter via OAuth » (Réglages → Boutiques → Etsy)'
          : 'vérifie le Shared secret et reconnecte la boutique via OAuth (scope transactions_r)';
      throw new Error(`Etsy refuse l'accès (${error.status})${detail ? ` : ${detail}` : ''} — ${hint}.`);
    }
  }

  const receipts = payload?.results ?? [];
  log.info('receipts fetched', { count: receipts.length });
  const normalized = receipts.map(normalizeReceipt);
  await attachListingImages(normalized, freshSettings);
  return normalized;
};

/**
 * Reçus Etsy déjà expédiés depuis `since` (même rôle que fetchFulfilledOrders
 * côté Shopify). Renvoie [{ id, trackingNumber, carrier }].
 */
export const fetchShippedReceipts = async ({ since } = {}) => {
  const settings = getSettings();
  if (!settings['etsy.enabled'] || !isConfigured(settings) || !hasSharedSecret(settings)) return [];
  await ensureFreshEtsyToken();
  const fresh = getSettings();
  const shipped = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const url = new URL(`${config.etsy.apiBase}/shops/${fresh['etsy.shopId']}/receipts`);
    url.searchParams.set('was_shipped', 'true');
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    if (since) url.searchParams.set('min_created', String(Math.floor(new Date(since).getTime() / 1000)));
    const payload = await requestJson(url.toString(), {
      headers: { 'x-api-key': etsyApiKeyHeader(fresh), Authorization: `Bearer ${fresh['etsy.accessToken']}` },
      retries: 1,
    });
    const receipts = payload?.results ?? [];
    for (const receipt of receipts) {
      const shipment = (receipt.shipments ?? []).at(-1) ?? {};
      shipped.push({ id: String(receipt.receipt_id), trackingNumber: shipment.tracking_code ?? null, carrier: shipment.carrier_name ?? null });
    }
    if (receipts.length < 100) break;
  }
  return shipped;
};
