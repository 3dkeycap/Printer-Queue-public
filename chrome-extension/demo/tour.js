/*
 * Tutoriel de l'extension : visite guidée sur la FAUSSE page Shopify.
 * Il ne se lance que depuis la page de réglages de l'extension (bouton
 * « Lancer le tutoriel » → cette page avec « ?tutoriel=1 ») : jamais sur le vrai
 * Shopify, et jamais tout seul.
 */
(() => {
  if (!new URLSearchParams(location.search).has('tutoriel')) return;

  /** Bouton du bandeau de l'extension dont le texte contient `text`. */
  const dockButton = (text) => () =>
    [...document.querySelectorAll('[data-resin-queue] button')].find((node) => node.textContent.includes(text)) ?? null;

  const STEPS = [
    {
      title: 'Bienvenue 👋',
      text: 'Tu es sur une FAUSSE page Shopify (bandeau jaune « DÉMO ») : tu peux tout essayer sans rien toucher de vrai. Sur le vrai Shopify, l’extension ajoute exactement les mêmes boutons, accrochés au bord droit de la page.',
    },
    {
      title: 'Le bandeau se déplace',
      find: () => document.querySelector('[data-resin-queue] span[title^="Glisser"]'),
      text: 'Attrape la poignée ⋮⋮ et glisse vers le haut ou le bas si le bandeau gêne (le chat Sidekick de Shopify, par exemple). Sa position est retenue.',
    },
    {
      title: 'Chit Chats #1001',
      find: dockButton('Chit Chats #'),
      text: 'Ouvre Chit Chats directement sur cette commande, et COPIE son numéro (au cas où Chit Chats ne le pré-remplit pas : il n’y a plus qu’à coller). Le petit point vert veut dire que l’app répond ; gris ou rouge, le bouton marche quand même.',
    },
    {
      title: '📦 J’ai packé',
      find: dockButton('packé'),
      text: 'Ouvre la boîte du bac de cette commande : tu règles combien de pièces de chaque article sont dans le bac, tu choisis ton nom (« Qui es-tu ? »), puis « Enregistrer le bac ». S’il manque quelque chose, on te demande seulement pourquoi. Tu peux compléter plus tard. (Ici la commande n’existe pas dans l’app : la boîte le dira gentiment.)',
    },
    {
      title: '🔗 Link : deux onglets côte à côte',
      find: dockButton('Link'),
      text: 'Pour travailler avec Shopify et Chit Chats en écran partagé : clique « 🔗 Link » ici, puis « 🔗 Link » dans l’onglet Chit Chats. Ensuite, chaque commande que tu ouvres dans Shopify s’affiche toute seule dans Chit Chats. « Stop live » coupe le lien.',
    },
    {
      title: 'À toi d’essayer',
      text: 'Ouvre le faux Chit Chats, clique « 🔗 Link » dans les deux onglets, puis reviens ici et utilise « Commande suivante → » : le faux Chit Chats suit. Le tutoriel peut se relancer à tout moment depuis les réglages de l’extension.',
      action: { label: 'Ouvrir le faux Chit Chats', run: () => window.open(chrome.runtime.getURL('demo/chitchats/index.html'), '_blank') },
    },
  ];

  const css = (node, rules) => Object.assign(node.style, rules);
  const make = (tag, rules = {}, text = '') => {
    const node = document.createElement(tag);
    css(node, rules);
    if (text) node.textContent = text;
    return node;
  };

  const spot = make('div', { position: 'fixed', zIndex: '2147483646', pointerEvents: 'none', borderRadius: '10px', boxShadow: '0 0 0 9999px rgba(10,14,24,.6)', transition: 'all .18s' });
  const blocker = make('div', { position: 'fixed', inset: '0', zIndex: '2147483645' });
  const bubble = make('div', {
    position: 'fixed', zIndex: '2147483647', width: 'min(360px, calc(100vw - 24px))', boxSizing: 'border-box', padding: '16px 18px',
    background: '#fff', color: '#1c2230', borderRadius: '14px', boxShadow: '0 24px 60px -18px rgba(10,14,24,.6)', font: '14px system-ui, sans-serif',
  });
  const title = make('strong', { display: 'block', fontSize: '16px', marginBottom: '6px' });
  const text = make('p', { margin: '0', lineHeight: '1.5', color: '#4a5368' });
  const actionBox = make('div', { marginTop: '10px' });
  const counter = make('span', { marginRight: 'auto', fontSize: '12px', color: '#6a7387' });
  const button = (label, primary) =>
    make('button', {
      padding: '8px 14px', border: '0', borderRadius: '9px', cursor: 'pointer', font: '600 13px system-ui',
      background: primary ? '#1f5fd6' : '#e8ecf4', color: primary ? '#fff' : '#1c2230',
    }, label);
  const skip = make('button', { border: '0', background: 'none', color: '#6a7387', cursor: 'pointer', font: '13px system-ui', padding: '6px' }, 'Quitter');
  const prev = button('Précédent', false);
  const next = button('Suivant', true);
  const foot = make('div', { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px' });
  foot.append(counter, skip, prev, next);
  bubble.append(title, text, actionBox, foot);

  let steps = STEPS;
  let index = 0;

  const place = () => {
    const step = steps[index];
    const target = step.find?.() ?? null;
    if (!target) {
      css(spot, { left: '50%', top: '50%', width: '0', height: '0' });
      css(bubble, { left: `${Math.max(12, (window.innerWidth - bubble.offsetWidth) / 2)}px`, top: `${Math.max(12, (window.innerHeight - bubble.offsetHeight) / 2)}px` });
      return;
    }
    const rect = target.getBoundingClientRect();
    css(spot, { left: `${rect.left - 6}px`, top: `${rect.top - 6}px`, width: `${rect.width + 12}px`, height: `${rect.height + 12}px` });
    const below = rect.bottom + 18 + bubble.offsetHeight <= window.innerHeight;
    css(bubble, {
      top: `${below ? rect.bottom + 18 : Math.max(12, rect.top - 18 - bubble.offsetHeight)}px`,
      left: `${Math.min(Math.max(12, rect.left + rect.width / 2 - bubble.offsetWidth / 2), window.innerWidth - bubble.offsetWidth - 12)}px`,
    });
  };

  const go = (to) => {
    if (to < 0) return;
    if (to >= steps.length) return stop();
    index = to;
    const step = steps[index];
    title.textContent = step.title;
    text.textContent = step.text;
    counter.textContent = `${index + 1} / ${steps.length}`;
    prev.disabled = index === 0;
    prev.style.opacity = index === 0 ? '.5' : '1';
    next.textContent = index === steps.length - 1 ? 'Terminer' : 'Suivant';
    actionBox.replaceChildren();
    if (step.action) {
      const run = button(step.action.label, false);
      run.addEventListener('click', step.action.run);
      actionBox.append(run);
    }
    place();
    requestAnimationFrame(place);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') stop();
    else if (event.key === 'ArrowRight' || event.key === 'Enter') go(index + 1);
    else if (event.key === 'ArrowLeft') go(index - 1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  function stop() {
    window.removeEventListener('resize', place);
    window.removeEventListener('keydown', onKey, true);
    spot.remove();
    blocker.remove();
    bubble.remove();
    // l'adresse redevient normale : un rechargement ne relance pas la visite
    history.replaceState(null, '', location.pathname);
  }

  next.addEventListener('click', () => go(index + 1));
  prev.addEventListener('click', () => go(index - 1));
  skip.addEventListener('click', stop);

  // le bandeau de l'extension apparaît un instant après le chargement de la page
  const start = async () => {
    for (let waited = 0; waited < 8000 && !dockButton('packé')(); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // les étapes dont l'élément n'existe pas (extension sans Chit Chats configuré…) sont simplement sautées
    steps = STEPS.filter((step) => !step.find || step.find());
    document.documentElement.append(blocker, spot, bubble);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKey, true);
    go(0);
  };
  start();
})();
