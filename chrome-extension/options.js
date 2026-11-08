const FIELDS = ['appUrl', 'user', 'chitchatsClientId', 'authUser', 'authPassword'];
const REPO = '3dkeycap/Printer-Queue-public';
const BRANCH = 'main';
const DIR = 'chrome-extension';
// fichiers propres à cette installation : jamais écrasés par une mise à jour
const LOCAL_ONLY = new Set(['defaults.json']);

const $ = (id) => document.getElementById(id);
const show = (node, text, ok) => {
  node.textContent = text;
  node.className = `msg ${ok ? 'ok' : 'err'}`;
};

const loadDefaults = async () => {
  try {
    return await (await fetch(chrome.runtime.getURL('defaults.json'))).json();
  } catch {
    return {}; // extension copiée depuis le dépôt : pas de valeurs pré-remplies
  }
};

/* ------------------------------------------------------------- connexion */

const initSettings = async () => {
  const values = await chrome.storage.sync.get(FIELDS);
  const defaults = await loadDefaults();
  for (const key of FIELDS) $(key).value = values[key] ?? '';
  let prefilled = false;
  if (!values.appUrl && defaults.appUrl) {
    $('appUrl').value = defaults.appUrl;
    prefilled = true;
  }
  if (!values.chitchatsClientId && defaults.chitchatsClientId) {
    $('chitchatsClientId').value = defaults.chitchatsClientId;
    prefilled = true;
  }
  if (prefilled) show($('status'), 'Valeurs de l\'app pré-remplies : ajoute ton nom puis « Enregistrer et tester ».', true);
};

$('save').addEventListener('click', async () => {
  const values = Object.fromEntries(FIELDS.map((key) => [key, $(key).value.trim()]));
  values.appUrl = values.appUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(values.appUrl)) return show($('status'), "L'adresse doit commencer par http:// ou https://", false);

  // l'extension doit avoir le droit de parler à l'app (adresse choisie par l'utilisateur)
  const granted = await chrome.permissions.request({ origins: [`${new URL(values.appUrl).origin}/*`] });
  if (!granted) return show($('status'), "Autorisation refusée : l'extension ne pourra pas joindre l'app.", false);

  await chrome.storage.sync.set(values);

  try {
    const headers = {};
    if (values.authPassword) headers.Authorization = `Basic ${btoa(`${values.authUser || 'admin'}:${values.authPassword}`)}`;
    const response = await fetch(`${values.appUrl}/api/presence`, { headers });
    if (response.status === 401) return show($('status'), 'Enregistré, mais identifiants refusés par l\'app.', false);
    if (!response.ok) return show($('status'), `Enregistré, mais l'app répond ${response.status}.`, false);
    show($('status'), 'Enregistré — connexion à l\'app OK ✔', true);
  } catch (error) {
    show($('status'), `Enregistré, mais l'app est injoignable : ${error.message}`, false);
  }
});

/* ------------------------------------------------- dossier de l'extension */

