import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  publicDir: path.join(rootDir, 'public'),
  databasePath: process.env.DATABASE_PATH || path.join(rootDir, 'data', 'printer-queue.db'),

  auth: {
    user: process.env.DASHBOARD_USER || 'admin',
    password: process.env.DASHBOARD_PASSWORD || '',
    get enabled() {
      return this.password.length > 0;
    },
  },

  integrations: {
    // 'mock' keeps the whole stack runnable without a single credential.
    mode: (process.env.INTEGRATION_MODE || 'mock').toLowerCase(),
    lookbackDays: int(process.env.SYNC_LOOKBACK_DAYS, 14),
  },

  jobs: {
    syncCron: process.env.SYNC_CRON || '*/5 * * * *',
    shipmentCron: process.env.SHIPMENT_CRON || '*/15 * * * *',
    runOnBoot: bool(process.env.SYNC_RUN_ON_BOOT, true),
  },

  shopify: {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
  },

  etsy: {
    shopId: process.env.ETSY_SHOP_ID || '',
    apiKey: process.env.ETSY_API_KEY || '',
    accessToken: process.env.ETSY_ACCESS_TOKEN || '',
    apiBase: process.env.ETSY_API_BASE || 'https://openapi.etsy.com/v3/application',
  },

  chitchats: {
    clientId: process.env.CHITCHATS_CLIENT_ID || '',
    accessToken: process.env.CHITCHATS_ACCESS_TOKEN || '',
    apiBase: process.env.CHITCHATS_API_BASE || 'https://chitchats.com/api/v1',
    webhookSecret: process.env.CHITCHATS_WEBHOOK_SECRET || '',
    shipAllParts: bool(process.env.SHIP_ALL_PARTS_ON_SHIPMENT, true),
  },
};

export const isMock = () => config.integrations.mode !== 'live';
