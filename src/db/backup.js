import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, getSetting, setSetting } from './index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('backup');

const BUILD_KEY = 'internal.lastBuildId';
const FILE_RE = /^printer-queue-.*\.db$/;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/** Liste les sauvegardes, la plus récente en premier. */
export const listBackups = () => {
  if (!fs.existsSync(config.backup.dir)) return [];
  return fs
    .readdirSync(config.backup.dir)
    .filter((name) => FILE_RE.test(name))
    .map((name) => {
      const file = path.join(config.backup.dir, name);
      const stat = fs.statSync(file);
      return { name, path: file, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
};

/**
 * Copie cohérente de la base (VACUUM INTO : sûr même pendant que le worker
 * écrit, WAL compris), puis ne garde que les `keep` plus récentes.
 */
export const backupDatabase = ({ reason = 'manual', keep = config.backup.keep } = {}) => {
  fs.mkdirSync(config.backup.dir, { recursive: true });
  const safeReason = String(reason).replace(/[^a-z0-9-]+/gi, '-').slice(0, 40) || 'manual';
  let file = path.join(config.backup.dir, `printer-queue-${stamp()}-${safeReason}.db`);
  if (fs.existsSync(file)) file = file.replace(/\.db$/, `-${process.pid}.db`);

  getDb().prepare('VACUUM INTO ?').run(file);

  const removed = [];
  for (const old of listBackups().slice(Math.max(keep, 1))) {
    fs.rmSync(old.path, { force: true });
    removed.push(old.name);
  }

  log.info('database backup written', { file, reason: safeReason, removed: removed.length });
  return { file, removed };
};

/**
 * Au premier démarrage d'une nouvelle version, on sauvegarde la base AVANT
 * les migrations : quoi qu'il arrive pendant la mise à jour, les données de
 * la version précédente restent récupérables. Une base neuve n'est pas copiée.
 */
export const backupBeforeUpgrade = () => {
  try {
    const db = getDb();
    const hasSettings = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'`)
      .get();
    if (!hasSettings) return null;

    const previous = getSetting(BUILD_KEY);
    if (previous === config.buildId) return null;

    const hasData = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'parts'`).get()
      && db.prepare('SELECT 1 FROM parts LIMIT 1').get();
    const result = hasData ? backupDatabase({ reason: `before-${config.buildId}` }) : null;
    if (result) log.info('new version detected, data backed up', { from: previous ?? 'unknown', to: config.buildId });
    return result;
  } catch (error) {
    // une sauvegarde ratée ne doit jamais empêcher l'atelier de travailler
    log.error('automatic backup failed', { error: error.message });
    return null;
  }
};

export const recordBuild = () => setSetting(BUILD_KEY, config.buildId);
