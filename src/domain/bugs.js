import { config } from '../config.js';
import { getDb, nowIso } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { createLogger, recentLogs } from '../lib/logger.js';
import { notifyBugWebhook } from './bugWebhook.js';

const log = createLogger('bugs');

/**
 * Bugs signalés depuis le bouton coccinelle : ce que la personne explique,
 * une capture d'écran, les journaux du navigateur et du serveur, et le
 * contexte (page, version, dernières synchros). Consultables dans
 * Réglages → Mises à jour, et exportables tels quels pour Claude.
 */

const MAX_SCREENSHOT = 12 * 1024 * 1024;
const parse = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const recentRuns = () =>
  getDb()
    .prepare(
      `SELECT source, trigger, status, started_at, duration_ms, orders_seen, orders_created, parts_created, message
         FROM sync_runs ORDER BY id DESC LIMIT 15`,
    )
    .all();

export const createBugReport = ({ reporter, description, page, screenshot, clientLogs, context } = {}) => {
  const text = String(description ?? '').trim();
  if (!text) throw badRequest('Explique ce qui se passe');
  let image = null;
  if (screenshot) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(String(screenshot))) throw badRequest('Capture invalide');
    if (String(screenshot).length > MAX_SCREENSHOT) throw badRequest('Capture trop lourde');
    image = String(screenshot);
  }
  const fullContext = {
    ...(context && typeof context === 'object' ? context : {}),
    build: config.buildId,
    serverTime: nowIso(),
    recentSyncRuns: recentRuns(),
  };
  const info = getDb()
    .prepare(
      `INSERT INTO bug_reports (reporter, description, page, screenshot, client_logs, server_logs, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(reporter ?? '').trim().slice(0, 60) || null,
      text.slice(0, 5000),
      String(page ?? '').slice(0, 300) || null,
      image,
      JSON.stringify(Array.isArray(clientLogs) ? clientLogs.slice(-300) : []),
      JSON.stringify(recentLogs().slice(-300)),
      JSON.stringify(fullContext),
      nowIso(),
    );
  log.warn('bug reported', { id: Number(info.lastInsertRowid), reporter, page });
  const bug = getBugReport(info.lastInsertRowid);
  // webhook HTTP en tâche de fond : la personne n'attend pas, et une panne n'empêche rien
  notifyBugWebhook(bug).catch((error) => log.warn('bug webhook crashed', { error: error.message }));
  return bug;
};

export const listBugReports = () =>
  getDb()
    .prepare(
      `SELECT id, reporter, description, page, status, created_at, resolved_at, screenshot IS NOT NULL AS has_screenshot
         FROM bug_reports ORDER BY status = 'resolved', id DESC LIMIT 200`,
    )
    .all()
    .map((row) => ({ ...row, has_screenshot: Boolean(row.has_screenshot) }));

export const getBugReport = (id) => {
  const row = getDb().prepare('SELECT * FROM bug_reports WHERE id = ?').get(Number(id));
  if (!row) throw notFound(`Bug ${id} introuvable`);
  return {
    ...row,
    client_logs: parse(row.client_logs, []),
    server_logs: parse(row.server_logs, []),
    context: parse(row.context, {}),
  };
};

export const setBugStatus = (id, status) => {
  if (!['open', 'resolved'].includes(status)) throw badRequest('Statut : open ou resolved');
  const info = getDb()
    .prepare('UPDATE bug_reports SET status = ?, resolved_at = ? WHERE id = ?')
    .run(status, status === 'resolved' ? nowIso() : null, Number(id));
  if (!info.changes) throw notFound(`Bug ${id} introuvable`);
  return getBugReport(id);
};

export const deleteBugReport = (id) => {
  const info = getDb().prepare('DELETE FROM bug_reports WHERE id = ?').run(Number(id));
  if (!info.changes) throw notFound(`Bug ${id} introuvable`);
  return { deleted: Number(id) };
};

/** Le rapport en texte (Markdown), prêt à coller dans une conversation avec Claude. */
export const bugReportForClaude = (id) => {
  const bug = getBugReport(id);
  const lines = (entries, max) =>
    entries
      .slice(-max)
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join('\n');
  return [
    `# Bug #${bug.id} — 3D Keycap Lab`,
    '',
    `- Signalé par : ${bug.reporter ?? 'inconnu'}`,
    `- Le : ${bug.created_at}`,
    `- Page : ${bug.page ?? '—'}`,
    `- Version : ${bug.context.build ?? '—'}`,
    `- Capture d'écran : ${bug.screenshot ? 'oui (jointe séparément)' : 'non'}`,
    '',
    '## Ce que la personne explique',
    '',
    bug.description,
    '',
    '## Contexte',
    '',
    '```json',
    JSON.stringify(bug.context, null, 2),
    '```',
    '',
    '## Journal du navigateur (erreurs, requêtes, actions)',
    '',
    '```',
    lines(bug.client_logs, 200) || '(vide)',
    '```',
    '',
    '## Journal du serveur',
    '',
    '```',
    lines(bug.server_logs, 200) || '(vide)',
    '```',
  ].join('\n');
};
