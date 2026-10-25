import qrcode from 'qrcode-generator';

/** Code QR en SVG (correction d'erreur « M » : lisible même sur une carte un peu abîmée). */
export const qrSvg = (text, { cellSize = 6, margin = 2 } = {}) => {
  const qr = qrcode(0, 'M'); // 0 = taille choisie automatiquement
  qr.addData(String(text));
  qr.make();
  return qr.createSvgTag({ cellSize, margin, scalable: true });
};
