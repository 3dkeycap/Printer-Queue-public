import cron from 'node-cron';
import { config } from '../config.js';
import { createLogger } from '../lib/logger.js';
import { syncAllSources } from './syncOrders.js';
import { syncShipments } from './syncShipments.js';

const log = createLogger('scheduler');

let running = false;

/** Prevents two overlapping runs when an API is slow. */
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

export const startScheduler = () => {
  const tasks = [];

  if (!cron.validate(config.jobs.syncCron)) {
    throw new Error(`Invalid SYNC_CRON expression: ${config.jobs.syncCron}`);
  }
  if (!cron.validate(config.jobs.shipmentCron)) {
    throw new Error(`Invalid SHIPMENT_CRON expression: ${config.jobs.shipmentCron}`);
  }

  tasks.push(
    cron.schedule(
      config.jobs.syncCron,
      guarded('orders', () => syncAllSources({ trigger: 'cron' })),
    ),
  );
  tasks.push(
    cron.schedule(
      config.jobs.shipmentCron,
      guarded('shipments', () => syncShipments({ trigger: 'cron' })),
    ),
  );

  log.info('scheduler started', {
    orders: config.jobs.syncCron,
    shipments: config.jobs.shipmentCron,
    mode: config.integrations.mode,
  });

  if (config.jobs.runOnBoot) {
    setTimeout(
      guarded('boot', async () => {
        await syncAllSources({ trigger: 'boot' });
        await syncShipments({ trigger: 'boot' });
      }),
      2000,
    );
  }

  return () => tasks.forEach((task) => task.stop());
};
