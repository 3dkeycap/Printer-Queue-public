import { Router } from 'express';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { listOpen, reportShopify } from '../domain/presence.js';

export const presenceRouter = Router();

presenceRouter.get('/', (req, res) => {
  res.json({ items: listOpen() });
});

/** Extension Chrome : { clientId, tabId, orderExternalId, user, state: 'open' | 'close' } */
presenceRouter.post(
  '/shopify',
  asyncRoute((req, res) => {
    const body = req.body ?? {};
    if (body.state !== 'close' && !/^\d+$/.test(String(body.orderExternalId ?? ''))) {
      throw badRequest('`orderExternalId` (id numérique de la commande Shopify) est requis');
    }
    res.json(reportShopify(body));
  }),
);
