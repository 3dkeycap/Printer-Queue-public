/*
 * Sur la liste des commandes d'Etsy Shop Manager (/your/orders/sold) : pas de
 * page « une commande » plein écran comme sur Shopify, donc un petit bouton
 * (le logo de l'extension) est accroché à chaque commande. Il fait comme la
 * barre de Shopify : ouvre la boîte « J'ai packé » de la commande et amène
 * l'onglet Chit Chats sur la bonne commande (lien live, ou nouvel onglet).
 * Le numéro de commande Etsy (order_id dans les liens) est celui que l'app
 * connaît (receipt_id).
 */
(() => {
  // lien d'une commande (repli) : ?order_id=123…
  const ORDER_ID = /[?&]order_id=(\d{6,})/i;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
  globalThis.ResinQueuePackSource = 'etsy';

  const logo = chrome.runtime.getURL('icon32.png');
  const groups = new Map(); // orderId -> { group, linkBtn }
  let lastClicked = null;
  let linkStatus = {};

  const orderIdOf = (href) => ORDER_ID.exec(href ?? '')?.[1] ?? null;

  /**
   * Une entrée par commande : le numéro affiché sous le nom de l'acheteur (« #4208091578 »)
   * est celui que l'app connaît ; les liens ?order_id= ne servent que de repli.
   */
  const findOrders = () => {
    const found = new Map();
    for (const node of document.querySelectorAll('a, span, div')) {
      if (node.children.length > 1) continue;
      const match = /^#(\d{8,})$/.exec((node.textContent ?? '').trim());
      if (match && !found.has(match[1])) found.set(match[1], node);
    }
    if (!found.size) {
      for (const anchor of document.querySelectorAll('a[href]')) {
        const id = orderIdOf(anchor.getAttribute('href'));
        if (id && !found.has(id)) found.set(id, anchor);
      }
    }
    return found;
  };

  /** Nom de l'acheteur : la ligne qui suit « Ship to » dans la commande. */
  const buyerName = (row) => {
    const lines = (row.innerText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const at = lines.findIndex((line) => /^ship to$/i.test(line));
    return (at >= 0 && lines[at + 1]) || null;
  };

  /** La ligne de la commande : le plus petit bloc qui contient aussi sa case à cocher. */
  const rowOf = (anchor, id, all) => {
    let node = anchor;
    for (let depth = 0; depth < 14 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      if (parent === document.body || parent.tagName === 'MAIN') break;
      // un bloc qui contient une autre commande n'est plus « la » ligne
      for (const [other, otherNode] of all) if (other !== id && parent.contains(otherNode)) return node;
      node = parent;
      if (node.querySelector('input[type="checkbox"]')) return node;
    }
    return node;
  };

  const toast = (text) => {
    alert(text);
  };

  const button = (label, title, extra, onClick) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.title = title;
    node.style.cssText =
      'all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;height:34px;min-width:34px;box-sizing:border-box;' +
      `border-radius:999px;background:#fff;border:1px solid #c9d3e8;box-shadow:0 4px 12px -6px rgba(20,30,60,.5);font:600 13px system-ui,sans-serif;${extra}`;
    if (label instanceof Node) node.append(label);
    else node.textContent = label;
    node.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    return node;
  };

  const mine = () => linkStatus.link && linkStatus.link.shopifyTabId === linkStatus.tabId;

  const paintLink = () => {
    const live = mine() && linkStatus.link.state === 'live';
    const pending = mine() && linkStatus.link.state === 'pending';
    for (const { linkBtn } of groups.values()) {
      linkBtn.textContent = live ? '● Live' : pending ? '🔗…' : '🔗';
      linkBtn.title = live
        ? 'Chaque commande cliquée ici s’affiche dans l’onglet Chit Chats lié (cliquer pour couper)'
        : pending
          ? 'Clique « Link » sur l’onglet Chit Chats… (cliquer pour annuler)'
          : 'Lier un onglet Chit Chats : il suivra les commandes cliquées ici';
      linkBtn.style.background = live ? '#167a43' : pending ? '#8a6414' : '#fff';
      linkBtn.style.color = live || pending ? '#fff' : '#163f8f';
      linkBtn.style.padding = '0 10px';
    }
  };
  const refreshLink = async () => {
    linkStatus = (await send({ type: 'link-status' })) ?? {};
    paintLink();
  };

  /** Amène Chit Chats sur la commande : onglet lié, sinon nouvel onglet (numéro copié). */
  const goChitChats = async (id, customerName) => {
    lastClicked = { id, customerName };
    if (mine() && linkStatus.link.state === 'live') {
      send({ type: 'link-order', orderNumber: id, customerName });
      return;
    }
    const info = await send({ type: 'resolve', pageOrderNumber: id, customerName });
    if (!info?.chitchatsUrl) return;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      /* presse-papiers refusé : on ouvre quand même */
    }
    window.open(info.chitchatsUrl, '_blank', 'noopener');
  };

  const onLogo = (id, node, row) => {
    const closing = globalThis.ResinQueuePack?.openOrder() === id;
    globalThis.ResinQueuePack?.toggle(id, node);
    if (!closing) goChitChats(id, row ? buyerName(row) : null);
  };

  const onLink = async () => {
    if (mine()) await send({ type: 'link-stop' });
    else {
      const result = await send({ type: 'link-start' });
      if (result?.warning) toast(result.warning);
    }
    refreshLink();
  };

  const attach = (id, row, floating = false) => {
    if (groups.get(id)?.group.isConnected) return;
    const group = document.createElement('div');
    group.setAttribute('data-resin-queue', '');
    group.style.cssText = floating
      ? 'position:fixed;right:12px;top:30%;z-index:2147483646;display:flex;gap:6px;'
      : 'position:absolute;right:56px;top:12px;z-index:5;display:flex;gap:6px;';
    const icon = document.createElement('img');
    icon.src = logo;
    icon.alt = 'Resin Queue';
    icon.style.cssText = 'width:22px;height:22px;display:block;';
    const logoBtn = button(icon, `Resin Queue : bac + Chit Chats pour la commande ${id}`, 'padding:0 5px;', () => onLogo(id, logoBtn, floating ? null : row));
    const linkBtn = button('🔗', 'Lier un onglet Chit Chats', 'padding:0 10px;', onLink);
    group.append(logoBtn, linkBtn);
    if (!floating && getComputedStyle(row).position === 'static') row.style.position = 'relative';
    (floating ? document.documentElement : row).append(group);
    groups.set(id, { group, linkBtn });
    paintLink();
  };

  const scan = () => {
    for (const [id, entry] of groups) if (!entry.group.isConnected) groups.delete(id);
    const orders = findOrders();
    for (const [id, anchor] of orders) attach(id, rowOf(anchor, id, orders));
    // page d'une seule commande sans lien repérable : bouton flottant
    if (!orders.size) {
      const fromUrl = orderIdOf(location.href);
      if (fromUrl) attach(fromUrl, document.body, true);
    }
  };

  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, 400);
  };
  // Etsy recharge la liste sans recharger la page (filtres, onglets, pages)
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') refreshLink();
    if (message?.type === 'link-sync' && lastClicked) send({ type: 'link-order', orderNumber: lastClicked.id, customerName: lastClicked.customerName });
    return false;
  });
  globalThis.addEventListener('resin-queue-pack', () => paintLink());

  scan();
  refreshLink();
})();
