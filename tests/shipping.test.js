import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('shipping');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { setStatus } = await import('../src/domain/parts.service.js');
const { findOrderForShipment } = await import('../src/domain/orders.service.js');
const { applyShipment } = await import('../src/jobs/syncShipments.js');
const { isShippedStatus, normalizeShipment } = await import('../src/integrations/chitchats.js');

describe('intégration Chit Chats', () => {
  before(() => migrate());
  after(() => closeDb());

  it('normalise aussi bien le payload REST que le payload webhook', () => {
    const fromWebhook = normalizeShipment({ shipment: { id: 42, status: 'in_transit', tracking_number: 'CC1' } });
    const fromRest = normalizeShipment({ id: 42, shipment_status: 'in_transit', tracking_code: 'CC1' });
    assert.equal(fromWebhook.id, 42);
    assert.equal(fromRest.id, 42);
    assert.equal(fromWebhook.tracking_number, 'CC1');
    assert.equal(fromRest.tracking_number, 'CC1');
  });

  it('expédié dès l’affranchissement payé (ready), pas avant (pending)', () => {
    for (const status of ['ready', 'received', 'released', 'inducted', 'in_transit', 'Delivered']) assert.ok(isShippedStatus(status), status);
    for (const status of ['pending', 'canceled', 'voided', 'unfulfilled', null]) assert.ok(!isShippedStatus(status), String(status));
  });

  it('retrouve la commande locale via le numéro Chit Chats', () => {
    ingestOrder(makeOrder());
    assert.equal(findOrderForShipment({ order_id: '#1001' }).order_number, '#1001');
    assert.equal(findOrderForShipment({ order_id: '1001' }).order_number, '#1001', 'sans le dièse');
    assert.equal(findOrderForShipment({ reference: '1001' }).order_number, '#1001', 'via reference');
    assert.equal(findOrderForShipment({ order_id: 'inconnu' }), null);
  });

  it('bascule toutes les pièces de la commande en SHIPPED', () => {
    const result = applyShipment({
      id: 'cc_1',
      status: 'in_transit',
      order_id: '#1001',
      tracking_number: 'CCTRK900',
      carrier: 'chit_chats_us_edge',
    });

    assert.equal(result.matched, true);
    assert.equal(result.shipped, 3);

    const parts = getDb().prepare('SELECT * FROM parts WHERE order_id = ?').all(result.order.id);
    assert.ok(parts.every((p) => p.status === 'SHIPPED'));
    assert.ok(parts.every((p) => p.shipped_at));

    const order = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(result.order.id);
    assert.equal(order.tracking_number, 'CCTRK900');
    assert.equal(order.chitchats_shipment_id, 'cc_1');
    assert.ok(order.shipped_at);
  });

  it('trace l\'expédition dans l\'historique de chaque pièce', () => {
    const events = getDb()
      .prepare(`SELECT * FROM part_events WHERE to_status = 'SHIPPED'`)
      .all();
    assert.equal(events.length, 3);
    assert.ok(events[0].actor.startsWith('chitchats'));
    assert.match(events[0].note, /CCTRK900/);
  });

  it('ignore un colis qui n\'est pas encore parti', () => {
    ingestOrder(makeOrder({ externalId: '2002', orderNumber: '#2002' }));
    const result = applyShipment({ id: 'cc_2', status: 'pending', order_id: '#2002' });
    assert.equal(result.matched, false);
    const parts = getDb()
      .prepare(`SELECT p.status FROM parts p JOIN orders o ON o.id = p.order_id WHERE o.order_number = '#2002'`)
      .all();
    assert.ok(parts.every((p) => p.status === 'TO_PRINT'));
  });

  it('signale un colis sans commande correspondante sans planter', () => {
    const result = applyShipment({ id: 'cc_3', status: 'delivered', order_id: '#9999' });
    assert.equal(result.matched, false);
    assert.match(result.reason, /no matching order/);
  });

  it('expédie aussi les pièces déjà imprimées', () => {
    const order = ingestOrder(makeOrder({ externalId: '3003', orderNumber: '#3003' }));
    const parts = getDb().prepare('SELECT id FROM parts WHERE order_id = ?').all(order.orderId);
    for (const step of ['PRINTING', 'DONE']) {
      setStatus(parts[0].id, step, { actor: 'test' });
    }
    const result = applyShipment({ id: 'cc_4', status: 'delivered', order_id: '#3003' });
    assert.equal(result.shipped, 3);
  });

  it('affranchissement payé : TOUTES les pièces quittent le tableau, même pas imprimées, quel que soit l’ancien réglage', () => {
    getDb().prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('chitchats.shipAllParts', 'false', 'x') ON CONFLICT (key) DO UPDATE SET value = 'false'`).run();
    const order = ingestOrder(makeOrder({ externalId: '4004', orderNumber: '#4004' }));
    const result = applyShipment({ id: 'cc_5', status: 'ready', order_id: '#4004' });
    assert.equal(result.matched, true);
    const statuses = getDb().prepare('SELECT status FROM parts WHERE order_id = ?').all(order.orderId).map((row) => row.status);
    assert.deepEqual([...new Set(statuses)], ['SHIPPED']);
  });

  it('une resynchronisation ne remet jamais de pièce « À imprimer » sur une commande expédiée', () => {
    const shippedOrder = makeOrder({ externalId: '4004', orderNumber: '#4004' });
    shippedOrder.items = [...shippedOrder.items, { externalId: 'extra-line', title: 'Ligne ajoutée après coup', quantity: 2 }];
    shippedOrder.items[0] = { ...shippedOrder.items[0], quantity: Number(shippedOrder.items[0].quantity ?? 1) + 3 };
    const again = ingestOrder(shippedOrder);
    assert.equal(again.partsCreated, 0);
    const open = getDb().prepare(`SELECT COUNT(*) AS n FROM parts WHERE order_id = ? AND status <> 'SHIPPED'`).get(again.orderId).n;
    assert.equal(open, 0);
  });
});
