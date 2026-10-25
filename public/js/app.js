import './bug-logs.js';
import { api } from './api.js';
import { mountBugButton } from './bug-report.js';
import { clear, el, icon, modal, swatch, toast } from './ui.js';
import {
  commentOptions,
  effectiveGroupBy,
  hasActiveFilters,
  isSimple,
  isKiosk,
  queryParams,
  STACK_MODES,
  savePrefs,
  stackModeOf,
  state,
  THEMES,
  statusMeta,
  themeMeta,
  usesStatusFilter,
  uvOptions,
} from './store.js';
import { renderBoard } from './views/board.js';
import { renderAll } from './views/all.js';
import { openSettingsTab, renderIntegrations } from './views/integrations.js';
import { renderFailures } from './views/failures.js';
import { questionsEditor, questionsForm, renderInventory, unitsList } from './views/inventory.js';
import { photoField } from './photo.js';
import { closeDrawer, openDrawer } from './drawer.js';
import { startTutorial, tutorialSeen } from './tutorial.js';
import { mountFullscreen } from './fullscreen.js';

const NEXT_STATUS = {
  TO_PRINT: 'PRINTING',
  PRINTING: 'DONE',
  FAILED: 'TO_PRINT',
  DONE: 'SHIPPED',
  SHIPPED: null,
};