// le dossier choisi est gardé (IndexedDB) pour que les mises à jour suivantes soient en un clic
const idb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('resin-queue', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const handleStore = async (mode, fn) => {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', mode);
    const request = fn(tx.objectStore('handles'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
};
const getFolder = () => handleStore('readonly', (store) => store.get('extensionDir'));
const setFolder = (handle) => handleStore('readwrite', (store) => store.put(handle, 'extensionDir'));

/** Vérifie que le dossier choisi est bien celui de CETTE extension. */
const checkFolder = async (handle) => {
  try {
    const file = await (await handle.getFileHandle('manifest.json')).getFile();
    const manifest = JSON.parse(await file.text());
    return manifest.name === chrome.runtime.getManifest().name;
  } catch {
    return false;
  }
};

const pickFolder = async () => {
  const handle = await window.showDirectoryPicker({ id: 'resin-queue-extension', mode: 'readwrite' });
  if (!(await checkFolder(handle))) {
    throw new Error("Ce dossier ne contient pas l'extension Resin Queue (manifest.json introuvable). Choisis le dossier chargé dans chrome://extensions.");
  }
  await setFolder(handle);
  return handle;
};

/* ------------------------------------------------------------ mise à jour */

const remoteManifest = async () => {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GitHub répond ${response.status}`);
  return response.json();
};

const newer = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
};

const refreshVersions = async () => {
  const local = chrome.runtime.getManifest().version;
  try {
    const remote = (await remoteManifest()).version;
    $('versions').textContent = newer(remote, local)
      ? `Installée : v${local} — disponible sur GitHub : v${remote}`
      : `Installée : v${local} — à jour ✔`;
    await chrome.storage.local.set({ updateAvailable: newer(remote, local) ? remote : null });
  } catch (error) {
    $('versions').textContent = `Installée : v${local} — GitHub injoignable (${error.message})`;
  }
};

$('pick').addEventListener('click', async () => {
  try {
    await pickFolder();
    show($('update-status'), 'Dossier enregistré.', true);
  } catch (error) {
    if (error.name !== 'AbortError') show($('update-status'), error.message, false);
  }
});

$('update').addEventListener('click', async () => {
  const button = $('update');
  button.disabled = true;
  try {
    let folder = await getFolder();
    if (!folder || !(await checkFolder(folder))) folder = await pickFolder();
    if ((await folder.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error("Chrome n'a pas donné l'accès en écriture au dossier.");
    }

    show($('update-status'), 'Téléchargement depuis GitHub…', true);
    // liste récursive (icons/…) : chemin relatif au dossier de l'extension
    const listDir = async (dir) => {
      const listing = await fetch(`https://api.github.com/repos/${REPO}/contents/${dir}?ref=${BRANCH}`, { cache: 'no-store' });
      if (!listing.ok) throw new Error(`GitHub répond ${listing.status} (trop de requêtes ? réessaie dans quelques minutes)`);
      const entries = [];
      for (const entry of await listing.json()) {
        if (entry.type === 'dir') entries.push(...(await listDir(entry.path)));
        else if (entry.type === 'file') entries.push({ ...entry, name: entry.path.slice(DIR.length + 1) });
      }
      return entries;
    };
    const files = (await listDir(DIR)).filter((entry) => !LOCAL_ONLY.has(entry.name));

    // tout télécharger AVANT d'écrire : pas d'extension à moitié mise à jour
    const downloads = [];
    for (const entry of files) {
      const response = await fetch(`${entry.download_url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Téléchargement de ${entry.name} impossible (${response.status})`);
      downloads.push({ name: entry.name, data: await response.arrayBuffer() });
    }
    // garde-fou : tout fichier exigé par le nouveau manifest doit être là, sinon Chrome
    // refuserait de charger l'extension -> on n'écrit rien du tout
    const manifestFile = downloads.find((file) => file.name === 'manifest.json');
    if (!manifestFile) throw new Error('manifest.json absent sur GitHub : mise à jour annulée.');
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.data));
    const required = [
      ...Object.values(manifest.icons ?? {}),
      ...Object.values(manifest.action?.default_icon ?? {}),
      manifest.background?.service_worker,
      manifest.options_page,
      manifest.action?.default_popup,
      ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
    ].filter(Boolean);
    const got = new Set(downloads.map((file) => file.name));
    const missing = [...new Set(required)].filter((name) => !got.has(name));
    if (missing.length) throw new Error(`Fichiers manquants sur GitHub (${missing.join(', ')}) : mise à jour annulée, rien n'a été modifié.`);

    for (const { name, data } of downloads) {
      const parts = name.split('/');
      let dir = folder;
      for (const segment of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(segment, { create: true });
      const writable = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
      await writable.write(data);
      await writable.close();
    }

    await chrome.storage.local.set({ updateAvailable: null });
    show($('update-status'), `${downloads.length} fichier(s) mis à jour. Rechargement de l'extension…`, true);
    setTimeout(() => chrome.runtime.reload(), 1200);
  } catch (error) {
    if (error.name === 'AbortError') show($('update-status'), 'Mise à jour annulée.', false);
    else show($('update-status'), error.message, false);
    button.disabled = false;
  }
});

