import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('cancelled');
const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { listParts, setStatus } = await import('../src/domain/parts.service.js');
const { getSummary } = await import('../src/domain/stats.service.js');
const { syncMarketplaceFulfillment } = await import('../src/domain/fulfillment.js');
const { syncMessage } = await import('../src/jobs/syncOrders.js');
const { normalizeOrder } = await import('../src/integrations/shopify.js');
const { normalizeReceipt } = await import('../src/integrations/etsy.js');

const order = (externalId, extra = {}) =>
  makeOrder({ externalId, orderNumber: `#${externalId}`, items: [{ externalId: `li-${externalId}`, title: `Pièce ${externalId}`, quantity: 2 }], ...extra });
const board = (q) => listParts({ scope: 'board', q }).total;
const partsOf = (orderId) => getDb().prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY id').all(orderId);

describe('commandes annulées : elles quittent « À imprimer »', () => {
  before(() => migrate());
  after(() => closeDb());

  it('lit l\'annulation dans Shopify (cancelled_at) et Etsy (statut canceled)', () => {
    assert.equal(normalizeOrder({ id: 1, cancelled_at: '2026-03-01T10:00:00Z', line_items: [] }).cancelledAt, '2026-03-01T10:00:00Z');
    assert.equal(normalizeOrder({ id: 2, cancelled_at: null, line_items: [] }).cancelledAt, null);
    assert.ok(normalizeReceipt({ receipt_id: 3, status: 'Canceled', transactions: [] }).cancelledAt);
    assert.equal(normalizeReceipt({ receipt_id: 4, status: 'Paid', transactions: [] }).cancelledAt, null);
  });

  it('une commande déjà annulée à l\'arrivée ne crée aucune pièce', () => {
    const result = ingestOrder(order('c1', { cancelledAt: '2026-03-01T10:00:00Z' }));
    assert.equal(result.partsCreated, 0);
    assert.equal(partsOf(result.orderId).length, 0);
    assert.equal(getDb().prepare('SELECT cancelled_at FROM orders WHERE id = ?').get(result.orderId).cancelled_at, '2026-03-01T10:00:00Z');
  });

  it('annulée après coup (webhook / synchro) : ses pièces sortent de la file et des compteurs', () => {
    const { orderId } = ingestOrder(order('c2'));
    assert.equal(board('c2'), 2);
    const before = getSummary().totals.parts_active;

    ingestOrder(order('c2', { cancelledAt: '2026-03-02T09:00:00Z' }));

    assert.equal(board('c2'), 0);
    assert.equal(getSummary().totals.parts_active, before - 2);
    // l'historique garde les pièces (vue « Tout »), marquées annulées
    const all = listParts({ q: 'c2' });
    assert.equal(all.total, 2);
    assert.ok(all.items.every((part) => part.cancelled));
    assert.ok(partsOf(orderId).every((part) => part.cancelled === 1));
    const event = getDb().prepare('SELECT note FROM part_events WHERE part_id = ? ORDER BY id DESC').get(partsOf(orderId)[0].id);
    assert.match(event.note, /annulée/);
  });

  it('ne recrée pas de pièces quand on revoit une commande annulée', () => {
    const { orderId } = ingestOrder(order('c3', { cancelledAt: '2026-03-03T09:00:00Z' }));
    const again = ingestOrder(order('c3'));
    assert.equal(again.partsCreated, 0);
    assert.equal(partsOf(orderId).length, 0);
  });

  it('la synchro repère une commande annulée dans la boutique (Shopify) et ne l\'expédie pas', async () => {
    const { orderId } = ingestOrder(order('c4'));
    const result = await syncMarketplaceFulfillment('shopify', {
      fetchers: { shopify: async (ids) => (ids.includes('c4') ? [{ id: 'c4', cancelled: true, cancelledAt: '2026-03-04T08:00:00Z' }] : []) },
    });
    assert.equal(result.cancelled, 1);
    assert.equal(result.shipped, 0);
    assert.equal(board('c4'), 0);
    assert.ok(partsOf(orderId).every((part) => part.status !== 'SHIPPED' && part.cancelled === 1));

    // une commande annulée n'est plus « ouverte » : elle n'est plus interrogée
    const second = await syncMarketplaceFulfillment('shopify', {
      fetchers: { shopify: async (ids) => { assert.ok(!ids.includes('c4')); return []; } },
    });
    assert.equal(second.cancelled, 0);
  });

  it('même chose côté Etsy, et une panne de lecture des annulations n\'empêche pas d\'expédier', async () => {
    const etsyOrder = (id) => makeOrder({ source: 'etsy', externalId: id, orderNumber: id, items: [{ externalId: `li-${id}`, title: `Etsy ${id}`, quantity: 1 }] });
    const cancelled = ingestOrder(etsyOrder('9001')).orderId;
    const shipped = ingestOrder(etsyOrder('9002')).orderId;
    const result = await syncMarketplaceFulfillment('etsy', {
      fetchers: {
        etsy: async () => [{ id: '9002', trackingNumber: 'T1', carrier: 'CP' }],
        etsyCancelled: async () => [{ id: '9001', cancelled: true }],
      },
    });
    assert.deepEqual([result.shipped, result.cancelled], [1, 1]);
    assert.equal(board('9001'), 0);
    assert.ok(partsOf(shipped).every((part) => part.status === 'SHIPPED'));
    assert.ok(partsOf(cancelled).every((part) => part.cancelled === 1));

    const later = ingestOrder(etsyOrder('9003')).orderId;
    const failing = await syncMarketplaceFulfillment('etsy', {
      fetchers: { etsy: async () => [{ id: '9003', trackingNumber: null, carrier: null }], etsyCancelled: async () => { throw new Error('API Etsy en panne'); } },
    });
    assert.equal(failing.shipped, 1);
    assert.ok(partsOf(later).every((part) => part.status === 'SHIPPED'));
  });

  it('les pièces déjà expédiées d\'une commande annulée ne bougent pas', () => {
    const { orderId } = ingestOrder(order('c5'));
    const [first] = partsOf(orderId);
    setStatus(first.id, 'SHIPPED', { force: true });
    ingestOrder(order('c5', { cancelledAt: '2026-03-05T09:00:00Z' }));
    const parts = partsOf(orderId);
    assert.equal(parts.find((part) => part.id === first.id).cancelled, 0);
    assert.equal(parts.filter((part) => part.cancelled === 1).length, 1);
  });

  it('le résumé de synchro mentionne les annulations', () => {
    assert.match(syncMessage('shopify', { ordersSeen: 1 }, { cancelled: 2 }), /2 annulées dans Shopify → retirées de la file/);
  });
});
