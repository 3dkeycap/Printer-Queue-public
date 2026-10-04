import { getDb, nowIso } from '../db/index.js';
import { ApiError, requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from './settings.service.js';

const log = createLogger('chitchats:import');

/**
 * Import automatique des commandes Shopify / Etsy dans Chit Chats.
 *
 * Chaque commande ouverte (pas encore expédiée, pas encore dans Chit Chats)
 * devient un envoi « pending » chez Chit Chats : rien n'est acheté, il reste à
 * acheter l'étiquette là-bas. Si Chit Chats a déjà un envoi pour ce numéro de
 * commande (import natif Chit Chats, import précédent...), on se contente de
 * le relier.
 *
 * En cas d'échec, on cherche POURQUOI (adresse incomplète, province manquante,
 * accès refusé...) et on l'enregistre sur la commande : les pièces de la file
 * affichent alors l'étiquette « Chit Chats : <raison> ».
 */

const POSTAGE_BY_COUNTRY = { CA: 'chit_chats_canada_tracked', US: 'usps_ground_advantage' };
const INTERNATIONAL_POSTAGE = 'chit_chats_international_tracked';

const FIELD_LABELS = {
  name: 'nom du destinataire',
  address_1: 'adresse',
  city: 'ville',
  province_code: 'province / état',
  postal_code: 'code postal',
  country_code: 'pays',
  value: 'valeur déclarée',
  description: 'description',
  weight: 'poids',
  size_x: 'dimensions',
  size_y: 'dimensions',
  size_z: 'dimensions',
  postage_type: 'type d\'envoi',
  line_items: 'détail des articles (douane)',
  phone: 'téléphone',
};

const clean = (value) => (value === undefined || value === null ? '' : String(value).trim());

/** Adresse de livraison, quelle que soit la boutique. */
export const extractAddress = (source, raw) => {
  if (!raw) return null;
  if (source === 'shopify') {
    const a = raw.shipping_address;
    if (!a) return null;
    return {
      name: clean(a.name || [a.first_name, a.last_name].filter(Boolean).join(' ')),
      address_1: clean(a.address1),
      address_2: clean(a.address2),
      city: clean(a.city),
      province_code: clean(a.province_code),
      postal_code: clean(a.zip),
      country_code: clean(a.country_code).toUpperCase(),
      phone: clean(a.phone || raw.phone),
      email: clean(raw.email || raw.contact_email),
    };
  }
  if (source === 'etsy') {
    if (!raw.first_line && !raw.city && !raw.zip) return null;
    return {
      name: clean(raw.name),
      address_1: clean(raw.first_line),
      address_2: clean(raw.second_line),
      city: clean(raw.city),
      province_code: clean(raw.state),
      postal_code: clean(raw.zip),
      country_code: clean(raw.country_iso).toUpperCase(),
      phone: '',
      email: clean(raw.buyer_email),
    };
  }
  return null;
};

const parseSize = (value) => {
  const parts = String(value ?? '').toLowerCase().split(/[x×*,; ]+/).map(Number).filter((n) => n > 0);
  return parts.length === 3 ? parts : null;
};

/**
 * Construit l'envoi Chit Chats d'une commande. Renvoie `problems` (en clair)
 * quand on sait d'avance que Chit Chats refusera : inutile d'appeler l'API.
 */
export const buildShipment = (order, items, settings = getSettings()) => {
  const problems = [];
  let raw = null;
  try {
    raw = order.raw_payload ? JSON.parse(order.raw_payload) : null;
  } catch {
    raw = null;
  }

  const address = extractAddress(order.source, raw);
  if (!address) {
    problems.push(
      "pas d'adresse de livraison dans la commande (commande sans expédition, ou la boutique ne partage pas les données client)",
    );
    return { payload: null, problems };
  }

  const missing = ['name', 'address_1', 'city', 'postal_code', 'country_code'].filter((field) => !address[field]);
  if (['CA', 'US'].includes(address.country_code) && !address.province_code) missing.push('province_code');
  if (missing.length) problems.push(`adresse incomplète : ${missing.map((f) => FIELD_LABELS[f]).join(', ')} manquant(s)`);

  const size = parseSize(settings['chitchats.packageSizeCm']);
  if (!size) problems.push('dimensions du colis par défaut invalides (Réglages → Boutiques → Chit Chats, ex. 15x10x5)');
  const weight = Number(settings['chitchats.packageWeightGrams']);
  if (!(weight > 0)) problems.push('poids du colis par défaut invalide (Réglages → Boutiques → Chit Chats)');

  const currency = String(order.currency ?? 'CAD').toUpperCase() === 'USD' ? 'usd' : 'cad';
  const value = Number(order.total_price ?? 0) > 0
    ? Number(order.total_price)
    : items.reduce((sum, item) => sum + Number(item.unit_price ?? 0) * Number(item.quantity ?? 1), 0);
  if (!(value > 0)) problems.push('valeur de la commande à 0 (Chit Chats exige une valeur déclarée)');

  const description =
    items
      .map((item) => `${item.quantity}x ${item.title}`)
      .join(', ')
      .slice(0, 250) || 'Keycaps';

  // Chit Chats exige le détail des articles dès que le colis sort du Canada (États-Unis compris)
  const international = address.country_code && address.country_code !== 'CA';
  const payload = {
    name: address.name,
    address_1: address.address_1,
    address_2: address.address_2 || undefined,
    city: address.city,
    province_code: address.province_code || undefined,
    postal_code: address.postal_code,
    country_code: address.country_code,
    phone: address.phone || undefined,
    email: address.email || undefined,
    order_id: String(order.order_number ?? order.external_id).replace(/^#/, ''),
    package_contents: 'merchandise',
    description,
    value: value.toFixed(2),
    value_currency: currency,
    package_type: settings['chitchats.packageType'] || 'parcel',
    weight_unit: 'g',
    weight,
    size_unit: 'cm',
    size_x: size?.[0],
    size_y: size?.[1],
    size_z: size?.[2],
    postage_type: POSTAGE_BY_COUNTRY[address.country_code] ?? INTERNATIONAL_POSTAGE,
    cheapest_postage_type_requested: settings['chitchats.cheapestPostage'] ? 'yes' : undefined,
    ship_date: 'today',
    line_items: international
      ? items.map((item) => ({
          quantity: Number(item.quantity ?? 1),
          description: String(item.title).slice(0, 100),
          value_amount: Number(item.unit_price ?? 0).toFixed(2),
          currency_code: currency,
          origin_country: 'CA',
        }))
      : undefined,
  };
  return { payload: JSON.parse(JSON.stringify(payload)), problems };
};

/** Traduit une erreur de l'API Chit Chats en raison compréhensible. */
export const explainApiError = (error) => {
  if (!(error instanceof ApiError)) {
    return `Chit Chats injoignable (${error.message}) — réessai à la prochaine heure`;
  }
  if (error.status === 401 || error.status === 403) {
    return 'accès refusé par Chit Chats : vérifie le Client ID et le token (Réglages → Boutiques → Chit Chats)';
  }
  if (error.status === 429) return 'Chit Chats limite le nombre d\'appels : réessai à la prochaine heure';
  if (error.status >= 500) return `Chit Chats en panne (erreur ${error.status}) — réessai à la prochaine heure`;

  // on affiche le message de Chit Chats tel quel (ex. « line_items required »)
  const body = error.body ?? {};
  const messages = [];
  const GENERIC_KEYS = new Set(['message', 'error', 'errors', 'detail', 'details', 'raw']);
  const collect = (field, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) collect(GENERIC_KEYS.has(key) ? field : key, inner);
      return;
    }
    const text = [].concat(value).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(', ');
    if (!text) return;
    messages.push(field && !GENERIC_KEYS.has(field) ? `${field} ${text}` : text);
  };
  const errors = body.errors ?? body.error ?? body.message ?? body.raw;
  if (Array.isArray(errors)) errors.forEach((value) => collect(null, value));
  else if (errors) collect(null, errors);
  return messages.length ? messages.join(' ; ') : `refusé par Chit Chats (erreur ${error.status})`;
};

