import crypto from 'node:crypto';
import { Router } from 'express';
import { getSetting, setSetting } from '../db/index.js';
import { connectorStatus, describeSettings, getSettings } from '../domain/settings.service.js';
import { asyncRoute } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { normalizeBaseUrl } from '../lib/url.js';
import {
  OAUTH_STATE_TTL_MS,
  buildAuthorizeUrl,
  clearEtsyToken,
  completeOAuthConnection,
  exchangeCodeForToken,
  generatePkce,
} from '../integrations/etsyOAuth.js';

const log = createLogger('etsy:oauth');
export const etsyOAuthRouter = Router();

/**
 * Étape 1 : le marchand clique « Connecter via OAuth » dans Intégrations.
 * Navigation plein écran (pas un fetch) vers l'écran d'autorisation Etsy.
 */
etsyOAuthRouter.get(
  '/start',
  asyncRoute((req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePkce();
    setSetting(
      'etsy.oauthState',
      JSON.stringify({ state, verifier, expiresAt: Date.now() + OAUTH_STATE_TTL_MS }),
    );
    res.redirect(buildAuthorizeUrl(state, challenge));
  }),
);

/**
 * Étape 2-3 : Etsy redirige ici avec `code` + `state`. On vérifie le state
 * anti-CSRF, échange le code (avec le vérifieur PKCE conservé à l'étape 1)
 * contre un token, puis on renvoie le navigateur vers le dashboard.
 */
etsyOAuthRouter.get(
  '/callback',
  asyncRoute(async (req, res) => {
    const backToDashboard = (status, message) => {
      const url = new URL(`${normalizeBaseUrl(getSettings()['app.publicUrl'])}/`);
      url.hash = 'integrations';
      url.searchParams.set('etsy_status', status);
      if (message) url.searchParams.set('etsy_message', message);
      res.redirect(url.toString());
    };

    if (req.query.error) {
      log.warn('etsy authorization denied', { error: req.query.error });
      return backToDashboard('error', String(req.query.error_description || req.query.error));
    }

    try {
      const stored = JSON.parse(getSetting('etsy.oauthState', 'null') ?? 'null');
      const providedState = String(req.query.state ?? '');
      if (!stored || stored.expiresAt < Date.now() || stored.state !== providedState) {
        log.warn('rejected oauth callback: bad or expired state');
        return backToDashboard('error', 'Session de connexion expirée, réessaie.');
      }
      setSetting('etsy.oauthState', null);

      const token = await exchangeCodeForToken({
        code: String(req.query.code ?? ''),
        codeVerifier: stored.verifier,
      });
      completeOAuthConnection(token);

      log.info('etsy shop connected');
      return backToDashboard('connected');
    } catch (error) {
      log.error('oauth callback failed', { error: error.message });
      return backToDashboard('error', error.message);
    }
  }),
);

/** Déconnexion rapide : efface le token pour forcer une nouvelle autorisation. */
etsyOAuthRouter.post(
  '/disconnect',
  asyncRoute((req, res) => {
    clearEtsyToken();
    res.json({ settings: describeSettings(), connectors: connectorStatus() });
  }),
);
