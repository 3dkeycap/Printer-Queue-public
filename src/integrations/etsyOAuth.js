import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db/index.js';
import { getSettings, updateSettings } from '../domain/settings.service.js';
import { badRequest } from '../lib/errors.js';
import { requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { normalizeBaseUrl } from '../lib/url.js';

const log = createLogger('etsy:oauth');

const AUTHORIZE_URL = 'https://www.etsy.com/oauth/connect';
const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';

/** État éphémère du flux OAuth (anti-CSRF + vérifieur PKCE), stocké en base. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** La keystring seule (Client ID OAuth), même si « keystring:secret » a été collé dans le champ. */
export const etsyKeystring = (settings = getSettings()) => String(settings['etsy.apiKey'] ?? '').split(':')[0].trim();

/**
 * En-tête `x-api-key` exigé par Etsy sur CHAQUE appel v3 : « keystring:shared_secret ».
 * La keystring seule (ancien format) est refusée en 403.
 */
export const etsyApiKeyHeader = (settings = getSettings()) => {
  const raw = String(settings['etsy.apiKey'] ?? '').trim();
  const secret = String(settings['etsy.sharedSecret'] ?? '').trim();
  if (secret) return `${etsyKeystring(settings)}:${secret}`;
  return raw; // éventuellement déjà « keystring:secret »
};

export const redirectUri = (settings = getSettings()) =>
  `${normalizeBaseUrl(settings['app.publicUrl'])}/api/integrations/etsy/oauth/callback`;

const base64url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * PKCE (RFC 7636), obligatoire sur tout le flux OAuth d'Etsy : un vérifieur
 * aléatoire (43-128 caractères) et son empreinte SHA-256 encodée en base64url.
 */
export const generatePkce = () => {
  const verifier = base64url(crypto.randomBytes(64)); // -> 86 caractères
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
};

/** Construit l'URL d'autorisation Etsy (étape 1 du flux OAuth). */
export const buildAuthorizeUrl = (state, codeChallenge) => {
  const settings = getSettings();
  const apiKey = etsyKeystring(settings);

  if (!apiKey) throw badRequest('La clé API Etsy (Keystring) doit être renseignée avant de connecter la boutique');
  if (!settings['app.publicUrl']) {
    throw badRequest("L'URL publique de ce serveur doit être renseignée avant de connecter Etsy (elle sert d'adresse de retour OAuth)");
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', apiKey);
  url.searchParams.set('redirect_uri', redirectUri(settings));
  url.searchParams.set('scope', settings['etsy.scopes'] || 'transactions_r');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
};

/**
 * Étape 2 : échange le `code` à usage unique contre un token d'accès (1h) et
 * un refresh token (90 jours). Contrairement à Shopify, Etsy attend un corps
 * `application/x-www-form-urlencoded`, pas du JSON.
 */
export const exchangeCodeForToken = async ({ code, codeVerifier }) => {
  const settings = getSettings();
  const apiKey = etsyKeystring(settings);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: apiKey,
    redirect_uri: redirectUri(settings),
    code,
    code_verifier: codeVerifier,
  });

  const payload = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-api-key': etsyApiKeyHeader(settings),
    },
    body: body.toString(),
  });

  if (!payload?.access_token) {
    log.error('token exchange returned no access_token');
    throw badRequest("Etsy n'a pas renvoyé de token d'accès");
  }
  return payload;
};

const persistToken = (token) => {
  updateSettings({ 'etsy.accessToken': token.access_token });
  setSetting('etsy.refreshToken', token.refresh_token ?? getSetting('etsy.refreshToken'));
  setSetting('etsy.tokenExpiresAt', new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString());
};

/** Rafraîchit le token via le refresh token (valable 90 jours chez Etsy). */
const refreshAccessToken = async (refreshToken) => {
  const settings = getSettings();
  const apiKey = etsyKeystring(settings);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: apiKey,
    refresh_token: refreshToken,
  });

  const payload = await requestJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-api-key': etsyApiKeyHeader(settings),
    },
    body: body.toString(),
    retries: 1,
  });

  if (!payload?.access_token) {
    log.error('token refresh returned no access_token');
    throw badRequest("Etsy n'a pas renvoyé de nouveau token lors du rafraîchissement");
  }
  return payload;
};

/**
 * À appeler avant tout appel à l'API Etsy : le token d'accès expire toutes
 * les heures, bien plus vite que le cron de 5 minutes. Rafraîchit de manière
 * proactive (avec 5 min de marge) quand un refresh token est disponible ;
 * ne fait rien pour une ancienne connexion par token collé à la main (pas de
 * refresh token, donc pas de renouvellement possible - elle finira par
 * expirer et demandera une reconnexion OAuth).
 */
export const ensureFreshEtsyToken = async () => {
  const refreshToken = getSetting('etsy.refreshToken');
  if (!refreshToken) return;

  const expiresAt = getSetting('etsy.tokenExpiresAt');
  const bufferMs = 5 * 60 * 1000;
  if (expiresAt && new Date(expiresAt).getTime() - bufferMs > Date.now()) return;

  log.info('refreshing etsy access token');
  const token = await refreshAccessToken(refreshToken);
  persistToken(token);
};

/**
 * Boutique du vendeur connecté : le token OAuth commence par son user_id
 * (« 12345678.xxxx »), et /users/{id}/shops renvoie sa boutique. Évite un
 * Shop ID mal recopié (cause classique de 403/404 sur /shops/{id}/receipts).
 */
export const detectEtsyShop = async (settings = getSettings()) => {
  const userId = String(settings['etsy.accessToken'] ?? '').split('.')[0];
  if (!/^\d+$/.test(userId)) return null;
  const payload = await requestJson(`https://openapi.etsy.com/v3/application/users/${userId}/shops`, {
    headers: { 'x-api-key': etsyApiKeyHeader(settings), Authorization: `Bearer ${settings['etsy.accessToken']}` },
    retries: 1,
  });
  const shop = payload?.shop_id ? payload : payload?.results?.[0];
  return shop?.shop_id ? { shopId: String(shop.shop_id), name: shop.shop_name ?? null } : null;
};

export const completeOAuthConnection = async (token) => {
  persistToken(token);
  try {
    const shop = await detectEtsyShop();
    if (shop && shop.shopId !== String(getSettings()['etsy.shopId'] ?? '')) {
      updateSettings({ 'etsy.shopId': shop.shopId });
      log.info('etsy shop id set from the connected account', shop);
    }
  } catch (error) {
    log.warn('could not detect etsy shop id', { error: error.message });
  }
};

export const clearEtsyToken = () => {
  updateSettings({ 'etsy.accessToken': null });
  setSetting('etsy.refreshToken', null);
  setSetting('etsy.tokenExpiresAt', null);
};
