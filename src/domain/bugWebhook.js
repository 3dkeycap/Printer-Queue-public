import { config } from '../config.js';
import { getSetting as getStored, setSetting } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { normalizeBaseUrl } from './inventory.service.js';
import { getSettings } from './settings.service.js';

const log = createLogger('bug-webhook');

const LAST_KEY = 'internal.bugWebhookLast';
const TIMEOUT_MS = 8000;

/**
 * Webhook HTTP « nouveau bug » : à chaque signalement (bouton coccinelle) l'app
 * appelle en POST l'adresse réglée dans Réglages → Mises à jour. Le corps est
 * du JSON ; `text` et `content` portent le même résumé lisible, ce qui suffit
 * à Slack / Mattermost (`text`) et Discord (`content`) ; Zapier, n8n ou un
 * script lisent `bug`. Best-effort : un webhook en panne ne bloque jamais un
 * signalement (la personne n'attend pas, et le bug est de toute façon gardé).
 */
const base = () => normalizeBaseUrl(getSettings()['inventory.scanUrl']);

const oneLine = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/** Corps envoyé pour un bug (jamais la capture d'écran elle-même : un lien). */
export const bugWebhookPayload = (bug, { event = 'bug.created' } = {}) => {
  const root = base();
  const summary = `🐞 Bug #${bug.id} signalé${bug.reporter ? ` par ${bug.reporter}` : ''} — ${oneLine(bug.description, 300)}`;
  const text = `${summary}\n${root}/#integrations`;
  return {
    event,
    app: '3D Keycap Lab',
    text,
    content: text,
    bug: {
      id: bug.id,
      status: bug.status ?? 'open',
      reporter: bug.reporter ?? null,
      description: bug.description,
      page: bug.page ?? null,
      version: bug.context?.build ?? config.buildId,
      created_at: bug.created_at,
      has_screenshot: Boolean(bug.screenshot),
      links: {
        report_markdown: `${root}/api/bugs/${bug.id}/claude.md`,
        screenshot: bug.screenshot ? `${root}/api/bugs/${bug.id}/screenshot` : null,
        dashboard: `${root}/#integrations`,
      },
    },
  };
};

/** Dernier envoi : { at, ok, status, error, bugId } ou null (affiché dans les réglages). */
export const lastBugWebhook = () => {
  try {
    return JSON.parse(getStored(LAST_KEY) ?? 'null');
  } catch {
    return null;
  }
};

const validUrl = (value) => {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

/** POST du corps vers `url` ; renvoie { ok, status?, error? } sans jamais lever d'exception. */
const post = async (url, payload) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': '3d-keycap-lab-webhook' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `Le serveur a répondu ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.name === 'AbortError' ? `Pas de réponse en ${TIMEOUT_MS / 1000} s` : error.message };
  } finally {
    clearTimeout(timer);
  }
};

/** Prévient le webhook d'un nouveau bug (un 2e essai après 2 s en cas d'échec). */
export const notifyBugWebhook = async (bug) => {
  const url = validUrl(getSettings()['bugs.webhookUrl']);
  if (!url) return null;
  const payload = bugWebhookPayload(bug);
  let result = await post(url, payload);
  if (!result.ok) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    result = await post(url, payload);
  }
  setSetting(LAST_KEY, JSON.stringify({ ...result, at: new Date().toISOString(), bugId: bug.id }));
  if (result.ok) log.info('bug webhook sent', { bugId: bug.id, status: result.status });
  else log.warn('bug webhook failed', { bugId: bug.id, error: result.error });
  return result;
};

/** Bouton « Tester » : envoie un faux bug à l'adresse donnée (ou à celle enregistrée). */
export const testBugWebhook = async (typedUrl) => {
  const url = validUrl(typedUrl || getSettings()['bugs.webhookUrl']);
  if (!url) return { ok: false, error: "Aucune adresse valide (elle doit commencer par http:// ou https://)" };
  const payload = bugWebhookPayload(
    { id: 0, reporter: 'Test', description: 'Ceci est un test du webhook : aucun vrai bug n’a été signalé.', status: 'open', created_at: new Date().toISOString(), context: { build: config.buildId } },
    { event: 'bug.test' },
  );
  const result = await post(url, payload);
  setSetting(LAST_KEY, JSON.stringify({ ...result, at: new Date().toISOString(), bugId: null, test: true }));
  return result;
};
