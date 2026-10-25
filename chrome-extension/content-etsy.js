/*
 * Sur la liste des commandes d'Etsy Shop Manager (/your/orders/sold) : la même
 * barre que sur Shopify, accrochée au bord droit (poignée ⋮⋮ pour la déplacer,
 * position partagée avec Shopify). Etsy n'a pas de page « une commande » : la
 * barre agit sur la commande sélectionnée en cliquant sa ligne (elle est alors
 * entourée) ; s'il n'y en a qu'une à l'écran, elle est sélectionnée d'office.
 * Chit Chats est cherché par le nom de l'acheteur (« Ship to »), pas par le
 * numéro Etsy, que Chit Chats ne connaît pas toujours.
 */
(() => {
  // lien d'une commande (repli) : ?order_id=123…
  const ORDER_ID = /[?&]order_id=(\d{6,})/i;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
  globalThis.ResinQueuePackSource = 'etsy';

  let dock = null;
  let selected = null; // { id, row, name }
  let linkStatus = {};

  const orderIdOf = (href) => ORDER_ID.exec(href ?? '')?.[1] ?? null;

  /** Une entrée par commande : le numéro affiché sous le nom (« #4208091578 ») est celui de l'app. */
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

  /** Nom de l'acheteur : la ligne qui suit « Ship to » dans la commande. */
  const buyerName = (row) => {
    const lines = (row?.innerText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const at = lines.findIndex((line) => /^ship to$/i.test(line));
    return (at >= 0 && lines[at + 1]) || null;
  };

  const mine = () => linkStatus.link && linkStatus.link.shopifyTabId === linkStatus.tabId;
  const refreshLink = async () => {
    linkStatus = (await send({ type: 'link-status' })) ?? {};
    render();
  };

  /** Lien live : la commande sélectionnée s'affiche dans l'onglet Chit Chats lié. */
  const syncLinkedOrder = () => {
    if (selected) send({ type: 'link-order', orderNumber: selected.id, customerName: selected.name });
  };

  /**
   * Identifiants possibles de la commande dans l'app : ceux des liens de la ligne
   * (le receipt_id Etsy, souvent plus long que le numéro affiché) puis le numéro affiché.
   */
  const candidatesOf = (id, row) => {
    const ids = new Set();
    for (const anchor of row.querySelectorAll('a[href]')) {
      for (const match of (anchor.getAttribute('href') ?? '').matchAll(/\d{8,}/g)) ids.add(match[0]);
    }
    ids.delete(id);
    return [...[...ids].slice(0, 7), id];
  };

  /** Cherche dans l'app laquelle de ces identifiants est une commande Etsy connue. */
  const resolveKey = async (entry) => {
    const found = await send({ type: 'etsy-find', ids: entry.candidates });
    if (selected !== entry || !found?.id) return;
    entry.key = found.id;
    if (globalThis.ResinQueuePack?.isOpen() && globalThis.ResinQueuePack.openOrder() !== found.id) globalThis.ResinQueuePack.open(found.id, dock);
  };

  const select = (id, row) => {
    if (selected?.id === id) return;
    if (selected?.row?.isConnected) selected.row.style.outline = selected.previousOutline ?? '';
    const previousOutline = row.style.outline;
    row.style.outline = '3px solid #1f5fd6';
    row.style.outlineOffset = '-3px';
    selected = { id, key: id, row, name: buyerName(row), previousOutline, candidates: candidatesOf(id, row) };
    const entry = selected;
    // la boîte du bac déjà ouverte passe sur cette commande
    if (globalThis.ResinQueuePack?.isOpen()) globalThis.ResinQueuePack.open(id, dock);
    syncLinkedOrder();
    render();
    resolveKey(entry);
  };

  const openChitChats = async () => {
    if (!selected) return;
    const info = await send({ type: 'resolve', pageOrderNumber: selected.id, customerName: selected.name });
    if (!info?.chitchatsUrl) return;
    try {
      await navigator.clipboard.writeText(selected.name || selected.id);
    } catch {
      /* presse-papiers refusé : on ouvre quand même */
    }
    window.open(info.chitchatsUrl, '_blank', 'noopener');
  };

  const removeDock = () => {
    dock?.remove();
    dock = null;
  };

  async function render() {
    const { dockTop = 14 } = await chrome.storage.local.get('dockTop');
    if (!dock) {
      dock = document.createElement('div');
      dock.setAttribute('data-resin-queue', '');
      document.documentElement.append(dock);
    }
    dock.style.cssText =
      `position:fixed;right:0;top:${dockTop}%;z-index:2147483646;display:flex;align-items:stretch;` +
      'font:600 13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px -8px rgba(20,30,60,.45);' +
      'border-radius:10px 0 0 10px;overflow:hidden;user-select:none;';

    const grip = document.createElement('span');
    grip.title = 'Glisser pour déplacer';
    grip.textContent = '⋮⋮';
    grip.style.cssText = 'display:flex;align-items:center;padding:0 5px;background:#163f8f;color:#9db7ea;cursor:ns-resize;font-size:11px;letter-spacing:-2px;';
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const move = (e) => {
        dock.style.top = `${Math.min(92, Math.max(4, (e.clientY / window.innerHeight) * 100))}%`;
        globalThis.ResinQueuePack?.place();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        chrome.storage.local.set({ dockTop: Number.parseFloat(dock.style.top) });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });

    const btn = (label, title, color, onClick, extra = '') => {
      const node = document.createElement('button');
      node.type = 'button';
      node.title = title;
      node.textContent = label;
      node.style.cssText = `all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 12px;background:${color};color:#fff;${extra}`;
      node.addEventListener('click', onClick);
      return node;
    };

    const parts = [grip];
    if (!selected) {
      const hint = document.createElement('span');
      hint.textContent = 'Clique une commande';
      hint.title = 'Clique la ligne d’une commande pour la sélectionner';
      hint.style.cssText = 'display:flex;align-items:center;padding:10px 14px;background:#1f5fd6;color:#fff;';
      parts.push(hint);
    } else {
      const label = `${selected.name ?? ''} #${selected.id}`.trim();
      parts.push(
        btn(`Chit Chats ${selected.name ?? '#' + selected.id}`, `Ouvrir ${label} sur Chit Chats (cherché par le nom de l’acheteur)`, '#1f5fd6', openChitChats, 'padding:10px 14px 10px 11px;'),
      );
      const open = globalThis.ResinQueuePack?.isOpen();
      parts.push(
        btn(open ? '📦 J’ai packé ▴' : '📦 J’ai packé ▾', 'Indiquer ce qui est dans le bac de cette commande', '#7a4fd0', async () => {
          // l'identifiant exact est cherché avant d'ouvrir la boîte (un clic très rapide ne tombe pas sur « inconnue »)
          if (selected.key === selected.id && selected.candidates.length > 1) await resolveKey(selected);
          globalThis.ResinQueuePack?.toggle(selected.key, dock);
        }, 'border-left:1px solid rgba(255,255,255,.25);'),
      );
    }

    // lien live avec un onglet Chit Chats (même fonctionnement que sur Shopify)
    const link = linkStatus.link;
    const linkPart = document.createElement('span');
    linkPart.style.cssText = 'display:flex;align-items:stretch;border-left:1px solid rgba(255,255,255,.25);';
    if (mine() && link.state === 'live') {
      const live = document.createElement('span');
      live.textContent = '● Live';
      live.title = 'Chaque commande sélectionnée ici s’affiche dans l’onglet Chit Chats lié';
      live.style.cssText = 'display:flex;align-items:center;padding:0 10px;background:#167a43;color:#d6ffe6;';
      linkPart.append(live, btn('Stop live', 'Couper le lien avec Chit Chats', '#b43a3a', () => send({ type: 'link-stop' })));
    } else if (mine() && link.state === 'pending') {
      linkPart.append(btn('Clique « Link » sur Chit Chats… ✕', 'Annuler', '#8a6414', () => send({ type: 'link-stop' })));
    } else {
      linkPart.append(
        btn('🔗 Link', 'Lier un onglet Chit Chats : il suivra la commande sélectionnée ici', '#163f8f', async () => {
          const result = await send({ type: 'link-start' });
          if (result?.warning) alert(result.warning);
        }),
      );
    }
    parts.push(linkPart);

    dock.replaceChildren(...parts);
    globalThis.ResinQueuePack?.place();
  }

  /** Sélection d'une commande : un clic n'importe où sur sa ligne. */
  document.addEventListener(
    'click',
    (event) => {
      if (dock?.contains(event.target) || event.target.closest?.('[data-resin-queue-pack]')) return;
      const orders = findOrders();
      for (const [id, node] of orders) {
        const row = rowOf(node, id, orders);
        if (row.contains(event.target)) return select(id, row);
      }
    },
    true,
  );

  // une seule commande à l'écran : sélectionnée d'office (et à chaque rechargement de la liste)
  const autoSelect = () => {
    const orders = findOrders();
    if (selected && !selected.row.isConnected) {
      const again = orders.get(selected.id);
      if (again) selected = { ...selected, row: rowOf(again, selected.id, orders) };
    }
    if (!selected && orders.size === 1) {
      const [[id, node]] = [...orders];
      select(id, rowOf(node, id, orders));
    } else if (!selected) {
      const fromUrl = orderIdOf(location.href);
      if (fromUrl && orders.has(fromUrl)) select(fromUrl, rowOf(orders.get(fromUrl), fromUrl, orders));
    }
  };
  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(autoSelect, 500);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') refreshLink();
    if (message?.type === 'link-sync') syncLinkedOrder();
    return false;
  });
  globalThis.addEventListener('resin-queue-pack', () => render());

  render();
  refreshLink();
  autoSelect();
})();
