/*
 * Onglet Chit Chats : bouton « Link » quand un onglet Shopify attend d'être
 * lié, puis une pastille « Live » tant que cet onglet suit les commandes
 * ouvertes dans Shopify (le lien se coupe depuis Shopify : clic sur « ● Live »).
 * Sur le formulaire d'un envoi, complète aussi ce que l'import a laissé vide
 * (numéro IOSS d'Etsy pour l'Europe, code HS, pays d'origine…).
 */
(() => {
  let badge = null;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const remove = () => {
    badge?.remove();
    badge = null;
  };

  /*
   * La barre se déplace n'importe où (poignée ⋮⋮) pour ne pas cacher les
   * boutons de Chit Chats ; la position est mémorisée (en % de l'écran).
   */
  let position = null; // { x, y } coin haut-gauche, en fraction de la fenêtre
  chrome.storage.local.get('ccBarPos').then(({ ccBarPos }) => {
    position = ccBarPos ?? null;
    applyPosition();
  });

  const clamp = () => {
    if (!badge || !position) return;
    const rect = badge.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - rect.width - 4);
    const maxY = Math.max(0, window.innerHeight - rect.height - 4);
    badge.style.left = `${Math.min(maxX, Math.max(4, position.x * window.innerWidth))}px`;
    badge.style.top = `${Math.min(maxY, Math.max(4, position.y * window.innerHeight))}px`;
  };

  function applyPosition() {
    if (!badge) return;
    if (!position) {
      // par défaut : en bas, au centre
      Object.assign(badge.style, { left: '50%', top: 'auto', bottom: '18px', transform: 'translateX(-50%)' });
      return;
    }
    Object.assign(badge.style, { bottom: 'auto', transform: 'none' });
    clamp();
  }
  window.addEventListener('resize', clamp);

  const makeGrip = () => {
    const grip = document.createElement('span');
    grip.textContent = '⋮⋮';
    grip.title = 'Glisser pour déplacer la barre (double-clic : la remettre en bas)';
    grip.style.cssText = 'cursor:grab;padding:4px 2px;margin:-4px 0;opacity:.75;font-size:12px;letter-spacing:-2px;user-select:none;touch-action:none;';
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const rect = badge.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      grip.style.cursor = 'grabbing';
      const move = (e) => {
        position = { x: (e.clientX - offsetX) / window.innerWidth, y: (e.clientY - offsetY) / window.innerHeight };
        applyPosition();
      };
      const up = () => {
        grip.style.cursor = 'grab';
        grip.removeEventListener('pointermove', move);
        if (position) chrome.storage.local.set({ ccBarPos: position });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });
    grip.addEventListener('dblclick', () => {
      position = null;
      chrome.storage.local.remove('ccBarPos');
      applyPosition();
    });
    return grip;
  };

  const setContent = (children) => {
    badge.replaceChildren(
      makeGrip(),
      ...[].concat(children).map((child) => (typeof child === 'string' ? document.createTextNode(child) : child)),
    );
    applyPosition();
  };

  const render = async () => {
    const status = await send({ type: 'link-status' });
    const link = status?.link;
    const isMine = link?.state === 'live' && link.chitchatsTabId === status.tabId;
    const offered = link?.state === 'pending';
    if (!isMine && !offered) return remove();

    if (!badge) {
      badge = document.createElement('div');
      badge.setAttribute('data-resin-queue', '');
      document.documentElement.append(badge);
    }
    badge.style.cssText =
      'position:fixed;z-index:2147483646;display:flex;align-items:center;gap:10px;' +
      'padding:8px 8px 8px 14px;border-radius:12px;font:600 13px system-ui,-apple-system,sans-serif;color:#fff;' +
      `background:${isMine ? '#167a43' : '#1f5fd6'};box-shadow:0 10px 30px -10px rgba(20,30,60,.5);`;

    if (isMine) {
      badge.style.padding = '9px 14px';
      badge.style.maxWidth = 'min(720px, 92vw)';
      const order = link.lastOrder ?? '';
      const app = status.shopifyApp;
      const sameOrder = app?.orderNumber && String(app.orderNumber).replace(/^#/, '') === String(order).replace(/^#/, '');
      const cc = sameOrder ? app.chitchatsImport : null;

      if (cc?.status === 'error') {
        // l'app a détecté l'échec de l'import : voilà pourquoi la commande n'est pas dans Chit Chats
        badge.style.background = '#b43a3a';
        setContent(`⚠ ${order} : l'import dans Chit Chats a échoué — ${cc.error ?? 'raison inconnue'}. C'est pour ça que la commande n'est pas là.`);
      } else if (cc && !cc.inChitChats && !cc.status) {
        badge.style.background = '#8a6414';
        setContent(`● Live — ${order} pas encore importée dans Chit Chats (prochain import automatique dans l'heure).`);
      } else {
        setContent(`● Live — suit la commande ouverte dans la boutique${order ? ` (${order})` : ''}`);
      }
      return;
    }

    const text = document.createElement('span');
    text.textContent = 'Shopify veut lier cet onglet';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '🔗 Link';
    button.style.cssText = 'all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;background:#fff;color:#1f5fd6;';
    button.addEventListener('click', async () => {
      const result = await send({ type: 'link-accept' });
      if (result?.error) alert(result.error);
    });
    setContent([text, button]);
  };


  /* ------------------------------------------------- compléter le formulaire de l'envoi */

  /*
   * L'import d'une commande (par l'app, ou l'import Etsy / Shopify de Chit Chats) laisse des champs vides. On ne
   * remplit QUE les champs vides, avec ce que l'app sait de la commande (recherchée par « Order ID ») :
   *   - Customs Tax Reference Number : numéro IOSS d'Etsy, seulement pour une commande Etsy vers l'Union européenne ;
   *   - HS Code de chaque article ; Origin Country (Canada) ; Description ; identifiant produit (SKU).
   * Jamais d'écrasement d'une valeur déjà saisie.
   */
  const norm = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  /** Champs dont l'étiquette (ou le texte indicatif) commence par `label`, dans l'ordre de la page. */
  const fieldsByLabel = (label) => {
    const wanted = norm(label);
    const found = [];
    for (const element of document.querySelectorAll('label')) {
      if (!norm(element.textContent).startsWith(wanted)) continue;
      const control =
        (element.htmlFor && document.getElementById(element.htmlFor)) ||
        element.parentElement?.querySelector('input, select, textarea');
      if (control && !found.includes(control)) found.push(control);
    }
    for (const control of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      if (norm(control.placeholder).startsWith(wanted) && !found.includes(control)) found.push(control);
    }
    return found;
  };

  const isEmpty = (control) => !String(control.value ?? '').trim();

  // les champs de Chit Chats sont gérés par leur propre code : on passe par le « setter » natif puis on prévient
  const setValue = (control, value) => {
    const proto = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    control.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  const fillText = (control, value) => {
    if (!control || !value || !isEmpty(control) || control.disabled || control.readOnly) return false;
    setValue(control, String(value));
    return true;
  };

  /** Liste déroulante classique : choisit l'option dont le texte est `text` (si rien n'est choisi). */
  const fillSelect = (control, text) => {
    if (!(control instanceof HTMLSelectElement) || !isEmpty(control)) return false;
    const option = [...control.options].find((entry) => norm(entry.textContent) === norm(text) || norm(entry.value) === norm(text));
    if (!option) return false;
    setValue(control, option.value);
    return true;
  };

  let toast = null;
  const say = (text, tone = 'ok') => {
    toast?.remove();
    toast = document.createElement('div');
    toast.setAttribute('data-resin-queue', '');
    toast.textContent = text;
    toast.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:420px;padding:10px 14px;border-radius:10px;' +
      `font:600 13px system-ui,-apple-system,sans-serif;color:#fff;background:${tone === 'ok' ? '#167a43' : '#8a6414'};` +
      'box-shadow:0 10px 30px -10px rgba(20,30,60,.5);';
    document.documentElement.append(toast);
    setTimeout(() => toast?.remove(), 7000);
  };

  let doneFor = null;
  const complete = async () => {
    const orderField = fieldsByLabel('Order ID')[0];
    const ref = String(orderField?.value ?? '').trim().replace(/^#/, '');
    // pas un formulaire d'envoi, ou déjà complété pour cette commande
    if (!ref || !fieldsByLabel('HS Code').length || doneFor === ref) return;
    doneFor = ref;
    const data = await send({ type: 'cc-customs', order: ref });
    if (!data || data.error) {
      say(`Resin Queue : rien complété pour ${ref} (${data?.error ?? 'app injoignable'}).`, 'warn');
      return;
    }
    const filled = [];
    if (data.ioss && fieldsByLabel('Customs Tax Reference Number').some((control) => fillText(control, data.ioss))) filled.push(`IOSS ${data.ioss}`);
    const count = (label, fill) => fieldsByLabel(label).reduce((n, control, index) => n + (fill(control, index) ? 1 : 0), 0);
    const hs = count('HS Code', (control) => fillText(control, data.hsCode));
    if (hs) filled.push(`code HS ×${hs}`);
    const origin = count('Origin Country', (control) => fillSelect(control, data.originCountry));
    if (origin) filled.push(`pays d'origine ×${origin}`);
    // description et identifiant produit : seulement quand chaque ligne de Chit Chats correspond à un article de la commande
    const rows = fieldsByLabel('HS Code').length;
    if (rows === data.items.length) {
      // une seule « Description » par ligne (sinon on ne sait pas laquelle va avec quel article : on n'y touche pas)
      if (fieldsByLabel('Description').length === rows) {
        const desc = count('Description', (control, index) => fillText(control, data.items[index]?.title));
        if (desc) filled.push(`description ×${desc}`);
      }
      if (fieldsByLabel('Manufacturer product').length === rows) {
        const pid = count('Manufacturer product', (control, index) => fillText(control, data.items[index]?.sku));
        if (pid) filled.push(`identifiant produit ×${pid}`);
      }
    }
    if (filled.length) say(`Resin Queue a complété ${ref} : ${filled.join(', ')}. Vérifie puis enregistre.`);
  };

  // le formulaire de Chit Chats se construit après le chargement (et change sans recharger la page)
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => complete().catch(() => {}), 700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => complete().catch(() => {}), 1200);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') render();
    return false;
  });
  render();
})();
