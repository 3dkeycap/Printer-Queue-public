/*
 * Page ouverte par le code QR d'un objet d'inventaire (téléphone).
 * Ouvrir l'adresse ne change rien : c'est ce script qui envoie le signalement
 * « il faut racheter », puis affiche la confirmation (avec « Annuler » en cas
 * de scan par erreur).
 */
const token = document.body.dataset.token;
const box = document.getElementById('box');

const html = (tone, big, title, body, extra = '') => {
  box.className = tone;
  box.innerHTML = `<div class="big">${big}</div><h1>${title}</h1>${body}${extra}`;
};
const text = (value) => {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
};
const ago = (iso) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
};

const post = async (path) => {
  const response = await fetch(`/r/${encodeURIComponent(token)}/${path}`, { method: 'POST' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Erreur ${response.status}`);
  return payload;
};

const showScanned = ({ item, alreadyFlagged, flaggedAt }) => {
  if (alreadyFlagged) {
    html('ok', '👍', 'Déjà signalé', `<p><span class="name">${text(item.name)}</span> était déjà noté « à racheter » (${ago(flaggedAt)}). Merci, c’est bon !</p>`);
    return;
  }
  html('ok', '✅', 'C’est noté !', `<p>Il faut racheter <span class="name">${text(item.name)}</span>.<br>Tu n’as rien d’autre à faire, merci.</p>`, '<button id="undo">Je me suis trompé : annuler</button>');
  document.getElementById('undo').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const result = await post('undo');
      html('soft', '↩️', 'Annulé', `<p>Rien n’a été signalé pour <span class="name">${text(result.item.name)}</span>.</p>`);
    } catch (error) {
      html('soft', '🤔', 'Impossible d’annuler', `<p>${text(error.message)}</p>`);
    }
  });
};

post('scan')
  .then(showScanned)
  .catch((error) =>
    html(
      'soft',
      '😕',
      'Pas envoyé',
      `<p>${text(error.message)}</p><p>Ce n’est pas ta faute. Vérifie que tu es bien sur le réseau de l’atelier, puis scanne à nouveau.</p>`,
      '<button id="retry">Réessayer</button>',
    ),
  )
  .finally(() => document.getElementById('retry')?.addEventListener('click', () => location.reload()));
