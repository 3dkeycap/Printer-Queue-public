import { el, fromNow, icon, swatch } from '../ui.js';
import { groupParts, printerOptions, state, statusMeta, uvOptions } from '../store.js';
import { buildCommentTags } from '../comment-select.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

const select = (options, value, onChange, placeholder) => {
  const node = el(
    'select',
    { class: 'cell-select', onclick: (event) => event.stopPropagation() },
    [
      el('option', { value: '', selected: !value }, placeholder),
      ...options.map((option) => el('option', { value: option, selected: option === value }, option)),
      // une valeur saisie autrefois et retirée des réglages reste sélectionnable
      value && !options.includes(value) ? el('option', { value, selected: true }, value) : null,
    ].filter(Boolean),
  );
  node.addEventListener('change', (event) => onChange(event.target.value || null));
  return node;
};

const statusSelect = (part, actions) => {
  const node = el(
    'select',
    { class: 'cell-select status', style: { '--pill': statusMeta(part.status).accent }, onclick: (e) => e.stopPropagation() },
    state.meta.statuses.map((status) =>
      el('option', { value: status.key, selected: status.key === part.status }, status.labelFr),
    ),
  );
  node.addEventListener('change', (event) => actions.move([part.id], event.target.value, { force: true }));
  return node;
};

const row = (part, actions) =>
  el(
    'tr',
    {
      class: state.selection.has(part.id) ? 'is-selected' : '',
      onclick: () => actions.openPart(part.id),
    },
    [
      el('td', {}, el('input', {
        type: 'checkbox',
        checked: state.selection.has(part.id),
        onclick: (event) => {
          event.stopPropagation();
          actions.toggleSelection(part.id);
        },
      })),
      el('td', {}, statusSelect(part, actions)),
      el('td', {}, [
        el('div', { class: 'cell-name' }, part.name),
        el('div', { class: 'cell-sub' }, [part.sku, part.variant_title].filter(Boolean).join(' · ') || '—'),
      ]),
      el('td', {}, el('span', { class: 'tag' }, [swatch(part.color_hex), part.color_name])),
      el('td', {}, select(uvOptions(), part.uv, (value) => actions.patchPart(part.id, { uv: value }, { silent: true }), 'UV…')),
      el('td', {}, buildCommentTags(part, actions, { compact: true })),
      el('td', {}, select(printerOptions(), part.printer, (value) => actions.patchPart(part.id, { printer: value }, { silent: true }), 'Imprimante…')),
      el('td', {}, [
        el('div', {}, part.order_number ?? `#${part.order_id}`),
        el('div', { class: 'cell-sub' }, SOURCE_LABEL[part.source] ?? part.source),
      ]),
      el('td', {}, [
        el('div', {}, part.customer_name ?? '—'),
        el('div', { class: 'cell-sub' }, fromNow(part.placed_at)),
      ]),
      el('td', {}, `#${part.unit_index}`),
      el('td', {}, [
        el('div', { class: 'row-actions' }, [
          (part.priority || part.order_priority) && el('span', { class: 'tag rush' }, [icon('bolt'), 'Rush']),
          part.tracking_number && el('span', { class: 'tag' }, [icon('truck'), part.tracking_number]),
        ].filter(Boolean)),
      ]),
    ],
  );

export const renderAll = (root, actions) => {
  if (!state.parts.length) {
    root.append(
      el('div', { class: 'empty' }, [
        icon('table'),
        el('strong', {}, 'Aucune pièce'),
        'Les pièces importées de Shopify et Etsy apparaîtront ici.',
      ]),
    );
    return;
  }

  const body = el('tbody');
  for (const group of groupParts(state.parts, state.groupBy)) {
    if (group.label) {
      body.append(
        el('tr', { class: 'group-row' }, [
          el('td', { colspan: '11' }, [
            el('span', { class: 'tag' }, [group.hex ? swatch(group.hex) : null, group.label].filter(Boolean)),
            ' ',
            `${group.items.length} pièce(s)`,
          ]),
        ]),
      );
    }
    for (const part of group.items) body.append(row(part, actions));
  }

  const allSelected = state.parts.every((part) => state.selection.has(part.id));

  root.append(
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { style: { width: '38px' } }, el('input', {
              type: 'checkbox',
              checked: allSelected,
              onclick: () => actions.toggleSelectAll(!allSelected),
            })),
            el('th', {}, 'Statut'),
            el('th', {}, 'Pièce'),
            el('th', {}, 'Résine'),
            el('th', {}, 'UV'),
            el('th', {}, 'Tags'),
            el('th', {}, 'Imprimante'),
            el('th', {}, 'Commande'),
            el('th', {}, 'Pour qui'),
            el('th', {}, 'Unité'),
            el('th', {}, ''),
          ]),
        ]),
        body,
      ]),
    ]),
    el('p', { class: 'table-foot' }, `${state.parts.length} pièce(s) affichée(s)`),
  );
};
