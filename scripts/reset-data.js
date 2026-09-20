/**
 * Vide la production : commandes, pièces, historiques, journaux.
 * Le catalogue de résines et les réglages sont conservés.
 *
 *   node scripts/reset-data.js --yes
 *   docker compose exec app node scripts/reset-data.js --yes
 */
import { closeDb, getDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { createLogger } from '../src/lib/logger.js';

const log = createLogger('reset');

if (!process.argv.includes('--yes')) {
  console.error(
    'Cette commande supprime TOUTES les commandes et pièces de la base.\n' +
      'Relancez-la avec --yes pour confirmer.',
  );
  process.exit(1);
}

migrate();
const db = getDb();

const before = db.prepare('SELECT COUNT(*) AS parts FROM parts').get();

db.transaction(() => {
  db.exec('DELETE FROM part_events');
  db.exec('DELETE FROM parts');
  db.exec('DELETE FROM order_items');
  db.exec('DELETE FROM orders');
  db.exec('DELETE FROM sync_runs');
  db.exec('DELETE FROM webhook_events');
  db.exec("DELETE FROM settings WHERE key LIKE 'cursor:%' OR key LIKE 'mock_seed:%'");
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('parts','orders','order_items','part_events','sync_runs','webhook_events')");
})();

db.exec('VACUUM');
log.info('production data cleared', { deletedParts: before.parts });
closeDb();
