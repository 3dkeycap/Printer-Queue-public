import { api } from './api.js';
import { clear, el, icon, modal, swatch, toast } from './ui.js';
import {
  commentOptions,
  hasActiveFilters,
  isKiosk,
  queryParams,
  savePrefs,
  state,
  THEMES,
  statusMeta,
  themeMeta,
  usesStatusFilter,
  uvOptions,
} from './store.js';
import { renderBoard } from './views/board.js';
import { renderAll } from './views/all.js';
import { renderIntegrations } from './views/integrations.js';
import { closeDrawer, openDrawer } from './drawer.js';
import { startTutorial } from './tutorial.js';

const NEXT_STATUS = {
  TO_PRINT: 'PRINTING',
  PRINTING: 'DONE',
  FAILED: 'TO_PRINT',
  DONE: 'SHIPPED',
  SHIPPED: null,
};

const VIEW_META = {
  board: { title: 'À imprimer', subtitle: 'Chaque carte = une pièce physique à imprimer.' },
  all: { title: 'Tout', subtitle: 'Toutes les pièces, tous statuts confondus.' },
  integrations: { title: 'Réglages', subtitle: 'Tout ce qui se configure, rangé par thème.' },
};

const dom = {
  view: document.getElementById('view'),
  toolbar: document.getElementById('toolbar'),
  bulkbar: document.getElementById('bulkbar'),
  title: document.getElementById('view-title'),
  subtitle: document.getElementById('view-subtitle'),
  search: document.getElementById('search'),
  syncBtn: document.getElementById('sync-btn'),
  themeBtn: document.getElementById('theme-toggle'),
};

/* --------------------------------------------------------------- actions - */

