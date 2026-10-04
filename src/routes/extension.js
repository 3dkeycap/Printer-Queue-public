import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { createZip } from '../lib/zip.js';

export const extensionRouter = Router();

const EXTENSION_DIR = path.join(config.rootDir, 'chrome-extension');

/**
 * Télécharge l'extension Chrome en .zip, avec l'adresse de cette app
 * pré-remplie (defaults.json) : il n'y a plus qu'à la confirmer.
 */
extensionRouter.get('/extension.zip', (req, res) => {
  if (!fs.existsSync(EXTENSION_DIR)) return res.status(404).json({ error: 'Extension absente de cette installation' });

  const files = fs
    .readdirSync(EXTENSION_DIR)
    .filter((name) => fs.statSync(path.join(EXTENSION_DIR, name)).isFile())
    .map((name) => ({ name: `resin-queue-extension/${name}`, data: fs.readFileSync(path.join(EXTENSION_DIR, name)) }));

  const appUrl = `${req.protocol}://${req.get('host')}`;
  files.push({ name: 'resin-queue-extension/defaults.json', data: JSON.stringify({ appUrl }, null, 2) });

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="resin-queue-extension.zip"');
  res.send(createZip(files));
});
