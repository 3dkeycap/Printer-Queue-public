import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = new URL('../public/js/', import.meta.url).pathname;
const files = fs
  .readdirSync(root, { recursive: true })
  .filter((name) => name.endsWith('.js'))
  .map((name) => path.join(root, name));

// Le front n'a pas d'étape de build : une erreur de syntaxe = page blanche en production.
describe('front-end : les modules se chargent', () => {
  for (const file of files) {
    it(path.relative(root, file), () => {
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], {
        input: fs.readFileSync(file, 'utf8'),
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    });
  }
});
