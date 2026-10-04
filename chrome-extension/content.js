/*
 * Sur une commande de l'admin Shopify : un bouton « Chit Chats » accroché au
 * bord droit de la page. Depuis la nouvelle interface Shopify (sept. 2026),
 * le chat Sidekick flotte en bas de chaque page : on reste donc à l'écart des
 * coins du bas, et le bouton se déplace (glisser vers le haut / le bas), sa
 * position est mémorisée.
 */
(() => {
  const ORDER_URL = /\/orders\/(\d+)(?:[/?#]|$)/;
  let lastUrl = location.href;
  let dock = null;

  const isOrderPage = () => ORDER_URL.test(location.pathname);

  /** Numéro de commande lu sur la page (titre de l'onglet ou titre de la page), ex. « #5429 ». */
  const pageOrderNumber = () => {
    const sources = [document.title, document.querySelector('h1')?.textContent ?? ''];
    for (const text of sources) {
      const match = /#\s?([A-Za-z0-9-]*\d[A-Za-z0-9-]*)/.exec(text);
      if (match) return `#${match[1]}`;
    }
    return null;
  };

  const notifyUrl = () => chrome.runtime.sendMessage({ type: 'url', url: location.href }).catch(() => {});
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);

  const orderIdFromPath = () => ORDER_URL.exec(location.pathname)?.[1] ?? null;

  /*
   * Après un changement de commande, l'admin Shopify (une seule page) met à
   * jour l'URL avant le titre : on attend que le numéro affiché change pour ne
   * jamais envoyer l'ancienne commande à Chit Chats.
   */
  let knownOrder = { id: null, number: null };
  const freshOrderNumber = async () => {
    const id = orderIdFromPath();
    if (!id) return null;
    if (knownOrder.id === id && knownOrder.number) return knownOrder.number;
    const previous = knownOrder.number;
    const deadline = Date.now() + 4000;
    let number = pageOrderNumber();
    while ((!number || (knownOrder.id !== id && number === previous)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (orderIdFromPath() !== id) return null; // on a encore changé de page entre-temps
      number = pageOrderNumber();
    }
    // titre jamais mis à jour : mieux vaut ne rien envoyer que l'ancienne commande
    if (knownOrder.id !== id && previous && number === previous) return null;
    knownOrder = { id, number };
    return number;
  };

  /** Lien live : la commande ouverte ici s'affiche dans l'onglet Chit Chats lié. */
  const syncLinkedOrder = async () => {
    const number = await freshOrderNumber();
    if (number) send({ type: 'link-order', orderNumber: number });
  };

  const openChitChats = async (info) => {
    try {
      await navigator.clipboard.writeText(String(info.orderNumber ?? '').replace(/^#/, ''));
    } catch {
      /* presse-papiers refusé : on ouvre quand même */
    }
    window.open(info.chitchatsUrl, '_blank', 'noopener');
  };

  const removeDock = () => {
    dock?.remove();
    dock = null;
  };

  const render = async () => {
    if (!isOrderPage()) return removeDock();
    const number = await freshOrderNumber();
    const info = await send({ type: 'resolve', pageOrderNumber: number });
    // le bouton reste affiché sur toute commande (le pack ne dépend pas de Chit Chats)
    if (!info || !isOrderPage()) return removeDock();
    const status = (await send({ type: 'link-status' })) ?? {};
    const link = status.link;
    const mine = link && link.shopifyTabId === status.tabId;

    const { dockTop = 42 } = await chrome.storage.local.get('dockTop');
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

    const appDot = info.app?.ok ? '#3ccf7a' : info.app?.error ? '#f07a7a' : '#c7cfdd';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = `Ouvrir ${info.orderNumber ?? 'la commande'} sur Chit Chats (le numéro est copié)`;
    button.style.cssText =
      'all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 14px 10px 11px;background:#1f5fd6;color:#fff;';
    button.innerHTML = `<span style="width:8px;height:8px;border-radius:99px;background:${appDot}"></span>`;
    button.append(`Chit Chats ${info.orderNumber ?? ''}`.trim());
    button.addEventListener('click', () => openChitChats(info));

    // glisser verticalement, position mémorisée (en % de la hauteur)
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const move = (e) => {
        const top = Math.min(92, Math.max(4, (e.clientY / window.innerHeight) * 100));
        dock.style.top = `${top}%`;
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        chrome.storage.local.set({ dockTop: Number.parseFloat(dock.style.top) });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });

    // --- lien live avec un onglet Chit Chats -------------------------------
    const linkPart = document.createElement('span');
    linkPart.style.cssText = 'display:flex;align-items:stretch;border-left:1px solid rgba(255,255,255,.25);';
    const linkButton = (label, title, color, onClick) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.title = title;
      node.textContent = label;
      node.style.cssText = `all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;padding:10px 12px;background:${color};color:#fff;`;
      node.addEventListener('click', onClick);
      return node;
    };

    if (mine && link.state === 'live') {
      const live = document.createElement('span');
      live.textContent = '● Live';
      live.title = "Chaque commande ouverte ici s'affiche dans l'onglet Chit Chats lié";
      live.style.cssText = 'display:flex;align-items:center;padding:0 10px;background:#167a43;color:#d6ffe6;';
      linkPart.append(
        live,
        linkButton('Stop live', 'Couper le lien avec Chit Chats', '#b43a3a', () => send({ type: 'link-stop' })),
      );
    } else if (mine && link.state === 'pending') {
      linkPart.append(
        linkButton('Clique « Link » sur Chit Chats… ✕', 'Annuler', '#8a6414', () => send({ type: 'link-stop' })),
      );
    } else {
      linkPart.append(
        linkButton('🔗 Link', 'Lier un onglet Chit Chats : il suivra les commandes ouvertes ici', '#163f8f', async () => {
          const result = await send({ type: 'link-start' });
          if (result?.warning) alert(result.warning);
        }),
      );
    }

    // « J'ai packé la commande » : ouvre la fenêtre du bac
    const packButton = document.createElement('button');
    packButton.type = 'button';
    packButton.textContent = "📦 J'ai packé";
    packButton.title = 'Indiquer ce qui est dans le bac de cette commande';
    packButton.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;padding:10px 12px;background:#7a4fd0;color:#fff;border-left:1px solid rgba(255,255,255,.25);';
    packButton.addEventListener('click', () => globalThis.ResinQueuePack?.open(orderIdFromPath()));

    dock.replaceChildren(...[grip, info.chitchatsUrl && button, packButton, info.chitchatsUrl && linkPart].filter(Boolean));
  };

  // l'admin Shopify change d'URL et de titre sans recharger la page
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      globalThis.ResinQueuePack?.close();
      notifyUrl();
      render();
      syncLinkedOrder();
    }
  }, 800);
  new MutationObserver(() => {
    if (isOrderPage() && !dock) render();
  }).observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true });

  notifyUrl();
  render();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'presence' || message?.type === 'link-changed') render();
    if (message?.type === 'link-sync') syncLinkedOrder();
    if (message?.type === 'page-order') {
      sendResponse({ orderNumber: pageOrderNumber(), isOrder: isOrderPage() });
    }
    return false;
  });
})();
