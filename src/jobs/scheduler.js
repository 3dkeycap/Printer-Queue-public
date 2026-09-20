import cron from 'node-cron';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { getSettings } from '../domain/settings.service.js';
import { syncAllSources } from './syncOrders.js';
import { syncShipments } from './syncShipments.js';

const log = createLogger('scheduler');

let running = false;

/** Empêche deux exécutions simultanées quand une API est lente. */
const guarded = (name, fn) => async () => {
  if (running) {
    log.warn('previous job still running, skipping tick', { job: name });
    return;
  }
  running = true;
  try {
    await fn();
  } catch (error) {
    log.error('job crashed', { job: name, error: error.message });
  } finally {
    running = false;
  }
};

const schedule = (expression, fallback, handler) => {
  const valid = cron.validate(expression) ? expression : fallback;
  if (valid !== expression) {
    log.warn('invalid cron expression, falling back', { expression, fallback });
  }
  return { expression: valid, task: cron.schedule(valid, handler) };
};

/**
 * Démarre les deux tâches planifiées et surveille les réglages : changer une
 * expression cron depuis la page Intégrations reprogramme le worker en moins
 * d'une minute, sans redémarrage de conteneur.
 */
export const startScheduler = () => {
  const settings = getSettings();

  let orders = schedule(
    settings['schedule.syncCron'],
    config.jobs.syncCron,
    guarded('orders', () => syncAllSources({ trigger: 'cron' })),
  );
  let shipments = schedule(
    settings['schedule.shipmentCron'],
    config.jobs.shipmentCron,
    guarded('shipments', () => syncShipments({ trigger: 'cron' })),
  );

  log.info('scheduler started', { orders: orders.expression, shipments: shipments.expression });

  const watcher = setInterval(() => {
    const current = getSettings();
    if (current['schedule.syncCron'] !== orders.expression) {
      orders.task.stop();
      orders = schedule(
        current['schedule.syncCron'],
        config.jobs.syncCron,
        guarded('orders', () => syncAllSources({ trigger: 'cron' })),
      );
      log.info('orders schedule updated', { expression: orders.expression });
    }
    if (current['schedule.shipmentCron'] !== shipments.expression) {
      shipments.task.stop();
      shipments = schedule(
        current['schedule.shipmentCron'],
        config.jobs.shipmentCron,
        guarded('shipments', () => syncShipments({ trigger: 'cron' })),
      );
      log.info('shipments schedule updated', { expression: shipments.expression });
    }
  }, 60000);
  watcher.unref?.();

  if (config.jobs.runOnBoot) {
    setTimeout(
      guarded('boot', async () => {
        await syncAllSources({ trigger: 'boot' });
        await syncShipments({ trigger: 'boot' });
      }),
      2000,
    );
  }

  return () => {
    clearInterval(watcher);
    orders.task.stop();
    shipments.task.stop();
  };
};
