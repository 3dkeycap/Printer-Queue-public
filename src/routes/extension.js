import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { createZip } from '../lib/zip.js';
import { getSettings } from '../domain/settings.service.js';
import { qzCertificate, qzSign } from '../integrations/qzTray.js';

export const extensionRouter = Router();

const EXTENSION_DIR = path.join(config.rootDir, 'chrome-extension');

/**
 * Télécharge l'extension Chrome en .zip, avec l'adresse de cette app et le
 * Client ID Chit Chats pré-remplis (defaults.json) : il n'y a plus qu'à confirmer.
 */
extensionRouter.get('/extension.zip', (req, res) => {
  if (!fs.existsSync(EXTENSION_DIR)) return res.status(404).json({ error: 'Extension absente de cette installation' });

  // tous les fichiers, sous-dossiers compris (icons/…)
  const files = fs
    .readdirSync(EXTENSION_DIR, { recursive: true })
    .map((name) => String(name).split(path.sep).join('/'))
    .filter((name) => fs.statSync(path.join(EXTENSION_DIR, name)).isFile())
    .map((name) => ({ name: `resin-queue-extension/${name}`, data: fs.readFileSync(path.join(EXTENSION_DIR, name)) }));

  const settings = getSettings();
  const defaults = {
    appUrl: `${req.protocol}://${req.get('host')}`,
    chitchatsClientId: settings['chitchats.clientId'] || '',
    chitchatsTemplate: settings['chitchats.shipUrlTemplate'] || '',
  };
  files.push({ name: 'resin-queue-extension/defaults.json', data: JSON.stringify(defaults, null, 2) });

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="resin-queue-extension.zip"');
  res.send(createZip(files));
});

/*
 * QZ Tray (impression directe de l'étiquette VAT par l'extension) : le certificat public de l'atelier, en JSON pour
 * l'extension et en fichier à ajouter UNE fois dans QZ Tray (Site Manager → Allowed → +). La clé privée ne sort
 * jamais : l'app signe chaque demande de QZ Tray.
 */
extensionRouter.get('/qz/certificate', (req, res) => {
  res.json({ certificate: qzCertificate() });
});
extensionRouter.get('/qz/certificate.crt', (req, res) => {
  res.set('Content-Type', 'application/x-x509-ca-cert');
  res.set('Content-Disposition', 'attachment; filename="3d-keycap-lab-qz.crt"');
  res.send(qzCertificate());
});
extensionRouter.post('/qz/sign', (req, res) => {
  const request = req.body?.request;
  if (typeof request !== 'string' || !request) return res.status(400).json({ error: 'request manquant' });
  res.json({ signature: qzSign(request) });
});
