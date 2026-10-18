import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { makeOrder, useTempDb } from './helpers.js';

useTempDb('failure-history');
const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb, setSetting } = await import('../src/db/index.js');
const { ingestOrder } = await import('../src/domain/ingest.js');
const { deletePart, getPart, listEvents, setStatus } = await import('../src/domain/parts.service.js');
const { getFailureReport } = await import('../src/domain/failures.service.js');

const results = (partId) => getDb().prepare('SELECT outcome FROM print_results WHERE part_id = ? ORDER BY id').all(partId).map((r) => r.outcome);

describe('Échec = retour direct dans « À imprimer » + historique', () => {
  let partIds;
  before(() => {
    migrate();
    const { orderId } = ingestOrder(
      makeOrder({ items: [{ externalId: 'li-k', title: 'Kraken Keycap', variantTitle: 'Noir', quantity: 4 }] }),
    );
    partIds = getDb().prepare('SELECT id FROM parts WHERE order_id = ? ORDER BY id').all(orderId).map((p) => p.id);
  });
  after(() => closeDb());

  it('la pièce revient en « À imprimer », avec son échec compté et consigné', () => {
    const [id] = partIds;
    setStatus(id, 'PRINTING');
    const part = setStatus(id, 'FAILED');
    assert.equal(part.status, 'TO_PRINT');
    assert.equal(part.fail_count, 1);
    assert.deepEqual(results(id), ['failed']);
    const trail = listEvents(id).map((e) => `${e.from_status}>${e.to_status}`);
    assert.deepEqual(trail.slice(0, 2), ['FAILED>TO_PRINT', 'PRINTING>FAILED']);
  });

  it('« 3 échecs sur 4 impressions » = 75 % pour ce fichier', () => {
    const [a, b, c, d] = partIds;
    for (const id of [b, c]) {
      setStatus(id, 'PRINTING');
      setStatus(id, 'FAILED');
    }
    setStatus(a, 'FAILED'); // 2e échec de la même pièce
    setStatus(d, 'PRINTING');
    setStatus(d, 'DONE');

    const report = getFailureReport();
    const file = report.files.find((f) => f.name === 'Kraken Keycap');
    assert.equal(file.failures, 4);
    assert.equal(file.successes, 1);
    assert.equal(file.attempts, 5);
    assert.equal(file.rate, 0.8);
    assert.equal(file.colors[0].attempts, 5);
    assert.equal(report.history.length, 4);
    assert.equal(report.history[0].name, 'Kraken Keycap');
  });

  it('un « Imprimé » ressorti (échec ou mauvais clic) n\'est plus compté comme réussite', () => {
    const [, , , d] = partIds;
    assert.equal(results(d).filter((r) => r === 'success').length, 1);
    setStatus(d, 'PRINTING'); // mauvais clic
    assert.equal(results(d).filter((r) => r === 'success').length, 0);
    setStatus(d, 'DONE');
    setStatus(d, 'FAILED'); // défaut découvert après coup
    assert.deepEqual(results(d), ['failed']);
  });

  it('l\'historique survit à la suppression de la pièce', () => {
    const before = getFailureReport().history.length;
    deletePart(partIds[1]);
    assert.equal(getPart(partIds[1]), null);
    assert.equal(getFailureReport().history.length, before);
  });

  it('migration : les anciennes pièces en colonne Échec repartent dans « À imprimer », historique reconstitué', () => {
    const db = getDb();
    const { orderId } = ingestOrder(
      makeOrder({ externalId: '9100', orderNumber: '#9100', items: [{ externalId: 'li-old', title: 'Vieille pièce', quantity: 1 }] }),
    );
    const { id } = db.prepare('SELECT id FROM parts WHERE order_id = ?').get(orderId);
    const ev = db.prepare(`INSERT INTO part_events (part_id, from_status, to_status, actor, created_at) VALUES (?, ?, ?, 'dashboard', ?)`);
    ev.run(id, 'TO_PRINT', 'PRINTING', '2026-01-01T10:00:00.000Z');
    ev.run(id, 'PRINTING', 'FAILED', '2026-01-01T11:00:00.000Z');
    db.prepare(`UPDATE parts SET status = 'FAILED', fail_count = 1 WHERE id = ?`).run(id);
    db.prepare('DELETE FROM print_results WHERE part_id = ?').run(id);
    db.prepare(`DELETE FROM settings WHERE key = 'internal.failedColumnRemoved'`).run();

    migrate();

    assert.equal(db.prepare('SELECT status FROM parts WHERE id = ?').get(id).status, 'TO_PRINT');
    const failure = db.prepare(`SELECT created_at FROM print_results WHERE part_id = ? AND outcome = 'failed'`).get(id);
    assert.equal(failure.created_at, '2026-01-01T11:00:00.000Z');
  });
});

describe('tag « A échoué », fichiers masqués', async () => {
  const { setFileHidden, withFailTag, failTag } = await import('../src/domain/failures.service.js');
  const { getFailureReport } = await import('../src/domain/failures.service.js');

  it('construit le tag sans toucher aux autres tags', () => {
    assert.equal(failTag(1), 'A échoué');
    assert.equal(failTag(3), 'A échoué ×3');
    assert.equal(withFailTag(null, 1), 'A échoué');
    assert.equal(withFailTag('Réimpression\nA échoué', 2), 'Réimpression\nA échoué ×2');
    assert.equal(withFailTag('Réimpression\nA échoué ×2', 3), 'Réimpression\nA échoué ×3');
  });

  it('une pièce qui échoue reçoit le tag, avec le nombre d\'échecs', async () => {
    migrate();
    const { orderId } = ingestOrder(
      makeOrder({ externalId: '9200', orderNumber: '#9200', items: [{ externalId: 'li-t', title: 'Tag Keycap', quantity: 1 }] }),
    );
    const { id } = getDb().prepare('SELECT id FROM parts WHERE order_id = ?').get(orderId);
    await updatePartComment(id, 'Réimpression');
    setStatus(id, 'PRINTING');
    assert.equal(setStatus(id, 'FAILED').comment, 'Réimpression\nA échoué');
    setStatus(id, 'PRINTING');
    assert.equal(setStatus(id, 'FAILED').comment, 'Réimpression\nA échoué ×2');
  });

  it('masquer un fichier le marque masqué dans le rapport (ses échecs restent comptés)', () => {
    const before = getFailureReport();
    assert.equal(before.files.find((f) => f.name === 'Tag Keycap').hidden, false);
    setFileHidden('Tag Keycap', true);
    const hidden = getFailureReport();
    assert.equal(hidden.files.find((f) => f.name === 'Tag Keycap').hidden, true);
    assert.ok(hidden.history.filter((h) => h.name === 'Tag Keycap').every((h) => h.hidden));
    assert.equal(hidden.totals.failures, before.totals.failures);
    setFileHidden('Tag Keycap', false);
    assert.equal(getFailureReport().files.find((f) => f.name === 'Tag Keycap').hidden, false);
  });

  it('un fichier sans aucun échec (100 % de réussite) n\'est jamais listé', () => {
    assert.ok(getFailureReport().files.every((f) => f.failures > 0));
  });
});

const updatePartComment = async (id, comment) => {
  const { updatePart } = await import('../src/domain/parts.service.js');
  return updatePart(id, { comment });
};
