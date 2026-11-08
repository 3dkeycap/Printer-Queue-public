import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
import { PACKED_TAG, addPacker, addPartsToOrder, getPackingView, getVatLabel, pushShopifyOrderTag, savePack, setOrderTag, syncShopifyTags } from '../domain/packing.js';

export const packingRouter = Router();

/** Extension Chrome : commande ouverte dans l'admin Shopify (id numérique Shopify). */
packingRouter.get('/shopify/:shopifyId', (req, res) => {
  res.json(getPackingView({ shopifyId: req.params.shopifyId }));
});
packingRouter.post(
  '/shopify/:shopifyId',
  asyncRoute(async (req, res) => {
    const view = savePack({ shopifyId: req.params.shopifyId }, req.body ?? {});
    const shopifyTags = await syncShopifyTags(view);
    res.json({ ...view, shopifyTags });
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
    const shopifyTags = await syncShopifyTags(view);
    res.json({ ...view, shopifyTags });
  }),
);

packingRouter.post(
  '/packers',
  asyncRoute((req, res) => {
    res.json(addPacker(req.body?.name));
  }),
);

/** Tag de commande coché / décoché depuis l'extension : { tag, on } ; Shopify le reçoit aussi. */
const tagRoute = (key) =>
  asyncRoute(async (req, res) => {
    const result = setOrderTag({ [key]: req.params.id }, req.body?.tag, req.body?.on);
    res.json({ orderTags: result.orderTags, shopifyTags: await pushShopifyOrderTag(result) });
  });
packingRouter.post('/shopify/:id/tags', tagRoute('shopifyId'));
packingRouter.post('/etsy/:id/tags', tagRoute('etsyId'));
packingRouter.post('/orders/:id/tags', tagRoute('orderId'));

/** Pièce(s) ajoutée(s) à la commande depuis l'extension : { name, variant?, quantity?, adder? }. */
const addPartsRoute = (key) =>
  asyncRoute(async (req, res) => {
    const { view, unpacked, order } = addPartsToOrder({ [key]: req.params.id }, req.body ?? {});
    // le bac n'est plus complet : « Pre packed » est retiré aussi dans Shopify
    const shopifyTags = unpacked ? await pushShopifyOrderTag({ ...order, tag: PACKED_TAG, on: false }) : null;
    res.json({ ...view, shopifyTags });
  });
packingRouter.post('/shopify/:id/parts', addPartsRoute('shopifyId'));
packingRouter.post('/etsy/:id/parts', addPartsRoute('etsyId'));
packingRouter.post('/orders/:id/parts', addPartsRoute('orderId'));

/** Données de l'étiquette VAT (le PNG est dessiné par l'extension). */
packingRouter.get('/etsy/:id/vat', (req, res) => {
  res.json(getVatLabel({ etsyId: req.params.id }));
});
packingRouter.get('/orders/:id/vat', (req, res) => {
  res.json(getVatLabel({ orderId: req.params.id }));
});
