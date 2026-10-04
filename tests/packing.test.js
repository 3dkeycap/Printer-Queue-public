import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('packing');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { getSettings, updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { getPackingView, savePack } = await import('../src/domain/packing.js');
const { syncMarketplaceFulfillment } = await import('../src/domain/fulfillment.js');
const { listParts, getFacets } = await import('../src/domain/parts.service.js');

const partsOf = (orderId) => getDb().prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY id').all(orderId);

describe("« J'ai packé la commande »", () => {
  let orderId;
  before(() => {
    migrate();
    updateSettings({ 'production.nonPrintableKeywords': ['Color Variety Pack'] });
    orderId = ingestOrder(
      makeOrder({
        externalId: '7770001',
        orderNumber: '#4242',
        note: 'Merci de mettre un mot pour mon fils',
        items: [
          { externalId: 'k', title: 'XDA Ripple Keycap', quantity: 3, raw: { properties: [{ name: 'Initiales', value: 'JS' }, { name: '_hidden', value: 'x' }] } },
          { externalId: 'v', title: 'Color Variety Pack', quantity: 1 },
        ],
      }),
    ).orderId;
  });
  after(() => closeDb());

  it('montre toute la commande, articles en stock compris, avec la note client', () => {
    const view = getPackingView({ shopifyId: '7770001' });
    assert.equal(view.order.number, '#4242');
    assert.deepEqual(view.items.map((item) => [item.title, item.total, item.packed]), [['XDA Ripple Keycap', 3, 0], ['Color Variety Pack', 1, 0]]);
    assert.ok(view.items[1].notPrinted);
    assert.deepEqual(view.buyerDetails.map((d) => d.value), ['Merci de mettre un mot pour mon fils', 'JS']);
  });

  it('pack partiel : pièces mises -> Imprimé + tag, raison pour le reste, nom ajouté à la liste', () => {
    const [keycap, pack] = getPackingView({ shopifyId: '7770001' }).items;
    const view = savePack({ shopifyId: '7770001' }, {
      packer: 'Alex',
      items: [
        { orderItemId: keycap.id, packed: 2, reason: 'Cassée' },
        { orderItemId: pack.id, packed: 1 },
      ],
    });
    const keycaps = partsOf(orderId).filter((part) => part.name === 'XDA Ripple Keycap');
    assert.equal(keycaps.filter((part) => part.packed_by === 'Alex').length, 2);
    assert.ok(keycaps.filter((part) => part.packed_at).every((part) => part.status === 'DONE' && part.comment.includes('Packé par Alex')));
    assert.equal(keycaps.filter((part) => !part.packed_at)[0].status, 'TO_PRINT', 'la manquante reste dans la file');
    assert.equal(keycaps.filter((part) => !part.packed_at)[0].not_printed, 0);
    assert.equal(view.history.length, 1);
    assert.equal(view.history[0].complete, false);
    assert.equal(view.items[0].lastReason, 'Cassée');
    assert.ok(getSettings()['production.packers'].includes('Alex'));

    const rows = listParts({ orderId });
    assert.equal(rows.items.find((row) => !row.packed_at && row.name === 'XDA Ripple Keycap').pack.missing.reason, 'Cassée');
  });

  it('compléter plus tard : le passage suivant garde l\'historique', () => {
    const [keycap, pack] = getPackingView({ shopifyId: '7770001' }).items;
    const view = savePack({ shopifyId: '7770001' }, {
      packer: 'Sam',
      items: [{ orderItemId: keycap.id, packed: 3 }, { orderItemId: pack.id, packed: 1 }],
    });
    assert.equal(view.items[0].packed, 3);
    assert.equal(view.history.length, 2);
    assert.equal(view.history[0].complete, true);
    assert.equal(view.history[0].packer, 'Sam');
  });

  it('pas dans le bac -> remis dans « À imprimer », même un article en stock ; note interne gardée', () => {
    const id = ingestOrder(makeOrder({ externalId: '7770002', orderNumber: '#4243', items: [
      { externalId: 'k2', title: 'Keycap imprimée', quantity: 1 },
      { externalId: 'v2', title: 'Color Variety Pack', quantity: 1 },
    ] })).orderId;
    const keycap = partsOf(id).find((part) => part.name === 'Keycap imprimée');
    getDb().prepare("UPDATE parts SET status = 'DONE' WHERE id = ?").run(keycap.id);
    const [k, v] = getPackingView({ shopifyId: '7770002' }).items;
    const view = savePack({ shopifyId: '7770002' }, {
      packer: 'Alex',
      note: 'Bac 4, étagère du haut',
      items: [{ orderItemId: k.id, packed: 0, reason: 'Cassée' }, { orderItemId: v.id, packed: 0, reason: 'Pas en stock' }],
    });
    const after = partsOf(id);
    assert.ok(after.every((part) => part.status === 'TO_PRINT' && part.not_printed === 0), 'tout ce qui manque revient dans la file');
    assert.equal(view.order.packNote, 'Bac 4, étagère du haut');
    assert.equal(view.history[0].note, 'Bac 4, étagère du haut');
  });

  it('refuse un pack sans nom', () => {
    assert.throws(() => savePack({ shopifyId: '7770001' }, { packer: ' ', items: [] }), /qui a packé/);
  });
});

describe('commandes traitées dans Shopify / Etsy', () => {
  it('toutes les pièces passent en Expédié', async () => {
    const id = ingestOrder(makeOrder({ externalId: '880', orderNumber: '#880', items: [{ externalId: 'a', title: 'Pièce', quantity: 2 }] })).orderId;
    const result = await syncMarketplaceFulfillment('shopify', {
      fetchers: { shopify: async (ids) => { assert.ok(ids.includes('880')); return [{ id: '880', trackingNumber: 'TRK1', carrier: 'Canada Post' }]; } },
    });
    assert.equal(result.shipped, 1);
    assert.ok(partsOf(id).every((part) => part.status === 'SHIPPED'));
    const order = getDb().prepare('SELECT * FROM orders WHERE id = ?').get(id);
    assert.equal(order.tracking_number, 'TRK1');
    assert.ok(order.shipped_at);
  });
});

describe('commandes en retard', () => {
  it('filtre et compte les commandes plus vieilles que le seuil', () => {
    updateSettings({ 'production.lateDays': 5 });
    ingestOrder(makeOrder({ externalId: 'late1', orderNumber: '#L1', placedAt: new Date(Date.now() - 10 * 86400000).toISOString(), items: [{ externalId: 'x', title: 'Vieille', quantity: 1 }] }));
    ingestOrder(makeOrder({ externalId: 'new1', orderNumber: '#N1', placedAt: new Date().toISOString(), items: [{ externalId: 'y', title: 'Récente', quantity: 1 }] }));
    const late = listParts({ late: '1', q: 'L1' });
    assert.equal(late.total, 1);
    assert.equal(listParts({ late: '1', q: 'N1' }).total, 0);
    assert.ok(getFacets({ scope: 'board' }).late >= 1);
  });
});
