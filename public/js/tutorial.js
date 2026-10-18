import { el } from './ui.js';
import { state } from './store.js';

/**
 * Visite guidée de la page « À imprimer », pensée pour quelqu'un qui n'a
 * jamais vu l'outil : peu d'étapes, des phrases courtes, aucun jargon.
 * Un projecteur sur chaque élément et une bulle d'explication ; les étapes
 * dont l'élément n'est pas à l'écran (kiosque, tableau vide...) sont sautées.
 */
const STEPS = [
  {
    title: 'Bienvenue 👋',
    text: "Ici, tu vois tout ce qu'il y a à imprimer. Une carte = une pièce à fabriquer. Les commandes arrivent toutes seules, il n'y a rien à configurer. Visite de 1 minute : utilise « Suivant ».",
  },
  {
    selector: '.column',
    title: 'Les colonnes',
    text: "Une pièce avance de gauche à droite : À imprimer → En impression → Imprimé. Si l'impression rate, appuie sur le triangle rouge : la pièce retourne dans « À imprimer » pour être refaite, et l'échec est gardé dans la page « Échecs ».",
  },
  {
    selector: '.card',
    title: 'Faire avancer une pièce',
    text: "Le bouton avec la flèche (ex. « En impression ›) passe la pièce à l'étape suivante. « Expédié » sert quand la pièce est déjà en stock : inutile de l'imprimer. Tu peux aussi glisser la carte dans une autre colonne. Touche la carte pour voir ses détails.",
  },
  {
    selector: '.toolbar-group',
    title: 'Choisir une couleur',
    text: "Touche une couleur pour ne voir que ces pièces : pratique pour remplir un plateau avec la même résine. Le chiffre, c'est le nombre de pièces. Retouche pour enlever le filtre.",
  },
  {
    selector: '.toolbar .chip',
    match: (node) => node.textContent.includes('En retard'),
    title: 'En retard',
    text: "Montre seulement les commandes qui attendent depuis trop longtemps. Un badge rouge sur une carte veut dire : à faire en premier.",
  },
  {
    selector: '.search',
    title: 'Chercher',
    text: "Tape un nom de pièce, un numéro de commande ou un client. Astuce : la touche « / » du clavier va directement ici.",
  },
  {
    selector: '.column-stack-btn',
    title: 'Regrouper',
    text: "Si tu as 3 pièces identiques, ce bouton les met dans une seule carte « ×3 ». Un clic de plus pour les séparer.",
  },
  {
    selector: '#fullscreen-btn',
    title: 'Plein écran',
    text: "Pour que l'écran serve seulement à la file d'impression. Touche « Quitter » pour revenir.",
  },
  {
    selector: '.nav-item[data-view="integrations"]',
    title: 'Réglages',
    text: "Plus tard seulement : connecter les boutiques, changer les couleurs ou installer les mises à jour. Pour travailler, tu n'en as pas besoin.",
  },
  {
    selector: '#bug-button',
    title: 'Un problème ?',
    text: "Touche ce bouton rouge, écris ce qui ne va pas en une phrase, et envoie. La capture de l'écran part avec : pas besoin d'expliquer plus.",
  },
  {
    title: "C'est tout ! 🎉",
    text: "Tu sais l'essentiel : regarder la file, avancer les pièces, filtrer par couleur. Le bouton « Tutoriel » en haut permet de refaire cette visite quand tu veux.",
  },
];

let active = null;

export const tutorialSeen = () => {
  try {
    return localStorage.getItem('rpq.tutorialSeen') === '1';
  } catch {
    return true; // sans stockage on ne peut pas retenir : mieux vaut ne pas l'imposer
  }
};

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

  const steps = STEPS.filter((step) => !step.selector || visible(step));

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
