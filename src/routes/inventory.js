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
  itemImage,
  listItems,
  listItemsForCards,
  markOrdered,
  newItemUrl,
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

inventoryRouter.post(
  '/:id/flag',
  asyncRoute((req, res) => {
    res.json(flagItem(req.params.id, req.body?.answers));
  }),
);

inventoryRouter.post('/:id/ordered', (req, res) => {
  res.json(markOrdered(req.params.id));
});

/** Code QR de la page « ajouter depuis le téléphone » (affiché sur la page Inventaire). */
inventoryRouter.get('/phone-qr.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(qrSvg(newItemUrl()));
});

/** La photo d'un objet (celle de l'étiquette grand format). */
inventoryRouter.get('/:id/image', (req, res) => {
  const image = itemImage(req.params.id);
  if (!image) return res.status(404).json({ error: "Cet objet n'a pas de photo" });
  res.type(image.mime).set('Cache-Control', 'no-cache').send(image.buffer);
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
  .label .qty { align-self: flex-start; padding: 0.3mm 1.2mm; border: 0.25mm solid #000; border-radius: 1.6mm; font-weight: 700; font-size: 2.6mm; line-height: 1.25; }
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

/** « 2 rouleaux » : le nombre suivi de l'unité choisie (facultative). */
const withUnit = (value, unit) => `${value}${unit ? ` ${unit}` : ''}`;

const cardHtml = (item) => `
  <article class="label">
    <div class="txt">
      <h2 style="font-size:${nameSize(item.name)}mm">${esc(item.name)}</h2>
      <div class="qty">Scanner à ${esc(withUnit(item.reorder_at, item.unit))}</div>
    </div>
    ${qrSvg(item.scan_url, { cellSize: 8, margin: 1 })}
  </article>`;

/*
 * Étiquette grand format : 4 par feuille Lettre (8,5 × 11 po, marges de 0,25 po, 2 × 2 cases de 4 × 5,25 po) ;
 * nom, minimum, quantité à commander et fournisseur (facultatifs), photo et code QR.
 */
const LARGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px system-ui, -apple-system, sans-serif; color: #1c2230; background: #eef0f4; }
  .bar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; padding: 10px 18px; background: #1c2230; color: #fff; z-index: 2; }
  .bar button { padding: 8px 14px; border: 0; border-radius: 8px; background: #d9c7a3; color: #1c2230; font: 700 14px system-ui; cursor: pointer; }
  .bar span { opacity: .8; font-size: 13px; }
  .page { width: 8in; display: grid; grid-template-columns: 4in 4in; grid-auto-rows: 5.25in; margin: 12px auto; background: #fff; box-shadow: 0 6px 24px -12px rgba(20,30,60,.4); }
  .big { position: relative; padding: 0.22in 0.25in; display: flex; flex-direction: column; gap: 0.12in; outline: 0.01in dashed #b6bdcc; outline-offset: -0.01in; overflow: hidden; }
  .big .band { height: 0.14in; border-radius: 0.07in; background: #2f9e5b; flex: none; }
  .big h2 { margin: 0.02in 0 0; text-align: center; font-weight: 800; line-height: 1.12; overflow-wrap: anywhere; flex: none; }
  .facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.1in 0.45in; text-align: center; flex: none; }
  .facts .wide { flex-basis: 100%; }
  .facts .k { display: block; color: #2f9e5b; font-weight: 700; font-size: 0.15in; }
  .facts .v { display: block; font-size: 0.24in; font-weight: 600; overflow-wrap: anywhere; }
  .media { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; gap: 0.2in; }
  .media svg { width: 1.75in; height: 1.75in; flex: none; }
  .media img { flex: 1; min-width: 0; max-height: 100%; max-width: 1.7in; aspect-ratio: 1; object-fit: cover; border-radius: 0.12in; }
  .media.solo svg { width: 2.3in; height: 2.3in; }
  @media print {
    @page { size: letter; margin: 0.25in; }
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; box-shadow: none; width: 8in; break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
  }
`;

const largeNameSize = (name) => {
  const length = String(name).length;
  if (length <= 14) return 0.36;
  if (length <= 26) return 0.3;
  if (length <= 44) return 0.24;
  return 0.2;
};

const largeCardHtml = (item) => `
  <article class="big">
    <div class="band"></div>
    <h2 style="font-size:${largeNameSize(item.name)}in">${esc(item.name)}</h2>
    <div class="facts">
      <div><span class="k">Minimum</span><span class="v">${esc(withUnit(item.reorder_at, item.unit))}</span></div>
      ${item.order_qty !== null && item.order_qty !== undefined ? `<div><span class="k">À commander</span><span class="v">${esc(withUnit(item.order_qty, item.unit))}</span></div>` : ''}
      ${item.supplier ? `<div class="wide"><span class="k">Commander chez</span><span class="v">${esc(item.supplier)}</span></div>` : ''}
    </div>
    <div class="media${item.image ? '' : ' solo'}">
      ${qrSvg(item.scan_url, { cellSize: 8, margin: 1 })}
      ${item.image ? `<img src="${esc(item.image)}" alt="">` : ''}
    </div>
  </article>`;

const largePages = (items) => {
  const pages = [];
  for (let i = 0; i < items.length; i += 4) pages.push(`<section class="page">${items.slice(i, i + 4).map(largeCardHtml).join('')}</section>`);
  return pages.join('');
};

export const inventoryPagesRouter = Router();

/** Cartes imprimables : /inventory/cards?ids=1,2 (toutes si pas d'ids). */
inventoryPagesRouter.get('/cards', (req, res) => {
  const wanted = String(req.query.ids ?? '')
    .split(',')
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isFinite);
  const items = listItemsForCards(wanted);
  if (!items.length) throw badRequest('Aucune carte à imprimer');
  const large = req.query.style === 'large';
  // le script d'impression est un fichier à part : la politique de sécurité interdit les scripts en ligne
  res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Étiquettes d’inventaire</title><style>${large ? LARGE_CSS : PAGE_CSS}</style></head>
<body>
  <div class="bar"><button id="print">🖨 Imprimer</button><span>${
    large
      ? `${items.length} étiquette(s) grand format · 4 par feuille Lettre (${Math.ceil(items.length / 4)} feuille(s)) · imprime à l’échelle 100 %, marges par défaut`
      : `${items.length} étiquette(s) de 2 po × 1 po · choisis ce format de papier dans la fenêtre d’impression, sans marges, échelle 100 %`
  }</span></div>
  ${large ? `<main>${largePages(items)}</main>` : `<main class="sheet">${items.map(cardHtml).join('')}</main>`}
  <script src="/js/print-cards.js"></script>
</body></html>`);
});

/**
 * Étiquette « Ajouter à l'inventaire » : un code QR à coller dans l'atelier qui ouvre la page d'ajout du téléphone.
 * Mêmes formats que les étiquettes d'objets (?style=small : 2 po × 1 po, ?style=large : 4 par feuille Lettre, ici une seule).
 */
inventoryPagesRouter.get('/add-card', (req, res) => {
  const large = req.query.style === 'large';
  const url = newItemUrl();
  const label = large
    ? `<section class="page"><article class="big">
         <div class="band"></div>
         <h2 style="font-size:0.36in">Ajouter à l’inventaire</h2>
         <div class="facts"><div class="wide"><span class="v">Scanne ce code avec ton téléphone pour ajouter un objet</span></div></div>
         <div class="media solo">${qrSvg(url, { cellSize: 8, margin: 1 })}</div>
       </article></section>`
    : `<main class="sheet"><article class="label">
         <div class="txt"><h2 style="font-size:3.4mm">Ajouter à l’inventaire</h2><div class="qty">Scanne</div></div>
         ${qrSvg(url, { cellSize: 8, margin: 1 })}
       </article></main>`;
  res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Étiquette : ajouter à l’inventaire</title><style>${large ? LARGE_CSS : PAGE_CSS}</style></head>
<body>
  <div class="bar"><button id="print">🖨 Imprimer</button><span>${esc(url)}</span></div>
  ${label}
  <script src="/js/print-cards.js"></script>
</body></html>`);
});

/* ------------------------------------------- ajouter un objet depuis le téléphone */

const NEW_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; padding: 16px; font: 17px system-ui, -apple-system, sans-serif; color: #1c2230; background: #eef0f4; }
  main { width: min(480px, 100%); margin: 0 auto; background: #fff; border-radius: 18px; padding: 22px 18px 26px; box-shadow: 0 18px 50px -24px rgba(20,30,60,.4); }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .sub { margin: 0 0 16px; color: #5a6479; font-size: 15px; }
  label { display: block; margin: 14px 0 6px; font-weight: 700; font-size: 15px; }
  .opt { font-weight: 400; color: #7b859a; }
  input[type=text], input[type=number] { width: 100%; padding: 13px; border: 2px solid #d5dbe8; border-radius: 12px; font: inherit; background: #fff; }
  .photo { display: flex; gap: 12px; align-items: center; }
  .photo img { width: 84px; height: 84px; object-fit: cover; border-radius: 12px; border: 1px solid #d5dbe8; }
  .photo img[hidden] { display: none; }
  .snap { display: inline-block; padding: 13px 16px; border-radius: 12px; background: #e8ecf4; font-weight: 700; cursor: pointer; }
  .snap input { display: none; }
  .send { width: 100%; margin-top: 22px; padding: 15px; border: 0; border-radius: 14px; background: #1f5fd6; color: #fff; font: 700 18px system-ui; cursor: pointer; }
  .send[disabled] { opacity: .6; }
  select { width: 100%; padding: 13px; border: 2px solid #d5dbe8; border-radius: 12px; font: inherit; background: #fff; }
  .qbox { margin-top: 18px; border-top: 1px solid #e3e8f1; padding-top: 12px; }
  .qbox summary { font-weight: 700; cursor: pointer; }
  .q { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; padding: 12px; border: 1px solid #d5dbe8; border-radius: 12px; }
  .qchoice { display: flex; flex-direction: column; gap: 8px; }
  .qchoice[hidden], .qchoice input[hidden] { display: none; }
  .chk { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 400; }
  .chk input { width: 20px; height: 20px; }
  .qadd, .qdel { padding: 12px; border: 0; border-radius: 12px; background: #e8ecf4; color: #1c2230; font: 700 15px system-ui; cursor: pointer; }
  .qdel { background: transparent; color: #a02828; font-weight: 600; padding: 4px; }
  .err { color: #a02828; font-size: 15px; min-height: 1.2em; margin: 12px 0 0; }
  .done { text-align: center; }
  .done .big { font-size: 56px; }
  .done a, .done button { display: block; width: 100%; margin-top: 12px; padding: 14px; border: 0; border-radius: 12px; background: #e8ecf4; color: #1c2230; font: 700 16px system-ui; text-decoration: none; cursor: pointer; }
`;

inventoryPagesRouter.get('/new', (req, res) => {
  const suppliers = [...new Set(listItems().map((item) => item.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  res.type('html').send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Ajouter à l’inventaire</title><style>${NEW_CSS}</style></head>
<body data-suppliers="${esc(JSON.stringify(suppliers))}"><main id="box"></main><script type="module" src="/js/inventory-new.js"></script></body></html>`);
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

