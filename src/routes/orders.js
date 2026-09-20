import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
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

/** Manual "this parcel is gone" button, when Chit Chats is not in the loop. */
ordersRouter.post(
  '/:id/ship',
  asyncRoute((req, res) => {
    const order = getOrder(req.params.id);
    const result = markOrderShipped(order.id, req.body ?? {}, { actor: 'dashboard' });
    res.json(result);
  }),
);
