import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('shopify-images');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { attachProductImages, fetchLineItemImages } = await import('../src/integrations/shopify.js');
const { backfillShopifyImages } = await import('../src/domain/shopifyImages.js');

const SETTINGS = {
  'shopify.shopDomain': 'atelier-test.myshopify.com',
  'shopify.apiVersion': '2025-10',
  'shopify.accessToken': 'shpat_abc',
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const graphqlAnswer = (byOrder) => async (url, options) => {
  assert.match(String(url), /\/admin\/api\/2025-10\/graphql\.json$/);
  const { variables } = JSON.parse(options.body);
  const nodes = variables.ids.map((gid) => {
    const id = gid.split('/').pop();
    return {
      lineItems: {
        nodes: Object.entries(byOrder[id] ?? {}).map(([line, image]) => ({
          id: `gid://shopify/LineItem/${line}`,
          image: image ? { url: image } : null,
        })),
      },
    };
  });
  return new Response(JSON.stringify({ data: { nodes } }), { status: 200 });
};

describe('photos Shopify via les lignes de commande (scope read_orders)', () => {
  before(() => {
    migrate();
    updateSettings({ 'shopify.shopDomain': SETTINGS['shopify.shopDomain'], 'shopify.apiVersion': '2025-10', 'shopify.accessToken': 'shpat_abc' });
  });
  after(() => closeDb());

  it('associe chaque ligne de commande à sa photo', async () => {
    globalThis.fetch = graphqlAnswer({ 111: { 9001: 'https://cdn.shopify.com/a.jpg', 9002: null } });
    assert.deepEqual(await fetchLineItemImages(['111'], SETTINGS), { 9001: 'https://cdn.shopify.com/a.jpg' });
  });

  it("n'appelle plus l'API produits après un refus (scope read_products absent)", async () => {
    let productCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('/products/')) {
        productCalls += 1;
        return new Response('{"errors":"forbidden"}', { status: 403 });
      }
      return graphqlAnswer({ 222: { 1: 'https://cdn.shopify.com/one.jpg' } })(url, options);
    };
    const orders = [{ externalId: '222', items: [{ externalId: '1', productId: 5 }, { externalId: '2', productId: 6 }, { externalId: '3', productId: 7 }] }];
    await attachProductImages(orders, SETTINGS);
    assert.equal(orders[0].items[0].imageUrl, 'https://cdn.shopify.com/one.jpg');
    assert.equal(orders[0].items[1].imageUrl, null);
    assert.equal(productCalls, 1, 'un seul essai, puis abandon');
  });

  it('rattrape les photos des commandes déjà importées', async () => {
    ingestOrder(makeOrder({ externalId: '333', items: [{ externalId: '77', title: 'Keycap sans photo', quantity: 1 }] }));
    globalThis.fetch = graphqlAnswer({ 333: { 77: 'https://cdn.shopify.com/late.jpg' } });
    assert.deepEqual(await backfillShopifyImages(), { updated: 1 });
    const row = getDb().prepare("SELECT image_url FROM order_items WHERE external_id = '77'").get();
    assert.equal(row.image_url, 'https://cdn.shopify.com/late.jpg');
    assert.deepEqual(await backfillShopifyImages(), { updated: 0 }, 'plus rien à rattraper');
  });
});
