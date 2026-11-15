import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('cc-import');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { ApiError } = await import('../src/lib/http.js');
const { reconcileChitChats, removeAppDuplicates, linkExistingShipments, chitchatsState, chitchatsContext } = await import('../src/domain/chitchatsImport.js');

const orderRow = (externalId) => getDb().prepare("SELECT * FROM orders WHERE external_id = ?").get(externalId);
// envoi créé autrefois par l'app (avant la suppression de l'import)
const asAppShipment = (externalId, shipmentId) =>
  getDb().prepare("UPDATE orders SET chitchats_import_status = 'imported', chitchats_shipment_id = ? WHERE external_id = ?").run(shipmentId, externalId);

/** Faux Chit Chats : `shipments` = tous les envois du compte ; note ce qui est créé / supprimé. */
const fakeChitChats = (shipments) => {
  const removed = [];
  const created = [];
  return {
    removed,
    created,
    list: async (page) => (page === 1 ? shipments.filter((s) => !removed.includes(s.id)) : []),
    search: async (q) => shipments.filter((s) => !removed.includes(s.id) && [s.order_id, s.to_name].some((v) => String(v ?? '').toLowerCase().includes(String(q).toLowerCase()))),
    get: async (id) => {
      const found = shipments.find((s) => s.id === id && !removed.includes(id));
      if (!found) throw new ApiError(404, {}, 'u');
      return found;
    },
    remove: async (id) => removed.push(id),
    create: async (payload) => created.push(payload),
  };
};

describe('Chit Chats : l’app ne crée plus d’envoi, elle relie et retire ses doublons', () => {
  before(() => {
    migrate();
    updateSettings({ 'chitchats.clientId': '42', 'chitchats.accessToken': 'tok' });
  });

  it('ne crée jamais d’envoi ; relie la commande à l’envoi importé par Chit Chats', async () => {
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A1', orderNumber: '#2001', customerName: 'Bob Tremblay' }));
    ingestOrder(makeOrder({ placedAt: new Date().toISOString(), externalId: 'A2', orderNumber: '#2002', customerName: 'Léa Roy' }));
    const cc = fakeChitChats([{ id: 'ETSY1', order_id: '2001', to_name: 'Bob Tremblay', status: 'pending' }]);
    const result = await reconcileChitChats({ trigger: 'manual', client: cc });
    assert.equal(cc.created.length, 0);
    assert.equal(result.linked, 1);
    assert.equal(orderRow('A1').chitchats_shipment_id, 'ETSY1');
    const ctx = chitchatsContext();
    const missing = chitchatsState(orderRow('A2'), ctx);
    assert.equal(missing.state, 'false');
    assert.match(missing.reason, /import Etsy \/ Shopify de Chit Chats/);
  });

  it('doublon de l’app encore « pending » + envoi importé par Chit Chats : le doublon de l’app est supprimé', async () => {
    ingestOrder(makeOrder({ externalId: 'D1', orderNumber: '#3001', customerName: 'Anna Weber' }));
    asAppShipment('D1', 'APP1');
    const cc = fakeChitChats([
      { id: 'APP1', order_id: '3001', to_name: 'Anna Weber', status: 'pending' },
      { id: 'ETSY3', order_id: '3001', to_name: 'Anna Weber', status: 'pending' },
    ]);
    const counts = await removeAppDuplicates(cc);
    assert.deepEqual(cc.removed, ['APP1']);
    assert.equal(counts.removed, 1);
    assert.equal(orderRow('D1').chitchats_shipment_id, 'ETSY3');
    assert.equal(orderRow('D1').chitchats_import_status, 'linked');
  });

  it('jumeau trouvé par le nom du client (numéro différent chez Chit Chats)', async () => {
    ingestOrder(makeOrder({ externalId: 'D2', orderNumber: '#3002', customerName: 'Marc Petit' }));
    asAppShipment('D2', 'APP2');
    const cc = fakeChitChats([
      { id: 'APP2', order_id: '3002', to_name: 'Marc Petit', status: 'pending' },
      { id: 'ETSY4', order_id: '1359999', to_name: 'Marc Petit', status: 'pending' },
    ]);
    await removeAppDuplicates(cc);
    assert.deepEqual(cc.removed, ['APP2']);
  });

  it('jamais supprimé : un envoi de l’app payé, ou seul envoi de sa commande, ou le jumeau d’une AUTRE commande du client', async () => {
    ingestOrder(makeOrder({ externalId: 'K1', orderNumber: '#4001', customerName: 'Paid Person' }));
    asAppShipment('K1', 'APPPAID');
    ingestOrder(makeOrder({ externalId: 'K2', orderNumber: '#4002', customerName: 'Only Person' }));
    asAppShipment('K2', 'APPONLY');
    ingestOrder(makeOrder({ externalId: 'K3', orderNumber: '#4003', customerName: 'Repeat Buyer' }));
    ingestOrder(makeOrder({ externalId: 'K4', orderNumber: '#4004', customerName: 'Repeat Buyer' }));
    asAppShipment('K4', 'APPREPEAT');
    const cc = fakeChitChats([
      { id: 'APPPAID', order_id: '4001', to_name: 'Paid Person', status: 'ready' },
      { id: 'ETSYPAID', order_id: '4001', to_name: 'Paid Person', status: 'pending' },
      { id: 'APPONLY', order_id: '4002', to_name: 'Only Person', status: 'pending' },
      { id: 'APPREPEAT', order_id: '4004', to_name: 'Repeat Buyer', status: 'pending' },
      { id: 'OTHERORDER', order_id: '4003', to_name: 'Repeat Buyer', status: 'ready' },
    ]);
    const counts = await removeAppDuplicates(cc);
    assert.deepEqual(cc.removed, []);
    assert.equal(counts.removed, 0);
    assert.equal(orderRow('K1').chitchats_shipment_id, 'APPPAID');
    assert.equal(orderRow('K1').chitchats_import_status, 'linked', 'payé : plus jamais revu');
    assert.equal(orderRow('K2').chitchats_import_status, 'imported', 'seul : revu au prochain passage');
    assert.equal(orderRow('K4').chitchats_shipment_id, 'APPREPEAT');
  });

  it('déjà supprimé à la main dans Chit Chats : la commande n’a plus d’envoi « app »', async () => {
    ingestOrder(makeOrder({ externalId: 'G1', orderNumber: '#5001', customerName: 'Gone Person' }));
    asAppShipment('G1', 'APPGONE');
    await removeAppDuplicates(fakeChitChats([]));
    assert.equal(orderRow('G1').chitchats_shipment_id, null);
    assert.equal(orderRow('G1').chitchats_import_status, null);
  });
});

