import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
import { importOrdersToChitChats } from '../domain/chitchatsImport.js';
import { getOrder, listOrders, markOrderShipped } from '../domain/orders.service.js';

export const ordersRouter = Router();

ordersRouter.get('/', (req, res) => {
  res.json({ items: listOrders(req.query) });
});

ordersRouter.get(
  '/:id',
  asyncRoute((req, res) => {
    res.json(getOrder(req.params.id));
  }),
);

/** « Réessayer » sur une commande dont l'import Chit Chats a échoué. */
ordersRouter.post(
  '/:id/chitchats-import',
  asyncRoute(async (req, res) => {
    const order = getOrder(req.params.id);
    res.json(await importOrdersToChitChats({ trigger: 'manual', orderId: order.id }));
  }),
);

/** Manual "this parcel is gone" button, when Chit Chats is not in the loop. */
ordersRouter.post(
  '/:id/ship',
  asyncRoute((req, res) => {
    const order = getOrder(req.params.id);
    const result = markOrderShipped(order.id, req.body ?? {}, { actor: 'dashboard' });
    res.json(result);
  }),
);
