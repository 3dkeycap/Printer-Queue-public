import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('part-image');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { getPart, listParts } = await import('../src/domain/parts.service.js');

describe("photo produit exposée sur la pièce (tag « Photo » au survol)", () => {
  before(() => migrate());
  after(() => closeDb());

  it("stocke l'image résolue par le connecteur et l'expose sur getPart/listParts", () => {
    const order = makeOrder({
      externalId: 'img-1',
      items: [
        {
          externalId: 'li-img-1',
          title: 'Keycap "Kraken"',
          quantity: 1,
          imageUrl: 'https://cdn.shopify.com/kraken.jpg',
        },
      ],
    });
    const result = ingestOrder(order);
    const [part] = listParts({ orderId: result.orderId }).items;

    assert.equal(part.image_url, 'https://cdn.shopify.com/kraken.jpg');
    assert.equal(getPart(part.id).image_url, 'https://cdn.shopify.com/kraken.jpg');
  });

  it("laisse image_url vide quand aucune photo n'a pu être résolue", () => {
    const result = ingestOrder(makeOrder({ externalId: 'img-2' }));
    const [part] = listParts({ orderId: result.orderId }).items;
    assert.equal(part.image_url, null);
  });

  it('ne remplace jamais une image déjà connue par null lors d\'une re-synchro sans photo', () => {
    const order = makeOrder({
      externalId: 'img-3',
      items: [{ externalId: 'li-img-3', title: 'Keycap "Nova"', quantity: 1, imageUrl: 'https://cdn.shopify.com/nova.jpg' }],
    });
    const first = ingestOrder(order);

    // Un cycle suivant où la récupération de la photo échoue (imageUrl absent) ne doit pas effacer la précédente.
    ingestOrder(makeOrder({
      externalId: 'img-3',
      items: [{ externalId: 'li-img-3', title: 'Keycap "Nova"', quantity: 1 }],
    }));

    const [part] = listParts({ orderId: first.orderId }).items;
    assert.equal(part.image_url, 'https://cdn.shopify.com/nova.jpg');
  });
});