describe('envois déjà présents dans Chit Chats', () => {
  it('relie les commandes de tout âge à leur envoi existant', async () => {
    ingestOrder(makeOrder({ placedAt: '2025-01-01T00:00:00.000Z', externalId: 'OLD1', orderNumber: '#900', totalPrice: 10, raw: { id: 9 } }));
    const client = { list: async (page) => (page === 1 ? [{ id: 'CC900', order_id: '900' }] : []) };
    assert.equal(await linkExistingShipments(client), 1);
    assert.equal(chitchatsState(orderRow('OLD1'), chitchatsContext()).state, 'true');
  });
});

describe('compléter le formulaire Chit Chats (extension)', () => {
  it('IOSS seulement pour une commande Etsy vers l’Union européenne ; code HS et pays d’origine ; recherche par numéro', async () => {
    const { customsFor } = await import('../src/domain/chitchatsImport.js');
    migrate();
    ingestOrder(makeOrder({ source: 'etsy', externalId: '4212304296', orderNumber: '4212304296', shippingCountry: 'DE', items: [{ externalId: 'c1', title: 'Mechanical Keyboard Switch Covers', sku: 'SW-10', quantity: 1, unitPrice: 9 }] }));
    const de = customsFor('4212304296');
    assert.equal(de.eu, true);
    assert.equal(de.ioss, 'IM3720000224');
    assert.equal(de.hsCode, '8473305100');
    assert.equal(de.originCountry, 'Canada');
    assert.deepEqual(de.items.map((item) => [item.title, item.sku, item.quantity]), [['Mechanical Keyboard Switch Covers', 'SW-10', 1]]);

    ingestOrder(makeOrder({ source: 'etsy', externalId: '4212304297', orderNumber: '4212304297', shippingCountry: 'US' }));
    assert.equal(customsFor('4212304297').ioss, null, 'pas d’IOSS hors Union européenne');
    ingestOrder(makeOrder({ externalId: '88001', orderNumber: '#5558', shippingCountry: 'FR' }));
    const shop = customsFor('5558');
    assert.equal(shop.source, 'shopify');
    assert.equal(shop.ioss, null, 'IOSS d’Etsy seulement pour les commandes Etsy');
    assert.equal(customsFor('inconnue'), null);
    // Etsy vers l'Europe : une seule ligne « 3DK » (quantité totale, valeur des produits, devise de la commande, Québec)
    ingestOrder(makeOrder({ source: 'etsy', externalId: '4212304298', orderNumber: '4212304298', shippingCountry: 'FR', currency: 'CAD', totalPrice: 99,
      items: [{ externalId: 'v1', title: 'DSA Keycaps', quantity: 2, unitPrice: 16.2 }, { externalId: 'v2', title: 'Nylon keycap', quantity: 1, unitPrice: 12.6 }] }));
    assert.deepEqual(customsFor('4212304298').vatGroup, {
      description: 'Keyboard keycaps', sku: '3DK', quantity: 3, total: 45, unitValue: 15, currency: 'CAD',
      manufacturer: { key: 'quebec', ...(await import('../src/domain/chitchatsImport.js')).MANUFACTURERS.quebec },
    });
    assert.equal(de.vatGroup.quantity, 1);
    assert.equal(customsFor('4212304297').vatGroup, null, 'hors Europe : lignes normales');
    assert.equal(shop.vatGroup, null, 'Shopify vers l’Europe : lignes normales');
    // fabricant : nylon -> Hong Kong, switchs -> Dongguan, le reste -> l'atelier au Québec (« switch covers » = atelier)
    const { manufacturerFor } = await import('../src/domain/chitchatsImport.js');
    assert.equal(manufacturerFor({ title: 'Keycap', color_key: 'nylon-grey' }).key, 'hongkong');
    assert.equal(manufacturerFor({ title: 'Artisan', variant_title: 'Material & Color Nylon (Black)' }).key, 'hongkong');
    assert.equal(manufacturerFor({ title: 'Gateron Switches (10 pack)' }).key, 'dongguan');
    // custom set : l'extension demande (Québec / Hong Kong / Chine) ; pas les descriptions « Custom Keyboards »
    const { isCustomSet } = await import('../src/domain/chitchatsImport.js');
    assert.equal(isCustomSet({ title: 'Custom Keycap Set' }), true);
    assert.equal(isCustomSet({ title: 'Keycaps', variant_title: 'Custom set (3 keys)' }), true);
    assert.equal(isCustomSet({ title: 'DES Modifiers (Pack of 2) | Keycap Set for Split & Custom Keyboards' }), false);
    assert.equal(isCustomSet({ title: 'DSA Convex Keycaps | Custom Keycaps for Split Keyboards' }), false);
    ingestOrder(makeOrder({ source: 'etsy', externalId: '4212304299', orderNumber: '4212304299', shippingCountry: 'US', items: [{ externalId: 'cs1', title: 'Custom Keycap Set', quantity: 1, unitPrice: 40 }] }));
    const custom = customsFor('4212304299');
    assert.equal(custom.items[0].askManufacturer, true);
    assert.deepEqual(Object.keys(custom.manufacturers), ['quebec', 'hongkong', 'dongguan']);
    assert.equal(custom.manufacturers.dongguan.countryCode, 'CN');
    assert.equal(manufacturerFor({ title: 'Mechanical Keyboard Switch Covers' }).key, 'quebec');
    assert.equal(manufacturerFor({ title: 'MX Tilters Adapters (10 Pack)' }).key, 'quebec');
    assert.equal(manufacturerFor({ title: 'X' }).contact, 'Innov3d inc.');
    assert.equal(de.items[0].manufacturer.key, 'quebec');
    // page de recherche de Chit Chats : retrouvée par le nom de l'acheteur (commande pas encore expédiée)
    ingestOrder(makeOrder({ source: 'etsy', externalId: '4217424516', orderNumber: '4217424516', customerName: 'Alison Thompson', shippingCountry: 'US' }));
    assert.equal(customsFor('', { name: 'alison thompson' }).orderNumber, '4217424516');
    assert.equal(customsFor('', { name: 'Personne' }), null);
  });
});

after(() => closeDb());
