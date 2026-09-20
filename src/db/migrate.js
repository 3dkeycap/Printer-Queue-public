import fs from 'node:fs';
import { createRequire } from 'node:module';
import { getDb, nowIso } from './index.js';
import { createLogger } from '../lib/logger.js';

const require = createRequire(import.meta.url);
const log = createLogger('migrate');

const SCHEMA_PATH = new URL('./schema.sql', import.meta.url);
const SEED_COLORS = require('./colors.seed.json');

/**
 * Applies the schema (idempotent) and seeds the resin catalogue.
 * Safe to call on every boot of every container.
 */
export const migrate = () => {
  const db = getDb();
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

  db.exec(schema);

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
