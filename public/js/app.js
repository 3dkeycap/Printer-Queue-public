import { api } from './api.js';
import { clear, el, icon, modal, swatch, toast } from './ui.js';
import { queryParams, savePrefs, state, statusMeta } from './store.js';
import { renderBoard } from './views/board.js';
import { renderTable } from './views/table.js';
import { renderInventory } from './views/inventory.js';
import { renderOrders } from './views/orders.js';
import { renderIntegrations } from './views/integrations.js';
import { closeDrawer, openDrawer } from './drawer.js';

const NEXT_STATUS = {
  TO_PRINT: 'FILE_READY',
  FILE_READY: 'PRINTING',
  PRINTING: 'DONE',
  FAILED: 'TO_PRINT',
  DONE: 'IN_INVENTORY',
  IN_INVENTORY: 'SHIPPED',
  SHIPPED: null,
};

const VIEW_META = {
  board: { title: 'Production', subtitle: 'Chaque carte = une pièce physique à imprimer.' },
  inventory: { title: 'Inventaire', subtitle: 'Pièces finies en bac et stock de résine par couleur.' },
  orders: { title: 'Commandes', subtitle: 'Commandes importées depuis Shopify et Etsy.' },
  integrations: { title: 'Intégrations', subtitle: 'Connecteurs, planification et journal des synchronisations.' },
};

