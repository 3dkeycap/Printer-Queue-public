import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getDb, nowIso } from './index.js';
import { createLogger } from '../lib/logger.js';
import { LEGACY_STATUS_MAP } from '../domain/statuses.js';

const require = createRequire(import.meta.url);
const log = createLogger('migrate');

const SCHEMA_PATH = new URL('./schema.sql', import.meta.url);
const SEED_COLORS = require('./colors.seed.json');

/**
 * Applies the schema (idempotent) and seeds the resin catalogue.
 * Safe to call on every boot of every container.
 */
/** `ALTER TABLE ... ADD COLUMN` idempotent (SQLite n'a pas de IF NOT EXISTS). */
const addColumnIfMissing = (db, table, column, definition) => {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (exists) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log.info('column added', { table, column });
  return true;
};

export const migrate = () => {
  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  // la vue est recréée à chaque démarrage pour suivre l'évolution des colonnes
  db.exec('DROP VIEW IF EXISTS v_parts_full');
  db.exec(schema);

  // bases créées avant l'ajout des colonnes UV / commentaire
  addColumnIfMissing(db, 'parts', 'uv', 'TEXT');
  addColumnIfMissing(db, 'parts', 'comment', 'TEXT');

  // statuts retirés en v2 (FILE_READY, IN_INVENTORY) -> équivalent actuel
  for (const [legacy, replacement] of Object.entries(LEGACY_STATUS_MAP)) {
    const info = db.prepare('UPDATE parts SET status = ? WHERE status = ?').run(replacement, legacy);
    if (info.changes) log.info('legacy status migrated', { legacy, replacement, parts: info.changes });
  }

  const insertColor = db.prepare(
    `INSERT INTO resin_colors (key, name, hex, aliases, sort_order, updated_at)
     VALUES (@key, @name, @hex, @aliases, @sort_order, @updated_at)
     ON CONFLICT (key) DO UPDATE SET
       name = excluded.name,
       hex = CASE WHEN resin_colors.hex = '' THEN excluded.hex ELSE resin_colors.hex END,
       aliases = excluded.aliases,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
  );

  const seed = db.transaction(() => {
    for (const color of SEED_COLORS) {
      insertColor.run({
        key: color.key,
        name: color.name,
        hex: color.hex,
        aliases: JSON.stringify(color.aliases ?? []),
        sort_order: color.sort_order ?? 100,
        updated_at: nowIso(),
      });
    }
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', '1', ?)
       ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
    ).run(nowIso());
  });

  seed();
  log.info('schema applied', { colors: SEED_COLORS.length });
  return db;
};

// `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  log.info('migration finished');
}
