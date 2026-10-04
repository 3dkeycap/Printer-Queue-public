import { el, formatDate, fromNow, icon, swatch, toast } from '../ui.js';
import { THEMES, state } from '../store.js';
import { api } from '../api.js';

/* ==========================================================================
   Page « Réglages » : un onglet par thème, un seul bouton Enregistrer.
   ========================================================================== */

const TABS = [
  { key: 'atelier', label: 'Atelier', icon: 'printer', desc: "Imprimantes, postes UV, tags, et ce qu'on n'imprime pas." },
  { key: 'resines', label: 'Résines', icon: 'drop', desc: 'Les couleurs de résine, leur stock et leurs alias de détection.' },
  { key: 'boutiques', label: 'Boutiques', icon: 'plug', desc: 'Connexion à Shopify, Etsy et Chit Chats.' },
  { key: 'synchro', label: 'Synchronisation', icon: 'refresh', desc: 'À quelle fréquence on va chercher les commandes.' },
  { key: 'apparence', label: 'Apparence & aide', icon: 'sun', desc: 'Thème, tutoriel et mode kiosque iPad.' },
  { key: 'maj', label: 'Mises à jour', icon: 'save', desc: "Installer la dernière version de l'application." },
];

let activeTab = 'atelier';

const CRON_PRESETS = [
  ['*/5 * * * *', 'Toutes les 5 minutes'],
  ['*/10 * * * *', 'Toutes les 10 minutes'],
  ['*/15 * * * *', 'Toutes les 15 minutes'],
  ['*/30 * * * *', 'Toutes les 30 minutes'],
  ['0 * * * *', 'Toutes les heures'],
];

const byKey = (key) => state.settings.find((item) => item.key === key);

/** Éditeur de liste : des pastilles, on tape + Entrée pour en ajouter. */
const chipList = (initial, onChange, placeholder = 'Ajouter…') => {
  let values = [...initial];
  const root = el('div', { class: 'chip-editor' });
  const input = el('input', { class: 'chip-input', placeholder, enterkeyhint: 'done' });

  const commit = (list) => {
    values = list;
    onChange(values);
    paint();
  };
  const addPending = () => {
    const value = input.value.trim().replace(/,$/, '').trim();
    if (value && !values.includes(value)) commit([...values, value]);
    else input.value = '';
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addPending();
      root.querySelector('.chip-input')?.focus();
    } else if (event.key === 'Backspace' && !input.value && values.length) {
      commit(values.slice(0, -1));
      root.querySelector('.chip-input')?.focus();
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) addPending();
  });

  function paint() {
    root.replaceChildren(
      ...values.map((value) =>
        el('span', { class: 'chip-tag' }, [
          value,
          el('button', { class: 'chip-x', type: 'button', title: 'Retirer', onclick: () => commit(values.filter((v) => v !== value)) }, icon('close')),
        ]),
      ),
      input,
    );
    input.value = '';
  }
  paint();
  return root;
};

/** Réglage « liste de clés de résine » : cases à cocher avec la teinte. */
const colorChecklist = (definition, setValue) => {
  const chosen = new Set(definition.value ?? []);
  const rows = state.colors.map((color) =>
    el('label', { class: 'check-row' }, [
      el('input', {
        type: 'checkbox',
        checked: chosen.has(color.key),
        onchange: (event) => {
          if (event.target.checked) chosen.add(color.key);
          else chosen.delete(color.key);
          setValue([...chosen]);
        },
      }),
      swatch(color.hex),
      color.name,
    ]),
  );
  return el('div', { class: 'check-grid' }, rows);
};

