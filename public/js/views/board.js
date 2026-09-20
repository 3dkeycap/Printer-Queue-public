import { el, icon, swatch } from '../ui.js';
import { groupParts, state, statusMeta } from '../store.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

const buildCard = (part, actions) => {
  const next = actions.nextStatus(part.status);
  const card = el(
    'article',
    {
      class: `card${state.selection.has(part.id) ? ' is-selected' : ''}${part.priority || part.order_priority ? ' is-rush' : ''}`,
      draggable: 'true',
      style: { '--card-color': part.color_hex },
      dataset: { id: String(part.id), status: part.status },
    },
    [
      el('div', { class: 'card-top' }, [
        el('div', { class: 'card-title' }, part.name),
        el('span', { class: 'card-unit' }, `#${part.unit_index}`),
      ]),
      el('div', { class: 'card-meta' }, [
        el('span', { class: 'tag' }, [swatch(part.color_hex), part.color_name]),
        el('span', { class: `tag src-${part.source}` }, SOURCE_LABEL[part.source] ?? part.source),
        el('span', { class: 'tag' }, part.order_number ?? `#${part.order_id}`),
        (part.priority || part.order_priority) && el('span', { class: 'tag rush' }, [icon('bolt'), 'Rush']),
        part.printer && el('span', { class: 'tag' }, [icon('printer'), part.printer]),
      ]),
      el('div', { class: 'card-foot' }, [
        el('span', { class: 'who' }, part.customer_name ?? '—'),
        el('div', { class: 'card-actions' }, [
          part.status !== 'FAILED' &&
            part.status !== 'TO_PRINT' &&
            el(
              'button',
              {
                class: 'mini-btn danger',
                title: 'Marquer comme échec',
                onclick: (event) => {
                  event.stopPropagation();
                  actions.move([part.id], 'FAILED');
                },
              },
              icon('alert'),
            ),
          next &&
            el(
              'button',
              {
                class: 'mini-btn',
                title: `Passer à ${statusMeta(next).labelFr}`,
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

  card.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      actions.toggleSelection(part.id);
      return;
    }
    actions.openPart(part.id);
  });

  card.addEventListener('dragstart', (event) => {
    const ids = state.selection.has(part.id) ? [...state.selection] : [part.id];
    event.dataTransfer.setData('text/plain', JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('is-dragging'));

  return card;
};

const buildColumn = (status, parts, actions) => {
  const meta = statusMeta(status);
  const body = el('div', { class: 'column-body' });

  if (!parts.length) {
    body.append(el('div', { class: 'column-empty' }, 'Rien ici'));
  } else {
    for (const group of groupParts(parts, state.groupBy)) {
      if (group.label) {
        body.append(
          el('div', { class: 'group-head' }, [
            group.hex ? swatch(group.hex) : null,
            group.label,
            el('span', { class: 'count' }, String(group.items.length)),
          ]),
        );
      }
      for (const part of group.items) body.append(buildCard(part, actions));
    }
  }

  const column = el('section', { class: 'column', style: { '--col-accent': meta.accent }, dataset: { status } }, [
    el('header', { class: 'column-head', title: meta.hint }, [
      el('span', { class: 'column-dot' }),
      el('h3', {}, meta.labelFr),
      el('span', { class: 'count' }, String(parts.length)),
    ]),
    body,
  ]);

  column.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('is-drop');
  });
  column.addEventListener('dragleave', (event) => {
    if (!column.contains(event.relatedTarget)) column.classList.remove('is-drop');
  });
  column.addEventListener('drop', (event) => {
    event.preventDefault();
    column.classList.remove('is-drop');
    try {
      const ids = JSON.parse(event.dataTransfer.getData('text/plain'));
      actions.move(ids, status);
    } catch {
      /* ignore malformed payloads */
    }
  });

  return column;
};

export const renderBoard = (root, actions) => {
  root.classList.add('is-board');
  const statuses = state.filters.statuses.size
    ? state.meta.statuses.filter((s) => state.filters.statuses.has(s.key))
    : state.meta.statuses.filter((s) => s.key !== 'SHIPPED');

  const byStatus = new Map(statuses.map((s) => [s.key, []]));
  for (const part of state.parts) {
    if (byStatus.has(part.status)) byStatus.get(part.status).push(part);
  }

  const board = el(
    'div',
    { class: 'board' },
    statuses.map((s) => buildColumn(s.key, byStatus.get(s.key) ?? [], actions)),
  );

  root.append(board);
};
