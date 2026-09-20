import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BOARD_STATUSES,
  LEGACY_STATUS_MAP,
  STATUS_KEYS,
  canTransition,
  defaultNextStatus,
  isStatus,
} from '../src/domain/statuses.js';

describe('machine à états des pièces', () => {
  it('reprend les cases à cocher de la feuille de production', () => {
    assert.deepEqual(STATUS_KEYS, ['TO_PRINT', 'PRINTING', 'FAILED', 'DONE', 'SHIPPED']);
  });

  it('retire SHIPPED du tableau « À imprimer »', () => {
    assert.deepEqual(BOARD_STATUSES, ['TO_PRINT', 'PRINTING', 'FAILED', 'DONE']);
  });

  it('n\'expose plus « fichier prêt » ni « en stock »', () => {
    assert.ok(!isStatus('FILE_READY'));
    assert.ok(!isStatus('IN_INVENTORY'));
    assert.equal(LEGACY_STATUS_MAP.FILE_READY, 'TO_PRINT');
    assert.equal(LEGACY_STATUS_MAP.IN_INVENTORY, 'DONE');
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
    assert.deepEqual(path, ['PRINTING', 'DONE', 'SHIPPED']);
  });

  it('permet de relancer une impression ratée', () => {
    assert.ok(canTransition('PRINTING', 'FAILED'));
    assert.ok(canTransition('FAILED', 'TO_PRINT'));
  });

  it('refuse les transitions absurdes et les statuts inconnus', () => {
    assert.ok(!canTransition('TO_PRINT', 'SHIPPED'));
    assert.ok(!canTransition('SHIPPED', 'PRINTING'));
    assert.ok(!isStatus('EN_COURS'));
  });
});
