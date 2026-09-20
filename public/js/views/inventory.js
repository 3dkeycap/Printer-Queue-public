import { el, fromNow, icon, swatch } from '../ui.js';
import { state } from '../store.js';

const stockPanel = (color, actions) => {
  const ratio = color.low_stock_grams > 0 ? Math.min(color.stock_grams / (color.low_stock_grams * 3), 1) : 0;
  const isLow = color.stock_grams <= color.low_stock_grams;

  const input = el('input', {
    class: 'stock-input',
    type: 'number',
    min: '0',
    step: '50',
    value: String(color.stock_grams ?? 0),
  });

  input.addEventListener('change', () => actions.setStock(color.key, Number(input.value)));

  return el('article', { class: 'panel' }, [
    el('h3', {}, [swatch(color.hex, 'lg'), color.name, isLow ? el('span', { class: 'low-badge' }, 'Stock bas') : null]),
    el('p', { class: 'sub' }, `${color.queued ?? 0} pièce(s) en file · ${color.active ?? 0} en production`),
    el('div', { class: 'meter', style: { '--meter-color': isLow ? 'var(--danger)' : color.hex } }, [
      el('span', { style: { width: `${Math.round(ratio * 100)}%` } }),
    ]),
    el('div', { class: 'stock-row' }, [el('span', {}, 'Résine restante (g)'), input]),
  ]);
};

export const renderInventory = (root, actions) => {
  const stockByColor = new Map((state.summary?.byColor ?? []).map((c) => [c.key, c]));

  const shelves = state.inventory.length
    ? el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'grid' }, [
          el('thead', {}, el('tr', {}, [
            el('th', {}, 'Pièce'),
            el('th', {}, 'Résine'),
            el('th', {}, 'Quantité'),
            el('th', {}, 'En stock depuis'),
            el('th', {}, ''),
          ])),
          el(
            'tbody',
            {},
            state.inventory.map((item) =>
              el('tr', {}, [
                el('td', {}, [
                  el('div', { class: 'cell-name' }, item.name),
                  el('div', { class: 'cell-sub' }, item.sku ?? '—'),
                ]),
                el('td', {}, el('span', { class: 'tag' }, [swatch(item.color_hex), item.color_name])),
                el('td', {}, el('strong', {}, String(item.quantity))),
                el('td', {}, fromNow(item.oldest)),
                el('td', {}, [
                  el(
                    'button',
                    {
                      class: 'mini-btn',
                      onclick: () => actions.move(item.part_ids.slice(0, 1), 'SHIPPED'),
                      title: 'Sortir une pièce du stock (expédiée)',
                    },
                    [icon('truck'), 'Expédier 1'],
                  ),
                ]),
              ]),
            ),
          ),
        ]),
      )
    : el('div', { class: 'empty' }, [icon('box'), el('strong', {}, 'Aucune pièce en stock'), 'Les pièces marquées « En stock » apparaîtront ici.']);

  root.append(
    el('div', { class: 'section-title' }, 'Pièces finies en bac'),
    shelves,
    el('div', { class: 'section-title' }, 'Stock de résine par couleur'),
    el(
      'div',
      { class: 'panel-grid' },
      state.colors
        .filter((color) => color.key !== 'unassigned' && color.is_active)
        .map((color) => stockPanel({ ...color, ...(stockByColor.get(color.key) ?? {}) }, actions)),
    ),
  );
};
