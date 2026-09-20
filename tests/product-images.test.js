import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const { attachProductImages, fetchProductImage } = await import('../src/integrations/shopify.js');
const { attachListingImages, fetchListingImage } = await import('../src/integrations/etsy.js');

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const SHOPIFY_SETTINGS = {
  'shopify.shopDomain': 'atelier-test.myshopify.com',
  'shopify.apiVersion': '2024-01',
  'shopify.accessToken': 'shpat_abc',
};

const ETSY_SETTINGS = {
  'etsy.apiKey': 'keystring_123',
  'etsy.accessToken': 'access-token-xyz',
};

describe('photo produit Shopify (best-effort, ne bloque jamais la synchro)', () => {
  it("récupère l'image principale du produit via son product_id", async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      assert.match(String(url), /\/products\/998877\.json\?fields=id,image$/);
      return new Response(JSON.stringify({ product: { id: 998877, image: { src: 'https://cdn.shopify.com/photo.jpg' } } }), {
        status: 200,
      });
    };

    const url = await fetchProductImage('998877', SHOPIFY_SETTINGS);
    assert.equal(url, 'https://cdn.shopify.com/photo.jpg');
    assert.equal(calls, 1);
  });

  it('retourne null sans appel réseau quand la ligne n\'a pas de product_id', async () => {
    globalThis.fetch = async () => {
      throw new Error('ne devrait jamais être appelé');
    };
    assert.equal(await fetchProductImage(null, SHOPIFY_SETTINGS), null);
  });

  it('ne fait jamais échouer la synchro si Shopify répond une erreur', async () => {
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    const orders = [{ items: [{ productId: '55', imageUrl: undefined }] }];
    await assert.doesNotReject(attachProductImages(orders, SHOPIFY_SETTINGS));
    assert.equal(orders[0].items[0].imageUrl, null);
  });

  it('met en cache un product_id déjà résolu (un seul appel réseau pour plusieurs pièces)', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ product: { image: { src: 'https://cdn.shopify.com/cached.jpg' } } }), {
        status: 200,
      });
    };
    const orders = [
      { items: [{ productId: '777' }, { productId: '777' }] },
      { items: [{ productId: '777' }] },
    ];
    await attachProductImages(orders, SHOPIFY_SETTINGS);
    assert.equal(calls, 1);
    for (const order of orders) {
      for (const item of order.items) assert.equal(item.imageUrl, 'https://cdn.shopify.com/cached.jpg');
    }
  });
});

describe('photo produit Etsy (best-effort, ne bloque jamais la synchro)', () => {
  it("récupère la photo de l'annonce via listing_id + listing_image_id", async () => {
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /\/listings\/445566\/images\/998$/);
      assert.equal(options.headers['x-api-key'], 'keystring_123');
      assert.equal(options.headers.Authorization, 'Bearer access-token-xyz');
      return new Response(JSON.stringify({ url_570xN: 'https://i.etsystatic.com/photo.jpg' }), { status: 200 });
    };
    const url = await fetchListingImage('445566', '998', ETSY_SETTINGS);
    assert.equal(url, 'https://i.etsystatic.com/photo.jpg');
  });

  it('retourne null sans appel réseau quand listing_id ou listing_image_id manque', async () => {
    globalThis.fetch = async () => {
      throw new Error('ne devrait jamais être appelé');
    };
    assert.equal(await fetchListingImage(null, '998', ETSY_SETTINGS), null);
    assert.equal(await fetchListingImage('445566', null, ETSY_SETTINGS), null);
  });

  it('ne fait jamais échouer la synchro si Etsy répond une erreur', async () => {
    globalThis.fetch = async () => new Response('not found', { status: 404 });
    const orders = [{ items: [{ listingId: '1', listingImageId: '2' }] }];
    await assert.doesNotReject(attachListingImages(orders, ETSY_SETTINGS));
    assert.equal(orders[0].items[0].imageUrl, null);
  });
});
