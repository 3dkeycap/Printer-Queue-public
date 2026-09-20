import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('etsy-oauth-routes');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getSetting } = await import('../src/db/index.js');
const { getSettings, updateSettings } = await import('../src/domain/settings.service.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
const originalFetch = globalThis.fetch;

describe('routes OAuth Etsy (PKCE)', () => {
  before(async () => {
    migrate();
    updateSettings({
      'etsy.apiKey': 'keystring_123',
      'etsy.shopId': '99887766',
      'etsy.scopes': 'transactions_r',
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

  it("/start redirige vers l'écran d'autorisation Etsy avec PKCE et un state anti-CSRF", async () => {
    const response = await fetch(`${base}/api/integrations/etsy/oauth/start`, { redirect: 'manual' });
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin, 'https://www.etsy.com');
    assert.equal(location.pathname, '/oauth/connect');
    assert.equal(location.searchParams.get('response_type'), 'code');
    assert.equal(location.searchParams.get('client_id'), 'keystring_123');
    assert.equal(location.searchParams.get('scope'), 'transactions_r');
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
      location.searchParams.get('redirect_uri'),
      'https://queue.3dkeycap.com/api/integrations/etsy/oauth/callback',
    );
    assert.ok(location.searchParams.get('state'));

    const challenge = location.searchParams.get('code_challenge');
    assert.ok(challenge && challenge.length > 20);

    const stored = JSON.parse(getSetting('etsy.oauthState'));
    assert.equal(stored.state, location.searchParams.get('state'));
    assert.ok(stored.verifier, 'le vérifieur PKCE doit être conservé pour le callback');

    // l'empreinte doit correspondre au vérifieur conservé (sha256, base64url)
    const expectedChallenge = crypto
      .createHash('sha256')
      .update(stored.verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    assert.equal(challenge, expectedChallenge);
  });

  it("/callback échange le code (form-urlencoded + x-api-key) et enregistre les tokens", async () => {
    const started = await fetch(`${base}/api/integrations/etsy/oauth/start`, { redirect: 'manual' });
    const state = new URL(started.headers.get('location')).searchParams.get('state');
    const verifier = JSON.parse(getSetting('etsy.oauthState')).verifier;

    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.etsy.com/v3/public/oauth/token') return originalFetch(url, options);
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
      assert.equal(options.headers['x-api-key'], 'keystring_123');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), 'keystring_123');
      assert.equal(body.get('code'), 'etsy-one-time-code');
      assert.equal(body.get('code_verifier'), verifier);
      return new Response(
        JSON.stringify({ access_token: '123.etsy_token', refresh_token: '123.refresh', expires_in: 3600 }),
        { status: 200 },
      );
    };

    const query = new URLSearchParams({ code: 'etsy-one-time-code', state });
    const response = await fetch(`${base}/api/integrations/etsy/oauth/callback?${query}`, { redirect: 'manual' });
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(location.hash, '#integrations');
    assert.equal(location.searchParams.get('etsy_status'), 'connected');

    assert.equal(getSettings()['etsy.accessToken'], '123.etsy_token');
    assert.equal(getSetting('etsy.refreshToken'), '123.refresh');
    assert.ok(getSetting('etsy.tokenExpiresAt'));

    // le state PKCE est consommé, pas rejouable
    assert.equal(getSetting('etsy.oauthState'), null);
  });

  it('/callback renvoie une erreur si le marchand refuse (paramètre error)', async () => {
    let fetchCalled = false;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.etsy.com/v3/public/oauth/token') fetchCalled = true;
      return originalFetch(url, options);
    };

    const query = new URLSearchParams({ error: 'access_denied', error_description: 'User cancelled' });
    const response = await fetch(`${base}/api/integrations/etsy/oauth/callback?${query}`, { redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('etsy_status'), 'error');
    assert.equal(location.searchParams.get('etsy_message'), 'User cancelled');
    assert.equal(fetchCalled, false);
  });

  it('/callback refuse un state absent, rejoué ou expiré', async () => {
    const response = await fetch(
      `${base}/api/integrations/etsy/oauth/callback?code=x&state=jamais-vu`,
      { redirect: 'manual' },
    );
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('etsy_status'), 'error');
  });

  it("/disconnect efface les tokens et renvoie settings + connectors (sans planter la page Intégrations)", async () => {
    updateSettings({ 'etsy.accessToken': 'to-be-cleared' });
    const response = await fetch(`${base}/api/integrations/etsy/oauth/disconnect`, { method: 'POST' });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.settings), 'doit renvoyer la liste des réglages (comme /api/settings)');
    assert.ok(body.connectors && typeof body.connectors === 'object', 'doit renvoyer connectors');
    assert.equal(body.connectors.etsy.configured, false);

    assert.equal(getSettings()['etsy.accessToken'], '');
    assert.equal(getSetting('etsy.refreshToken'), null);
    assert.equal(getSetting('etsy.tokenExpiresAt'), null);
  });
});
