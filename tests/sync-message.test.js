import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('sync-message');
const { syncMessage } = await import('../src/jobs/syncOrders.js');

describe('résumé des synchros', () => {
  it('donne les compteurs en clair', () => {
    assert.equal(
      syncMessage('shopify', { ordersSeen: 12, ordersCreated: 2, partsCreated: 5 }, { shipped: 3 }, { updated: 4 }),
      '12 commandes vues · 2 nouvelles · 5 pièces créées · 3 traitées dans Shopify → expédiées · 4 photos ajoutées',
    );
    assert.equal(syncMessage('etsy', { ordersSeen: 1, ordersCreated: 0, partsCreated: 0 }, { shipped: 0 }, {}), '1 commande vue · 0 nouvelle · 0 pièce créée');
    assert.match(syncMessage('etsy', {}, { shipped: 0, error: 'HTTP 403' }), /suivi des expéditions Etsy en échec : HTTP 403/);
  });
});
