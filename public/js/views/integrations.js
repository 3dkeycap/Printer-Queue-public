import { el, formatDate, fromNow, icon, swatch, toast } from '../ui.js';
import { state } from '../store.js';
import { api } from '../api.js';

const GROUPS = [
  { key: 'shopify', title: 'Shopify', hint: 'App personnalisée avec le scope read_orders.' },
  { key: 'etsy', title: 'Etsy', hint: 'Open API v3, scope transactions_r.' },
  { key: 'chitchats', title: 'Chit Chats', hint: 'Un colis scanné bascule les pièces en « Expédié ».' },
  { key: 'schedule', title: 'Planification', hint: 'Expressions cron appliquées par le worker (prise en compte < 1 min).' },
  { key: 'production', title: 'Production', hint: 'Listes déroulantes disponibles sur chaque pièce.' },
  {
    key: 'update',
    title: 'Mises à jour',
    hint: 'Installe la dernière version depuis GitHub. Les données sont conservées et sauvegardées avant chaque mise à jour.',
  },
];

/** Construit le champ correspondant au type de réglage. */
const field = (definition, draft) => {
  const id = `set-${definition.key}`;
  let input;

  if (definition.type === 'boolean') {
    input = el('label', { class: 'switch' }, [
      el('input', {
        type: 'checkbox',
        id,
        checked: definition.value,
        onchange: (event) => {
          draft[definition.key] = event.target.checked;
        },
      }),
      el('span', {}, definition.value ? 'Activé' : 'Désactivé'),
    ]);
    input.querySelector('input').addEventListener('change', (event) => {
      input.querySelector('span').textContent = event.target.checked ? 'Activé' : 'Désactivé';
    });
  } else if (definition.type === 'list') {
    input = el(
      'textarea',
      {
        id,
        rows: String(Math.max(3, definition.value.length + 1)),
        placeholder: 'Une valeur par ligne',
        oninput: (event) => {
          draft[definition.key] = event.target.value.split('\n').map((v) => v.trim()).filter(Boolean);
        },
      },
      definition.value.join('\n'),
    );
  } else {
    input = el('input', {
      id,
      type: definition.type === 'secret' ? 'password' : definition.type === 'number' ? 'number' : 'text',
      value: definition.type === 'secret' ? '' : definition.value ?? '',
      placeholder:
        definition.type === 'secret'
          ? definition.configured
            ? '•••••••••• (enregistré)'
            : 'Non configuré'
          : definition.placeholder ?? '',
      oninput: (event) => {
        draft[definition.key] = definition.type === 'number' ? Number(event.target.value) : event.target.value;
      },
    });
  }

  return el('div', { class: 'field' }, [
    el('label', { for: id }, definition.label),
    input,
    definition.hint ? el('span', { class: 'field-hint' }, definition.hint) : null,
  ]);
};

const groupCard = (group, actions) => {
  const definitions = state.settings.filter((item) => item.group === group.key);
  if (!definitions.length) return null;

  const draft = {};
  const connector = state.connectors[group.key];

  const save = el(
    'button',
    {
      class: 'primary-btn',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        await actions.saveSettings(draft);
        button.disabled = false;
      },
    },
    [icon('save'), 'Enregistrer'],
  );

  return el('article', { class: 'panel settings-panel' }, [
    el('header', { class: 'panel-head' }, [
      el('h3', {}, group.title),
      connector
        ? el(
            'span',
            {
              class: 'status-pill',
              style: { '--pill': connector.configured ? 'var(--ok)' : 'var(--warn)' },
            },
            [el('span', { class: 'dot' }), connector.configured ? 'Configuré' : 'À configurer'],
          )
        : null,
    ]),
    group.hint ? el('p', { class: 'sub' }, group.hint) : null,
    el('div', { class: 'settings-grid' }, definitions.map((definition) => field(definition, draft))),
    group.key === 'shopify' ? oauthBlock(actions, { provider: 'shopify', label: 'Shopify' }) : null,
    group.key === 'etsy' ? oauthBlock(actions, { provider: 'etsy', label: 'Etsy' }) : null,
    group.key === 'chitchats'
      ? el('p', { class: 'field-hint mono' }, `Webhook : POST ${location.origin}/api/webhooks/chitchats`)
      : null,
    group.key === 'update' ? updateBlock() : null,
    el('div', { class: 'panel-foot' }, [
      ['shopify', 'etsy', 'chitchats'].includes(group.key)
        ? el(
            'button',
            { class: 'ghost-btn', onclick: () => actions.sync(group.key) },
            [icon('refresh'), 'Synchroniser maintenant'],
          )
        : null,
      save,
    ]),
  ]);
};

/**
 * Bloc OAuth 2.0 générique (Shopify, Etsy...) : bouton de connexion
 * (navigation complète vers le fournisseur, jamais un fetch), déconnexion,
 * webhook et rappel de la redirect URL à enregistrer côté fournisseur.
 */
