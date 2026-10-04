/*
 * Resin Queue — extension Chrome.
 *
 * Suit les onglets de l'admin Shopify. Quand un onglet affiche une commande
 * (/orders/<id>), on prévient l'app (« ouvert sur Shopify ») puis on envoie un
 * signe de vie toutes les 30 s. On prévient la fermeture quand :
 *   - l'onglet change de page (autre commande, liste, autre site...) ;
 *   - l'onglet est fermé ;
 *   - la même page est ouverte depuis plus de 30 minutes.
 * L'app expire aussi d'elle-même au bout de 90 s sans signe de vie
 * (navigateur fermé, ordinateur en veille).
 */

const MAX_OPEN_MS = 30 * 60 * 1000;
const ORDER_URL = [
  /^https:\/\/admin\.shopify\.com\/store\/[^/]+\/orders\/(\d+)/,
  /^https:\/\/[^/]+\.myshopify\.com\/admin\/orders\/(\d+)/,
];

const orderIdFromUrl = (url) => {
  for (const pattern of ORDER_URL) {
    const match = pattern.exec(url ?? '');
    if (match) return match[1];
  }
  return null;
};

/* ---------------------------------------------------------------- réglages */

/** Adresse de l'app pré-remplie quand l'extension est téléchargée depuis l'app. */
const loadDefaults = async () => {
  try {
    const response = await fetch(chrome.runtime.getURL('defaults.json'));
    return response.ok ? await response.json() : {};
  } catch {
    return {};
  }
};

const DEFAULT_CHITCHATS_TEMPLATE = 'https://chitchats.com/clients/{clientId}/shipments/search?locale=en&q={order}';

/**
 * Lien Chit Chats d'une commande, construit par l'extension elle-même : il
 * marche même si l'app est injoignable (Client ID dans les réglages de
 * l'extension, pré-rempli quand elle est téléchargée depuis l'app).
 */
