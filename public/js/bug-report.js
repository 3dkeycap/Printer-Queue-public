import { api } from './api.js';
import { clientLogs, logEvent } from './bug-logs.js';
import { el, icon, toast } from './ui.js';
import { state } from './store.js';

/**
 * Bouton coccinelle (rond rouge, en bas à gauche) : n'importe qui peut
 * signaler un bug. Une capture de l'écran est prise automatiquement (ou une
 * image ajoutée / collée), la personne explique ce qui se passe, et les
 * journaux du navigateur et du serveur sont joints. Les signalements se
 * consultent dans Réglages → Mises à jour.
 */

// html-to-image : le navigateur dessine lui-même la page (SVG), donc tout le CSS
// de l'app est respecté. Chargé seulement au premier clic sur la coccinelle.
let libraryPromise = null;
const loadLibrary = () => {
  libraryPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/html-to-image.js';
    script.onload = () => resolve(window.htmlToImage);
    script.onerror = () => reject(new Error('capture indisponible'));
    document.head.append(script);
  });
  return libraryPromise;
};

const TRANSPARENT = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Réduit une image (canvas ou fichier) en JPEG raisonnable pour l'envoi. */
const toJpeg = (source, maxWidth = 1600) => {
  const width = source.width ?? source.naturalWidth;
  const height = source.height ?? source.naturalHeight;
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
};

const captureScreen = async () => {
  const lib = await loadLibrary();
  const options = {
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    width: window.innerWidth,
    height: window.innerHeight,
    skipFonts: true,
    // photos externes (CDN Shopify/Etsy) : remplacées par un vide plutôt que de bloquer la capture
    imagePlaceholder: TRANSPARENT,
    filter: (node) => !(node instanceof Element) || (node.id !== 'bug-button' && node.id !== 'bug-dialog'),
  };
  const canvas = await lib.toCanvas(document.documentElement, options);
  return toJpeg(canvas);
};

const readImageFile = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve(toJpeg(image));
      URL.revokeObjectURL(url);
    };
    image.onerror = () => reject(new Error("Image illisible"));
    image.src = url;
  });

const openDialog = async (button) => {
  button.disabled = true;
  button.classList.add('is-busy');
  let screenshot = null;
  try {
    screenshot = await captureScreen();
  } catch (error) {
    logEvent('warn', `capture d'écran impossible : ${error.message}`);
  } finally {
    button.disabled = false;
    button.classList.remove('is-busy');
  }

  const dialog = document.getElementById('bug-dialog');
  const preview = el('div', { class: 'bug-shot' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const description = el('textarea', { rows: '5', placeholder: "Ce que tu faisais, ce qui s'est passé, ce que tu attendais…" });
  const people = state.meta?.packers ?? [];
  const lastName = (() => {
    try {
      return localStorage.getItem('rpq.bugReporter') ?? '';
    } catch {
      return '';
    }
  })();
  const reporter = el('input', { list: 'bug-people', placeholder: 'Ton nom', value: lastName });
  const error = el('p', { class: 'bug-error' });

  const paintPreview = () => {
    preview.replaceChildren(
      screenshot
        ? el('img', { src: screenshot, alt: "Capture de l'écran" })
        : el('div', { class: 'bug-shot-empty' }, "Pas de capture : ajoute une image (ou colle-la avec Ctrl/Cmd + V)."),
      el('div', { class: 'bug-shot-actions' }, [
        el('button', { type: 'button', class: 'ghost-btn', onclick: () => fileInput.click() }, [icon('image'), screenshot ? "Remplacer par une image" : 'Ajouter une image']),
        screenshot
          ? el('button', { type: 'button', class: 'ghost-btn', onclick: () => { screenshot = null; paintPreview(); } }, [icon('trash'), 'Retirer'])
          : null,
      ]),
    );
  };
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    screenshot = await readImageFile(file).catch(() => screenshot);
    paintPreview();
  });
  const onPaste = async (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
    if (!file) return;
    screenshot = await readImageFile(file).catch(() => screenshot);
    paintPreview();
  };
  dialog.addEventListener('paste', onPaste);
  paintPreview();

  const send = el('button', { type: 'button', class: 'primary-btn' }, [icon('bug'), 'Envoyer le signalement']);
  const close = () => {
    dialog.removeEventListener('paste', onPaste);
    dialog.close();
  };
  send.addEventListener('click', async () => {
    if (!description.value.trim()) {
      error.textContent = 'Explique ce qui se passe (même en quelques mots).';
      description.focus();
      return;
    }
    send.disabled = true;
    try {
      localStorage.setItem('rpq.bugReporter', reporter.value.trim());
    } catch {
      /* stockage indisponible */
    }
    try {
      const bug = await api.createBug({
        reporter: reporter.value.trim(),
        description: description.value.trim(),
        page: location.href,
        screenshot,
        clientLogs: clientLogs(),
        context: {
          view: state.view,
          mode: state.mode,
          theme: state.theme,
          kiosk: document.documentElement.classList.contains('kiosk'),
          filters: { ...state.filters, colors: [...state.filters.colors], statuses: [...state.filters.statuses] },
          visibleParts: state.parts.length,
          selection: [...state.selection],
          screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
          userAgent: navigator.userAgent,
          appBuild: state.meta?.build,
        },
      });
      close();
      toast(`Merci ! Bug n°${bug.id} envoyé`);
    } catch (failure) {
      error.textContent = failure.message;
      send.disabled = false;
    }
  });

  dialog.replaceChildren(
    el('div', { class: 'modal-head bug-head' }, [el('span', { class: 'bug-dot' }, icon('bug')), 'Signaler un bug']),
    el('div', { class: 'modal-body' }, [
      preview,
      fileInput,
      el('div', { class: 'field' }, [el('label', {}, "Qu'est-ce qui se passe ?"), description]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Qui signale ?'),
        reporter,
        el('datalist', { id: 'bug-people' }, people.map((name) => el('option', { value: name }))),
      ]),
      el('p', { class: 'field-hint' }, "Les journaux de l'app (erreurs, dernières actions) sont joints automatiquement pour aider à corriger."),
      error,
    ]),
    el('div', { class: 'modal-foot' }, [el('button', { type: 'button', class: 'ghost-btn', onclick: close }, 'Annuler'), send]),
  );
  dialog.showModal();
  description.focus();
};

export const mountBugButton = () => {
  if (document.getElementById('bug-button')) return;
  const button = el(
    'button',
    { id: 'bug-button', type: 'button', title: 'Signaler un bug', 'aria-label': 'Signaler un bug' },
    icon('bug'),
  );
  button.addEventListener('click', () => openDialog(button));
  document.body.append(button, el('dialog', { id: 'bug-dialog', class: 'modal bug-dialog' }));
};
