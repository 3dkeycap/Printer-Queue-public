import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boundedMap } from '../src/lib/boundedCache.js';

describe('boundedMap', () => {
  it('oublie les plus anciennes entrées au-delà de la limite', () => {
    const map = boundedMap(3);
    for (const key of ['a', 'b', 'c', 'd']) map.set(key, key);
    assert.deepEqual([...map.keys()], ['b', 'c', 'd']);
  });
  it('une clé réécrite redevient récente', () => {
    const map = boundedMap(3);
    for (const key of ['a', 'b', 'c']) map.set(key, key);
    map.set('a', 'a2');
    map.set('d', 'd');
    assert.deepEqual([...map.keys()], ['c', 'a', 'd']);
  });
});
