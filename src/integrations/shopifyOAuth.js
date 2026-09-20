import crypto from 'node:crypto';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { badRequest } from '../lib/errors.js';
import { getSettings } from '../domain/settings.service.js';

const log = createLogger('shopify:oauth');

/** Accepte "ma-boutique", "ma-boutique.myshopify.com" ou une URL complète. */
export const normalizeShopDomain = (input) => {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return withoutProtocol.includes('.') ? withoutProtocol : `${withoutProtocol}.myshopify.com`;
};

const isValidShopDomain = (domain) => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain);

/**
 * Construit l'URL d'autorisation Shopify (étape 1 du flux OAuth).
 * Le marchand est redirigé vers cette URL depuis son navigateur.
 */
export const buildAuthorizeUrl = (state) => {
  const settings = getSettings();
  const shop = normalizeShopDomain(settings['shopify.shopDomain']);
  const { apiKey } = { apiKey: settings['shopify.apiKey'] };

  if (!isValidShopDomain(shop)) {
    throw badRequest('Domaine de boutique Shopify invalide (attendu : ma-boutique.myshopify.com)');
  }
  if (!apiKey) throw badRequest('Le Client ID Shopify (API key) doit être renseigné avant de connecter la boutique');
  if (!settings['app.publicUrl']) {
    throw badRequest("L'URL publique de ce serveur doit être renseignée avant de connecter Shopify (elle sert d'adresse de retour OAuth)");
  }

  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', apiKey);
  url.searchParams.set('scope', settings['shopify.scopes'] || 'read_orders');
  url.searchParams.set('redirect_uri', redirectUri(settings));
  url.searchParams.set('state', state);
  return url.toString();
};

export const redirectUri = (settings = getSettings()) =>
  `${settings['app.publicUrl']}/api/integrations/shopify/oauth/callback`;

/**
 * Vérifie la signature HMAC des paramètres de retour OAuth (étape 2).
 * Algorithme documenté par Shopify : trier les clés (hors hmac/signature),
 * les rejoindre en `clé=valeur` séparés par `&`, puis comparer le HMAC-SHA256
 * hexadécimal calculé avec le Client secret.
 */
export const verifyOAuthCallback = (query, secret) => {
  const { hmac, signature, ...rest } = query;
  if (!hmac || !secret) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${Array.isArray(rest[key]) ? rest[key].join(',') : rest[key]}`)
    .join('&');

  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hmac));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Étape 3 : échange le `code` à usage unique contre un token d'accès permanent. */
export const exchangeCodeForToken = async ({ shop, code }) => {
  const settings = getSettings();
  const payload = await requestJson(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: settings['shopify.apiKey'],
      client_secret: settings['shopify.apiSecret'],
      code,
    }),
  });

  if (!payload?.access_token) {
    log.error('token exchange returned no access_token', { shop });
    throw badRequest("Shopify n'a pas renvoyé de token d'accès");
  }
  return payload;
};

/** État éphémère du flux OAuth (anti-CSRF), stocké en base pour survivre au multi-conteneurs. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
