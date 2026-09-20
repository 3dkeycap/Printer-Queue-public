/** One-shot sync, handy for debugging: `npm run sync:once`. */
import { closeDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../lib/logger.js';
import { syncAllSources } from './syncOrders.js';
import { syncShipments } from './syncShipments.js';

const log = createLogger('sync:once');

migrate();
const orders = await syncAllSources({ trigger: 'manual' });
const shipments = await syncShipments({ trigger: 'manual' });
log.info('done', { orders, shipments });
closeDb();
