import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('cc-import');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { ApiError } = await import('../src/lib/http.js');
const { buildShipment, explainApiError, importOrdersToChitChats } = await import('../src/domain/chitchatsImport.js');
const { getPart } = await import('../src/domain/parts.service.js');

const shopifyRaw = (address) => ({ id: 1, email: 'bob@example.com', shipping_address: address });
const GOOD_ADDRESS = {
  name: 'Bob Tremblay', address1: '123 rue Principale', city: 'Montréal',
  province_code: 'QC', zip: 'H2X 1Y4', country_code: 'CA',
};

const fakeClient = ({ existing = [], createError = null } = {}) => {
  const created = [];
  return {
    created,
    search: async () => ({ shipments: existing }),
    create: async (payload) => {
      if (createError) throw createError;
      created.push(payload);
      return { shipment: { id: `S${created.length}`, ...payload } };
    },
  };
};

const orderRow = (externalId) => getDb().prepare("SELECT * FROM orders WHERE external_id = ?").get(externalId);
const partOf = (externalId) => getDb().prepare('SELECT id FROM parts WHERE order_id = ?').get(orderRow(externalId).id);

describe('import des commandes dans Chit Chats', () => {
  before(() => {
    migrate();
    updateSettings({ 'chitchats.clientId': '42', 'chitchats.accessToken': 'tok' });
  });
  after(() => closeDb());

  it('construit un envoi Chit Chats complet depuis une commande Shopify', () => {
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A1', orderNumber: '#2001', totalPrice: 55, raw: shopifyRaw(GOOD_ADDRESS) }));
    const order = orderRow('A1');
    const items = getDb().prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const { payload, problems } = buildShipment(order, items);
    assert.deepEqual(problems, []);
    assert.equal(payload.order_id, '2001');
    assert.equal(payload.postage_type, 'chit_chats_canada_tracked');
    assert.equal(payload.postal_code, 'H2X 1Y4');
    assert.equal(payload.value, '55.00');
    assert.equal(payload.line_items, undefined, 'pas de douane pour le Canada');
  });

  it('crée l\'envoi, ou relie celui qui existe déjà', async () => {
    const client = fakeClient();
    const result = await importOrdersToChitChats({ trigger: 'manual', client });
    assert.equal(result.imported, 1);
    assert.equal(orderRow('A1').chitchats_import_status, 'imported');
    assert.equal(orderRow('A1').chitchats_shipment_id, 'S1');

    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A2', orderNumber: '#2002', totalPrice: 20, raw: shopifyRaw(GOOD_ADDRESS) }));
    const linked = await importOrdersToChitChats({
      trigger: 'manual',
      client: fakeClient({ existing: [{ id: 'X9', order_id: '2002' }] }),
    });
    assert.equal(linked.linked, 1);
    assert.equal(orderRow('A2').chitchats_shipment_id, 'X9');
  });

  it('explique pourquoi : adresse incomplète, visible sur la pièce', async () => {
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A3', orderNumber: '#2003', totalPrice: 20, raw: shopifyRaw({ ...GOOD_ADDRESS, zip: '', province_code: '' }) }));
    const client = fakeClient();
    await importOrdersToChitChats({ trigger: 'manual', client });
    assert.equal(client.created.length, 0, "on n'appelle pas l'API pour rien");
    const part = getPart(partOf('A3').id);
    assert.equal(part.chitchats_import_status, 'error');
    assert.match(part.chitchats_import_error, /code postal/);
    assert.match(part.chitchats_import_error, /province/);
  });

  it('commande sans adresse de livraison', async () => {
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A4', orderNumber: '#2004', totalPrice: 20, raw: { id: 4 } }));
    await importOrdersToChitChats({ trigger: 'manual', client: fakeClient() });
    assert.match(orderRow('A4').chitchats_import_error, /pas d'adresse de livraison/);
  });

  it('traduit les refus de l\'API', async () => {
    assert.match(explainApiError(new ApiError(401, {}, 'u')), /accès refusé/);
    assert.match(
      explainApiError(new ApiError(422, { errors: { postal_code: ['is invalid'] } }, 'u')),
      /code postal : is invalid/,
    );
    assert.match(explainApiError(new Error('fetch failed')), /injoignable/);

    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A5', orderNumber: '#2005', totalPrice: 20, raw: shopifyRaw(GOOD_ADDRESS) }));
    await importOrdersToChitChats({
      trigger: 'manual',
      client: fakeClient({ createError: new ApiError(422, { error: 'Province code is not valid for country' }, 'u') }),
    });
    assert.match(orderRow('A5').chitchats_import_error, /Province code is not valid/);
  });

  it('international : détail des articles pour la douane', () => {
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A6', orderNumber: '#2006', totalPrice: 80, raw: shopifyRaw({ ...GOOD_ADDRESS, country_code: 'FR', province_code: '', zip: '75001', city: 'Paris' }) }));
    const order = orderRow('A6');
    const items = getDb().prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const { payload, problems } = buildShipment(order, items);
    assert.deepEqual(problems, []);
    assert.equal(payload.postage_type, 'chit_chats_international_tracked');
    assert.equal(payload.line_items.length, 1);
  });
});
