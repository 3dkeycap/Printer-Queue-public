import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('images');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { listParts } = await import('../src/domain/parts.service.js');
const { blockImage } = await import('../src/domain/images.js');

const GENERIC = 'https://i.etsystatic.com/34893203/r/il/5a700b/8625116585/il_570xN.8625116585_xp78.jpg';

describe('photos bouche-trou (Etsy)', () => {
  before(() => migrate());
  after(() => closeDb());

  it('masque une image partagée par plusieurs articles différents, garde les vraies photos', () => {
    const titles = ['Keycap A', 'Keycap B', 'Keycap C'];
    titles.forEach((title, i) =>
      ingestOrder(makeOrder({ source: 'etsy', externalId: `E${i}`, items: [{ externalId: `t${i}`, title, quantity: 1, imageUrl: GENERIC }] })),
    );
    ingestOrder(makeOrder({ source: 'etsy', externalId: 'E9', items: [{ externalId: 't9', title: 'Keycap D', quantity: 1, imageUrl: 'https://i.etsystatic.com/real/d.jpg' }] }));
    // la même vraie photo sur deux commandes du MÊME article reste affichée
    ingestOrder(makeOrder({ source: 'etsy', externalId: 'E10', items: [{ externalId: 't10', title: 'Keycap D', quantity: 1, imageUrl: 'https://i.etsystatic.com/real/d.jpg' }] }));

    const byName = Object.fromEntries(listParts({ limit: 100 }).items.map((part) => [part.name, part.image_url]));
    assert.equal(byName['Keycap A'], null);
    assert.equal(byName['Keycap C'], null);
    assert.equal(byName['Keycap D'], 'https://i.etsystatic.com/real/d.jpg');
  });

  it('« Pas la bonne photo » masque une image à la main', () => {
    blockImage('https://i.etsystatic.com/real/d.jpg');
    assert.ok(listParts({ limit: 100 }).items.every((part) => part.image_url === null));
    assert.throws(() => blockImage('javascript:alert(1)'), /invalide/);
  });
});
