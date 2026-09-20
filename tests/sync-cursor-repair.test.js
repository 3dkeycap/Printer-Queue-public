import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('sync-cursor-repair');
const { getDb, getSetting, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrate.js');

const SCHEMA_PATH = fileURLToPath(new URL('../src/db/schema.sql', import.meta.url));

const setSettingDirect = (db, key, value) => {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, ts);
};

describe('réparation automatique des curseurs corrompus par l\'ancien bug', () => {
  after(() => closeDb());

  it('efface un curseur ratchété par le bug une seule fois, sans jamais y retoucher ensuite', () => {
    // Base "ancienne" : schéma déjà en place, curseur déjà corrompu par le
    // bug (avancé sur l'horloge murale) avant que ce correctif n'existe.
    const db = getDb();
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    setSettingDirect(db, 'cursor:shopify', new Date().toISOString());
    setSettingDirect(db, 'cursor:etsy', new Date().toISOString());

    assert.equal(getSetting('internal.cursorRatchetFixed'), null);

    migrate(); // 1ère migration après la mise à jour : doit nettoyer

    assert.equal(getSetting('cursor:shopify'), null, 'le curseur Shopify corrompu doit être effacé');
    assert.equal(getSetting('cursor:etsy'), null, 'le curseur Etsy corrompu doit être effacé');
    assert.equal(getSetting('internal.cursorRatchetFixed'), '1');

    // Une vraie synchro peut ensuite reposer un curseur légitime ; une
    // nouvelle migration ne doit plus jamais y toucher.
    setSettingDirect(db, 'cursor:shopify', '2026-05-01T00:00:00.000Z');
    migrate();
    assert.equal(getSetting('cursor:shopify'), '2026-05-01T00:00:00.000Z');
  });
});
