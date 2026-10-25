import { el, fromNow, icon } from '../ui.js';
import { state } from '../store.js';

const statusPill = (item) =>
  item.status === 'reorder'
    ? el('span', { class: 'status-pill', style: { '--pill': 'var(--warn)' } }, [el('span', { class: 'dot' }), `À racheter · ${fromNow(item.flagged_at)}`])
    : el('span', { class: 'status-pill', style: { '--pill': 'var(--ok)' } }, [el('span', { class: 'dot' }), 'OK']);

const printLink = (ids, label) =>
  el('a', { class: 'ghost-btn', href: `/inventory/cards?ids=${ids.join(',')}`, target: '_blank', rel: 'noopener' }, [icon('receipt'), label]);

/** Formulaire de création : nom + quantité à laquelle il faut scanner. */
const createForm = (actions) => {
  const name = el('input', { id: 'inv-name', placeholder: 'Ex. Gants nitrile M, IPA 99 %, Filtres résine…', required: true, maxlength: '80' });
  const threshold = el('input', { id: 'inv-threshold', type: 'number', min: '0', value: '2', inputmode: 'numeric' });
  const form = el(
    'form',
    {
      class: 'inv-form',
      onsubmit: async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        const item = await actions.createInventoryItem({ name: name.value, reorder_at: threshold.value });
        button.disabled = false;
        if (item) {
          name.value = '';
          name.focus();
        }
      },
    },
    [
      el('div', { class: 'field inv-grow' }, [el('label', { for: 'inv-name' }, "Nom de l'objet"), name]),
      el('div', { class: 'field' }, [el('label', { for: 'inv-threshold' }, 'Scanner quand il en reste'), threshold]),
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
    el('img', { class: 'inv-qr', src: `/api/inventory/${item.id}/qr.svg`, alt: `Code QR : ${item.name}`, width: '110', height: '110', loading: 'lazy' }),
    el('div', { class: 'inv-actions' }, [
      printLink([item.id], 'Imprimer la carte'),
      item.status === 'reorder'
        ? el('button', { class: 'ghost-btn', onclick: () => actions.inventoryAction(item.id, () => actions.api.orderedInventoryItem(item.id), `« ${item.name} » : commande notée`) }, 'Commandé')
        : el('button', { class: 'ghost-btn', title: 'Signaler sans scanner', onclick: () => actions.inventoryAction(item.id, () => actions.api.flagInventoryItem(item.id), `« ${item.name} » : à racheter`) }, 'À racheter'),
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
      ? el('p', { class: 'table-foot' }, `Les codes QR ouvrent ${origin}/r/… (modifiable dans Réglages → Atelier → Inventaire : changer l’adresse rend les cartes déjà imprimées inutilisables).`)
      : null,
  );
};
