import { Router } from 'express';
import { getDb } from '../db/index.js';
import { BOARD_STATUSES, STATUSES } from '../domain/statuses.js';
import { connectorStatus, getSettings } from '../domain/settings.service.js';

export const metaRouter = Router();

metaRouter.get('/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (error) {
    res.status(503).json({ status: 'error', error: error.message });
  }
});

/** Everything the front-end needs to render itself (statuses, cron, mode). */
metaRouter.get('/meta', (req, res) => {
  const settings = getSettings();
  res.json({
    statuses: STATUSES,
    boardStatuses: BOARD_STATUSES,
    uvOptions: settings['production.uvOptions'],
    commentOptions: settings['production.commentOptions'],
    defaultUv: settings['production.defaultUv'],
    syncCron: settings['schedule.syncCron'],
    shipmentCron: settings['schedule.shipmentCron'],
    connectors: connectorStatus(),
    version: '2.0.0',
  });
});