const dom = {
  view: document.getElementById('view'),
  stats: document.getElementById('stats'),
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
    // optimistic: repaint immediately, reconcile with the server afterwards
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

  async patchPart(id, patch) {
    try {
      await api.patchPart(id, patch);
      await refresh({ silent: true });
      toast('Pièce mise à jour');
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  toggleSelection(id) {
    if (state.selection.has(id)) state.selection.delete(id);
    else state.selection.add(id);
    render();
  },

  toggleSelectAll(select) {
    state.selection.clear();
    if (select) for (const part of state.parts) state.selection.add(part.id);
    render();
  },

  openPart: (id) => openDrawer(id, actions),

  async sync(source = 'all') {
    dom.syncBtn.disabled = true;
    dom.syncBtn.querySelector('.icon').classList.add('spin');
    try {
      const result = await api.sync(source);
      const created = (result.orders ?? []).reduce((sum, run) => sum + (run.partsCreated ?? 0), 0);
      toast(created ? `${created} nouvelle(s) pièce(s) importée(s)` : 'Synchronisation terminée');
      await refresh();
    } catch (error) {
      toast(error.message, 'err');
    } finally {
      dom.syncBtn.disabled = false;
      dom.syncBtn.querySelector('.icon').classList.remove('spin');
    }
  },

  async setStock(key, grams) {
    try {
      await api.patchColor(key, { stock_grams: grams });
      await refresh({ silent: true });
      toast('Stock de résine mis à jour');
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  filterByOrder(order) {
    dom.search.value = order.order_number ?? order.external_id;
    state.filters.q = dom.search.value;
    state.filters.statuses.clear();
    setView('board');
  },

  async shipOrder(order) {
    await modal({
      title: `Expédier ${order.order_number ?? order.external_id} ?`,
      body: el('p', { class: 'sub' }, 'Toutes les pièces de cette commande passeront au statut « Expédié ».'),
      confirmLabel: 'Expédier',
      onConfirm: async () => {
        try {
          await api.shipOrder(order.id, { id: `manual-${Date.now()}` });
          toast('Commande expédiée');
          await refresh();
        } catch (error) {
          toast(error.message, 'err');
        }
      },
    });
  },

  async addPart() {
    const name = el('input', { placeholder: 'Keycap "Tiki Skull"' });
    const sku = el('input', { placeholder: 'KC-TIKI-R1' });
    const quantity = el('input', { type: 'number', min: '1', value: '1' });
    const color = el(
      'select',
      {},
      state.colors.map((c) => el('option', { value: c.key }, c.name)),
    );

    await modal({
      title: 'Ajouter une pièce à produire',
      body: el('div', { class: 'modal-body', style: { padding: '0' } }, [
        el('div', { class: 'field' }, [el('label', {}, 'Nom de la pièce'), name]),
        el('div', { class: 'field' }, [el('label', {}, 'SKU'), sku]),
        el('div', { class: 'field' }, [el('label', {}, 'Quantité'), quantity]),
        el('div', { class: 'field' }, [el('label', {}, 'Résine'), color]),
      ]),
      confirmLabel: 'Créer',
      onConfirm: async () => {
        if (!name.value.trim()) return toast('Le nom est obligatoire', 'err');
        try {
          await api.createPart({
            name: name.value.trim(),
            sku: sku.value.trim() || null,
            quantity: Number(quantity.value) || 1,
            color_key: color.value,
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

const renderStats = () => {
  const summary = state.summary;
  if (!summary) return;
  const { totals, byStatus } = summary;

  const tiles = [
    { label: 'À produire', value: totals.parts_active, hint: `${totals.orders_open} commande(s) ouverte(s)`, accent: 'var(--accent)' },
    { label: 'À imprimer', value: byStatus.TO_PRINT + byStatus.FILE_READY, hint: `${byStatus.FILE_READY} fichier(s) prêt(s)`, accent: statusMeta('FILE_READY').accent },
    { label: 'En impression', value: byStatus.PRINTING, hint: `${totals.done_today} terminée(s) aujourd'hui`, accent: statusMeta('PRINTING').accent },
    { label: 'Échecs ouverts', value: totals.failed_open, hint: 'À relancer', accent: statusMeta('FAILED').accent },
    { label: 'En stock', value: byStatus.IN_INVENTORY, hint: 'Prêtes à emballer', accent: statusMeta('IN_INVENTORY').accent },
    { label: 'Expédiées', value: totals.shipped_today, hint: "aujourd'hui · Chit Chats", accent: statusMeta('SHIPPED').accent },
    { label: 'Rush', value: totals.parts_rush, hint: 'Pièces prioritaires', accent: 'var(--warn)' },
  ];

  clear(dom.stats).append(
    ...tiles.map((tile) =>
      el('article', { class: 'stat', style: { '--stat-accent': tile.accent } }, [
        el('div', { class: 'stat-label' }, tile.label),
        el('div', { class: 'stat-value' }, String(tile.value ?? 0)),
        el('div', { class: 'stat-hint' }, tile.hint),
      ]),
    ),
  );
};

const renderToolbar = () => {
  if (state.view !== 'board') {
    dom.toolbar.hidden = true;
    return;
  }
  dom.toolbar.hidden = false;

  const colorCounts = new Map((state.summary?.byColor ?? []).map((c) => [c.key, c.active]));

  const colorChips = state.colors
    .filter((color) => colorCounts.get(color.key) > 0 || state.filters.colors.has(color.key))
    .map((color) =>
      el(
        'button',
        {
          class: `chip${state.filters.colors.has(color.key) ? ' is-on' : ''}`,
          onclick: () => {
            if (state.filters.colors.has(color.key)) state.filters.colors.delete(color.key);
            else state.filters.colors.add(color.key);
            refresh();
          },
        },
        [swatch(color.hex), color.name, el('span', { class: 'count' }, String(colorCounts.get(color.key) ?? 0))],
      ),
    );

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
      el('option', { value: 'color', selected: state.groupBy === 'color' }, 'Grouper par couleur'),
      el('option', { value: 'order', selected: state.groupBy === 'order' }, 'Grouper par commande'),
      el('option', { value: 'none', selected: state.groupBy === 'none' }, 'Aucun regroupement'),
    ],
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
      el('option', { value: 'smart', selected: state.sort === 'smart' }, 'Tri : priorité'),
      el('option', { value: 'oldest', selected: state.sort === 'oldest' }, 'Tri : plus anciennes'),
      el('option', { value: 'newest', selected: state.sort === 'newest' }, 'Tri : plus récentes'),
      el('option', { value: 'color', selected: state.sort === 'color' }, 'Tri : couleur'),
      el('option', { value: 'updated', selected: state.sort === 'updated' }, 'Tri : activité'),
    ],
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
      el('option', { value: '', selected: !state.filters.source }, 'Toutes les sources'),
      el('option', { value: 'shopify', selected: state.filters.source === 'shopify' }, 'Shopify'),
      el('option', { value: 'etsy', selected: state.filters.source === 'etsy' }, 'Etsy'),
      el('option', { value: 'manual', selected: state.filters.source === 'manual' }, 'Interne'),
    ],
  );

  const layoutToggle = el('div', { class: 'segmented' }, [
    el(
      'button',
      {
        class: state.layout === 'board' ? 'is-on' : '',
        onclick: () => {
          state.layout = 'board';
          savePrefs();
          render();
        },
      },
      [icon('board'), 'Kanban'],
    ),
    el(
      'button',
      {
        class: state.layout === 'table' ? 'is-on' : '',
        onclick: () => {
          state.layout = 'table';
          savePrefs();
          render();
        },
      },
      [icon('table'), 'Tableau'],
    ),
  ]);

  const rushChip = el(
    'button',
    {
      class: `chip${state.filters.priority ? ' is-on' : ''}`,
      onclick: () => {
        state.filters.priority = !state.filters.priority;
        refresh();
      },
    },
    [icon('bolt'), 'Rush'],
  );

  const resetChip =
    state.filters.colors.size || state.filters.source || state.filters.priority || state.filters.q
      ? el(
          'button',
          {
            class: 'chip',
            onclick: () => {
              state.filters.colors.clear();
              state.filters.source = '';
              state.filters.priority = false;
              state.filters.q = '';
              dom.search.value = '';
              refresh();
            },
          },
          [icon('close'), 'Réinitialiser'],
        )
      : null;

  clear(dom.toolbar).append(
    el('span', { class: 'toolbar-label' }, 'Résine'),
    el('div', { class: 'toolbar-group' }, colorChips.length ? colorChips : el('span', { class: 'cell-sub' }, 'Aucune pièce en production')),
    el('div', { class: 'toolbar-spacer' }),
    el('div', { class: 'toolbar-group' }, [rushChip, resetChip, sourceSelect, groupSelect, sortSelect, layoutToggle].filter(Boolean)),
  );
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
      el(
        'button',
        { class: 'chip', onclick: () => actions.move(ids, status.key, { force: true }) },
        [el('span', { class: 'swatch', style: { background: status.accent } }), status.labelFr],
      ),
    ),
    el('div', { class: 'toolbar-spacer' }),
    el('button', { class: 'ghost-btn', onclick: () => actions.toggleSelectAll(false) }, 'Désélectionner'),
  );
};

const render = () => {
  const meta = VIEW_META[state.view];
  dom.title.textContent = meta.title;
  dom.subtitle.textContent = meta.subtitle;

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('is-active', item.dataset.view === state.view);
  });

  renderStats();
  renderToolbar();
  renderBulkbar();

  const root = clear(dom.view);
  root.classList.remove('is-board');

  if (state.view === 'board') {
    if (!state.parts.length) {
      root.append(
        el('div', { class: 'empty' }, [
          icon('layers'),
          el('strong', {}, 'La file est vide'),
          'Lance une synchronisation ou ajoute une pièce manuellement.',
        ]),
      );
    } else if (state.layout === 'board') renderBoard(root, actions);
    else renderTable(root, actions);
  } else if (state.view === 'inventory') renderInventory(root, actions);
  else if (state.view === 'orders') renderOrders(root, actions);
  else renderIntegrations(root, actions);
};

/* ----------------------------------------------------------------- data -- */

const refresh = async ({ silent = false } = {}) => {
  if (!silent) state.loading = true;
  try {
    const [summary, parts] = await Promise.all([api.summary(), api.parts(queryParams())]);
    state.summary = summary;
    state.parts = parts.items;

    if (state.view === 'inventory') {
      const [inventory, colors] = await Promise.all([api.inventory(), api.colors()]);
      state.inventory = inventory.items;
      state.colors = colors.items;
    }
    if (state.view === 'orders') state.orders = (await api.orders({ limit: 100 })).items;
    if (state.view === 'integrations') state.runs = (await api.runs()).items;

    updateNavCounts();
    render();
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    state.loading = false;
  }
};

const updateNavCounts = () => {
  const totals = state.summary?.totals ?? {};
  const byStatus = state.summary?.byStatus ?? {};
  const counts = {
    board: totals.parts_active ?? 0,
    inventory: byStatus.IN_INVENTORY ?? 0,
    orders: totals.orders_open ?? 0,
  };
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
  const isDark = state.theme === 'dark';
  clear(dom.themeBtn).append(icon(isDark ? 'sun' : 'moon'), el('span', {}, isDark ? 'Thème beige' : 'Thème nuit'));
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
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyTheme();
  });

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
    if (VIEW_META[view] && view !== state.view) setView(view);
  });

  // keep the board fresh while the worker imports orders in the background
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.selection.size) refresh({ silent: true });
  }, 30000);
};

const boot = async () => {
  applyTheme();
  bindEvents();

  const [meta, colors] = await Promise.all([api.meta(), api.colors()]);
  state.meta = meta;
  state.colors = colors.items;
  state.colorIndex = new Map(colors.items.map((color) => [color.key, color]));

  const badge = document.getElementById('mode-badge');
  badge.classList.toggle('is-live', meta.mode === 'live');
  document.getElementById('mode-label').textContent = meta.mode === 'live' ? 'API live' : 'Mode démo (mock)';
  document.getElementById('cron-line').textContent = `sync ${meta.syncCron} · envois ${meta.shipmentCron}`;

  const initial = location.hash.replace('#', '');
  state.view = VIEW_META[initial] ? initial : 'board';

  await refresh();
};

boot();
