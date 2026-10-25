import { el, fromNow, icon } from '../ui.js';
import { state } from '../store.js';
import { downloadCardPng } from '../card-png.js';
import { toast } from '../ui.js';
import { photoField } from '../photo.js';

const statusPill = (item) =>
  item.status === 'reorder'
    ? el('span', { class: 'status-pill', style: { '--pill': 'var(--warn)' } }, [el('span', { class: 'dot' }), `À racheter · ${fromNow(item.flagged_at)}`])
    : el('span', { class: 'status-pill', style: { '--pill': 'var(--ok)' } }, [el('span', { class: 'dot' }), 'OK']);

const pngButton = (item) =>
  el(
    'button',
    {
      class: 'ghost-btn',
      title: 'Télécharger la carte en image PNG',
      onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await downloadCardPng(item);
        } catch (error) {
          toast(error.message, 'err');
        }
        button.disabled = false;
      },
    },
    [icon('save'), 'PNG'],
  );

// deux styles d'étiquette : petite (2 po × 1 po, imprimante d'étiquettes) ou grande (4 par feuille Lettre)
const printLink = (ids, label, style = 'small', title = '') =>
  el('a', { class: 'ghost-btn', title, href: `/inventory/cards?ids=${ids.join(',')}&style=${style}`, target: '_blank', rel: 'noopener' }, [icon('receipt'), label]);


/** Libellé court d'une question, pour la liste. */
const TYPE_LABEL = { choice: 'Choix', text: 'Texte libre', number: 'Nombre' };

/**
 * Éditeur des questions posées au scan (ex. « Quelle résine ? » = couleurs de résine, plusieurs
 * possibles). Renvoie { node, value() } : value() donne la liste à envoyer à l'API.
 */
export const questionsEditor = (initial = [], onChange = () => {}) => {
  const list = el('div', { class: 'inv-questions' });
  const rows = [];

  const addRow = (question = {}) => {
    const label = el('input', { placeholder: 'Ex. Quelle résine manque ?', maxlength: '60', value: question.label ?? '' });
    const type = el(
      'select',
      {},
      Object.entries(TYPE_LABEL).map(([value, text]) => el('option', { value, selected: (question.type ?? 'choice') === value }, text)),
    );
    const source = el('select', {}, [
      el('option', { value: 'list', selected: !question.colors }, 'Ma liste de choix'),
      el('option', { value: 'colors', selected: Boolean(question.colors) }, 'Couleurs de résine (catalogue)'),
    ]);
    const choices = el('input', { placeholder: 'Choix séparés par des virgules : S, M, L', value: [].concat(question.choices ?? []).join(', ') });
    const multiple = el('input', { type: 'checkbox', checked: Boolean(question.multiple) });
    const multipleLabel = el('label', { class: 'inv-check' }, [multiple, 'Plusieurs réponses possibles']);
    const choiceBox = el('div', { class: 'inv-q-choice' }, [source, choices, multipleLabel]);
    const row = el('div', { class: 'inv-q' }, [
      el('div', { class: 'inv-q-head' }, [
        label,
        type,
        el('button', { class: 'mini-btn danger', type: 'button', title: 'Retirer la question', onclick: () => { rows.splice(rows.indexOf(entry), 1); row.remove(); onChange(); } }, icon('trash')),
      ]),
      choiceBox,
    ]);
    const refresh = () => {
      choiceBox.hidden = type.value !== 'choice';
      choices.hidden = source.value === 'colors';
    };
    type.addEventListener('change', refresh);
    source.addEventListener('change', refresh);
    refresh();
    const entry = {
      value: () => ({
        label: label.value,
        type: type.value,
        ...(type.value === 'choice' ? { colors: source.value === 'colors', multiple: multiple.checked, choices: choices.value } : {}),
      }),
    };
    rows.push(entry);
    list.append(row);
  };

  for (const question of initial) addRow(question);
  list.addEventListener('input', () => onChange());
  list.addEventListener('change', () => onChange());
  const add = el('button', { class: 'ghost-btn', type: 'button', onclick: () => { addRow(); onChange(); } }, [icon('plus'), 'Ajouter une question']);
  const node = el('div', {}, [list, add]);
  return {
    node,
    value: () => rows.map((row) => row.value()),
    reset: () => {
      rows.length = 0;
      list.replaceChildren();
    },
  };
};

