import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Optional HTTP Basic auth: enabled only when DASHBOARD_PASSWORD is set.
 * Webhooks are exempt (they carry their own secret/HMAC), and so is the
 * Shopify OAuth callback: it's a top-level redirect initiated by Shopify's
 * server, not the dashboard's own authenticated session, and it carries its
 * own protection (anti-CSRF state + HMAC signature).
 */
export const basicAuth = (req, res, next) => {
  if (!config.auth.enabled) return next();
  if (
    req.path.startsWith('/api/webhooks') ||
    req.path.startsWith('/api/integrations/shopify/oauth') ||
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
