/*
 * Carte d'inventaire en image PNG (à imprimer ailleurs, à envoyer, à coller dans
 * un document…). Dessinée sur un canvas aux dimensions de la carte imprimée
 * (90 × 62 mm à 300 dpi) : même contenu que la page /inventory/cards.
 */
const MM = 300 / 25.4; // pixels par millimètre à 300 dpi
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

/** Dessine la carte et renvoie le canvas. */
export const drawCard = async (item) => {
  const qr = await loadImage(`/api/inventory/${item.id}/qr.svg`);
  const width = px(90);
  const qrSize = px(34);
  const pad = px(5);
  const textWidth = width - pad * 2 - qrSize - px(4);

  const measure = document.createElement('canvas').getContext('2d');
  // un nom long rétrécit (jusqu'à 3,8 mm) plutôt que d'être coupé ; au pire on garde 5 lignes
  let nameMm = 6.2;
  let nameLines;
  for (;;) {
    measure.font = `700 ${px(nameMm)}px ${FONT}`;
    nameLines = wrap(measure, item.name, textWidth);
    if (nameLines.length <= 4 || nameMm <= 3.8) break;
    nameMm = Math.round((nameMm - 0.4) * 10) / 10;
  }
  nameLines = nameLines.slice(0, 5);
  // la pastille rétrécit aussi si le texte est long, sans jamais être écrasé
  let pillMm = 4.2;
  const label = `Quand il en reste ${item.reorder_at}`;
  for (;;) {
    measure.font = `700 ${px(pillMm)}px ${FONT}`;
    if (measure.measureText(label).width + px(6) <= textWidth || pillMm <= 2.6) break;
    pillMm = Math.round((pillMm - 0.2) * 10) / 10;
  }
  measure.font = `400 ${px(3.6)}px ${FONT}`;
  const helpLines = wrap(measure, 'Scanne ce code avec ton téléphone : l’app note toute seule qu’il faut en racheter.', textWidth);
  const noteLines = item.notes ? wrap(measure, item.notes, textWidth).slice(0, 2) : [];

  const nameLH = px(nameMm) * 1.15;
  const helpLH = px(3.6) * 1.35;
  const pill = px(8.2);
  const urlLines = (() => {
    measure.font = `400 ${px(2.6)}px ${FONT}`;
    return wrap(measure, item.scan_url, textWidth);
  })();
  const contentHeight =
    nameLines.length * nameLH + px(2) + pill + px(3) + helpLines.length * helpLH +
    (noteLines.length ? px(2) + noteLines.length * helpLH : 0) + px(2) + urlLines.length * px(3.2);
  const height = Math.max(px(62), Math.ceil(contentHeight + pad * 2));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // cadre en pointillé (ligne de découpe)
  ctx.strokeStyle = '#8a93a6';
  ctx.lineWidth = px(0.4);
  ctx.setLineDash([px(1.6), px(1.2)]);
  roundRect(ctx, ctx.lineWidth, ctx.lineWidth, width - ctx.lineWidth * 2, height - ctx.lineWidth * 2, px(3));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textBaseline = 'top';
  let y = Math.max(pad, (height - contentHeight) / 2);
  ctx.fillStyle = '#1c2230';
  ctx.font = `700 ${px(nameMm)}px ${FONT}`;
  for (const line of nameLines) { ctx.fillText(line, pad, y); y += nameLH; }
  y += px(2);

  // pastille « Quand il en reste N »
  ctx.font = `700 ${px(pillMm)}px ${FONT}`;
  const pillWidth = Math.min(textWidth, ctx.measureText(label).width + px(6));
  ctx.fillStyle = '#fff3cd';
  ctx.strokeStyle = '#e8d48a';
  ctx.lineWidth = px(0.3);
  roundRect(ctx, pad, y, pillWidth, pill, pill / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1c2230';
  ctx.fillText(label, pad + px(3), y + (pill - px(pillMm)) / 2);
  y += pill + px(3);

  ctx.font = `400 ${px(3.6)}px ${FONT}`;
  for (const line of helpLines) { ctx.fillText(line, pad, y); y += helpLH; }
  if (noteLines.length) {
    y += px(2);
    for (const line of noteLines) { ctx.fillText(line, pad, y); y += helpLH; }
  }
  y += px(2);
  ctx.fillStyle = '#6a7387';
  ctx.font = `400 ${px(2.6)}px ${FONT}`;
  for (const line of urlLines) { ctx.fillText(line, pad, y); y += px(3.2); }

  // code QR, net (pas de lissage : les modules restent des carrés)
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(width - pad - qrSize, (height - qrSize) / 2, qrSize, qrSize);
  ctx.drawImage(qr, width - pad - qrSize, (height - qrSize) / 2, qrSize, qrSize);
  return canvas;
};

const slug = (text) =>
  String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'objet';

/** Télécharge la carte : carte-<nom>.png */
export const downloadCardPng = async (item) => {
  const canvas = await drawCard(item);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error("L'image n'a pas pu être créée");
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `carte-${slug(item.name)}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
};
