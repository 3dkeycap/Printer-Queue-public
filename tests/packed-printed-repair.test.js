import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('packed-printed');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb, getDb, setSetting } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');

describe('réparation ponctuelle : une pièce dans le bac est imprimée', () => {
  after(() => closeDb());

  it('« dans le bac » mais « À imprimer » -> « Imprimé » ; remise à imprimer après le bac -> sort du bac ; une seule fois', () => {
    migrate();
    const { orderId } = ingestOrder(makeOrder({ externalId: 'R1', orderNumber: '#R1', items: [{ externalId: 'r1', title: 'Pièce', quantity: 3 }] }));
    const db = getDb();
    const [stuck, movedBack, normal] = db.prepare('SELECT id FROM parts WHERE order_id = ? ORDER BY id').all(orderId).map((row) => row.id);
    const packedAt = '2026-10-01T10:00:00.000Z';
    const pack = db.prepare("UPDATE parts SET packed_at = ?, packed_by = 'Alex', comment = 'Packé par Alex', status = ? WHERE id = ?");
    pack.run(packedAt, 'TO_PRINT', stuck);
    pack.run(packedAt, 'TO_PRINT', movedBack);
    // quelqu'un l'a remise à imprimer APRÈS le bac (échec)
    db.prepare("INSERT INTO part_events (part_id, from_status, to_status, actor, note, created_at) VALUES (?, 'DONE', 'FAILED', 'dashboard', NULL, '2026-10-02T10:00:00.000Z')").run(movedBack);

    setSetting('internal.packedPartsPrinted', '');
    migrate();
    const row = (id) => db.prepare('SELECT * FROM parts WHERE id = ?').get(id);
    assert.equal(row(stuck).status, 'DONE');
    assert.equal(row(stuck).packed_by, 'Alex', 'reste dans le bac');
    assert.equal(row(movedBack).status, 'TO_PRINT', 'le choix de la personne est respecté');
    assert.equal(row(movedBack).packed_at, null);
    assert.ok(!String(row(movedBack).comment ?? '').includes('Packé par'));
    assert.equal(row(normal).status, 'TO_PRINT', 'une pièce hors du bac ne bouge pas');

    // une seule fois : un nouvel état incohérent n'est plus « réparé » au redémarrage
    pack.run(packedAt, 'TO_PRINT', normal);
    migrate();
    assert.equal(row(normal).status, 'TO_PRINT');
  });
});
