import { config } from './config.js';
import { backupBeforeUpgrade, recordBuild } from './db/backup.js';
import { closeDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { createLogger } from './lib/logger.js';
import { createApp } from './app.js';
import { writeUpdaterConfig } from './domain/updater.service.js';
import { startScheduler } from './jobs/scheduler.js';

const log = createLogger('server');

// mise à jour : copie de la base avant que les migrations n'y touchent
backupBeforeUpgrade();
migrate();
recordBuild();
writeUpdaterConfig();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  log.info('dashboard listening', {
    url: `http://${config.host}:${config.port}`,
    mode: config.integrations.mode,
    auth: config.auth.enabled ? 'basic' : 'disabled',
    build: config.buildId,
  });
});

/**
 * The worker normally runs in its own container. Set SCHEDULER_INLINE=true to
 * run everything in a single process (bare-metal / `npm start` setups).
 */
let stopScheduler = () => {};
if (['1', 'true', 'yes'].includes(String(process.env.SCHEDULER_INLINE).toLowerCase())) {
  stopScheduler = startScheduler();
  log.info('inline scheduler enabled');
}

const shutdown = (signal) => {
  log.info('shutting down', { signal });
  stopScheduler();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
