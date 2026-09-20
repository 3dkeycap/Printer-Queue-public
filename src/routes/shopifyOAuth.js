import crypto from 'node:crypto';
import { Router } from 'express';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { getSetting, setSetting } from '../db/index.js';
import { getSettings, updateSettings } from '../domain/settings.service.js';
import {
  OAUTH_STATE_TTL_MS,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  normalizeBaseUrl,
  normalizeShopDomain,
  verifyOAuthCallback,
} from '../integrations/shopifyOAuth.js';

const log = createLogger('shopify:oauth');
export const shopifyOAuthRouter = Router();

/**
 * Étape 1 : le marchand clique « Connecter via OAuth » dans Intégrations.
 * Navigation plein écran (pas un fetch) vers l'écran d'autorisation Shopify.
 */
shopifyOAuthRouter.get(
  '/start',
  asyncRoute((req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    setSetting('shopify.oauthState', JSON.stringify({ state, expiresAt: Date.now() + OAUTH_STATE_TTL_MS }));
    res.redirect(buildAuthorizeUrl(state));
  }),
);

/**
 * Étape 2-3 : Shopify redirige ici avec `code` + `state` + `hmac`.
 * On vérifie les deux, échange le code contre un token, puis on renvoie le
 * navigateur vers le dashboard.
 */
shopifyOAuthRouter.get(
  '/callback',
  asyncRoute(async (req, res) => {
    const backToDashboard = (status, message) => {
      const url = new URL(`${normalizeBaseUrl(getSettings()['app.publicUrl'])}/`);
      url.hash = 'integrations';
      url.searchParams.set('shopify_status', status);
      if (message) url.searchParams.set('shopify_message', message);
      res.redirect(url.toString());
    };

    try {
      const stored = JSON.parse(getSetting('shopify.oauthState', 'null') ?? 'null');
      const providedState = String(req.query.state ?? '');
      if (!stored || stored.expiresAt < Date.now() || stored.state !== providedState) {
        log.warn('rejected oauth callback: bad or expired state');
        return backToDashboard('error', 'Session de connexion expirée, réessaie.');
      }
      setSetting('shopify.oauthState', null);

      const settings = getSettings();
      if (!verifyOAuthCallback(req.query, settings['shopify.apiSecret'])) {
        log.warn('rejected oauth callback: bad HMAC');
        return backToDashboard('error', 'Signature invalide.');
      }

      const shop = normalizeShopDomain(req.query.shop);
      if (!shop) throw badRequest('Paramètre "shop" manquant');

      const token = await exchangeCodeForToken({ shop, code: String(req.query.code ?? '') });

      updateSettings({
        'shopify.shopDomain': shop,
        'shopify.accessToken': token.access_token,
        'shopify.enabled': true,
      });

      log.info('shopify store connected', { shop, scope: token.scope });
      return backToDashboard('connected');
    } catch (error) {
      log.error('oauth callback failed', { error: error.message });
      return backToDashboard('error', error.message);
    }
  }),
);

/** Déconnexion rapide : efface le token pour forcer une nouvelle autorisation. */
shopifyOAuthRouter.post(
  '/disconnect',
  asyncRoute((req, res) => {
    const result = updateSettings({ 'shopify.accessToken': null });
    res.json(result);
  }),
);