/**
 * Ce qui manque, d'après les réponses données aux scans (une ligne par scan). Les réponses sont en gros,
 * aussi lisibles que le nom de l'objet : c'est ce qu'on lit pour savoir quoi commander.
 */
const detailLines = (item) => {
  // plusieurs employés répondent pareil : une seule ligne, « signalé N fois » et l'heure du dernier scan
  const groups = new Map();
  for (const detail of item.flag_details ?? []) {
    const key = JSON.stringify(detail.answers.map((answer) => [answer.label, answer.value]));
    const group = groups.get(key) ?? { answers: detail.answers, count: 0, last: detail.at };
    group.count += 1;
    if (detail.at > group.last) group.last = detail.at;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    el('div', { class: 'inv-answer' }, [
      ...group.answers.map((answer) => el('span', { class: 'inv-ans' }, [el('small', {}, answer.label), el('strong', {}, answer.value)])),
      el('small', { class: 'inv-when' }, group.count > 1 ? `Signalé ${group.count} fois · dernier scan ${fromNow(group.last)}` : fromNow(group.last)),
    ]),
  );
};

/**
 * Formulaire des questions d'un objet (le même que sur le téléphone, au scan) : sert au bouton
 * « À racheter » du tableau de bord. answers() renvoie { q0: …, q1: … } pour l'API.
 */
export const questionsForm = (questions) => {
  const fields = questions.map((question) => {
    const legend = el('label', { class: 'lbl' }, question.label);
    let control;
    if (question.type === 'choice') {
      const inputs = question.choices.map((choice) =>
        el('input', { type: question.multiple ? 'checkbox' : 'radio', name: `ask-${question.id}`, value: choice }),
      );
      control = el('div', { class: 'inv-opts' }, question.choices.map((choice, index) => el('label', { class: 'inv-opt' }, [inputs[index], choice])));
      control.read = () => {
        const picked = inputs.filter((input) => input.checked).map((input) => input.value);
        return question.multiple ? picked : picked[0];
      };
    } else {
      const input = el('input', { type: question.type === 'number' ? 'number' : 'text', inputmode: question.type === 'number' ? 'decimal' : 'text', autocomplete: 'off' });
      control = el('div', {}, input);
      control.read = () => input.value;
    }
    return { question, control, node: el('div', { class: 'field' }, [legend, control]) };
  });
  return {
    node: el('div', {}, fields.map((field) => field.node)),
    answers: () => Object.fromEntries(fields.map(({ question, control }) => [question.id, control.read()])),
  };
};

/** Suggestions d'unités (le texte reste libre). */
export const UNITS = ['unités', 'rouleaux', 'bac', 'boîtes', 'bouteilles', 'paquets', 'sacs'];
export const unitsList = () => el('datalist', { id: 'inv-units' }, UNITS.map((value) => el('option', { value })));

/** « 2 rouleaux » : le nombre suivi de l'unité choisie (facultative). */
const withUnit = (value, unit) => `${value}${unit ? ` ${unit}` : ''}`;

/** Formulaire de création : nom + quantité à laquelle il faut scanner. */
// ce qui est tapé dans le formulaire survit à tout redessin de la page (rafraîchissement, autre action)
const createDraft = { name: '', threshold: '2', unit: '', supplier: '', orderQty: '', image: undefined, questions: [], open: false };

