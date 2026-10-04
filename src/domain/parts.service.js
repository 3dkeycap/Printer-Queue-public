import { getDb, nowIso } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { hiddenColorKeys } from './addons.js';
import { chitchatsContext, chitchatsState } from './chitchatsImport.js';
import { buyerDetails, latestPacks } from './packing.js';
import { chitchatsShipUrl } from './presence.js';
import { getSettings } from './settings.service.js';
import { ACTIVE_STATUSES, canTransition, isStatus } from './statuses.js';

const SORTS = {
  smart: 'p.priority DESC, o.is_priority DESC, COALESCE(o.placed_at, o.created_at) ASC, p.id ASC',
  oldest: 'COALESCE(o.placed_at, o.created_at) ASC, p.id ASC',
  newest: 'COALESCE(o.placed_at, o.created_at) DESC, p.id DESC',
  color: 'color_sort ASC, p.priority DESC, COALESCE(o.placed_at, o.created_at) ASC',
  order: 'o.id ASC, p.unit_index ASC',
  updated: 'p.updated_at DESC',
};

const csv = (value) =>
  String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export const NO_UV = '__none__';

// la recherche porte aussi sur le nom de la résine : même jointure partout
const FILTER_FROM = `FROM parts p
  JOIN orders o ON o.id = p.order_id
  LEFT JOIN resin_colors c ON c.key = p.color_key`;

