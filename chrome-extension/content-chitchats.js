/*
 * Onglet Chit Chats : bouton « Link » quand un onglet Shopify attend d'être
 * lié, puis une pastille « Live » tant que cet onglet suit les commandes
 * ouvertes dans Shopify (le lien se coupe depuis Shopify : « Stop live »).
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
        setContent(`● Live — suit la commande ouverte dans Shopify${order ? ` (${order})` : ''}`);
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') render();
    return false;
  });
  render();
})();
