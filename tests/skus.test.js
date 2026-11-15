import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('skus');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { listSkus } = await import('../src/domain/skus.js');

describe('Réglages → SKU', () => {
  after(() => closeDb());

  it('un produit / variante / SKU par ligne, avec ventes cumulées, Shopify et Etsy', () => {
    migrate();
    ingestOrder(makeOrder({ externalId: 'S1', orderNumber: '#1', items: [{ externalId: 'a', title: 'Tilter Kit', sku: 'TK-1', variantTitle: 'White', quantity: 2 }] }));
    ingestOrder(makeOrder({ externalId: 'S2', orderNumber: '#2', items: [{ externalId: 'b', title: 'Tilter Kit', sku: 'TK-1', variantTitle: 'White', quantity: 1 }, { externalId: 'c', title: 'Tilter Kit', sku: '', variantTitle: 'Black', quantity: 1 }] }));
    ingestOrder(makeOrder({ source: 'etsy', externalId: 'E1', orderNumber: 'E1', items: [{ externalId: 'd', title: 'Ripple Keycap', quantity: 1 }] }));
    const rows = listSkus().map(({ source, title, variant, sku, orders, units }) => ({ source, title, variant, sku, orders, units }));
    assert.deepEqual(rows, [
      { source: 'etsy', title: 'Ripple Keycap', variant: null, sku: null, orders: 1, units: 1 },
      { source: 'shopify', title: 'Tilter Kit', variant: 'Black', sku: null, orders: 1, units: 1 },
      { source: 'shopify', title: 'Tilter Kit', variant: 'White', sku: 'TK-1', orders: 2, units: 3 },
    ]);
  });
});
