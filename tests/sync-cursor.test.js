import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('sync-cursor');
const { getSetting, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { syncSource } = await import('../src/jobs/syncOrders.js');

const originalFetch = globalThis.fetch;

const shopifyOrder = (id, name, createdAt) => ({
  id,
  name,
  created_at: createdAt,
  total_price: '10.00',
  currency: 'CAD',
  customer: { first_name: 'Test', last_name: 'Client' },
  shipping_address: { country_code: 'CA' },
  line_items: [{ id: id * 10, title: 'Pièce', quantity: 1, price: '10.00' }],
});

describe('curseur de synchronisation Shopify/Etsy', () => {
  before(() => {
    migrate();
    updateSettings({
      'shopify.shopDomain': 'atelier.myshopify.com',
      'shopify.accessToken': 'shpat_test',
      'shopify.enabled': true,
    });
  });

  after(() => closeDb());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("n'avance jamais le curseur quand la synchro ne trouve aucune commande", async () => {
    globalThis.fetch = async (url, options) =>
      String(url).includes('/orders.json')
        ? new Response(JSON.stringify({ orders: [] }), { status: 200 })
        : originalFetch(url, options);

    assert.equal(getSetting('cursor:shopify'), null);
    const result = await syncSource('shopify', { trigger: 'manual' });

    assert.equal(result.status, 'success');
    assert.equal(result.ordersSeen, 0);
    assert.equal(
      getSetting('cursor:shopify'),
      null,
      'le curseur ne doit pas bouger : ne jamais rétrécir la fenêtre de recherche sur 0 résultat',
    );
  });

  it('avance le curseur sur la date réelle de la commande la plus récente, pas sur l\'horloge murale', async () => {
    // Dates relatives à "maintenant" : le curseur de départ vaut "aujourd'hui
    // moins la fenêtre de rattrapage" (14 jours), ces commandes doivent donc
    // tomber dedans pour un test réaliste.
    const olderOrderAt = new Date(Date.now() - 2 * 86400000).toISOString();
    const latestOrderAt = new Date(Date.now() - 1 * 86400000).toISOString();

    globalThis.fetch = async (url, options) => {
      if (!String(url).includes('/orders.json')) return originalFetch(url, options);
      return new Response(
        JSON.stringify({
          orders: [shopifyOrder(1, '#1001', olderOrderAt), shopifyOrder(2, '#1002', latestOrderAt)],
        }),
        { status: 200 },
      );
    };

    const result = await syncSource('shopify', { trigger: 'manual' });
    assert.equal(result.ordersCreated, 2);

    const cursor = getSetting('cursor:shopify');
    assert.ok(cursor, 'le curseur doit maintenant être posé');
    // 10 minutes de recouvrement avant la commande la plus récente vue (pas "maintenant")
    assert.equal(cursor, new Date(Date.parse(latestOrderAt) - 10 * 60000).toISOString());
  });

  it('ne recule ni ne piétine le curseur si un cycle suivant ne trouve plus rien', async () => {
    const before2 = getSetting('cursor:shopify');
    globalThis.fetch = async (url, options) =>
      String(url).includes('/orders.json')
        ? new Response(JSON.stringify({ orders: [] }), { status: 200 })
        : originalFetch(url, options);

    await syncSource('shopify', { trigger: 'manual' });
    assert.equal(getSetting('cursor:shopify'), before2, 'reste sur la dernière commande réellement vue');
  });
});