/** Builds the WHERE clause shared by the list and the count queries. */
const buildFilters = (query = {}) => {
  const where = [];
  const params = {};

  const statuses = csv(query.status).filter(isStatus);
  if (statuses.length) {
    where.push(`p.status IN (${statuses.map((_, i) => `@status${i}`).join(', ')})`);
    statuses.forEach((status, i) => {
      params[`status${i}`] = status;
    });
  } else if (query.scope === 'board' || query.scope === 'active') {
    where.push(`p.status IN (${ACTIVE_STATUSES.map((_, i) => `@active${i}`).join(', ')})`);
    ACTIVE_STATUSES.forEach((status, i) => {
      params[`active${i}`] = status;
    });
  }

  // couleurs que l'atelier n'imprime pas : absentes du tableau « À imprimer »
  if (query.scope === 'board') {
    // pas imprimé ici (article en stock, supplément) : seulement dans « Tout »
    where.push('p.not_printed = 0');
    const hidden = hiddenColorKeys();
    if (hidden.length) {
      where.push(`p.color_key NOT IN (${hidden.map((_, i) => `@hidden${i}`).join(', ')})`);
      hidden.forEach((color, i) => {
        params[`hidden${i}`] = color;
      });
    }
  }

  const colors = csv(query.color);
  if (colors.length) {
    where.push(`p.color_key IN (${colors.map((_, i) => `@color${i}`).join(', ')})`);
    colors.forEach((color, i) => {
      params[`color${i}`] = color;
    });
  }

  const sources = csv(query.source);
  if (sources.length) {
    where.push(`o.source IN (${sources.map((_, i) => `@source${i}`).join(', ')})`);
    sources.forEach((source, i) => {
      params[`source${i}`] = source;
    });
  }

  if (query.orderId) {
    where.push('p.order_id = @orderId');
    params.orderId = Number(query.orderId);
  }

  if (query.printer) {
    where.push('p.printer = @printer');
    params.printer = query.printer;
  }

  // « __none__ » = pièces sans poste UV (NULL ou chaîne vide)
  const uvs = csv(query.uv);
  if (uvs.length) {
    const values = uvs.filter((uv) => uv !== NO_UV);
    const clauses = [];
    if (values.length) {
      clauses.push(`p.uv IN (${values.map((_, i) => `@uv${i}`).join(', ')})`);
      values.forEach((uv, i) => {
        params[`uv${i}`] = uv;
      });
    }
    if (values.length !== uvs.length) clauses.push("COALESCE(p.uv, '') = ''");
    where.push(`(${clauses.join(' OR ')})`);
  }

  // en retard : commande plus vieille que le seuil réglable (Réglages → Atelier), pas encore expédiée
  if (query.late === '1' || query.late === true) {
    const days = Number(getSettings()['production.lateDays']) || 7;
    where.push("COALESCE(o.placed_at, o.created_at) < @lateSince AND p.status <> 'SHIPPED'");
    params.lateSince = new Date(Date.now() - days * 86400000).toISOString();
  }

  if (query.priority === '1' || query.priority === true) {
    where.push('(p.priority = 1 OR o.is_priority = 1)');
  }

  const search = String(query.q ?? '').trim();
  if (search) {
    where.push(`(
      p.name LIKE @q ESCAPE '\\' OR p.sku LIKE @q ESCAPE '\\' OR p.variant_title LIKE @q ESCAPE '\\'
      OR p.notes LIKE @q ESCAPE '\\' OR p.comment LIKE @q ESCAPE '\\' OR p.printer LIKE @q ESCAPE '\\'
      OR p.uv LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\'
      OR o.order_number LIKE @q ESCAPE '\\' OR o.customer_name LIKE @q ESCAPE '\\'
      OR o.customer_email LIKE @q ESCAPE '\\' OR o.external_id LIKE @q ESCAPE '\\'
    )`);
    // « 100% » ou « R_1 » doivent être cherchés tels quels, pas comme jokers
    params.q = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

export const listParts = (query = {}) => {
  const db = getDb();
  const { clause, params } = buildFilters(query);
  const sort = SORTS[query.sort] ?? SORTS.smart;
  const limit = Math.min(Number.parseInt(query.limit ?? '500', 10) || 500, 2000);
  const offset = Math.max(Number.parseInt(query.offset ?? '0', 10) || 0, 0);

  const rows = db
    .prepare(
      `SELECT p.id, p.order_id, p.order_item_id, p.unit_index, p.name, p.sku, p.variant_title,
              p.color_key, p.status, p.priority, p.printer, p.uv, p.comment, p.notes, p.fail_count, p.not_printed,
              p.packed_at, p.packed_by,
              p.status_changed_at, p.printed_at, p.shipped_at, p.created_at, p.updated_at,
              o.source, o.order_number, o.customer_name, o.placed_at, o.is_priority AS order_priority,
              o.tracking_number, o.carrier,
              o.chitchats_import_status, o.chitchats_import_error, o.chitchats_shipment_id,
              o.shipped_at AS order_shipped_at, o.created_at AS order_created_at, o.note AS order_note,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex,
              COALESCE(c.sort_order, 999) AS color_sort,
              oi.image_url
       FROM parts p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN resin_colors c ON c.key = p.color_key
       LEFT JOIN order_items oi ON oi.id = p.order_item_id
       ${clause}
       ORDER BY ${sort}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n ${FILTER_FROM} ${clause}`,
    )
    .get(params).n;

  // pourquoi chaque pièce est (ou pas) dans Chit Chats, pour la colonne de « Tout »
  const ctx = chitchatsContext();
  const packs = latestPacks([...new Set(rows.map((row) => row.order_id))]);
  const items = rows.map((row) => {
    const cc = chitchatsState({ ...row, created_at: row.order_created_at }, ctx);
    const pack = packs[row.order_id];
    return {
      ...hydrate(row),
      chitchats_state: cc.state,
      chitchats_reason: cc.reason,
      // bac : dernier passage de la commande, et ce qui manque pour CETTE ligne
      pack: pack
        ? { packer: pack.packer, at: pack.at, complete: pack.complete, missing: pack.missing.find((line) => line.order_item_id === row.order_item_id) ?? null }
        : null,
    };
  });
  return { items, total, limit, offset };
};

/**
 * Compteurs affichés sur les puces de filtre. Chaque dimension est comptée
 * avec tous les AUTRES filtres actifs, mais pas le sien : cocher « Noir »
 * laisse voir combien de pièces donnerait « Blanc » en plus.
 */
export const getFacets = (query = {}) => {
  const db = getDb();
  const count = (omit, expression) => {
    const { clause, params } = buildFilters({ ...query, [omit]: undefined });
    return Object.fromEntries(
      db
        .prepare(`SELECT ${expression} AS k, COUNT(*) AS n ${FILTER_FROM} ${clause} GROUP BY k`)
        .all(params)
        .map((row) => [row.k, row.n]),
    );
  };

  const { clause, params } = buildFilters({ ...query, priority: undefined });
  const rush = db
    .prepare(
      `SELECT COUNT(*) AS n ${FILTER_FROM} ${clause ? `${clause} AND` : 'WHERE'} (p.priority = 1 OR o.is_priority = 1)`,
    )
    .get(params).n;

  const late = (() => {
    const filters = buildFilters({ ...query, late: '1' });
    return db.prepare(`SELECT COUNT(*) AS n ${FILTER_FROM} ${filters.clause}`).get(filters.params).n;
  })();

  return {
    late,
    color: count('color', 'p.color_key'),
    uv: count('uv', `COALESCE(NULLIF(p.uv, ''), '${NO_UV}')`),
    status: count('status', 'p.status'),
    source: count('source', 'o.source'),
    rush,
  };
};

const hydrate = (row) => ({
  ...row,
  not_printed: Boolean(row.not_printed),
  priority: Boolean(row.priority),
  order_priority: Boolean(row.order_priority),
});

export const getPart = (id) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, o.source, o.order_number, o.customer_name, o.customer_email, o.placed_at,
              o.external_id AS order_external_id, o.chitchats_shipment_id,
              o.chitchats_import_status, o.chitchats_import_error, o.chitchats_import_at,
              o.is_priority AS order_priority, o.tracking_number, o.carrier,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex,
              oi.image_url
       FROM parts p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN resin_colors c ON c.key = p.color_key
       LEFT JOIN order_items oi ON oi.id = p.order_item_id
       WHERE p.id = ?`,
    )
    .get(Number(id));
  if (!row) return null;
  const db2 = getDb();
  const order = db2.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
  const items = db2.prepare('SELECT * FROM order_items WHERE order_id = ?').all(row.order_id);
  return { ...hydrate(row), links: orderLinks(row), buyer_details: buyerDetails(order, items) };
};

/**
 * Liens « ouvrir sur… » d'une commande : seulement ceux qu'on sait construire
 * avec les données disponibles (boutique configurée, colis expédié...).
 */
export const orderLinks = (order) => {
  const links = {};
  const settings = getSettings();

  if (order.source === 'shopify' && order.order_external_id) {
    const domain = String(settings['shopify.shopDomain'] ?? '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (domain) {
      links.shop = {
        label: 'Ouvrir sur Shopify',
        url: `https://${domain}/admin/orders/${encodeURIComponent(order.order_external_id)}`,
      };
    }
  } else if (order.source === 'etsy' && order.order_external_id) {
    links.shop = {
      label: 'Ouvrir sur Etsy',
      url: `https://www.etsy.com/your/orders/sold?order_id=${encodeURIComponent(order.order_external_id)}`,
    };
  }

  // la commande dans Chit Chats (recherche par numéro), sinon le suivi du colis
  const search = ['shopify', 'etsy'].includes(order.source) && settings['chitchats.clientId']
    ? chitchatsShipUrl(order.order_number, settings)
    : null;
  if (search) {
    links.chitchats = { label: 'Ouvrir sur Chit Chats', url: search };
  } else if (order.tracking_number) {
    links.chitchats = {
      label: 'Ouvrir sur Chit Chats',
      url: `https://chitchats.com/tracking/${encodeURIComponent(order.tracking_number)}`,
    };
  }
  return links;
};

