import { el, formatDate, fromNow, icon } from '../ui.js';
import { state } from '../store.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

export const renderOrders = (root, actions) => {
  if (!state.orders.length) {
    root.append(
      el('div', { class: 'empty' }, [
        icon('receipt'),
        el('strong', {}, 'Aucune commande'),
        'Lance une synchronisation pour importer Shopify et Etsy.',
      ]),
    );
    return;
  }

  root.append(
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Commande'),
          el('th', {}, 'Client'),
          el('th', {}, 'Reçue'),
          el('th', {}, 'Pièces'),
          el('th', {}, 'Avancement'),
          el('th', {}, 'Suivi'),
          el('th', {}, ''),
        ])),
        el(
          'tbody',
          {},
          state.orders.map((order) => {
            const done = order.parts_done ?? 0;
            const total = order.parts_total ?? 0;
            const ratio = total ? Math.round((done / total) * 100) : 0;
            return el('tr', {}, [
              el('td', {}, [
                el('div', { class: 'cell-name' }, order.order_number ?? order.external_id),
                el('div', { class: 'cell-sub' }, SOURCE_LABEL[order.source] ?? order.source),
              ]),
              el('td', {}, [
                el('div', {}, order.customer_name ?? '—'),
                el('div', { class: 'cell-sub' }, order.shipping_country ?? ''),
              ]),
              el('td', {}, [
                el('div', {}, fromNow(order.placed_at)),
                el('div', { class: 'cell-sub' }, formatDate(order.placed_at)),
              ]),
              el('td', {}, String(total)),
              el('td', {}, [
                el('div', { class: 'meter', style: { width: '120px', marginTop: '0' } }, [
                  el('span', { style: { width: `${ratio}%` } }),
                ]),
                el('div', { class: 'cell-sub' }, `${done}/${total} produites`),
              ]),
              el('td', {}, [
                order.tracking_number
                  ? el('span', { class: 'tag' }, [icon('truck'), order.tracking_number])
                  : el('span', { class: 'cell-sub' }, '—'),
              ]),
              el('td', {}, [
                el(
                  'button',
                  { class: 'mini-btn', onclick: () => actions.filterByOrder(order) },
                  'Voir les pièces',
                ),
                !order.shipped_at
                  ? el(
                      'button',
                      { class: 'mini-btn', onclick: () => actions.shipOrder(order) },
                      [icon('truck'), 'Expédier'],
                    )
                  : null,
              ]),
            ]);
          }),
        ),
      ]),
    ]),
  );
};
