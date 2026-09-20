import { el, formatDate, fromNow, icon, swatch } from '../ui.js';
import { state } from '../store.js';

const GROUPS = [
  { key: 'shopify', title: 'Shopify', hint: 'App personnalisée avec le scope read_orders.' },
  { key: 'etsy', title: 'Etsy', hint: 'Open API v3, scope transactions_r.' },
  { key: 'chitchats', title: 'Chit Chats', hint: 'Un colis scanné bascule les pièces en « Expédié ».' },
  { key: 'schedule', title: 'Planification', hint: 'Expressions cron appliquées par le worker (prise en compte < 1 min).' },
  { key: 'production', title: 'Production', hint: 'Listes déroulantes disponibles sur chaque pièce.' },
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