const createForm = (actions) => {
  const name = el('input', { id: 'inv-name', placeholder: 'Ex. Gants nitrile M, IPA 99 %, Filtres résine…', required: true, maxlength: '80', value: createDraft.name, oninput: (event) => { createDraft.name = event.target.value; } });
  const threshold = el('input', { id: 'inv-threshold', type: 'number', min: '0', value: createDraft.threshold, inputmode: 'numeric', oninput: (event) => { createDraft.threshold = event.target.value; } });
  const questions = questionsEditor(createDraft.questions, () => { createDraft.questions = questions.value(); });
  const unit = el('input', { id: 'inv-unit', placeholder: 'rouleaux, bac…', maxlength: '20', list: 'inv-units', value: createDraft.unit, oninput: (event) => { createDraft.unit = event.target.value; } });
  const supplier = el('input', { id: 'inv-supplier', placeholder: 'Ex. Sticker Mule', maxlength: '80', value: createDraft.supplier, oninput: (event) => { createDraft.supplier = event.target.value; } });
  const orderQty = el('input', { id: 'inv-orderqty', type: 'number', min: '0', inputmode: 'numeric', placeholder: 'Ex. 4200', value: createDraft.orderQty, oninput: (event) => { createDraft.orderQty = event.target.value; } });
  const photo = photoField({ initial: createDraft.image, onChange: (value) => { createDraft.image = value; } });
  const form = el(
    'form',
    {
      class: 'inv-form',
      onsubmit: async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        const item = await actions.createInventoryItem({ name: name.value, reorder_at: threshold.value, unit: unit.value, order_qty: orderQty.value, supplier: supplier.value, image: photo.value() ?? undefined, questions: questions.value() });
        button.disabled = false;
        if (item) {
          name.value = '';
          createDraft.name = '';
          Object.assign(createDraft, { unit: '', supplier: '', orderQty: '', image: undefined, questions: [] });
          supplier.value = '';
          unit.value = '';
          orderQty.value = '';
          photo.node.replaceWith(photoField({ onChange: (value) => { createDraft.image = value; } }).node);
          questions.reset();
          name.focus();
        }
      },
    },
    [
      el('div', { class: 'field inv-grow' }, [el('label', { for: 'inv-name' }, "Nom de l'objet"), name]),
      el('div', { class: 'field' }, [el('label', { for: 'inv-threshold' }, 'Scanner quand il en reste'), threshold]),
      el('div', { class: 'field' }, [el('label', { for: 'inv-unit' }, 'Unité'), unit, unitsList()]),
      el('details', { class: 'inv-grow inv-questions-box', open: createDraft.open, ontoggle: (event) => { createDraft.open = event.currentTarget.open; } }, [
        el('summary', {}, 'Plus d’options : photo, fournisseur, quantité à commander, questions au scan'),
        el('p', { class: 'field-hint' }, 'La photo, le fournisseur et la quantité à commander servent à la grande étiquette (facultatifs). Les questions : une seule étiquette, mais la personne qui scanne choisit ce qui manque (couleur de résine, nombre, texte).'),
        el('div', { class: 'inv-extra' }, [
          el('div', { class: 'field' }, [el('label', { for: 'inv-supplier' }, 'Commander chez'), supplier]),
          el('div', { class: 'field' }, [el('label', { for: 'inv-orderqty' }, 'Quantité à commander'), orderQty]),
          el('div', { class: 'field' }, [el('label', {}, 'Photo'), photo.node]),
        ]),
        el('div', { class: 'section-title' }, 'Questions au scan'),
        questions.node,
      ]),
      el('button', { class: 'primary-btn', type: 'submit' }, [icon('plus'), 'Créer la carte']),
    ],
  );
  return el('article', { class: 'panel settings-panel' }, [
    el('header', { class: 'panel-head' }, [el('h3', {}, 'Nouvel objet')]),
    el('p', { class: 'sub' }, "On obtient une carte avec le nom, la quantité et un code QR. Imprime-la et colle-la sur l'étagère ou la boîte : quand il n'en reste plus que cette quantité, il suffit de scanner le code avec un téléphone."),
    form,
  ]);
};

const toBuyRow = (item, actions) =>
  el('div', { class: 'inv-buy-row' }, [
    el('div', { class: 'inv-grow' }, [
      el('strong', {}, item.name),
      el('div', { class: 'cell-sub' }, `Signalé ${fromNow(item.flagged_at)}${item.scan_count > 1 ? ` · scanné ${item.scan_count} fois` : ''}`),
      ...detailLines(item),
    ]),
    el(
      'button',
      {
        class: 'primary-btn',
        title: "C'est commandé : l'objet repasse à OK",
        onclick: () => actions.inventoryAction(item.id, () => actions.api.orderedInventoryItem(item.id), `« ${item.name} » : commande notée`),
      },
      [icon('check'), 'Commandé'],
    ),
  ]);

