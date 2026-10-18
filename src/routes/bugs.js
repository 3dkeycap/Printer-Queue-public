import { Router } from 'express';
import { asyncRoute } from '../lib/errors.js';
import {
  bugReportForClaude,
  createBugReport,
  deleteBugReport,
  getBugReport,
  listBugReports,
  setBugStatus,
} from '../domain/bugs.js';

export const bugsRouter = Router();

bugsRouter.get('/', (req, res) => {
  res.json({ items: listBugReports() });
});

bugsRouter.post(
  '/',
  asyncRoute((req, res) => {
    res.status(201).json(createBugReport(req.body ?? {}));
  }),
);

bugsRouter.get('/:id', (req, res) => {
  res.json(getBugReport(req.params.id));
});

/** Texte Markdown pour Claude (description, contexte, journaux). */
bugsRouter.get('/:id/claude.md', (req, res) => {
  res.type('text/markdown; charset=utf-8').send(bugReportForClaude(req.params.id));
});

/** La capture d'écran seule, en image. */
bugsRouter.get('/:id/screenshot', (req, res) => {
  const bug = getBugReport(req.params.id);
  const match = /^data:(image\/[a-z]+);base64,(.*)$/.exec(bug.screenshot ?? '');
  if (!match) return res.status(404).json({ error: 'Pas de capture' });
  res.type(match[1]).send(Buffer.from(match[2], 'base64'));
});

bugsRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    res.json(setBugStatus(req.params.id, req.body?.status));
  }),
);

bugsRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    res.json(deleteBugReport(req.params.id));
  }),
);
