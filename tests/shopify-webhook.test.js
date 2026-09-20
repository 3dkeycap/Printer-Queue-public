import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('shopify-webhook');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

const SHOPIFY_ORDER = {
  id: 778899,
  name: '#2001',
  created_at: '2026-03-01T09:00:00-05:00',
  total_price: '55.00',
  currency: 'CAD',
  customer: { first_name: 'Yuki', last_name: 'Tanaka' },
  line_items: [{ id: 1, title: 'Keycap "Kraken"', quantity: 1, price: '55.00' }],
};

describe('webhook Shopify - vérification HMAC via le Client secret OAuth', () => {
  before(async () => {
    migrate();
    updateSettings({ 'shopify.apiSecret': 'client_secret_xyz' });
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  });

  const post = (body, hmac) =>
    fetch(`${base}/api/webhooks/shopify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hmac !== undefined ? { 'x-shopify-hmac-sha256': hmac } : {}),
      },
      body,
    });

  const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64');

  it('accepte un webhook signé avec le Client secret enregistré dans Intégrations', async () => {
    const body = JSON.stringify(SHOPIFY_ORDER);
    const response = await post(body, sign(body, 'client_secret_xyz'));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.received, true);
    assert.equal(payload.partsCreated, 1);
  });

  it('rejette une signature calculée avec le mauvais secret', async () => {
    const body = JSON.stringify({ ...SHOPIFY_ORDER, id: 778900 });
    const response = await post(body, sign(body, 'not-the-real-secret'));
    assert.equal(response.status, 401);
  });

  it('rejette un webhook sans en-tête de signature', async () => {
    const response = await post(JSON.stringify({ ...SHOPIFY_ORDER, id: 778901 }));
    assert.equal(response.status, 401);
  });
});
