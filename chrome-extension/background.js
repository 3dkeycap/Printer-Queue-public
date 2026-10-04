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

const getConfig = async () => {
  const { appUrl = '', user = '', authUser = '', authPassword = '', clientId } = await chrome.storage.sync.get([
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

const report = async (tabId, orderExternalId, state) => {
  const config = await getConfig();
  if (!config.appUrl) return { error: 'App non configurée' };
  const headers = { 'Content-Type': 'application/json' };
  if (config.authPassword) headers.Authorization = `Basic ${btoa(`${config.authUser || 'admin'}:${config.authPassword}`)}`;
  try {
    const response = await fetch(`${config.appUrl}/api/presence/shopify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clientId: config.clientId, tabId, orderExternalId, user: config.user, state }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { error: payload.error ?? `Erreur ${response.status}` };
    return payload;
  } catch (error) {
    return { error: `App injoignable (${error.message})` };
  }
};

const tellPage = (tabId, message) => chrome.tabs.sendMessage(tabId, message).catch(() => {});

const open = async (tabId, orderExternalId) => {
  const expired = await loadExpired();
  if (expired[tabId] === orderExternalId) return;
  const tabs = await loadTabs();
  const current = tabs[tabId];
  if (current?.orderExternalId === orderExternalId) return; // déjà signalée
  if (current) await report(tabId, current.orderExternalId, 'close');
  tabs[tabId] = { orderExternalId, openedAt: Date.now() };
  await saveTabs(tabs);
  const result = await report(tabId, orderExternalId, 'open');
  tellPage(tabId, { type: 'presence', orderExternalId, ...result });
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
chrome.tabs.onRemoved.addListener((tabId) => serial(() => close(tabId)));

// le script de la page signale aussi ses changements d'URL (plus fiable dans une SPA)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'url' && sender.tab?.id !== undefined) handleUrl(sender.tab.id, message.url);
  if (message?.type === 'hello' && sender.tab?.id !== undefined) {
    loadTabs().then((tabs) => sendResponse({ tracked: Boolean(tabs[sender.tab.id]) }));
    return true;
  }
  return false;
});

// signe de vie + limite des 30 minutes
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') serial(heartbeat);
});

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
    tellPage(id, { type: 'presence', orderExternalId: entry.orderExternalId, ...result });
  }
}
