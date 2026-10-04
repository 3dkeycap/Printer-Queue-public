import { getDb } from '../db/index.js';
import { getSettings } from './settings.service.js';

/**
 * « Ouvert sur Shopify » : l'extension Chrome signale qu'une commande est
 * affichée dans l'admin Shopify. Gardé en mémoire seulement (ça ne survit pas
 * à un redémarrage, et c'est voulu) avec deux garde-fous :
 *  - sans signe de vie de l'extension depuis HEARTBEAT_TTL, c'est fini
 *    (navigateur fermé, ordinateur en veille...) ;
 *  - au-delà de MAX_OPEN sur la même page, on considère que la personne
 *    est partie, même si l'onglet est resté ouvert.
 */
export const HEARTBEAT_TTL = 90 * 1000;
export const MAX_OPEN = 30 * 60 * 1000;

// clé : `${clientId}:${tabId}` — un même navigateur peut avoir plusieurs onglets
const sessions = new Map();

const isAlive = (session, now) => now - session.lastSeen < HEARTBEAT_TTL && now - session.openedAt < MAX_OPEN;

const prune = (now = Date.now()) => {
  for (const [key, session] of sessions) if (!isAlive(session, now)) sessions.delete(key);
};

/** Lien vers la page d'expédition Chit Chats, construit depuis le modèle des réglages. */
export const chitchatsShipUrl = (orderNumber, settings = getSettings()) => {
  const template = String(settings['chitchats.shipUrlTemplate'] ?? '').trim();
  if (!template || !orderNumber) return null;
  const order = String(orderNumber).replace(/^#/, '');
  return template
    .replaceAll('{order}', encodeURIComponent(order))
    .replaceAll('{clientId}', encodeURIComponent(settings['chitchats.clientId'] ?? ''));
};

const findOrder = (externalId) =>
  getDb()
    .prepare(
      `SELECT id, order_number, customer_name, chitchats_import_status, chitchats_import_error, chitchats_shipment_id
         FROM orders WHERE source = 'shopify' AND external_id = ?`,
    )
    .get(String(externalId)) ?? null;

/**
 * Appelé par l'extension : state = open (ouverture ou signe de vie) | close.
 * Renvoie ce que l'extension peut afficher sur la page Shopify.
 */
export const reportShopify = ({ clientId, tabId, orderExternalId, user, state = 'open' }) => {
  const key = `${clientId ?? 'anon'}:${tabId ?? 0}`;
  const now = Date.now();

  if (state === 'close' || !orderExternalId) {
    sessions.delete(key);
    prune(now);
    return { open: false };
  }

  const existing = sessions.get(key);
  const sameOrder = existing && existing.orderExternalId === String(orderExternalId);
  const session = {
    orderExternalId: String(orderExternalId),
    user: String(user ?? '').trim().slice(0, 40) || null,
    openedAt: sameOrder ? existing.openedAt : now,
    lastSeen: now,
  };

  // 30 min sur la même commande : on n'affiche plus rien, même si l'extension insiste
  if (now - session.openedAt >= MAX_OPEN) {
    sessions.delete(key);
    return { open: false, expired: true };
  }
  sessions.set(key, session);
  prune(now);

  const order = findOrder(orderExternalId);
  return {
    open: true,
    known: Boolean(order),
    orderNumber: order?.order_number ?? null,
    customerName: order?.customer_name ?? null,
    chitchatsUrl: chitchatsShipUrl(order?.order_number ?? null),
    // pour expliquer dans l'onglet Chit Chats pourquoi la commande n'y est pas
    chitchatsImport: order
      ? {
          status: order.chitchats_import_status ?? null,
          error: order.chitchats_import_error ?? null,
          inChitChats: Boolean(order.chitchats_shipment_id),
        }
      : null,
  };
};

/** Commandes actuellement ouvertes sur Shopify, pour le tableau. */
export const listOpen = () => {
  const now = Date.now();
  prune(now);
  const settings = getSettings();
  const byOrder = new Map();
  for (const session of sessions.values()) {
    const order = findOrder(session.orderExternalId);
    if (!order) continue;
    const entry = byOrder.get(order.id) ?? {
      orderId: order.id,
      orderNumber: order.order_number,
      users: [],
      openedAt: session.openedAt,
      chitchatsUrl: chitchatsShipUrl(order.order_number, settings),
    };
    if (session.user && !entry.users.includes(session.user)) entry.users.push(session.user);
    entry.openedAt = Math.min(entry.openedAt, session.openedAt);
    byOrder.set(order.id, entry);
  }
  return [...byOrder.values()].map((entry) => ({ ...entry, openedAt: new Date(entry.openedAt).toISOString() }));
};

/** Pour les tests. */
export const resetPresence = () => sessions.clear();
