import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db/index.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('qz-tray');

/*
 * QZ Tray (logiciel installé sur l'ordinateur de l'atelier) imprime directement sur une imprimante, sans la fenêtre
 * d'impression de Chrome : l'extension s'en sert pour l'étiquette VAT d'Etsy. Sans signature, QZ Tray demande
 * « Allow / Block » à chaque impression ; avec un certificat qu'on lui a fait accepter une fois (Site Manager), plus rien.
 *
 * Le certificat et sa clé sont créés par l'app au premier besoin et gardés en base (`internal.*`, jamais renvoyés par
 * l'API des réglages). Seul le certificat public se télécharge ; la clé privée ne sort jamais : l'app signe à la demande.
 * Pas d'openssl dans l'image Docker : le certificat X.509 auto-signé est écrit ici, en DER, avec node:crypto.
 */
const CERT_KEY = 'internal.qzCertificate';
const PRIVATE_KEY = 'internal.qzPrivateKey';

// --- DER minimal (juste ce qu'il faut pour un certificat) -------------------------------------------------------------
const length = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let rest = n; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const sequence = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const integer = (buffer) => tlv(0x02, buffer[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buffer]) : buffer);
const nullValue = () => Buffer.from([0x05, 0x00]);
const utf8 = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const bitString = (buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), buffer]));
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * a + b];
  for (const value of rest) {
    const chunk = [value & 0x7f];
    for (let v = value >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
};
// UTCTime jusqu'en 2049, GeneralizedTime ensuite (règle X.509)
const time = (date) => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
};
const name = (commonName, organization) =>
  sequence(set(sequence(oid('2.5.4.10'), utf8(organization))), set(sequence(oid('2.5.4.3'), utf8(commonName))));

const SHA256_RSA = sequence(oid('1.2.840.113549.1.1.11'), nullValue());

/** Certificat auto-signé (PEM) + clé privée (PEM PKCS#8). Exporté pour les tests. */
export const createSelfSignedCertificate = ({ commonName = '3D Keycap Lab', organization = '3D Keycap Lab', years = 20 } = {}) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600e3);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + years);
  const issuer = name(commonName, organization);
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // v3
    integer(crypto.randomBytes(16)),
    SHA256_RSA,
    issuer,
    sequence(time(notBefore), time(notAfter)),
    issuer,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const der = sequence(tbs, SHA256_RSA, bitString(signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
  return { certificate: pem, privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
};

/** Le certificat de l'atelier (créé et gardé en base au premier appel). */
export const qzCertificate = () => {
  const stored = getSetting(CERT_KEY);
  if (stored && getSetting(PRIVATE_KEY)) return stored;
  const created = createSelfSignedCertificate();
  setSetting(CERT_KEY, created.certificate);
  setSetting(PRIVATE_KEY, created.privateKey);
  log.info('qz tray certificate created');
  return created.certificate;
};

/** Signature d'une requête QZ Tray (SHA512 + RSA, en base64), comme l'attend `qz.security.setSignaturePromise`. */
export const qzSign = (toSign) => {
  qzCertificate();
  return crypto.sign('sha512', Buffer.from(String(toSign), 'utf8'), getSetting(PRIVATE_KEY)).toString('base64');
};
