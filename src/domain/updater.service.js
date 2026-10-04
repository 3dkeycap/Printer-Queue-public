import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { conflict } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from './settings.service.js';

/**
 * Le conteneur de l'app n'a (volontairement) pas accès à Docker : c'est le
 * conteneur « updater » (scripts/updater.sh) qui reconstruit l'image. Les deux
 * se parlent par fichiers, dans le volume de données partagé :
 *
 *   config.env  app -> updater   réglages (token, dépôt, branche, auto, intervalle)
 *   request     app -> updater   « check » ou « update » demandé depuis le dashboard
 *   heartbeat   updater -> app   horodatage Unix, réécrit toutes les 5 s
 *   status      updater -> app   état de la dernière opération (clé=valeur)
 *   pending     updater -> app   commits disponibles (git log --oneline)
 *   update.log  updater -> app   sortie de la dernière vérification / mise à jour
 */
const log = createLogger('updater');

const file = (name) => path.join(config.updaterDir, name);
const ALIVE_MS = 60_000;

const readText = (name) => {
  try {
    return fs.readFileSync(file(name), 'utf8');
  } catch {
    return null;
  }
};

/** Valeur shell entre apostrophes, sans retour à la ligne. */
const shellQuote = (value) => `'${String(value ?? '').replace(/[\r\n]/g, '').replace(/'/g, `'\\''`)}'`;

export const writeUpdaterConfig = () => {
  try {
    const s = getSettings();
    const lines = [
      '# écrit par l\'app à chaque enregistrement des réglages « Mises à jour »',
      `RPQ_GITHUB_TOKEN=${shellQuote(s['update.githubToken'])}`,
      `RPQ_GITHUB_REPO=${shellQuote(s['update.githubRepo'])}`,
      `RPQ_UPDATE_BRANCH=${shellQuote(s['update.branch'])}`,
      `RPQ_AUTO_UPDATE=${s['update.autoEnabled'] ? 1 : 0}`,
      `RPQ_UPDATE_INTERVAL=${Math.max(5, Math.round(Number(s['update.intervalMinutes']) || 60)) * 60}`,
      '',
    ];
    fs.mkdirSync(config.updaterDir, { recursive: true });
    const tmp = file('config.env.tmp');
    fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
    fs.renameSync(tmp, file('config.env'));
  } catch (error) {
    log.error('cannot write updater config', { error: error.message });
  }
};

const parseStatus = (text) => {
  const status = {};
  for (const line of (text ?? '').split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) status[line.slice(0, index)] = line.slice(index + 1);
  }
  return status;
};

export const getUpdateStatus = () => {
  const heartbeat = Number.parseInt(readText('heartbeat') ?? '', 10);
  const heartbeatAt = Number.isFinite(heartbeat) ? new Date(heartbeat * 1000).toISOString() : null;
  const connected = Number.isFinite(heartbeat) && Date.now() - heartbeat * 1000 < ALIVE_MS;
  const status = parseStatus(readText('status'));
  const pending = (readText('pending') ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const logText = readText('update.log') ?? '';

  return {
    build: config.buildId,
    connected,
    heartbeatAt,
    requested: readText('request')?.trim() || null,
    state: status.state ?? null,
    message: status.message ?? null,
    current: status.current || null,
    latest: status.latest || null,
    at: status.at || null,
    pending,
    log: logText.split('\n').slice(-200).join('\n').trim(),
  };
};

export const requestUpdate = (action) => {
  const status = getUpdateStatus();
  if (!status.connected) {
    throw conflict(
      'Le service de mise à jour ne tourne pas. Sur le serveur : docker compose up -d updater',
    );
  }
  if (['updating', 'checking'].includes(status.state) || status.requested) {
    throw conflict('Une opération de mise à jour est déjà en cours');
  }
  writeUpdaterConfig();
  fs.writeFileSync(file('request'), `${action}\n`);
  log.info('update requested from the dashboard', { action });
  return getUpdateStatus();
};
