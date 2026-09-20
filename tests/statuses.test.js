import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACTIVE_STATUSES, STATUS_KEYS, canTransition, defaultNextStatus, isStatus } from '../src/domain/statuses.js';

describe('machine à états des pièces', () => {
  it('expose les sept statuts du cahier des charges', () => {
    assert.deepEqual(STATUS_KEYS, [
      'TO_PRINT', 'FILE_READY', 'PRINTING', 'FAILED', 'DONE', 'IN_INVENTORY', 'SHIPPED',
    ]);
  });

  it('retire SHIPPED du tableau de production', () => {
    assert.ok(!ACTIVE_STATUSES.includes('SHIPPED'));
    assert.equal(ACTIVE_STATUSES.length, 6);
  });

  it('autorise le flux nominal', () => {
    let status = 'TO_PRINT';
    const path = [];
    while (status) {
      const next = defaultNextStatus(status);
      if (!next) break;
      assert.ok(canTransition(status, next), `${status} -> ${next}`);
      path.push(next);
      status = next;
    }
    assert.deepEqual(path, ['FILE_READY', 'PRINTING', 'DONE', 'IN_INVENTORY', 'SHIPPED']);
  });

  it('permet de relancer une impression ratée', () => {
    assert.ok(canTransition('PRINTING', 'FAILED'));
    assert.ok(canTransition('FAILED', 'TO_PRINT'));
  });

  it('refuse les transitions absurdes et les statuts inconnus', () => {
    assert.ok(!canTransition('TO_PRINT', 'SHIPPED'));
    assert.ok(!canTransition('SHIPPED', 'PRINTING'));
    assert.ok(!isStatus('EN_COURS'));
    assert.ok(!canTransition('DONE', 'EN_COURS'));
  });
});
