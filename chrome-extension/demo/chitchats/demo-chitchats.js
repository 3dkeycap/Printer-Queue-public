/*
 * Fausse page de recherche d'expéditions Chit Chats (pour tester l'extension
 * sans toucher au vrai compte). L'adresse reçoit la commande cherchée dans
 * « ?q= », comme la vraie page : le bouton « Ouvrir sur Chit Chats » et le
 * lien live (onglet Shopify → onglet Chit Chats) arrivent ici.
 */
(() => {
  const query = new URLSearchParams(location.search).get('q') ?? '';

  const h = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value !== false && value !== null) node.setAttribute(key, value === true ? '' : value);
    }
    node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
    return node;
  };

  const shipments = query
    ? [{ id: `CC-${query.replace(/\W/g, '')}`, order: query, to: 'Client démo, Montréal QC', status: 'Prête à acheter', postage: 'Lettre 100 g — 9,45 $' }]
    : [];

  const results = shipments.length
    ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Envoi'), h('th', {}, 'Commande'), h('th', {}, 'Destinataire'), h('th', {}, 'Statut'), h('th', {}, 'Affranchissement'))),
        h('tbody', {}, shipments.map((s) => h('tr', {}, h('td', {}, s.id), h('td', {}, `#${s.order}`), h('td', {}, s.to), h('td', {}, h('span', { class: 'pill warn' }, s.status)), h('td', {}, s.postage)))))
    : h('p', { class: 'muted' }, query ? 'Aucun envoi.' : 'Aucune recherche : tape un numéro de commande.');

  document.title = query ? `Recherche « ${query} » · Chit Chats démo` : 'Expéditions · Chit Chats démo';
  document.getElementById('app').replaceChildren(
    h('div', { class: 'demo-banner' },
      h('strong', {}, 'DÉMO'),
      'Faux Chit Chats : rien ici n’est réel. ',
      h('a', { href: chrome.runtime.getURL('options.html') }, 'Réglages de l’extension')),
    h('header', { class: 'top', style: 'background:#0e6b5c' }, h('span', { class: 'logo' }, '📦 Chit Chats démo'), h('nav', {}, h('a', { href: '/demo/chitchats/index.html' }, 'Expéditions'))),
    h('main', {},
      h('h1', {}, 'Expéditions'),
      h('div', { class: 'card' },
        h('form', { class: 'inline', method: 'get', action: '/demo/chitchats/index.html' },
          h('label', {}, 'Rechercher une commande', h('input', { name: 'q', value: query, placeholder: '1001' })),
          h('button', {}, 'Rechercher'))),
      h('div', { class: 'card' }, h('h2', {}, query ? `Résultats pour « ${query} »` : 'Résultats'), results)),
  );
})();
