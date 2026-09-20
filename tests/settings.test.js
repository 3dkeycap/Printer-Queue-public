import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('settings');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const {
  connectorStatus,
  describeSettings,
  getSettings,
  updateSettings,
} = await import('../src/domain/settings.service.js');

const find = (key) => describeSettings().find((item) => item.key === key);

describe('réglages pilotés depuis la page Intégrations', () => {
  before(() => migrate());
  after(() => closeDb());

  it('fournit des valeurs par défaut exploitables', () => {
    const settings = getSettings();
    assert.equal(settings['schedule.syncCron'], '*/5 * * * *');
    assert.deepEqual(settings['production.uvOptions'], ['Standard', 'A', 'B', 'C']);
    assert.ok(settings['production.commentOptions'].length > 0);
    assert.equal(settings['chitchats.shipAllParts'], true);
  });

  it('enregistre et relit chaque type de réglage', () => {
    updateSettings({
      'schedule.syncCron': '*/10 * * * *',
      'schedule.lookbackDays': 30,
      'chitchats.shipAllParts': false,
      'production.uvOptions': ['Standard', 'A', 'B', 'C', 'Double'],
    });
    const settings = getSettings();
    assert.equal(settings['schedule.syncCron'], '*/10 * * * *');
    assert.equal(settings['schedule.lookbackDays'], 30);
    assert.equal(settings['chitchats.shipAllParts'], false);
    assert.equal(settings['production.uvOptions'].length, 5);
  });

  it('nettoie les listes (lignes vides, espaces)', () => {
    updateSettings({ 'production.commentOptions': ['  Réimpression ', '', '   ', 'Cassée'] });
    assert.deepEqual(getSettings()['production.commentOptions'], ['Réimpression', 'Cassée']);
  });

  it('ne renvoie jamais un secret au navigateur', () => {
    updateSettings({ 'shopify.accessToken': 'shpat_supersecret' });
    const item = find('shopify.accessToken');
    assert.equal(item.value, '');
    assert.equal(item.configured, true);
    assert.equal(getSettings()['shopify.accessToken'], 'shpat_supersecret');
  });

  it('ignore un secret vide pour ne pas effacer une clé par erreur', () => {
    updateSettings({ 'shopify.accessToken': '' });
    assert.equal(getSettings()['shopify.accessToken'], 'shpat_supersecret');
  });

  it('efface un secret quand on envoie explicitement null', () => {
    updateSettings({ 'shopify.accessToken': null });
    assert.equal(getSettings()['shopify.accessToken'], '');
    assert.equal(find('shopify.accessToken').configured, false);
  });

  it('refuse une clé inconnue', () => {
    assert.throws(() => updateSettings({ 'shopify.rootPassword': 'x' }), /Réglage inconnu/);
  });

  it('calcule l\'état des connecteurs', () => {
    assert.equal(connectorStatus().shopify.configured, false);
    updateSettings({ 'shopify.shopDomain': 'atelier.myshopify.com', 'shopify.accessToken': 'shpat_1' });
    assert.equal(connectorStatus().shopify.configured, true);
    assert.equal(connectorStatus().etsy.configured, false);
  });
});
