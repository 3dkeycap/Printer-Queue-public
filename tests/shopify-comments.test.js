import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('shopify-comments');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { updateSettings } = await import('../src/domain/settings.service.js');
const { fetchOrderComments } = await import('../src/integrations/shopify.js');

const realFetch = globalThis.fetch;
const events = [
  { __typename: 'BasicEvent', id: 'e3', createdAt: '2026-11-08T13:32:00Z', message: 'This order was archived.' },
  {
    __typename: 'CommentEvent', id: 'e2', createdAt: '2026-11-07T20:23:00Z', message: '<p>replacement reason: damaged package</p>',
    rawMessage: 'replacement reason: damaged package', author: { name: 'Micah Calabio' },
    attachments: [{ name: 'image.png', url: 'https://cdn.shopify.com/a.png', image: { url: 'https://cdn.shopify.com/a.png' } }],
  },
];

describe('commentaires de l’équipe sur une commande Shopify', () => {
  before(() => {
    migrate();
    updateSettings({ 'shopify.shopDomain': 'test.myshopify.com', 'shopify.accessToken': 'shpat_test_comments' });
  });
  after(() => {
    globalThis.fetch = realFetch;
    closeDb();
  });

  it('garde seulement les commentaires (pas les événements automatiques), avec auteur et photos', async () => {
    const bodies = [];
    globalThis.fetch = async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ data: { order: { events: { nodes: events } } } }), { status: 200 });
    };
    const comments = await fetchOrderComments('9001');
    assert.equal(bodies[0].variables.id, 'gid://shopify/Order/9001');
    assert.deepEqual(comments, [
      { id: 'e2', author: 'Micah Calabio', createdAt: '2026-11-07T20:23:00Z', message: 'replacement reason: damaged package', attachments: [{ name: 'image.png', url: 'https://cdn.shopify.com/a.png' }] },
    ]);
  });

  it('API sans pièces jointes : redemande sans, le texte HTML est nettoyé', async () => {
    const queries = [];
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      queries.push(body.query.includes('attachments'));
      if (body.query.includes('attachments')) return new Response(JSON.stringify({ errors: [{ message: "Field 'attachments' doesn't exist" }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { order: { events: { nodes: [{ __typename: 'CommentEvent', id: 'c1', createdAt: 'x', message: 'Bonjour<br>à <b>tous</b> &amp; merci', author: null }] } } } }), { status: 200 });
    };
    const comments = await fetchOrderComments('9002');
    assert.deepEqual(queries, [true, true, false]);
    assert.equal(comments[0].message, 'Bonjour\nà tous & merci');
    assert.deepEqual(comments[0].attachments, []);
  });
  it('auteur refusé par Shopify (scope read_users) : les commentaires s’affichent quand même, sans auteur', async () => {
    const queries = [];
    globalThis.fetch = async (url, options) => {
      const { query } = JSON.parse(options.body);
      queries.push(query.includes('author') ? 'author' : query.includes('attachments') ? 'attachments' : 'text');
      if (query.includes('author')) {
        return new Response(JSON.stringify({ data: null, errors: [{ message: 'Access denied for author field. Required access: `read_users` access scope.' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { order: { events: { nodes: [events[1]] } } } }), { status: 200 });
    };
    const comments = await fetchOrderComments('9003');
    assert.deepEqual(queries, ['author', 'attachments']);
    assert.equal(comments[0].message, 'replacement reason: damaged package');
    assert.equal(comments[0].attachments.length, 1);
  });

  it('données partielles renvoyées avec une erreur : on les garde', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        data: { order: { events: { nodes: [{ ...events[1], author: null }, null] } } },
        errors: [{ message: 'Access denied for author field.' }],
      }), { status: 200 });
    };
    const comments = await fetchOrderComments('9004');
    assert.equal(calls, 1);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].author, null);
  });

  it('tout échoue : l’erreur de Shopify remonte (montrée par la route)', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ message: 'Fragment on undefined type' }] }), { status: 200 });
    await assert.rejects(fetchOrderComments('9005'), /Fragment on undefined type/);
  });
});
