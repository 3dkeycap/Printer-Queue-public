import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('etsy-tracking');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { markOrderShipped } = await import('../src/domain/orders.service.js');
const { etsyCarrier, pushEtsyTracking, pushPendingEtsyTracking } = await import('../src/domain/etsyTracking.js');
const { ApiError } = await import('../src/lib/http.js');

const orderRow = (externalId) => getDb().prepare('SELECT * FROM orders WHERE external_id = ?').get(externalId);
const shipEtsy = (externalId, tracking, carrier = 'chit_chats_canada_tracked') => {
  const { orderId } = ingestOrder(makeOrder({ source: 'etsy', externalId, orderNumber: externalId, items: [{ externalId: `i${externalId}`, title: 'Keycap', quantity: 1 }] }));
  markOrderShipped(orderId, { id: 'CC1', tracking_number: tracking, carrier }, { shipAll: true });
  return orderId;
};

describe('suivi Chit Chats -> Etsy', () => {
  before(() => {
    migrate();
    updateSettings({ 'etsy.apiKey': 'k', 'etsy.sharedSecret': 's', 'etsy.shopId': '42', 'etsy.accessToken': 'tok', 'etsy.enabled': true });
  });
  after(() => closeDb());

  it('transporteur : nom connu d’Etsy, « other » sinon', () => {
    assert.equal(etsyCarrier('chit_chats_canada_tracked'), 'canada-post');
    assert.equal(etsyCarrier('usps_ground_advantage'), 'usps');
    assert.equal(etsyCarrier('UPS Ground'), 'ups');
    assert.equal(etsyCarrier('quelquechose'), 'other');
    assert.equal(etsyCarrier(null), 'other');
  });

  it('envoie le suivi une seule fois et le note', async () => {
    const id = shipEtsy('E1', '9400111');
    const sent = [];
    const send = async (receipt, payload) => sent.push([receipt, payload]);
    const list = async () => [];
    assert.equal((await pushEtsyTracking(id, { send, list })).status, 'sent');
    assert.deepEqual(sent, [['E1', { trackingCode: '9400111', carrierName: 'canada-post' }]]);
    assert.ok(orderRow('E1').etsy_tracking_at);
    assert.equal((await pushEtsyTracking(id, { send, list })).status, 'skipped', 'pas de 2e envoi');
    assert.equal(sent.length, 1);
  });

  it('suivi déjà saisi à la main dans Etsy : rien n’est renvoyé', async () => {
    const id = shipEtsy('E2', 'ABC123');
    const send = async () => assert.fail('ne doit pas renvoyer');
    const result = await pushEtsyTracking(id, { send, list: async () => [{ tracking_code: 'ABC123' }] });
    assert.equal(result.status, 'already');
    assert.ok(orderRow('E2').etsy_tracking_at);
  });

  it('transporteur refusé : un 2e essai avec « other » ; droit d’écriture manquant : erreur claire et nouvel essai plus tard', async () => {
    const id = shipEtsy('E3', 'T3');
    const carriers = [];
    const send = async (receipt, { carrierName }) => {
      carriers.push(carrierName);
      if (carrierName !== 'other') throw new ApiError(400, { error: 'invalid carrier' }, 'u');
    };
    assert.equal((await pushEtsyTracking(id, { send, list: async () => [] })).status, 'sent');
    assert.deepEqual(carriers, ['canada-post', 'other']);

    const id2 = shipEtsy('E4', 'T4');
    const denied = async () => { throw new ApiError(403, { error: 'insufficient scope transactions_w' }, 'u'); };
    const result = await pushEtsyTracking(id2, { send: denied, list: async () => [] });
    assert.equal(result.status, 'error');
    assert.match(result.error, /transactions_w/);
    assert.equal(orderRow('E4').etsy_tracking_at, null);
    assert.match(orderRow('E4').etsy_tracking_error, /reconnecte Etsy/);

    // le filet de sécurité réessaie (droit accordé entre-temps)
    const sent = [];
    const counts = await pushPendingEtsyTracking({ send: async (r) => sent.push(r), list: async () => [] });
    assert.deepEqual(sent, ['E4']);
    assert.equal(counts.sent, 1);
    assert.equal(orderRow('E4').etsy_tracking_error, null);
  });

  it('commande Shopify, réglage coupé ou sans suivi : rien n’est envoyé', async () => {
    const { orderId } = ingestOrder(makeOrder({ externalId: 'S1', orderNumber: '#S1' }));
    markOrderShipped(orderId, { id: 'CC2', tracking_number: 'ZZ' }, { shipAll: true });
    const never = async () => assert.fail('pas pour Shopify');
    assert.equal((await pushEtsyTracking(orderId, { send: never, list: never })).status, 'skipped');
    const id = shipEtsy('E5', 'T5');
    updateSettings({ 'etsy.pushTracking': false });
    assert.equal((await pushEtsyTracking(id, { send: never, list: never })).status, 'skipped');
    updateSettings({ 'etsy.pushTracking': true });
  });
});
