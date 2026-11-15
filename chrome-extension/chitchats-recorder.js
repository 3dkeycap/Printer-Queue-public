/*
 * Enregistreur de l'assistant Chit Chats (« ⏺ Enregistrer » dans le panneau) : note TOUT ce qui se passe sur la page —
 * clics (de la personne ou de l'extension), saisies, changements d'adresse, fenêtres qui s'ouvrent, erreurs affichées par
 * Chit Chats, décisions de l'assistant (étapes, messages, champs remplis) et une copie du formulaire à chaque changement —
 * puis « ■ Stop & télécharger » donne un fichier .json à envoyer pour corriger ce qui cloche.
 *
 * Jamais enregistré : mots de passe, numéros de carte, codes de sécurité, jetons (remplacés par « ••• »). Le fichier
 * contient par contre les adresses des clients affichées sur la page : à n'envoyer qu'à la personne qui corrige.
 * L'enregistrement survit à un rechargement de la page (chrome.storage.local) et s'arrête seul vers 7 Mo.
 */
(() => {
  const noop = () => {};
  if (window.top !== window) {
    globalThis.RQRec = { start: noop, stop: noop, trace: noop, isOn: () => false, onChange: noop };
    return;
  }

  const KEY = 'ccRecord';
  const MAX_BYTES = 7_000_000;
  const SNAP_MAX = 250_000;
  const SENSITIVE = /(password|passwd|card|cc-|cvv|cvc|csc|security|expir|exp_month|exp_year|authenticity_token|csrf|token|secret)/i;

  let rec = null;
  let bytes = 0;
  let saveTimer = null;
  let pill = null;
  let lastSnapshot = '';
  let lastUrl = location.href;
  const listeners = new Set();

  const isSensitive = (element) =>
    element instanceof HTMLInputElement &&
    (element.type === 'password' || SENSITIVE.test(`${element.name} ${element.id} ${element.autocomplete} ${element.getAttribute('data-stripe') ?? ''}`));

  const short = (text, max = 120) => {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max)}…` : clean;
  };

  /** Chemin court lisible : « form#new_shipment > div.js-shipment-item > input[name=…] ». */
  const pathOf = (element) => {
    const parts = [];
    for (let node = element; node && node !== document.documentElement && parts.length < 5; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${node.id}`;
      else if (node.classList?.length) part += `.${[...node.classList].slice(0, 2).join('.')}`;
      if (node.getAttribute?.('name')) part += `[name=${node.getAttribute('name')}]`;
      parts.unshift(part);
      if (node.id) break;
    }
    return parts.join(' > ');
  };

  const labelOf = (element) => {
    const label = (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) || element.closest('label') || element.parentElement?.querySelector('label');
    return label ? short(label.textContent, 60) : null;
  };

  const describe = (element) => {
    if (!(element instanceof Element)) return null;
    const target = element.closest('button, a, input, select, textarea, label, [role="button"], [role="option"], li') ?? element;
    return {
      tag: target.tagName.toLowerCase(),
      type: target.getAttribute('type') ?? undefined,
      name: target.getAttribute('name') ?? undefined,
      id: target.id || undefined,
      // texte visible seulement (jamais la valeur d'un champ : elle passe par valueOf, qui masque les secrets)
      text: short(target.matches('input[type="submit"], input[type="button"], input[type="reset"]') ? target.value : target.textContent, 80) || undefined,
      label: ['input', 'select', 'textarea'].includes(target.tagName.toLowerCase()) ? labelOf(target) ?? undefined : undefined,
      path: pathOf(target),
      ours: Boolean(target.closest('[data-resin-queue]')) || undefined,
    };
  };

  const valueOf = (element) => {
    if (isSensitive(element)) return '•••';
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) return element.checked;
    if (element instanceof HTMLSelectElement) return `${element.value} (${short(element.selectedOptions[0]?.textContent, 60)})`;
    return short(element.value, 200);
  };

  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (rec) chrome.storage.local.set({ [KEY]: rec }).catch(noop);
  };
  // au plus une écriture toutes les 500 ms ; et tout de suite quand la page s'en va (rechargement, autre page)
  const saveSoon = () => {
    if (!saveTimer) saveTimer = setTimeout(saveNow, 500);
  };
  window.addEventListener('pagehide', saveNow);

  const trace = (type, data = {}) => {
    if (!rec || rec.full) return;
    const event = { t: Date.now() - rec.start, type, ...data };
    const size = JSON.stringify(event).length;
    if (bytes + size > MAX_BYTES) {
      rec.full = true;
      rec.events.push({ t: Date.now() - rec.start, type: 'limit', note: 'Taille maximale atteinte : la suite n’est pas enregistrée.' });
      paintPill();
      saveSoon();
      return;
    }
    bytes += size;
    rec.events.push(event);
    paintPill();
    saveSoon();
  };

  /* ------------------------------------------------------------ copie de la page */

  /** Le formulaire affiché (fenêtre « Edit Shipment » ou page), sans scripts ni secrets, avec les valeurs actuelles. */
  const snapshot = (reason) => {
    if (!rec) return;
    const dialogs = [...document.querySelectorAll('[role="dialog"], .modal')].filter((node) => node.offsetWidth || node.offsetHeight);
    const source = dialogs.at(-1) ?? document.querySelector('main') ?? document.body;
    if (!source) return;
    const clone = source.cloneNode(true);
    const originals = source.querySelectorAll('input, select, textarea');
    clone.querySelectorAll('input, select, textarea').forEach((control, index) => {
      const original = originals[index];
      if (!original) return;
      if (isSensitive(original)) control.setAttribute('value', '•••');
      else if (original instanceof HTMLInputElement && ['checkbox', 'radio'].includes(original.type)) {
        if (original.checked) control.setAttribute('checked', '');
        else control.removeAttribute('checked');
      } else if (original instanceof HTMLSelectElement) {
        // listes de pays / provinces : des centaines d'options ; on garde seulement le nombre et celle qui est choisie
        control.setAttribute('data-value', original.value);
        control.setAttribute('data-options', String(original.options.length));
        [...control.options].forEach((option, i) => {
          if (i !== original.selectedIndex) option.remove();
        });
      } else control.setAttribute('value', original.value);
      if (original.disabled) control.setAttribute('disabled', '');
    });
    clone.querySelectorAll('script, style, svg, noscript, [data-resin-queue]').forEach((node) => node.remove());
    clone.querySelectorAll('input[name*="authenticity_token" i], meta[name*="csrf" i]').forEach((node) => node.setAttribute('value', '•••'));
    let html = clone.outerHTML.replace(/\s{2,}/g, ' ');
    if (html.length > SNAP_MAX) html = `${html.slice(0, SNAP_MAX)}<!-- coupé -->`;
    if (html === lastSnapshot) return;
    lastSnapshot = html;
    trace('snapshot', { reason, url: location.href, html });
  };

  /* ---------------------------------------------------------------- écoute */

  const inputs = new Map(); // dernière saisie par champ : une seule ligne par rafale de frappe
  document.addEventListener('click', (event) => trace('click', { el: describe(event.target), human: event.isTrusted, x: event.clientX, y: event.clientY }), true);
  document.addEventListener('change', (event) => trace('change', { el: describe(event.target), value: valueOf(event.target), human: event.isTrusted }), true);
  document.addEventListener('input', (event) => {
    if (!rec) return;
    const last = inputs.get(event.target);
    const value = valueOf(event.target);
    if (last && Date.now() - last.at < 1500 && rec.events[last.index]?.type === 'input') {
      rec.events[last.index].value = value;
      last.at = Date.now();
      saveSoon();
      return;
    }
    trace('input', { el: describe(event.target), value, human: event.isTrusted });
    inputs.set(event.target, { at: Date.now(), index: rec.events.length - 1 });
  }, true);
  document.addEventListener('submit', (event) => trace('submit', { form: describe(event.target), human: event.isTrusted }), true);
  document.addEventListener('keydown', (event) => {
    if (['Enter', 'Escape', 'Tab'].includes(event.key)) trace('key', { key: event.key, el: describe(event.target), human: event.isTrusted });
  }, true);
  document.addEventListener('visibilitychange', () => trace('visibility', { state: document.visibilityState }));
  window.addEventListener('error', (event) => trace('error', { message: short(event.message, 300), source: event.filename, line: event.lineno }));
  window.addEventListener('unhandledrejection', (event) => trace('error', { message: short(event.reason?.message ?? event.reason, 300) }));

  // la page change (fenêtres, étapes, erreurs de Chit Chats) : résumé + copie, regroupés toutes les 400 ms
  let added = 0;
  let removed = 0;
  let mutationTimer = null;
  new MutationObserver((mutations) => {
    if (!rec) return;
    for (const mutation of mutations) {
      // nos propres éléments (panneau, pastille) ne comptent pas
      if (mutation.target.closest?.('[data-resin-queue]')) continue;
      if ([...mutation.addedNodes, ...mutation.removedNodes].every((node) => node.nodeType === 1 && node.closest?.('[data-resin-queue]'))) continue;
      added += mutation.addedNodes.length;
      removed += mutation.removedNodes.length;
    }
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      if (!rec || (!added && !removed)) return;
      const errors = [...document.querySelectorAll('.invalid-feedback, .field_with_errors, .alert-danger, .alert-error, .error, .has-error, [class*="error-message"]')]
        .filter((node) => (node.offsetWidth || node.offsetHeight) && !node.closest('[data-resin-queue]'))
        .map((node) => short(node.textContent, 160))
        .filter(Boolean);
      trace('dom', { added, removed, errors: errors.length ? [...new Set(errors)].slice(0, 20) : undefined });
      added = 0;
      removed = 0;
      snapshot('changement');
    }, 400);
  }).observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    trace('url', { url: location.href });
  }, 400);

  /* ----------------------------------------------------- pastille « REC » */

  const clock = () => {
    const seconds = Math.floor((Date.now() - rec.start) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  function paintPill() {
    if (!rec) {
      pill?.remove();
      pill = null;
      return;
    }
    if (!pill?.isConnected) {
      pill = document.createElement('div');
      pill.setAttribute('data-resin-queue', '');
      pill.style.cssText =
        'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 8px 7px 14px;' +
        'border-radius:99px;background:#1b1b1f;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);';
      pill.innerHTML = '<span style="width:10px;height:10px;border-radius:99px;background:#e5484d"></span><span data-info></span>' +
        '<button type="button" style="all:unset;cursor:pointer;padding:6px 12px;border-radius:99px;background:#e5484d;font-weight:800">■ Stop & télécharger</button>';
      for (const type of ['focusin', 'keydown', 'mousedown', 'click']) pill.addEventListener(type, (event) => event.stopPropagation());
      pill.querySelector('button').addEventListener('click', () => stop());
      document.documentElement.append(pill);
    }
    pill.querySelector('[data-info]').textContent = `REC ${clock()} · ${rec.events.length} évènements${rec.full ? ' · plein' : ''}`;
  }
  setInterval(() => rec && paintPill(), 1000);

  /* ------------------------------------------------------ démarrer / arrêter */

  const notify = () => listeners.forEach((listener) => listener(Boolean(rec)));

  const start = () => {
    if (rec) return;
    rec = {
      active: true,
      start: Date.now(),
      startedAt: new Date().toISOString(),
      extension: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      events: [],
    };
    bytes = 0;
    lastSnapshot = '';
    trace('start', { url: location.href });
    snapshot('début');
    saveNow();
    notify();
  };

  const stop = () => {
    if (!rec) return;
    trace('stop', { url: location.href });
    const file = new Blob([JSON.stringify({ ...rec, active: false, stoppedAt: new Date().toISOString() }, null, 1)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `chitchats-enregistrement-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.documentElement.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    rec = null;
    clearTimeout(saveTimer);
    chrome.storage.local.remove(KEY).catch(noop);
    paintPill();
    notify();
  };

  // enregistrement en cours avant un rechargement de la page : il continue
  chrome.storage.local.get(KEY).then((stored) => {
    const saved = stored?.[KEY];
    if (!saved?.active || rec) return;
    rec = saved;
    bytes = JSON.stringify(rec.events).length;
    trace('reload', { url: location.href });
    snapshot('rechargement');
    notify();
  }).catch(noop);

  globalThis.RQRec = { start, stop, trace, describe, isOn: () => Boolean(rec), onChange: (listener) => listeners.add(listener) };
})();