const oauthBlock = (actions, { provider, label }) => {
  const rawPublicUrl = state.settings.find((item) => item.key === 'app.publicUrl')?.value || '';
  // Un / de fin (fréquent en copiant depuis la barre d'adresse) ne doit pas
  // produire un double slash : c'est exactement l'URL que le serveur enverra
  // au fournisseur, elle doit matcher au caractère près ce qui est enregistré
  // de son côté (Partner Dashboard Shopify, app Etsy...).
  const base = rawPublicUrl.replace(/\/+$/, '') || location.origin;
  const redirectUrl = `${base}/api/integrations/${provider}/oauth/callback`;
  const connected = state.connectors[provider]?.configured;

  return el('div', { class: 'oauth-block' }, [
    el('p', { class: 'field-hint mono' }, `Webhook : POST ${location.origin}/api/webhooks/${provider}`),
    el('div', { class: 'oauth-redirect-row' }, [
      el('p', { class: 'field-hint mono' }, `Redirect URL OAuth : ${redirectUrl}`),
      el(
        'button',
        {
          class: 'mini-btn',
          type: 'button',
          onclick: async (event) => {
            // `event.currentTarget` redevient null une fois l'événement
            // terminé : on garde une référence au bouton pour le setTimeout.
            const button = event.currentTarget;
            await navigator.clipboard.writeText(redirectUrl);
            const previousLabel = button.textContent;
            button.textContent = 'Copié';
            setTimeout(() => {
              button.textContent = previousLabel;
            }, 1500);
          },
        },
        'Copier',
      ),
    ]),
    el('div', { class: 'oauth-actions' }, [
      el(
        'a',
        {
          class: 'primary-btn',
          href: `/api/integrations/${provider}/oauth/start`,
          // Une vraie navigation, pas un fetch : le fournisseur a besoin
          // d'afficher son propre écran de connexion/autorisation.
        },
        [icon('plug'), connected ? 'Reconnecter via OAuth' : 'Connecter via OAuth'],
      ),
      connected
        ? el(
            'button',
            { class: 'ghost-btn', onclick: () => actions.disconnectOAuth(provider, label) },
            'Se déconnecter',
          )
        : null,
    ]),
  ]);
};

/* ---------------------------------------------------------- mises à jour - */

const UPDATE_STATES = {
  checking: { label: 'Vérification…', pill: 'var(--warn)' },
  updating: { label: 'Mise à jour en cours…', pill: 'var(--warn)' },
  available: { label: 'Mise à jour disponible', pill: 'var(--warn)' },
  up_to_date: { label: 'À jour', pill: 'var(--ok)' },
  success: { label: 'À jour', pill: 'var(--ok)' },
  error: { label: 'Erreur', pill: 'var(--danger)' },
};

let updatePoll = 0;

/**
 * Statut du service « updater » + boutons. Se repeint lui-même (sans toucher
 * au reste de la page, qui peut contenir une saisie en cours) et suit une
 * opération en cours, y compris pendant le redémarrage de l'app.
 */
const updateBlock = () => {
  const root = el('div', { class: 'oauth-block update-block' });
  // version chargée par cette page : si elle change, le JS doit être rechargé
  const pageBuild = state.meta?.build;
  let status = state.updateStatus;
  let unreachable = false;
  let lastAction = null;

  const busy = () =>
    Boolean(status?.requested) || ['checking', 'updating'].includes(status?.state) || (unreachable && lastAction === 'update');

  const trigger = async (action) => {
    try {
      lastAction = action;
      status = await api.requestUpdate(action);
      toast(action === 'update' ? 'Mise à jour lancée' : 'Vérification lancée');
      paint();
      schedule();
    } catch (error) {
      toast(error.message, 'err');
    }
  };

  const poll = async () => {
    try {
      status = await api.updateStatus();
      unreachable = false;
      state.updateStatus = status;
      if (pageBuild && status.build !== pageBuild && status.state === 'success') {
        toast(`Version ${status.build} installée, rechargement…`);
        setTimeout(() => location.reload(), 1200);
        return;
      }
    } catch {
      unreachable = true; // l'app redémarre pendant la mise à jour
    }
    if (!document.body.contains(root)) return;
    paint();
    schedule();
  };

  function schedule() {
    clearTimeout(updatePoll);
    if (busy()) updatePoll = setTimeout(poll, 2500);
  }

  function paint() {
    const meta = UPDATE_STATES[status?.state] ?? null;
    const connected = status?.connected;

    const children = [
      el('div', { class: 'update-row' }, [
        el('span', {}, ['Version installée : ', el('strong', { class: 'mono' }, status?.build ?? pageBuild ?? '—')]),
        unreachable
          ? el('span', { class: 'status-pill', style: { '--pill': 'var(--warn)' } }, [el('span', { class: 'dot' }), 'Redémarrage de l\'app…'])
          : meta
            ? el('span', { class: 'status-pill', style: { '--pill': meta.pill } }, [el('span', { class: 'dot' }), meta.label])
            : null,
      ]),
      status?.message && !unreachable
        ? el('p', { class: 'field-hint' }, [status.message, status.at ? ` · ${fromNow(status.at)}` : ''])
        : null,
      status?.pending?.length
        ? el('ul', { class: 'update-commits' }, status.pending.map((line) => el('li', { class: 'mono' }, line)))
        : null,
      connected === false && !unreachable
        ? el('p', { class: 'field-hint' }, [
            'Le service de mise à jour ne tourne pas. Sur le serveur, une seule fois : ',
            el('code', {}, 'git pull && docker compose up -d'),
          ])
        : null,
      el('div', { class: 'oauth-actions' }, [
        el(
          'button',
          { class: 'primary-btn', disabled: !connected || busy(), onclick: () => trigger('update') },
          [icon('refresh', `icon${busy() ? ' spin' : ''}`), status?.state === 'available' ? 'Mettre à jour maintenant' : 'Mettre à jour'],
        ),
        el(
          'button',
          { class: 'ghost-btn', disabled: !connected || busy(), onclick: () => trigger('check') },
          [icon('check'), 'Vérifier'],
        ),
      ]),
      status?.log
        ? el('details', {
            class: 'update-log',
            open: status.state === 'error',
            // le résumé (et l'erreur éventuelle) est à la fin du journal
            ontoggle: (event) => {
              const pre = event.currentTarget.querySelector('pre');
              pre.scrollTop = pre.scrollHeight;
            },
          }, [
            el('summary', {}, 'Journal de la dernière opération'),
            el('pre', {}, status.log),
          ])
        : null,
    ];
    root.replaceChildren(...children.filter(Boolean));
  }

  paint();
  schedule();
  // le statut chargé avec la page peut dater : on le rafraîchit tout de suite
  if (!busy()) setTimeout(poll, 0);
  return root;
};