/** Construit le champ correspondant au type de réglage. */
const field = (definition, draft, touch, overrides = {}) => {
  const id = `set-${definition.key}`;
  const set = (value) => {
    draft[definition.key] = value;
    touch();
  };
  let input;

  if (overrides.render) {
    input = overrides.render(definition, set);
  } else if (definition.type === 'boolean') {
    const label = el('span', {}, definition.value ? 'Activé' : 'Désactivé');
    input = el('label', { class: 'switch' }, [
      el('input', {
        type: 'checkbox',
        id,
        checked: definition.value,
        onchange: (event) => {
          label.textContent = event.target.checked ? 'Activé' : 'Désactivé';
          set(event.target.checked);
        },
      }),
      label,
    ]);
  } else if (definition.type === 'list') {
    input = chipList(definition.value ?? [], set, overrides.placeholder);
  } else if (definition.key.startsWith('schedule.') && definition.key.endsWith('Cron')) {
    input = cronPicker(definition, set);
  } else {
    input = el('input', {
      id,
      type: definition.type === 'secret' ? 'password' : definition.type === 'number' ? 'number' : 'text',
      value: definition.type === 'secret' ? '' : definition.value ?? '',
      autocomplete: 'off',
      placeholder:
        definition.type === 'secret'
          ? definition.configured
            ? '•••••••••• (enregistré)'
            : 'Non configuré'
          : definition.placeholder ?? '',
      oninput: (event) => set(definition.type === 'number' ? Number(event.target.value) : event.target.value),
    });
  }

  const hint = 'hint' in overrides ? overrides.hint : definition.hint;

  return el('div', { class: 'field' }, [
    el('label', { for: id }, overrides.label ?? definition.label),
    input,
    hint ? el('span', { class: 'field-hint' }, hint) : null,
    overrides.extra ? overrides.extra(() => draft[definition.key] ?? definition.value ?? []) : null,
  ]);
};

/** Fréquences prédéfinies (en clair) ; « Personnalisé » garde l'expression cron brute. */
const cronPicker = (definition, set) => {
  const isPreset = CRON_PRESETS.some(([value]) => value === definition.value);
  const custom = el('input', {
    value: definition.value ?? '',
    placeholder: '*/5 * * * *',
    hidden: isPreset,
    oninput: (event) => set(event.target.value),
  });
  const select = el(
    'select',
    {
      onchange: (event) => {
        if (event.target.value === '__custom__') {
          custom.hidden = false;
          custom.focus();
        } else {
          custom.hidden = true;
          custom.value = event.target.value;
          set(event.target.value);
        }
      },
    },
    [
      ...CRON_PRESETS.map(([value, label]) => el('option', { value, selected: value === definition.value }, label)),
      el('option', { value: '__custom__', selected: !isPreset }, 'Personnalisé (expression cron)…'),
    ],
  );
  return el('div', { class: 'cron-picker' }, [select, custom]);
};

/** Une carte de réglages : titre, phrase d'explication, champs. */
const section = (title, description, children, extra = {}) =>
  el('article', { class: 'panel settings-panel' }, [
    el('header', { class: 'panel-head' }, [el('h3', {}, title), extra.pill ?? null]),
    description ? el('p', { class: 'sub' }, description) : null,
    ...[].concat(children),
  ]);

const statusPill = (connector) =>
  connector
    ? el(
        'span',
        { class: 'status-pill', style: { '--pill': connector.configured ? 'var(--ok)' : 'var(--warn)' } },
        [el('span', { class: 'dot' }), connector.configured ? 'Connecté' : 'À configurer'],
      )
    : null;

/** Barre d'enregistrement collée en bas : visible seulement s'il y a des changements. */
const makeSaveBar = (draft, actions) => {
  const count = el('span', { class: 'savebar-count' });
  const save = el('button', { class: 'primary-btn', onclick: async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    await actions.saveSettings({ ...draft });
    button.disabled = false;
  } }, [icon('save'), 'Enregistrer']);
  const cancel = el('button', { class: 'ghost-btn', onclick: () => actions.refreshView() }, 'Annuler');
  const bar = el('div', { class: 'savebar', hidden: true }, [
    el('span', { class: 'dot' }),
    count,
    el('div', { class: 'toolbar-spacer' }),
    cancel,
    save,
  ]);
  const touch = () => {
    const n = Object.keys(draft).length;
    bar.hidden = n === 0;
    count.textContent = n === 1 ? '1 modification non enregistrée' : `${n} modifications non enregistrées`;
  };
  return { bar, touch };
};

/* ------------------------------------------------------------- onglets --- */

