const FIELDS = ['appUrl', 'user', 'authUser', 'authPassword'];
const status = document.getElementById('status');

const show = (text, ok) => {
  status.textContent = text;
  status.className = ok ? 'ok' : 'err';
};

chrome.storage.sync.get(FIELDS).then(async (values) => {
  for (const key of FIELDS) document.getElementById(key).value = values[key] ?? '';
  // extension téléchargée depuis l'app : son adresse est déjà connue
  if (!values.appUrl) {
    try {
      const defaults = await (await fetch(chrome.runtime.getURL('defaults.json'))).json();
      if (defaults.appUrl) {
        document.getElementById('appUrl').value = defaults.appUrl;
        show('Adresse de l\'app pré-remplie : ajoute ton nom puis « Enregistrer et tester ».', true);
      }
    } catch {
      /* pas de defaults.json : extension copiée depuis le dépôt */
    }
  }
});

document.getElementById('save').addEventListener('click', async () => {
  const values = Object.fromEntries(FIELDS.map((key) => [key, document.getElementById(key).value.trim()]));
  values.appUrl = values.appUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(values.appUrl)) return show("L'adresse doit commencer par http:// ou https://", false);

  // l'extension doit avoir le droit de parler à l'app (adresse choisie par l'utilisateur)
  const origin = `${new URL(values.appUrl).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) return show("Autorisation refusée : l'extension ne pourra pas joindre l'app.", false);

  await chrome.storage.sync.set(values);

  try {
    const headers = {};
    if (values.authPassword) headers.Authorization = `Basic ${btoa(`${values.authUser || 'admin'}:${values.authPassword}`)}`;
    const response = await fetch(`${values.appUrl}/api/presence`, { headers });
    if (response.status === 401) return show('Enregistré, mais identifiants refusés par l\'app.', false);
    if (!response.ok) return show(`Enregistré, mais l'app répond ${response.status}.`, false);
    show('Enregistré — connexion à l\'app OK ✔', true);
  } catch (error) {
    show(`Enregistré, mais l'app est injoignable : ${error.message}`, false);
  }
});
