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

const post = async (path, body) => {
  const response = await fetch(`/r/${encodeURIComponent(token)}/${path}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Erreur ${response.status}`);
  return payload;
};

const showScanned = ({ item, alreadyFlagged, flaggedAt }, answered = []) => {
  const detail = answered.length ? `<p>${answered.map((a) => `${text(a.label)} : <span class="name">${text(a.value)}</span>`).join('<br>')}</p>` : '';
  if (answered.length) {
    html('ok', '✅', 'C’est noté !', `<p>Il faut racheter <span class="name">${text(item.name)}</span>.</p>${detail}<p>Tu n’as rien d’autre à faire, merci.</p>`, '<button id="undo">Je me suis trompé : annuler</button><button id="again">Signaler autre chose</button>');
    document.getElementById('again').addEventListener('click', () => location.reload());
    wireUndo();
    return;
  }
  if (alreadyFlagged) {
    html('ok', '👍', 'Déjà signalé', `<p><span class="name">${text(item.name)}</span> était déjà noté « à racheter » (${ago(flaggedAt)}). Merci, c’est bon !</p>`);
    return;
  }
  html('ok', '✅', 'C’est noté !', `<p>Il faut racheter <span class="name">${text(item.name)}</span>.<br>Tu n’as rien d’autre à faire, merci.</p>`, '<button id="undo">Je me suis trompé : annuler</button>');
  wireUndo();
};

function wireUndo() {
  document.getElementById('undo').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const result = await post('undo');
      html('soft', '↩️', 'Annulé', `<p>Rien n’a été signalé pour <span class="name">${text(result.item.name)}</span>.</p>`);
    } catch (error) {
      html('soft', '🤔', 'Impossible d’annuler', `<p>${text(error.message)}</p>`);
    }
  });
}

/** Objet avec questions : on demande ce qui manque (choix, texte, nombre) avant d'enregistrer. */
const askQuestions = (questions) => {
  const form = document.createElement('form');
  const error = document.createElement('p');
  error.className = 'err';
  const fields = questions.map((question) => {
    const set = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = question.label;
    set.append(legend);
    if (question.type === 'choice') {
      const opts = document.createElement('div');
      opts.className = 'opts';
      for (const choice of question.choices) {
        const label = document.createElement('label');
        label.className = 'opt';
        const input = document.createElement('input');
        input.type = question.multiple ? 'checkbox' : 'radio';
        input.name = question.id;
        input.value = choice;
        label.append(input, document.createTextNode(choice));
        opts.append(label);
      }
      set.append(opts);
    } else {
      const input = document.createElement('input');
      input.type = question.type === 'number' ? 'number' : 'text';
      if (question.type === 'number') input.inputMode = 'decimal';
      input.name = question.id;
      input.autocomplete = 'off';
      set.append(input);
    }
    return { question, set };
  });
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'send';
  send.textContent = 'Envoyer';
  form.append(...fields.map((f) => f.set), error, send);
  box.append(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const answers = {};
    for (const { question } of fields) {
      const inputs = [...form.querySelectorAll(`[name="${question.id}"]`)];
      if (question.type === 'choice') {
        const picked = inputs.filter((input) => input.checked).map((input) => input.value);
        answers[question.id] = question.multiple ? picked : picked[0];
      } else answers[question.id] = inputs[0].value;
    }
    send.disabled = true;
    error.textContent = '';
    try {
      const result = await post('scan', { answers });
      const labelled = fields.map(({ question }) => ({ label: question.label, value: [].concat(answers[question.id]).join(', ') }));
      showScanned(result, labelled);
    } catch (failure) {
      error.textContent = failure.message;
      send.disabled = false;
    }
  });
};

const questions = document.body.dataset.questions ? JSON.parse(document.body.dataset.questions) : null;

if (questions) askQuestions(questions);
else {
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
}