const tabAtelier = (draft, touch, actions) => {
  const f = (key, overrides) => (byKey(key) ? field(byKey(key), draft, touch, overrides) : null);
  return [
    section(
      "Ce qu'on n'imprime pas ici",
      "Les résines faites ailleurs et les articles toujours en stock n'apparaissent pas dans « À imprimer ».",
      [
        f('production.hiddenColors', {
          label: 'Résines retirées de la file',
          hint: "Ex. Nylon Grey (fait dans une autre usine). La vue « Tout » les montre toujours.",
          render: colorChecklist,
        }),
        f('production.nonPrintableKeywords', {
          extra: (current) =>
            el('div', { class: 'panel-foot left' }, [
              el(
                'button',
                { class: 'ghost-btn danger', type: 'button', onclick: () => actions.purgeQueueNow(current()) },
                [icon('trash'), 'Enlever tout maintenant de la file'],
              ),
            ]),
          label: 'Articles toujours en stock (mots à repérer)',
          placeholder: 'Ex. Keycap Puller — puis Entrée',
          hint: "Il suffit que le titre, la variante ou le SKU CONTIENNE le mot (pas besoin du nom exact). Si le nom d'une résine le contient (ex. « Nylon »), la résine disparaît aussi de la file. Une pièce qu'un humain a déjà modifiée reste dans la file.",
        }),
      ],
    ),
    section('Imprimantes', 'Les machines proposées dans la liste « Imprimante » de chaque pièce.', [
      f('production.printerOptions', { label: 'Liste des imprimantes', placeholder: 'Ex. Mars 5 Ultra #1 — puis Entrée', hint: null }),
    ]),
    section('Postes UV', 'Les choix proposés pour le champ UV de chaque pièce.', [
      f('production.uvOptions', { label: 'Options UV', hint: null }),
      f('production.defaultUv', { label: 'Valeur UV par défaut', hint: 'Laisser vide pour ne rien pré-remplir.' }),
    ]),
    section('Tags prédéfinis', 'Proposés en suggestion quand on ajoute un tag à une pièce (plusieurs tags par pièce). Un tag tapé à la main sur une pièce est ajouté ici automatiquement.', [
      f('production.commentOptions', { label: 'Tags', hint: null }),
    ]),
    section(
      'UV automatique',
      "Certaines options achetées (ex. « Custom UV Printed Legends ») signifient que la vraie pièce de la commande a besoin d'UV.",
      [
        f('production.uvTriggerKeywords', { label: 'Options qui déclenchent l\'UV', hint: null }),
        f('production.uvAutoValue', { label: 'Valeur UV appliquée', hint: 'Doit être une des options UV ci-dessus.' }),
      ],
    ),
  ];
};

const tabResines = (actions) => [
  section(
    'Résines',
    "Chaque ligne se modifie directement (enregistré tout de suite). Les alias servent à reconnaître la couleur dans les commandes. Pour ne plus imprimer une couleur, utilise l'onglet « Atelier ».",
    [
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
    ],
  ),
];

const SHOP_CARDS = [
  {
    key: 'shopify',
    title: 'Shopify',
    hint: 'Étapes : renseigne le domaine, le Client ID et le Client secret, enregistre, puis clique « Connecter via OAuth ».',
    advanced: ['shopify.scopes', 'shopify.apiVersion', 'shopify.accessToken'],
    enabled: 'shopify.enabled',
  },
  {
    key: 'etsy',
    title: 'Etsy',
    hint: 'Étapes : renseigne le Shop ID et la clé API, enregistre, puis clique « Connecter via OAuth ».',
    advanced: ['etsy.scopes', 'etsy.accessToken'],
    enabled: 'etsy.enabled',
  },
  {
    key: 'chitchats',
    title: 'Chit Chats',
    hint: 'Un colis scanné fait passer les pièces en « Expédié ».',
    advanced: ['chitchats.apiBase', 'chitchats.packageType', 'chitchats.cheapestPostage', 'chitchats.shipUrlTemplate', 'chitchats.webhookSecret'],
    enabled: null,
  },
];