const itemCard = (item, actions) =>
  el('article', { class: `inv-card${item.status === 'reorder' ? ' is-reorder' : ''}` }, [
    el('div', { class: 'inv-card-top' }, [el('h4', {}, item.name), statusPill(item)]),
    el('p', { class: 'inv-rule' }, ['Scanner quand il en reste ', el('strong', {}, withUnit(item.reorder_at, item.unit))]),
    item.status === 'reorder' ? el('div', { class: 'inv-answers' }, detailLines(item)) : null,
    item.notes ? el('p', { class: 'cell-sub' }, item.notes) : null,
    item.questions?.length ? el('p', { class: 'cell-sub' }, `Questions au scan : ${item.questions.map((q) => q.label).join(' · ')}`) : null,
    el('img', { class: 'inv-qr', src: `/api/inventory/${item.id}/qr.svg`, alt: `Code QR : ${item.name}`, width: '110', height: '110', loading: 'lazy' }),
    el('div', { class: 'inv-actions' }, [
      printLink([item.id], 'Étiquette 2×1 po', 'small', 'Petite étiquette : nom, minimum et QR'),
      printLink([item.id], 'Grande étiquette', 'large', 'Grande étiquette (4 par feuille Lettre) : photo, QR, minimum, quantité à commander, fournisseur'),
      pngButton(item),
      item.status === 'reorder'
        ? el('button', { class: 'ghost-btn', onclick: () => actions.inventoryAction(item.id, () => actions.api.orderedInventoryItem(item.id), `« ${item.name} » : commande notée`) }, 'Commandé')
        : el('button', { class: 'ghost-btn', title: 'Signaler sans scanner', onclick: () => actions.flagInventoryItem(item) }, 'À racheter'),
      // déjà à racheter : une autre variante peut manquer (autre couleur…)
      item.status === 'reorder' && item.questions?.length
        ? el('button', { class: 'ghost-btn', title: 'Signaler aussi autre chose', onclick: () => actions.flagInventoryItem(item) }, 'Il manque aussi…')
        : null,
      el('button', { class: 'mini-btn', title: 'Modifier', onclick: () => actions.editInventoryItem(item) }, 'Modifier'),
      el('button', { class: 'mini-btn danger', title: 'Supprimer', onclick: () => actions.deleteInventoryItem(item) }, icon('trash')),
    ]),
  ]);

export const renderInventory = (root, actions) => {
  const items = state.inventory ?? [];
  const toBuy = items.filter((item) => item.status === 'reorder');
  const origin = items[0] ? new URL(items[0].scan_url).origin : null;

  root.append(
    createForm(actions),
    // ajouter des objets en se promenant : la page du téléphone s'ouvre en scannant ce code
    el('article', { class: 'panel settings-panel inv-phone' }, [
      el('img', { src: '/api/inventory/phone-qr.svg', alt: 'Code QR : ajouter depuis le téléphone', width: '96', height: '96' }),
      el('div', {}, [
        el('h3', {}, 'Ajouter depuis le téléphone'),
        el('p', { class: 'sub' }, 'Scanne ce code avec ton téléphone : un formulaire simple (photo, nom, minimum, fournisseur) pour ajouter un objet en te promenant dans l’atelier. Imprime-le pour le coller dans l’atelier.'),
        el('div', { class: 'inv-actions' }, [
          el('a', { class: 'ghost-btn', href: '/inventory/new', target: '_blank', rel: 'noopener' }, 'Ouvrir la page'),
          el('a', { class: 'ghost-btn', title: 'Étiquette 2 × 1 po à coller dans l’atelier', href: '/inventory/add-card?style=small', target: '_blank', rel: 'noopener' }, [icon('receipt'), 'Étiquette 2×1 po']),
          el('a', { class: 'ghost-btn', title: 'Grande étiquette (feuille Lettre)', href: '/inventory/add-card?style=large', target: '_blank', rel: 'noopener' }, [icon('receipt'), 'Grande étiquette']),
        ]),
      ]),
    ]),

    toBuy.length ? el('div', { class: 'section-title' }, `À racheter (${toBuy.length})`) : null,
    toBuy.length ? el('article', { class: 'panel inv-buy' }, toBuy.map((item) => toBuyRow(item, actions))) : null,

    el('div', { class: 'section-title inv-title' }, [
      `Tous les objets (${items.length})`,
      items.length ? printLink(items.map((item) => item.id), 'Toutes en 2×1 po', 'small') : null,
      items.length ? printLink(items.map((item) => item.id), 'Toutes en grand (4/feuille)', 'large') : null,
    ]),
    items.length
      ? el('div', { class: 'inv-grid' }, items.map((item) => itemCard(item, actions)))
      : el('div', { class: 'empty' }, [icon('box'), el('strong', {}, 'Aucun objet pour l’instant'), 'Crée un premier objet ci-dessus : sa carte avec un code QR est prête à imprimer.']),
    origin
      ? el('p', { class: 'table-foot' }, `Les codes QR ouvrent ${origin}/r/… — le nom d’hôte se règle dans Réglages → Atelier → Inventaire (le changer rend les cartes déjà imprimées inutilisables).`)
      : null,
  );
};