const VIEW_META = {
  board: { title: 'Resin Queue', subtitle: 'Chaque carte = une pièce physique à imprimer.' },
  all: { title: 'Tout', subtitle: 'Toutes les pièces, tous statuts confondus.' },
  failures: { title: 'Échecs', subtitle: 'Chaque impression ratée est gardée ici, avec le taux d’échec par fichier.' },
  inventory: { title: 'Inventaire', subtitle: 'Un objet = une carte avec un code QR : on le scanne quand il faut en racheter.' },
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

/* ------------------------------------------------- annuler (Ctrl+Z) ------- */

// Les dernières actions de cette session (déplacements de pièces, modifications) ;
// elles ne survivent pas à un rechargement de la page.
const UNDO_MAX = 30;
const undoStack = [];

const updateUndoButton = () => {
  const button = document.getElementById('undo-btn');
  if (!button) return;
  const last = undoStack.at(-1);
  button.disabled = !last;
  button.title = last ? `Annuler : ${last.label} (Ctrl+Z)` : 'Rien à annuler';
};

const pushUndo = (entry) => {
  undoStack.push(entry);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  updateUndoButton();
};

const actions = {
  api, // les vues s'en servent pour de petits appels directs (inventaire)
  nextStatus: (status) => NEXT_STATUS[status] ?? null,

  /** Défait la dernière action (déplacement de pièces ou modification), puis la précédente… */
  async undo() {
    const entry = undoStack.pop();
    updateUndoButton();
    if (!entry) return toast('Rien à annuler');
    try {
      if (entry.kind === 'move') {
        if (entry.to === 'FAILED') {
          // l'échec disparaît aussi de la page « Échecs »
          for (const item of entry.items) await api.undoFailure(item.id);
        } else {
          const byStatus = new Map();
          for (const item of entry.items) byStatus.set(item.status, [...(byStatus.get(item.status) ?? []), item.id]);
          for (const [status, ids] of byStatus) await api.bulkStatus(ids, status, { force: true });
        }
      } else {
        await api.patchPart(entry.id, entry.previous);
      }
      toast(`Annulé : ${entry.label}`);
      await refresh({ silent: true });
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  async move(ids, status, options = {}) {
    // optimiste : on repeint tout de suite, on réconcilie ensuite
    const snapshot = state.parts.map((part) => ({ ...part }));
    const before = snapshot.filter((part) => ids.includes(part.id)).map((part) => ({ id: part.id, status: part.status }));
    // un échec retourne directement dans « À imprimer » (et est consigné dans « Échecs »)
    const shownStatus = status === 'FAILED' ? 'TO_PRINT' : status;
    for (const part of state.parts) {
      if (ids.includes(part.id)) part.status = shownStatus;
    }
    render();

    try {
      let done = ids;
      if (ids.length === 1) await api.setStatus(ids[0], status, options);
      else {
        const result = await api.bulkStatus(ids, status, options);
        if (result.errors?.length) toast(`${result.errors.length} transition(s) refusée(s)`, 'err');
        done = (result.updated ?? []).map((part) => part.id);
      }
      const items = before.filter((item) => done.includes(item.id) && item.status !== status);
      if (items.length) {
        pushUndo({
          kind: 'move',
          to: status,
          items,
          label: status === 'FAILED' ? `${items.length} échec(s)` : `${items.length} pièce(s) → ${statusMeta(status).labelFr}`,
        });
      }
      toast(
        status === 'FAILED'
          ? `${ids.length} échec(s) enregistré(s) : remis dans « À imprimer »`
          : `${ids.length} pièce(s) → ${statusMeta(status).labelFr}`,
      );
      state.selection.clear();
      await refresh({ silent: true });
    } catch (error) {
      state.parts = snapshot;
      render();
      toast(error.message, 'err');
    }
  },

  async patchPart(id, patch, { silent = false } = {}) {
    // valeurs d'avant, pour pouvoir annuler (seulement les champs que la liste connaît)
    const known = state.parts.find((part) => part.id === id);
    const previous = {};
    if (known) for (const key of Object.keys(patch)) if (key in known) previous[key] = known[key] ?? null;
    try {
      await api.patchPart(id, patch);
      if (Object.keys(previous).length) pushUndo({ kind: 'patch', id, previous, label: 'modification de la pièce' });
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

  /* ---- inventaire ---- */
  async inventoryAction(id, run, message) {
    try {
      await run();
      toast(message);
      await refresh({ silent: true });
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  /** « À racheter » depuis le tableau de bord : avec des questions, on demande ce qui manque (comme au scan). */
  async flagInventoryItem(item) {
    if (!item.questions?.length) {
      await actions.inventoryAction(item.id, () => api.flagInventoryItem(item.id), `« ${item.name} » : à racheter`);
      return;
    }
    const form = questionsForm(item.questions);
    await modal({
      title: `Qu’est-ce qui manque ? — ${item.name}`,
      body: form.node,
      confirmLabel: 'Signaler',
      onConfirm: async () => {
        try {
          await api.flagInventoryItem(item.id, form.answers());
          toast(`« ${item.name} » : à racheter`);
          await refresh({ silent: true });
          return true;
        } catch (error) {
          toast(error.message, 'err');
          return false;
        }
      },
    });
  },

  async editInventoryItem(item) {
    const name = el('input', { value: item.name });
    const threshold = el('input', { type: 'number', min: '0', value: String(item.reorder_at) });
    const notes = el('input', { value: item.notes ?? '', placeholder: 'Ex. étagère du haut, marque, lien…' });
    const questions = questionsEditor(item.questions ?? []);
    const unit = el('input', { value: item.unit ?? '', maxlength: '20', list: 'inv-units', placeholder: 'rouleaux, bac…' });
    const supplier = el('input', { value: item.supplier ?? '', maxlength: '80', placeholder: 'Ex. Sticker Mule' });
    const orderQty = el('input', { type: 'number', min: '0', inputmode: 'numeric', value: item.order_qty ?? '', placeholder: 'Ex. 4200' });
    const photo = photoField({ current: item.has_image ? `/api/inventory/${item.id}/image?v=${Date.now()}` : null });
    await modal({
      title: 'Modifier l’objet',
      body: el('div', {}, [
        el('div', { class: 'field' }, [el('label', {}, 'Nom'), name]),
        el('div', { class: 'field' }, [el('label', {}, 'Scanner quand il en reste'), threshold]),
        el('div', { class: 'field' }, [el('label', {}, 'Unité (rouleaux, bac…)'), unit, unitsList()]),
        el('div', { class: 'field' }, [el('label', {}, 'Note (facultatif)'), notes]),
        el('div', { class: 'field' }, [el('label', {}, 'Commander chez (grande étiquette)'), supplier]),
        el('div', { class: 'field' }, [el('label', {}, 'Quantité à commander (grande étiquette)'), orderQty]),
        el('div', { class: 'field' }, [el('label', {}, 'Photo (grande étiquette)'), photo.node]),
        el('div', { class: 'field' }, [el('label', {}, 'Questions posées au scan'), questions.node]),
      ]),
      confirmLabel: 'Enregistrer',
      onConfirm: async () => {
        try {
          await api.patchInventoryItem(item.id, { name: name.value, reorder_at: threshold.value, notes: notes.value, unit: unit.value, order_qty: orderQty.value, supplier: supplier.value, ...(photo.value() === undefined ? {} : { image: photo.value() }), questions: questions.value() });
          toast('Objet modifié');
          await refresh({ silent: true });
          return true;
        } catch (error) {
          toast(error.message, 'err');
          return false;
        }
      },
    });
  },

  async deleteInventoryItem(item) {
    const confirmed = await modal({
      title: 'Supprimer cet objet ?',
      body: el('p', {}, `« ${item.name} » disparaît de l’inventaire. Sa carte imprimée ne fonctionnera plus (le code QR affichera « carte inconnue »).`),
      confirmLabel: 'Supprimer',
      onConfirm: () => true,
    });
    if (!confirmed) return;
    await actions.inventoryAction(item.id, () => api.deleteInventoryItem(item.id), `« ${item.name} » supprimé`);
  },

  async hideFailureFile(name, hidden) {
    try {
      await api.hideFailureFile(name, hidden);
      if (hidden && state.failureFile === name) state.failureFile = '';
      toast(hidden ? `« ${name} » masqué de la liste (ses échecs restent gardés)` : `« ${name} » de nouveau affiché`);
      await refresh({ silent: true });
    } catch (error) {
      toast(error.message, 'err');
    }
  },

  toggleHiddenFailures() {
    state.showHiddenFailures = !state.showHiddenFailures;
    render();
  },

  selectFailureFile(name) {
    state.failureFile = state.failureFile === name ? '' : name;
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
      return true;
    } catch (error) {
      toast(error.message, 'err');
      return false;
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

  /** Nouveau commentaire libre : ajouté à la pièce seulement (pas à la liste prédéfinie). Renvoie la nouvelle liste. */
  async addCustomComment(partId, current = []) {
    const input = el('input', { placeholder: 'Attente client, pièce cassée…' });

    return modal({
      title: 'Ajouter un commentaire',
      body: el('div', { class: 'field' }, [el('label', {}, 'Commentaire'), input]),
      confirmLabel: 'Ajouter',
      onConfirm: async () => {
        const value = input.value.trim();
        if (!value) return toast('Le commentaire est obligatoire', 'err');
        try {
          const list = [...current.filter((item) => item !== value), value];
          await actions.patchPart(partId, { comment: list }, { silent: true });
          toast('Commentaire ajouté');
          render();
          return list;
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
        el('p', { class: 'cell-sub' }, "Coche les couleurs qu'on n'imprime pas ici (ex. Nylon, fait dans une autre usine). Elles disparaissent de « Resin Queue » ; « Tout » les montre toujours."),
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
          el('p', {}, `${preview.removed} pièce(s) seront retirées de « Resin Queue » (elles restent dans « Tout », pour l'expédition) :`),
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

  /** « Regrouper » : par commande → une par une → identiques → par commande… */
  cycleStack(status) {
    const next = STACK_MODES[(STACK_MODES.indexOf(stackModeOf(status)) + 1) % STACK_MODES.length];
    state.stackMode[status] = next;
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
      el('option', { value: '' }, 'Aucun tag'),
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
        el('div', { class: 'field adv' }, [el('label', {}, 'Poste UV'), uv]),
        el('div', { class: 'field' }, [el('label', {}, 'Tag'), comment]),
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
  if (state.view === 'integrations' || state.view === 'failures' || state.view === 'inventory') {
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
    ? state.meta.statuses.filter((status) => status.key !== 'FAILED').map((status) =>
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
      ...(isSimple() ? [] : [['uv', 'Grouper par UV']]),
      ['order', 'Grouper par commande'],
      ['none', 'Aucun regroupement'],
    ].map(([value, label]) => el('option', { value, selected: effectiveGroupBy() === value }, label)),
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
      class: 'select adv',
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

  const lateChip = chip('En retard', state.filters.late, () => {
    state.filters.late = !state.filters.late;
    refresh();
  }, [icon('alert')], facets.late ?? 0);

  const rushChip = chip('Rush', state.filters.priority, () => {
    state.filters.priority = !state.filters.priority;
    refresh();
  }, [icon('bolt')], facets.rush ?? 0);
  rushChip.classList.add('adv');

  const hiddenKeys = state.meta?.hiddenColors ?? [];
  const hiddenChip =
    state.view === 'board' && !isKiosk
      ? chip('Couleurs masquées', hiddenKeys.length > 0, () => actions.editHiddenColors(), [icon('close')], hiddenKeys.length || null)
      : null;
  hiddenChip?.classList.add('adv');

  const resetChip = hasActiveFilters()
    ? chip('Réinitialiser', false, () => {
        state.filters.colors.clear();
        state.filters.statuses.clear();
        state.filters.source = '';
        state.filters.priority = false;
        state.filters.late = false;
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
      el('div', { class: 'toolbar-group' }, [hiddenChip, lateChip, rushChip, resetChip, sourceSelect, groupSelect, sortSelect].filter(Boolean)),
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
          const value = await pickFromList('Tag', commentOptions());
          if (value !== null) {
            // ajouté aux commentaires existants ; « — vider — » les retire tous
            for (const id of ids) {
              const part = state.parts.find((item) => item.id === id);
              const existing = String(part?.comment ?? '').split('\n').filter(Boolean);
              await api.patchPart(id, { comment: value ? [...existing, value] : null });
            }
            state.selection.clear();
            await refresh();
            toast('Tag ajouté');
          }
        },
      },
      [icon('note'), 'Tag'],
    ),
    el(
      'button',
      {
        class: 'chip adv',
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

  // le rafraîchissement automatique (extension, synchro…) redessine la vue :
  // on garde la position de défilement au lieu de remonter en haut de la liste
  const scroll = captureScroll();
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
  else if (state.view === 'failures') renderFailures(root, actions);
  else if (state.view === 'inventory') renderInventory(root, actions);
  else renderIntegrations(root, actions);
  restoreScroll(scroll);
};

/** Positions de défilement : page, tableau horizontal, chaque colonne, tableau « Tout ». */
const captureScroll = () => ({
  view: state.view,
  page: [window.scrollX, window.scrollY],
  main: document.querySelector('.main')?.scrollTop ?? 0,
  board: document.querySelector('.board')?.scrollLeft ?? 0,
  columns: Object.fromEntries(
    [...document.querySelectorAll('.column')].map((column) => [column.dataset.status, column.querySelector('.column-body')?.scrollTop ?? 0]),
  ),
  table: [document.querySelector('.table-wrap')?.scrollLeft ?? 0, document.querySelector('.table-wrap')?.scrollTop ?? 0],
});

const restoreScroll = (saved) => {
  if (!saved || saved.view !== state.view) return;
  const board = document.querySelector('.board');
  if (board) board.scrollLeft = saved.board;
  for (const column of document.querySelectorAll('.column')) {
    const body = column.querySelector('.column-body');
    if (body && saved.columns[column.dataset.status] !== undefined) body.scrollTop = saved.columns[column.dataset.status];
  }
  const table = document.querySelector('.table-wrap');
  if (table) [table.scrollLeft, table.scrollTop] = saved.table;
  const main = document.querySelector('.main');
  if (main) main.scrollTop = saved.main;
  window.scrollTo(saved.page[0], saved.page[1]);
};

/* ----------------------------------------------------------------- data -- */

// numéro de la dernière requête : une réponse plus ancienne (clic rapide sur
// plusieurs puces, rafraîchissement automatique) ne doit pas écraser la plus récente
let refreshSeq = 0;

/*
 * Le rafraîchissement automatique redessine toute la vue : il ne doit jamais effacer ce que la
 * personne est en train de faire (texte tapé et pas encore envoyé, fenêtre ouverte, liste ouverte).
 */
const isEditing = () => {
  if (document.querySelector('dialog[open]')) return true;
  const active = document.activeElement;
  if (active && dom.view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
  return [...dom.view.querySelectorAll('textarea, input:not([type]), input[type=text], input[type=search]')].some((node) => node.value.trim() !== '');
};

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
    } else if (state.view === 'inventory') {
      const [summary, inventory] = await Promise.all([api.summary(), api.inventory()]);
      if (seq !== refreshSeq) return;
      state.summary = summary;
      state.inventory = inventory.items;
    } else if (state.view === 'failures') {
      const [summary, failures] = await Promise.all([api.summary(), api.failures()]);
      if (seq !== refreshSeq) return;
      state.summary = summary;
      state.failures = failures;
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
  const counts = { board: totals.parts_active ?? 0, all: totals.parts_total ?? 0, failures: totals.failures_total ?? 0, inventory: totals.reorder_count ?? 0 };
  document.querySelectorAll('.nav-count').forEach((node) => {
    const value = counts[node.dataset.count];
    node.textContent = value ? String(value) : '';
  });
};

/**
 * Vue demandée par l'adresse. « #bug » (bouton Bug de l'extension) ouvre la fenêtre pour signaler un
 * bug (la coccinelle) ; « #bugs » ouvre la liste des bugs signalés (Réglages → Mises à jour).
 */
const viewFromHash = () => {
  const hash = location.hash.replace('#', '');
  if (hash === 'bugs') {
    openSettingsTab('maj');
    return 'integrations';
  }
  if (hash === 'bug') return 'board';
  return hash;
};

/** Ouvre la fenêtre « signaler un bug » si l'adresse le demande, puis revient à la vue normale. */
const openBugFromHash = () => {
  if (location.hash !== '#bug') return;
  history.replaceState(null, '', `${location.pathname}#board`);
  document.getElementById('bug-button')?.click();
};

const setView = (view) => {
  state.view = view;
  state.selection.clear();
  location.hash = view;
  refresh();
};

/* ------------------------------------------------------------- bootstrap - */

/** Mode simple / avancé : classe sur <html>, les éléments « adv » sont cachés en simple. */
const applyMode = () => {
  document.documentElement.classList.toggle('mode-simple', isSimple());
  for (const button of document.querySelectorAll('#mode-toggle button')) {
    button.classList.toggle('is-on', button.dataset.mode === state.mode);
  }
};

const applyTheme = () => {
  document.documentElement.dataset.theme = state.theme;
  const kioskTheme = document.getElementById('kiosk-theme');
  if (kioskTheme) kioskTheme.value = state.theme;
  const next = THEMES[(THEMES.findIndex((theme) => theme.key === state.theme) + 1) % THEMES.length];
  clear(dom.themeBtn).append(icon('sun'), el('span', {}, `Thème : ${themeMeta(state.theme).label}`));
  dom.themeBtn.title = `Changer de thème (suivant : ${next.label})`;
};

const setTheme = (key) => {
  state.theme = key;
  savePrefs();
  applyTheme();
};

/** « il y a 3 min » : court, lisible d'un coup d'œil au pied du menu. */
const ago = (iso) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
};

/** Dernière synchro terminée (toutes sources) : « Dernière synchro il y a 3 min ✓ ». */
const syncLine = () => {
  const last = (state.summary?.lastSyncs ?? [])
    .filter((run) => run.status !== 'running')
    .sort((a, b) => String(b.finished_at ?? b.started_at).localeCompare(String(a.finished_at ?? a.started_at)))[0];
  if (!last) return 'Pas encore de synchro';
  const when = ago(last.finished_at ?? last.started_at);
  return last.status === 'error' ? `Dernière synchro ${when} ⚠ erreur` : `Dernière synchro ${when} ✓`;
};

const updateConnectorBadge = () => {
  const connectors = state.meta?.connectors ?? {};
  const ready = Object.values(connectors).filter((connector) => connector.configured).length;
  const total = Object.keys(connectors).length;
  const badge = document.getElementById('mode-badge');
  badge.classList.toggle('is-live', ready === total && total > 0);
  document.getElementById('mode-label').textContent =
    total === 0 ? '—' : ready === total ? 'Connecteurs actifs' : `${ready}/${total} connecteur(s)`;
  const line = document.getElementById('cron-line');
  line.textContent = syncLine();
  line.title = `Synchro automatique : ${state.meta?.syncCron ?? '—'}${state.meta?.build ? ` · version ${state.meta.build}` : ''}`;
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

  document.getElementById('mode-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button || button.dataset.mode === state.mode) return;
    state.mode = button.dataset.mode;
    // en simple, le filtre Rush et la provenance (cachés) ne doivent plus filtrer en douce
    if (isSimple()) {
      state.filters.priority = false;
      state.filters.source = '';
    }
    savePrefs();
    applyMode();
    if (isSimple() && state.view !== 'board') setView('board');
    else refresh();
  });

  dom.themeBtn.addEventListener('click', () => {
    setTheme(THEMES[(THEMES.findIndex((theme) => theme.key === state.theme) + 1) % THEMES.length].key);
  });
  document.getElementById('tutorial-btn').addEventListener('click', () => startTutorial());

  document.getElementById('undo-btn')?.addEventListener('click', () => actions.undo());
  document.addEventListener('keydown', (event) => {
    // Ctrl/Cmd+Z : annuler la dernière action (sauf dans un champ de saisie, qui garde son propre « annuler »)
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      actions.undo();
      return;
    }
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
    const view = viewFromHash();
    // mode simple : seulement « Resin Queue » (pas de « Tout » ni de Réglages), sauf le lien direct vers les bugs
    if (isSimple() && view !== 'board' && location.hash !== '#bugs') {
      location.hash = 'board';
      return;
    }
    openBugFromHash();
    if (!isKiosk && VIEW_META[view] && view !== state.view) setView(view);
  });

  // « ouvert sur Shopify » change vite : on suit plus souvent que le reste
  let presenceKey = '';
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || state.view === 'integrations' || isEditing()) return;
    try {
      const { items } = await api.presence();
      const key = JSON.stringify(items);
      if (key === presenceKey) return;
      presenceKey = key;
      state.presence = items;
      if (!state.selection.size && !isEditing()) render();
    } catch {
      /* hors ligne : on réessaie au prochain tour */
    }
  }, 8000);

  // le worker importe en arrière-plan : on rafraîchit sans déranger l'opérateur
  setInterval(() => {
    if (document.visibilityState === 'visible' && !state.selection.size && state.view !== 'integrations' && !isEditing()) {
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
  applyMode();
  mountBugButton();
  if (isKiosk) {
    document.documentElement.classList.add('kiosk');
    location.hash = 'board';
    mountFullscreen(document.getElementById('fullscreen-btn'));
    // sélecteur de thème en haut du kiosque (le menu latéral, qui le porte ailleurs, y est caché)
    const themeSelect = document.getElementById('kiosk-theme');
    themeSelect.replaceChildren(...THEMES.map((theme) => el('option', { value: theme.key }, `Thème : ${theme.label}`)));
    themeSelect.addEventListener('change', () => setTheme(themeSelect.value));
  }
  applyTheme();
  bindEvents();
  consumeOAuthRedirect();

  const [meta, colors] = await Promise.all([api.meta(), api.colors()]);
  state.meta = meta;
  state.colors = colors.items;
  updateConnectorBadge();

  const initial = viewFromHash();
  const bugsLink = location.hash === '#bugs';
  state.view = !isKiosk && (!isSimple() || bugsLink) && VIEW_META[initial] ? initial : 'board';

  await refresh();
  openBugFromHash();

  // première visite sur cet appareil : la visite guidée démarre toute seule (une seule fois)
  if (state.view === 'board' && !tutorialSeen()) setTimeout(startTutorial, 900);
};

boot();
