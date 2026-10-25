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

// Étiquettes de 2 po × 1 po (50,8 × 25,4 mm), une par page à l'impression : imprimante d'étiquettes.
const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px system-ui, -apple-system, sans-serif; color: #000; background: #eef0f4; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 10px 18px; background: #1c2230; color: #fff; z-index: 2; }
  .bar button { padding: 8px 14px; border: 0; border-radius: 8px; background: #d9c7a3; color: #1c2230; font: 700 14px system-ui; cursor: pointer; }
  .bar span { opacity: .8; font-size: 13px; }
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm; justify-content: center; padding: 10mm; }
  .label { width: 50.8mm; height: 25.4mm; padding: 1.8mm; background: #fff; display: grid; grid-template-columns: 1fr 21.5mm; gap: 1.5mm; align-items: center; overflow: hidden; break-inside: avoid; box-shadow: 0 0 0 0.2mm #c3c9d6; }
  .label .txt { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 1mm; }
  .label h2 { margin: 0; font-weight: 800; line-height: 1.12; word-break: break-word; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
  .label .qty { align-self: flex-start; padding: 0.3mm 1.2mm; border: 0.25mm solid #000; border-radius: 99px; font-weight: 700; font-size: 2.6mm; line-height: 1.3; white-space: nowrap; }
  .label svg { width: 21.5mm; height: 21.5mm; display: block; }
  @media print {
    @page { size: 2in 1in; margin: 0; }
    body { background: #fff; }
    .bar { display: none; }
    .sheet { display: block; padding: 0; }
    .label { box-shadow: none; page-break-after: always; margin: 0; }
  }
`;

/** Taille du nom selon sa longueur : la place est de 24 × 18 mm environ. */
const nameSize = (name) => {
  const length = String(name).length;
  if (length <= 10) return 4.4;
  if (length <= 18) return 3.6;
  if (length <= 30) return 3;
  if (length <= 48) return 2.5;
  return 2.2;
};

const cardHtml = (item) => `
  <article class="label">
    <div class="txt">
      <h2 style="font-size:${nameSize(item.name)}mm">${esc(item.name)}</h2>
      <div class="qty">Scanner à ${esc(item.reorder_at)}</div>
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
<title>Étiquettes d’inventaire</title><style>${PAGE_CSS}</style></head>
<body>
  <div class="bar"><button id="print">🖨 Imprimer</button><span>${items.length} étiquette(s) de 2 po × 1 po · choisis ce format de papier dans la fenêtre d’impression, sans marges, échelle 100 %</span></div>
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
  form { text-align: left; margin-top: 8px; }
  fieldset { border: 0; margin: 0 0 16px; padding: 0; }
  legend, label.lbl { display: block; margin-bottom: 8px; font-weight: 700; font-size: 16px; }
  .opts { display: flex; flex-wrap: wrap; gap: 8px; }
  .opt { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 2px solid #d5dbe8; border-radius: 12px; background: #fff; font-size: 16px; cursor: pointer; }
  .opt:has(input:checked) { border-color: #1f5fd6; background: #eaf1ff; }
  .opt input { width: 18px; height: 18px; }
  input[type=text], input[type=number] { width: 100%; padding: 12px; border: 2px solid #d5dbe8; border-radius: 12px; font: inherit; }
  .send { width: 100%; background: #1f5fd6; color: #fff; font-size: 18px; padding: 14px; }
  .err { color: #a02828; font-size: 15px; margin: 0 0 8px; }
`;

const scanPage = ({ token, title, body, tone = 'soft', questions = null }) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${SCAN_CSS}</style></head>
<body data-token="${esc(token)}"${questions ? ` data-questions="${esc(JSON.stringify(questions))}"` : ''}><main id="box" class="${tone}">${body}</main><script src="/r/scan.js"></script></body></html>`;

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
  // avec des questions (couleur, quantité…) la page les pose d'abord : toujours rien d'enregistré à l'ouverture
  const asks = item.questions.length > 0;
  res.type('html').send(
    scanPage({
      token,
      title: `Racheter : ${item.name}`,
      questions: asks ? item.questions : null,
      body: asks
        ? `<div class="big">🛒</div><h1>${esc(item.name)}</h1><p>Qu’est-ce qui manque ?</p><noscript><p>Active JavaScript pour répondre.</p></noscript>`
        : `<div class="big">⏳</div><h1>Un instant…</h1><p>On note qu’il faut racheter <span class="name">${esc(item.name)}</span>.</p><noscript><p>Active JavaScript pour que le signalement soit envoyé.</p></noscript>`,
    }),
  );
});

scanRouter.post(
  '/:token/scan',
  asyncRoute((req, res) => {
    res.json(scanByToken(req.params.token, req.body?.answers));
  }),
);

scanRouter.post(
  '/:token/undo',
  asyncRoute((req, res) => {
    res.json(undoScan(req.params.token));
  }),
);

