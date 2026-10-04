import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
import { addPacker, getPackingView, savePack } from '../domain/packing.js';

export const packingRouter = Router();

/** Extension Chrome : commande ouverte dans l'admin Shopify (id numérique Shopify). */
packingRouter.get('/shopify/:shopifyId', (req, res) => {
  res.json(getPackingView({ shopifyId: req.params.shopifyId }));
});
packingRouter.post(
  '/shopify/:shopifyId',
  asyncRoute((req, res) => {
    res.json(savePack({ shopifyId: req.params.shopifyId }, req.body ?? {}));
  }),
);

/** Même chose depuis l'app (id local de la commande). */
packingRouter.get('/orders/:orderId', (req, res) => {
  res.json(getPackingView({ orderId: req.params.orderId }));
});
packingRouter.post(
  '/orders/:orderId',
  asyncRoute((req, res) => {
    res.json(savePack({ orderId: req.params.orderId }, req.body ?? {}));
  }),
);

packingRouter.post(
  '/packers',
  asyncRoute((req, res) => {
    res.json(addPacker(req.body?.name));
  }),
);
