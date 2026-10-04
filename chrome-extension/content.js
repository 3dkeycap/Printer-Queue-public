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
    const info = await chrome.runtime
      .sendMessage({ type: 'resolve', pageOrderNumber: pageOrderNumber() })
      .catch(() => null);
    if (!info?.chitchatsUrl || !isOrderPage()) return removeDock();

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

    const status = info.app?.ok ? '#3ccf7a' : info.app?.error ? '#f07a7a' : '#c7cfdd';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = `Ouvrir ${info.orderNumber ?? 'la commande'} sur Chit Chats (le numéro est copié)`;
    button.style.cssText =
      'all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 14px 10px 11px;background:#1f5fd6;color:#fff;';
    button.innerHTML = `<span style="width:8px;height:8px;border-radius:99px;background:${status}"></span>`;
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

    dock.replaceChildren(grip, button);
  };

  // l'admin Shopify change d'URL et de titre sans recharger la page
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      notifyUrl();
      render();
    }
  }, 800);
  new MutationObserver(() => {
    if (isOrderPage() && !dock) render();
  }).observe(document.querySelector('title') ?? document.head, { childList: true, subtree: true, characterData: true });

  notifyUrl();
  render();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'presence') render();
    if (message?.type === 'page-order') {
      sendResponse({ orderNumber: pageOrderNumber(), isOrder: isOrderPage() });
    }
    return false;
  });
})();
