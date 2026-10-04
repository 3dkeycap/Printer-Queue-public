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
      'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;display:flex;align-items:center;gap:10px;' +
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
        badge.textContent = `⚠ ${order} : l'import dans Chit Chats a échoué — ${cc.error ?? 'raison inconnue'}. C'est pour ça que la commande n'est pas là.`;
      } else if (cc && !cc.inChitChats && !cc.status) {
        badge.style.background = '#8a6414';
        badge.textContent = `● Live — ${order} pas encore importée dans Chit Chats (prochain import automatique dans l'heure).`;
      } else {
        badge.textContent = `● Live — suit la commande ouverte dans Shopify${order ? ` (${order})` : ''}`;
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
    badge.replaceChildren(text, button);
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') render();
    return false;
  });
  render();
})();
