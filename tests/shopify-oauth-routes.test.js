import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('shopify-oauth-routes');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getSetting } = await import('../src/db/index.js');
const { getSettings, updateSettings } = await import('../src/domain/settings.service.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
const originalFetch = globalThis.fetch;

/** Signe une réponse OAuth Shopify comme le ferait vraiment Shopify. */
const signCallback = (params, secret) => {
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
};

describe('routes OAuth Shopify', () => {
  before(async () => {
    migrate();
    updateSettings({
      'shopify.shopDomain': 'atelier.myshopify.com',
      'shopify.apiKey': 'client_id_123',
      'shopify.apiSecret': 'client_secret_xyz',
      'shopify.scopes': 'read_orders',
      'app.publicUrl': 'https://queue.3dkeycap.com',
    });
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('/start redirige vers l\'écran d\'autorisation Shopify avec un state anti-CSRF', async () => {
    const response = await fetch(`${base}/api/integrations/shopify/oauth/start`, { redirect: 'manual' });
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(location.hostname, 'atelier.myshopify.com');
    assert.equal(location.pathname, '/admin/oauth/authorize');
    assert.equal(location.searchParams.get('client_id'), 'client_id_123');
    assert.equal(
      location.searchParams.get('redirect_uri'),
      'https://queue.3dkeycap.com/api/integrations/shopify/oauth/callback',
    );
    assert.ok(location.searchParams.get('state'));

    const stored = JSON.parse(getSetting('shopify.oauthState'));
    assert.equal(stored.state, location.searchParams.get('state'));
  });

  it('/start ne produit pas de double slash quand l\'URL publique a un / final', async () => {
    updateSettings({ 'app.publicUrl': 'https://printer.stackia.duckdns.org/' });
    const response = await fetch(`${base}/api/integrations/shopify/oauth/start`, { redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    assert.equal(
      location.searchParams.get('redirect_uri'),
      'https://printer.stackia.duckdns.org/api/integrations/shopify/oauth/callback',
    );
    updateSettings({ 'app.publicUrl': 'https://queue.3dkeycap.com' });
  });

  it('/callback échange le code, enregistre le token et renvoie au dashboard', async () => {
    const started = await fetch(`${base}/api/integrations/shopify/oauth/start`, { redirect: 'manual' });
    const state = new URL(started.headers.get('location')).searchParams.get('state');

    globalThis.fetch = async (url, options) => {
      if (url !== 'https://atelier.myshopify.com/admin/oauth/access_token') return originalFetch(url, options);
      const body = JSON.parse(options.body);
      assert.equal(body.client_id, 'client_id_123');
      assert.equal(body.client_secret, 'client_secret_xyz');
      assert.equal(body.code, 'one-time-code');
      return new Response(JSON.stringify({ access_token: 'shpat_freshly_issued', scope: 'read_orders' }), {
        status: 200,
      });
    };

    const params = { code: 'one-time-code', shop: 'atelier.myshopify.com', state, timestamp: '1700000000' };
    const hmac = signCallback(params, 'client_secret_xyz');
    const query = new URLSearchParams({ ...params, hmac });

    const response = await fetch(`${base}/api/integrations/shopify/oauth/callback?${query}`, { redirect: 'manual' });
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(location.hash, '#integrations');
    assert.equal(location.searchParams.get('shopify_status'), 'connected');

    assert.equal(getSettings()['shopify.accessToken'], 'shpat_freshly_issued');
    assert.equal(getSettings()['shopify.shopDomain'], 'atelier.myshopify.com');
  });

  it('/callback refuse une signature HMAC invalide sans appeler Shopify', async () => {
    const started = await fetch(`${base}/api/integrations/shopify/oauth/start`, { redirect: 'manual' });
    const state = new URL(started.headers.get('location')).searchParams.get('state');

    let fetchCalled = false;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://atelier.myshopify.com/admin/oauth/access_token') fetchCalled = true;
      return originalFetch(url, options);
    };

    const query = new URLSearchParams({
      code: 'one-time-code',
      shop: 'atelier.myshopify.com',
      state,
      hmac: 'not-the-right-signature',
    });

    const response = await fetch(`${base}/api/integrations/shopify/oauth/callback?${query}`, { redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('shopify_status'), 'error');
    assert.equal(fetchCalled, false);
  });

  it('/callback refuse un state absent, rejoué ou expiré', async () => {
    const params = { code: 'one-time-code', shop: 'atelier.myshopify.com', state: 'stale-or-guessed' };
    const hmac = signCallback(params, 'client_secret_xyz');
    const query = new URLSearchParams({ ...params, hmac });

    const response = await fetch(`${base}/api/integrations/shopify/oauth/callback?${query}`, { redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('shopify_status'), 'error');
  });

  it('/disconnect efface le token pour forcer une nouvelle connexion', async () => {
    updateSettings({ 'shopify.accessToken': 'shpat_to_be_cleared' });
    const response = await fetch(`${base}/api/integrations/shopify/oauth/disconnect`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal(getSettings()['shopify.accessToken'], '');
  });
});
