import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('bug-webhook');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { describeSettings, updateSettings } = await import('../src/domain/settings.service.js');
const { createBugReport } = await import('../src/domain/bugs.js');
const { lastBugWebhook, testBugWebhook, bugWebhookPayload } = await import('../src/domain/bugWebhook.js');
const { createApp } = await import('../src/app.js');

let receiver;
let hookUrl;
const received = [];
let respondWith = 200;

const waitFor = async (check, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

describe('Webhook HTTP « nouveau bug »', () => {
  before(async () => {
    migrate();
    receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(body || '{}') });
        res.statusCode = respondWith;
        res.end('ok');
      });
    });
    await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    hookUrl = `http://127.0.0.1:${receiver.address().port}/hook?token=secret-abc`;
  });
  after(async () => {
    await new Promise((resolve) => receiver.close(resolve));
    closeDb();
  });

  it('sans adresse réglée : rien n\'est envoyé et le bug est créé normalement', async () => {
    const bug = createBugReport({ reporter: 'Marin', description: 'Rien ne se passe' });
    assert.ok(bug.id > 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(received.length, 0);
  });

  it('nouveau bug : POST JSON avec résumé (text/content) et détail (bug)', async () => {
    updateSettings({ 'bugs.webhookUrl': hookUrl });
    const bug = createBugReport({ reporter: 'Marin', description: 'Le kiosque ne passe pas en plein écran', page: 'http://3dkeycap.local/kiosk#board', context: { build: 'abc1234' } });
    assert.ok(await waitFor(() => received.length === 1), 'le webhook doit être appelé');
    const [call] = received;
    assert.equal(call.method, 'POST');
    assert.match(call.type, /application\/json/);
    assert.equal(call.body.event, 'bug.created');
    assert.equal(call.body.app, '3D Keycap Lab');
    assert.match(call.body.text, /Bug #\d+ signalé par Marin — Le kiosque ne passe pas en plein écran/);
    assert.equal(call.body.content, call.body.text);
    assert.equal(call.body.bug.id, bug.id);
    assert.equal(call.body.bug.reporter, 'Marin');
    assert.equal(call.body.bug.version, 'dev'); // la version du serveur (config.buildId) prime sur celle du navigateur
    assert.equal(call.body.bug.links.report_markdown, `http://192.168.1.223:8080/api/bugs/${bug.id}/claude.md`);
    assert.equal(call.body.bug.links.screenshot, null);
    assert.ok(await waitFor(() => lastBugWebhook()?.ok === true));
    assert.equal(lastBugWebhook().bugId, bug.id);
  });

  it('la capture d\'écran n\'est jamais dans le corps : seulement un lien', () => {
    const payload = bugWebhookPayload({ id: 5, description: 'x', screenshot: 'data:image/png;base64,AAAA', created_at: 'now' });
    assert.equal(payload.bug.has_screenshot, true);
    assert.equal(payload.bug.links.screenshot, 'http://192.168.1.223:8080/api/bugs/5/screenshot');
    assert.ok(!JSON.stringify(payload).includes('AAAA'));
  });

  it('webhook en panne : le bug est créé quand même, l\'échec est noté (après un 2e essai)', async () => {
    received.length = 0;
    respondWith = 500;
    const bug = createBugReport({ reporter: 'Alex', description: 'Deuxième bug' });
    assert.ok(bug.id > 0, 'un webhook en panne ne bloque pas le signalement');
    assert.ok(await waitFor(() => received.length === 2, 8000), 'un 2e essai est fait');
    assert.ok(await waitFor(() => lastBugWebhook()?.ok === false));
    assert.match(lastBugWebhook().error, /500/);
    respondWith = 200;
  });

  it('adresse injoignable ou invalide : jamais d\'exception', async () => {
    assert.equal((await testBugWebhook('ftp://exemple.com')).ok, false);
    assert.equal((await testBugWebhook('pas une adresse')).ok, false);
    const down = await testBugWebhook('http://127.0.0.1:1/jamais');
    assert.equal(down.ok, false);
    assert.ok(down.error);
  });

  it('« Envoyer un test » : faux bug (event bug.test), avec l\'adresse tapée ou l\'enregistrée', async () => {
    received.length = 0;
    const server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/bugs/webhook/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.deepEqual((await response.json()).ok, true);
    assert.equal(received.at(-1).body.event, 'bug.test');
    assert.equal(received.at(-1).body.bug.id, 0);
    assert.equal(lastBugWebhook().test, true);

    const last = await (await fetch(`${base}/api/bugs/webhook`)).json();
    assert.equal(last.last.ok, true);
    await new Promise((resolve) => server.close(resolve));
  });

  it('l\'adresse (souvent avec un jeton) n\'est jamais renvoyée par l\'API des réglages', () => {
    const setting = describeSettings().find((item) => item.key === 'bugs.webhookUrl');
    assert.equal(setting.value, '');
    assert.equal(setting.configured, true);
    assert.ok(!JSON.stringify(describeSettings()).includes('secret-abc'));
  });
});
