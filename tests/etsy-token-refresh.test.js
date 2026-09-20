import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('etsy-token-refresh');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getSetting, setSetting } = await import('../src/db/index.js');
const { getSettings, updateSettings } = await import('../src/domain/settings.service.js');
const { ensureFreshEtsyToken } = await import('../src/integrations/etsyOAuth.js');
const { fetchOrders } = await import('../src/integrations/etsy.js');

const originalFetch = globalThis.fetch;

describe('renouvellement automatique du token Etsy (expire toutes les heures)', () => {
  before(() => {
    migrate();
    updateSettings({
      'etsy.apiKey': 'keystring_123',
      'etsy.shopId': '99887766',
      'etsy.accessToken': 'old-access-token',
      'etsy.enabled': true,
    });
  });

  after(() => closeDb());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("ne rafraîchit rien pour une connexion par token collé à la main (pas de refresh token)", async () => {
    let refreshCalled = false;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.etsy.com/v3/public/oauth/token') refreshCalled = true;
      return originalFetch(url, options);
    };
    await ensureFreshEtsyToken();
    assert.equal(refreshCalled, false);
    assert.equal(getSettings()['etsy.accessToken'], 'old-access-token');
  });

  it('rafraîchit de manière proactive un token expiré (ou sur le point de l\'être)', async () => {
    setSetting('etsy.refreshToken', 'refresh-abc');
    setSetting('etsy.tokenExpiresAt', new Date(Date.now() - 1000).toISOString()); // déjà expiré

    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.etsy.com/v3/public/oauth/token') return originalFetch(url, options);
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('client_id'), 'keystring_123');
      assert.equal(body.get('refresh_token'), 'refresh-abc');
      return new Response(
        JSON.stringify({ access_token: 'brand-new-token', refresh_token: 'refresh-def', expires_in: 3600 }),
        { status: 200 },
      );
    };

    await ensureFreshEtsyToken();

    assert.equal(getSettings()['etsy.accessToken'], 'brand-new-token');
    assert.equal(getSetting('etsy.refreshToken'), 'refresh-def', 'Etsy émet un nouveau refresh token à chaque renouvellement');
    assert.ok(new Date(getSetting('etsy.tokenExpiresAt')).getTime() > Date.now());
  });

  it("ne rafraîchit pas un token encore valide (évite un appel API inutile à chaque sync)", async () => {
    setSetting('etsy.tokenExpiresAt', new Date(Date.now() + 30 * 60000).toISOString()); // encore 30 min
    let refreshCalled = false;
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.etsy.com/v3/public/oauth/token') refreshCalled = true;
      return originalFetch(url, options);
    };
    await ensureFreshEtsyToken();
    assert.equal(refreshCalled, false);
  });

  it('fetchOrders() rafraîchit le token avant d\'appeler l\'API des commandes si besoin', async () => {
    setSetting('etsy.tokenExpiresAt', new Date(Date.now() - 1000).toISOString());
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push(url);
      if (url === 'https://api.etsy.com/v3/public/oauth/token') {
        return new Response(
          JSON.stringify({ access_token: 'refreshed-for-fetch', refresh_token: 'refresh-ghi', expires_in: 3600 }),
          { status: 200 },
        );
      }
      if (String(url).includes('/receipts')) {
        assert.equal(options.headers.Authorization, 'Bearer refreshed-for-fetch');
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return originalFetch(url, options);
    };

    await fetchOrders({});
    assert.ok(calls.some((url) => url === 'https://api.etsy.com/v3/public/oauth/token'));
    assert.ok(calls.some((url) => String(url).includes('/receipts')));
  });
});