const actions = {
  nextStatus: (status) => NEXT_STATUS[status] ?? null,

  async move(ids, status, options = {}) {
    // optimiste : on repeint tout de suite, on réconcilie ensuite
    const snapshot = state.parts.map((part) => ({ ...part }));
    for (const part of state.parts) {
      if (ids.includes(part.id)) part.status = status;
    }
    render();

    try {
      if (ids.length === 1) await api.setStatus(ids[0], status, options);
      else {
        const result = await api.bulkStatus(ids, status, options);
        if (result.errors?.length) toast(`${result.errors.length} transition(s) refusée(s)`, 'err');
      }
      toast(`${ids.length} pièce(s) → ${statusMeta(status).labelFr}`);
      state.selection.clear();
      await refresh({ silent: true });
    } catch (error) {
      state.parts = snapshot;
      render();
      toast(error.message, 'err');
    }
  },

  async patchPart(id, patch, { silent = false } = {}) {
    try {
      await api.patchPart(id, patch);
      await refresh({ silent: true });
      if (!silent) toast('Pièce mise à jour');
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  toggleSelection(target) {
    const ids = Array.isArray(target) ? target : [target];
    const allIn = ids.every((id) => state.selection.has(id));
    for (const id of ids) {
      if (allIn) state.selection.delete(id);
      else state.selection.add(id);
    }
    render();
  },

  toggleSelectAll(select) {
    state.selection.clear();
    if (select) for (const part of state.parts) state.selection.add(part.id);
    render();
  },

  toggleColumnFocus(status) {
    state.focusedColumn = state.focusedColumn === status ? null : status;
    render();
  },

  openPart: (id) => openDrawer(id, actions),

  async sync(source = 'all') {
    dom.syncBtn.disabled = true;
    dom.syncBtn.querySelector('.icon').classList.add('spin');
    try {
      const result = await api.sync(source);
      const created = (result.orders ?? []).reduce((sum, run) => sum + (run.partsCreated ?? 0), 0);
      const failed = (result.orders ?? []).filter((run) => run.status === 'error');
      if (failed.length) toast(failed.map((run) => `${run.source} : ${run.message}`).join(' · '), 'err');
      else toast(created ? `${created} nouvelle(s) pièce(s) importée(s)` : 'Synchronisation terminée');
      await refresh();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      dom.syncBtn.disabled = false;
      dom.syncBtn.querySelector('.icon').classList.remove('spin');
    }
  },

  setTheme: (key) => setTheme(key),

  refreshView: () => render(),

  startTutorial: () => startTutorial(),

  async importChitChats() {
    try {
      toast('Import vers Chit Chats en cours…');
      const { import: result } = await api.sync('chitchats-import');
      if (result.status === 'skipped') toast(result.message, 'err');
      else toast(`Chit Chats : ${result.message ?? 'terminé'}`);
      await refresh({ silent: true });
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async saveSettings(patch) {
    if (!Object.keys(patch).length) return toast('Aucune modification');
    try {
      const result = await api.saveSettings(patch);
      state.settings = result.settings;
      state.connectors = result.connectors;
      state.meta = await api.meta();
      toast('Réglages enregistrés');
      render();
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async disconnectOAuth(provider, label) {
    try {
      const result = await api.disconnectOAuth(provider);
      state.settings = result.settings;
      state.connectors = result.connectors;
      toast(`${label} déconnecté`);
      render();
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async addCustomComment(partId) {
    const input = el('input', { placeholder: 'Attente client, pièce cassée…' });

    await modal({
      title: 'Ajouter un commentaire',
      body: el('div', { class: 'field' }, [el('label', {}, 'Commentaire'), input]),
      confirmLabel: 'Ajouter',
      onConfirm: async () => {
        const value = input.value.trim();
        if (!value) return toast('Le commentaire est obligatoire', 'err');
        try {
          const options = commentOptions();
          if (!options.includes(value)) {
            await api.saveSettings({ 'production.commentOptions': [...options, value] });
            state.meta = await api.meta();
          }
          await actions.patchPart(partId, { comment: value }, { silent: true });
          toast('Commentaire ajouté');
          render();
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    });
  },

  async editHiddenColors() {
    const hidden = new Set(state.meta?.hiddenColors ?? []);
    const boxes = state.colors.map((color) => {
      const input = el('input', { type: 'checkbox', checked: hidden.has(color.key) });
      return { color, input };
    });

    await modal({
      title: 'Couleurs retirées de la file',
      body: el('div', {}, [
        el('p', { class: 'cell-sub' }, "Coche les couleurs qu'on n'imprime pas ici (ex. Nylon, fait dans une autre usine). Elles disparaissent de « À imprimer » ; « Tout » les montre toujours."),
        ...boxes.map(({ color, input }) =>
          el('label', { class: 'check-row' }, [input, swatch(color.hex), color.name]),
        ),
      ]),
      confirmLabel: 'Enregistrer',
      onConfirm: async () => {
        try {
          // on garde les clés masquées qui ne sont plus dans la liste des résines actives
          const known = new Set(state.colors.map((color) => color.key));
          const keep = [...hidden].filter((key) => !known.has(key));
          const next = [...keep, ...boxes.filter(({ input }) => input.checked).map(({ color }) => color.key)];
          await api.saveSettings({ 'production.hiddenColors': next });
          state.meta = await api.meta();
          state.filters.colors = new Set([...state.filters.colors].filter((key) => !next.includes(key)));
          toast(next.length ? `${next.length} couleur(s) masquée(s)` : 'Aucune couleur masquée');
          await refresh();
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    });
  },

  /** « Enlever tout maintenant » : aperçu, confirmation, puis retrait de la file. */
  async purgeQueueNow(keywords) {
    try {
      const preview = await api.purgeNonPrintable({ keywords, dryRun: true });
      if (!preview.removed) return toast('Rien à enlever : aucune pièce de la file ne correspond');
      const confirmed = await modal({
        title: 'Enlever de la file maintenant ?',
        body: el('div', {}, [
          el('p', {}, `${preview.removed} pièce(s) seront retirées de « À imprimer » et « Échec » :`),
          el('ul', { class: 'purge-list' }, preview.items.map((item) => el('li', {}, `${item.count} × ${item.name}`))),
          el('p', { class: 'cell-sub' }, "Les pièces ajoutées à la main, en cours d'impression ou déjà imprimées ne sont pas touchées."),
        ]),
        confirmLabel: `Enlever ${preview.removed} pièce(s)`,
        onConfirm: () => true,
      });
      if (!confirmed) return;
      const result = await api.purgeNonPrintable({ keywords });
      toast(`${result.removed} pièce(s) retirée(s) de la file`);
      await refresh({ silent: true });
      render();
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  toggleStack(status) {
    if (state.stacked.has(status)) state.stacked.delete(status);
    else state.stacked.add(status);
    savePrefs();
    render();
  },

  async saveColor(key, patch) {
    if (!Object.keys(patch).length) return;
    try {
      await api.patchColor(key, patch);
      state.colors = (await api.colors()).items;
      toast('Résine mise à jour');
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async addColor() {
    const name = el('input', { placeholder: 'Bleu ciel' });
    const hex = el('input', { type: 'color', value: '#8CBFAE', class: 'color-input' });
    const aliases = el('input', { placeholder: 'sky blue, bleu ciel' });

    await modal({
      title: 'Ajouter une résine',
      body: el('div', {}, [
        el('div', { class: 'field' }, [el('label', {}, 'Nom'), name]),
        el('div', { class: 'field' }, [el('label', {}, 'Teinte'), hex]),
        el('div', { class: 'field' }, [el('label', {}, 'Alias de détection'), aliases]),
      ]),
      confirmLabel: 'Créer',
      onConfirm: async () => {
        if (!name.value.trim()) return toast('Le nom est obligatoire', 'err');
        try {
          await api.createColor({
            name: name.value.trim(),
            key: name.value.trim(),
            hex: hex.value,
            aliases: aliases.value.split(',').map((v) => v.trim()).filter(Boolean),
          });
          state.colors = (await api.colors()).items;
          toast('Résine ajoutée');
          render();
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    });
  },

  async deleteColor(key) {
    try {
      const result = await api.deleteColor(key);
      state.colors = (await api.colors()).items;
      toast(result.deactivated ? `Résine utilisée par ${result.parts} pièce(s) : désactivée` : 'Résine supprimée');
      render();
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async addPart() {
    const name = el('input', { placeholder: 'DES Keycap Set Lily58' });
    const sku = el('input', { placeholder: 'KC-LILY58' });
    const quantity = el('input', { type: 'number', min: '1', value: '1' });
    const customer = el('input', { placeholder: 'Pour qui (facultatif)' });
    const color = el('select', {}, state.colors.map((c) => el('option', { value: c.key }, c.name)));
    const uv = el('select', {}, [
      el('option', { value: '' }, 'Aucun poste UV'),
      ...uvOptions().map((option) => el('option', { value: option, selected: option === state.meta?.defaultUv }, option)),
    ]);
    const comment = el('select', {}, [
      el('option', { value: '' }, 'Aucun commentaire'),
      ...commentOptions().map((option) => el('option', { value: option }, option)),
    ]);

    await modal({
      title: 'Ajouter une pièce à produire',
      body: el('div', {}, [
        el('div', { class: 'field' }, [el('label', {}, 'Pièce'), name]),
        el('div', { class: 'field' }, [el('label', {}, 'SKU'), sku]),
        el('div', { class: 'field' }, [el('label', {}, 'Quantité'), quantity]),
        el('div', { class: 'field' }, [el('label', {}, 'Pour qui'), customer]),
        el('div', { class: 'field' }, [el('label', {}, 'Résine'), color]),
        el('div', { class: 'field' }, [el('label', {}, 'Poste UV'), uv]),
        el('div', { class: 'field' }, [el('label', {}, 'Commentaire'), comment]),
      ]),
      confirmLabel: 'Créer',
      onConfirm: async () => {
        if (!name.value.trim()) return toast('Le nom est obligatoire', 'err');
        try {
          await api.createPart({
            name: name.value.trim(),
            sku: sku.value.trim() || null,
            quantity: Number(quantity.value) || 1,
            customer: customer.value.trim() || null,
            color_key: color.value,
            uv: uv.value || null,
            comment: comment.value || null,
          });
          toast('Pièce(s) ajoutée(s) à la file');
          await refresh();
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    });
  },
};

/* ---------------------------------------------------------------- render - */

const chip = (label, isOn, onclick, extra = [], count = null) =>
  el('button', { class: `chip${isOn ? ' is-on' : ''}`, onclick }, [
    ...extra,
    label,
    count === null ? null : el('span', { class: 'count' }, String(count)),
  ].filter(Boolean));

const renderToolbar = () => {
  if (state.view === 'integrations') {
    dom.toolbar.hidden = true;
    return;
  }
  dom.toolbar.hidden = false;

  // compteurs « à facettes » : ils tiennent compte des autres filtres actifs
  const facets = state.facets ?? { color: {}, uv: {}, status: {}, source: {}, rush: 0 };

  const colorChips = state.colors
    .filter((color) => facets.color[color.key] > 0 || state.filters.colors.has(color.key))
    .map((color) =>
      chip(
        color.name,
        state.filters.colors.has(color.key),
        () => {
          toggleIn(state.filters.colors, color.key);
          refresh();
        },
        [swatch(color.hex)],
        facets.color[color.key] ?? 0,
      ),
    );

  const statusChips = usesStatusFilter()
    ? state.meta.statuses.map((status) =>
        chip(
          status.labelFr,
          state.filters.statuses.has(status.key),
          () => {
            toggleIn(state.filters.statuses, status.key);
            refresh();
          },
          [el('span', { class: 'swatch', style: { background: status.accent } })],
          facets.status[status.key] ?? 0,
        ),
      )
    : [];

  const groupSelect = el(
    'select',
    {
      class: 'select',
      onchange: (event) => {
        state.groupBy = event.target.value;
        savePrefs();
        render();
      },
    },
    [
      ['color', 'Grouper par couleur'],
      ['uv', 'Grouper par UV'],
      ['order', 'Grouper par commande'],
      ['none', 'Aucun regroupement'],
    ].map(([value, label]) => el('option', { value, selected: state.groupBy === value }, label)),
  );

  const sortSelect = el(
    'select',
    {
      class: 'select',
      onchange: (event) => {
        state.sort = event.target.value;
        savePrefs();
        refresh();
      },
    },
    [
      ['smart', 'Tri : priorité'],
      ['oldest', 'Tri : plus anciennes'],
      ['newest', 'Tri : plus récentes'],
      ['color', 'Tri : couleur'],
      ['updated', 'Tri : activité'],
    ].map(([value, label]) => el('option', { value, selected: state.sort === value }, label)),
  );

  const sourceSelect = el(
    'select',
    {
      class: 'select',
      onchange: (event) => {
        state.filters.source = event.target.value;
        refresh();
      },
    },
    [
      ['', 'Toutes les sources'],
      ['shopify', 'Shopify'],
      ['etsy', 'Etsy'],
      ['manual', 'Interne'],
    ].map(([value, label]) =>
      el(
        'option',
        { value, selected: state.filters.source === value },
        value ? `${label} (${facets.source[value] ?? 0})` : label,
      ),
    ),
  );

  const rushChip = chip('Rush', state.filters.priority, () => {
    state.filters.priority = !state.filters.priority;
    refresh();
  }, [icon('bolt')], facets.rush ?? 0);

  const hiddenKeys = state.meta?.hiddenColors ?? [];
  const hiddenChip =
    state.view === 'board' && !isKiosk
      ? chip('Couleurs masquées', hiddenKeys.length > 0, () => actions.editHiddenColors(), [icon('close')], hiddenKeys.length || null)
      : null;

  const resetChip = hasActiveFilters()
    ? chip('Réinitialiser', false, () => {
        state.filters.colors.clear();
        state.filters.statuses.clear();
        state.filters.source = '';
        state.filters.priority = false;
        state.filters.q = '';
        dom.search.value = '';
        refresh();
      }, [icon('close')])
    : null;

  clear(dom.toolbar).append(
    ...[
      el('span', { class: 'toolbar-label' }, 'Résine'),
      el('div', { class: 'toolbar-group' }, colorChips.length ? colorChips : el('span', { class: 'cell-sub' }, 'Aucune pièce')),
      statusChips.length ? el('span', { class: 'toolbar-sep' }) : null,
      statusChips.length ? el('div', { class: 'toolbar-group' }, statusChips) : null,
      el('div', { class: 'toolbar-spacer' }),
      el('div', { class: 'toolbar-group' }, [hiddenChip, rushChip, resetChip, sourceSelect, groupSelect, sortSelect].filter(Boolean)),
    ].filter(Boolean),
  );
};

const toggleIn = (set, value) => {
  if (set.has(value)) set.delete(value);
  else set.add(value);
};

const renderBulkbar = () => {
  if (!state.selection.size) {
    dom.bulkbar.hidden = true;
    return;
  }
  dom.bulkbar.hidden = false;
  const ids = [...state.selection];

  clear(dom.bulkbar).append(
    el('span', { class: 'label' }, `${ids.length} pièce(s) sélectionnée(s)`),
    el('span', { class: 'toolbar-sep' }),
    ...state.meta.statuses.map((status) =>
      el('button', { class: 'chip', onclick: () => actions.move(ids, status.key, { force: true }) }, [
        el('span', { class: 'swatch', style: { background: status.accent } }),
        status.labelFr,
      ]),
    ),
    el('span', { class: 'toolbar-sep' }),
    el(
      'button',
      {
        class: 'chip',
        onclick: async () => {
          const value = await pickFromList('Commentaire', commentOptions());
          if (value !== null) {
            for (const id of ids) await api.patchPart(id, { comment: value || null });
            state.selection.clear();
            await refresh();
            toast('Commentaire appliqué');
          }
        },
      },
      [icon('note'), 'Commentaire'],
    ),
    el(
      'button',
      {
        class: 'chip',
        onclick: async () => {
          const value = await pickFromList('Poste UV', uvOptions());
          if (value !== null) {
            for (const id of ids) await api.patchPart(id, { uv: value || null });
            state.selection.clear();
            await refresh();
            toast('UV appliqué');
          }
        },
      },
      [icon('uv'), 'UV'],
    ),
    el('div', { class: 'toolbar-spacer' }),
    el('button', { class: 'ghost-btn', onclick: () => actions.toggleSelectAll(false) }, 'Désélectionner'),
  );
};

const pickFromList = (title, options) =>
  new Promise((resolve) => {
    const select = el('select', {}, [
      el('option', { value: '' }, '— vider —'),
      ...options.map((option) => el('option', { value: option }, option)),
    ]);
    modal({
      title: `${title} pour la sélection`,
      body: el('div', { class: 'field' }, [el('label', {}, title), select]),
      confirmLabel: 'Appliquer',
      onConfirm: () => select.value,
    }).then((value) => resolve(value === null ? null : value));
  });

const render = () => {
  const meta = VIEW_META[state.view];
  dom.title.textContent = meta.title;
  dom.subtitle.textContent = meta.subtitle;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === state.view);
  });

  updateConnectorBadge();
  renderToolbar();
  renderBulkbar();

  const root = clear(dom.view);
  root.classList.remove('is-board');

  if (state.view === 'board') {
    if (!state.parts.length) {
      root.append(
        hasActiveFilters()
          ? el('div', { class: 'empty' }, [
              icon('layers'),
              el('strong', {}, 'Aucune pièce ne correspond aux filtres'),
              'Retire un filtre ou clique « Réinitialiser » dans la barre au-dessus.',
            ])
          : el('div', { class: 'empty' }, [
              icon('layers'),
              el('strong', {}, 'Rien à imprimer'),
              'Connecte Shopify ou Etsy dans Intégrations, ou ajoute une pièce manuellement.',
            ]),
      );
    } else renderBoard(root, actions);
  } else if (state.view === 'all') renderAll(root, actions);
  else renderIntegrations(root, actions);
};

/* ----------------------------------------------------------------- data -- */

// numéro de la dernière requête : une réponse plus ancienne (clic rapide sur
// plusieurs puces, rafraîchissement automatique) ne doit pas écraser la plus récente
let refreshSeq = 0;

const refresh = async ({ silent = false } = {}) => {
  const seq = ++refreshSeq;
  if (!silent) state.loading = true;
  try {
    if (state.view === 'integrations') {
      const [settings, colors, runs, summary, updateStatus] = await Promise.all([
        api.settings(),
        api.colors(),
        api.runs(),
        api.summary(),
        api.updateStatus().catch(() => null),
      ]);
      if (seq !== refreshSeq) return;
      state.updateStatus = updateStatus;
      state.settings = settings.items;
      state.connectors = settings.connectors;
      state.colors = colors.items;
      state.runs = runs.items;
      state.summary = summary;
    } else {
      const params = queryParams();
      const [summary, parts, facets, presence] = await Promise.all([
        api.summary(),
        api.parts(params),
        api.facets(params),
        api.presence().catch(() => ({ items: [] })),
      ]);
      if (seq !== refreshSeq) return;
      state.presence = presence.items;
      state.summary = summary;
      state.parts = parts.items;
      state.facets = facets;
      // une pièce sélectionnée qui sort du filtre ne doit pas rester dans les actions groupées
      const visible = new Set(state.parts.map((part) => part.id));
      for (const id of state.selection) if (!visible.has(id)) state.selection.delete(id);
    }
    updateNavCounts();
    render();
  } catch (error) {
    if (seq === refreshSeq) toast(error.message, 'err');
  } finally {
    if (seq === refreshSeq) state.loading = false;
  }
};

const updateNavCounts = () => {
  const totals = state.summary?.totals ?? {};
  const counts = { board: totals.parts_active ?? 0, all: totals.parts_total ?? 0 };
  document.querySelectorAll('.nav-count').forEach((node) => {
    const value = counts[node.dataset.count];
    node.textContent = value ? String(value) : '';
  });
};

const setView = (view) => {
  state.view = view;
  state.selection.clear();
  location.hash = view;
  refresh();
};

/* ------------------------------------------------------------- bootstrap - */

const applyTheme = () => {
  document.documentElement.dataset.theme = state.theme;
  const next = THEMES[(THEMES.findIndex((theme) => theme.key === state.theme) + 1) % THEMES.length];
  clear(dom.themeBtn).append(icon('sun'), el('span', {}, `Thème : ${themeMeta(state.theme).label}`));
  dom.themeBtn.title = `Changer de thème (suivant : ${next.label})`;
};

const setTheme = (key) => {
  state.theme = key;
  savePrefs();
  applyTheme();
};

const updateConnectorBadge = () => {
  const connectors = state.meta?.connectors ?? {};
  const ready = Object.values(connectors).filter((connector) => connector.configured).length;
  const total = Object.keys(connectors).length;
  const badge = document.getElementById('mode-badge');
  badge.classList.toggle('is-live', ready === total && total > 0);
  document.getElementById('mode-label').textContent =
    total === 0 ? '—' : ready === total ? 'Connecteurs actifs' : `${ready}/${total} connecteur(s)`;
  document.getElementById('cron-line').textContent =
    `sync ${state.meta?.syncCron ?? '—'} · envois ${state.meta?.shipmentCron ?? '—'}` +
    (state.meta?.build ? ` · version ${state.meta.build}` : '');
};

const bindEvents = () => {
  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (button) setView(button.dataset.view);
  });

  let searchTimer = 0;
  dom.search.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.q = event.target.value.trim();
      refresh();
    }, 250);
  });

  dom.syncBtn.addEventListener('click', () => actions.sync('all'));
  document.getElementById('add-part-btn').addEventListener('click', () => actions.addPart());

  dom.themeBtn.addEventListener('click', () => {
    setTheme(THEMES[(THEMES.findIndex((theme) => theme.key === state.theme) + 1) % THEMES.length].key);
  });
  document.getElementById('tutorial-btn').addEventListener('click', () => startTutorial());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDrawer();
      if (state.selection.size) actions.toggleSelectAll(false);
    }
    if (event.key === '/' && document.activeElement !== dom.search) {
      event.preventDefault();
      dom.search.focus();
    }
  });

  window.addEventListener('hashchange', () => {
    const view = location.hash.replace('#', '');
    if (!isKiosk && VIEW_META[view] && view !== state.view) setView(view);
  });

  // « ouvert sur Shopify » change vite : on suit plus souvent que le reste
  let presenceKey = '';
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || state.view === 'integrations') return;
    try {
      const { items } = await api.presence();
      const key = JSON.stringify(items);
      if (key === presenceKey) return;
      presenceKey = key;
      state.presence = items;
      if (!state.selection.size) render();
    } catch {
      /* hors ligne : on réessaie au prochain tour */
    }
  }, 8000);

  // le worker importe en arrière-plan : on rafraîchit sans déranger l'opérateur
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.selection.size && state.view !== 'integrations') {
      refresh({ silent: true });
    }
  }, 30000);
};

const OAUTH_PROVIDERS = { shopify: 'Shopify', etsy: 'Etsy' };

/** Retour d'un flux OAuth : ?<provider>_status=connected|error#integrations */
const consumeOAuthRedirect = () => {
  const params = new URLSearchParams(location.search);
  let touched = false;

  for (const [provider, label] of Object.entries(OAUTH_PROVIDERS)) {
    const status = params.get(`${provider}_status`);
    if (!status) continue;
    touched = true;
    if (status === 'connected') toast(`${label} connecté`);
    else toast(params.get(`${provider}_message`) || `Connexion ${label} refusée`, 'err');
  }

  if (touched) history.replaceState(null, '', location.pathname + location.hash);
};

const boot = async () => {
  if (isKiosk) {
    document.documentElement.classList.add('kiosk');
    location.hash = 'board';
  }
  applyTheme();
  bindEvents();
  consumeOAuthRedirect();

  const [meta, colors] = await Promise.all([api.meta(), api.colors()]);
  state.meta = meta;
  state.colors = colors.items;
  updateConnectorBadge();

  const initial = location.hash.replace('#', '');
  state.view = !isKiosk && VIEW_META[initial] ? initial : 'board';

  await refresh();
};

boot();
