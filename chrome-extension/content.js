/*
 * Sur une commande de l'admin Shopify : petit panneau en bas à droite qui
 * confirme que Resin Queue est prévenu, avec le bouton « Ouvrir sur Chit Chats ».
 */
(() => {
  let lastUrl = location.href;
  let panel = null;

  const notifyUrl = () => chrome.runtime.sendMessage({ type: 'url', url: location.href }).catch(() => {});

  // l'admin Shopify change d'URL sans recharger la page
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      removePanel();
      notifyUrl();
    }
  }, 1000);
  notifyUrl();

  function removePanel() {
    panel?.remove();
    panel = null;
  }

  const button = (label, onClick, primary) => {
    const node = document.createElement('button');
    node.textContent = label;
    node.style.cssText = `all:unset;cursor:pointer;padding:7px 12px;border-radius:8px;font:600 13px system-ui,sans-serif;${
      primary ? 'background:#1f5fd6;color:#fff;' : 'background:#eef1f6;color:#1d2433;'
    }`;
    node.addEventListener('click', onClick);
    return node;
  };

  const showPanel = (data) => {
    removePanel();
    panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;gap:10px;padding:10px 12px;' +
      'background:#fff;color:#1d2433;border:1px solid #d6dbe6;border-radius:12px;box-shadow:0 10px 30px -10px rgba(20,30,60,.35);' +
      'font:13px system-ui,sans-serif;';

    const dot = document.createElement('span');
    dot.style.cssText = `width:9px;height:9px;border-radius:99px;background:${data.error ? '#c23b3b' : '#2f855a'};flex:none;`;
    const text = document.createElement('span');
    text.textContent = data.error
      ? `Resin Queue : ${data.error}`
      : data.known
        ? `Resin Queue : commande ${data.orderNumber} signalée comme ouverte`
        : 'Resin Queue : commande pas encore synchronisée';
    panel.append(dot, text);

    if (data.chitchatsUrl) {
      panel.append(
        button('Ouvrir sur Chit Chats', async () => {
          try {
            await navigator.clipboard.writeText(String(data.orderNumber ?? '').replace(/^#/, ''));
          } catch {
            /* presse-papiers refusé : on ouvre quand même */
          }
          window.open(data.chitchatsUrl, '_blank', 'noopener');
        }, true),
      );
    }
    panel.append(button('×', removePanel, false));
    document.body.append(panel);
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'presence') return;
    if (message.open || message.error) showPanel(message);
    else removePanel();
  });
})();
