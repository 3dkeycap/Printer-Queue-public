import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('shipped-orders');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb, setSetting } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { fetchShipments } = await import('../src/integrations/chitchats.js');

const realFetch = globalThis.fetch;

describe('une commande expédiée ne reste jamais à imprimer', () => {
  after(() => {
    globalThis.fetch = realFetch;
    closeDb();
  });

  it('réparation ponctuelle : les pièces d’une commande déjà expédiée quittent le tableau (pas les annulées)', () => {
    migrate();
    const db = getDb();
    const shipped = ingestOrder(makeOrder({ externalId: 'S1', orderNumber: '#S1', items: [{ externalId: 's1', title: 'Pièce', quantity: 2 }] }));
    const open = ingestOrder(makeOrder({ externalId: 'S2', orderNumber: '#S2', items: [{ externalId: 's2', title: 'Pièce', quantity: 1 }] }));
    db.prepare("UPDATE orders SET shipped_at = '2026-11-01T10:00:00.000Z' WHERE id = ?").run(shipped.orderId);
    const [first] = db.prepare('SELECT id FROM parts WHERE order_id = ? ORDER BY id').all(shipped.orderId);
    db.prepare('UPDATE parts SET cancelled = 1 WHERE id = ?').run(first.id);

    setSetting('internal.shippedOrdersPartsShipped', '');
    migrate();
    const statuses = (orderId) => db.prepare('SELECT status, cancelled FROM parts WHERE order_id = ? ORDER BY id').all(orderId);
    assert.deepEqual(statuses(shipped.orderId), [{ status: 'TO_PRINT', cancelled: 1 }, { status: 'SHIPPED', cancelled: 0 }]);
    assert.deepEqual(statuses(open.orderId), [{ status: 'TO_PRINT', cancelled: 0 }], 'commande pas expédiée : rien ne bouge');
    const event = db.prepare("SELECT * FROM part_events WHERE to_status = 'SHIPPED' AND actor = 'system'").get();
    assert.match(event.note, /déjà expédiée/);
  });

  it('Chit Chats renvoie un tableau : les envois sont lus, sur plusieurs pages', async () => {
    updateSettings({ 'chitchats.clientId': '42', 'chitchats.accessToken': 'cc_test_token', 'chitchats.apiBase': 'https://chitchats.test/api/v1' });
    const pages = [];
    globalThis.fetch = async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      pages.push(page);
      const count = page === 1 ? 100 : 7;
      return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `p${page}-${i}`, status: 'ready', order_id: `#${i}` }))), { status: 200 });
    };
    const shipments = await fetchShipments();
    assert.deepEqual(pages, [1, 2]);
    assert.equal(shipments.length, 107);
    assert.equal(shipments[0].status, 'ready');
  });
});
