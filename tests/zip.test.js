import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { crc32, createZip } from '../src/lib/zip.js';

describe('zip de l\'extension', () => {
  it('crc32 standard', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  });

  it('produit une archive lisible', () => {
    const zip = createZip([{ name: 'dir/a.txt', data: 'bonjour é' }, { name: 'dir/b.json', data: '{"x":1}' }]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zip-')), 't.zip');
    fs.writeFileSync(file, zip);
    const script = "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(z.read('dir/a.txt').decode())";
    try {
      assert.equal(execFileSync('python3', ['-c', script, file]).toString().trim(), 'bonjour é');
    } catch (error) {
      if (error.code === 'ENOENT') return; // pas de python : on se contente du crc
      throw error;
    }
  });
});
