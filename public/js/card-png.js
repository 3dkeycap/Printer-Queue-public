/*
 * Étiquette d'inventaire en image PNG (à imprimer sur une imprimante d'étiquettes, à envoyer…).
 * Dessinée sur un canvas aux dimensions de l'étiquette imprimée (2 po × 1 po, 600 × 300 px à
 * 300 dpi) : même contenu que la page /inventory/cards.
 */
const MM = 300 / 25.4; // pixels par millimètre à 300 dpi
const LABEL_W_MM = 50.8; // 2 po
const LABEL_H_MM = 25.4; // 1 po
const px = (mm) => Math.round(mm * MM);
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/** Coupe un texte en lignes qui tiennent dans `maxWidth` (mots trop longs coupés). */
const wrap = (ctx, text, maxWidth) => {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let chunk = word;
    while (ctx.measureText(chunk).width > maxWidth && chunk.length > 1) {
      let cut = chunk.length - 1;
      while (cut > 1 && ctx.measureText(chunk.slice(0, cut)).width > maxWidth) cut -= 1;
      if (line) { lines.push(line); line = ''; }
      lines.push(chunk.slice(0, cut));
      chunk = chunk.slice(cut);
    }
    const attempt = line ? `${line} ${chunk}` : chunk;
    if (ctx.measureText(attempt).width <= maxWidth) line = attempt;
    else { lines.push(line); line = chunk; }
  }
  if (line) lines.push(line);
  return lines;
};

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Le code QR ne se charge pas'));
    image.src = src;
  });

/** Dessine l'étiquette (2 po × 1 po) et renvoie le canvas. */
export const drawCard = async (item) => {
  const qr = await loadImage(`/api/inventory/${item.id}/qr.svg`);
  const width = px(LABEL_W_MM);
  const height = px(LABEL_H_MM);
  const pad = px(1.8);
  const qrSize = px(21.5);
  const textWidth = width - pad * 2 - qrSize - px(1.5);
  const label = `Scanner à ${item.reorder_at}`;
  const pillMm = 2.6;
  const pill = px(4.2);
  const available = height - pad * 2 - pill - px(1);

  const measure = document.createElement('canvas').getContext('2d');
  // le nom rétrécit (jusqu'à 2,2 mm) pour tenir dans la hauteur de l'étiquette
  let nameMm = 4.4;
  let nameLines;
  for (;;) {
    measure.font = `700 ${px(nameMm)}px ${FONT}`;
    nameLines = wrap(measure, item.name, textWidth);
    // jamais de mot coupé au milieu tant qu'on peut encore rétrécir
    const widest = Math.max(...String(item.name).split(/\s+/).map((word) => measure.measureText(word).width));
    if ((nameLines.length * px(nameMm) * 1.12 <= available && widest <= textWidth) || nameMm <= 2.2) break;
    nameMm = Math.round((nameMm - 0.2) * 10) / 10;
  }
  const nameLH = px(nameMm) * 1.12;
  nameLines = nameLines.slice(0, Math.max(1, Math.floor(available / nameLH)));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';

  const blockHeight = nameLines.length * nameLH + px(1) + pill;
  let y = Math.max(pad, (height - blockHeight) / 2);
  ctx.fillStyle = '#000000';
  ctx.font = `700 ${px(nameMm)}px ${FONT}`;
  for (const line of nameLines) { ctx.fillText(line, pad, y); y += nameLH; }
  y += px(1);

  // pastille « Scanner à N » : en noir et blanc, lisible sur une imprimante d'étiquettes
  ctx.font = `700 ${px(pillMm)}px ${FONT}`;
  const pillWidth = Math.min(textWidth, ctx.measureText(label).width + px(2.4));
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = px(0.25);
  roundRect(ctx, pad, y, pillWidth, pill, pill / 2);
  ctx.stroke();
  ctx.fillText(label, pad + px(1.2), y + (pill - px(pillMm)) / 2);

  // code QR, net (pas de lissage : les modules restent des carrés)
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(width - pad - qrSize, (height - qrSize) / 2, qrSize, qrSize);
  ctx.drawImage(qr, width - pad - qrSize, (height - qrSize) / 2, qrSize, qrSize);
  return canvas;
};

const slug = (text) =>
  String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'objet';

/** Télécharge l'étiquette : etiquette-<nom>.png */
export const downloadCardPng = async (item) => {
  const canvas = await drawCard(item);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("L'image n'a pas pu être créée");
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `etiquette-${slug(item.name)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
};
