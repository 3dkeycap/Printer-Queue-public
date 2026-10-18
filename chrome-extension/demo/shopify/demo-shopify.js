/*
 * Fausse admin Shopify (pour tester l'extension sans toucher à la vraie boutique).
 *
 * Le chemin ressemble à celui de Shopify (…/orders/1001/…) : le vrai code de
 * l'extension (background.js, content.js, pack-panel.js) s'y exécute tel quel.
 * Comme l'admin Shopify, la navigation entre commandes est « une seule page » :
 * l'URL change d'abord, le titre et le numéro affichés suivent un instant plus
 * tard (c'est exactement le piège que l'extension doit gérer).
 */
(() => {
  const BASE = '/demo/shopify/orders/';
  const TITLE_DELAY_MS = 600;

  const SAMPLES = {
    1001: { number: '#1001', customer: 'Alex Démo', items: [['Ore Keycap', 'Gold', 1], ['Custom Keycap Set', 'Noir', 2]] },
    1002: { number: '#1002', customer: 'Sam Démo', items: [['Artisan Keycap', 'Diamond', 1]] },
    1003: { number: '#1003', customer: 'Robin Démo', items: [['Ore Keycap', 'Redstone', 3], ['Keycap Puller', '', 1]] },
  };

  // commandes saisies à la main (ID + numéro réels, pour essayer avec une vraie commande de l'app)
  const loadCustom = () => {
    try {
      return JSON.parse(sessionStorage.getItem('rpq.demo.custom') ?? '{}');
    } catch {
      return {};
    }
  };
  const saveCustom = (custom) => {
    try {
      sessionStorage.setItem('rpq.demo.custom', JSON.stringify(custom));
    } catch {
      /* stockage indisponible : la commande saisie ne survivra pas à un rechargement */
    }
  };
  const orders = () => ({ ...SAMPLES, ...Object.fromEntries(Object.entries(loadCustom()).map(([id, o]) => [id, { customer: 'Client réel', items: [], ...o }])) });

  const orderIdFromPath = () => /\/orders\/(\d+)(?:[/?#]|$)/.exec(location.pathname)?.[1] ?? null;

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'onclick' || key === 'onsubmit') node.addEventListener(key.slice(2), value);
      else if (value !== false && value !== null) node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
    return node;
  };

  const banner = () =>
    h('div', { class: 'demo-banner' },
      h('strong', {}, 'DÉMO'),
      'Fausse admin Shopify : rien ici n’est réel. ',
      h('a', { href: chrome.runtime.getURL('options.html') }, 'Réglages de l’extension'),
    );

  const header = () =>
    h('header', { class: 'top', style: 'background:#1a1c20' },
      h('span', { class: 'logo' }, '🛍 Boutique démo'),
      h('nav', {}, h('a', { href: `${BASE}index.html` }, 'Commandes')),
    );

  // navigation « une seule page » : URL tout de suite, titre et numéro un peu après
  const goTo = (id) => {
    history.pushState(null, '', `${BASE}${id}/index.html`);
    draw({ delayHeading: true });
  };

  const setHeading = (text) => {
    document.title = `${text} · Commandes · Boutique démo`;
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = text;
  };

  const drawList = () => {
    const rows = Object.entries(orders()).map(([id, order]) =>
      h('tr', {},
        h('td', {}, h('a', { href: `${BASE}${id}/index.html`, onclick: (e) => { e.preventDefault(); goTo(id); } }, order.number)),
        h('td', {}, order.customer),
        h('td', {}, h('span', { class: 'pill warn' }, 'À traiter')),
        h('td', { class: 'muted' }, `ID ${id}`),
      ),
    );
    const idInput = h('input', { name: 'id', inputmode: 'numeric', pattern: '\\d+', placeholder: '6012345678901', required: true });
    const numberInput = h('input', { name: 'number', placeholder: '#5429', required: true });
    const form = h('form', {
      class: 'inline',
      onsubmit: (event) => {
        event.preventDefault();
        const id = idInput.value.trim();
        const number = `#${numberInput.value.trim().replace(/^#/, '')}`;
        if (!/^\d+$/.test(id)) return;
        saveCustom({ ...loadCustom(), [id]: { number } });
        goTo(id);
      },
    }, h('label', {}, 'ID Shopify (dans l’URL)', idInput), h('label', {}, 'Numéro de commande', numberInput), h('button', {}, 'Ouvrir'));

    document.title = 'Commandes · Boutique démo';
    return [
      h('h1', {}, 'Commandes'),
      h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Commande'), h('th', {}, 'Client'), h('th', {}, 'Statut'), h('th', {}, ''))), h('tbody', {}, rows))),
      h('div', { class: 'card' },
        h('h2', {}, 'Essayer avec une vraie commande de l’app'),
        h('p', { class: 'muted' }, 'Saisis l’ID Shopify et le numéro d’une commande qui existe dans Resin Queue : la boîte « J’ai packé » et « Ouvert sur Shopify » marcheront avec ses vraies pièces. (Ne recharge pas la page après : elle n’existe que dans cet onglet.)'),
        form),
    ];
  };

  const drawOrder = (id, { delayHeading }) => {
    const order = orders()[id] ?? { number: `#${id}`, customer: 'Client démo', items: [] };
    const ids = Object.keys(SAMPLES);
    const index = ids.indexOf(id);
    const next = ids[(index + 1) % ids.length];
    const previous = ids[(index - 1 + ids.length) % ids.length];

    const content = [
      h('h1', {}, delayHeading ? (document.querySelector('h1')?.textContent ?? '') : order.number),
      h('div', { class: 'card' },
        h('h2', {}, 'Client'),
        h('div', {}, order.customer),
        h('div', { class: 'muted' }, 'client@exemple.demo')),
      h('div', { class: 'card' },
        h('h2', {}, 'Articles'),
        order.items.length
          ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Article'), h('th', {}, 'Variante'), h('th', {}, 'Qté'))),
              h('tbody', {}, order.items.map(([title, variant, qty]) => h('tr', {}, h('td', {}, title), h('td', {}, variant), h('td', {}, String(qty))))))
          : h('p', { class: 'muted' }, 'Commande saisie à la main : ses vraies pièces sont dans l’app.')),
      h('div', { class: 'card' },
        h('h2', {}, 'Navigation « une seule page » (comme Shopify)'),
        h('div', { class: 'row' },
          h('button', { class: 'ghost', onclick: () => goTo(previous) }, '← Commande précédente'),
          h('button', { class: 'ghost', onclick: () => goTo(next) }, 'Commande suivante →'),
          h('button', { class: 'ghost', onclick: () => { location.href = `${BASE}index.html`; } }, 'Toutes les commandes')),
        h('p', { class: 'muted' }, `L’URL change tout de suite, le numéro affiché suit ${TITLE_DELAY_MS} ms après : l’extension ne doit jamais envoyer l’ancienne commande.`)),
    ];
    if (delayHeading) setTimeout(() => orderIdFromPath() === id && setHeading(order.number), TITLE_DELAY_MS);
    else document.title = `${order.number} · Commandes · Boutique démo`;
    return content;
  };

  function draw({ delayHeading = false } = {}) {
    const id = orderIdFromPath();
    const content = id ? drawOrder(id, { delayHeading }) : drawList();
    document.getElementById('app').replaceChildren(banner(), header(), h('main', {}, content));
  }

  window.addEventListener('popstate', () => draw());
  draw();
})();
