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
