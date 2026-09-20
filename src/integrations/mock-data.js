/**
 * Deterministic fake marketplace data.
 * `INTEGRATION_MODE=mock` (the default) lets the whole stack run - and be
 * demoed - without a single API credential.
 */

const PRODUCTS = [
  { title: 'Keycap "Tiki Skull" - artisan', sku: 'KC-TIKI', price: 42 },
  { title: 'Keycap "Astronaut" - artisan', sku: 'KC-ASTRO', price: 48 },
  { title: 'Keycap "Kraken" - artisan', sku: 'KC-KRAKEN', price: 55 },
  { title: 'Keycap "Mecha Cat" - artisan', sku: 'KC-MCAT', price: 39 },
  { title: 'Keycap "Lucky Cat" - artisan', sku: 'KC-LCAT', price: 44 },
  { title: 'Deskmat stand + keycap holder', sku: 'ACC-STAND', price: 25 },
  { title: 'Switch opener - résine', sku: 'ACC-OPENER', price: 18 },
  { title: 'Keycap "Dragon Egg" - artisan', sku: 'KC-DEGG', price: 52 },
];

const COLORS = [
  'Black', 'White', 'Beige', 'Glow in the dark', 'Clear', 'Rouge', 'Bleu nuit',
  'Mint', 'Purple', 'Gold', 'Pink', 'Marble',
];

const SIZES = ['R1', 'R2', 'R3', 'SA', 'Cherry'];

const FIRST = ['Alex', 'Marie', 'Yuki', 'Tomas', 'Sofia', 'Liam', 'Noor', 'Ines', 'Karl', 'Mei', 'Owen', 'Zoé'];
const LAST = ['Tremblay', 'Nguyen', 'Dubois', 'Smith', 'Kowalski', 'Rossi', 'Haddad', 'Olsen', 'García', 'Yamada'];
const COUNTRIES = ['CA', 'US', 'FR', 'DE', 'JP', 'GB', 'AU'];

/** Tiny deterministic PRNG (mulberry32) so a given seed always replays. */
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, list) => list[Math.floor(random() * list.length)];

/**
 * @param {'shopify'|'etsy'} source
 * @param {number} seed        monotonic counter kept in the `settings` table
 * @param {number} count       number of orders to fabricate
 */
export const generateMockOrders = (source, seed, count) => {
  const random = rng(seed * 7919 + (source === 'etsy' ? 13 : 0));
  const orders = [];

  for (let i = 0; i < count; i += 1) {
    const ref = seed * 100 + i;
    const customer = `${pick(random, FIRST)} ${pick(random, LAST)}`;
    const itemCount = 1 + Math.floor(random() * 3);
    const items = [];

    for (let j = 0; j < itemCount; j += 1) {
      const product = pick(random, PRODUCTS);
      const color = pick(random, COLORS);
      const profile = pick(random, SIZES);
      const quantity = 1 + Math.floor(random() * 3);
      items.push({
        externalId: `${source}-li-${ref}-${j}`,
        title: product.title,
        sku: `${product.sku}-${profile}`,
        variantTitle: `${color} / ${profile}`,
        quantity,
        unitPrice: product.price,
        colorHints: [color],
        raw: { mock: true, color, profile },
      });
    }

    const placedAt = new Date(Date.now() - Math.floor(random() * 72) * 3600 * 1000).toISOString();
    orders.push({
      source,
      externalId: source === 'shopify' ? `55${ref}0000${ref}` : `30${ref}47461`,
      orderNumber: source === 'shopify' ? `#${1000 + ref}` : `${2000 + ref}`,
      customerName: customer,
      customerEmail: `${customer.toLowerCase().replace(/[^a-z]/g, '.')}@example.com`,
      shippingCountry: pick(random, COUNTRIES),
      placedAt,
      totalPrice: items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      currency: 'CAD',
      isPriority: random() > 0.85,
      items,
      raw: { mock: true, source, ref },
    });
  }

  return orders;
};

/** Fake Chit Chats shipments for the orders passed in. */
export const generateMockShipments = (orders) =>
  orders.map((order, index) => ({
    id: `cc_${order.external_id}`,
    order_id: order.order_number,
    to_name: order.customer_name,
    status: 'in_transit',
    tracking_number: `CCTRK${String(1000000 + index)}`,
    postage_type: 'chit_chats_us_edge',
    shipped_at: new Date().toISOString(),
    mock: true,
  }));
