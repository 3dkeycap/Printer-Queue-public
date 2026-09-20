import { getDb, nowIso } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
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

  if (query.priority === '1' || query.priority === true) {
    where.push('(p.priority = 1 OR o.is_priority = 1)');
  }

  const search = String(query.q ?? '').trim();
  if (search) {
    where.push(`(
      p.name LIKE @q OR p.sku LIKE @q OR p.variant_title LIKE @q OR p.notes LIKE @q
      OR o.order_number LIKE @q OR o.customer_name LIKE @q OR o.external_id LIKE @q
    )`);
    params.q = `%${search}%`;
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
              p.color_key, p.status, p.priority, p.printer, p.notes, p.fail_count,
              p.status_changed_at, p.printed_at, p.shipped_at, p.created_at, p.updated_at,
              o.source, o.order_number, o.customer_name, o.placed_at, o.is_priority AS order_priority,
              o.tracking_number, o.carrier,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex,
              COALESCE(c.sort_order, 999) AS color_sort
       FROM parts p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN resin_colors c ON c.key = p.color_key
       ${clause}
       ORDER BY ${sort}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM parts p JOIN orders o ON o.id = p.order_id ${clause}`,
    )
    .get(params).n;

  return { items: rows.map(hydrate), total, limit, offset };
};

const hydrate = (row) => ({
  ...row,
  priority: Boolean(row.priority),
  order_priority: Boolean(row.order_priority),
});

export const getPart = (id) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.*, o.source, o.order_number, o.customer_name, o.customer_email, o.placed_at,
              o.is_priority AS order_priority, o.tracking_number, o.carrier,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex
       FROM parts p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN resin_colors c ON c.key = p.color_key
       WHERE p.id = ?`,
    )
    .get(Number(id));
  return row ? hydrate(row) : null;
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
         printed_at = CASE WHEN @status IN ('DONE','IN_INVENTORY','SHIPPED') AND printed_at IS NULL THEN @ts ELSE printed_at END,
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

const PATCHABLE = ['name', 'sku', 'variant_title', 'color_key', 'printer', 'notes'];

export const updatePart = (id, patch, { actor = 'dashboard' } = {}) => {
  const db = getDb();
  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(id));
  if (!part) throw notFound(`Part ${id} not found`);

  const fields = [];
  const values = { id: part.id, ts: nowIso() };

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
  priority = false,
  status = 'TO_PRINT',
}) => {
  const db = getDb();
  if (!name) throw badRequest('`name` is required');
  if (!isStatus(status)) throw badRequest(`Unknown status "${status}"`);
  const qty = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 100);
  const ts = nowIso();

  const run = db.transaction(() => {
    let order = db
      .prepare(`SELECT * FROM orders WHERE source = 'manual' AND external_id = 'internal-stock'`)
      .get();
    if (!order) {
      const info = db
        .prepare(
          `INSERT INTO orders (source, external_id, order_number, customer_name, placed_at, created_at, updated_at)
           VALUES ('manual', 'internal-stock', 'STOCK', 'Production interne', ?, ?, ?)`,
        )
        .run(ts, ts, ts);
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
                              priority, notes, status_changed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(order.id, itemInfo.lastInsertRowid, index, name, sku, color_key, status, priority ? 1 : 0, notes, ts, ts, ts);
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
