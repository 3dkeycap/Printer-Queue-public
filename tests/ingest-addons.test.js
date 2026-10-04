import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('ingest-addons');
const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');

const partsOf = (orderId) =>
  getDb().prepare('SELECT * FROM parts WHERE order_id = ? ORDER BY id').all(orderId);
const itemsOf = (orderId) =>
  getDb().prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);

describe('suppléments Etsy/Shopify (pas des objets à imprimer)', () => {
  before(() => migrate());
  after(() => closeDb());

  it('« Custom UV Printed Legends » ne crée aucune pièce et marque la vraie pièce UV', () => {
    const order = makeOrder({
      externalId: '5001',
      orderNumber: '#5001',
      items: [
        {
          externalId: 'li-real',
          title: 'Custom Keycap Set',
          quantity: 1,
          variantTitle: 'Noir',
        },
        {
          externalId: 'li-addon',
          title: 'Custom UV Printed Legends',
          quantity: 1,
        },
      ],
    });

    const result = ingestOrder(order);
    assert.equal(result.partsCreated, 1, 'une seule pièce : le supplément UV n\'en crée pas');

    const parts = partsOf(result.orderId);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].name, 'Custom Keycap Set');
    assert.equal(parts[0].uv, 'oui', 'la pièce reçoit automatiquement la valeur UV');

    // la ligne de commande du supplément reste enregistrée pour l'historique
    const items = itemsOf(result.orderId);
    assert.equal(items.length, 2);
    assert.ok(items.some((item) => item.title === 'Custom UV Printed Legends'));
  });

  it('« Color Variety Pack » ne crée pas de pièce mais ne déclenche pas l\'UV', () => {
    const order = makeOrder({
      externalId: '5002',
      orderNumber: '#5002',
      items: [
        { externalId: 'li-real-2', title: 'Custom Keycap Set', quantity: 2, variantTitle: 'Blanc' },
        { externalId: 'li-addon-2', title: 'Color Variety Pack', quantity: 1 },
      ],
    });

    const result = ingestOrder(order);
    assert.equal(result.partsCreated, 2);

    const parts = partsOf(result.orderId);
    assert.ok(parts.every((part) => part.uv === null), 'pas de supplément UV dans cette commande');
  });

  it('une commande sans supplément se comporte normalement (aucune régression)', () => {
    const result = ingestOrder(makeOrder({ externalId: '5003', orderNumber: '#5003' }));
    const parts = partsOf(result.orderId);
    assert.equal(parts.length, 3);
    assert.ok(parts.every((part) => part.uv === null));
  });

  it('les mots-clés et la valeur UV automatique sont personnalisables', () => {
    updateSettings({
      'production.nonPrintableKeywords': ['Add-on spécial'],
      'production.uvTriggerKeywords': ['Add-on spécial'],
      'production.uvAutoValue': 'A',
    });

    const order = makeOrder({
      externalId: '5004',
      orderNumber: '#5004',
      items: [
        { externalId: 'li-real-4', title: 'Custom Keycap Set', quantity: 1 },
        { externalId: 'li-addon-4', title: 'Add-on spécial', quantity: 1 },
      ],
    });

    const result = ingestOrder(order);
    assert.equal(result.partsCreated, 1);
    assert.equal(partsOf(result.orderId)[0].uv, 'A');
  });

  it('la détection est insensible à la casse', () => {
    updateSettings({
      'production.nonPrintableKeywords': ['Custom UV Printed Legends', 'Color Variety Pack'],
      'production.uvTriggerKeywords': ['Custom UV Printed Legends'],
      'production.uvAutoValue': 'oui',
    });

    const order = makeOrder({
      externalId: '5005',
      orderNumber: '#5005',
      items: [
        { externalId: 'li-real-5', title: 'Custom Keycap Set', quantity: 1 },
        { externalId: 'li-addon-5', title: 'CUSTOM uv PRINTED legends', quantity: 1 },
      ],
    });

    const result = ingestOrder(order);
    assert.equal(result.partsCreated, 1);
    assert.equal(partsOf(result.orderId)[0].uv, 'oui');
  });
});

describe('nettoyage des suppléments déjà dans la file', () => {
  before(() => migrate());

  const seed = (externalId) => {
    updateSettings({ 'production.nonPrintableKeywords': [] });
    const result = ingestOrder(
      makeOrder({
        externalId,
        orderNumber: `#${externalId}`,
        items: [{ externalId: `li-${externalId}`, title: 'Keycap Puller', quantity: 2 }],
      }),
    );
    return result.orderId;
  };

  it('retire les pièces automatiques d\'un supplément devenu « à ne pas imprimer »', async () => {
    const { purgeNonPrintableParts } = await import('../src/domain/addons.js');
    const orderId = seed('6001');
    assert.equal(partsOf(orderId).length, 2);
    updateSettings({ 'production.nonPrintableKeywords': ['keycap puller'] });
    assert.equal(purgeNonPrintableParts().removed, 2);
    assert.equal(partsOf(orderId).length, 0);
    assert.equal(itemsOf(orderId).length, 1, 'la ligne de commande reste');
  });

  it('garde une pièce dont un humain s\'est occupé', async () => {
    const { purgeNonPrintableParts } = await import('../src/domain/addons.js');
    const orderId = seed('6002');
    const [first] = partsOf(orderId);
    getDb()
      .prepare(`INSERT INTO part_events (part_id, from_status, to_status, actor) VALUES (?, 'TO_PRINT', 'TO_PRINT', 'dashboard')`)
      .run(first.id);
    updateSettings({ 'production.nonPrintableKeywords': ['keycap puller'] });
    assert.equal(purgeNonPrintableParts().removed, 1);
    assert.equal(partsOf(orderId).length, 1);
    assert.equal(partsOf(orderId)[0].id, first.id);
  });
});

describe('« Enlever tout maintenant »', () => {
  before(() => migrate());

  it('retire les pièces correspondantes, même touchées, mais pas les manuelles ni en cours', async () => {
    const { purgeNow } = await import('../src/domain/addons.js');
    const { createManualPart, setStatus } = await import('../src/domain/parts.service.js');
    updateSettings({ 'production.nonPrintableKeywords': [] });
    const orderId = ingestOrder(
      makeOrder({
        externalId: '8001',
        orderNumber: '#8001',
        items: [
          { externalId: 'a', title: 'Spacebar Sticker', quantity: 2 },
          { externalId: 'b', title: 'Spacebar Sticker', quantity: 1, variantTitle: 'X' },
          { externalId: 'c', title: 'Real Keycap', quantity: 1 },
        ],
      }),
    ).orderId;
    const stickers = partsOf(orderId).filter((p) => p.name === 'Spacebar Sticker');
    assert.equal(stickers.length, 3);
    setStatus(stickers[0].id, 'PRINTING');
    createManualPart({ name: 'Spacebar Sticker', quantity: 1 });

    const preview = purgeNow({ keywords: ['sticker'], dryRun: true });
    assert.equal(preview.removed, 2, 'la pièce en impression et la manuelle sont épargnées');
    assert.equal(partsOf(orderId).length, 4, 'dryRun ne supprime rien');

    assert.equal(purgeNow({ keywords: ['sticker'] }).removed, 2);
    assert.equal(partsOf(orderId).length, 2);
    assert.ok(partsOf(orderId).some((p) => p.name === 'Real Keycap'));
  });
});
