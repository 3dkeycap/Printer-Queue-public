import { el, fromNow, icon, swatch } from '../ui.js';
import { groupParts, state, statusMeta } from '../store.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

const statusPill = (status) => {
  const meta = statusMeta(status);
  return el('span', { class: 'status-pill', style: { '--pill': meta.accent } }, [
    el('span', { class: 'dot' }),
    meta.labelFr,
  ]);
};

const row = (part, actions) => {
  const next = actions.nextStatus(part.status);
  const checkbox = el('input', {
    type: 'checkbox',
    checked: state.selection.has(part.id),
    onclick: (event) => {
      event.stopPropagation();
      actions.toggleSelection(part.id);
    },
  });

  return el(
    'tr',
    {
      class: state.selection.has(part.id) ? 'is-selected' : '',
      onclick: () => actions.openPart(part.id),
    },
    [
      el('td', {}, checkbox),
      el('td', {}, [
        el('div', { class: 'cell-name' }, part.name),
        el('div', { class: 'cell-sub' }, [part.sku, part.variant_title].filter(Boolean).join(' · ') || '—'),
      ]),
      el('td', {}, el('span', { class: 'tag' }, [swatch(part.color_hex), part.color_name])),
      el('td', {}, statusPill(part.status)),
      el('td', {}, [
        el('div', {}, part.order_number ?? `#${part.order_id}`),
        el('div', { class: 'cell-sub' }, SOURCE_LABEL[part.source] ?? part.source),
      ]),
      el('td', {}, [
        el('div', {}, part.customer_name ?? '—'),
        el('div', { class: 'cell-sub' }, fromNow(part.placed_at)),
      ]),
      el('td', {}, part.printer ?? '—'),
      el('td', {}, [
        el('div', { class: 'card-actions', style: { opacity: '1' } }, [
          (part.priority || part.order_priority) && el('span', { class: 'tag rush' }, [icon('bolt'), 'Rush']),
          next &&
            el(
              'button',
              {
                class: 'mini-btn',
                onclick: (event) => {
                  event.stopPropagation();
                  actions.move([part.id], next);
                },
              },
              [statusMeta(next).labelFr, icon('chevron')],
            ),
        ]),
      ]),
    ],
  );
};

export const renderTable = (root, actions) => {
  const body = el('tbody');
  const groups = groupParts(state.parts, state.groupBy);

  for (const group of groups) {
    if (group.label) {
      body.append(
        el('tr', { class: 'group-row' }, [
          el('td', { colspan: '8' }, [
            el('span', { class: 'tag' }, [group.hex ? swatch(group.hex) : null, group.label]),
            ' ',
            `${group.items.length} pièce(s)`,
          ]),
        ]),
      );
    }
    for (const part of group.items) body.append(row(part, actions));
  }

  const allSelected = state.parts.length > 0 && state.parts.every((p) => state.selection.has(p.id));

  root.append(
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, [
          el('tr', {}, [
            el(
              'th',
              { style: { width: '38px' } },
              el('input', {
                type: 'checkbox',
                checked: allSelected,
                onclick: () => actions.toggleSelectAll(!allSelected),
              }),
            ),
            el('th', {}, 'Pièce'),
            el('th', {}, 'Résine'),
            el('th', {}, 'Statut'),
            el('th', {}, 'Commande'),
            el('th', {}, 'Client'),
            el('th', {}, 'Imprimante'),
            el('th', {}, ''),
          ]),
        ]),
        body,
      ]),
    ]),
  );
};
