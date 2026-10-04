import 'dotenv/config';
import fs from 'node:fs';
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

/**
 * Identifiant de la version déployée : le commit Git passé au build
 * (scripts/update.sh), sinon l'empreinte du code calculée dans le Dockerfile.
 */
const readBuildId = () => {
  if (process.env.GIT_SHA && process.env.GIT_SHA !== 'unknown') return process.env.GIT_SHA;
  try {
    return fs.readFileSync(path.join(rootDir, 'BUILD_ID'), 'utf8').trim() || 'dev';
  } catch {
    return 'dev';
  }
};

const databasePath = process.env.DATABASE_PATH || path.join(rootDir, 'data', 'printer-queue.db');

export const config = {
  rootDir,
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  publicDir: path.join(rootDir, 'public'),
  databasePath,
  buildId: readBuildId(),

  // échange de fichiers avec le conteneur « updater » (même volume que la base)
  updaterDir: process.env.UPDATER_DIR || path.join(path.dirname(databasePath), 'updater'),

  // sauvegardes SQLite : dans le même volume que la base, rotation automatique
  backup: {
    dir: process.env.BACKUP_DIR || path.join(path.dirname(databasePath), 'backups'),
    keep: int(process.env.BACKUP_KEEP, 10),
  },

  auth: {
    user: process.env.DASHBOARD_USER || 'admin',
    password: process.env.DASHBOARD_PASSWORD || '',
    get enabled() {
      return this.password.length > 0;
    },
  },

  integrations: {
    // valeur initiale : tout est ensuite modifiable depuis la page Intégrations
    lookbackDays: int(process.env.SYNC_LOOKBACK_DAYS, 14),
  },

  jobs: {
    syncCron: process.env.SYNC_CRON || '*/5 * * * *',
    shipmentCron: process.env.SHIPMENT_CRON || '*/15 * * * *',
    runOnBoot: bool(process.env.SYNC_RUN_ON_BOOT, true),
  },

  shopify: {
    shopDomain: process.env.SHOPIFY_SHOP_DOMAIN || '',
    // Client ID / Client Secret de l'app OAuth (Partner Dashboard). Le secret
    // sert aussi à vérifier la signature HMAC des webhooks Shopify.
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
    scopes: process.env.SHOPIFY_SCOPES || 'read_orders',
    // Rempli automatiquement par le flux OAuth ; peut aussi être collé à la
    // main pour une app privée existante qui n'utilise pas OAuth.
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2024-10',
  },

  // URL publique de ce déploiement (reverse proxy compris), utilisée pour
  // construire l'URL de redirection OAuth. Ex: https://queue.3dkeycap.com
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),

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
