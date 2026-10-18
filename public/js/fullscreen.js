import { clear, el, icon } from './ui.js';

/**
 * Plein écran réel du navigateur (Fullscreen API) pour le kiosque d'atelier.
 * Le navigateur l'exige déclenché par un geste de l'utilisateur : on ne peut
 * donc pas passer en plein écran à l'ouverture de la page, mais le premier
 * appui n'importe où le fait, et le bouton de la barre du haut le bascule.
 */
const root = document.documentElement;
const OPT_OUT_KEY = 'rpq.kiosk.noAutoFullscreen';

const request = () => (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
const exit = () => (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
const isFullscreen = () => Boolean(document.fullscreenElement ?? document.webkitFullscreenElement);
export const fullscreenSupported = () => Boolean(root.requestFullscreen ?? root.webkitRequestFullscreen);

const remember = (value) => {
  try {
    if (value) sessionStorage.setItem(OPT_OUT_KEY, '1');
    else sessionStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* stockage indisponible : sans importance */
  }
};
const optedOut = () => {
  try {
    return sessionStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
};

export const mountFullscreen = (button) => {
  if (!fullscreenSupported()) return; // ex. iPhone : le bouton reste caché

  const paint = () => {
    const on = isFullscreen();
    button.hidden = false;
    button.title = on ? 'Quitter le plein écran' : 'Passer en plein écran';
    clear(button).append(icon(on ? 'shrink' : 'expand'), el('span', {}, on ? 'Quitter' : 'Plein écran'));
  };

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      if (isFullscreen()) {
        remember(true); // sorti volontairement : on ne le relance plus tout seul
        await exit();
      } else {
        remember(false);
        await request();
      }
    } catch {
      /* refusé par le navigateur */
    }
  });

  // Échap ou sortie par le système : on ne force pas le retour
  const onChange = () => {
    if (!isFullscreen()) remember(true);
    paint();
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);

  // premier appui n'importe où = plein écran (geste utilisateur exigé)
  const auto = () => {
    if (isFullscreen() || optedOut()) return;
    Promise.resolve(request()).catch(() => {});
  };
  document.addEventListener('click', auto, { once: true, capture: true });
  document.addEventListener('touchend', auto, { once: true, capture: true });

  paint();
};
