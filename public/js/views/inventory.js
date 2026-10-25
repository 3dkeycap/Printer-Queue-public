import { el, fromNow, icon } from '../ui.js';
import { state } from '../store.js';
import { downloadCardPng } from '../card-png.js';
import { toast } from '../ui.js';

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

const printLink = (ids, label) =>
  el('a', { class: 'ghost-btn', href: `/inventory/cards?ids=${ids.join(',')}`, target: '_blank', rel: 'noopener' }, [icon('receipt'), label]);


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

/** Ce qui manque, d'après les réponses données aux scans (une ligne par scan). */
const detailLines = (item) =>
  (item.flag_details ?? []).map((detail) =>
    el('div', { class: 'cell-sub inv-missing' }, `${fromNow(detail.at)} — ${detail.answers.map((answer) => `${answer.label} : ${answer.value}`).join(' · ')}`),
  );

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

/** Formulaire de création : nom + quantité à laquelle il faut scanner. */
// ce qui est tapé dans le formulaire survit à tout redessin de la page (rafraîchissement, autre action)
const createDraft = { name: '', threshold: '2', questions: [], open: false };

const createForm = (actions) => {
  const name = el('input', { id: 'inv-name', placeholder: 'Ex. Gants nitrile M, IPA 99 %, Filtres résine…', required: true, maxlength: '80', value: createDraft.name, oninput: (event) => { createDraft.name = event.target.value; } });
  const threshold = el('input', { id: 'inv-threshold', type: 'number', min: '0', value: createDraft.threshold, inputmode: 'numeric', oninput: (event) => { createDraft.threshold = event.target.value; } });
  const questions = questionsEditor(createDraft.questions, () => { createDraft.questions = questions.value(); });
  const form = el(
    'form',
    {
      class: 'inv-form',
      onsubmit: async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        const item = await actions.createInventoryItem({ name: name.value, reorder_at: threshold.value, questions: questions.value() });
        button.disabled = false;
        if (item) {
          name.value = '';
          createDraft.name = '';
          createDraft.questions = [];
          questions.reset();
          name.focus();
        }
      },
    },
    [
      el('div', { class: 'field inv-grow' }, [el('label', { for: 'inv-name' }, "Nom de l'objet"), name]),
      el('div', { class: 'field' }, [el('label', { for: 'inv-threshold' }, 'Scanner quand il en reste'), threshold]),
      el('details', { class: 'inv-grow inv-questions-box', open: createDraft.open, ontoggle: (event) => { createDraft.open = event.currentTarget.open; } }, [
        el('summary', {}, 'Poser des questions au scan (couleur de résine, quantité…)'),
        el('p', { class: 'field-hint' }, 'Une seule étiquette, mais la personne qui scanne choisit ce qui manque : une ou plusieurs couleurs, un nombre ou un texte.'),
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
    el('p', { class: 'inv-rule' }, ['Scanner quand il en reste ', el('strong', {}, String(item.reorder_at))]),
    item.notes ? el('p', { class: 'cell-sub' }, item.notes) : null,
    item.questions?.length ? el('p', { class: 'cell-sub' }, `Questions au scan : ${item.questions.map((q) => q.label).join(' · ')}`) : null,
    el('img', { class: 'inv-qr', src: `/api/inventory/${item.id}/qr.svg`, alt: `Code QR : ${item.name}`, width: '110', height: '110', loading: 'lazy' }),
    el('div', { class: 'inv-actions' }, [
      printLink([item.id], 'Imprimer la carte'),
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

    toBuy.length ? el('div', { class: 'section-title' }, `À racheter (${toBuy.length})`) : null,
    toBuy.length ? el('article', { class: 'panel inv-buy' }, toBuy.map((item) => toBuyRow(item, actions))) : null,

    el('div', { class: 'section-title inv-title' }, [
      `Tous les objets (${items.length})`,
      items.length ? printLink(items.map((item) => item.id), 'Imprimer toutes les cartes') : null,
    ]),
    items.length
      ? el('div', { class: 'inv-grid' }, items.map((item) => itemCard(item, actions)))
      : el('div', { class: 'empty' }, [icon('box'), el('strong', {}, 'Aucun objet pour l’instant'), 'Crée un premier objet ci-dessus : sa carte avec un code QR est prête à imprimer.']),
    origin
      ? el('p', { class: 'table-foot' }, `Les codes QR ouvrent ${origin}/r/… — le nom d’hôte se règle dans Réglages → Atelier → Inventaire (le changer rend les cartes déjà imprimées inutilisables).`)
      : null,
  );
};
