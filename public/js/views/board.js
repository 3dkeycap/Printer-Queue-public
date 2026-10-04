import { attachImagePreview, el, icon, swatch } from '../ui.js';
import { groupParts, state, statusMeta } from '../store.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

/**
 * Regroupe les pièces identiques (même nom, couleur, variante, UV, commentaire,
 * imprimante) : « 3× MX Tilters Adapters (10 Pack) » devient une seule carte.
 * Chaque pile garde la liste de ses ids pour agir sur toutes les pièces d'un coup.
 */
const stackParts = (parts) => {
  const stacks = new Map();
  for (const part of parts) {
    const key = [part.name, part.color_key, part.variant_title, part.uv, part.comment, part.printer, part.priority || part.order_priority]
      .map((value) => String(value ?? ''))
      .join('|');
    if (!stacks.has(key)) stacks.set(key, []);
    stacks.get(key).push(part);
  }
  return [...stacks.values()];
};

const buildCard = (stack, actions) => {
  const [part] = stack;
  const ids = stack.map((item) => item.id);
  const count = stack.length;
  const allSelected = ids.every((id) => state.selection.has(id));
  const next = actions.nextStatus(part.status);
  const card = el(
    'article',
    {
      class: `card${allSelected ? ' is-selected' : ''}${part.priority || part.order_priority ? ' is-rush' : ''}`,
      draggable: 'true',
      style: { '--card-color': part.color_hex },
      dataset: { id: String(part.id), status: part.status },
    },
    [
      el('div', { class: 'card-top' }, [
        el('div', { class: 'card-title' }, part.name),
        count > 1
          ? el('span', { class: 'card-unit card-stack', title: `${count} pièces identiques regroupées` }, `×${count}`)
          : el('span', { class: 'card-unit' }, `#${part.unit_index}`),
      ]),
      el('div', { class: 'card-meta' }, [
        el('span', { class: 'tag' }, [swatch(part.color_hex), part.color_name]),
        part.uv && el('span', { class: 'tag uv' }, [icon('uv'), `UV ${part.uv}`]),
        el('span', { class: `tag src-${part.source}` }, SOURCE_LABEL[part.source] ?? part.source),
        el('span', { class: 'tag' }, count > 1 ? `${new Set(stack.map((item) => item.order_id)).size} commande(s)` : (part.order_number ?? `#${part.order_id}`)),
        (part.priority || part.order_priority) && el('span', { class: 'tag rush' }, [icon('bolt'), 'Rush']),
        part.printer && el('span', { class: 'tag' }, [icon('printer'), part.printer]),
        part.image_url && attachImagePreview(el('span', { class: 'tag' }, [icon('image'), 'Photo']), part.image_url),
      ]),
      part.comment && el('div', { class: 'card-comment' }, [icon('note'), part.comment]),
      el('div', { class: 'card-foot' }, [
        el('span', { class: 'who' }, count > 1 ? '—' : (part.customer_name ?? '—')),
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
                  actions.move(ids, 'FAILED');
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
                  actions.move(ids, next);
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
      actions.toggleSelection(ids);
      return;
    }
    actions.openPart(part.id);
  });

  card.addEventListener('dragstart', (event) => {
    const dragged = ids.some((id) => state.selection.has(id)) ? [...state.selection] : ids;
    event.dataTransfer.setData('text/plain', JSON.stringify(dragged));
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('is-dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('is-dragging'));

  return card;
};

const buildColumn = (status, parts, actions, { focused }) => {
  const meta = statusMeta(status);
  const stacked = state.stacked.has(status);
  const body = el('div', { class: `column-body${focused ? ' is-grid' : ''}` });

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
      const stacks = stacked ? stackParts(group.items) : group.items.map((part) => [part]);
      for (const stack of stacks) body.append(buildCard(stack, actions));
    }
  }

  const column = el(
    'section',
    { class: `column${focused ? ' is-focused' : ''}`, style: { '--col-accent': meta.accent }, dataset: { status } },
    [
      el('header', { class: 'column-head', title: meta.hint }, [
        el('span', { class: 'column-dot' }),
        el('h3', {}, meta.labelFr),
        el('span', { class: 'count' }, String(parts.length)),
        el(
          'button',
          {
            class: `mini-btn column-stack-btn${stacked ? ' is-on' : ''}`,
            title: stacked ? 'Dégrouper les pièces identiques' : 'Regrouper les pièces identiques (ex. 3× MX Tilters Adapters)',
            onclick: (event) => {
              event.stopPropagation();
              actions.toggleStack(status);
            },
          },
          [icon('layers'), 'Regrouper'],
        ),
        el(
          'button',
          {
            class: 'mini-btn column-focus-btn',
            title: focused ? "Revenir à la vue complète" : "Agrandir cette colonne pour tout voir d'un coup",
            onclick: (event) => {
              event.stopPropagation();
              actions.toggleColumnFocus(status);
            },
          },
          icon(focused ? 'shrink' : 'expand'),
        ),
      ]),
      body,
    ],
  );

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
  const board = state.meta.boardStatuses ?? [];
  let statuses = state.meta.statuses.filter((s) => board.includes(s.key));

  // Vue « agrandie » : une seule colonne, en grille, pour une vision globale
  // de tout ce qu'elle contient d'un coup plutôt qu'une liste étroite.
  const focused = state.focusedColumn;
  const isFocusable = focused && statuses.some((s) => s.key === focused);
  if (isFocusable) statuses = statuses.filter((s) => s.key === focused);

  const byStatus = new Map(statuses.map((s) => [s.key, []]));
  for (const part of state.parts) {
    if (byStatus.has(part.status)) byStatus.get(part.status).push(part);
  }

  root.append(
    el(
      'div',
      { class: `board${isFocusable ? ' is-focused-view' : ''}` },
      statuses.map((s) =>
        buildColumn(s.key, byStatus.get(s.key) ?? [], actions, { focused: isFocusable && s.key === focused }),
      ),
    ),
  );
};