export const listEvents = (partId) =>
  getDb()
    .prepare(
      `SELECT id, part_id, from_status, to_status, actor, note, created_at
       FROM part_events WHERE part_id = ? ORDER BY id DESC LIMIT 100`,
    )
    .all(Number(partId));

const recordEvent = (db, { partId, from, to, actor, note }) => {
  db.prepare(
    `INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(partId, from, to, actor ?? 'system', note ?? null, nowIso());
};

/**
 * Core state transition. Also maintains the derived columns
 * (fail_count, printed_at, shipped_at) so the UI never has to compute them.
 */
export const setStatus = (id, status, { actor = 'dashboard', note = null, force = false } = {}) => {
  const db = getDb();
  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(id));
  if (!part) throw notFound(`Part ${id} not found`);
  if (!isStatus(status)) throw badRequest(`Unknown status "${status}"`);
  if (!force && !canTransition(part.status, status)) {
    throw conflict(`Transition ${part.status} -> ${status} is not allowed`, {
      from: part.status,
      to: status,
    });
  }
  if (part.status === status) return hydrate({ ...part, priority: part.priority });

  const ts = nowIso();
  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE parts SET
         status = @status,
         status_changed_at = @ts,
         updated_at = @ts,
         fail_count = fail_count + @failInc,
         printed_at = CASE WHEN @status IN ('DONE','SHIPPED') AND printed_at IS NULL THEN @ts ELSE printed_at END,
         shipped_at = CASE WHEN @status = 'SHIPPED' THEN @ts WHEN @status <> 'SHIPPED' THEN NULL ELSE shipped_at END
       WHERE id = @id`,
    ).run({ id: part.id, status, ts, failInc: status === 'FAILED' ? 1 : 0 });

    recordEvent(db, { partId: part.id, from: part.status, to: status, actor, note });
  });
  apply();

  return getPart(part.id);
};

export const bulkSetStatus = (ids, status, options = {}) => {
  const updated = [];
  const errors = [];
  for (const id of ids) {
    try {
      updated.push(setStatus(id, status, options));
    } catch (error) {
      errors.push({ id, error: error.message });
    }
  }
  return { updated, errors };
};

