import { Router } from 'express';
import { getFailureReport } from '../domain/failures.service.js';

export const failuresRouter = Router();

/** Taux d'échec par fichier + historique de chaque échec. */
failuresRouter.get('/', (req, res) => {
  res.json(getFailureReport({ limit: req.query.limit }));
});
