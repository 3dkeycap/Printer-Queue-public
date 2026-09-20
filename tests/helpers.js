import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Points the app at a throw-away SQLite file.
 * Must run BEFORE any dynamic import of src/, since config.js reads env once.
 */
export const useTempDb = (name = 'rpq') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  process.env.DATABASE_PATH = path.join(dir, 'test.db');
  process.env.INTEGRATION_MODE = 'mock';
  process.env.LOG_LEVEL = 'error';
  process.env.SYNC_RUN_ON_BOOT = 'false';
  return dir;
};

export const makeOrder = (overrides = {}) => ({
  source: 'shopify',
  externalId: '1001',
  orderNumber: '#1001',
  customerName: 'Alex Tremblay',
  placedAt: '2026-01-05T10:00:00.000Z',
  items: [
    {
      externalId: 'li-1',
      title: 'Keycap "Kraken"',
      sku: 'KC-KRAKEN-R1',
      variantTitle: 'Glow in the dark / R1',
      quantity: 3,
      unitPrice: 55,
    },
  ],
  ...overrides,
});
