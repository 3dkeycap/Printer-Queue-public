import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { after, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('i18n');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { getSettings, updateSettings } = await import('../src/domain/settings.service.js');

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/** Charge la table + le moteur dans un bac à sable, comme le navigateur (sans DOM : seulement t / lookup). */
const engine = (lang) => {
  const sandbox = { navigator: { language: 'fr-CA' } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('public/js/i18n-table.js'), sandbox);
  vm.runInContext(read('public/js/i18n.js'), sandbox);
  sandbox.RQI18n.setLang(lang, { remember: false });
  return sandbox.RQI18n;
};

describe('traduction de l’interface', () => {
  after(() => closeDb());

  it('l’app et l’extension ont exactement les mêmes fichiers de traduction', () => {
    assert.equal(read('chrome-extension/i18n.js'), read('public/js/i18n.js'));
    assert.equal(read('chrome-extension/i18n-table.js'), read('public/js/i18n-table.js'));
  });

  it('chaque texte a ses 3 traductions, sans doublon', () => {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(read('public/js/i18n-table.js'), sandbox);
    const keys = new Set();
    for (const row of sandbox.RQI18nTable) {
      assert.equal(row.length, 4, row[0]);
      assert.ok(row.every((cell) => typeof cell === 'string' && cell.length), row[0]);
      assert.ok(!keys.has(row[0]), `doublon : ${row[0]}`);
      keys.add(row[0]);
    }
    for (const pattern of sandbox.RQI18nPatterns) assert.doesNotThrow(() => new RegExp(`^${pattern[0]}$`, 'u'), pattern[0]);
  });

  it('textes exacts, modèles avec nombres et listes, en anglais, espagnol et filipino', () => {
    const cases = {
      en: [['À imprimer', 'To print'], ['Commande · 4 pièces', 'Order · 4 parts'], ['Passer à En impression', 'Move to Printing'], ['il y a 3 min', '3 min ago']],
      es: [['Expédié', 'Enviado'], ['21 pièce(s) affichée(s)', '21 pieza(s) mostrada(s)'], ['code HS ×5, poids 1 g ×5', 'código HS ×5, peso 1 g ×5']],
      fil: [['En impression', 'Nagpi-print'], ['Qui es-tu ?', 'Sino ka?'], ['Dans le bac · Ana', 'Nasa bin · Ana']],
    };
    for (const [lang, pairs] of Object.entries(cases)) {
      const i18n = engine(lang);
      for (const [fr, expected] of pairs) assert.equal(i18n.t(fr), expected, `${lang} : ${fr}`);
    }
  });

  it('ce qui n’est pas dans la table (noms de produits, clients, notes) reste tel quel ; le français ne change rien', () => {
    assert.equal(engine('es').t('DSA Convex Keycaps (Pack of 2)'), 'DSA Convex Keycaps (Pack of 2)');
    assert.equal(engine('fil').t('Erik Hedman'), 'Erik Hedman');
    assert.equal(engine('fr').t('À imprimer'), 'À imprimer');
  });

  it('Réglages → Équipe : noms nettoyés, sans doublon, langue connue', () => {
    migrate();
    updateSettings({ 'team.members': [{ name: '  Ana ', lang: 'es' }, { name: 'ana', lang: 'en' }, { name: 'Joy', lang: 'fil' }, { name: '', lang: 'en' }, { name: 'Bob', lang: 'klingon' }] });
    assert.deepEqual(getSettings()['team.members'], [
      { name: 'Ana', lang: 'es' },
      { name: 'Joy', lang: 'fil' },
      { name: 'Bob', lang: 'fr' },
    ]);
  });
});