const api = (settings) => {
  const base = `${settings['chitchats.apiBase']}/clients/${settings['chitchats.clientId']}`;
  const headers = { Authorization: settings['chitchats.accessToken'], 'Content-Type': 'application/json' };
  return {
    search: (q) => requestJson(`${base}/shipments?q=${encodeURIComponent(q)}&limit=25`, { headers, retries: 1 }),
    create: (payload) =>
      requestJson(`${base}/shipments`, { method: 'POST', headers, body: JSON.stringify(payload), retries: 1 }),
  };
};

const record = (orderId, { status, error = null, shipmentId = null }) =>
  getDb()
    .prepare(
      `UPDATE orders SET chitchats_import_status = @status, chitchats_import_error = @error,
              chitchats_import_at = @ts, chitchats_shipment_id = COALESCE(@shipmentId, chitchats_shipment_id),
              updated_at = @ts
       WHERE id = @orderId`,
    )
    .run({ orderId, status, error, shipmentId: shipmentId ? String(shipmentId) : null, ts: nowIso() });

/** Commandes à envoyer : ouvertes, pas encore dans Chit Chats, dans la fenêtre de rattrapage. */
const pendingOrders = (settings, onlyOrderId) => {
  const db = getDb();
  if (onlyOrderId) return db.prepare('SELECT * FROM orders WHERE id = ?').all(Number(onlyOrderId));
  const since = new Date(Date.now() - Number(settings['schedule.lookbackDays'] || 14) * 86400000).toISOString();
  return db
    .prepare(
      `SELECT * FROM orders
        WHERE source IN ('shopify', 'etsy')
          AND shipped_at IS NULL
          AND chitchats_shipment_id IS NULL
          AND COALESCE(placed_at, created_at) >= ?
          AND EXISTS (SELECT 1 FROM parts p WHERE p.order_id = orders.id AND p.status <> 'SHIPPED')
        ORDER BY COALESCE(placed_at, created_at) ASC`,
    )
    .all(since);
};

