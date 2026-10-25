import { el, icon, toast } from '../ui.js';

/* ==========================================================================
   Onglet « API » des réglages : des recettes prêtes à copier (curl, Windows,
   n8n). Aucun jeton : l’API est ouverte sur le réseau local. Si un mot de
   passe est réglé sur l’app (DASHBOARD_PASSWORD), les exemples le disent.
   ========================================================================== */

/** method, path, body (objet JSON ou null), résumé. */
const RECIPES = [
  { title: 'Lister les pièces à imprimer', method: 'GET', path: '/api/parts?status=TO_PRINT&scope=board', body: null,
    hint: 'Filtres : status, color, uv, source, q, priority, limit.' },
  { title: 'Changer le statut d’une pièce', method: 'POST', path: '/api/parts/12/status', body: { status: 'DONE' },
    hint: 'Remplace 12 par l’id de la pièce. Statuts : TO_PRINT, PRINTING, DONE, SHIPPED (FAILED = échec, la pièce revient à imprimer).' },
  { title: 'Changer le statut de plusieurs pièces', method: 'POST', path: '/api/parts/bulk/status', body: { ids: [12, 13, 14], status: 'PRINTING' },
    hint: 'Une seule requête pour tout un lot.' },
  { title: 'Lister les commandes', method: 'GET', path: '/api/orders', body: null,
    hint: 'Une commande avec ses pièces : GET /api/orders/ID.' },
  { title: 'Marquer une commande expédiée', method: 'POST', path: '/api/orders/5/ship', body: { tracking_number: 'ABC123' },
    hint: 'Le numéro de suivi est facultatif.' },
  { title: 'Chiffres du tableau de bord', method: 'GET', path: '/api/stats/summary', body: null,
    hint: 'Pièces par statut, par couleur, par source.' },
  { title: 'Lancer une synchronisation', method: 'POST', path: '/api/sync/run?source=all', body: null,
    hint: 'source : all, shopify ou etsy.' },
];

const FORMATS = [
  ['curl', 'curl'],
  ['windows', 'Windows (PowerShell)'],
  ['n8n', 'n8n'],
];

const snippet = (format, recipe, base) => {
  const url = `${base}${recipe.path}`;
  const json = recipe.body ? JSON.stringify(recipe.body) : null;
  if (format === 'curl') {
    const parts = [`curl${recipe.method === 'GET' ? '' : ` -X ${recipe.method}`} "${url}"`];
    if (json) parts.push(`  -H "Content-Type: application/json"`, `  -d '${json}'`);
    return parts.join(' \\\n');
  }
  if (format === 'windows') {
    const lines = [`Invoke-RestMethod -Method ${recipe.method} -Uri "${url}"`];
    if (json) lines[0] += ' `';
    if (json) lines.push(`  -ContentType "application/json" \``, `  -Body '${json}'`);
    return lines.join('\n');
  }
  // n8n : un nœud « HTTP Request » à coller directement dans le canvas (Ctrl+V)
  const parameters = { method: recipe.method, url, options: {} };
  if (json) Object.assign(parameters, { sendBody: true, specifyBody: 'json', jsonBody: json });
  return JSON.stringify(
    { nodes: [{ parameters, name: recipe.title, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0] }], connections: {} },
    null,
    2,
  );
};

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié');
  } catch {
    toast('Copie impossible : sélectionne le texte à la main', 'err');
  }
};

const recipeCard = (recipe, base, getFormat) => {
  const code = el('pre', { class: 'api-code' });
  const render = () => {
    code.textContent = snippet(getFormat(), recipe, base);
  };
  render();
  const copy = el('button', { class: 'ghost-btn', type: 'button', onclick: () => copyText(code.textContent) }, [icon('note'), 'Copier']);
  const card = el('div', { class: 'api-recipe' }, [
    el('div', { class: 'api-recipe-head' }, [
      el('span', { class: `api-method m-${recipe.method.toLowerCase()}` }, recipe.method),
      el('strong', {}, recipe.title),
      copy,
    ]),
    el('p', { class: 'field-hint' }, recipe.hint),
    code,
  ]);
  card.rerender = render;
  return card;
};

/** Contenu de l’onglet : une carte « Utilisation » + une carte de recettes. */
export const apiTab = (section) => {
  const base = window.location.origin;
  let format = 'curl';
  const cards = [];
  const switcher = el(
    'div',
    { class: 'api-formats', role: 'tablist' },
    FORMATS.map(([key, label]) =>
      el(
        'button',
        {
          type: 'button',
          class: `api-format${key === format ? ' active' : ''}`,
          onclick: (event) => {
            format = key;
            for (const button of switcher.children) button.classList.toggle('active', button === event.currentTarget);
            for (const card of cards) card.rerender();
          },
        },
        label,
      ),
    ),
  );
  for (const recipe of RECIPES) cards.push(recipeCard(recipe, base, () => format));

  return [
    section(
      'API de l’app',
      'Aucun jeton à créer : l’API répond à toute machine du réseau local. Les réponses sont en JSON.',
      [
        el('p', { class: 'field-hint' }, [
          'Adresse de base : ',
          el('code', {}, base),
          '. Si un mot de passe protège l’app, ajoute-le aux exemples (curl : ',
          el('code', {}, '-u utilisateur:motdepasse'),
          ' ; PowerShell : ',
          el('code', {}, '-Credential (Get-Credential)'),
          ' ; n8n : authentification « Basic Auth » du nœud).',
        ]),
        el('p', { class: 'field-hint' }, [
          'Dans n8n, copie l’exemple puis colle-le (Ctrl+V) dans ton workflow : le nœud « HTTP Request » apparaît tout configuré. ',
          'Si n8n tourne dans Docker, remplace l’adresse par celle que le conteneur peut joindre (pas ',
          el('code', {}, 'localhost'),
          ').',
        ]),
      ],
    ),
    section('Exemples', 'Choisis le format, puis copie.', [switcher, ...cards]),
  ];
};
