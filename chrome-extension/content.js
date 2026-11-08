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
    bubble?.remove();
    bubble = null;
  };

  /*
   * Petite bulle sous la barre quand le bac de cette commande est déjà
   * commencé (au moins un passage « J'ai packé ») : qui, combien, complet ou
   * pas. Cachée quand la boîte du bac est ouverte (elle prend cette place).
   */
  let bubble = null;
  const packCache = new Map(); // orderId -> { at, view }
  const PACK_CACHE_MS = 20000;

  const packSummary = async (orderId) => {
    const cached = packCache.get(orderId);
    if (cached && Date.now() - cached.at < PACK_CACHE_MS) return cached.view;
    const view = await send({ type: 'pack-get', orderExternalId: orderId });
    packCache.set(orderId, { at: Date.now(), view });
    return view;
  };

  const placeBubble = () => {
    if (!bubble || !dock) return;
    const rect = dock.getBoundingClientRect();
    bubble.style.top = `${Math.round(rect.bottom + 6)}px`;
  };

  async function renderBubble() {
    const orderId = orderIdFromPath();
    if (!dock || !orderId || globalThis.ResinQueuePack?.isOpen()) {
      bubble?.remove();
      bubble = null;
      return;
    }
    const view = await packSummary(orderId);
    const last = view?.history?.[0];
    if (!last || orderIdFromPath() !== orderId || globalThis.ResinQueuePack?.isOpen()) {
      bubble?.remove();
      bubble = null;
      return;
    }
    const packed = view.items.reduce((sum, item) => sum + item.packed, 0);
    const total = view.items.reduce((sum, item) => sum + item.total, 0);
    const missing = last.items.filter((line) => line.packed < line.total);

    if (!bubble) {
      bubble = document.createElement('div');
      bubble.setAttribute('data-resin-queue', '');
      bubble.addEventListener('click', () => globalThis.ResinQueuePack?.toggle(orderIdFromPath(), dock));
      document.documentElement.append(bubble);
    }
    const complete = last.complete;
    bubble.title = complete
      ? `Bac complet — ${last.packer}`
      : `Manque : ${missing.map((line) => `${line.total - line.packed}× ${line.title}${line.reason ? ` (${line.reason})` : ''}`).join(', ')}`;
    bubble.textContent = complete
      ? `✓ Bac complet · ${last.packer}`
      : `📦 Bac commencé · ${last.packer} · ${packed}/${total}`;
    bubble.style.cssText =
      'position:fixed;right:10px;z-index:2147483645;cursor:pointer;max-width:320px;padding:5px 11px;border-radius:999px;' +
      'font:600 12px system-ui,-apple-system,sans-serif;box-shadow:0 6px 18px -8px rgba(20,30,60,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
      (complete ? 'background:#e3f6ea;color:#16663a;border:1px solid #9ad4b0;' : 'background:#fff3e0;color:#8a4b0c;border:1px solid #f0c27d;');
    placeBubble();
  }


  /*
   * Les commentaires de l'équipe (fil « Timeline » en bas de la commande Shopify : « replacement reason: damaged package » +
   * photo…) passent facilement inaperçus. À l'ouverture d'une commande qui en a, une fenêtre bien visible les montre ; « Vu »
   * la ferme jusqu'au prochain nouveau commentaire de cette commande.
   */
  let commentsBox = null;
  let commentsFor = null;
  const agoText = (iso) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (!Number.isFinite(minutes)) return '';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
  };
  const closeComments = () => {
    commentsBox?.remove();
    commentsBox = null;
  };
  const showComments = async (orderId) => {
    if (!orderId || commentsFor === orderId) return;
    commentsFor = orderId;
    closeComments();
    const result = await send({ type: 'order-comments', orderExternalId: orderId });
    const comments = result?.comments ?? [];
    // sans fenêtre, il faut pouvoir savoir pourquoi (console de la page : F12)
    if (result?.error) console.warn('Resin Queue · commentaires Shopify :', result.error);
    if (!comments.length || orderIdFromPath() !== orderId) return;
    const { seenComments = {} } = await chrome.storage.local.get('seenComments');
    if (seenComments[orderId] === comments[0].id) return;

    commentsBox = document.createElement('div');
    commentsBox.setAttribute('data-resin-queue', '');
    commentsBox.style.cssText =
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(560px,92vw);max-height:70vh;overflow:auto;' +
      'background:#fffaf0;color:#14213d;border:3px solid #e8a33d;border-radius:16px;box-shadow:0 30px 80px -20px rgba(0,0,0,.45);' +
      'font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px 18px;';
    const title = document.createElement('div');
    title.style.cssText = 'font:800 17px system-ui;margin-bottom:10px;';
    title.textContent = `💬 ${comments.length} commentaire${comments.length > 1 ? 's' : ''} de l’équipe sur cette commande`;
    commentsBox.append(title);
    for (const comment of comments) {
      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border:1px solid #f0d49a;border-radius:12px;padding:10px 12px;margin-bottom:8px;';
      const head = document.createElement('div');
      head.style.cssText = 'font-weight:700;margin-bottom:4px;';
      head.textContent = `${comment.author ?? 'Quelqu’un'} · ${agoText(comment.createdAt)}`;
      const body = document.createElement('div');
      body.style.cssText = 'white-space:pre-wrap;font-size:15px;';
      body.textContent = comment.message;
      card.append(head, body);
      for (const file of comment.attachments ?? []) {
        const link = document.createElement('a');
        link.href = file.url;
        link.target = '_blank';
        link.rel = 'noopener';
        const image = document.createElement('img');
        image.src = file.url;
        image.alt = file.name ?? '';
        image.style.cssText = 'display:block;max-width:100%;max-height:220px;margin-top:8px;border-radius:8px;border:1px solid #eee;';
        link.append(image);
        card.append(link);
      }
      commentsBox.append(card);
    }
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Vu ✓';
    ok.style.cssText = 'all:unset;display:block;margin:6px 0 0 auto;padding:10px 18px;border-radius:10px;background:#1f5fd6;color:#fff;font:700 15px system-ui;cursor:pointer;';
    ok.addEventListener('click', async () => {
      const { seenComments: seen = {} } = await chrome.storage.local.get('seenComments');
      await chrome.storage.local.set({ seenComments: { ...seen, [orderId]: comments[0].id } });
      closeComments();
    });
    commentsBox.append(ok);
    document.documentElement.append(commentsBox);
  };

  const render = async () => {
    if (!isOrderPage()) {
      closeComments();
      commentsFor = null;
      return removeDock();
    }
    const number = await freshOrderNumber();
    const info = await send({ type: 'resolve', pageOrderNumber: number });
    // le bouton reste affiché sur toute commande (le pack ne dépend pas de Chit Chats)
    if (!info || !isOrderPage()) return removeDock();
    const status = (await send({ type: 'link-status' })) ?? {};
    const link = status.link;
    const mine = link && link.shopifyTabId === status.tabId;

    // assez haut pour que la boîte du bac tienne en dessous
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

    const appDot = info.app?.ok ? '#3ccf7a' : info.app?.error ? '#f07a7a' : '#c7cfdd';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = `Ouvrir ${info.orderNumber ?? 'la commande'} sur Chit Chats (le numéro est copié)`;
    button.style.cssText =
      'all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 14px 10px 11px;background:#1f5fd6;color:#fff;';
    const isLive = Boolean(mine && link.state === 'live');
    if (isLive) {
      // lien actif : plus de bouton « Chit Chats », juste un petit point vert devant le numéro de commande (cliquer coupe le lien)
      button.title = `Lien Chit Chats actif : ${info.orderNumber ?? 'la commande'} s’affiche dans l’onglet lié (cliquer pour couper)`;
      button.innerHTML = '<span style="width:9px;height:9px;border-radius:99px;background:#3ccf7a;box-shadow:0 0 0 2px rgba(60,207,122,.35)"></span>';
      button.append(info.orderNumber ?? '');
      button.addEventListener('click', () => send({ type: 'link-stop' }));
    } else {
      button.innerHTML = `<span style="width:8px;height:8px;border-radius:99px;background:${appDot}"></span>`;
      button.append(`Chit Chats ${info.orderNumber ?? ''}`.trim());
      button.addEventListener('click', () => openChitChats(info));
    }

    // glisser verticalement, position mémorisée (en % de la hauteur)
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const move = (e) => {
        const top = Math.min(92, Math.max(4, (e.clientY / window.innerHeight) * 100));
        dock.style.top = `${top}%`;
        globalThis.ResinQueuePack?.place();
        placeBubble();
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

    if (isLive) {
      // lien actif : « Bug » ouvre le signalement d'un bug dans l'app (le lien se coupe en cliquant le point vert)
      linkPart.append(
        linkButton('🐞 Bug', 'Signaler un bug (ouvre l’app sur la fenêtre de signalement)', '#b43a3a', async () => {
          const result = await send({ type: 'open-bugs' });
          if (result && !result.ok && result.error) alert(result.error);
        }),
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
    const packOpen = globalThis.ResinQueuePack?.isOpen();
    packButton.textContent = packOpen ? "📦 J'ai packé ▴" : "📦 J'ai packé ▾";
    packButton.title = 'Indiquer ce qui est dans le bac de cette commande';
    packButton.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;padding:10px 12px;background:#7a4fd0;color:#fff;border-left:1px solid rgba(255,255,255,.25);';
    packButton.addEventListener('click', () => globalThis.ResinQueuePack?.toggle(orderIdFromPath(), dock));

    dock.replaceChildren(...[grip, info.chitchatsUrl && button, packButton, info.chitchatsUrl && linkPart].filter(Boolean));
    globalThis.ResinQueuePack?.place();
    renderBubble();
    showComments(orderIdFromPath());

    // boîte du bac laissée ouverte : elle se rouvre sur cette commande
    const pack = globalThis.ResinQueuePack;
    const orderId = orderIdFromPath();
    if (pack && orderId && pack.openOrder() !== orderId && (await pack.wantsOpen())) pack.open(orderId, dock);
  };

  // l'admin Shopify change d'URL et de titre sans recharger la page
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // on quitte la commande : la boîte se ferme sans changer le choix mémorisé
      // (si elle était ouverte, elle se rouvre sur la commande suivante)
      if (!isOrderPage()) globalThis.ResinQueuePack?.close();
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
  // la boîte du bac s'ouvre / se ferme : on met à jour la flèche du bouton
  globalThis.addEventListener('resin-queue-pack', (event) => {
    // après un enregistrement, la bulle reprend les nouvelles quantités
    if (event.detail?.saved) packCache.delete(orderIdFromPath());
    render();
  });
  window.addEventListener('resize', placeBubble);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'presence' || message?.type === 'link-changed') render();
    if (message?.type === 'link-sync') syncLinkedOrder();
    if (message?.type === 'page-order') {
      sendResponse({ orderNumber: pageOrderNumber(), isOrder: isOrderPage() });
    }
    return false;
  });
})();