const tabBoutiques = (draft, touch, actions) =>
  SHOP_CARDS.map((card) => {
    const defs = state.settings.filter((item) => item.group === card.key);
    const connector = state.connectors[card.key];
    const main = defs.filter((d) => !card.advanced.includes(d.key) && d.key !== card.enabled);
    const advanced = defs.filter((d) => card.advanced.includes(d.key));
    const enabledDef = card.enabled ? byKey(card.enabled) : null;

    return section(
      card.title,
      card.hint,
      [
        enabledDef ? field(enabledDef, draft, touch, { label: 'Importer les commandes', hint: null }) : null,
        el('div', { class: 'settings-grid' }, main.map((d) => field(d, draft, touch))),
        card.key === 'shopify' ? oauthBlock(actions, { provider: 'shopify', label: 'Shopify' }) : null,
        card.key === 'etsy' ? oauthBlock(actions, { provider: 'etsy', label: 'Etsy' }) : null,
        card.key === 'chitchats'
          ? el('p', { class: 'field-hint mono' }, `Webhook : POST ${location.origin}/api/webhooks/chitchats`)
          : null,
        advanced.length
          ? el('details', { class: 'advanced' }, [
              el('summary', {}, 'Options avancées'),
              el('div', { class: 'settings-grid' }, advanced.map((d) => field(d, draft, touch))),
            ])
          : null,
        ['shopify', 'etsy', 'chitchats'].includes(card.key)
          ? el('div', { class: 'panel-foot' }, [
              card.key === 'chitchats'
                ? el('button', { class: 'ghost-btn', onclick: () => actions.importChitChats() }, [icon('truck'), 'Importer les commandes maintenant'])
                : null,
              el('button', { class: 'ghost-btn', onclick: () => actions.sync(card.key) }, [icon('refresh'), 'Synchroniser maintenant']),
            ])
          : null,
      ],
      { pill: statusPill(connector) },
    );
  });

const tabSynchro = (draft, touch, actions) => [
  section('Fréquence', 'Un « worker » en arrière-plan importe les commandes et les expéditions. Les changements sont pris en compte en moins d\'une minute.', [
    el('div', { class: 'settings-grid' }, [
      byKey('schedule.syncCron') ? field(byKey('schedule.syncCron'), draft, touch, { label: 'Importer les commandes', hint: null }) : null,
      byKey('schedule.shipmentCron') ? field(byKey('schedule.shipmentCron'), draft, touch, { label: 'Vérifier les expéditions', hint: null }) : null,
      byKey('schedule.chitchatsImportCron')
        ? field(byKey('schedule.chitchatsImportCron'), draft, touch, { label: 'Importer les commandes dans Chit Chats', hint: 'Activable dans Boutiques → Chit Chats.' })
        : null,
      byKey('schedule.lookbackDays')
        ? field(byKey('schedule.lookbackDays'), draft, touch, { label: 'Remonter dans le passé de (jours)', hint: 'Les commandes plus anciennes que ça sont ignorées à chaque synchronisation.' })
        : null,
    ]),
    el('div', { class: 'panel-foot' }, [
      el('button', { class: 'ghost-btn', onclick: () => actions.sync('all') }, [icon('refresh'), 'Tout synchroniser maintenant']),
    ]),
  ]),
  el('div', { class: 'section-title' }, 'Dernières synchronisations'),
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
];

