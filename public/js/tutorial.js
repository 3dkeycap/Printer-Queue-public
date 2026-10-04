import { el } from './ui.js';
import { isKiosk, state } from './store.js';

/**
 * Visite guidée de la page « À imprimer » : un projecteur sur chaque élément
 * et une bulle d'explication. Les étapes dont l'élément n'est pas à l'écran
 * (kiosque, tableau vide...) sont simplement sautées.
 */
const STEPS = [
  {
    title: 'Bienvenue 👋',
    text: "Cette visite de 2 minutes explique la page « À imprimer ». Chaque carte = une pièce physique à imprimer. Utilise les flèches du clavier ou les boutons pour avancer.",
  },
  {
    selector: '#sync-btn',
    title: 'Synchroniser',
    text: "Va chercher tout de suite les nouvelles commandes Shopify et Etsy. Ça se fait aussi tout seul toutes les 5 minutes : ce bouton sert quand tu es pressé.",
  },
  {
    selector: '#add-part-btn',
    title: 'Ajouter une pièce à la main',
    text: "Pour une réimpression, un échantillon ou une pièce pour le stock : elle entre dans la file comme une commande normale.",
  },
  {
    selector: '.search',
    title: 'Rechercher',
    text: "Cherche par nom de pièce, SKU, numéro de commande, client, couleur… Astuce : appuie sur « / » n'importe où pour y aller.",
  },
  {
    selector: '.toolbar-group',
    title: 'Filtrer par résine',
    text: "Clique une ou plusieurs couleurs pour ne voir que ces pièces — pratique pour remplir un plateau avec la même résine. Le chiffre est le nombre de pièces.",
  },
  {
    selector: '.toolbar .chip',
    match: (node) => node.textContent.includes('Couleurs masquées'),
    title: 'Couleurs masquées',
    text: "Une résine qu'on n'imprime pas ici (ex. Nylon, fait dans une autre usine) ? Coche-la ici : elle disparaît de la file. La vue « Tout » la montre toujours.",
  },
  {
    selector: '.toolbar-group:last-child .select',
    title: 'Grouper et trier',
    text: "Les cartes peuvent être groupées par couleur, par commande ou rester en vrac, et triées par priorité, ancienneté, etc.",
  },
  {
    selector: '.column',
    title: 'Les colonnes = les étapes',
    text: "À imprimer → En impression → Terminé… (les colonnes sont les statuts). Une pièce avance de gauche à droite. Tu peux aussi glisser-déposer une carte d'une colonne à l'autre.",
  },
  {
    selector: '.column-stack-btn',
    title: 'Regrouper',
    text: "Fusionne les pièces identiques en une seule carte « ×3 » (ex. 3× MX Tilters Adapters). Les boutons de la carte agissent alors sur toute la pile. Re-clique pour dégrouper.",
  },
  {
    selector: '.column-focus-btn',
    title: 'Agrandir une colonne',
    text: "Affiche une seule colonne en grille pour tout voir d'un coup. Re-clique pour revenir à la vue complète.",
  },
  {
    selector: '.card',
    title: 'Une carte = une pièce',
    text: "Nom, résine, UV, commande, rush ⚡, imprimante… Clique la carte pour ouvrir sa fiche (tags, notes, imprimante, historique). Le bouton en bas à droite la fait passer à l'étape suivante ; le triangle rouge la marque en échec.",
  },
  {
    selector: '.card',
    title: 'Sélection multiple',
    text: "Ctrl/Cmd/Maj + clic sur plusieurs cartes : une barre apparaît en bas pour changer leur statut, leurs tags ou leur UV en une fois. Échap pour désélectionner.",
  },
  {
    selector: '#theme-toggle',
    title: 'Thème',
    text: "5 thèmes au choix (nuit, beige, blanc & bleu, forêt, lavande) : clique pour passer au suivant. Le choix est mémorisé sur cet appareil.",
  },
  {
    selector: '.nav-item[data-view="integrations"]',
    title: 'Réglages',
    text: "Imprimantes, postes UV, résines, boutiques connectées, synchronisation et mises à jour. Tout y est rangé par onglet.",
  },
  {
    title: 'Mode kiosque 📱',
    text: "Sur l'iPad de l'atelier, ouvre l'adresse /kiosk de ce serveur : la même file, sans menu, avec de gros boutons. Tu peux relancer ce tutoriel avec le bouton « Tutoriel » en haut.",
  },
];

let active = null;

export const startTutorial = () => {
  if (active) active.stop();

  if (state.view !== 'board') {
    // le tutoriel parle du tableau : on y retourne d'abord
    location.hash = 'board';
    setTimeout(startTutorial, 400);
    return;
  }

  const visible = (step) => {
    if (!step.selector) return null;
    const nodes = [...document.querySelectorAll(step.selector)].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (!step.match || step.match(node));
    });
    return nodes[0] ?? null;
  };

  const steps = STEPS.filter((step) => !step.selector || visible(step)).filter(
    (step) => !(isKiosk && step.selector === '.nav-item[data-view="integrations"]'),
  );

  let index = 0;
  const blocker = el('div', { class: 'tour-blocker' });
  const spot = el('div', { class: 'tour-spot' });
  const title = el('strong', { class: 'tour-title' });
  const text = el('p', { class: 'tour-text' });
  const counter = el('span', { class: 'tour-counter' });
  const prev = el('button', { class: 'ghost-btn', onclick: () => go(index - 1) }, 'Précédent');
  const next = el('button', { class: 'primary-btn', onclick: () => go(index + 1) }, 'Suivant');
  const skip = el('button', { class: 'tour-skip', onclick: () => stop() }, 'Quitter');
  const bubble = el('div', { class: 'tour-bubble', role: 'dialog', 'aria-live': 'polite' }, [
    title,
    text,
    el('div', { class: 'tour-foot' }, [counter, skip, prev, next]),
  ]);

  const place = () => {
    const step = steps[index];
    const target = step.selector ? visible(step) : null;
    const margin = 12;
    const bw = Math.min(360, window.innerWidth - 2 * margin);
    bubble.style.width = `${bw}px`;

    if (!target) {
      spot.style.cssText = 'left:50%;top:50%;width:0;height:0;';
      bubble.style.left = `${(window.innerWidth - bw) / 2}px`;
      bubble.style.top = `${Math.max(margin, (window.innerHeight - bubble.offsetHeight) / 2)}px`;
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 6;
    spot.style.left = `${rect.left - pad}px`;
    spot.style.top = `${rect.top - pad}px`;
    spot.style.width = `${rect.width + 2 * pad}px`;
    spot.style.height = `${rect.height + 2 * pad}px`;

    const bh = bubble.offsetHeight;
    const below = rect.bottom + pad + margin + bh <= window.innerHeight;
    const top = below ? rect.bottom + pad + margin : Math.max(margin, rect.top - pad - margin - bh);
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - bw / 2), window.innerWidth - bw - margin);
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
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
    next.textContent = index === steps.length - 1 ? 'Terminer' : 'Suivant';
    const target = step.selector ? visible(step) : null;
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
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
    blocker.remove();
    spot.remove();
    bubble.remove();
    active = null;
    try {
      localStorage.setItem('rpq.tutorialSeen', '1');
    } catch {
      /* stockage indisponible : sans importance */
    }
  }

  document.body.append(blocker, spot, bubble);
  window.addEventListener('resize', place);
  window.addEventListener('keydown', onKey, true);
  active = { stop };
  go(0);
};