const colorRow = (color, actions) => {
  const draft = {};
  const bind = (key, node, transform = (v) => v) => {
    node.addEventListener('change', () => {
      draft[key] = transform(node.value);
      actions.saveColor(color.key, draft);
    });
    return node;
  };

  return el('tr', {}, [
    el('td', {}, bind('hex', el('input', { type: 'color', class: 'color-input', value: color.hex }))),
    el('td', {}, bind('name', el('input', { class: 'cell-input', value: color.name }))),
    el('td', {}, bind('aliases', el('input', {
      class: 'cell-input',
      value: (color.aliases ?? []).join(', '),
      placeholder: 'alias séparés par des virgules',
    }), (value) => value.split(',').map((v) => v.trim()).filter(Boolean))),
    el('td', {}, bind('stock_grams', el('input', { type: 'number', class: 'cell-input num', value: String(color.stock_grams ?? 0) }), Number)),
    el('td', {}, bind('low_stock_grams', el('input', { type: 'number', class: 'cell-input num', value: String(color.low_stock_grams ?? 0) }), Number)),
    el('td', {}, el('label', { class: 'switch' }, [
      el('input', {
        type: 'checkbox',
        checked: color.is_active,
        onchange: (event) => actions.saveColor(color.key, { is_active: event.target.checked }),
      }),
    ])),
    el('td', {}, el('button', {
      class: 'mini-btn danger',
      title: 'Supprimer (désactivée si des pièces l\'utilisent)',
      onclick: () => actions.deleteColor(color.key),
    }, icon('trash'))),
  ]);
};

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
          style: {
            '--pill':
              run.status === 'success' ? 'var(--ok)' : run.status === 'error' ? 'var(--danger)' : 'var(--warn)',
          },
        },
        [el('span', { class: 'dot' }), run.status],
      ),
    ),
    el('td', { class: 'cell-sub' }, run.message ?? ''),
  ]);

export const renderIntegrations = (root, actions) => {
  root.append(
    el('div', { class: 'section-title' }, 'Connecteurs et réglages'),
    el('div', { class: 'settings-columns' }, GROUPS.map((group) => groupCard(group, actions)).filter(Boolean)),

    el('div', { class: 'section-title' }, 'Résines'),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { style: { width: '54px' } }, 'Teinte'),
          el('th', {}, 'Nom'),
          el('th', {}, 'Alias de détection'),
          el('th', { style: { width: '110px' } }, 'Stock (g)'),
          el('th', { style: { width: '110px' } }, 'Seuil bas'),
          el('th', { style: { width: '70px' } }, 'Active'),
          el('th', { style: { width: '50px' } }, ''),
        ])),
        el('tbody', {}, state.colors.map((color) => colorRow(color, actions))),
      ]),
    ]),
    el('div', { class: 'panel-foot left' }, [
      el('button', { class: 'ghost-btn', onclick: () => actions.addColor() }, [icon('plus'), 'Ajouter une résine']),
    ]),

    el('div', { class: 'section-title' }, 'Journal des synchronisations'),
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
