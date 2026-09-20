import { el, formatDate, fromNow, icon } from '../ui.js';
import { state } from '../store.js';

const runRow = (run) =>
  el('tr', {}, [
    el('td', {}, el('span', { class: 'tag' }, run.source)),
    el('td', {}, [
      el('div', {}, fromNow(run.started_at)),
      el('div', { class: 'cell-sub' }, formatDate(run.started_at)),
    ]),
    el('td', {}, el('span', { class: 'tag' }, run.trigger)),
    el('td', {}, String(run.orders_seen ?? 0)),
    el('td', {}, String(run.parts_created ?? 0)),
    el('td', {}, run.duration_ms ? `${run.duration_ms} ms` : '—'),
    el(
      'td',
      {},
      el(
        'span',
        {
          class: 'status-pill',
          style: { '--pill': run.status === 'success' ? 'var(--ok)' : run.status === 'error' ? 'var(--danger)' : 'var(--warn)' },
        },
        [el('span', { class: 'dot' }), run.status],
      ),
    ),
    el('td', { class: 'cell-sub' }, run.message ?? ''),
  ]);

const card = (title, lines, action) =>
  el('article', { class: 'panel' }, [
    el('h3', {}, [icon('plug'), title]),
    ...lines.map((line) => el('p', { class: 'sub' }, line)),
    action ?? null,
  ]);

export const renderIntegrations = (root, actions) => {
  const mode = state.meta?.mode ?? 'mock';

  root.append(
    el('div', { class: 'section-title' }, 'Connecteurs'),
    el('div', { class: 'panel-grid' }, [
      card(
        'Shopify',
        [
          `Mode : ${mode}`,
          'Poll des commandes non honorées + webhook orders/create.',
          'POST /api/webhooks/shopify (HMAC SHA-256).',
        ],
        el('button', { class: 'ghost-btn', style: { marginTop: '12px' }, onclick: () => actions.sync('shopify') }, [
          icon('refresh'),
          'Synchroniser Shopify',
        ]),
      ),
      card(
        'Etsy',
        [
          `Mode : ${mode}`,
          'Poll des receipts payés et non expédiés (Open API v3).',
          'POST /api/webhooks/etsy pour un relais personnalisé.',
        ],
        el('button', { class: 'ghost-btn', style: { marginTop: '12px' }, onclick: () => actions.sync('etsy') }, [
          icon('refresh'),
          'Synchroniser Etsy',
        ]),
      ),
      card(
        'Chit Chats',
        [
          'Webhook : POST /api/webhooks/chitchats (header X-Webhook-Secret).',
          'Réconciliation automatique toutes les 15 min.',
          'Un colis scanné ⇒ les pièces de la commande passent à SHIPPED.',
        ],
        el('button', { class: 'ghost-btn', style: { marginTop: '12px' }, onclick: () => actions.sync('chitchats') }, [
          icon('truck'),
          'Réconcilier les envois',
        ]),
      ),
      card('Planification', [
        `Commandes : ${state.meta?.syncCron ?? '—'}`,
        `Envois : ${state.meta?.shipmentCron ?? '—'}`,
        'Exécuté par le conteneur « worker ».',
      ]),
    ]),
    el('div', { class: 'section-title' }, 'Dernières exécutions'),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Source'),
          el('th', {}, 'Quand'),
          el('th', {}, 'Déclencheur'),
          el('th', {}, 'Commandes'),
          el('th', {}, 'Pièces créées'),
          el('th', {}, 'Durée'),
          el('th', {}, 'Statut'),
          el('th', {}, 'Message'),
        ])),
        el('tbody', {}, state.runs.map(runRow)),
      ]),
    ]),
  );
};
