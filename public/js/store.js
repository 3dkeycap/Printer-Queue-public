const PERSIST_KEY = 'rpq.prefs.v2';

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}');
  } catch {
    return {};
  }
};

const prefs = loadPrefs();

/** Les 5 thèmes. `colors` = fond + accent, pour les pastilles d'aperçu. */
export const THEMES = [
  { key: 'dark', label: 'Nuit', colors: ['#0e0d0b', '#d9c7a3'] },
  { key: 'light', label: 'Beige', colors: ['#e9e1d1', '#1d1a14'] },
  { key: 'blue', label: 'Blanc & bleu', colors: ['#eef3fb', '#1f5fd6'] },
  { key: 'forest', label: 'Forêt', colors: ['#0c1410', '#6fcf8f'] },
  { key: 'lavender', label: 'Lavande', colors: ['#f1edf9', '#6d3fd1'] },
];
export const themeMeta = (key) => THEMES.find((theme) => theme.key === key) ?? THEMES[0];

export const state = {
  view: 'board',              // board | all | integrations
  groupBy: prefs.groupBy ?? 'color',
  sort: prefs.sort ?? 'smart',
  theme: THEMES.some((theme) => theme.key === prefs.theme) ? prefs.theme : 'dark',
  stacked: new Set(prefs.stacked ?? []), // colonnes où les pièces identiques sont regroupées
  filters: {
    q: '',
    colors: new Set(),
    statuses: new Set(),
    source: '',
    priority: false,
    late: false,
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
  presence: [],       // commandes ouvertes sur Shopify (extension Chrome)
  loading: false,
};

export const savePrefs = () => {
  const { groupBy, sort, theme } = state;
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ groupBy, sort, theme, stacked: [...state.stacked] }));
};

/** Mode kiosque (iPad d'atelier) : /kiosk, rien que le tableau « À imprimer ». */
export const isKiosk = location.pathname.replace(/\/+$/, '') === '/kiosk';

/**
 * Le tableau « À imprimer » ne montre que la production en cours : le filtre
 * de statut n'existe que dans la vue « Tout », sinon un statut coché là-bas
 * (Expédié…) vidait le tableau sans aucune puce visible pour le retirer.
 */
export const usesStatusFilter = () => state.view === 'all';

export const hasActiveFilters = () =>
  Boolean(
    state.filters.colors.size ||
      (usesStatusFilter() && state.filters.statuses.size) ||
      state.filters.source ||
      state.filters.priority ||
      state.filters.late ||
      state.filters.q,
  );

export const queryParams = () => ({
  scope: state.view === 'board' ? 'board' : undefined,
  status: usesStatusFilter() ? [...state.filters.statuses] : [],
  color: [...state.filters.colors],
  source: state.filters.source,
  q: state.filters.q,
  priority: state.filters.priority ? '1' : undefined,
  late: state.filters.late ? '1' : undefined,
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

/** Âge de la commande en jours et niveau (ok / warn / late) selon les seuils des Réglages. */
export const orderAge = (part) => {
  const placed = new Date(part.placed_at ?? part.created_at ?? Date.now()).getTime();
  const days = Math.max(0, Math.floor((Date.now() - placed) / 86400000));
  const warn = Number(state.meta?.lateWarnDays) || 3;
  const late = Number(state.meta?.lateDays) || 7;
  return { days, level: days >= late ? 'late' : days >= warn ? 'warn' : 'ok' };
};

/** Commande ouverte sur Shopify en ce moment (extension Chrome), ou null. */
export const presenceFor = (orderId) => state.presence.find((entry) => entry.orderId === orderId) ?? null;

/**
 * Ouvre la page d'expédition Chit Chats et copie le numéro de commande :
 * si la page ne le pré-remplit pas, il n'y a plus qu'à le coller.
 */
export const openChitChats = async (entry) => {
  try {
    await navigator.clipboard.writeText(String(entry.orderNumber ?? '').replace(/^#/, ''));
  } catch {
    /* presse-papiers indisponible (http) : on ouvre quand même */
  }
  window.open(entry.chitchatsUrl, '_blank', 'noopener');
};

export const uvOptions = () => state.meta?.uvOptions ?? [];
export const commentOptions = () => state.meta?.commentOptions ?? [];
export const printerOptions = () => state.meta?.printerOptions ?? [];
