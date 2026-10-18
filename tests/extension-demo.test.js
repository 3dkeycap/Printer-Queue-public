import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = new URL('../chrome-extension/', import.meta.url).pathname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const DEMO_HTML = [
  'demo/shopify/orders/index.html',
  'demo/shopify/orders/1001/index.html',
  'demo/shopify/orders/1002/index.html',
  'demo/shopify/orders/1003/index.html',
  'demo/chitchats/index.html',
];

describe('extension : pages de démo (fausse admin Shopify + faux Chit Chats)', () => {
  it('chaque page charge des fichiers qui existent', () => {
    for (const page of DEMO_HTML) {
      const html = read(page);
      const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
      assert.ok(refs.length >= 2, `${page} : aucune ressource`);
      for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)), `${page} : ${ref} introuvable`);
    }
  });

  it('chemins d\'une commande Shopify : /orders/<id>/ (reconnu par content.js et background.js)', () => {
    // content.js lit location.pathname avec ce motif : les pages de démo doivent le satisfaire
    const pattern = /\/orders\/(\d+)(?:[/?#]|$)/;
    for (const page of DEMO_HTML.filter((file) => /orders\/\d+\//.test(file))) {
      assert.ok(pattern.test(`/${page}`), page);
    }
    assert.ok(!pattern.test('/demo/shopify/orders/index.html'), 'la liste ne doit pas être prise pour une commande');
  });

  it('pas de script en ligne (interdit dans une page d\'extension)', () => {
    for (const page of DEMO_HTML) assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(read(page)), `${page} : script en ligne`);
  });

  it('les scripts de démo et du service worker se chargent', () => {
    for (const file of ['demo/shopify/demo-shopify.js', 'demo/chitchats/demo-chitchats.js', 'background.js', 'options.js']) {
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: read(file), encoding: 'utf8' });
      assert.equal(result.status, 0, `${file} : ${result.stderr}`);
    }
  });

  it('la page de réglages propose les trois boutons démo', () => {
    const html = read('options.html');
    for (const id of ['demo-shopify', 'demo-chitchats', 'demo-both']) assert.ok(html.includes(`id="${id}"`), id);
    assert.match(read('options.js'), /demo\/shopify\/orders\/index\.html/);
  });

  it('version du manifeste augmentée (déclenche la mise à jour de l\'extension)', () => {
    const [major, minor] = JSON.parse(read('manifest.json')).version.split('.').map(Number);
    assert.ok(major > 1 || minor >= 4);
  });
});
