import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('api');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

describe('API HTTP', () => {
  before(async () => {
    migrate();
    ingestOrder(makeOrder());
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  });

  it('répond au health check', async () => {
    const { status, body } = await call('/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });

  it('expose les statuts et les listes réglables au front-end', async () => {
    const { body } = await call('/api/meta');
    assert.equal(body.statuses.length, 5);
    assert.deepEqual(body.boardStatuses, ['TO_PRINT', 'PRINTING', 'FAILED', 'DONE']);
    assert.ok(body.uvOptions.includes('Standard'));
    assert.ok(Array.isArray(body.commentOptions));
  });

  it('liste les pièces du tableau de production', async () => {
    const { body } = await call('/api/parts?scope=board');
    assert.equal(body.total, 3);
    assert.equal(body.items[0].color_name, 'Glow in the dark');
    assert.equal(body.items[0].order_number, '#1001');
  });

  it('filtre par couleur et par recherche plein texte', async () => {
    assert.equal((await call('/api/parts?color=glow')).body.total, 3);
    assert.equal((await call('/api/parts?color=black')).body.total, 0);
    assert.equal((await call('/api/parts?q=Kraken')).body.total, 3);
    assert.equal((await call('/api/parts?q=introuvable')).body.total, 0);
  });

  it('change le statut d\'une pièce', async () => {
    const { body } = await call('/api/parts/1/status', { method: 'POST', body: { status: 'PRINTING' } });
    assert.equal(body.status, 'PRINTING');
    const events = await call('/api/parts/1/events');
    assert.equal(events.body.items[0].to_status, 'PRINTING');
    assert.equal(events.body.items[0].actor, 'dashboard');
  });

  it('refuse une transition invalide', async () => {
    const { status, body } = await call('/api/parts/1/status', { method: 'POST', body: { status: 'SHIPPED' } });
    assert.equal(status, 409);
    assert.match(body.error, /not allowed/);
  });

  it('accepte la même transition avec force', async () => {
    const { status } = await call('/api/parts/1/status', { method: 'POST', body: { status: 'SHIPPED', force: true } });
    assert.equal(status, 200);
  });

  it('traite un lot de pièces', async () => {
    const { body } = await call('/api/parts/bulk/status', {
      method: 'POST',
      body: { ids: [2, 3], status: 'PRINTING' },
    });
    assert.equal(body.updated.length, 2);
    assert.equal(body.errors.length, 0);
  });

  it('crée des pièces manuelles avec UV et commentaire', async () => {
    const { status, body } = await call('/api/parts', {
      method: 'POST',
      body: {
        name: 'Keycap "Tiki" (stock)',
        quantity: 4,
        color_key: 'beige',
        uv: 'A',
        comment: 'Réimpression',
        customer: '5348',
      },
    });
    assert.equal(status, 201);
    assert.equal(body.items.length, 4);
    assert.equal(body.items[0].source, 'manual');
    assert.equal(body.items[0].uv, 'A');
    assert.equal(body.items[0].comment, 'Réimpression');
    assert.equal(body.items[0].customer_name, '5348');
  });

  it('modifie le poste UV et le commentaire d\'une pièce', async () => {
    const { body } = await call('/api/parts/2', { method: 'PATCH', body: { uv: 'B', comment: 'Attente client' } });
    assert.equal(body.uv, 'B');
    assert.equal(body.comment, 'Attente client');
    const filtered = await call('/api/parts?uv=B');
    assert.equal(filtered.body.total, 1);
  });

  it('rejette une couleur de résine inconnue', async () => {
    const { status } = await call('/api/parts/2', { method: 'PATCH', body: { color_key: 'vantablack' } });
    assert.equal(status, 400);
  });

  it('agrège les statistiques du tableau de bord', async () => {
    const { body } = await call('/api/stats/summary');
    assert.equal(body.totals.parts_total, 7);
    assert.ok(body.byColor.some((color) => color.key === 'glow'));
    assert.ok(body.byUv.some((row) => row.uv === 'A'));
    assert.equal(body.byStatus.SHIPPED, 1);
  });

  it('traite le webhook Chit Chats et sort les pièces de la production', async () => {
    const { status, body } = await call('/api/webhooks/chitchats', {
      method: 'POST',
      body: { shipment: { id: 'cc_99', status: 'in_transit', order_id: '#1001', tracking_number: 'CCX1' } },
    });
    assert.equal(status, 200);
    assert.equal(body.matched, true);
    assert.equal(body.shipped, 2);

    const board = await call('/api/parts?scope=board');
    assert.ok(!board.body.items.some((part) => part.order_number === '#1001'));
  });

  it('renvoie 404 sur un endpoint inconnu', async () => {
    const { status } = await call('/api/nope');
    assert.equal(status, 404);
  });

  it('sert le dashboard sur la racine', async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Resin Print Queue/);
  });
});
