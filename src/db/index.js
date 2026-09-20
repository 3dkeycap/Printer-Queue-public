import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('db');

let instance = null;

/**
 * Opens (once per process) the SQLite database.
 * WAL + busy_timeout let the API container and the worker container share the
 * same file on the mounted volume without "database is locked" errors.
 */
export const getDb = () => {
  if (instance) return instance;

  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  instance = new Database(config.databasePath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('synchronous = NORMAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');

  log.info('database ready', { path: config.databasePath });
  return instance;
};

export const closeDb = () => {
  if (!instance) return;
  instance.close();
  instance = null;
};

export const nowIso = () => new Date().toISOString();

/** Runs `fn` inside a transaction (better-sqlite3 transactions are synchronous). */
export const transaction = (fn) => getDb().transaction(fn);

export const getSetting = (key, fallback = null) => {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};

export const setSetting = (key, value) => {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value === null || value === undefined ? null : String(value), nowIso());
};
