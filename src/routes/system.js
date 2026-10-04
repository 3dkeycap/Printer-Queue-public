import { Router } from 'express';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { getUpdateStatus, requestUpdate } from '../domain/updater.service.js';

export const systemRouter = Router();

systemRouter.get('/update', (req, res) => {
  res.json(getUpdateStatus());
});

/** { action: 'check' | 'update' } : exécuté par le conteneur « updater ». */
systemRouter.post(
  '/update',
  asyncRoute((req, res) => {
    const action = req.body?.action ?? 'update';
    if (!['check', 'update'].includes(action)) throw badRequest('`action` : check ou update');
    res.status(202).json(requestUpdate(action));
  }),
);
