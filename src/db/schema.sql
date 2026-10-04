-- ===========================================================================
--  Resin Print Queue - SQLite schema
--  One row in `parts` == one physical object to print. A Shopify line item
--  with quantity 3 therefore produces 3 rows in `parts`.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS resin_colors (
  key                 TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  hex                 TEXT NOT NULL DEFAULT '#8C8579',
  aliases             TEXT NOT NULL DEFAULT '[]',   -- JSON array of matching strings
  stock_grams         REAL NOT NULL DEFAULT 0,
  low_stock_grams     REAL NOT NULL DEFAULT 500,
  sort_order          INTEGER NOT NULL DEFAULT 100,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  source                TEXT NOT NULL,              -- shopify | etsy | manual
  external_id           TEXT NOT NULL,              -- id in the source system
  order_number          TEXT,                       -- human readable (#1042, 3021847461)
  customer_name         TEXT,
  customer_email        TEXT,
  shipping_country      TEXT,
  placed_at             TEXT,
  total_price           REAL,
  currency              TEXT,
  is_priority           INTEGER NOT NULL DEFAULT 0,
  note                  TEXT,
  carrier               TEXT,
  tracking_number       TEXT,
  chitchats_shipment_id TEXT,
  shipped_at            TEXT,
  raw_payload           TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders (placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_shipment ON orders (chitchats_shipment_id);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,                      -- line item / transaction id
  title         TEXT NOT NULL,
  sku           TEXT,
  variant_title TEXT,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_price    REAL,
  color_key     TEXT REFERENCES resin_colors (key),
  image_url     TEXT,                               -- photo du produit (Shopify/Etsy), best-effort
  raw_payload   TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (order_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);

-- One physical object = one row.
CREATE TABLE IF NOT EXISTS parts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  order_item_id     INTEGER REFERENCES order_items (id) ON DELETE CASCADE,
  unit_index        INTEGER NOT NULL DEFAULT 1,     -- 1..quantity
  name              TEXT NOT NULL,
  sku               TEXT,
  variant_title     TEXT,
  color_key         TEXT NOT NULL DEFAULT 'unassigned' REFERENCES resin_colors (key),
  status            TEXT NOT NULL DEFAULT 'TO_PRINT',
  priority          INTEGER NOT NULL DEFAULT 0,     -- 0 normal, 1 rush
  printer           TEXT,
  uv                TEXT,                           -- poste / recette UV (liste réglable)
  comment           TEXT,                           -- commentaire choisi dans la liste réglable
  notes             TEXT,
  fail_count        INTEGER NOT NULL DEFAULT 0,
  status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  printed_at        TEXT,
  shipped_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (order_item_id, unit_index)
);

CREATE INDEX IF NOT EXISTS idx_parts_status ON parts (status);
CREATE INDEX IF NOT EXISTS idx_parts_color ON parts (color_key);
CREATE INDEX IF NOT EXISTS idx_parts_order ON parts (order_id);
CREATE INDEX IF NOT EXISTS idx_parts_board ON parts (status, color_key, priority DESC);

-- Full audit trail of every status transition.
CREATE TABLE IF NOT EXISTS part_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id     INTEGER NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'system',       -- dashboard | worker | chitchats
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_part_events_part ON part_events (part_id, id DESC);

CREATE TABLE IF NOT EXISTS sync_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL,                     -- shopify | etsy | chitchats
  trigger        TEXT NOT NULL DEFAULT 'cron',      -- cron | manual | webhook | boot
  status         TEXT NOT NULL DEFAULT 'running',   -- running | success | error
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at    TEXT,
  duration_ms    INTEGER,
  orders_seen    INTEGER NOT NULL DEFAULT 0,
  orders_created INTEGER NOT NULL DEFAULT 0,
  parts_created  INTEGER NOT NULL DEFAULT 0,
  parts_updated  INTEGER NOT NULL DEFAULT 0,
  message        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  topic       TEXT,
  external_id TEXT,
  payload     TEXT,
  status      TEXT NOT NULL DEFAULT 'received',     -- received | processed | ignored | error
  result      TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events (provider, received_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Convenience view used by the dashboard / exports.
CREATE VIEW IF NOT EXISTS v_parts_full AS
SELECT
  p.id, p.order_id, p.order_item_id, p.unit_index, p.name, p.sku, p.variant_title,
  p.color_key, p.status, p.priority, p.printer, p.uv, p.comment, p.notes, p.fail_count,
  p.status_changed_at, p.printed_at, p.shipped_at, p.created_at, p.updated_at,
  o.source, o.external_id AS order_external_id, o.order_number, o.customer_name,
  o.placed_at, o.is_priority AS order_priority, o.tracking_number, o.carrier,
  c.name AS color_name, c.hex AS color_hex, c.sort_order AS color_sort,
  oi.image_url
FROM parts p
JOIN orders o ON o.id = p.order_id
LEFT JOIN resin_colors c ON c.key = p.color_key
LEFT JOIN order_items oi ON oi.id = p.order_item_id;

-- « J'ai packé la commande » (extension Chrome) : un passage = qui, quand, quoi.
CREATE TABLE IF NOT EXISTS packs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  packer      TEXT,
  items       TEXT NOT NULL DEFAULT '[]',   -- [{ order_item_id, title, packed, total, reason }]
  complete    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_packs_order ON packs (order_id, id DESC);
