import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

const dir = useTempDb('updater');
const updaterDir = path.join(dir, 'updater');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { getUpdateStatus, requestUpdate, writeUpdaterConfig } = await import('../src/domain/updater.service.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
const beat = () => fs.writeFileSync(path.join(updaterDir, 'heartbeat'), String(Math.floor(Date.now() / 1000)));

describe('Service de mise à jour', () => {
  before(async () => {
    migrate();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
  });

  it('écrit les réglages pour le conteneur updater, lisibles par sh', () => {
    updateSettings({
      'update.githubToken': "tok'en$(rm -rf /)",
      'update.branch': 'main',
      'update.autoEnabled': false,
      'update.intervalMinutes': 30,
    });
    writeUpdaterConfig();
    const file = path.join(updaterDir, 'config.env');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    // la valeur ressort à l'identique, sans rien exécuter
    const out = execFileSync('sh', ['-c', `. "${file}"; printf '%s|%s|%s|%s' "$RPQ_GITHUB_TOKEN" "$RPQ_UPDATE_BRANCH" "$RPQ_AUTO_UPDATE" "$RPQ_UPDATE_INTERVAL"`]).toString();
    assert.equal(out, "tok'en$(rm -rf /)|main|0|1800");
  });

  it('refuse une demande quand le service ne tourne pas', async () => {
    assert.equal(getUpdateStatus().connected, false);
    const response = await fetch(`${base}/api/system/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update' }),
    });
    assert.equal(response.status, 409);
  });

  it('dépose la demande pour le service actif et expose son statut', async () => {
    beat();
    fs.writeFileSync(
      path.join(updaterDir, 'status'),
      'state=available\nmessage=Nouvelle version disponible : abc1234\ncurrent=0000000\nlatest=abc1234\nat=2026-10-04T12:00:00Z\n',
    );
    fs.writeFileSync(path.join(updaterDir, 'pending'), 'abc1234 Fix filters\n');

    const response = await fetch(`${base}/api/system/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update' }),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.connected, true);
    assert.equal(body.requested, 'update');
    assert.equal(body.latest, 'abc1234');
    assert.deepEqual(body.pending, ['abc1234 Fix filters']);
    assert.equal(fs.readFileSync(path.join(updaterDir, 'request'), 'utf8').trim(), 'update');

    // une seconde demande pendant la première est refusée
    assert.throws(() => requestUpdate('check'), /déjà en cours/);
  });

  it('ne renvoie jamais le token dans les réglages', async () => {
    const body = await (await fetch(`${base}/api/settings`)).json();
    const token = body.items.find((item) => item.key === 'update.githubToken');
    assert.equal(token.value, '');
    assert.equal(token.configured, true);
  });
});
