import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('filters');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { getFacets, listParts, setStatus, updatePart } = await import('../src/domain/parts.service.js');

describe('Filtres de la file de production', () => {
  before(() => {
    migrate();
    ingestOrder(makeOrder()); // 3 × Glow, Shopify
    ingestOrder(
      makeOrder({
        source: 'etsy',
        externalId: '2002',
        orderNumber: 'E2002',
        items: [{ externalId: 'x', title: 'Keycap Skull 100%', sku: 'KC_SK', variantTitle: 'Black', quantity: 2, unitPrice: 20 }],
      }),
    );
    updatePart(1, { uv: 'A' });
    setStatus(5, 'SHIPPED', { force: true });
  });

  after(() => closeDb());

  it('filtre les pièces sans poste UV', () => {
    assert.equal(listParts({ uv: '__none__' }).total, 4);
    assert.equal(listParts({ uv: 'A' }).total, 1);
    assert.equal(listParts({ uv: 'A,__none__' }).total, 5);
  });

  it('traite % et _ comme du texte dans la recherche', () => {
    assert.equal(listParts({ q: '100%' }).total, 2);
    assert.equal(listParts({ q: 'KC_SK' }).total, 2);
    assert.equal(listParts({ q: 'KC_KR' }).total, 0); // « _ » n'est plus un joker
  });

  it('cherche aussi par nom de résine', () => {
    assert.equal(listParts({ q: 'Noir' }).total, 2);
  });

  it('compte chaque dimension avec les autres filtres actifs', () => {
    const facets = getFacets({ scope: 'board', source: 'etsy' });
    assert.equal(facets.color.black, 1); // l'autre pièce noire est expédiée
    assert.equal(facets.color.glow, undefined);
    // la source ne se filtre pas elle-même : on voit toujours l'alternative
    assert.equal(facets.source.shopify, 3);
    assert.equal(facets.source.etsy, 1);
    assert.equal(facets.uv.__none__, 1);
  });

  it('compte les statuts sans appliquer le filtre de statut', () => {
    const facets = getFacets({ status: 'SHIPPED' });
    assert.equal(facets.status.TO_PRINT, 4);
    assert.equal(facets.status.SHIPPED, 1);
    assert.equal(getFacets({ status: 'SHIPPED' }).color.black, 1);
  });
});