/** Liste (ou texte) de commentaires -> une étiquette par ligne, sans doublon ; null si vide. */
export const normalizeComments = (value) => {
  const list = (Array.isArray(value) ? value : String(value ?? '').split('\n'))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  const unique = [...new Set(list)];
  return unique.length ? unique.join('\n') : null;
};

const PATCHABLE = ['name', 'sku', 'variant_title', 'color_key', 'printer', 'uv', 'comment', 'notes'];

export const updatePart = (id, patch, { actor = 'dashboard' } = {}) => {
  const db = getDb();
  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(id));
  if (!part) throw notFound(`Part ${id} not found`);

  const fields = [];
  const values = { id: part.id, ts: nowIso() };

  // plusieurs commentaires = étiquettes, stockées une par ligne
  if (patch.comment !== undefined) patch = { ...patch, comment: normalizeComments(patch.comment) };

  for (const field of PATCHABLE) {
    if (patch[field] !== undefined) {
      fields.push(`${field} = @${field}`);
      values[field] = patch[field];
    }
  }
  if (patch.priority !== undefined) {
    fields.push('priority = @priority');
    values.priority = patch.priority ? 1 : 0;
  }
  if (patch.not_printed !== undefined) {
    fields.push('not_printed = @not_printed');
    values.not_printed = patch.not_printed ? 1 : 0;
  }

  if (values.color_key !== undefined) {
    const exists = db.prepare('SELECT 1 FROM resin_colors WHERE key = ?').get(values.color_key);
    if (!exists) throw badRequest(`Unknown resin colour "${values.color_key}"`);
  }

  if (fields.length) {
    db.prepare(`UPDATE parts SET ${fields.join(', ')}, updated_at = @ts WHERE id = @id`).run(values);
  }

  if (patch.status !== undefined && patch.status !== part.status) {
    return setStatus(part.id, patch.status, { actor, note: patch.note ?? null, force: patch.force });
  }
  return getPart(part.id);
};

/** Manual part, e.g. a reprint or a piece printed for stock. */
export const createManualPart = ({
  name,
  sku = null,
  color_key = 'unassigned',
  quantity = 1,
  notes = null,
  uv = null,
  comment = null,
  customer = null,
  priority = false,
  status = 'TO_PRINT',
}) => {
  const db = getDb();
  if (!name) throw badRequest('`name` is required');
  if (!isStatus(status)) throw badRequest(`Unknown status "${status}"`);
  const qty = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 100);
  const ts = nowIso();

  const run = db.transaction(() => {
    const orderKey = customer ? `manual-${customer.toLowerCase()}` : 'internal-stock';
    let order = db
      .prepare(`SELECT * FROM orders WHERE source = 'manual' AND external_id = ?`)
      .get(orderKey);
    if (!order) {
      const info = db
        .prepare(
          `INSERT INTO orders (source, external_id, order_number, customer_name, placed_at, created_at, updated_at)
           VALUES ('manual', ?, ?, ?, ?, ?, ?)`,
        )
        .run(orderKey, customer ? 'INTERNE' : 'STOCK', customer ?? 'Production interne', ts, ts, ts);
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    }

    const itemInfo = db
      .prepare(
        `INSERT INTO order_items (order_id, external_id, title, sku, quantity, color_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(order.id, `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, sku, qty, color_key, ts, ts);

    const created = [];
    for (let index = 1; index <= qty; index += 1) {
      const info = db
        .prepare(
          `INSERT INTO parts (order_id, order_item_id, unit_index, name, sku, color_key, status,
                              priority, uv, comment, notes, status_changed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(order.id, itemInfo.lastInsertRowid, index, name, sku, color_key, status, priority ? 1 : 0, uv, normalizeComments(comment), notes, ts, ts, ts);
      recordEvent(db, {
        partId: info.lastInsertRowid,
        from: null,
        to: status,
        actor: 'dashboard',
        note: 'Pièce créée manuellement',
      });
      created.push(Number(info.lastInsertRowid));
    }
    return created;
  });

  return run().map((id) => getPart(id));
};

export const deletePart = (id) => {
  const info = getDb().prepare('DELETE FROM parts WHERE id = ?').run(Number(id));
  if (!info.changes) throw notFound(`Part ${id} not found`);
  return { deleted: Number(id) };
};

export const listPrinters = () =>
  getDb()
    .prepare(`SELECT DISTINCT printer FROM parts WHERE printer IS NOT NULL AND printer <> '' ORDER BY printer`)
    .all()
    .map((row) => row.printer);
