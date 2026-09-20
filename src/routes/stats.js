import { Router } from 'express';
import { getInventory, getSummary } from '../domain/stats.service.js';

export const statsRouter = Router();

statsRouter.get('/summary', (req, res) => {
  res.json(getSummary());
});

statsRouter.get('/inventory', (req, res) => {
  res.json({ items: getInventory() });
});
