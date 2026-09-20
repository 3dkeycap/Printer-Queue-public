/**
 * Worker container entrypoint: owns the cron jobs (order polling every 5 min,
 * Chit Chats reconciliation every 15 min). It shares the SQLite file with the
 * API container through the `pq-data` volume.
 */
import { closeDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createLogger } from '../lib/logger.js';
import { startScheduler } from './scheduler.js';

const log = createLogger('worker');

migrate();
const stop = startScheduler();

const shutdown = (signal) => {
  log.info('shutting down', { signal });
  stop();
  closeDb();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => log.error('unhandled rejection', { error: String(error) }));

log.info('worker ready');
