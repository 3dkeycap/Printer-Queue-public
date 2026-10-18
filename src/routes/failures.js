import { Router } from 'express';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { getFailureReport, setFileHidden } from '../domain/failures.service.js';

export const failuresRouter = Router();

/** Taux d'échec par fichier + historique de chaque échec. */
failuresRouter.get('/', (req, res) => {
  res.json(getFailureReport({ limit: req.query.limit }));
});

/** { name, hidden } : masque / ré-affiche un fichier dans la page « Échecs ». */
failuresRouter.put(
  '/hidden',
  asyncRoute((req, res) => {
    const { name, hidden } = req.body ?? {};
    if (!name || typeof name !== 'string') throw badRequest('`name` est obligatoire');
    res.json({ hiddenFiles: setFileHidden(name, hidden !== false) });
  }),
);
