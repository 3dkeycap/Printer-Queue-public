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
   *   - HS Code de chaque article ; Origin Country (Canada) ; Description ; identifiant produit (SKU, sinon la description).
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
  const say = (text, tone = 'ok', diagnostic = null) => {
    if (panel?.isConnected) {
      const box = panel.querySelector('[data-msg]');
      box.replaceChildren();
      const line = document.createElement('div');
      line.style.cssText = `padding:8px 10px;border-radius:10px;background:${tone === 'ok' ? '#e3f6ea' : '#fff3dc'};color:${tone === 'ok' ? '#16663a' : '#7a4b00'};`;
      line.textContent = String(text).replace(/^Resin Queue\s*:?\s*/, '');
      box.append(line);
      if (diagnostic) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copier le diagnostic';
        copy.style.cssText = 'all:unset;display:inline-block;margin-top:6px;padding:6px 10px;border-radius:8px;background:#7a4b00;color:#fff;cursor:pointer;font-size:12px;';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(diagnostic);
            copy.textContent = 'Copié ✓ (colle-le dans la conversation)';
          } catch {
            copy.textContent = 'Copie impossible';
          }
        });
        box.append(copy);
      }
      placePanel();
      return;
    }
    toast?.remove();
    toast = document.createElement('div');
    toast.setAttribute('data-resin-queue', '');
    toast.textContent = text;
    toast.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:2147483646;max-width:420px;padding:10px 14px;border-radius:10px;' +
      `font:600 13px system-ui,-apple-system,sans-serif;color:#fff;background:${tone === 'ok' ? '#167a43' : '#8a6414'};` +
      'box-shadow:0 10px 30px -10px rgba(20,30,60,.5);';
    if (diagnostic) {
      // ce que la page contient vraiment, à coller dans la conversation pour corriger
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copier le diagnostic';
      copy.style.cssText = 'all:unset;display:block;margin-top:8px;padding:6px 10px;border-radius:8px;background:#fff;color:#8a6414;cursor:pointer;';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(diagnostic);
          copy.textContent = 'Copié ✓ (colle-le dans la conversation)';
        } catch {
          copy.textContent = 'Copie impossible';
        }
      });
      toast.append(copy);
    }
    const shown = toast;
    document.documentElement.append(toast);
    setTimeout(() => shown.remove(), diagnostic ? 60000 : 7000);
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
   * Liste à recherche de Chit Chats (Province) : la vraie <select> est cachée et une liste dessinée par la page s'affiche
   * à sa place. Changer la valeur cachée ne suffit pas : on fait comme une personne — ouvrir la liste, taper le nom,
   * cliquer l'option (sinon Entrée) — puis on VÉRIFIE que la liste affiche bien le choix. Sinon : échec + diagnostic.
   */
  const widgetTrigger = (select) => {
    const field = select.closest('.select2-container')?.parentElement ?? select.parentElement;
    for (let node = field, depth = 0; node && depth < 3; node = node.parentElement, depth += 1) {
      const trigger = [...node.querySelectorAll('.select2-selection, .choices, .choices__inner, .bootstrap-select > button, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="true"]')]
        .find((element) => element !== select && visible(element));
      if (trigger) return trigger;
    }
    return null;
  };
  const shownText = (trigger) => norm(`${trigger.textContent} ${trigger.value ?? ''}`);
  /** La liste affiche-t-elle encore « Province » / « Choisir… » (rien de choisi) ? */
  const widgetEmpty = (trigger) => !shownText(trigger) || /^(province|state|select|choose|choisir|--)/.test(shownText(trigger));

  const press = (target, key, keyCode) => {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code: key, keyCode, which: keyCode }));
    }
  };
  const mouse = (target, types) => {
    for (const type of types) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
  };

  const pickInWidget = async (select, label) => {
    const name = label.split(' (')[0];
    const trigger = widgetTrigger(select);
    const diag = (why, extra = []) =>
      [`Resin Queue ${chrome.runtime.getManifest().version} — province « ${label} » non choisie : ${why}`, `select : ${select.outerHTML.slice(0, 300)}`, ...extra].join('\n\n');
    if (!trigger) return { ok: false, why: 'liste introuvable', diagnostic: diag('liste visible introuvable', [`parent : ${select.parentElement?.outerHTML.slice(0, 1200)}`]) };
    const done = () => shownText(trigger).includes(norm(name));
    if (done()) return { ok: true };

    trigger.focus?.();
    mouse(trigger, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    await sleep(350);
    const before = document.activeElement;
    const search =
      (before instanceof HTMLInputElement && before !== select && !trigger.contains(before) ? before : null) ??
      [...document.querySelectorAll('.select2-search__field, .choices__input--cloned, .bs-searchbox input, input[type="search"], input[aria-autocomplete]')].find(visible) ??
      null;
    if (search) {
      // taper le nom (sans « blur » : la liste se fermerait)
      search.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, name);
      search.dispatchEvent(new InputEvent('input', { bubbles: true, data: name, inputType: 'insertText' }));
      press(search, name.slice(-1), name.toUpperCase().charCodeAt(name.length - 1));
      await sleep(450);
    }
    const options = [...document.querySelectorAll('[role="option"], .select2-results__option, .choices__item--choice, li, .dropdown-item, a')]
      .filter((element) => visible(element) && !element.closest('select') && norm(element.textContent).length < 80);
    const option =
      options.find((element) => norm(element.textContent) === norm(label)) ??
      options.find((element) => norm(element.textContent).startsWith(norm(name)));
    if (option) {
      option.scrollIntoView?.({ block: 'nearest' });
      mouse(option, ['pointerover', 'mouseover', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      await sleep(300);
      if (done()) return { ok: true };
    }
    // sinon : Entrée choisit l'option surlignée (la première qui correspond à ce qu'on a tapé)
    if (search) {
      press(search, 'Enter', 13);
      await sleep(300);
      if (done()) return { ok: true };
    }
    press(document.activeElement ?? document.body, 'Escape', 27);
    return {
      ok: false,
      why: option ? 'option trouvée mais pas acceptée' : 'option introuvable',
      diagnostic: diag(option ? 'option cliquée sans effet' : 'option introuvable', [
        `liste : ${trigger.outerHTML.slice(0, 600)}`,
        `recherche : ${search ? search.outerHTML.slice(0, 300) : 'aucune'}`,
        `option : ${option ? option.outerHTML.slice(0, 300) : 'aucune'}`,
        `menu : ${(option ?? search)?.closest('ul, [role="listbox"], .select2-dropdown, .choices__list, .dropdown-menu, div')?.outerHTML.slice(0, 1500) ?? 'aucun'}`,
      ]),
    };
  };

  const fillChoice = async (control, text) => {
    if (!control || !text) return false;
    if (control instanceof HTMLSelectElement) {
      if (control.disabled) return false;
      const option = [...control.options].find((entry) => norm(entry.textContent) === norm(text) || norm(entry.value) === norm(text) || norm(entry.textContent).startsWith(norm(text)));
      // Select2 (Chit Chats) : la vraie <select> reste dans la page, juste réduite à 1 px ; un « change » suffit, la liste
      // affichée suit et c'est cette valeur qui part à l'enregistrement
      const rendered = control.parentElement?.querySelector('.select2-selection__rendered');
      if (visible(control) || rendered) {
        if (!choiceIsEmpty(control) || !option) return false;
        setValue(control, option.value);
        if (!rendered || norm(rendered.textContent).includes(norm(option.textContent.split(' (')[0]))) return true;
        // la liste affichée n'a pas suivi : comme une personne
        const result = await pickInWidget(control, option.textContent.trim());
        if (!result.ok) widgetProblems.push(result);
        return result.ok;
      }
      // <select> cachée sous une liste dessinée : c'est ce que la liste AFFICHE qui compte (vide ou pas, choisi ou pas)
      const trigger = widgetTrigger(control);
      if (trigger && !widgetEmpty(trigger)) return false;
      if (!option) return false;
      const result = await pickInWidget(control, option.textContent.trim());
      if (!result.ok) widgetProblems.push(result);
      return result.ok;
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
   * « Province / State » du fabricant. Sur Chit Chats, l'article a PLUSIEURS champs province du même nom
   * (`…[manufacturer_province_code]`) : un texte (« Province / State », pour Hong Kong et les autres pays) et une liste
   * par pays (Canada, États-Unis, Chine). Seul celui du pays choisi est actif ; les autres sont désactivés et cachés.
   * On prend donc le champ ACTIF (jamais un champ désactivé), en attendant jusqu'à 2 s que Chit Chats l'ait activé
   * après le choix du pays.
   */
  const provinceField = async (block) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidates = [
        ...block.querySelectorAll('[name$="[manufacturer_province_code]"], select[name*="province" i], input[name*="province" i]'),
        ...fieldsByLabel('Province', block),
        ...fieldsByLabel('State', block, { exact: true }),
      ].filter((control, index, all) => all.indexOf(control) === index && !control.disabled);
      const control = candidates.find((candidate) => visible(candidate.parentElement)) ?? candidates[0] ?? null;
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

  /*
   * Commande Etsy vers l'Europe (IOSS) : UNE seule ligne de douane pour toute la commande (demande de l'atelier). On
   * supprime les autres lignes avec la corbeille de Chit Chats (comme une personne), puis on écrit sur celle qui reste
   * « Keyboard keycaps », SKU et identifiant « 3DK », la quantité totale et la valeur des produits (voir vatGroupFor côté
   * app). Ici on remplace les valeurs déjà là : c'est le but. Si une ligne ne part pas, on s'arrête (rien n'est enregistré).
   */
  const visibleRows = () => fieldsByLabel('HS Code').filter(visible);
  const removeButton = (block) =>
    block.querySelector('.js-remove-shipment-item') ??
    [...block.querySelectorAll('button, a')].find((button) => button.querySelector('.fa-trash') || /^(remove|delete|supprimer)$/i.test(String(button.getAttribute('aria-label') ?? button.textContent).trim()));
  const overwrite = (control, value) => {
    if (!control || control.disabled || value === null || value === undefined) return false;
    if (String(control.value ?? '') === String(value)) return true;
    setValue(control, String(value));
    return true;
  };
  const chooseOption = async (control, value) => {
    if (!(control instanceof HTMLSelectElement) || control.disabled || !value) return false;
    const option = [...control.options].find((entry) => norm(entry.value) === norm(value) || norm(entry.textContent) === norm(value) || norm(entry.textContent).startsWith(`${norm(value)} `));
    if (!option) return false;
    if (control.value === option.value) return true;
    setValue(control, option.value);
    const rendered = control.parentElement?.querySelector('.select2-selection__rendered');
    if (!rendered || norm(rendered.textContent).includes(norm(option.textContent))) return true;
    const result = await pickInWidget(control, option.textContent.trim());
    if (!result.ok) widgetProblems.push(result);
    return result.ok;
  };
  const groupForVat = async (group) => {
    const blocks = itemBlocks();
    if (!blocks.length || blocks.some((block) => !block)) return { ok: false, why: 'lignes de la Description non reconnues' };
    for (const block of blocks.slice(1).reverse()) {
      if (!visible(block)) continue;
      const button = removeButton(block);
      if (!button) return { ok: false, why: 'corbeille d’une ligne introuvable' };
      button.click();
      await sleep(200);
    }
    for (let attempt = 0; attempt < 20 && visibleRows().length > 1; attempt += 1) await sleep(150);
    if (visibleRows().length !== 1) return { ok: false, why: `${visibleRows().length} lignes restent après la suppression` };
    const block = itemBlocks().find((entry) => entry && visible(entry));
    if (!block) return { ok: false, why: 'ligne restante non reconnue' };
    const one = (label, exact = false) => fieldsByLabel(label, block, { exact }).find((control) => !control.disabled);
    const wrong = [];
    if (!overwrite(one('Description'), group.description)) wrong.push('description');
    overwrite(one('SKU'), group.sku);
    overwrite(one('Manufacturer product'), group.sku);
    if (!overwrite(one('Quantity'), group.quantity)) wrong.push('quantité');
    // quantité et valeur unitaire d'abord : Chit Chats recalcule le total à partir d'elles ; on écrit le total en dernier
    if (!overwrite(one('Unit Value'), group.unitValue)) wrong.push('valeur unitaire');
    await sleep(100);
    overwrite(one('Total', true), group.total);
    if (group.currency && !(await chooseOption(one('Currency'), group.currency))) wrong.push(`devise ${group.currency}`);
    if (wrong.length) return { ok: false, why: `champ(s) non trouvé(s) : ${wrong.join(', ')}` };
    return { ok: true, label: `1 ligne VAT : ${group.quantity} produits, ${group.total} ${group.currency ?? ''}`.trim() };
  };

  let doneFor = null;
  let widgetProblems = [];
  const complete = async ({ force = false } = {}) => {
    // pas un formulaire d'envoi (aucun champ « HS Code ») : rien à faire
    const firstHs = fieldsByLabel('HS Code')[0];
    if (!firstHs) return hideButton();
    showButton();
    // une fois par formulaire Description affiché (on peut y revenir depuis Package : il est alors refait)
    const descForm = stepRoot(firstHs);
    if (descForm.dataset.rqFilled && !force) return;
    descForm.dataset.rqFilled = '1';
    setStep('description', 'running', 'je remplis les champs vides…');
    // dernier recours : le nom cherché dans la page de recherche de Chit Chats (…/shipments/search?q=Alison%20Thompson)
    const name = new URL(window.top === window ? location.href : document.referrer || location.href).searchParams.get('q') ?? '';
    const ref = (await orderRef()) ?? (name ? `nom:${name}` : null);
    if (!ref) {
      setStep('description', 'warn', 'commande introuvable : remplis à la main');
      say('Je ne trouve pas la commande de cet envoi (ni « Order ID », ni lien Live, ni nom recherché).', 'warn');
      flow.descDone = true;
      return;
    }
    doneFor = ref;
    const data = await send({ type: 'cc-customs', order: ref.startsWith('nom:') ? '' : ref, name });
    if (data?.orderNumber && panel) panel.querySelector('[data-order]').textContent = `#${data.orderNumber}`;
    if (!data || data.error) {
      setStep('description', 'warn', 'commande inconnue de l’app : remplis à la main');
      flow.descDone = true;
      say(`Resin Queue : rien complété pour ${ref.replace(/^nom:/, '')} (${data?.error ?? 'app injoignable'}).`, 'warn');
      return;
    }
    widgetProblems = [];
    const filled = [];
    if (data.vatGroup) {
      const grouped = await groupForVat(data.vatGroup);
      if (!grouped.ok) {
        setStep('description', 'warn', `regroupement VAT impossible (${grouped.why})`);
        say(`Commande Etsy vers l’Europe : je n’ai pas pu tout mettre sur une seule ligne (${grouped.why}). Fais-le à la main, puis « Save and continue ».`, 'warn');
        flow.descDone = true;
        return;
      }
      filled.push(grouped.label);
      // la suite (code HS, pays d'origine, fabricant, poids) travaille sur cette seule ligne : fabricant au Québec
      data.items = [{ title: data.vatGroup.description, sku: data.vatGroup.sku, quantity: data.vatGroup.quantity, unitValue: data.vatGroup.unitValue, manufacturer: data.vatGroup.manufacturer }];
    }
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
    }
    // « Manufacturer product / model ID » est OBLIGATOIRE pour l'Union européenne : le SKU de l'article quand il y en a
    // un, sinon (la plupart de nos produits n'ont pas de SKU) la description de la ligne, déjà sur la page
    let pid = 0;
    for (const [index, hsControl] of fieldsByLabel('HS Code').entries()) {
      const block = blockWith(hsControl, 'Manufacturer product');
      const control = block && fieldsByLabel('Manufacturer product', block)[0];
      if (!control) continue;
      const item = rows === data.items.length ? data.items[index] : null;
      const description = fieldsByLabel('Description', block).map((field) => String(field.value ?? '').trim()).find(Boolean);
      const value = item?.sku || description || item?.title || (data.items.length === 1 ? data.items[0].title : '');
      if (fillText(control, String(value).slice(0, 50).trim())) pid += 1;
    }
    if (pid) filled.push(`identifiant produit ×${pid}`);
    const weights = await setItemWeights();
    if (weights) filled.push(`poids 1 g ×${weights}`);
    const makers = await fillManufacturers(data.items);
    if (makers) filled.push(`fabricant ×${makers}`);
    if (widgetProblems.length) {
      // ne jamais annoncer « complété » pour un champ qui ne l'est pas
      say(
        `Resin Queue a complété ${data.orderNumber}${filled.length ? ` (${filled.join(', ')})` : ''}, MAIS ${widgetProblems.length} province(s) n’ont pas pu être choisies (${widgetProblems[0].why}) : choisis-les à la main, et envoie le diagnostic pour que ce soit corrigé.`,
        'warn',
        widgetProblems.map((problem) => problem.diagnostic).join('\n\n-----\n\n'),
      );
    } else if (filled.length) say(`Resin Queue a complété ${data.orderNumber} : ${filled.join(', ')}. Vérifie puis enregistre.`);
    else if (force) say(`Resin Queue : rien à compléter pour ${data.orderNumber} (les champs sont déjà remplis, ou pas reconnus).`, 'warn');
    flow.descDone = true;
    setStep('description', widgetProblems.length ? 'warn' : 'done', widgetProblems.length ? 'province à choisir à la main' : filled.length ? filled.join(', ') : 'rien à compléter');
    // étape suivante toute seule (pas si une province manque : la personne la choisit d'abord, puis clique elle-même)
    if (!widgetProblems.length) await saveAndContinue('Description');
  };

  /*
   * L'assistant d'envoi : UN seul panneau pour les 3 pages de Chit Chats (Description, Package, Postage) et la suite.
   * Il montre où on en est (Description → Enveloppe → Livraison → Paiement (toi) → Impression), pose la question de
   * l'enveloppe et affiche les messages. À gauche de la fenêtre « Edit Shipment » quand il y a la place, sinon en petit
   * en bas à gauche (il s'agrandit seulement quand il pose une question).
   */
  const STEPS = [
    ['description', 'Description'],
    ['package', 'Enveloppe'],
    ['postage', 'Livraison'],
    ['pay', 'Paiement (toi)'],
    ['print', 'Impression'],
  ];
  const ICONS = { todo: ['○', '#9aa8c4'], running: ['⏳', '#1f5fd6'], done: ['✓', '#167a43'], warn: ['⚠', '#b36b00'], you: ['👤', '#7a4fd0'], skip: ['–', '#9aa8c4'] };
  // où en est l'envoi affiché : Description faite ? déjà renvoyé vers Description depuis Package ?
  const flow = { descDone: false, jumped: false };
  let panel = null;
  let panelFor = null;
  const steps = {};
  let asking = false;

  const shipmentId = () => {
    for (const link of document.querySelectorAll('a[href*="/shipments/"]')) {
      const match = /\/shipments\/([a-z0-9]{6,})\/(?:address|customs|package|postage)/i.exec(link.getAttribute('href') ?? '');
      if (match) return match[1].toLowerCase();
    }
    return /SHIPMENT ID\s+([A-Z0-9]{6,})/i.exec(document.body.innerText ?? '')?.[1]?.toLowerCase() ?? 'envoi';
  };

  const modalLeft = () => {
    const dialog = [...document.querySelectorAll('.modal-dialog, [role="dialog"], .modal-content')].find(visible);
    return dialog ? Math.round(dialog.getBoundingClientRect().left) : 0;
  };

  const placePanel = () => {
    if (!panel) return;
    const free = modalLeft();
    const roomy = free >= 300;
    Object.assign(panel.style, roomy
      ? { left: '12px', top: '12px', bottom: '', width: `${Math.min(free - 24, 340)}px` }
      : { left: '12px', top: '', bottom: '12px', width: asking ? 'min(340px, calc(100vw - 24px))' : '260px' });
    panel.querySelector('[data-steps]').style.display = roomy || asking ? '' : 'none';
    panel.querySelector('[data-mini]').style.display = roomy || asking ? 'none' : '';
  };
  window.addEventListener('resize', placePanel);

  const renderSteps = () => {
    if (!panel) return;
    const list = panel.querySelector('[data-steps]');
    list.replaceChildren(
      ...STEPS.map(([key, label]) => {
        const state = steps[key]?.state ?? 'todo';
        const [icon, color] = ICONS[state];
        const row = document.createElement('div');
        row.style.cssText = `display:flex;gap:8px;align-items:baseline;padding:3px 0;color:${state === 'todo' ? '#7b859a' : '#14213d'};`;
        const mark = document.createElement('b');
        mark.style.cssText = `width:18px;text-align:center;color:${color};flex:none;`;
        mark.textContent = icon;
        const text = document.createElement('span');
        text.innerHTML = `<b style="font-weight:${state === 'running' ? 800 : 600}">${label}</b>${steps[key]?.detail ? `<br><span style="font-size:12px;color:#5b6a86">${steps[key].detail.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</span>` : ''}`;
        row.append(mark, text);
        return row;
      }),
    );
    // version réduite : l'étape en cours sur une ligne
    const current = STEPS.find(([key]) => ['running', 'warn', 'you'].includes(steps[key]?.state)) ?? STEPS.filter(([key]) => steps[key]?.state === 'done').at(-1);
    panel.querySelector('[data-mini]').textContent = current ? `${ICONS[steps[current[0]].state][0]} ${current[1]}${steps[current[0]].detail ? ` — ${steps[current[0]].detail}` : ''}` : 'Prêt';
  };

  const setStep = (key, state, detail = '') => {
    steps[key] = { state, detail };
    renderSteps();
    placePanel();
  };

  const showPanel = (orderLabel = '') => {
    const id = shipmentId();
    if (panelFor !== id) {
      // nouvel envoi : on repart de zéro
      panelFor = id;
      for (const key of Object.keys(steps)) delete steps[key];
      flow.descDone = false;
      flow.jumped = false;
    }
    if (!panel?.isConnected) {
      panel = document.createElement('div');
      panel.setAttribute('data-resin-queue', '');
      panel.style.cssText =
        'position:fixed;z-index:2147483647;box-sizing:border-box;max-height:calc(100vh - 24px);overflow:auto;padding:12px 14px;border-radius:14px;' +
        'background:#fff;color:#14213d;border:2px solid #1f5fd6;box-shadow:0 20px 50px -18px rgba(20,30,60,.55);font:14px/1.35 system-ui,-apple-system,sans-serif;';
      panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><b style="font:800 15px system-ui;color:#1f5fd6">✍ Resin Queue · envoi</b>
          <span data-order style="color:#5b6a86;font-size:12px"></span>
          <button data-rerun type="button" title="Refaire l’étape affichée" style="all:unset;margin-left:auto;cursor:pointer;color:#1f5fd6;font:700 12px system-ui">↻ Relancer</button></div>
        <div data-mini style="font-size:13px"></div>
        <div data-steps></div>
        <div data-form></div>
        <div data-msg style="margin-top:6px;font-size:13px"></div>
        <label data-auto style="display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:8px;font:600 11px system-ui;color:#5b6a86;cursor:pointer">
          <span style="padding:1px 6px;border-radius:6px;background:#fff1c9;color:#8a6414;font-weight:800;letter-spacing:.04em">BETA</span>
          Auto <input type="checkbox" checked style="margin:0;cursor:pointer" /></label>`;
      // la fenêtre de Chit Chats reprend le curseur : on garde nos événements (sinon impossible de taper)
      for (const type of ['focusin', 'focus', 'keydown', 'keypress', 'keyup', 'mousedown', 'click']) panel.addEventListener(type, (event) => event.stopPropagation());
      panel.querySelector('[data-rerun]').addEventListener('click', () => rerun().catch((error) => say(error.message, 'warn')));
      // même réglage que l'interrupteur de la fenêtre de l'extension : décoché = plus rien d'automatique (le panneau part)
      panel.querySelector('[data-auto] input').addEventListener('change', (event) => {
        if (!event.target.checked) chrome.storage.sync.set({ ccAuto: false });
      });
      document.documentElement.append(panel);
    }
    if (orderLabel) panel.querySelector('[data-order]').textContent = orderLabel;
    renderSteps();
    placePanel();
  };
  const hidePanel = () => {
    if (asking) return;
    panel?.remove();
    panel = null;
  };
  // compatibilité avec la complétion de la Description
  const showButton = () => showPanel();
  const hideButton = () => {};

  /* ---------------------------------------------- envoi de bout en bout (Description -> Package -> Postage) */

  /*
   * Description complétée -> « Save and continue » tout seul ; Package : « Thick Envelope » + taille et poids demandés à
   * la personne ; Postage : la livraison la moins chère, assurance Chit Chats décochée. JAMAIS « Pay for Shipment » :
   * une personne vérifie et paie elle-même. Chaque étape n'est faite qu'une fois par formulaire affiché.
   */
  const stepRoot = (element) => element?.closest('form') ?? element?.closest('[role="dialog"], .modal') ?? document.body;
  const buttonNamed = (pattern) =>
    [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button')]
      .filter(visible)
      .find((element) => pattern.test(norm(element.textContent || element.value)));

  const saveAndContinue = async (step) => {
    const next = buttonNamed(/^save and continue$/);
    if (!next || /pay/.test(norm(next.textContent || next.value))) return false;
    const root = stepRoot(next);
    if (root.dataset.rqSaved) return false;
    root.dataset.rqSaved = '1';
    await sleep(700);
    next.click();
    // refusé par Chit Chats (champ manquant…) : on s'arrête et on le dit
    await sleep(2500);
    if (root.isConnected && /please review the error/i.test(root.innerText ?? '')) {
      setStep(step.toLowerCase(), 'warn', 'refusé par Chit Chats (erreurs en rouge)');
      say(`Chit Chats refuse l’étape « ${step} » (voir les erreurs en rouge). Corrige puis clique « Save and continue ».`, 'warn');
      return false;
    }
    return true;
  };

  const SIZES = {
    petite: { label: 'Petite', dims: [22, 17, 4], askHeight: false },
    moyenne: { label: 'Moyenne', dims: [30, 21, null], askHeight: true },
    grosse: { label: 'Grosse', dims: [37, 30, null], askHeight: true },
  };

  /**
   * Question de l'enveloppe, DANS le panneau de l'assistant : taille (Petite déjà choisie : 95 % des commandes), hauteur pour
   * Moyenne / Grosse, poids. Entrée = Continuer. null si la personne préfère faire à la main.
   */
  const askPackage = () =>
    new Promise((resolve) => {
      asking = true;
      showPanel();
      const form = panel.querySelector('[data-form]');
      form.innerHTML = `
        <div style="margin:8px 0 6px;font-weight:800">Quelle enveloppe ? (Thick Envelope)</div>
        <div data-sizes style="display:flex;gap:6px;margin-bottom:8px"></div>
        <label data-hwrap style="display:none;margin-bottom:8px;font-size:13px">Hauteur (cm)<input data-h type="text" inputmode="decimal" autocomplete="off" placeholder="ex. 5" style="display:block;box-sizing:border-box;width:100%;margin-top:3px;padding:9px;border:2px solid #ccd5e5;border-radius:9px;font:inherit"></label>
        <label style="display:block;margin-bottom:6px;font-size:13px">Poids (g)<input data-w type="text" inputmode="numeric" autocomplete="off" placeholder="ex. 156" style="display:block;box-sizing:border-box;width:100%;margin-top:3px;padding:9px;border:2px solid #ccd5e5;border-radius:9px;font:inherit"></label>
        <div data-err style="color:#a02828;min-height:1.1em;font-size:13px"></div>
        <div style="display:flex;gap:6px;margin-top:4px"><button data-cancel type="button" style="flex:1;padding:10px;border:0;border-radius:9px;background:#eef2f8;font:700 13px system-ui;cursor:pointer">Je fais à la main</button>
        <button data-ok type="button" style="flex:1;padding:10px;border:0;border-radius:9px;background:#1f5fd6;color:#fff;font:700 14px system-ui;cursor:pointer">Continuer</button></div>`;
      let chosen = 'petite';
      const sizes = form.querySelector('[data-sizes]');
      const hwrap = form.querySelector('[data-hwrap]');
      const paint = () => {
        for (const button of sizes.children) {
          const on = button.dataset.size === chosen;
          button.style.borderColor = on ? '#1f5fd6' : '#ccd5e5';
          button.style.background = on ? '#eaf1ff' : '#fff';
        }
        hwrap.style.display = SIZES[chosen].askHeight ? 'block' : 'none';
      };
      for (const [key, size] of Object.entries(SIZES)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.size = key;
        button.innerHTML = `<b>${size.label}</b><br><span style="font-size:12px;color:#5b6a86">${size.askHeight ? `${size.dims[1]} × ${size.dims[0]}` : size.dims.join(' × ')}</span>`;
        button.style.cssText = 'flex:1;padding:8px 4px;border:2px solid #ccd5e5;border-radius:10px;background:#fff;cursor:pointer;font:13px system-ui;color:#14213d;';
        button.addEventListener('click', () => {
          chosen = key;
          paint();
          form.querySelector(SIZES[key].askHeight ? '[data-h]' : '[data-w]').focus();
        });
        sizes.append(button);
      }
      paint();
      const finish = (value) => {
        asking = false;
        form.replaceChildren();
        placePanel();
        resolve(value);
      };
      form.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      const submit = () => {
        const err = form.querySelector('[data-err]');
        const size = SIZES[chosen];
        const height = size.askHeight ? Number(String(form.querySelector('[data-h]').value).replace(',', '.')) : size.dims[2];
        const weight = Number(String(form.querySelector('[data-w]').value).replace(',', '.'));
        if (!(height > 0)) return (err.textContent = 'Indique la hauteur (cm).');
        if (!(weight > 0)) return (err.textContent = 'Indique le poids (g).');
        finish({ length: size.dims[0], width: size.dims[1], height, weight: Math.round(weight) });
      };
      form.querySelector('[data-ok]').addEventListener('click', submit);
      form.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') submit();
      });
      placePanel();
      setTimeout(() => form.querySelector('[data-w]').focus(), 50);
    });

  /** Choisit l'option `value` (texte ou valeur) d'une liste, en remplaçant le choix actuel. */
  const forceSelect = (control, value) => {
    if (!(control instanceof HTMLSelectElement)) return false;
    const option = [...control.options].find((entry) => norm(entry.value) === norm(value) || norm(entry.textContent) === norm(value));
    if (!option) return false;
    if (control.value !== option.value) setValue(control, option.value);
    return true;
  };

  const packageStep = async (radio) => {
    const root = stepRoot(radio);
    if (root.dataset.rqPackage) return;
    root.dataset.rqPackage = '1';
    setStep('package', 'you', 'taille et poids ?');
    const answer = await askPackage();
    if (!answer) {
      setStep('package', 'skip', 'à la main');
      return say('Enveloppe à remplir à la main.', 'warn');
    }
    setStep('package', 'running', 'je remplis…');
    if (!radio.checked) radio.click();
    // les champs poids / taille apparaissent après le choix du type
    let weight = null;
    for (let attempt = 0; attempt < 15 && !weight; attempt += 1) {
      weight = fieldsByLabel('Weight', root, { exact: true }).find((control) => !control.disabled && visible(control)) ?? null;
      if (!weight) await sleep(200);
    }
    const one = (label) => fieldsByLabel(label, root, { exact: true }).find((control) => !control.disabled && visible(control)) ?? null;
    const units = fieldsByLabel('Unit', root, { exact: true }).filter((control) => !control.disabled && visible(control));
    const missing = [];
    const put = (control, value, name) => {
      if (!control) return missing.push(name);
      setValue(control, String(value));
    };
    put(weight, answer.weight, 'poids');
    if (units[0] && !forceSelect(units[0], 'g')) missing.push('unité du poids');
    put(one('Length'), answer.length, 'longueur');
    put(one('Width'), answer.width, 'largeur');
    put(one('Height'), answer.height, 'hauteur');
    if (units.length > 1 && !forceSelect(units[units.length - 1], 'cm')) missing.push('unité de taille');
    if (missing.length) {
      setStep('package', 'warn', `${missing.join(', ')} à remplir à la main`);
      return say(`Je ne trouve pas ${missing.join(', ')} sur cette page : remplis-les à la main.`, 'warn');
    }
    setStep('package', 'done', `Thick Envelope ${answer.length} × ${answer.width} × ${answer.height} cm, ${answer.weight} g`);
    say('');
    await saveAndContinue('Package');
  };

  /** Le prix d'une livraison (« $8.89 + fees ») et la ligne qui le porte. */
  const rateRow = (radio) => {
    let node = radio.parentElement;
    while (node && node !== document.body) {
      if (node.querySelectorAll('input[type="radio"]').length > 1) return null;
      if (/\$\s?\d/.test(node.textContent ?? '')) return node;
      node = node.parentElement;
    }
    return null;
  };

  const postageStep = async (root) => {
    if (root.dataset.rqPostage) return;
    root.dataset.rqPostage = '1';
    showPanel();
    setStep('postage', 'running', 'je cherche la moins chère…');
    // les tarifs arrivent un peu après l'affichage de l'étape
    let rates = [];
    for (let attempt = 0; attempt < 40 && !rates.length; attempt += 1) {
      rates = [...root.querySelectorAll('input[type="radio"]')]
        .map((radio) => ({ radio, row: rateRow(radio) }))
        .filter(({ row, radio }) => row && !radio.disabled && visible(row))
        .map(({ radio, row }) => ({ radio, row, price: Number((/\$\s?(\d[\d,]*\.\d{2})/.exec(row.textContent) ?? [])[1]?.replace(/,/g, '')) }))
        .filter((rate) => rate.price > 0);
      if (!rates.length) await sleep(400);
    }
    const done = [];
    if (rates.length) {
      const cheapest = rates.reduce((best, rate) => (rate.price < best.price ? rate : best));
      if (!cheapest.radio.checked) cheapest.radio.click();
      const name = (cheapest.row.innerText ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
      done.push(cheapest.radio.checked ? `${name} ($${cheapest.price.toFixed(2)}) choisi` : `livraison NON choisie`);
    } else done.push('aucun tarif trouvé');
    // assurance Chit Chats cochée par défaut : on la décoche
    const insurance = [...root.querySelectorAll('input[type="checkbox"]')].find((box) => /chit chats insurance/i.test(box.closest('label, div')?.textContent ?? ''));
    if (insurance?.checked) insurance.click();
    await sleep(300);
    done.push(insurance ? (insurance.checked ? 'assurance ENCORE cochée' : 'assurance décochée') : 'case assurance introuvable');
    const ok = done[0].endsWith('choisi') && done[1] === 'assurance décochée';
    setStep('postage', ok ? 'done' : 'warn', done.join(', '));
    setStep('pay', 'you', 'vérifie, puis clique « Pay for Shipment »');
    say(ok ? 'Tout est prêt : vérifie, puis clique toi-même « Pay for Shipment ».' : `${done.join(', ')} : vérifie à la main avant de payer.`, ok ? 'ok' : 'warn');
  };

  /*
   * Fenêtre « Print Postage » (après le paiement fait par la personne : « 1 of 1 shipment ready to print ») : on clique son
   * bouton « Print Postage » tout seul, une fois par fenêtre. Seulement le bouton DANS cette fenêtre (pas celui de la barre du
   * bas), et seulement quand elle dit que l'envoi est prêt à imprimer.
   */
  const printPostage = async () => {
    const print = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')]
      .filter((element) => visible(element) && !element.disabled && !element.classList.contains('disabled'))
      .find((element) => norm(element.textContent || element.value) === 'print postage' && element.closest('.modal, [role="dialog"]'));
    if (!print) return false;
    const modal = print.closest('.modal, [role="dialog"]');
    if (!/ready to print/i.test(modal.innerText ?? '') || modal.dataset.rqPrinted) return false;
    modal.dataset.rqPrinted = '1';
    await sleep(600);
    print.click();
    showPanel();
    setStep('pay', 'done', 'payé');
    setStep('print', 'done', '« Print Postage » lancé');
    say('« Print Postage » lancé.');
    return true;
  };

  /** Regarde quelle étape est affichée et fait la suite (appelé à chaque changement de la page). */
  const advance = async () => {
    if (await printPostage()) return null;
    const thick = [...document.querySelectorAll('input[type="radio"]')].find(
      (radio) => visible(radio.closest('label, li, div')) && (/thick/i.test(radio.value) || /thick envelope/i.test(radio.closest('label, li, div')?.textContent ?? '')),
    );
    if (thick) {
      showPanel();
      // Chit Chats ouvre directement sur Package quand l'envoi a déjà des infos : on repasse d'abord par Description
      if (!flow.descDone && !flow.jumped) {
        const back = [...document.querySelectorAll('a')].find((link) => visible(link) && norm(link.textContent) === 'description' && link.closest('nav, .nav-steps'));
        if (back) {
          flow.jumped = true;
          setStep('description', 'running', 'je vérifie la description d’abord…');
          back.click();
          return null;
        }
      }
      return packageStep(thick);
    }
    const insuranceBox = [...document.querySelectorAll('input[type="checkbox"]')].find((box) => /chit chats insurance/i.test(box.closest('label, div')?.textContent ?? ''));
    if (insuranceBox && visible(insuranceBox.closest('label, div'))) return postageStep(stepRoot(insuranceBox));
    // plus aucune page d'envoi à l'écran (ni la fenêtre « Print Postage ») : l'assistant s'en va
    const printing = [...document.querySelectorAll('.modal, [role="dialog"]')].some((modal) => visible(modal) && /ready to print/i.test(modal.innerText ?? ''));
    if (!fieldsByLabel('HS Code').length && !printing) hidePanel();
    return null;
  };

  /** « ↻ Relancer » : refait l'étape affichée. */
  const rerun = async () => {
    if (fieldsByLabel('HS Code').length) return complete({ force: true });
    for (const element of document.querySelectorAll('[data-rq-package], [data-rq-postage], [data-rq-saved]')) {
      delete element.dataset.rqPackage;
      delete element.dataset.rqPostage;
      delete element.dataset.rqSaved;
    }
    flow.descDone = true;
    return advance();
  };

  // interrupteur de la fenêtre de l'extension (« Automatisation Chit Chats ») : coupé = on ne touche à rien
  let enabled = true;
  chrome.storage.sync.get('ccAuto').then(({ ccAuto }) => {
    enabled = ccAuto !== false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.ccAuto) return;
    enabled = changes.ccAuto.newValue !== false;
    if (!enabled) {
      asking = false;
      hidePanel();
    }
  });

  // le formulaire de Chit Chats se construit après le chargement (et change sans recharger la page)
  let timer = null;
  const tick = () => {
    if (!enabled) return;
    complete().catch(() => {});
    advance().catch((error) => say(error.message, 'warn'));
  };
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(tick, 700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(tick, 1200);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') render();
    return false;
  });
  render();
})();
