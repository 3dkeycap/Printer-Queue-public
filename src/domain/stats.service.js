import { getDb } from '../db/index.js';
import { ACTIVE_STATUSES, STATUS_KEYS } from './statuses.js';

const activeList = `('${ACTIVE_STATUSES.join("','")}')`;

export const getSummary = () => {
  const db = getDb();

  const byStatusRows = db
    .prepare('SELECT status, COUNT(*) AS count FROM parts GROUP BY status')
    .all();
  const byStatus = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
  for (const row of byStatusRows) byStatus[row.status] = row.count;

  const byColor = db
    .prepare(
      `SELECT p.color_key AS key,
              COALESCE(c.name, 'Non assigné') AS name,
              COALESCE(c.hex, '#7C7364') AS hex,
              COALESCE(c.sort_order, 999) AS sort_order,
              c.stock_grams, c.low_stock_grams,
              COUNT(*) AS total,
              SUM(CASE WHEN p.status IN ${activeList} THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN p.status IN ('TO_PRINT','FILE_READY') THEN 1 ELSE 0 END) AS queued
       FROM parts p
       LEFT JOIN resin_colors c ON c.key = p.color_key
       GROUP BY p.color_key
       ORDER BY sort_order`,
    )
    .all();

  const bySource = db
    .prepare(
      `SELECT o.source, COUNT(p.id) AS total,
              SUM(CASE WHEN p.status IN ${activeList} THEN 1 ELSE 0 END) AS active
       FROM parts p JOIN orders o ON o.id = p.order_id GROUP BY o.source`,
    )
    .all();

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM parts) AS parts_total,
         (SELECT COUNT(*) FROM parts WHERE status IN ${activeList}) AS parts_active,
         (SELECT COUNT(*) FROM parts WHERE priority = 1 AND status IN ${activeList}) AS parts_rush,
         (SELECT COUNT(*) FROM orders) AS orders_total,
         (SELECT COUNT(*) FROM orders WHERE shipped_at IS NULL) AS orders_open,
         (SELECT COUNT(*) FROM parts WHERE status = 'SHIPPED' AND date(shipped_at) = date('now')) AS shipped_today,
         (SELECT COUNT(*) FROM parts WHERE status = 'DONE' AND date(status_changed_at) = date('now')) AS done_today,
         (SELECT COUNT(*) FROM parts WHERE status = 'FAILED') AS failed_open`,
    )
    .get();

  const throughput = db
    .prepare(
      `SELECT date(created_at) AS day, to_status, COUNT(*) AS count
       FROM part_events
       WHERE created_at >= datetime('now', '-13 days')
       GROUP BY day, to_status
       ORDER BY day`,
    )
    .all();

  const lastSyncs = db
    .prepare(
      `SELECT source, status, started_at, finished_at, duration_ms, orders_seen, parts_created, message
       FROM sync_runs ORDER BY started_at DESC LIMIT 8`,
    )
    .all();

  const lowStock = db
    .prepare(
      `SELECT key, name, hex, stock_grams, low_stock_grams FROM resin_colors
       WHERE is_active = 1 AND stock_grams <= low_stock_grams AND key <> 'unassigned'
       ORDER BY stock_grams ASC`,
    )
    .all();

  return { totals, byStatus, byColor, bySource, throughput, lastSyncs, lowStock };
};

export const getInventory = () => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.name, p.sku, p.color_key,
              COALESCE(c.name, 'Non assigné') AS color_name,
              COALESCE(c.hex, '#7C7364') AS color_hex,
              COUNT(*) AS quantity,
              MIN(p.status_changed_at) AS oldest,
              GROUP_CONCAT(p.id) AS part_ids
       FROM parts p
       LEFT JOIN resin_colors c ON c.key = p.color_key
       WHERE p.status = 'IN_INVENTORY'
       GROUP BY p.name, p.sku, p.color_key
       ORDER BY color_name, p.name`,
    )
    .all();
  return rows.map((row) => ({ ...row, part_ids: String(row.part_ids).split(',').map(Number) }));
};
