import { Router } from 'express';
import { asyncRoute, badRequest, notFound } from '../lib/errors.js';
import {
  bulkSetStatus,
  createManualPart,
  deletePart,
  getFacets,
  getPart,
  listEvents,
  listParts,
  listPrinters,
  setStatus,
  updatePart,
} from '../domain/parts.service.js';

export const partsRouter = Router();

partsRouter.get('/', (req, res) => {
  res.json(listParts(req.query));
});

partsRouter.get('/facets', (req, res) => {
  res.json(getFacets(req.query));
});

partsRouter.get('/printers', (req, res) => {
  res.json({ printers: listPrinters() });
});

partsRouter.post(
  '/',
  asyncRoute((req, res) => {
    const parts = createManualPart(req.body ?? {});
    res.status(201).json({ items: parts });
  }),
);

partsRouter.post(
  '/bulk/status',
  asyncRoute((req, res) => {
    const { ids, status, note, force } = req.body ?? {};
    if (!Array.isArray(ids) || !ids.length) throw badRequest('`ids` must be a non-empty array');
    if (!status) throw badRequest('`status` is required');
    const result = bulkSetStatus(ids, status, { actor: 'dashboard', note, force });
    res.json(result);
  }),
);

partsRouter.get('/:id', (req, res) => {
  const part = getPart(req.params.id);
  if (!part) throw notFound(`Part ${req.params.id} not found`);
  res.json({ ...part, events: listEvents(part.id) });
});

partsRouter.get('/:id/events', (req, res) => {
  res.json({ items: listEvents(req.params.id) });
});

partsRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    res.json(updatePart(req.params.id, req.body ?? {}, { actor: 'dashboard' }));
  }),
);

partsRouter.post(
  '/:id/status',
  asyncRoute((req, res) => {
    const { status, note, force } = req.body ?? {};
    if (!status) throw badRequest('`status` is required');
    res.json(setStatus(req.params.id, status, { actor: 'dashboard', note, force }));
  }),
);

partsRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    res.json(deletePart(req.params.id));
  }),
);
