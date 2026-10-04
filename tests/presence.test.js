import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('presence');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { reportShopify, listOpen, resetPresence, MAX_OPEN, HEARTBEAT_TTL } = await import('../src/domain/presence.js');

describe('« ouvert sur Shopify » (extension Chrome)', () => {
  before(() => {
    migrate();
    updateSettings({ 'chitchats.clientId': '42', 'chitchats.shipUrlTemplate': 'https://chitchats.com/clients/{clientId}/shipments/search?locale=en&q={order}' });
    ingestOrder(makeOrder({ externalId: '5550001', orderNumber: '#1042' }));
  });
  after(() => {
    mock.timers.reset();
    closeDb();
  });

  it('ouvre, liste avec le lien Chit Chats, puis ferme', () => {
    resetPresence();
    const result = reportShopify({ clientId: 'c1', tabId: 1, orderExternalId: '5550001', user: 'Alex' });
    assert.equal(result.open, true);
    assert.deepEqual(result.chitchatsImport, { status: null, error: null, inChitChats: false });
    assert.equal(result.chitchatsUrl, 'https://chitchats.com/clients/42/shipments/search?locale=en&q=1042');
    const [entry] = listOpen();
    assert.equal(entry.orderNumber, '#1042');
    assert.deepEqual(entry.users, ['Alex']);
    reportShopify({ clientId: 'c1', tabId: 1, state: 'close' });
    assert.equal(listOpen().length, 0);
  });

  it('expire sans signe de vie, et au bout de 30 min sur la même page', () => {
    resetPresence();
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    reportShopify({ clientId: 'c1', tabId: 1, orderExternalId: '5550001' });
    mock.timers.tick(HEARTBEAT_TTL + 1000);
    assert.equal(listOpen().length, 0, 'plus de signe de vie');

    reportShopify({ clientId: 'c1', tabId: 2, orderExternalId: '5550001' });
    for (let elapsed = 0; elapsed < MAX_OPEN; elapsed += 30_000) {
      mock.timers.tick(30_000);
      reportShopify({ clientId: 'c1', tabId: 2, orderExternalId: '5550001' });
    }
    assert.equal(listOpen().length, 0, '30 min sur la même page');
    mock.timers.reset();
  });
});