const tabApparence = (actions) => [
  section('Thème', 'Choisis l\'ambiance de l\'application. Le choix est mémorisé sur cet appareil.', [
    el(
      'div',
      { class: 'theme-grid' },
      THEMES.map((theme) =>
        el(
          'button',
          {
            class: `theme-card${state.theme === theme.key ? ' is-on' : ''}`,
            onclick: () => {
              actions.setTheme(theme.key);
              actions.refreshView();
            },
          },
          [
            el('span', { class: 'theme-preview', style: { background: theme.colors[0] } }, [
              el('span', { class: 'theme-dot', style: { background: theme.colors[1] } }),
              el('span', { class: 'theme-bar', style: { background: theme.colors[1] } }),
            ]),
            theme.label,
          ],
        ),
      ),
    ),
  ]),
  section('Aide', 'Une visite guidée de la page « À imprimer ».', [
    el('div', { class: 'panel-foot left' }, [
      el('button', { class: 'primary-btn', onclick: () => actions.startTutorial() }, [icon('help'), 'Lancer le tutoriel']),
    ]),
  ]),
  section(
    'Extension Chrome (Shopify → Chit Chats)',
    "Quand quelqu'un ouvre une commande dans l'admin Shopify, ses cartes affichent « Ouvert sur Shopify » et un bouton « Ouvrir sur Chit Chats ». Le marquage disparaît en changeant de page, en fermant l'onglet ou après 30 min.",
    [
      el('ol', { class: 'install-steps' }, [
        el('li', {}, ["Clique ", el('strong', {}, "Télécharger l'extension"), ' puis décompresse le fichier .zip.']),
        el('li', {}, ['Dans Chrome, ouvre ', el('code', {}, 'chrome://extensions'), ' et active le ', el('strong', {}, 'Mode développeur'), ' (en haut à droite).']),
        el('li', {}, [el('strong', {}, "Charger l'extension non empaquetée"), ' → choisis le dossier ', el('code', {}, 'resin-queue-extension'), '.']),
        el('li', {}, ["Clique l'icône de l'extension → Réglages : l'adresse de l'app et le Client ID Chit Chats sont déjà remplis, ajoute ton nom puis « Enregistrer et tester »."]),
        el('li', {}, ["Mises à jour : icône de l'extension → « Mettre à jour » (un seul clic depuis GitHub ; la première fois, choisis le dossier de l'extension)."]),
      ]),
      el('div', { class: 'panel-foot left' }, [
        el('a', { class: 'primary-btn', href: '/api/extension.zip', download: 'resin-queue-extension.zip' }, [icon('save'), "Télécharger l'extension"]),
        el(
          'a',
          { class: 'ghost-btn', href: 'https://github.com/3dkeycap/Printer-Queue-public/tree/main/chrome-extension', target: '_blank', rel: 'noopener' },
          [icon('link'), 'Voir sur GitHub'],
        ),
      ]),
    ],
  ),
  section('Mode kiosque (iPad)', "Une version sans menu, pensée pour l'écran tactile de l'atelier : uniquement la file « À imprimer », avec de gros boutons.", [
    el('p', { class: 'field-hint mono' }, `${location.origin}/kiosk`),
    el('div', { class: 'panel-foot left' }, [
      el('a', { class: 'ghost-btn', href: '/kiosk', target: '_blank', rel: 'noopener' }, 'Ouvrir le kiosque'),
    ]),
  ]),
];

const tabMaj = (draft, touch) => {
  const defs = state.settings.filter((item) => item.group === 'update');
  const simple = defs.filter((d) => ['update.autoEnabled', 'update.intervalMinutes'].includes(d.key));
  const advanced = defs.filter((d) => !simple.includes(d));
  return [
    section(
      'Mises à jour',
      'Installe la dernière version depuis GitHub. Les données sont conservées et sauvegardées avant chaque mise à jour, avec retour arrière en cas d\'échec.',
      [
        updateBlock(),
        el('div', { class: 'settings-grid' }, simple.map((d) => field(d, draft, touch))),
        advanced.length
          ? el('details', { class: 'advanced' }, [
              el('summary', {}, 'Options avancées (dépôt, branche, token)'),
              el('div', { class: 'settings-grid' }, advanced.map((d) => field(d, draft, touch))),
            ])
          : null,
      ],
    ),
  ];
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
  const draft = {};
  const { bar, touch } = makeSaveBar(draft, actions);

  const tabs = el(
    'nav',
    { class: 'settings-tabs', role: 'tablist' },
    TABS.map((tab) =>
      el(
        'button',
        {
          class: `settings-tab${activeTab === tab.key ? ' is-on' : ''}`,
          role: 'tab',
          onclick: () => {
            activeTab = tab.key;
            actions.refreshView();
          },
        },
        [icon(tab.icon), el('span', {}, tab.label)],
      ),
    ),
  );

  const current = TABS.find((tab) => tab.key === activeTab) ?? TABS[0];
  const content = {
    atelier: () => tabAtelier(draft, touch, actions),
    resines: () => tabResines(actions),
    boutiques: () => tabBoutiques(draft, touch, actions),
    synchro: () => tabSynchro(draft, touch, actions),
    apparence: () => tabApparence(actions),
    maj: () => tabMaj(draft, touch),
  }[current.key]();

  root.append(
    tabs,
    el('p', { class: 'settings-intro' }, current.desc),
    el('div', { class: 'settings-stack' }, content.filter(Boolean)),
    bar,
  );
};
