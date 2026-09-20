const PERSIST_KEY = 'rpq.prefs.v1';

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const prefs = loadPrefs();

export const state = {
  view: 'board',
  layout: prefs.layout ?? 'board',
  groupBy: prefs.groupBy ?? 'color',
  sort: prefs.sort ?? 'smart',
  theme: prefs.theme ?? 'dark',
  filters: {
    q: '',
    colors: new Set(),
    statuses: new Set(),
    source: '',
    priority: false,
  },
  meta: null,
  colors: [],
  colorIndex: new Map(),
  parts: [],
  summary: null,
  inventory: [],
  orders: [],
  runs: [],
  selection: new Set(),
  loading: false,
};

export const savePrefs = () => {
  const { layout, groupBy, sort, theme } = state;
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ layout, groupBy, sort, theme }));
};

export const queryParams = () => ({
  scope: state.filters.statuses.size ? undefined : 'board',
  status: [...state.filters.statuses],
  color: [...state.filters.colors],
  source: state.filters.source,
  q: state.filters.q,
  priority: state.filters.priority ? '1' : undefined,
  sort: state.sort,
  limit: 1000,
});

export const groupParts = (parts, groupBy) => {
  if (groupBy === 'none') return [{ key: 'all', label: null, items: parts }];

  const groups = new Map();
  for (const part of parts) {
    const key = groupBy === 'color' ? part.color_key : `order-${part.order_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: groupBy === 'color' ? part.color_name : `${part.order_number ?? part.order_id}`,
        hex: groupBy === 'color' ? part.color_hex : null,
        sort: groupBy === 'color' ? part.color_sort : part.order_id,
        items: [],
      });
    }
    groups.get(key).items.push(part);
  }
  return [...groups.values()].sort((a, b) => a.sort - b.sort || String(a.label).localeCompare(String(b.label)));
};

export const statusMeta = (key) => state.meta?.statuses.find((s) => s.key === key) ?? { key, labelFr: key, accent: '#8C8579', icon: 'inbox' };
