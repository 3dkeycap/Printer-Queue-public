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
    assert.match(item.scan_url, /^http:\/\/192\.168\.1\.223:8080\/r\/[A-Za-z0-9_-]{12}$/);
  });

  it('le nom d\'hôte accepte « 3dkeycap.local », un port, une IP ou une adresse complète', () => {
    assert.equal(inventory.normalizeBaseUrl('3dkeycap.local'), 'http://3dkeycap.local');
    assert.equal(inventory.normalizeBaseUrl(' 3dkeycap.local:8080/ '), 'http://3dkeycap.local:8080');
    assert.equal(inventory.normalizeBaseUrl('192.168.1.50:8080'), 'http://192.168.1.50:8080');
    assert.equal(inventory.normalizeBaseUrl('https://queue.exemple.com//'), 'https://queue.exemple.com');
    assert.equal(inventory.normalizeBaseUrl(''), 'http://192.168.1.223:8080');
    updateSettings({ 'inventory.scanUrl': 'atelier.local' });
    assert.match(inventory.createItem({ name: 'Hôte', reorder_at: 1 }).scan_url, /^http:\/\/atelier\.local\/r\//);
    updateSettings({ 'inventory.scanUrl': '' });
    assert.match(inventory.createItem({ name: 'Hôte 2', reorder_at: 1 }).scan_url, /^http:\/\/192\.168\.1\.223:8080\/r\//);
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
    updateSettings({ 'inventory.scanUrl': 'http://192.168.1.223:8080' });
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

  it('étiquette imprimable 2 po × 1 po : nom, quantité et QR', async () => {
    const item = inventory.createItem({ name: 'Rouleau papier', reorder_at: 4 });
    const response = await call(`/inventory/cards?ids=${item.id}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('Rouleau papier'));
    assert.ok(html.includes('Scanner à 4'));
    assert.ok(html.includes('size: 2in 1in'), 'page d’impression = une étiquette de 2 po × 1 po');
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

  describe('questions au scan (couleur, texte, nombre)', () => {
    const questions = [
      { label: 'Quelle résine ?', type: 'choice', colors: true, multiple: true },
      { label: 'Taille', type: 'choice', choices: 'S, M, L' },
      { label: 'Combien ?', type: 'number' },
      { label: 'Remarque', type: 'text' },
    ];

    it('crée les questions et lit les couleurs de résine du catalogue', () => {
      const item = inventory.createItem({ name: 'Résine à commander', reorder_at: 1, questions });
      assert.equal(item.questions.length, 4);
      assert.ok(item.questions[0].choices.length > 3, 'les résines actives sont proposées');
      assert.deepEqual(item.questions[1].choices, ['S', 'M', 'L']);
      assert.throws(() => inventory.createItem({ name: 'X', questions: [{ label: 'Vide', type: 'choice', choices: ' ' }] }), /au moins un choix/);
      assert.throws(() => inventory.createItem({ name: 'X', questions: [{ label: ' ', type: 'text' }] }), /titre/);
    });

    it('le scan exige les réponses, les garde, et elles s’accumulent jusqu’à la commande', () => {
      const item = inventory.createItem({ name: 'Résine accumulée', reorder_at: 1, questions });
      const token = item.scan_url.split('/r/')[1];
      const red = item.questions[0].choices[0];
      const blue = item.questions[0].choices[1];
      assert.throws(() => inventory.scanByToken(token), /Choisis une réponse/);
      assert.throws(() => inventory.scanByToken(token, { q0: ['Inconnue'], q1: 'M', q2: '2', q3: 'ok' }), /inconnue/);
      assert.throws(() => inventory.scanByToken(token, { q0: [red], q1: 'M', q2: 'beaucoup', q3: 'ok' }), /nombre/);
      assert.equal(inventory.getItem(item.id).status, 'ok', 'une réponse refusée ne signale rien');

      const first = inventory.scanByToken(token, { q0: [red, blue], q1: 'M', q2: '2,5', q3: 'urgent' });
      assert.equal(first.alreadyFlagged, false);
      assert.deepEqual(first.item.flag_details[0].answers, [
        { label: 'Quelle résine ?', value: `${red}, ${blue}` },
        { label: 'Taille', value: 'M' },
        { label: 'Combien ?', value: '2.5' },
        { label: 'Remarque', value: 'urgent' },
      ]);
      const second = inventory.scanByToken(token, { q0: [red], q1: 'L', q2: '1', q3: 'aussi' });
      assert.equal(second.alreadyFlagged, true);
      assert.equal(second.item.flag_details.length, 2);

      // annuler enlève seulement le dernier signalement, l'objet reste « à racheter »
      const undone = inventory.undoScan(token);
      assert.equal(undone.undone, true);
      assert.equal(undone.item.status, 'reorder');
      assert.equal(undone.item.flag_details.length, 1);

      assert.deepEqual(inventory.markOrdered(item.id).flag_details, []);
    });

    it('le bouton « À racheter » du tableau de bord demande aussi les réponses', async () => {
      const item = inventory.createItem({ name: 'Flag tableau', reorder_at: 1, questions: [{ label: 'Taille', type: 'choice', choices: 'S, M' }] });
      assert.throws(() => inventory.flagItem(item.id), /Choisis une réponse/);
      const done = inventory.flagItem(item.id, { q0: 'M' });
      assert.equal(done.status, 'reorder');
      assert.deepEqual(done.flag_details[0].answers, [{ label: 'Taille', value: 'M' }]);
      const viaApi = await call(`/api/inventory/${item.id}/flag`, { method: 'POST', body: { answers: { q0: 'S' } } });
      assert.equal(viaApi.status, 200);
      assert.equal((await viaApi.json()).flag_details.length, 2);
      const plain = inventory.createItem({ name: 'Flag simple', reorder_at: 1 });
      assert.equal(inventory.flagItem(plain.id).status, 'reorder');
    });

    it('la page de scan demande les réponses sans rien enregistrer ; sans question, rien ne change', async () => {
      const item = inventory.createItem({ name: 'Page questions', reorder_at: 1, questions: [{ label: 'Quoi ?', type: 'text' }] });
      const token = item.scan_url.split('/r/')[1];
      const html = await (await call(`/r/${token}`, { auth: false })).text();
      assert.match(html, /data-questions=/);
      assert.equal(inventory.getItem(item.id).status, 'ok');
      const plain = inventory.createItem({ name: 'Sans question', reorder_at: 1 });
      const plainHtml = await (await call(`/r/${plain.scan_url.split('/r/')[1]}`, { auth: false })).text();
      assert.ok(!plainHtml.includes('data-questions'));
      const posted = await call(`/r/${token}/scan`, { auth: false, method: 'POST', body: { answers: { q0: 'Résine noire' } } });
      assert.equal(posted.status, 200);
      assert.equal(inventory.getItem(item.id).flag_details[0].answers[0].value, 'Résine noire');
    });
  });

  describe('grande étiquette (4 par feuille Lettre)', () => {
    const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    it('quantité à commander, fournisseur et photo : facultatifs et validés', async () => {
      const item = inventory.createItem({ name: 'Ruban adhésif', reorder_at: 900, order_qty: '4200', supplier: '  Sticker   Mule ', image: PIXEL });
      assert.equal(item.order_qty, 4200);
      assert.equal(item.supplier, 'Sticker Mule');
      assert.equal(item.has_image, true);
      assert.ok(!('image' in item), 'la liste ne transporte pas les photos');
      const bare = inventory.createItem({ name: 'Sans options', reorder_at: 1 });
      assert.deepEqual([bare.order_qty, bare.supplier, bare.has_image], [null, null, false]);
      assert.throws(() => inventory.createItem({ name: 'X', order_qty: 'beaucoup' }), /quantité à commander/);
      assert.throws(() => inventory.createItem({ name: 'X', image: 'http://exemple.com/a.png' }), /JPEG, PNG ou WebP/);
      assert.throws(() => inventory.createItem({ name: 'X', image: 'data:image/png;base64,' + 'A'.repeat(2_600_000) }), /trop lourde/);

      // une modification sans ces champs ne les efface pas ; null retire la photo
      assert.equal(inventory.updateItem(item.id, { name: 'Ruban adhésif 2' }).supplier, 'Sticker Mule');
      assert.equal(inventory.updateItem(item.id, { image: null }).has_image, false);
      assert.equal(inventory.updateItem(item.id, { order_qty: '' }).order_qty, null);

      const withPhoto = inventory.createItem({ name: 'Photo servie', reorder_at: 1, image: PIXEL });
      const served = await call(`/api/inventory/${withPhoto.id}/image`);
      assert.equal(served.headers.get('content-type').split(';')[0], 'image/png');
      assert.equal((await call(`/api/inventory/${bare.id}/image`)).status, 404);
    });

    it('la page d’impression « large » : 4 par feuille Lettre, champs facultatifs absents si vides', async () => {
      const full = inventory.createItem({ name: 'Étiquette pleine', reorder_at: 900, order_qty: 4200, supplier: 'Sticker Mule', image: PIXEL });
      const bare = inventory.createItem({ name: 'Étiquette nue', reorder_at: 5 });
      const html = await (await call(`/inventory/cards?ids=${full.id},${bare.id}&style=large`)).text();
      assert.ok(html.includes('size: letter'), 'page Lettre');
      assert.equal((html.match(/class="page"/g) ?? []).length, 1, 'deux étiquettes = une feuille');
      assert.ok(html.includes('Commander chez') && html.includes('Sticker Mule') && html.includes('À commander') && html.includes('4200'));
      assert.ok(html.includes(PIXEL), 'la photo est dans la page');
      const many = [full, bare, full, bare, full].map((item) => item.id).join(',');
      const five = await (await call(`/inventory/cards?ids=${many}&style=large`)).text();
      // les identifiants en double ne multiplient pas les étiquettes : 2 objets distincts = 1 feuille
      assert.equal((five.match(/class="page"/g) ?? []).length, 1);
      const small = await (await call(`/inventory/cards?ids=${full.id}`)).text();
      assert.ok(small.includes('size: 2in 1in'), 'le style par défaut reste 2 po × 1 po');
    });
  });

  it('page du téléphone : ajout, liste, code QR, mot de passe demandé', async () => {
    inventory.createItem({ name: 'Pour fournisseur', reorder_at: 1, supplier: 'Fournisseur Test' });
    const html = await (await call('/inventory/new')).text();
    assert.ok(html.includes('/js/inventory-mobile.js') && html.includes('data-start="add"'));
    assert.ok((await (await call('/inventory/mobile')).text()).includes('data-start="list"'), 'la liste des objets est sur /inventory/mobile');
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), 'pas de script en ligne (CSP)');
    const qr = await call('/api/inventory/phone-qr.svg');
    assert.equal(qr.headers.get('content-type').split(';')[0], 'image/svg+xml');
    assert.equal((await call('/inventory/new', { auth: false })).status, 401);
  });

  it('étiquette « Ajouter à l’inventaire » : un QR vers la page du téléphone, en petit et en grand', async () => {
    const small = await (await call('/inventory/add-card')).text();
    assert.ok(small.includes('size: 2in 1in') && small.includes('<svg') && small.includes('/inventory/new'));
    const large = await (await call('/inventory/add-card?style=large')).text();
    assert.ok(large.includes('size: letter') && large.includes('Ajouter à l’inventaire') && large.includes('<svg'));
    assert.equal((await call('/inventory/add-card', { auth: false })).status, 401);
  });

  it('unité du minimum et de la quantité à commander (« 2 rouleaux », « 1 bac »)', async () => {
    const item = inventory.createItem({ name: 'Ruban unité', reorder_at: 2, unit: '  rouleaux ', order_qty: 10 });
    assert.equal(item.unit, 'rouleaux');
    assert.equal(inventory.createItem({ name: 'Sans unité', reorder_at: 1 }).unit, null);
    assert.throws(() => inventory.createItem({ name: 'X', unit: 'une unité vraiment beaucoup trop longue' }), /unité est trop longue/);
    const small = await (await call(`/inventory/cards?ids=${item.id}`)).text();
    assert.ok(small.includes('Scanner à 2 rouleaux'));
    const large = await (await call(`/inventory/cards?ids=${item.id}&style=large`)).text();
    assert.ok(large.includes('2 rouleaux') && large.includes('10 rouleaux'));
    assert.equal(inventory.updateItem(item.id, { name: 'Ruban unité 2' }).unit, 'rouleaux', 'une modification sans unité la garde');
    assert.equal(inventory.updateItem(item.id, { unit: '' }).unit, null);
  });
});
