import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

const dir = useTempDb('backup');
process.env.BACKUP_KEEP = '2';
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb, setSetting } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { backupBeforeUpgrade, backupDatabase, listBackups, recordBuild } = await import('../src/db/backup.js');

describe('Sauvegardes de la base', () => {
  after(() => closeDb());

  it('ne sauvegarde pas une base neuve', () => {
    assert.equal(backupBeforeUpgrade(), null);
    migrate();
    recordBuild();
    assert.equal(listBackups().length, 0);
  });

  it('sauvegarde avant les migrations quand la version change', () => {
    ingestOrder(makeOrder());
    assert.equal(backupBeforeUpgrade(), null); // même version : rien
    setSetting('internal.lastBuildId', 'old-version');
    const result = backupBeforeUpgrade();
    assert.ok(result.file.startsWith(path.join(dir, 'backups')));
    // la copie est une base complète et lisible
    const copy = new (getDb().constructor)(result.file, { readonly: true });
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM parts').get().n, 3);
    copy.close();
  });

  it('ne garde que les BACKUP_KEEP plus récentes', () => {
    backupDatabase({ reason: 'a' });
    backupDatabase({ reason: 'b' });
    const files = fs.readdirSync(path.join(dir, 'backups'));
    assert.equal(files.length, 2);
    assert.equal(listBackups().length, 2);
  });
});
