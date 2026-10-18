import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('bugs');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { createLogger } = await import('../src/lib/logger.js');
const bugs = await import('../src/domain/bugs.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

describe('bugs signalés (coccinelle)', () => {
  before(() => migrate());
  after(() => closeDb());

  it('enregistre description, capture, journaux navigateur + serveur, contexte', () => {
    createLogger('test').error('quelque chose a cassé', { code: 42 });
    const bug = bugs.createBugReport({
      reporter: 'Alex',
      description: "Le bouton Expédié ne fait rien",
      page: 'http://x/#board',
      screenshot: PNG,
      clientLogs: [{ level: 'error', msg: 'TypeError: x is undefined' }],
      context: { view: 'board', mode: 'simple' },
    });
    assert.equal(bug.reporter, 'Alex');
    assert.equal(bug.client_logs[0].msg, 'TypeError: x is undefined');
    assert.ok(bug.server_logs.some((line) => line.msg === 'quelque chose a cassé'));
    assert.equal(bug.context.mode, 'simple');
    assert.ok(Array.isArray(bug.context.recentSyncRuns));
    assert.equal(bugs.listBugReports()[0].has_screenshot, true);

    const md = bugs.bugReportForClaude(bug.id);
    assert.match(md, /Le bouton Expédié ne fait rien/);
    assert.match(md, /TypeError: x is undefined/);
    assert.match(md, /quelque chose a cassé/);

    assert.equal(bugs.setBugStatus(bug.id, 'resolved').status, 'resolved');
  });

  it('refuse un signalement vide ou une capture invalide', () => {
    assert.throws(() => bugs.createBugReport({ description: '  ' }), /Explique/);
    assert.throws(() => bugs.createBugReport({ description: 'x', screenshot: 'javascript:alert(1)' }), /Capture invalide/);
  });
});
