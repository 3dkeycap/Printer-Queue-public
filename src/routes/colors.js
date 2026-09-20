import { Router } from 'express';
import { asyncRoute, badRequest, notFound } from '../lib/errors.js';
import { createColor, deleteColor, listColors, updateColor } from '../domain/colors.js';

export const colorsRouter = Router();

colorsRouter.get('/', (req, res) => {
  res.json({ items: listColors({ activeOnly: req.query.active === '1' }) });
});

colorsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const { key, name } = req.body ?? {};
    if (!key && !name) throw badRequest('`key` or `name` is required');
    res.status(201).json(createColor(req.body));
  }),
);

colorsRouter.delete(
  '/:key',
  asyncRoute((req, res) => {
    res.json(deleteColor(req.params.key));
  }),
);

colorsRouter.patch(
  '/:key',
  asyncRoute((req, res) => {
    const color = updateColor(req.params.key, req.body ?? {});
    if (!color) throw notFound(`Colour ${req.params.key} not found`);
    res.json(color);
  }),
);
