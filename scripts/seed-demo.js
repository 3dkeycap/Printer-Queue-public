/**
 * Fills the database with a believable production day:
 * several sync cycles, parts spread across every status, a low resin stock and
 * one parcel already scanned by Chit Chats.  `npm run seed:demo`
 */
import { getDb, nowIso } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';
import { setStatus } from '../src/domain/parts.service.js';
import { syncAllSources } from '../src/jobs/syncOrders.js';
import { syncShipments } from '../src/jobs/syncShipments.js';
import { createLogger } from '../src/lib/logger.js';

const log = createLogger('seed');

migrate();
const db = getDb();

for (let cycle = 0; cycle < 4; cycle += 1) {
  await syncAllSources({ trigger: 'manual' });
}

const parts = db.prepare('SELECT id FROM parts ORDER BY id').all();
const plan = [
  ['FILE_READY', 0.22],
  ['PRINTING', 0.14],
  ['FAILED', 0.06],
  ['DONE', 0.16],
  ['IN_INVENTORY', 0.18],
];

let cursor = 0;
for (const [status, share] of plan) {
  const count = Math.round(parts.length * share);
  for (let i = 0; i < count && cursor < parts.length; i += 1, cursor += 1) {
    const path = {
      FILE_READY: ['FILE_READY'],
      PRINTING: ['FILE_READY', 'PRINTING'],
      FAILED: ['FILE_READY', 'PRINTING', 'FAILED'],
      DONE: ['FILE_READY', 'PRINTING', 'DONE'],
      IN_INVENTORY: ['FILE_READY', 'PRINTING', 'DONE', 'IN_INVENTORY'],
    }[status];
    for (const step of path) setStatus(parts[cursor].id, step, { actor: 'dashboard', note: 'Données de démonstration' });
  }
}

// a couple of rush parts + a realistic resin stock
db.prepare('UPDATE parts SET priority = 1 WHERE id IN (SELECT id FROM parts ORDER BY RANDOM() LIMIT 3)').run();
db.prepare(`UPDATE parts SET printer = 'Mars 4 Ultra #' || (1 + ABS(RANDOM()) % 4) WHERE status IN ('PRINTING','DONE')`).run();
db.prepare(`UPDATE resin_colors SET stock_grams = ABS(RANDOM()) % 2400, updated_at = ?`).run(nowIso());
db.prepare(`UPDATE resin_colors SET stock_grams = 180 WHERE key = 'black'`).run();

// fully produced orders -> Chit Chats ships them on the next reconciliation
await syncShipments({ trigger: 'manual' });

// refill the end of the pipeline so every column of the board has content
const queued = db.prepare(`SELECT id FROM parts WHERE status = 'TO_PRINT' ORDER BY RANDOM()`).all();
queued.slice(0, Math.floor(queued.length / 2)).forEach((part, index) => {
  const path = index % 2 ? ['FILE_READY', 'PRINTING', 'DONE'] : ['FILE_READY', 'PRINTING', 'DONE', 'IN_INVENTORY'];
  for (const step of path) setStatus(part.id, step, { actor: 'dashboard', note: 'Données de démonstration' });
});

const summary = db
  .prepare('SELECT status, COUNT(*) AS n FROM parts GROUP BY status')
  .all()
  .reduce((acc, row) => ({ ...acc, [row.status]: row.n }), {});

log.info('demo data ready', summary);
