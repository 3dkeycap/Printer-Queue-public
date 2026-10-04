import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { config } from './config.js';
import { basicAuth } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { createLogger } from './lib/logger.js';
import { colorsRouter } from './routes/colors.js';
import { etsyOAuthRouter } from './routes/etsyOAuth.js';
import { metaRouter } from './routes/meta.js';
import { ordersRouter } from './routes/orders.js';
import { partsRouter } from './routes/parts.js';
import { settingsRouter } from './routes/settings.js';
import { shopifyOAuthRouter } from './routes/shopifyOAuth.js';
import { statsRouter } from './routes/stats.js';
import { syncRouter } from './routes/sync.js';
import { systemRouter } from './routes/system.js';
import { webhooksRouter } from './routes/webhooks.js';

const log = createLogger('http');

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(
    express.json({
      limit: '2mb',
      // keep the raw body so the Shopify HMAC can be verified
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) {
        log.debug('request', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        });
      }
    });
    next();
  });

  app.use(basicAuth);

  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/integrations/shopify/oauth', shopifyOAuthRouter);
  app.use('/api/integrations/etsy/oauth', etsyOAuthRouter);
  app.use('/api', metaRouter);
  app.use('/api/parts', partsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/colors', colorsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api/system', systemRouter);

  app.use(express.static(config.publicDir, { extensions: ['html'], maxAge: '1h' }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown endpoint ${req.method} ${req.originalUrl}` });
  });

  // SPA fallback
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: config.publicDir });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) {
      log.error('unhandled error', { path: req.path, error: error.message, stack: error.stack });
    }
    res.status(status).json({
      error: error.message ?? 'Internal error',
      ...(error.details ? { details: error.details } : {}),
    });
  });

  return app;
};
