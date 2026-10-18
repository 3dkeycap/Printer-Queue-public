import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('color-rules');
const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { applyColorRules, parseColorRules } = await import('../src/domain/colors.js');
const { ingestOrder } = await import('../src/domain/ingest.js');

const colorsOf = (orderId) =>
  getDb().prepare('SELECT color_key FROM parts WHERE order_id = ? ORDER BY id').all(orderId).map((row) => row.color_key);

const oreOrder = (externalId) =>
  makeOrder({
    externalId,
    orderNumber: `#${externalId}`,
    items: [{ externalId: `li-${externalId}`, title: 'Ore Keycap', variantTitle: 'Gold', quantity: 2 }],
  });

describe('couleur forcée selon le nom (Ore Keycap = nylon gris)', () => {
  before(() => migrate());
  after(() => closeDb());

  it('par défaut, un Ore Keycap en variante Gold devient Nylon Grey', () => {
    const { orderId } = ingestOrder(oreOrder('7001'));
    assert.deepEqual(colorsOf(orderId), ['nylon-grey', 'nylon-grey']);
  });

  it('sans règle, la variante Gold donnerait de l\'or ; ajouter la règle rattrape les pièces non touchées', () => {
    updateSettings({ 'production.colorRules': [] });
    const { orderId } = ingestOrder(oreOrder('7002'));
    assert.deepEqual(colorsOf(orderId), ['gold', 'gold']);

    updateSettings({ 'production.colorRules': ['Ore Keycap => Nylon Grey'] });
    const result = applyColorRules(parseColorRules(['Ore Keycap => Nylon Grey']));
    assert.equal(result.recolored, 2);
    assert.deepEqual(colorsOf(orderId), ['nylon-grey', 'nylon-grey']);
    // la ligne de commande suit, sinon la prochaine synchro remettrait « or »
    const item = getDb().prepare('SELECT color_key FROM order_items WHERE order_id = ?').get(orderId);
    assert.equal(item.color_key, 'nylon-grey');
  });

  it('ne touche pas une pièce dont un humain s\'est occupé', () => {
    updateSettings({ 'production.colorRules': [] });
    const { orderId } = ingestOrder(oreOrder('7003'));
    const [first] = getDb().prepare('SELECT id FROM parts WHERE order_id = ? ORDER BY id').all(orderId);
    getDb().prepare(`INSERT INTO part_events (part_id, from_status, to_status, actor, created_at) VALUES (?, 'TO_PRINT', 'TO_PRINT', 'dashboard', datetime('now'))`).run(first.id);
    applyColorRules(parseColorRules(['Ore Keycap => Nylon Grey']));
    assert.deepEqual(colorsOf(orderId), ['gold', 'nylon-grey']);
  });
});