/* ---------------------------------------------------------- mode démo (tests) */

const DEMO_PAGES = {
  shopify: 'demo/shopify/orders/index.html',
  chitchats: 'demo/chitchats/index.html',
};
const openDemo = (...names) => {
  for (const name of names) chrome.tabs.create({ url: chrome.runtime.getURL(DEMO_PAGES[name]), active: name === names[0] });
};
$('demo-shopify').addEventListener('click', () => openDemo('shopify'));
$('demo-chitchats').addEventListener('click', () => openDemo('chitchats'));
$('demo-both').addEventListener('click', () => openDemo('shopify', 'chitchats'));
// tutoriel : la fausse commande #1001 avec la visite guidée (demo/tour.js, déclenchée par ?tutoriel)
$('tour').addEventListener('click', () => chrome.tabs.create({ url: `${chrome.runtime.getURL('demo/shopify/orders/1001/index.html')}?tutoriel=1` }));

initSettings();
refreshVersions();
if (location.hash === '#update') {
  $('update-section').classList.add('flash');
  $('update-section').scrollIntoView();
}

/* ------------------------------------------------------ impression directe (QZ Tray) */

// l'imprimante est propre à CET ordinateur : chrome.storage.local (pas sync)
const fillPrinters = (names, current) => {
  const select = $('qz-printer');
  const options = [['', '— aucune : télécharger le PNG —'], ...[...new Set([...names, current].filter(Boolean))].map((name) => [name, name])];
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === (current ?? '');
      return option;
    }),
  );
};

const initQz = async () => {
  const { qzPrinter } = await chrome.storage.local.get('qzPrinter');
  fillPrinters([], qzPrinter);
};

$('qz-cert').addEventListener('click', async () => {
  const { appUrl } = await chrome.storage.sync.get('appUrl');
  if (!appUrl) return show($('qz-status'), "Renseigne d'abord l'adresse de l'app (en haut).", false);
  chrome.tabs.create({ url: `${appUrl}/api/qz/certificate.crt` });
});

$('qz-find').addEventListener('click', async () => {
  show($('qz-status'), 'Connexion à QZ Tray…', true);
  const result = await chrome.runtime.sendMessage({ type: 'qz-printers' });
  if (!result || result.error) return show($('qz-status'), result?.error ?? 'pas de réponse', false);
  const { qzPrinter } = await chrome.storage.local.get('qzPrinter');
  fillPrinters(result.printers, qzPrinter);
  show($('qz-status'), `${result.printers.length} imprimante(s) trouvée(s)${result.default ? ` (par défaut : ${result.default})` : ''}. Choisis celle des étiquettes 2 × 1 po.`, true);
});

$('qz-printer').addEventListener('change', async () => {
  const qzPrinter = $('qz-printer').value;
  await chrome.storage.local.set({ qzPrinter });
  show($('qz-status'), qzPrinter ? `Les étiquettes VAT sortiront sur « ${qzPrinter} ».` : 'Plus d’impression directe : l’étiquette VAT sera téléchargée.', true);
});

$('qz-test').addEventListener('click', async () => {
  const printer = $('qz-printer').value;
  if (!printer) return show($('qz-status'), 'Choisis d’abord une imprimante.', false);
  // même format que l'étiquette VAT : 600 × 300 px (2 × 1 po à 300 dpi)
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 600, 300);
  ctx.fillStyle = '#000';
  ctx.font = '800 64px system-ui, Arial, sans-serif';
  ctx.fillText('TEST VAT', 24, 120);
  ctx.font = '700 36px system-ui, Arial, sans-serif';
  ctx.fillText('3D Keycap Lab · 2 × 1 po', 24, 220);
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 596, 296);
  show($('qz-status'), 'Impression…', true);
  const result = await chrome.runtime.sendMessage({ type: 'qz-print', printer, image: canvas.toDataURL('image/png').split(',')[1] });
  show($('qz-status'), result?.ok ? `Test envoyé à « ${result.printer} ».` : `Échec : ${result?.error ?? 'pas de réponse'}`, Boolean(result?.ok));
});

initQz();
