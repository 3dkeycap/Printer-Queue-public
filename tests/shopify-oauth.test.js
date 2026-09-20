import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('shopify-oauth');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const {
  buildAuthorizeUrl,
  normalizeBaseUrl,
  normalizeShopDomain,
  redirectUri,
  verifyOAuthCallback,
} = await import('../src/integrations/shopifyOAuth.js');

describe('Shopify OAuth 2.0', () => {
  before(() => migrate());
  after(() => closeDb());

  it('normalise le domaine de boutique dans toutes ses formes', () => {
    assert.equal(normalizeShopDomain('atelier'), 'atelier.myshopify.com');
    assert.equal(normalizeShopDomain('atelier.myshopify.com'), 'atelier.myshopify.com');
    assert.equal(normalizeShopDomain('https://atelier.myshopify.com/admin'), 'atelier.myshopify.com');
    assert.equal(normalizeShopDomain('  ATELIER.MYSHOPIFY.COM  '), 'atelier.myshopify.com');
    assert.equal(normalizeShopDomain(''), '');
  });

  it("vérifie la signature HMAC du retour OAuth selon l'algorithme Shopify", () => {
    const secret = 'shpss_test_secret';
    const params = { code: 'abc123', shop: 'atelier.myshopify.com', state: 'xyz', timestamp: '1700000000' };
    const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
    const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex');

    assert.equal(verifyOAuthCallback({ ...params, hmac }, secret), true);
    assert.equal(verifyOAuthCallback({ ...params, hmac: `${hmac.slice(0, -1)}0` }, secret), false);
    assert.equal(verifyOAuthCallback({ ...params, hmac }, 'wrong-secret'), false);
  });

  it('refuse la vérification sans hmac ou sans secret configuré', () => {
    assert.equal(verifyOAuthCallback({ shop: 'atelier.myshopify.com' }, 'secret'), false);
    assert.equal(verifyOAuthCallback({ shop: 'atelier.myshopify.com', hmac: 'abc' }, ''), false);
  });

  it("refuse de construire l'URL d'autorisation sans identifiants configurés", () => {
    assert.throws(() => buildAuthorizeUrl('state123'), /Domaine de boutique/);
  });

  it("construit l'URL d'autorisation une fois la boutique et l'app configurées", () => {
    updateSettings({
      'shopify.shopDomain': 'atelier.myshopify.com',
      'shopify.apiKey': 'client_id_123',
      'shopify.scopes': 'read_orders',
      'app.publicUrl': 'https://queue.3dkeycap.com',
    });

    const url = new URL(buildAuthorizeUrl('state123'));
    assert.equal(url.origin, 'https://atelier.myshopify.com');
    assert.equal(url.pathname, '/admin/oauth/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client_id_123');
    assert.equal(url.searchParams.get('scope'), 'read_orders');
    assert.equal(url.searchParams.get('state'), 'state123');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://queue.3dkeycap.com/api/integrations/shopify/oauth/callback',
    );
  });

  it("dérive l'URL de callback de l'URL publique configurée", () => {
    assert.equal(
      redirectUri({ 'app.publicUrl': 'https://queue.3dkeycap.com' }),
      'https://queue.3dkeycap.com/api/integrations/shopify/oauth/callback',
    );
  });

  it('ne produit jamais de double slash quand l\'URL publique est collée avec un / final', () => {
    // Cas réel : "https://printer.stackia.duckdns.org/" copié depuis la barre
    // d'adresse. Un double slash ne matcherait plus jamais la redirect URL
    // enregistrée dans le Partner Dashboard -> Shopify répond "Unauthorized Access".
    assert.equal(normalizeBaseUrl('https://queue.3dkeycap.com/'), 'https://queue.3dkeycap.com');
    assert.equal(normalizeBaseUrl('https://queue.3dkeycap.com///'), 'https://queue.3dkeycap.com');
    assert.equal(
      redirectUri({ 'app.publicUrl': 'https://printer.stackia.duckdns.org/' }),
      'https://printer.stackia.duckdns.org/api/integrations/shopify/oauth/callback',
    );
  });
});
