import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('inventory');
process.env.DASHBOARD_PASSWORD = 'secret-test';
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { createApp } = await import('../src/app.js');
const inventory = await import('../src/domain/inventory.service.js');
const { qrSvg } = await import('../src/lib/qr.js');

let server;
let base;
const AUTH = `Basic ${Buffer.from('admin:secret-test').toString('base64')}`;
const call = (path, options = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.auth === false ? {} : { Authorization: AUTH }), ...(options.headers ?? {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

describe('Inventaire : cartes et codes QR « à racheter »', () => {
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

  it('crée un objet : nom, quantité, jeton secret, adresse du code QR par défaut', () => {
    const item = inventory.createItem({ name: '  Gants   nitrile M ', reorder_at: '3' });
    assert.equal(item.name, 'Gants nitrile M');
    assert.equal(item.reorder_at, 3);
    assert.equal(item.status, 'ok');
    assert.match(item.scan_url, /^http:\/\/3dkeycap\.local\/r\/[A-Za-z0-9_-]{12}$/);
  });

  it('refuse un nom vide ou une quantité absurde', () => {
    assert.throws(() => inventory.createItem({ name: ' ' }), /nom/);
    assert.throws(() => inventory.createItem({ name: 'X', reorder_at: 'beaucoup' }), /quantité/);
    assert.throws(() => inventory.createItem({ name: 'X', reorder_at: -1 }), /quantité/);
  });

  it('le code QR est un vrai SVG qui contient l\'adresse de scan', () => {
    const svg = qrSvg('http://3dkeycap.local/r/abc');
    assert.match(svg, /^<svg/);
    assert.ok(svg.length > 500);
  });

  it('l\'adresse des codes QR se règle dans les réglages', () => {
    updateSettings({ 'inventory.scanUrl': 'http://192.168.1.50:8080/' });
    const item = inventory.createItem({ name: 'IPA 99 %', reorder_at: 1 });
    assert.match(item.scan_url, /^http:\/\/192\.168\.1\.50:8080\/r\//);
    updateSettings({ 'inventory.scanUrl': 'http://3dkeycap.local' });
  });

  it('scanner passe l\'objet à « à racheter » ; un 2e scan ne change rien mais est compté', () => {
    const { id, scan_url: url } = inventory.createItem({ name: 'Filtres résine', reorder_at: 2 });
    const token = url.split('/r/')[1];
    const first = inventory.scanByToken(token);
    assert.equal(first.alreadyFlagged, false);
    assert.equal(first.item.status, 'reorder');
    const flaggedAt = first.flaggedAt;
    const second = inventory.scanByToken(token);
    assert.equal(second.alreadyFlagged, true);
    assert.equal(second.flaggedAt, flaggedAt);
    assert.equal(inventory.getItem(id).scan_count, 2);
  });

  it('« je me suis trompé » annule seulement un scan qui avait changé l\'état', () => {
    const token = inventory.createItem({ name: 'Bâches', reorder_at: 1 }).scan_url.split('/r/')[1];
    inventory.scanByToken(token);
    assert.equal(inventory.undoScan(token).undone, true);
    assert.equal(inventory.itemByToken(token).status, 'ok');
    assert.equal(inventory.itemByToken(token).scan_count, 0);

    inventory.scanByToken(token);
    inventory.scanByToken(token); // déjà signalé : annuler ne doit pas effacer le vrai signalement
    assert.equal(inventory.undoScan(token).undone, false);
    assert.equal(inventory.itemByToken(token).status, 'reorder');
  });

  it('« commandé » remet l\'objet à OK et garde la date', () => {
    const { id, scan_url: url } = inventory.createItem({ name: 'Savon', reorder_at: 1 });
    inventory.scanByToken(url.split('/r/')[1]);
    const done = inventory.markOrdered(id);
    assert.equal(done.status, 'ok');
    assert.ok(done.ordered_at);
    assert.equal(done.flagged_at, null);
  });

  it('les objets à racheter passent en premier dans la liste', () => {
    const names = inventory.listItems().map((item) => `${item.status}:${item.name}`);
    const firstOk = names.findIndex((entry) => entry.startsWith('ok:'));
    const lastReorder = names.map((entry) => entry.startsWith('reorder:')).lastIndexOf(true);
    assert.ok(lastReorder < firstOk);
  });

  it('page de scan PUBLIQUE (sans mot de passe) : ouvrir l\'adresse ne change rien, le POST signale', async () => {
    const { id, scan_url: url } = inventory.createItem({ name: 'Éponges <b>', reorder_at: 1 });
    const token = url.split('/r/')[1];

    const page = await call(`/r/${token}`, { auth: false });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Éponges &lt;b&gt;'), 'le nom est échappé');
    assert.ok(!html.includes('<b>'));
    assert.equal(inventory.getItem(id).status, 'ok', 'un simple GET (aperçu de lien) ne signale rien');

    assert.equal((await call('/r/scan.js', { auth: false })).status, 200);
    const scan = await call(`/r/${token}/scan`, { method: 'POST', auth: false });
    assert.equal(scan.status, 200);
    assert.equal((await scan.json()).item.status, 'reorder');
  });

  it('carte inconnue : message gentil, 404', async () => {
    const page = await call('/r/jetonInconnu1', { auth: false });
    assert.equal(page.status, 404);
    assert.match(await page.text(), /ne marche plus/);
    assert.equal((await call('/r/jetonInconnu1/scan', { method: 'POST', auth: false })).status, 404);
  });

  it('l\'API et les cartes imprimables, elles, demandent le mot de passe', async () => {
    assert.equal((await call('/api/inventory', { auth: false })).status, 401);
    assert.equal((await call('/inventory/cards', { auth: false })).status, 401);
    const api = await call('/api/inventory');
    assert.equal(api.status, 200);
    assert.ok((await api.json()).items.length >= 5);
  });

  it('carte imprimable : nom, quantité, adresse et QR', async () => {
    const item = inventory.createItem({ name: 'Rouleau papier', reorder_at: 4 });
    const response = await call(`/inventory/cards?ids=${item.id}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Rouleau papier'));
    assert.ok(html.includes('Quand il en reste 4'));
    assert.ok(html.includes(item.scan_url));
    assert.ok(html.includes('<svg'));
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), 'pas de script en ligne (CSP)');
    const qr = await call(`/api/inventory/${item.id}/qr.svg`);
    assert.equal(qr.headers.get('content-type').split(';')[0], 'image/svg+xml');
  });

  it('supprimer un objet invalide sa carte', async () => {
    const item = inventory.createItem({ name: 'Éphémère', reorder_at: 1 });
    const token = item.scan_url.split('/r/')[1];
    inventory.deleteItem(item.id);
    assert.equal((await call(`/r/${token}`, { auth: false })).status, 404);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM inventory_events WHERE item_id = ?').get(item.id).n, 0);
  });
});
