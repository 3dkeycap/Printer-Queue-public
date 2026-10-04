import { getDb } from '../db/index.js';
import { hiddenColorKeys } from './addons.js';
import { BOARD_STATUSES, STATUS_KEYS } from './statuses.js';

const boardList = `('${BOARD_STATUSES.join("','")}')`;

export const getSummary = () => {
  const db = getDb();

  const byStatusRows = db
    .prepare('SELECT status, COUNT(*) AS count FROM parts GROUP BY status')
    .all();
  const byStatus = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
  for (const row of byStatusRows) {
    if (byStatus[row.status] !== undefined) byStatus[row.status] = row.count;
  }

  const byColor = db
    .prepare(
      `SELECT p.color_key AS key,
              COALESCE(c.name, 'Non assigné') AS name,
              COALESCE(c.hex, '#7C7364') AS hex,
              COALESCE(c.sort_order, 999) AS sort_order,
              c.stock_grams, c.low_stock_grams,
              COUNT(*) AS total,
              SUM(CASE WHEN p.status IN ${boardList} THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN p.status = 'TO_PRINT' THEN 1 ELSE 0 END) AS queued
       FROM parts p
       LEFT JOIN resin_colors c ON c.key = p.color_key
       GROUP BY p.color_key
       ORDER BY sort_order`,
    )
    .all();

  const byUv = db
    .prepare(
      `SELECT COALESCE(NULLIF(p.uv, ''), '—') AS uv, COUNT(*) AS total,
              SUM(CASE WHEN p.status IN ${boardList} THEN 1 ELSE 0 END) AS active
       FROM parts p GROUP BY COALESCE(NULLIF(p.uv, ''), '—') ORDER BY uv`,
    )
    .all();

  const bySource = db
    .prepare(
      `SELECT o.source, COUNT(p.id) AS total,
              SUM(CASE WHEN p.status IN ${boardList} THEN 1 ELSE 0 END) AS active
       FROM parts p JOIN orders o ON o.id = p.order_id GROUP BY o.source`,
    )
    .all();

  // les couleurs retirées de la file ne comptent pas dans « À imprimer »
  const hidden = hiddenColorKeys().map((key) => `'${String(key).replace(/'/g, "''")}'`);
  const visible = hidden.length ? ` AND color_key NOT IN (${hidden.join(',')})` : '';

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM parts) AS parts_total,
         (SELECT COUNT(*) FROM parts WHERE status IN ${boardList}${visible}) AS parts_active,
         (SELECT COUNT(*) FROM parts WHERE priority = 1 AND status IN ${boardList}${visible}) AS parts_rush,
         (SELECT COUNT(*) FROM orders) AS orders_total,
         (SELECT COUNT(*) FROM orders WHERE shipped_at IS NULL) AS orders_open,
         (SELECT COUNT(*) FROM parts WHERE status = 'SHIPPED' AND date(shipped_at) = date('now')) AS shipped_today,
         (SELECT COUNT(*) FROM parts WHERE status = 'DONE' AND date(status_changed_at) = date('now')) AS done_today,
         (SELECT COUNT(*) FROM parts WHERE status = 'PRINTING') AS printing_now,
         (SELECT COUNT(*) FROM parts WHERE status = 'FAILED') AS failed_open`,
    )
    .get();

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

  return { totals, byStatus, byColor, byUv, bySource, lastSyncs, lowStock };
};
