const $ = (id) => document.getElementById(id);
const ORDER_URL = [/^https:\/\/admin\.shopify\.com\/store\/[^/]+\/orders\/(\d+)/, /^https:\/\/[^/]+\.myshopify\.com\/admin\/orders\/(\d+)/];

const init = async () => {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  $('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('update').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#update') }));

  // une mise à jour attend-elle sur GitHub ? (vérifiée par le service worker)
  const { updateAvailable } = await chrome.storage.local.get('updateAvailable');
  if (updateAvailable && updateAvailable !== chrome.runtime.getManifest().version) {
    $('update').textContent = `Mettre à jour (v${updateAvailable})`;
    $('update').classList.add('available');
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isOrder = ORDER_URL.some((pattern) => pattern.test(tab?.url ?? ''));
  if (!isOrder) {
    $('hint').textContent = "Le bouton s'active sur la page d'une commande Shopify.";
    $('status').textContent = 'Pas sur une commande';
    return;
  }

  const page = await chrome.tabs.sendMessage(tab.id, { type: 'page-order' }).catch(() => null);
  const info = await chrome.runtime.sendMessage({ type: 'resolve', tabId: tab.id, pageOrderNumber: page?.orderNumber });

  $('order').innerHTML = '';
  $('order').append('Commande', Object.assign(document.createElement('b'), { textContent: info.orderNumber ?? 'numéro introuvable' }));

  if (info.chitchatsUrl) {
    $('open').disabled = false;
    $('hint').textContent = 'Le numéro de commande est aussi copié : colle-le si besoin.';
    $('open').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(info.orderNumber ?? '').replace(/^#/, ''));
      } catch {
        /* sans importance */
      }
      await chrome.tabs.create({ url: info.chitchatsUrl });
      window.close();
    });
  } else {
    $('hint').textContent = info.orderNumber
      ? 'Ajoute le Client ID Chit Chats dans Réglages pour activer le bouton.'
      : 'Numéro de commande introuvable sur la page.';
  }

  if (info.app?.ok) {
    $('dot').style.background = '#2f9e5b';
    $('status').textContent = 'Signalée à l\'app (« Ouvert sur Shopify »)';
  } else if (info.app?.error) {
    $('dot').style.background = '#d14b4b';
    $('status').textContent = info.app.error;
  } else {
    $('status').textContent = 'App pas encore jointe';
  }
};

init();
