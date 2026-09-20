import { Router } from 'express';
import { getSummary } from '../domain/stats.service.js';

export const statsRouter = Router();

statsRouter.get('/summary', (req, res) => {
  res.json(getSummary());
});
