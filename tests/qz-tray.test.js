import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('qz-tray');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getSetting } = await import('../src/db/index.js');
const { describeSettings } = await import('../src/domain/settings.service.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

describe('QZ Tray : certificat de l’atelier et signature', () => {
  before(async () => {
    migrate();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  });

  it('crée un certificat X.509 auto-signé valide, le même à chaque appel', async () => {
    const first = await (await fetch(`${base}/api/qz/certificate`)).json();
    const second = await (await fetch(`${base}/api/qz/certificate`)).json();
    assert.equal(first.certificate, second.certificate);
    const x509 = new crypto.X509Certificate(first.certificate);
    assert.match(x509.subject, /CN=3D Keycap Lab/);
    assert.ok(x509.verify(x509.publicKey), 'auto-signé');
    assert.ok(new Date(x509.validTo) > new Date(Date.now() + 10 * 365 * 24 * 3600e3), 'valable longtemps');
    const file = await fetch(`${base}/api/qz/certificate.crt`);
    assert.match(file.headers.get('content-disposition'), /attachment/);
    assert.equal(await file.text(), first.certificate);
  });

  it('signe en SHA512 avec la clé du certificat, qui ne sort jamais', async () => {
    const { certificate } = await (await fetch(`${base}/api/qz/certificate`)).json();
    const request = 'a1b2c3d4';
    const { signature } = await (await fetch(`${base}/api/qz/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) })).json();
    assert.ok(crypto.verify('sha512', Buffer.from(request), certificate, Buffer.from(signature, 'base64')));
    // ni l'API des réglages ni aucune réponse ne contient la clé privée
    const key = getSetting('internal.qzPrivateKey');
    assert.match(key, /PRIVATE KEY/);
    assert.ok(!JSON.stringify(describeSettings()).includes('PRIVATE KEY'));
    const missing = await fetch(`${base}/api/qz/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 400);
  });
});
