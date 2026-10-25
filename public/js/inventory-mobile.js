/*
 * Inventaire sur le téléphone (/inventory/new et /inventory/mobile) : tout ce qu’on fait avec une carte
 * depuis l’ordinateur, en marchant dans l’atelier : ajouter (photo avec l’appareil), modifier, signaler
 * « à racheter » (avec les questions), « commandé », supprimer, imprimer / télécharger l’étiquette.
 * Même API que le tableau de bord ; aucune dépendance.
 */
import { resizePhoto } from './photo-resize.js';
import { drawCard } from './card-png.js';

const box = document.getElementById('box');
const UNITS = ['unités', 'rouleaux', 'bac', 'boîtes', 'bouteilles', 'paquets', 'sacs'];
let items = [];

const node = (tag, attrs = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  element.append(...[].concat(children).filter((child) => child !== null && child !== undefined && child !== false));
  return element;
};

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Erreur ${response.status}`);
  return payload;
};

const load = async () => {
  items = (await call('/api/inventory')).items;
};

const ago = (iso) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
};
const withUnit = (value, unit) => `${value}${unit ? ` ${unit}` : ''}`;

/* ------------------------------------------------------------ composants */

const nav = (current) =>
  node('nav', { class: 'tabs' }, [
    node('button', { type: 'button', class: current === 'add' ? 'on' : '', text: '➕ Ajouter', onclick: () => showForm(null) }),
    node('button', { type: 'button', class: current === 'list' ? 'on' : '', text: '📋 Objets', onclick: () => showList() }),
  ]);

const screen = (current, ...content) => box.replaceChildren(nav(current), ...content);

const field = (label, control, optional = false) => node('div', { class: 'f' }, [node('label', {}, [label, optional ? node('span', { class: 'opt', text: ' (facultatif)' }) : null]), control]);

/** Questions posées au scan : éditeur (titre, type, couleurs de résine / liste, plusieurs réponses). */
const questionsEditor = (initial = []) => {
  const list = node('div', { class: 'qs' });
  const rows = [];
  const add = (question = {}) => {
    const label = node('input', { type: 'text', maxlength: '60', placeholder: 'Ex. Quelle résine manque ?', autocomplete: 'off', value: question.label ?? '' });
    const type = node('select', {}, [
      node('option', { value: 'choice', text: 'Choix dans une liste', selected: (question.type ?? 'choice') === 'choice' }),
      node('option', { value: 'number', text: 'Un nombre', selected: question.type === 'number' }),
      node('option', { value: 'text', text: 'Texte libre', selected: question.type === 'text' }),
    ]);
    const source = node('select', {}, [
      node('option', { value: 'colors', text: 'Couleurs de résine', selected: !question.type || question.type !== 'choice' || Boolean(question.colors) }),
      node('option', { value: 'list', text: 'Ma liste de choix', selected: question.type === 'choice' && !question.colors }),
    ]);
    const choices = node('input', { type: 'text', placeholder: 'Choix séparés par des virgules : S, M, L', autocomplete: 'off', value: [].concat(question.colors ? [] : question.choices ?? []).join(', ') });
    const multiple = node('input', { type: 'checkbox', checked: Boolean(question.multiple) });
    const choiceBox = node('div', { class: 'qchoice' }, [source, choices, node('label', { class: 'chk' }, [multiple, ' Plusieurs réponses possibles'])]);
    const entry = {};
    const row = node('div', { class: 'q' }, [
      label,
      type,
      choiceBox,
      node('button', { type: 'button', class: 'qdel', text: 'Retirer cette question', onclick: () => { rows.splice(rows.indexOf(entry), 1); row.remove(); } }),
    ]);
    const refresh = () => {
      choiceBox.hidden = type.value !== 'choice';
      choices.hidden = source.value === 'colors';
    };
    type.addEventListener('change', refresh);
    source.addEventListener('change', refresh);
    refresh();
    entry.value = () => ({
      label: label.value,
      type: type.value,
      ...(type.value === 'choice' ? { colors: source.value === 'colors', multiple: multiple.checked, choices: choices.value } : {}),
    });
    rows.push(entry);
    list.append(row);
  };
  for (const question of initial) add(question);
  return {
    node: node('div', {}, [list, node('button', { type: 'button', class: 'qadd', text: '➕ Ajouter une question', onclick: () => add() })]),
    value: () => rows.map((row) => row.value()),
  };
};

/** Formulaire des réponses (comme au scan) : renvoie { node, answers() }. */
const answersForm = (questions) => {
  const fields = questions.map((question) => {
    let read;
    let control;
    if (question.type === 'choice') {
      const inputs = question.choices.map((choice) => node('input', { type: question.multiple ? 'checkbox' : 'radio', name: `ask-${question.id}`, value: choice }));
      control = node('div', { class: 'opts' }, question.choices.map((choice, index) => node('label', { class: 'opt' }, [inputs[index], choice])));
      read = () => {
        const picked = inputs.filter((input) => input.checked).map((input) => input.value);
        return question.multiple ? picked : picked[0];
      };
    } else {
      const input = node('input', { type: question.type === 'number' ? 'number' : 'text', inputmode: question.type === 'number' ? 'decimal' : 'text', autocomplete: 'off' });
      control = input;
      read = () => input.value;
    }
    return { question, read, node: node('fieldset', {}, [node('legend', { text: question.label }), control]) };
  });
  return { node: node('div', {}, fields.map((f) => f.node)), answers: () => Object.fromEntries(fields.map((f) => [f.question.id, f.read()])) };
};

/** Réponses déjà signalées, les identiques regroupées (« Signalé 3 fois »). */
const answerPills = (item) => {
  const groups = new Map();
  for (const detail of item.flag_details ?? []) {
    const key = JSON.stringify(detail.answers.map((a) => [a.label, a.value]));
    const group = groups.get(key) ?? { answers: detail.answers, count: 0, last: detail.at };
    group.count += 1;
    if (detail.at > group.last) group.last = detail.at;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    node('div', { class: 'answer' }, [
      ...group.answers.map((a) => node('span', { class: 'ans' }, [node('small', { text: a.label }), node('strong', { text: a.value })])),
      node('small', { class: 'when', text: group.count > 1 ? `Signalé ${group.count} fois · dernier scan ${ago(group.last)}` : ago(group.last) }),
    ]),
  );
};

/* ----------------------------------------------------------------- vues */

const showList = async (filter = '') => {
  try {
    await load();
  } catch (error) {
    screen('list', node('p', { class: 'err', text: error.message }));
    return;
  }
  const search = node('input', { type: 'text', placeholder: 'Chercher un objet…', value: filter, autocomplete: 'off' });
  const list = node('div', { class: 'items' });
  const paint = () => {
    const query = search.value.trim().toLowerCase();
    const shown = items.filter((item) => !query || item.name.toLowerCase().includes(query));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((item) =>
            node('button', { type: 'button', class: `item${item.status === 'reorder' ? ' reorder' : ''}`, onclick: () => showItem(item.id) }, [
              node('strong', { text: item.name }),
              node('span', { class: 'pill', text: item.status === 'reorder' ? `À racheter · ${ago(item.flagged_at)}` : 'OK' }),
              ...answerPills(item),
            ]),
          )
        : [node('p', { class: 'sub', text: items.length ? 'Aucun objet ne correspond.' : 'Aucun objet pour l’instant : ajoute le premier.' })]),
    );
  };
  search.addEventListener('input', paint);
  paint();
  screen('list', search, list);
};

const showItem = async (id, message = '') => {
  try {
    await load();
  } catch (error) {
    screen('list', node('p', { class: 'err', text: error.message }));
    return;
  }
  const item = items.find((entry) => entry.id === id);
  if (!item) return showList();
  const status = node('p', { class: 'ok', text: message });
  const act = async (run, done) => {
    try {
      await run();
      showItem(id, done);
    } catch (error) {
      status.className = 'err';
      status.textContent = error.message;
    }
  };

  const flagButton = node('button', {
    type: 'button',
    class: 'big warn',
    text: item.status === 'reorder' ? '➕ Il manque aussi…' : '🛒 Il faut en racheter',
    onclick: () => {
      if (!item.questions.length) return act(() => call(`/api/inventory/${id}/flag`, { method: 'POST' }), 'Noté : à racheter.');
      const form = answersForm(item.questions);
      const error = node('p', { class: 'err' });
      const send = node('button', { type: 'submit', class: 'big', text: 'Signaler' });
      const wrap = node('form', {}, [node('h2', { text: `Qu’est-ce qui manque ? — ${item.name}` }), form.node, error, send, node('button', { type: 'button', class: 'link', text: 'Annuler', onclick: () => showItem(id) })]);
      wrap.addEventListener('submit', async (event) => {
        event.preventDefault();
        send.disabled = true;
        try {
          await call(`/api/inventory/${id}/flag`, { method: 'POST', body: { answers: form.answers() } });
          showItem(id, 'Noté : à racheter.');
        } catch (failure) {
          error.textContent = failure.message;
          send.disabled = false;
        }
      });
      screen('list', wrap);
    },
  });

  const png = node('button', {
    type: 'button',
    class: 'big soft',
    text: '💾 Télécharger l’étiquette (image)',
    onclick: async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const canvas = await drawCard(item);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const link = node('a', { href: URL.createObjectURL(blob), download: `etiquette-${item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'objet'}.png` });
        document.body.append(link);
        link.click();
        link.remove();
      } catch (failure) {
        status.className = 'err';
        status.textContent = failure.message;
      }
      button.disabled = false;
    },
  });

  screen(
    'list',
    node('button', { type: 'button', class: 'link', text: '← Tous les objets', onclick: () => showList() }),
    item.has_image ? node('img', { class: 'hero', src: `/api/inventory/${id}/image?v=${Date.now()}`, alt: '' }) : null,
    node('h1', { text: item.name }),
    node('p', { class: 'sub', text: `Scanner quand il en reste ${withUnit(item.reorder_at, item.unit)}${item.order_qty !== null ? ` · À commander : ${withUnit(item.order_qty, item.unit)}` : ''}${item.supplier ? ` · ${item.supplier}` : ''}` }),
    item.notes ? node('p', { class: 'sub', text: item.notes }) : null,
    item.status === 'reorder' ? node('div', { class: 'answers' }, answerPills(item)) : null,
    status,
    flagButton,
    item.status === 'reorder' ? node('button', { type: 'button', class: 'big', text: '✅ Commandé', onclick: () => act(() => call(`/api/inventory/${id}/ordered`, { method: 'POST' }), 'Commande notée.') }) : null,
    node('button', { type: 'button', class: 'big soft', text: '✏️ Modifier', onclick: () => showForm(item) }),
    node('a', { class: 'big soft', href: `/inventory/cards?ids=${id}&style=small`, target: '_blank', rel: 'noopener', text: '🖨 Étiquette 2×1 po' }),
    node('a', { class: 'big soft', href: `/inventory/cards?ids=${id}&style=large`, target: '_blank', rel: 'noopener', text: '🖨 Grande étiquette (4 par feuille)' }),
    png,
    node('button', {
      type: 'button',
      class: 'link danger',
      text: '🗑 Supprimer cet objet',
      onclick: () => {
        if (!confirm(`Supprimer « ${item.name} » ? Sa carte imprimée ne fonctionnera plus.`)) return;
        act(() => call(`/api/inventory/${id}`, { method: 'DELETE' }), '').then(() => showList());
      },
    }),
  );
};

/** Ajouter (item = null) ou modifier un objet : tous les champs de la carte. */
const showForm = async (item) => {
  try {
    await load();
  } catch {
    /* hors ligne : le formulaire reste utilisable, les suggestions manquent */
  }
  const suppliers = [...new Set(items.map((entry) => entry.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  let photo; // undefined : inchangée, null : retirée, texte : nouvelle photo
  const name = node('input', { type: 'text', maxlength: '80', placeholder: 'Ex. Ruban d’emballage', autocomplete: 'off', required: true, value: item?.name ?? '' });
  const minimum = node('input', { type: 'number', min: '0', inputmode: 'numeric', value: item?.reorder_at ?? '2' });
  const unit = node('input', { type: 'text', maxlength: '20', list: 'units', placeholder: 'Ex. rouleaux, bac, boîtes…', autocomplete: 'off', value: item?.unit ?? '' });
  const orderQty = node('input', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'Ex. 4200', value: item?.order_qty ?? '' });
  const supplier = node('input', { type: 'text', maxlength: '80', list: 'suppliers', placeholder: 'Ex. Sticker Mule', autocomplete: 'off', value: item?.supplier ?? '' });
  const notes = node('input', { type: 'text', placeholder: 'Ex. étagère du haut, marque, lien…', autocomplete: 'off', value: item?.notes ?? '' });
  const questions = questionsEditor(item?.questions ?? []);
  const preview = node('img', { alt: '', hidden: !item?.has_image });
  if (item?.has_image) preview.src = `/api/inventory/${item.id}/image?v=${Date.now()}`;
  const file = node('input', { type: 'file', accept: 'image/*', capture: 'environment' });
  const removePhoto = node('button', { type: 'button', class: 'link', text: 'Retirer la photo', hidden: !item?.has_image, onclick: () => { photo = null; preview.hidden = true; removePhoto.hidden = true; file.value = ''; } });
  const error = node('p', { class: 'err' });
  const send = node('button', { class: 'send', type: 'submit', text: item ? 'Enregistrer' : 'Ajouter à l’inventaire' });

  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      photo = await resizePhoto(picked);
      preview.src = photo;
      preview.hidden = false;
      removePhoto.hidden = false;
    } catch (failure) {
      error.textContent = failure.message;
    }
  });

  const form = node('form', {}, [
    node('h1', { text: item ? 'Modifier l’objet' : 'Ajouter à l’inventaire' }),
    node('p', { class: 'sub', text: item ? '' : 'Un objet = une étiquette avec un code QR à imprimer plus tard.' }),
    field('Nom de l’objet', name),
    field('Photo', node('div', { class: 'photo' }, [preview, node('div', {}, [node('label', { class: 'snap' }, [node('span', { text: '📷 Prendre / choisir' }), file]), removePhoto])]), true),
    field('Minimum : scanner quand il en reste', minimum),
    field('Unité', unit, true),
    field('Quantité à commander', orderQty, true),
    field('Commander chez', supplier, true),
    field('Note', notes, true),
    node('datalist', { id: 'units' }, UNITS.map((value) => node('option', { value }))),
    node('datalist', { id: 'suppliers' }, suppliers.map((value) => node('option', { value }))),
    node('details', { class: 'qbox', open: Boolean(item?.questions?.length) }, [
      node('summary', { text: 'Questions au scan (facultatif)' }),
      node('p', { class: 'sub', text: 'Une seule étiquette, mais la personne qui scanne choisit ce qui manque : une ou plusieurs couleurs de résine, un nombre, un texte.' }),
      questions.node,
    ]),
    error,
    send,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    error.textContent = '';
    const body = {
      name: name.value,
      reorder_at: minimum.value,
      unit: unit.value,
      order_qty: orderQty.value,
      supplier: supplier.value,
      notes: notes.value,
      questions: questions.value(),
      ...(photo === undefined ? {} : { image: photo }),
    };
    try {
      const saved = await call(item ? `/api/inventory/${item.id}` : '/api/inventory', { method: item ? 'PATCH' : 'POST', body });
      if (item) showItem(item.id, 'Enregistré.');
      else showDone(saved);
    } catch (failure) {
      error.textContent = failure.message;
      send.disabled = false;
    }
  });

  screen(item ? 'list' : 'add', form);
  if (!item) name.focus();
};

const showDone = (item) =>
  screen(
    'add',
    node('div', { class: 'done' }, [
      node('div', { class: 'bigicon', text: '✅' }),
      node('h1', { text: 'Ajouté !' }),
      node('p', { class: 'sub', text: item.name }),
      node('button', { type: 'button', class: 'big', text: '➕ Ajouter un autre objet', onclick: () => showForm(null) }),
      node('button', { type: 'button', class: 'big soft', text: '📋 Voir l’objet', onclick: () => showItem(item.id) }),
      node('a', { class: 'big soft', href: `/inventory/cards?ids=${item.id}&style=large`, target: '_blank', rel: 'noopener', text: '🖨 Voir la grande étiquette' }),
    ]),
  );

if (document.body.dataset.start === 'list') showList();
else showForm(null);
