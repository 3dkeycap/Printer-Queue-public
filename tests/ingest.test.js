import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('ingest');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { ingestOrder, ingestOrders } = await import('../src/domain/ingest.js');
const { listParts } = await import('../src/domain/parts.service.js');

const partsOfOrder = (orderId) =>
  getDb().prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY unit_index').all(orderId);

describe('ingestion des commandes', () => {
  before(() => migrate());
  after(() => closeDb());

  it('crée une pièce par objet physique (quantité 3 => 3 lignes)', () => {
    const result = ingestOrder(makeOrder());
    assert.equal(result.partsCreated, 3);

    const parts = partsOfOrder(result.orderId);
    assert.equal(parts.length, 3);
    assert.deepEqual(parts.map((p) => p.unit_index), [1, 2, 3]);
    assert.ok(parts.every((p) => p.status === 'TO_PRINT'));
  });

  it('déduit la couleur de résine de la variante', () => {
    const parts = partsOfOrder(1);
    assert.ok(parts.every((p) => p.color_key === 'glow'));
  });

  it('journalise la création de chaque pièce', () => {
    const events = getDb()
      .prepare(`SELECT * FROM part_events WHERE to_status = 'TO_PRINT' AND from_status IS NULL`)
      .all();
    assert.equal(events.length, 3);
    assert.equal(events[0].actor, 'worker');
  });

  it('est idempotent : re-synchroniser ne duplique rien', () => {
    const result = ingestOrder(makeOrder());
    assert.equal(result.orderCreated, false);
    assert.equal(result.partsCreated, 0);
    assert.equal(result.partsUpdated, 3);
    assert.equal(partsOfOrder(1).length, 3);
  });

  it('ajoute uniquement les pièces manquantes si la quantité augmente', () => {
    const order = makeOrder();
    order.items[0].quantity = 5;
    const result = ingestOrder(order);
    assert.equal(result.partsCreated, 2);
    assert.equal(partsOfOrder(1).length, 5);
  });

  it('conserve les pièces déjà produites si la quantité baisse', () => {
    const order = makeOrder();
    order.items[0].quantity = 1;
    ingestOrder(order);
    assert.equal(partsOfOrder(1).length, 5);
  });

  it('éclate chaque ligne d\'une commande multi-articles', () => {
    const summary = ingestOrders([
      makeOrder({
        externalId: '1002',
        orderNumber: '#1002',
        items: [
          { externalId: 'a', title: 'Keycap "Tiki"', quantity: 2, variantTitle: 'Beige / R1' },
          { externalId: 'b', title: 'Switch opener', quantity: 1, variantTitle: 'Noir / -' },
        ],
      }),
    ]);
    assert.equal(summary.ordersCreated, 1);
    assert.equal(summary.partsCreated, 3);

    const { items } = listParts({ scope: 'board', limit: 100 });
    const forOrder = items.filter((p) => p.order_number === '#1002');
    assert.deepEqual(forOrder.map((p) => p.color_key).sort(), ['beige', 'beige', 'black']);
  });

  it('marque les commandes taguées comme prioritaires', () => {
    const result = ingestOrder(makeOrder({ externalId: '1003', orderNumber: '#1003', isPriority: true }));
    assert.ok(partsOfOrder(result.orderId).every((p) => p.priority === 1));
  });
});
