import { getDb, nowIso } from '../db/index.js';
import { ApiError, requestJson } from '../lib/http.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from './settings.service.js';

const log = createLogger('chitchats:import');

/**
 * Commandes Shopify / Etsy <-> envois Chit Chats.
 *
 * L'app NE CRÉE PLUS d'envoi dans Chit Chats : Chit Chats importe lui-même les commandes (import Etsy / Shopify de
 * Chit Chats) et l'import de l'app faisait des doublons « venus de nulle part ». L'app se contente de :
 *   - relier chaque commande à l'envoi que Chit Chats a déjà (même numéro de commande) ;
 *   - supprimer les doublons qu'elle avait créés autrefois : seulement SES envois, encore « pending » (jamais payés),
 *     et seulement quand Chit Chats a un autre envoi pour la même commande. Un envoi payé n'est jamais touché ; un
 *     envoi de l'app qui est le seul de sa commande est gardé.
 * Elle garde aussi ce qu'il faut à l'extension pour compléter le formulaire de douane (customsFor).
 */

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

const api = (settings) => {
  const base = `${settings['chitchats.apiBase']}/clients/${settings['chitchats.clientId']}`;
  const headers = { Authorization: settings['chitchats.accessToken'], 'Content-Type': 'application/json' };
  return {
    search: (q) => requestJson(`${base}/shipments?q=${encodeURIComponent(q)}&limit=25`, { headers, retries: 1 }),
    list: (page) => requestJson(`${base}/shipments?limit=100&page=${page}`, { headers, retries: 1 }),
    get: (id) => requestJson(`${base}/shipments/${encodeURIComponent(id)}`, { headers, retries: 1 }),
    remove: (id) => requestJson(`${base}/shipments/${encodeURIComponent(id)}`, { method: 'DELETE', headers, retries: 1 }),
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

const listOf = (payload) => (Array.isArray(payload) ? payload : payload?.shipments ?? payload?.data ?? []);
const cleanRef = (value) => String(value ?? '').trim().replace(/^#/, '');

/**
 * Relie d'un coup les commandes locales aux envois DÉJÀ présents dans Chit
 * Chats (import natif Shopify/Etsy de Chit Chats, envoi créé à la main…),
 * quel que soit leur âge : on lit les derniers envois et on rapproche par
 * numéro de commande. Sans ça, ces commandes restaient « false » pour toujours.
 */
export const linkExistingShipments = async (client, { pages = 5 } = {}) => {
  if (!client.list) return 0;
  const db = getDb();
  const open = db
    .prepare(
      `SELECT id, order_number, external_id FROM orders
        WHERE source IN ('shopify', 'etsy') AND chitchats_shipment_id IS NULL AND cancelled_at IS NULL`,
    )
    .all();
  if (!open.length) return 0;
  const byRef = new Map();
  for (const order of open) {
    if (order.order_number) byRef.set(cleanRef(order.order_number), order);
    byRef.set(cleanRef(order.external_id), order);
  }

  let linked = 0;
  for (let page = 1; page <= pages && byRef.size; page += 1) {
    let shipments;
    try {
      shipments = listOf(await client.list(page));
    } catch (error) {
      log.warn('could not list chit chats shipments', { page, error: error.message });
      break;
    }
    for (const shipment of shipments) {
      const order = byRef.get(cleanRef(shipment.order_id));
      if (!order || !shipment.id) continue;
      record(order.id, { status: 'linked', shipmentId: shipment.id });
      byRef.delete(cleanRef(order.order_number));
      byRef.delete(cleanRef(order.external_id));
      linked += 1;
    }
    if (shipments.length < 100) break;
  }
  if (linked) log.info('orders linked to existing chit chats shipments', { linked });
  return linked;
};

/**
 * Pourquoi une commande est (ou n'est pas) dans Chit Chats, en clair.
 * state : true | failed | shipped | false | na
 */
export const chitchatsState = (row, ctx) => {
  if (row.source === 'manual') return { state: 'na', reason: 'Pièce interne : rien à expédier par Chit Chats' };
  if (row.chitchats_shipment_id) {
    return {
      state: 'true',
      reason: row.chitchats_import_status === 'imported' ? 'Envoi créé autrefois par l\'app dans Chit Chats' : 'Envoi trouvé dans Chit Chats et relié',
    };
  }
  if (row.order_shipped_at || row.status === 'SHIPPED') {
    return { state: 'shipped', reason: 'Déjà expédiée, sans envoi Chit Chats connu de l\'app' };
  }
  if (!ctx.configured) return { state: 'false', reason: 'Chit Chats n\'est pas configuré (Client ID / token)' };
  return { state: 'false', reason: 'Pas encore dans Chit Chats : importe-la avec l’import Etsy / Shopify de Chit Chats, l’app la relie toute seule' };
};

/** Contexte commun pour chitchatsState (une seule lecture des réglages). */
export const chitchatsContext = (settings = getSettings()) => ({
  configured: Boolean(settings['chitchats.clientId'] && settings['chitchats.accessToken']),
});

/** Résumé : combien de commandes ouvertes ne sont pas dans Chit Chats, et pourquoi. */
export const chitchatsDiagnosis = () => {
  const ctx = chitchatsContext();
  const rows = getDb()
    .prepare(
      `SELECT o.*, o.shipped_at AS order_shipped_at,
              CASE WHEN EXISTS (SELECT 1 FROM parts p WHERE p.order_id = o.id AND p.status <> 'SHIPPED') THEN 'OPEN' ELSE 'SHIPPED' END AS status
         FROM orders o WHERE o.source IN ('shopify', 'etsy')`,
    )
    .all();
  const reasons = new Map();
  const totals = { true: 0, failed: 0, shipped: 0, false: 0 };
  for (const row of rows) {
    const { state, reason } = chitchatsState(row, ctx);
    if (state in totals) totals[state] += 1;
    if (state === 'false' || state === 'failed') {
      const key = state === 'failed' ? `Échec : ${reason}` : reason;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  }
  return { totals, reasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count) };
};

const CANCELLED_STATUSES = new Set(['canceled', 'cancelled', 'voided', 'void']);
const sameName = (a, b) => Boolean(a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase());

/** La commande locale dont `ref` est le numéro (ou null). */
const orderIdForRef = (ref) => {
  const cleaned = cleanRef(ref);
  if (!cleaned) return null;
  return (
    getDb()
      .prepare(`SELECT id FROM orders WHERE order_number = ? OR order_number = '#' || ? OR external_id = ? ORDER BY id DESC LIMIT 1`)
      .get(cleaned, cleaned, cleaned)?.id ?? null
  );
};

/** La commande quitte son envoi « app » : reliée au bon envoi (le jumeau) ou à aucun. */
const detach = (orderId, twinId) =>
  getDb()
    .prepare(
      `UPDATE orders SET chitchats_shipment_id = @twin, chitchats_import_status = @status, chitchats_import_error = NULL,
              chitchats_import_at = @ts, updated_at = @ts WHERE id = @orderId`,
    )
    .run({ orderId, twin: twinId ? String(twinId) : null, status: twinId ? 'linked' : null, ts: nowIso() });

/**
 * Supprime dans Chit Chats les doublons créés autrefois par l'app (voir en-tête). On regarde au plus `max` commandes
 * par passage (les plus anciennement vérifiées d'abord) ; un envoi « app » encore seul de sa commande est revu au
 * passage suivant (l'import de Chit Chats peut arriver plus tard).
 */
export const removeAppDuplicates = async (client, { max = 40 } = {}) => {
  const counts = { removed: 0, kept: 0, error: 0 };
  if (!client.get || !client.remove || !client.search) return counts;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, order_number, external_id, customer_name, chitchats_shipment_id FROM orders
        WHERE chitchats_import_status = 'imported' AND chitchats_shipment_id IS NOT NULL
        ORDER BY COALESCE(chitchats_import_at, '') ASC, id ASC LIMIT ?`,
    )
    .all(max);
  const touch = db.prepare('UPDATE orders SET chitchats_import_at = ? WHERE id = ?');
  for (const row of rows) {
    const ours = String(row.chitchats_shipment_id);
    try {
      let mine;
      try {
        const payload = await client.get(ours);
        mine = payload?.shipment ?? payload;
      } catch (error) {
        // déjà supprimé dans Chit Chats (à la main) : la commande n'a plus d'envoi « app »
        if (error instanceof ApiError && error.status === 404) {
          detach(row.id, null);
          counts.removed += 1;
          continue;
        }
        throw error;
      }
      // payé, en route, annulé… : on n'y touche jamais, c'est l'envoi de la commande
      if (String(mine?.status ?? '').toLowerCase() !== 'pending') {
        db.prepare(`UPDATE orders SET chitchats_import_status = 'linked', chitchats_import_at = ? WHERE id = ?`).run(nowIso(), row.id);
        counts.kept += 1;
        continue;
      }
      const refs = new Set([cleanRef(row.order_number), cleanRef(row.external_id)].filter(Boolean));
      const name = String(mine?.to_name ?? row.customer_name ?? '').trim();
      let twin = null;
      for (const query of [...new Set([...refs, name].filter(Boolean))]) {
        twin = listOf(await client.search(query)).find((shipment) => {
          if (!shipment?.id || String(shipment.id) === ours) return false;
          if (CANCELLED_STATUSES.has(String(shipment.status ?? '').toLowerCase())) return false;
          if (refs.has(cleanRef(shipment.order_id))) return true;
          // même client : seulement si cet envoi n'appartient pas à UNE AUTRE de ses commandes
          const other = orderIdForRef(shipment.order_id);
          return sameName(shipment.to_name, name) && (!other || other === row.id);
        });
        if (twin) break;
      }
      if (!twin) {
        touch.run(nowIso(), row.id);
        counts.kept += 1;
        continue;
      }
      await client.remove(ours);
      detach(row.id, twin.id);
      log.info('app duplicate removed from chit chats', { orderId: row.id, removed: ours, kept: twin.id });
      counts.removed += 1;
    } catch (error) {
      touch.run(nowIso(), row.id);
      counts.error += 1;
      log.warn('could not check app shipment in chit chats', { orderId: row.id, shipmentId: ours, error: error.message });
    }
  }
  return counts;
};

/** Le job (toutes les heures par défaut) : relier les envois de Chit Chats, supprimer les doublons de l'app. */
export const reconcileChitChats = async ({ trigger = 'cron', client } = {}) => {
  const settings = getSettings();
  const db = getDb();
  const configured = Boolean(settings['chitchats.clientId'] && settings['chitchats.accessToken']);
  if (!configured && !client) return { status: 'skipped', message: 'Chit Chats non configuré' };

  const startedAt = nowIso();
  const runId = Number(
    db
      .prepare(`INSERT INTO sync_runs (source, trigger, status, started_at) VALUES ('chitchats-import', ?, 'running', ?)`)
      .run(trigger, startedAt).lastInsertRowid,
  );
  const apiClient = client ?? api(settings);
  const linked = await linkExistingShipments(apiClient);
  const duplicates = await removeAppDuplicates(apiClient);
  const message = `${linked} commande(s) reliée(s) à leur envoi Chit Chats, ${duplicates.removed} doublon(s) de l’app supprimé(s)${duplicates.error ? `, ${duplicates.error} à revoir` : ''}`;
  const finishedAt = nowIso();
  db.prepare(
    `UPDATE sync_runs SET status = 'success', finished_at = @finishedAt, duration_ms = @ms,
       orders_seen = @seen, orders_created = 0, message = @message WHERE id = @id`,
  ).run({ id: runId, finishedAt, ms: new Date(finishedAt).getTime() - new Date(startedAt).getTime(), seen: linked + duplicates.removed + duplicates.kept, message });
  log.info('chit chats reconcile done', { trigger, linked, ...duplicates });
  return { status: 'success', linked, ...duplicates, message };
};

/*
 * Fabricants (« Manufacturer Details », exigés par Chit Chats pour l'envoi DDP aux États-Unis). Par défaut l'atelier
 * au Québec ; les pièces en nylon viennent de JLC PCB (Hong Kong) et les switchs de Dongguan Gaote (Chine).
 */
export const MANUFACTURERS = {
  quebec: { contact: 'Innov3d inc.', address1: '441 rue saint georges', address2: '', city: 'la Prairie', postalCode: 'J5R2N1', country: 'Canada', countryCode: 'CA', province: 'Quebec (QC)' },
  hongkong: { contact: 'JiaLiChuang (HongKong) Co., Limited', address1: 'Unit 21, 28/F', address2: 'Metropole Square', city: 'Hong Kong', postalCode: '000000', country: 'Hong Kong', countryCode: 'HK', province: 'HONG KONG' },
  dongguan: { contact: 'Dongguan Gaote Electronics Co, Ltd.', address1: 'Building 1, No. 1 , Tangxia Town', address2: 'Zhenxingwei Industrial Zone', city: 'Dongguan', postalCode: '523710', country: 'China', countryCode: 'CN', province: 'Guangdong (GD)' },
};

/*
 * « Custom set » : fait sur mesure, l'app ne peut pas savoir où (Québec, Hong Kong ou Chine). L'extension demande à la
 * personne au moment de compléter la douane. Seulement « custom … set » dans le titre ou la variante (pas « Custom
 * Keyboards » ni « Custom Keycaps for … », qui sont des descriptions de produits faits ici).
 */
export const isCustomSet = (item) =>
  /\bcustom\b[^|()]{0,20}?\bsets?\b/i.test([item.title, item.variant_title].filter(Boolean).join(' | '));

/**
 * Le fabricant d'un article : nylon (couleur, titre ou variante) -> Hong Kong ; switchs (pas les « switch covers ») ->
 * Dongguan. Exception : les keycaps « Ore » (Minecraft) sont en nylon mais ASSEMBLÉES à l'atelier -> Québec (made in
 * Canada), demande de l'atelier.
 */
export const manufacturerFor = (item) => {
  const text = [item.title, item.variant_title, item.sku, item.color_key, item.color_name].filter(Boolean).join(' ').toLowerCase();
  const title = String(item.title ?? '').toLowerCase();
  if (/\b(ores?|minecraft)\b/.test(title)) return { key: 'quebec', ...MANUFACTURERS.quebec };
  if (/\bnylon\b/.test(text)) return { key: 'hongkong', ...MANUFACTURERS.hongkong };
  if (/\bswitch(es)?\b/.test(title) && !/\bcovers?\b/.test(title)) return { key: 'dongguan', ...MANUFACTURERS.dongguan };
  return { key: 'quebec', ...MANUFACTURERS.quebec };
};

// pays de l'Union européenne : Etsy y perçoit la TVA (IOSS) et Chit Chats demande la « Customs Tax Reference Number »
export const EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

/*
 * Commande Etsy vers l'Union européenne (IOSS, étiquette VAT) : sur Chit Chats, une SEULE ligne de douane pour toute la
 * commande (demande de l'atelier) : « Keyboard keycaps », SKU et identifiant produit « 3DK », quantité = nombre total de
 * produits, Total = valeur des produits seulement (sans livraison ni taxes), dans la devise de la commande, fabricant
 * Innov3d au Québec. L'extension supprime les autres lignes et remplit celle-ci.
 */
export const VAT_GROUP_DESCRIPTION = 'Keyboard keycaps';
export const VAT_GROUP_SKU = '3DK';
const vatGroupFor = (order, eu, items) => {
  if (order.source !== 'etsy' || !eu || !items.length) return null;
  const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const total = Math.round(items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0) * 100) / 100;
  if (!(quantity > 0) || !(total > 0)) return null;
  return {
    description: VAT_GROUP_DESCRIPTION,
    sku: VAT_GROUP_SKU,
    quantity,
    total,
    // valeur unitaire telle que quantité × valeur = total (Chit Chats accepte les décimales)
    unitValue: Math.round((total / quantity) * 10000) / 10000,
    currency: order.currency ? String(order.currency).toUpperCase() : null,
    manufacturer: { key: 'quebec', ...MANUFACTURERS.quebec },
  };
};

/**
 * Ce qui manque souvent sur un envoi Chit Chats importé (par l'app ou par l'import Etsy / Shopify de Chit Chats) :
 * l'extension complète le formulaire de Chit Chats avec ça. Recherche par le numéro de commande affiché dans
 * « Order ID ». Le numéro IOSS n'est donné que pour une commande Etsy vers l'Union européenne.
 */
export const customsFor = (ref, { name } = {}) => {
  const clean = String(ref ?? '').trim().replace(/^#/, '');
  const buyer = String(name ?? '').trim();
  if (!clean && !buyer) return null;
  const db = getDb();
  let order = clean
    ? db
        .prepare(
          `SELECT * FROM orders WHERE source IN ('shopify', 'etsy')
             AND (order_number = @ref OR order_number = '#' || @ref OR external_id = @ref)
           ORDER BY id DESC LIMIT 1`,
        )
        .get({ ref: clean })
    : null;
  // page de recherche de Chit Chats (…/shipments/search?q=Alison%20Thompson) : la commande pas encore expédiée de cet acheteur
  if (!order && buyer) {
    order = db
      .prepare(
        `SELECT * FROM orders WHERE source IN ('shopify', 'etsy') AND customer_name = ? COLLATE NOCASE
           AND shipped_at IS NULL AND cancelled_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(buyer);
  }
  if (!order) return null;
  const settings = getSettings();
  let raw = null;
  try {
    raw = order.raw_payload ? JSON.parse(order.raw_payload) : null;
  } catch {
    raw = null;
  }
  const country = String(order.shipping_country || extractAddress(order.source, raw)?.country_code || '').toUpperCase() || null;
  const eu = EU_COUNTRIES.includes(country);
  const items = db
    .prepare(
      `SELECT i.title, i.sku, i.variant_title, i.quantity, i.unit_price, i.color_key, c.name AS color_name
         FROM order_items i LEFT JOIN resin_colors c ON c.key = i.color_key WHERE i.order_id = ? ORDER BY i.id`,
    )
    .all(order.id);
  return {
    orderNumber: String(order.order_number ?? order.external_id).replace(/^#/, ''),
    source: order.source,
    country,
    eu,
    ioss: order.source === 'etsy' && eu ? String(settings['etsy.iossNumber'] ?? '').trim() || null : null,
    hsCode: String(settings['chitchats.hsTariffCode'] ?? '').trim() || null,
    originCountry: 'Canada',
    items: items.map((item) => ({
      title: item.title,
      sku: item.sku ?? null,
      variant: item.variant_title ?? null,
      quantity: item.quantity,
      unitValue: item.unit_price,
      manufacturer: manufacturerFor(item),
      // custom set : l'extension demande Québec / Hong Kong / Chine (voir `manufacturers`)
      askManufacturer: isCustomSet(item),
    })),
    manufacturers: Object.fromEntries(Object.entries(MANUFACTURERS).map(([key, maker]) => [key, { key, ...maker }])),
    vatGroup: vatGroupFor(order, eu, items),
  };
};