const buildChitChatsUrl = async (orderNumber) => {
  const defaults = await loadDefaults();
  const { chitchatsClientId = defaults.chitchatsClientId ?? '' } = await chrome.storage.sync.get('chitchatsClientId');
  const order = String(orderNumber ?? '').replace(/^#/, '').trim();
  if (!order || !chitchatsClientId) return null;
  return (defaults.chitchatsTemplate || DEFAULT_CHITCHATS_TEMPLATE)
    .replaceAll('{order}', encodeURIComponent(order))
    .replaceAll('{clientId}', encodeURIComponent(chitchatsClientId));
};

const getConfig = async () => {
  const defaults = await loadDefaults();
  const { appUrl = defaults.appUrl ?? '', user = '', authUser = '', authPassword = '', clientId } = await chrome.storage.sync.get([
    'appUrl',
    'user',
    'authUser',
    'authPassword',
    'clientId',
  ]);
  let id = clientId;
  if (!id) {
    id = crypto.randomUUID();
    await chrome.storage.sync.set({ clientId: id });
  }
  return { appUrl: appUrl.replace(/\/+$/, ''), user, authUser, authPassword, clientId: id };
};

/* ------------------------------------------- onglets suivis (survit au réveil) */

const loadTabs = async () => (await chrome.storage.session.get('tabs')).tabs ?? {};
const saveTabs = (tabs) => chrome.storage.session.set({ tabs });

// onglets arrêtés après 30 min : on ne les re-signale pas tant qu'ils restent sur la même commande
const loadExpired = async () => (await chrome.storage.session.get('expired')).expired ?? {};
const saveExpired = (expired) => chrome.storage.session.set({ expired });

// les événements arrivent en rafale (onUpdated + script de la page) : un seul traitement à la fois
let queue = Promise.resolve();
const serial = (task) => {
  queue = queue.then(task, task);
  return queue;
};

/* ----------------------------------------------------------------- appel app */

/** Appel à l'app (adresse + mot de passe des réglages). Renvoie le JSON, ou { error }. */
const appFetch = async (path, { method = 'GET', body } = {}) => {
  const config = await getConfig();
  if (!config.appUrl) return { error: "Adresse de l'app non configurée (Réglages de l'extension)" };
  const headers = { 'Content-Type': 'application/json' };
  if (config.authPassword) headers.Authorization = `Basic ${btoa(`${config.authUser || 'admin'}:${config.authPassword}`)}`;
  try {
    const response = await fetch(`${config.appUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { error: payload.error ?? `Erreur ${response.status}` };
    return payload;
  } catch (error) {
    return { error: `App injoignable (${error.message})` };
  }
};

const report = async (tabId, orderExternalId, state) => {
  const config = await getConfig();
  return appFetch('/api/presence/shopify', {
    method: 'POST',
    body: { clientId: config.clientId, tabId, orderExternalId, user: config.user, state },
  });
};

const tellPage = (tabId, message) => chrome.tabs.sendMessage(tabId, message).catch(() => {});

const open = async (tabId, orderExternalId) => {
  const expired = await loadExpired();
  if (expired[tabId] === orderExternalId) return;
  const tabs = await loadTabs();
  const current = tabs[tabId];
  // déjà signalée avec succès : rien à refaire (sinon on retente tout de suite)
  if (current?.orderExternalId === orderExternalId && current.app && !current.app.error) return;
  const sameOrder = current?.orderExternalId === orderExternalId;
  if (current && !sameOrder) await report(tabId, current.orderExternalId, 'close');
  tabs[tabId] = { orderExternalId, openedAt: sameOrder ? current.openedAt : Date.now() };
  await saveTabs(tabs);
  const result = await report(tabId, orderExternalId, 'open');
  await remember(tabId, result);
  tellPage(tabId, { type: 'presence', orderExternalId, ...result });
};

/** Garde la dernière réponse de l'app pour l'onglet (numéro de commande, lien Chit Chats). */
const remember = async (tabId, result) => {
  const tabs = await loadTabs();
  if (!tabs[tabId]) return;
  tabs[tabId].app = result;
  await saveTabs(tabs);
  // l'onglet Chit Chats lié affiche l'état de l'import de cette commande
  const link = await getLink();
  if (link?.shopifyTabId === tabId) await broadcastLink();
};

const close = async (tabId, { notifyPage = false, expire = false } = {}) => {
  const tabs = await loadTabs();
  const current = tabs[tabId];
  const expired = await loadExpired();
  if (expire && current) expired[tabId] = current.orderExternalId;
  else if (!expire && tabId in expired) delete expired[tabId];
  await saveExpired(expired);
  if (!current) return;
  delete tabs[tabId];
  await saveTabs(tabs);
  await report(tabId, current.orderExternalId, 'close');
  if (notifyPage) tellPage(tabId, { type: 'presence', open: false, expired: true });
};

const handleUrl = (tabId, url) =>
  serial(async () => {
    const orderExternalId = orderIdFromUrl(url);
    if (orderExternalId) {
      // autre commande que celle expirée : la limite des 30 min repart de zéro
      const expired = await loadExpired();
      if (expired[tabId] && expired[tabId] !== orderExternalId) {
        delete expired[tabId];
        await saveExpired(expired);
      }
      await open(tabId, orderExternalId);
    } else {
      await close(tabId);
    }
  });

/* ------------------------------------------------------------- événements */

// l'admin Shopify est une appli « une seule page » : l'URL change sans recharger
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status === 'complete') handleUrl(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  serial(() => close(tabId));
  unlinkIfInvolved(tabId);
});

/* ------------------------------------------------- lien live Shopify → Chit Chats
 * Deux onglets côte à côte : quand le lien est « live », chaque commande
 * ouverte dans l'onglet Shopify s'affiche dans l'onglet Chit Chats (sens
 * unique). Étapes : « Link » sur Shopify → « Link » sur l'onglet Chit Chats
 * choisi → live ; « Stop live » sur Shopify (ou fermer un des onglets) coupe.
 */

const getLink = async () => (await chrome.storage.session.get('link')).link ?? null;
const setLink = (link) => chrome.storage.session.set({ link });

const chitchatsTabs = () => chrome.tabs.query({ url: 'https://chitchats.com/*' }).catch(() => []);

/** Prévient tous les onglets concernés pour qu'ils redessinent leurs boutons. */
const broadcastLink = async () => {
  const link = await getLink();
  const targets = new Set((await chitchatsTabs()).map((tab) => tab.id));
  if (link?.shopifyTabId) targets.add(link.shopifyTabId);
  for (const id of targets) tellPage(id, { type: 'link-changed', link });
};

const unlinkIfInvolved = async (tabId) => {
  const link = await getLink();
  if (link && (link.shopifyTabId === tabId || link.chitchatsTabId === tabId)) {
    await setLink(null);
    await broadcastLink();
  }
};

/** Affiche la commande dans l'onglet Chit Chats lié (si elle a changé). */
const followOrder = async (orderNumber) => {
  const link = await getLink();
  if (link?.state !== 'live' || !orderNumber) return;
  const url = await buildChitChatsUrl(orderNumber);
  if (!url || link.lastOrder === orderNumber) return;
  try {
    await chrome.tabs.update(link.chitchatsTabId, { url });
    await setLink({ ...link, lastOrder: orderNumber });
  } catch {
    // l'onglet Chit Chats n'existe plus
    await setLink(null);
    await broadcastLink();
  }
};

const handleLinkMessage = async (message, sender) => {
  const tabId = sender.tab?.id;
  const link = await getLink();
  switch (message.type) {
    case 'link-status':
      return {
        link,
        tabId,
        // ce que l'app sait de la commande ouverte dans l'onglet Shopify lié (import Chit Chats…)
        shopifyApp: link?.shopifyTabId ? (await loadTabs())[link.shopifyTabId]?.app ?? null : null,
      };
    case 'link-start': // depuis l'onglet Shopify
      await setLink({ state: 'pending', shopifyTabId: tabId, chitchatsTabId: null, lastOrder: null });
      await broadcastLink();
      if (!(await chitchatsTabs()).length) return { warning: 'Ouvre un onglet Chit Chats à côté, puis clique « Link » dedans.' };
      return { ok: true };
    case 'link-accept': // depuis l'onglet Chit Chats choisi
      if (link?.state !== 'pending') return { error: 'Clique d\'abord « Link » sur la page Shopify.' };
      await setLink({ ...link, state: 'live', chitchatsTabId: tabId, lastOrder: null });
      await broadcastLink();
      // la commande ouverte en ce moment s'affiche tout de suite
      tellPage(link.shopifyTabId, { type: 'link-sync' });
      return { ok: true };
    case 'link-stop':
      await setLink(null);
      await broadcastLink();
      return { ok: true };
    case 'link-order': // l'onglet Shopify affiche une (autre) commande
      if (link?.state === 'live' && link.shopifyTabId === tabId) await followOrder(message.orderNumber);
      return { ok: true };
    default:
      return null;
  }
};

// le script de la page signale aussi ses changements d'URL (plus fiable dans une SPA)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'url' && sender.tab?.id !== undefined) handleUrl(sender.tab.id, message.url);
  // fenêtre « J'ai packé » : lecture / enregistrement / nouvelle personne
  if (message?.type === 'pack-get') {
    appFetch(`/api/packing/shopify/${encodeURIComponent(message.orderExternalId)}`).then(sendResponse);
    return true;
  }
  if (message?.type === 'pack-save') {
    appFetch(`/api/packing/shopify/${encodeURIComponent(message.orderExternalId)}`, { method: 'POST', body: message.body }).then(sendResponse);
    return true;
  }
  if (message?.type === 'packer-add') {
    appFetch('/api/packing/packers', { method: 'POST', body: { name: message.name } }).then(sendResponse);
    return true;
  }
  if (String(message?.type ?? '').startsWith('link-')) {
    handleLinkMessage(message, sender).then(sendResponse);
    return true;
  }
  // numéro de commande + lien Chit Chats, pour le bouton de la page et la fenêtre de l'extension
  if (message?.type === 'resolve') {
    const tabId = message.tabId ?? sender.tab?.id;
    (async () => {
      const entry = (await loadTabs())[tabId] ?? null;
      const app = entry?.app ?? null;
      const orderNumber = message.pageOrderNumber || app?.orderNumber || null;
      const chitchatsUrl = (await buildChitChatsUrl(orderNumber)) || app?.chitchatsUrl || null;
      sendResponse({
        orderNumber,
        chitchatsUrl,
        tracked: Boolean(entry),
        app: app ? (app.error ? { error: app.error } : { ok: true, known: app.known }) : null,
      });
    })();
    return true;
  }
  return false;
});

// signe de vie + limite des 30 minutes
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
// nouvelle version sur GitHub ? (affichée dans la fenêtre de l'extension)
chrome.alarms.create('update-check', { periodInMinutes: 360, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') serial(heartbeat);
  if (alarm.name === 'update-check') checkForUpdate();
});

const checkForUpdate = async () => {
  try {
    const url = `https://raw.githubusercontent.com/3dkeycap/Printer-Queue-public/main/chrome-extension/manifest.json?t=${Date.now()}`;
    const remote = (await (await fetch(url, { cache: 'no-store' })).json()).version;
    const local = chrome.runtime.getManifest().version;
    const isNewer = remote.split('.').map(Number).some((n, i, all) => {
      const l = local.split('.').map(Number);
      return all.slice(0, i).every((m, j) => m === (l[j] ?? 0)) && n > (l[i] ?? 0);
    });
    await chrome.storage.local.set({ updateAvailable: isNewer ? remote : null });
    chrome.action.setBadgeText({ text: isNewer ? '↑' : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d99a1c' });
  } catch {
    /* hors ligne : on réessaiera */
  }
};

async function heartbeat() {
  const tabs = await loadTabs();
  for (const [tabId, entry] of Object.entries(tabs)) {
    const id = Number(tabId);
    if (Date.now() - entry.openedAt >= MAX_OPEN_MS) {
      await close(id, { notifyPage: true, expire: true });
      continue;
    }
    // l'onglet a pu disparaître pendant que le service worker dormait
    const tab = await chrome.tabs.get(id).catch(() => null);
    if (!tab || orderIdFromUrl(tab.url) !== entry.orderExternalId) {
      await close(id);
      continue;
    }
    const result = await report(id, entry.orderExternalId, 'open');
    await remember(id, result);
    tellPage(id, { type: 'presence', orderExternalId: entry.orderExternalId, ...result });
  }
}
