import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
import { addPacker, getPackingView, savePack, syncShopifyTags } from '../domain/packing.js';

export const packingRouter = Router();

/** Extension Chrome : commande ouverte dans l'admin Shopify (id numérique Shopify). */
packingRouter.get('/shopify/:shopifyId', (req, res) => {
  res.json(getPackingView({ shopifyId: req.params.shopifyId }));
});
packingRouter.post(
  '/shopify/:shopifyId',
  asyncRoute(async (req, res) => {
    const view = savePack({ shopifyId: req.params.shopifyId }, req.body ?? {});
    res.json({ ...view, shopifyTags: await syncShopifyTags(view) });
  }),
);

/** Extension Chrome : commande ouverte dans Etsy Shop Manager (n° de commande Etsy). */
packingRouter.get('/etsy/:etsyId', (req, res) => {
  res.json(getPackingView({ etsyId: req.params.etsyId }));
});
packingRouter.post(
  '/etsy/:etsyId',
  asyncRoute((req, res) => {
    res.json(savePack({ etsyId: req.params.etsyId }, req.body ?? {}));
  }),
);

/** Même chose depuis l'app (id local de la commande). */
packingRouter.get('/orders/:orderId', (req, res) => {
  res.json(getPackingView({ orderId: req.params.orderId }));
});
packingRouter.post(
  '/orders/:orderId',
  asyncRoute(async (req, res) => {
    const view = savePack({ orderId: req.params.orderId }, req.body ?? {});
    res.json({ ...view, shopifyTags: await syncShopifyTags(view) });
  }),
);

packingRouter.post(
  '/packers',
  asyncRoute((req, res) => {
    res.json(addPacker(req.body?.name));
  }),
);
