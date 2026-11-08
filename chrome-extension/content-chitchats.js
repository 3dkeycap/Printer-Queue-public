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
    if (window.top !== window) return;
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
  const fieldsByLabel = (label, root = document, { exact = false } = {}) => {
    const wanted = norm(label);
    const found = [];
    for (const element of root.querySelectorAll('label')) {
      const text = norm(element.textContent);
      if (exact ? text !== wanted : !text.startsWith(wanted)) continue;
      const control =
        (element.htmlFor && document.getElementById(element.htmlFor)) ||
        element.parentElement?.querySelector('input, select, textarea');
      if (control && !found.includes(control)) found.push(control);
    }
    for (const control of root.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      const hint = norm(control.placeholder);
      if ((exact ? hint === wanted : hint.startsWith(wanted)) && !found.includes(control)) found.push(control);
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

  /** Liste à recherche (on tape, puis on clique l'option) : « Origin Country » sur Chit Chats. */
  const fillCombo = async (control, text) => {
    if (!(control instanceof HTMLInputElement) || !isEmpty(control) || control.disabled) return false;
    control.focus();
    control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    setValue(control, text);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const option = [...document.querySelectorAll('[role="option"], li')].find((entry) => norm(entry.textContent) === norm(text) || norm(entry.textContent).startsWith(norm(text)));
    if (!option) return false;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    option.click();
    return true;
  };

  /** Liste déroulante classique : choisit l'option dont le texte est `text` (si rien n'est choisi). */
  const fillSelect = (control, text) => {
    if (!(control instanceof HTMLSelectElement) || !isEmpty(control)) return false;
    const option = [...control.options].find((entry) => norm(entry.textContent) === norm(text) || norm(entry.value) === norm(text) || norm(entry.textContent).startsWith(norm(text)));
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

  /*
   * Le numéro de la commande de cet envoi. La fenêtre « Edit Shipment » n'a pas toujours de champ « Order ID » :
   * on prend alors la commande suivie par le lien Live, puis le « Order 4217424516 » du panneau de l'envoi.
   */
  const orderRef = async () => {
    const field = String(fieldsByLabel('Order ID')[0]?.value ?? '').trim().replace(/^#/, '');
    if (field) return field;
    const status = await send({ type: 'link-status' });
    const link = status?.link;
    if (link?.state === 'live' && link.chitchatsTabId === status.tabId && link.lastOrder) return String(link.lastOrder).replace(/^#/, '');
    const text = String(window.top === window ? document.body.innerText : document.body?.innerText ?? '');
    return /\bOrder\b\s{0,8}[^\d\s]{0,3}\s{0,4}#?(\d{6,})/.exec(text)?.[1] ?? null;
  };

  /*
   * « Manufacturer Details » de chaque article (Contact, adresse, ville, code postal, pays, province / état). Chaque article
   * est un bloc de la page qui contient UN « HS Code » et son propre « Contact » : on remplit dans ce bloc seulement.
   * Fabricant selon l'article (voir manufacturerFor côté app) ; si le nombre de blocs ne correspond pas aux articles,
   * on ne remplit que si tous les articles ont le même fabricant.
   */
  const itemBlocks = () =>
    fieldsByLabel('HS Code').map((hs) => {
      let node = hs.parentElement;
      while (node && node !== document.body) {
        if (fieldsByLabel('Contact', node).length && fieldsByLabel('HS Code', node).length === 1) return node;
        if (fieldsByLabel('HS Code', node).length > 1) return null;
        node = node.parentElement;
      }
      return null;
    });

  // liste déroulante, liste à recherche, ou simple champ texte (« Province / State » pour Hong Kong)
  const isCombo = (control) =>
    control.getAttribute('role') === 'combobox' || control.hasAttribute('aria-autocomplete') || control.getAttribute('aria-haspopup') === 'listbox';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  // une liste encore sur « Choisir… » compte comme vide
  const choiceIsEmpty = (control) =>
    isEmpty(control) || /^(select|choose|choisir|--)/.test(norm(control.selectedOptions?.[0]?.textContent ?? ''));

  /*
   * Liste « à la Select2 » (Province sur Chit Chats) : la vraie <select> est cachée et une fausse liste avec une zone de
   * recherche s'affiche par-dessus. Changer la valeur cachée ne suffit pas : on fait comme une personne — ouvrir la liste,
   * taper le nom, cliquer l'option.
   */
  const pickInWidget = async (select, text) => {
    const field = select.closest('.select2-container')?.parentElement ?? select.parentElement;
    let trigger = null;
    for (let node = field, depth = 0; node && depth < 3 && !trigger; node = node.parentElement, depth += 1) {
      trigger = [...node.querySelectorAll('.select2-selection, [role="combobox"], [aria-haspopup="listbox"]')].find((element) => element !== select && visible(element));
    }
    if (!trigger) return false;
    for (const type of ['mousedown', 'mouseup', 'click']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    await sleep(250);
    const search = [...document.querySelectorAll('.select2-search__field, .select2-container--open input, [role="listbox"] input, input[type="search"]')].find(visible) ??
      (document.activeElement instanceof HTMLInputElement && document.activeElement !== select ? document.activeElement : null);
    if (search) {
      setValue(search, text.split(' (')[0]);
      search.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'n' }));
      await sleep(350);
    }
    const option = [...document.querySelectorAll('.select2-results__option, [role="option"], li')]
      .filter(visible)
      .find((entry) => norm(entry.textContent) === norm(text) || norm(entry.textContent).startsWith(norm(text.split(' (')[0])));
    if (!option) return false;
    for (const type of ['mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click']) option.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    await sleep(200);
    return true;
  };

  const fillChoice = async (control, text) => {
    if (!control || !text) return false;
    if (control instanceof HTMLSelectElement) {
      if (!choiceIsEmpty(control)) return false;
      const option = [...control.options].find((entry) => norm(entry.textContent) === norm(text) || norm(entry.value) === norm(text) || norm(entry.textContent).startsWith(norm(text)));
      if (!option) return false;
      // la valeur cachée d'abord, puis la fausse liste affichée (si elle existe) comme le ferait une personne
      setValue(control, option.value);
      if (!visible(control)) await pickInWidget(control, option.textContent.trim());
      return true;
    }
    if (isCombo(control)) return fillCombo(control, text);
    return fillText(control, text);
  };

  /** Le bloc d'un article qui contient aussi `label` : le plus petit ancêtre de son « HS Code » qui n'a qu'un seul HS Code. */
  const blockWith = (hs, label) => {
    let node = hs.parentElement;
    while (node && node !== document.body) {
      if (fieldsByLabel('HS Code', node).length > 1) return null;
      if (fieldsByLabel(label, node).length) return node;
      node = node.parentElement;
    }
    return null;
  };

  /*
   * Poids de chaque article : toujours 1 g (demande de l'atelier), même s'il y avait déjà une valeur — c'est la seule
   * exception à « on ne remplace jamais ». Le poids du colis (étape « Package ») n'est pas touché.
   */
  const setItemWeights = async () => {
    let done = 0;
    for (const hs of fieldsByLabel('HS Code')) {
      const block = blockWith(hs, 'Weight');
      if (!block) continue;
      const weight = fieldsByLabel('Weight', block)[0];
      const unit = fieldsByLabel('Unit', block, { exact: true })[0];
      let changed = false;
      if (weight && !weight.disabled && String(weight.value).trim() !== '1') {
        setValue(weight, '1');
        changed = true;
      }
      if (unit instanceof HTMLSelectElement && unit.value !== 'g') {
        const option = [...unit.options].find((entry) => norm(entry.value) === 'g' || norm(entry.textContent) === 'g');
        if (option) {
          setValue(unit, option.value);
          changed = true;
        }
      } else if (unit instanceof HTMLInputElement && norm(unit.value) !== 'g') {
        setValue(unit, '');
        changed = (await fillChoice(unit, 'g')) || changed;
      }
      if (changed) done += 1;
    }
    return done;
  };

  /*
   * « Province / State » du fabricant. Chit Chats le recrée après le choix du pays (liste pour le Canada / la Chine, champ texte
   * pour Hong Kong) et son étiquette peut porter une marque (« Province / State * ») : on cherche par début d'étiquette, par
   * nom de champ ou par texte, et on attend jusqu'à 2 secondes qu'il apparaisse.
   */
  const provinceField = async (block) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const control =
        fieldsByLabel('Province', block)[0] ??
        fieldsByLabel('State', block, { exact: true })[0] ??
        block.querySelector('input[name*="province" i], select[name*="province" i], input[name*="state" i], select[name*="state" i]') ??
        [...block.querySelectorAll('*')]
          .filter((element) => !element.children.length && /^(province|state|province \/ state)\b/.test(norm(element.textContent)))
          .map((element) => element.closest('div')?.querySelector('input, select'))
          .find(Boolean) ??
        null;
      if (control) return control;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  };

  const fillManufacturers = async (items) => {
    const blocks = itemBlocks();
    if (!blocks.length || blocks.some((block) => !block)) return 0;
    const same = items.every((item) => item.manufacturer?.key === items[0]?.manufacturer?.key);
    if (blocks.length !== items.length && !same) return 0;
    let done = 0;
    for (const [index, block] of blocks.entries()) {
      const maker = (blocks.length === items.length ? items[index] : items[0])?.manufacturer;
      if (!maker) continue;
      const one = (label, exact = false) => fieldsByLabel(label, block, { exact })[0];
      let changed = false;
      changed = fillText(one('Contact'), maker.contact) || changed;
      changed = fillText(one('Address Line 1'), maker.address1) || changed;
      changed = fillText(one('Address Line 2'), maker.address2) || changed;
      changed = fillText(one('City', true), maker.city) || changed;
      changed = fillText(one('Postal Code'), maker.postalCode) || changed;
      // le pays d'abord : la liste des provinces / états en dépend
      changed = (await fillChoice(one('Country', true), maker.country)) || changed;
      if (maker.province) {
        const province = await provinceField(block);
        changed = (await fillChoice(province, maker.province)) || changed;
      }
      if (changed) done += 1;
    }
    return done;
  };

  let doneFor = null;
  const complete = async ({ force = false } = {}) => {
    // pas un formulaire d'envoi (aucun champ « HS Code ») : rien à faire
    if (!fieldsByLabel('HS Code').length) return hideButton();
    showButton();
    // dernier recours : le nom cherché dans la page de recherche de Chit Chats (…/shipments/search?q=Alison%20Thompson)
    const name = new URL(window.top === window ? location.href : document.referrer || location.href).searchParams.get('q') ?? '';
    const ref = (await orderRef()) ?? (name ? `nom:${name}` : null);
    if (!ref) {
      if (force) say('Resin Queue : je ne trouve pas la commande de cet envoi (ni « Order ID », ni lien Live, ni nom recherché).', 'warn');
      return;
    }
    // déjà complété pour cette commande (le bouton permet de refaire)
    if (doneFor === ref && !force) return;
    doneFor = ref;
    const data = await send({ type: 'cc-customs', order: ref.startsWith('nom:') ? '' : ref, name });
    if (!data || data.error) {
      say(`Resin Queue : rien complété pour ${ref.replace(/^nom:/, '')} (${data?.error ?? 'app injoignable'}).`, 'warn');
      return;
    }
    const filled = [];
    if (data.ioss && fieldsByLabel('Customs Tax Reference Number').some((control) => fillText(control, data.ioss))) filled.push(`IOSS ${data.ioss}`);
    const count = (label, fill) => fieldsByLabel(label).reduce((n, control, index) => n + (fill(control, index) ? 1 : 0), 0);
    const hs = count('HS Code', (control) => fillText(control, data.hsCode));
    if (hs) filled.push(`code HS ×${hs}`);
    // pays d'origine = pays du fabricant de l'article (Canada, Hong Kong pour le nylon, Chine pour les switchs)
    const origins = fieldsByLabel('Origin Country');
    const sameMaker = data.items.every((item) => item.manufacturer?.key === data.items[0]?.manufacturer?.key);
    let origin = 0;
    for (const [index, control] of origins.entries()) {
      const item = origins.length === data.items.length ? data.items[index] : sameMaker ? data.items[0] : null;
      const country = item?.manufacturer?.country ?? (data.items.length ? null : data.originCountry);
      if (country && (await fillChoice(control, country))) origin += 1;
    }
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
    const weights = await setItemWeights();
    if (weights) filled.push(`poids 1 g ×${weights}`);
    const makers = await fillManufacturers(data.items);
    if (makers) filled.push(`fabricant ×${makers}`);
    if (filled.length) say(`Resin Queue a complété ${data.orderNumber} : ${filled.join(', ')}. Vérifie puis enregistre.`);
    else if (force) say(`Resin Queue : rien à compléter pour ${data.orderNumber} (les champs sont déjà remplis, ou pas reconnus).`, 'warn');
  };

  /*
   * Bouton « Compléter » visible dès qu'un formulaire d'envoi est à l'écran : montre que l'extension l'a vu, et relance.
   * Il occupe toute la zone libre à gauche de la fenêtre « Edit Shipment » (du haut jusqu'en bas), pour être impossible à rater.
   */
  let button = null;
  const placeButton = () => {
    if (!button) return;
    const dialog = fieldsByLabel('HS Code')[0]?.closest('[role="dialog"], .modal, .modal-dialog, dialog');
    const left = dialog?.getBoundingClientRect().left ?? 0;
    // la place à gauche de la fenêtre ; sans fenêtre repérable : un peu moins d'un tiers de l'écran
    const width = left > 200 ? left - 24 : Math.round(window.innerWidth * 0.28);
    Object.assign(button.style, { width: `${width}px` });
  };
  function showButton() {
    if (button?.isConnected) return placeButton();
    button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-resin-queue', '');
    button.title = 'Remplit les champs vides : IOSS (Etsy vers l’Europe), code HS, pays d’origine, fabricant, poids 1 g, description, SKU';
    button.style.cssText =
      'all:unset;box-sizing:border-box;position:fixed;left:12px;top:12px;bottom:12px;z-index:2147483647;cursor:pointer;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;' +
      'border-radius:18px;color:#fff;background:#1f5fd6;box-shadow:0 20px 50px -18px rgba(20,30,60,.6);' +
      'font:800 34px/1.15 system-ui,-apple-system,sans-serif;';
    const big = document.createElement('span');
    big.textContent = '✍ Compléter';
    const small = document.createElement('span');
    small.textContent = 'Resin Queue remplit les champs vides de cet envoi';
    small.style.cssText = 'font:600 16px/1.35 system-ui,-apple-system,sans-serif;opacity:.85;max-width:320px;';
    button.append(big, small);
    button.addEventListener('mouseenter', () => { button.style.background = '#174bb0'; });
    button.addEventListener('mouseleave', () => { button.style.background = '#1f5fd6'; });
    button.addEventListener('click', () => complete({ force: true }).catch((error) => say(`Resin Queue : ${error.message}`, 'warn')));
    document.documentElement.append(button);
    placeButton();
  }
  window.addEventListener('resize', placeButton);
  function hideButton() {
    button?.remove();
    button = null;
  }

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
