import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('hidden-colors');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { listParts } = await import('../src/domain/parts.service.js');
const { getSummary } = await import('../src/domain/stats.service.js');

describe('couleurs retirées de la file', () => {
  before(() => migrate());
  after(() => closeDb());

  it('masque la couleur dans « À imprimer » mais pas dans « Tout »', () => {
    ingestOrder(
      makeOrder({
        externalId: '7001',
        items: [
          { externalId: 'a', title: 'Keycap A', quantity: 2, variantTitle: 'Nylon Grey' },
          { externalId: 'b', title: 'Keycap B', quantity: 1, variantTitle: 'Noir' },
        ],
      }),
    );
    const nylon = listParts({ scope: 'board' }).items.find((p) => p.name === 'Keycap A').color_key;
    assert.equal(listParts({ scope: 'board' }).total, 3);

    updateSettings({ 'production.hiddenColors': [nylon] });
    const board = listParts({ scope: 'board' });
    assert.equal(board.total, 1);
    assert.ok(board.items.every((p) => p.color_key !== nylon));
    assert.equal(listParts({}).total, 3, '« Tout » les montre toujours');
    assert.equal(getSummary().totals.parts_active, 1);
  });
});

describe('mots à ne pas imprimer : « contient », y compris le nom de la résine', () => {
  it('« Nylon » retire toutes les résines dont le nom contient Nylon du tableau', () => {
    updateSettings({ 'production.hiddenColors': [], 'production.nonPrintableKeywords': [] });
    ingestOrder(
      makeOrder({
        externalId: '7002',
        items: [{ externalId: 'n1', title: 'Custom Keycap', quantity: 2, variantTitle: 'Nylon Grey' }],
      }),
    );
    const before = listParts({ scope: 'board' }).total;
    updateSettings({ 'production.nonPrintableKeywords': ['nylon'] });
    const after = listParts({ scope: 'board' });
    assert.ok(after.total <= before - 2);
    assert.ok(after.items.every((p) => !/nylon/i.test(p.color_name)));
    assert.ok(listParts({}).items.some((p) => /nylon/i.test(p.color_name)), '« Tout » les garde');
  });
});

describe('liens « ouvrir sur… »', () => {
  it('construit les liens Shopify et Chit Chats quand c\'est possible', async () => {
    const { getPart } = await import('../src/domain/parts.service.js');
    const { getDb } = await import('../src/db/index.js');
    updateSettings({ 'shopify.shopDomain': 'ma-boutique.myshopify.com' });
    const { orderId } = ingestOrder(makeOrder({ externalId: '9001', orderNumber: '#9001', items: [{ externalId: 'z', title: 'Link test', quantity: 1 }] }));
    const part = getDb().prepare('SELECT id FROM parts WHERE order_id = ?').get(orderId);
    assert.equal(getPart(part.id).links.shop.url, 'https://ma-boutique.myshopify.com/admin/orders/9001');
    assert.equal(getPart(part.id).links.chitchats, undefined);
    getDb().prepare("UPDATE orders SET tracking_number = 'CC123' WHERE id = ?").run(orderId);
    assert.equal(getPart(part.id).links.chitchats.url, 'https://chitchats.com/tracking/CC123');
    getDb().prepare("UPDATE orders SET source = 'etsy', external_id = '555' WHERE id = ?").run(orderId);
    assert.match(getPart(part.id).links.shop.url, /etsy\.com\/your\/orders\/sold\?order_id=555/);
  });
});

describe('lien Chit Chats par numéro de commande', () => {
  it('pointe sur la recherche Chit Chats quand le Client ID est connu', async () => {
    const { getPart } = await import('../src/domain/parts.service.js');
    const { getDb } = await import('../src/db/index.js');
    updateSettings({ 'chitchats.clientId': '314561' });
    const { orderId } = ingestOrder(makeOrder({ externalId: '9002', orderNumber: '#5429', items: [{ externalId: 'y', title: 'Link test 2', quantity: 1 }] }));
    const part = getDb().prepare('SELECT id FROM parts WHERE order_id = ?').get(orderId);
    assert.equal(
      getPart(part.id).links.chitchats.url,
      'https://chitchats.com/clients/314561/shipments/search?locale=en&q=5429',
    );
  });
});
