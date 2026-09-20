import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { STATUSES } from '../domain/statuses.js';

export const metaRouter = Router();

metaRouter.get('/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', mode: config.integrations.mode, uptime: process.uptime() });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

/** Everything the front-end needs to render itself (statuses, cron, mode). */
metaRouter.get('/meta', (req, res) => {
  res.json({
    statuses: STATUSES,
    mode: config.integrations.mode,
    syncCron: config.jobs.syncCron,
    shipmentCron: config.jobs.shipmentCron,
    version: '1.0.0',
  });
});
