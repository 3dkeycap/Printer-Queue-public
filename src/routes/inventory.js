import path from 'node:path';
import { Router } from 'express';
import { config } from '../config.js';
import { asyncRoute, badRequest } from '../lib/errors.js';
import { qrSvg } from '../lib/qr.js';
import {
  createItem,
  deleteItem,
  flagItem,
  getItem,
  itemByToken,
  listItems,
  markOrdered,
  scanByToken,
  undoScan,
  updateItem,
} from '../domain/inventory.service.js';

/* ------------------------------------------------------------ API (tableau de bord) */

export const inventoryRouter = Router();

inventoryRouter.get('/', (req, res) => {
  res.json({ items: listItems() });
});

inventoryRouter.post(
  '/',
  asyncRoute((req, res) => {
    res.status(201).json(createItem(req.body ?? {}));
  }),
);

inventoryRouter.patch(
  '/:id',
  asyncRoute((req, res) => {
    res.json(updateItem(req.params.id, req.body ?? {}));
  }),
);

inventoryRouter.delete(
  '/:id',
  asyncRoute((req, res) => {
    res.json(deleteItem(req.params.id));
  }),
);

inventoryRouter.post('/:id/flag', (req, res) => {
  res.json(flagItem(req.params.id));
});

inventoryRouter.post('/:id/ordered', (req, res) => {
  res.json(markOrdered(req.params.id));
});

/** Le code QR d'un objet, en SVG. */
inventoryRouter.get('/:id/qr.svg', (req, res) => {
  const item = getItem(req.params.id);
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(qrSvg(item.scan_url));
});

/* ------------------------------------------------------- cartes à imprimer (HTML) */

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px system-ui, -apple-system, sans-serif; color: #1c2230; background: #eef0f4; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 10px 18px; background: #1c2230; color: #fff; }
  .bar button { padding: 8px 14px; border: 0; border-radius: 8px; background: #d9c7a3; color: #1c2230; font: 700 14px system-ui; cursor: pointer; }
  .bar span { opacity: .8; font-size: 13px; }
  .sheet { display: grid; grid-template-columns: repeat(2, 90mm); gap: 8mm; justify-content: center; padding: 10mm; }
  .card { width: 90mm; min-height: 62mm; padding: 5mm; background: #fff; border: 0.4mm dashed #8a93a6; border-radius: 3mm; display: grid; grid-template-columns: 1fr 34mm; gap: 4mm; align-items: center; break-inside: avoid; }
  .card h2 { margin: 0 0 3mm; font-size: 6.2mm; line-height: 1.15; word-break: break-word; }
  .card p { margin: 0 0 2mm; font-size: 3.6mm; line-height: 1.35; }
  .card .qty { display: inline-block; padding: 1mm 3mm; margin: 1mm 0 3mm; border-radius: 99px; background: #fff3cd; border: 0.3mm solid #e8d48a; font-weight: 700; font-size: 4.2mm; }
  .card .url { margin-top: 2mm; font-size: 2.6mm; color: #6a7387; word-break: break-all; }
  .card svg { width: 34mm; height: 34mm; display: block; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { padding: 0; gap: 4mm; }
    .card { border-color: #999; }
    @page { margin: 10mm; }
  }
`;

const cardHtml = (item) => `
  <article class="card">
    <div>
      <h2>${esc(item.name)}</h2>
      <div class="qty">Quand il en reste ${esc(item.reorder_at)}</div>
      <p>👉 <strong>Scanne ce code</strong> avec ton téléphone : l’app note toute seule qu’il faut en racheter.</p>
      ${item.notes ? `<p>${esc(item.notes)}</p>` : ''}
      <div class="url">${esc(item.scan_url)}</div>
    </div>
    ${qrSvg(item.scan_url, { cellSize: 8, margin: 1 })}
  </article>`;

export const inventoryPagesRouter = Router();

/** Cartes imprimables : /inventory/cards?ids=1,2 (toutes si pas d'ids). */
inventoryPagesRouter.get('/cards', (req, res) => {
  const wanted = String(req.query.ids ?? '')
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);
  const items = listItems().filter((item) => !wanted.length || wanted.includes(item.id));
  if (!items.length) throw badRequest('Aucune carte à imprimer');
  // le script d'impression est un fichier à part : la politique de sécurité interdit les scripts en ligne
  res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartes d’inventaire</title><style>${PAGE_CSS}</style></head>
<body>
  <div class="bar"><button id="print">🖨 Imprimer</button><span>${items.length} carte(s) · découpe le long du pointillé et colle-la sur l’étagère ou la boîte</span></div>
  <main class="sheet">${items.map(cardHtml).join('')}</main>
  <script src="/js/print-cards.js"></script>
</body></html>`);
});

/* ---------------------------------------------- scan d'un code QR (public, téléphone) */

export const scanRouter = Router();

scanRouter.get('/scan.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(config.publicDir, 'js', 'scan.js'));
});

const SCAN_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 20px; font: 18px system-ui, -apple-system, sans-serif; color: #1c2230; background: #eef0f4; }
  main { width: min(440px, 100%); background: #fff; border-radius: 18px; padding: 28px 24px; text-align: center; box-shadow: 0 18px 50px -24px rgba(20,30,60,.4); }
  .big { font-size: 56px; line-height: 1; margin-bottom: 10px; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  p { margin: 0 0 10px; color: #4a5368; font-size: 16px; line-height: 1.45; }
  .name { font-weight: 800; color: #1c2230; }
  button { margin-top: 12px; padding: 12px 18px; border: 0; border-radius: 12px; background: #e8ecf4; color: #1c2230; font: 700 16px system-ui; cursor: pointer; }
  a { color: #1f5fd6; }
  .ok .big, .ok h1 { color: #16663a; }
  .soft .big, .soft h1 { color: #8a4b0c; }
`;

const scanPage = ({ token, title, body, tone = 'soft' }) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${SCAN_CSS}</style></head>
<body data-token="${esc(token)}"><main id="box" class="${tone}">${body}</main><script src="/r/scan.js"></script></body></html>`;

/**
 * Ouvrir l'adresse du code ne change RIEN (les aperçus de lien et les antivirus la
 * visitent) : c'est le petit script de la page qui envoie le signalement.
 */
scanRouter.get('/:token', (req, res) => {
  const token = req.params.token;
  const item = itemByToken(token);
  if (!item) {
    return res.status(404).type('html').send(
      scanPage({
        token,
        title: 'Carte inconnue',
        body: '<div class="big">🤔</div><h1>Cette carte ne marche plus</h1><p>Elle ne correspond à aucun objet de l’inventaire (il a peut-être été supprimé). Préviens la personne qui gère l’inventaire.</p>',
      }),
    );
  }
  res.type('html').send(
    scanPage({
      token,
      title: `Racheter : ${item.name}`,
      body: `<div class="big">⏳</div><h1>Un instant…</h1><p>On note qu’il faut racheter <span class="name">${esc(item.name)}</span>.</p><noscript><p>Active JavaScript pour que le signalement soit envoyé.</p></noscript>`,
    }),
  );
});

scanRouter.post(
  '/:token/scan',
  asyncRoute((req, res) => {
    res.json(scanByToken(req.params.token));
  }),
);

scanRouter.post(
  '/:token/undo',
  asyncRoute((req, res) => {
    res.json(undoScan(req.params.token));
  }),
);

