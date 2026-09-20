import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/** /api/integrations/<provider>/oauth/... */
const OAUTH_CALLBACK_PATH = /^\/api\/integrations\/[^/]+\/oauth(\/|$)/;

/**
 * Optional HTTP Basic auth: enabled only when DASHBOARD_PASSWORD is set.
 * Webhooks are exempt (they carry their own secret/HMAC), and so is every
 * provider's OAuth callback (Shopify, Etsy...): it's a top-level redirect
 * initiated by the provider's own server, not the dashboard's authenticated
 * session, and each one carries its own protection (anti-CSRF state, plus
 * an HMAC signature for Shopify / a PKCE verifier for Etsy).
 */
export const basicAuth = (req, res, next) => {
  if (!config.auth.enabled) return next();
  if (
    req.path.startsWith('/api/webhooks') ||
    OAUTH_CALLBACK_PATH.test(req.path) ||
    req.path === '/api/health'
  ) {
    return next();
  }

  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const [user, password] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
    if (user && password && safeEqual(user, config.auth.user) && safeEqual(password, config.auth.password)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Resin Print Queue", charset="UTF-8"');
  return res.status(401).json({ error: 'Authentication required' });
};
