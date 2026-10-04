import { Router } from 'express';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { connectorStatus, describeSettings, updateSettings } from '../domain/settings.service.js';
import { writeUpdaterConfig } from '../domain/updater.service.js';

export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  res.json({ items: describeSettings(), connectors: connectorStatus() });
});

settingsRouter.put(
  '/',
  asyncRoute((req, res) => {
    const patch = req.body ?? {};
    if (typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('Corps attendu : un objet { clé: valeur }');
    const result = updateSettings(patch);
    if (result.applied.some((key) => key.startsWith('update.'))) writeUpdaterConfig();
    res.json({ ...result, connectors: connectorStatus() });
  }),
);
