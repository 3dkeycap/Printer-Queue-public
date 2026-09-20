import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('marketplaces');
const { normalizeOrder } = await import('../src/integrations/shopify.js');
const { normalizeReceipt } = await import('../src/integrations/etsy.js');
const { generateMockOrders } = await import('../src/integrations/mock-data.js');

const SHOPIFY_ORDER = {
  id: 5544332211,
  name: '#1042',
  order_number: 1042,
  email: 'buyer@example.com',
  created_at: '2026-02-01T12:00:00-05:00',
  total_price: '134.00',
  currency: 'CAD',
  tags: 'wholesale, RUSH',
  customer: { first_name: 'Marie', last_name: 'Dubois' },
  shipping_address: { country_code: 'CA', name: 'Marie Dubois' },
  line_items: [
    {
      id: 111,
      title: 'Keycap "Astronaut"',
      sku: 'KC-ASTRO-R1',
      variant_title: 'Beige / R1',
      quantity: 2,
      price: '48.00',
      properties: [{ name: 'Colour', value: 'Glow in the dark' }],
    },
    { id: 222, title: 'Carte cadeau', quantity: 1, price: '0.00', requires_shipping: false },
  ],
};

const ETSY_RECEIPT = {
  receipt_id: 3021847461,
  name: 'Yuki Tanaka',
  buyer_email: 'yuki@example.com',
  country_iso: 'JP',
  created_timestamp: 1770000000,
  grandtotal: { amount: 9800, divisor: 100, currency_code: 'CAD' },
  transactions: [
    {
      transaction_id: 77001,
      title: 'Keycap "Lucky Cat"',
      sku: 'KC-LCAT-SA',
      quantity: 3,
      price: { amount: 4400, divisor: 100 },
      variations: [
        { formatted_name: 'Color', formatted_value: 'Bleu nuit' },
        { formatted_name: 'Profile', formatted_value: 'SA' },
      ],
    },
  ],
};

describe('normalisation Shopify', () => {
  const order = normalizeOrder(SHOPIFY_ORDER);

  it('mappe les champs de la commande', () => {
    assert.equal(order.source, 'shopify');
    assert.equal(order.externalId, '5544332211');
    assert.equal(order.orderNumber, '#1042');
    assert.equal(order.customerName, 'Marie Dubois');
    assert.equal(order.shippingCountry, 'CA');
  });

  it('détecte le tag RUSH', () => {
    assert.equal(order.isPriority, true);
  });

  it('exclut les lignes sans expédition (cartes cadeaux)', () => {
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, 2);
  });

  it('privilégie la propriété « Colour » saisie par le client', () => {
    assert.equal(order.items[0].colorHints[0], 'Glow in the dark');
  });
});

describe('normalisation Etsy', () => {
  const order = normalizeReceipt(ETSY_RECEIPT);

  it('mappe le receipt et convertit les montants', () => {
    assert.equal(order.source, 'etsy');
    assert.equal(order.orderNumber, '3021847461');
    assert.equal(order.totalPrice, 98);
    assert.equal(order.items[0].unitPrice, 44);
  });

  it('convertit le timestamp Unix en ISO', () => {
    assert.equal(order.placedAt, new Date(1770000000 * 1000).toISOString());
  });

  it('assemble les variations et isole la couleur', () => {
    assert.equal(order.items[0].variantTitle, 'Color Bleu nuit / Profile SA');
    assert.equal(order.items[0].colorHints[0], 'Bleu nuit');
    assert.equal(order.items[0].quantity, 3);
  });
});

describe('générateur de données de démonstration', () => {
  it('est déterministe pour une graine donnée', () => {
    const a = generateMockOrders('shopify', 7, 2);
    const b = generateMockOrders('shopify', 7, 2);
    assert.deepEqual(a, b);
  });

  it('produit des commandes distinctes d\'une graine à l\'autre', () => {
    const a = generateMockOrders('shopify', 1, 1)[0];
    const b = generateMockOrders('shopify', 2, 1)[0];
    assert.notEqual(a.externalId, b.externalId);
  });

  it('respecte le format normalisé attendu par l\'ingestion', () => {
    const [order] = generateMockOrders('etsy', 3, 1);
    assert.equal(order.source, 'etsy');
    assert.ok(order.items.length >= 1);
    assert.ok(order.items.every((item) => item.quantity >= 1 && item.externalId && item.title));
  });
});