/** Importe une commande ; renvoie { status: 'imported' | 'linked' | 'error', error? }. */
export const importOrder = async (order, settings = getSettings(), client = api(settings)) => {
  const items = getDb().prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id);
  const orderRef = String(order.order_number ?? order.external_id).replace(/^#/, '');

  try {
    // déjà chez Chit Chats (import natif, import précédent) : on relie, sans doublon
    const found = await client.search(orderRef);
    const list = Array.isArray(found) ? found : found?.shipments ?? found?.data ?? [];
    const existing = list.find((s) => String(s.order_id ?? '').replace(/^#/, '') === orderRef);
    if (existing) {
      record(order.id, { status: 'linked', shipmentId: existing.id });
      return { status: 'linked', shipmentId: existing.id };
    }

    const { payload, problems } = buildShipment(order, items, settings);
    if (problems.length) {
      const error = problems.join(' ; ');
      record(order.id, { status: 'error', error });
      return { status: 'error', error };
    }

    const created = await client.create(payload);
    const shipment = created?.shipment ?? created;
    record(order.id, { status: 'imported', shipmentId: shipment?.id ?? null });
    return { status: 'imported', shipmentId: shipment?.id ?? null };
  } catch (error) {
    const reason = explainApiError(error);
    record(order.id, { status: 'error', error: reason });
    log.warn('order import failed', { orderId: order.id, reason });
    return { status: 'error', error: reason };
  }
};

/** Le job (toutes les heures par défaut), aussi lancé par le bouton « Importer maintenant ». */
export const importOrdersToChitChats = async ({ trigger = 'cron', orderId = null, client } = {}) => {
  const settings = getSettings();
  const db = getDb();
  const configured = Boolean(settings['chitchats.clientId'] && settings['chitchats.accessToken']);
  if (!orderId && !settings['chitchats.autoImport'] && trigger === 'cron') return { status: 'disabled' };
  if (!configured) return { status: 'skipped', message: 'Chit Chats non configuré' };

  const startedAt = nowIso();
  const runId = Number(
    db
      .prepare(`INSERT INTO sync_runs (source, trigger, status, started_at) VALUES ('chitchats-import', ?, 'running', ?)`)
      .run(trigger, startedAt).lastInsertRowid,
  );

  const counts = { imported: 0, linked: 0, error: 0 };
  const orders = pendingOrders(settings, orderId);
  const apiClient = client ?? api(settings);
  for (const order of orders) {
    const result = await importOrder(order, settings, apiClient);
    counts[result.status] += 1;
  }

  const message = `${counts.imported} importée(s), ${counts.linked} déjà présente(s), ${counts.error} en erreur`;
  const finishedAt = nowIso();
  db.prepare(
    `UPDATE sync_runs SET status = @status, finished_at = @finishedAt, duration_ms = @ms,
       orders_seen = @seen, orders_created = @created, message = @message WHERE id = @id`,
  ).run({
    id: runId,
    status: counts.error && !counts.imported && !counts.linked ? 'error' : 'success',
    finishedAt,
    ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    seen: orders.length,
    created: counts.imported,
    message,
  });
  log.info('chit chats import done', { trigger, ...counts });
  return { status: 'success', orders: orders.length, ...counts, message };
};
