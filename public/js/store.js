const PERSIST_KEY = 'rpq.prefs.v2';

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const prefs = loadPrefs();

export const state = {
  view: 'board',              // board | all | integrations
  groupBy: prefs.groupBy ?? 'color',
  sort: prefs.sort ?? 'smart',
  theme: prefs.theme ?? 'dark',
  filters: {
    q: '',
    colors: new Set(),
    statuses: new Set(),
    uv: new Set(),
    source: '',
    priority: false,
  },
  meta: null,
  facets: null,       // compteurs des puces de filtre (/api/parts/facets)
  colors: [],
  parts: [],
  summary: null,
  runs: [],
  settings: [],
  connectors: {},
  updateStatus: null, // service de mise à jour (Intégrations > Mises à jour)
  selection: new Set(),
  focusedColumn: null, // clé de statut affichée seule, en grille, pour une vue d'ensemble
  loading: false,
};

export const savePrefs = () => {
  const { groupBy, sort, theme } = state;
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ groupBy, sort, theme }));
};

/** Valeur de filtre UV pour « aucun poste UV » (comprise par l'API). */
export const NO_UV = '__none__';

/**
 * Le tableau « À imprimer » ne montre que la production en cours : le filtre
 * de statut n'existe que dans la vue « Tout », sinon un statut coché là-bas
 * (Expédié…) vidait le tableau sans aucune puce visible pour le retirer.
 */
export const usesStatusFilter = () => state.view === 'all';

export const hasActiveFilters = () =>
  Boolean(
    state.filters.colors.size ||
      state.filters.uv.size ||
      (usesStatusFilter() && state.filters.statuses.size) ||
      state.filters.source ||
      state.filters.priority ||
      state.filters.q,
  );

export const queryParams = () => ({
  scope: state.view === 'board' ? 'board' : undefined,
  status: usesStatusFilter() ? [...state.filters.statuses] : [],
  color: [...state.filters.colors],
  uv: [...state.filters.uv],
  source: state.filters.source,
  q: state.filters.q,
  priority: state.filters.priority ? '1' : undefined,
  sort: state.sort,
  limit: 1500,
});

export const groupParts = (parts, groupBy) => {
  if (groupBy === 'none') return [{ key: 'all', label: null, items: parts }];

  const groups = new Map();
  for (const part of parts) {
    let key;
    let label;
    let hex = null;
    let sort;
    if (groupBy === 'color') {
      key = part.color_key;
      label = part.color_name;
      hex = part.color_hex;
      sort = part.color_sort ?? 999;
    } else if (groupBy === 'uv') {
      key = part.uv || '—';
      label = part.uv ? `UV ${part.uv}` : 'UV non défini';
      sort = part.uv ? 0 : 1;
    } else {
      key = `order-${part.order_id}`;
      label = `${part.order_number ?? part.order_id}`;
      sort = part.order_id;
    }
    if (!groups.has(key)) groups.set(key, { key, label, hex, sort, items: [] });
    groups.get(key).items.push(part);
  }
  return [...groups.values()].sort(
    (a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label)),
  );
};

export const statusMeta = (key) =>
  state.meta?.statuses.find((s) => s.key === key) ?? { key, labelFr: key, accent: '#8C8579', icon: 'inbox' };

export const uvOptions = () => state.meta?.uvOptions ?? [];
export const commentOptions = () => state.meta?.commentOptions ?? [];
export const printerOptions = () => state.meta?.printerOptions ?? [];
