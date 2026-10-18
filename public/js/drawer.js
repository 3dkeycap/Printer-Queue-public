import { api } from './api.js';
import { clear, el, formatDate, fromNow, icon, toast } from './ui.js';
import { presenceFor, state, statusMeta, uvOptions } from './store.js';
import { buildCommentTags } from './comment-select.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

export const closeDrawer = () => {
  document.getElementById('drawer').hidden = true;
  document.getElementById('drawer-backdrop').hidden = true;
};

export const openDrawer = async (partId, actions) => {
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  drawer.hidden = false;
  backdrop.hidden = false;
  backdrop.onclick = closeDrawer;
  clear(drawer).append(el('div', { class: 'drawer-body' }, 'Chargement…'));

  let part;
  try {
    part = await api.part(partId);
  } catch (error) {
    toast(error.message, 'err');
    closeDrawer();
    return;
  }

  const meta = statusMeta(part.status);

  const colorSelect = el(
    'select',
    {
      onchange: async (event) => {
        await actions.patchPart(part.id, { color_key: event.target.value });
        openDrawer(part.id, actions);
      },
    },
    state.colors.map((color) =>
      el('option', { value: color.key, selected: color.key === part.color_key }, color.name),
    ),
  );

  const buildSelect = (options, value, placeholder, onChange) => {
    const node = el('select', {}, [
      el('option', { value: '', selected: !value }, placeholder),
      ...options.map((option) => el('option', { value: option, selected: option === value }, option)),
      value && !options.includes(value) ? el('option', { value, selected: true }, value) : null,
    ].filter(Boolean));
    node.addEventListener('change', (event) => onChange(event.target.value || null));
    return node;
  };

  const uvSelect = buildSelect(uvOptions(), part.uv, 'Aucun poste UV', (value) =>
    actions.patchPart(part.id, { uv: value }));
  const commentSelect = buildCommentTags(part, actions);

  const notesInput = el('textarea', { placeholder: 'Notes de production…' }, part.notes ?? '');
  notesInput.addEventListener('change', () => actions.patchPart(part.id, { notes: notesInput.value }));

  const statusButtons = state.meta.statuses.map((status) =>
    el(
      'button',
      {
        class: `chip${status.key === part.status ? ' is-on' : ''}`,
        onclick: async () => {
          await actions.move([part.id], status.key, { force: true });
          openDrawer(part.id, actions);
        },
      },
      [el('span', { class: 'swatch', style: { background: status.accent } }), status.labelFr],
    ),
  );

  clear(drawer).append(
    el('header', { class: 'drawer-head' }, [
      el('div', {}, [
        el('h2', {}, part.name),
        el('p', { class: 'sub' }, [
          `Pièce #${part.id} · unité ${part.unit_index}`,
          ' · ',
          el('span', { class: 'status-pill', style: { '--pill': meta.accent } }, [
            el('span', { class: 'dot' }),
            meta.labelFr,
          ]),
        ]),
      ]),
      el('button', { class: 'mini-btn', style: { marginLeft: 'auto' }, onclick: closeDrawer }, icon('close')),
    ]),
    el('div', { class: 'drawer-body' }, [
      el('div', {}, [
        el('div', { class: 'section-title' }, 'Changer le statut'),
        el('div', { class: 'status-flow' }, statusButtons),
      ]),

      part.image_url
        ? el('div', { class: 'drawer-image-wrap' }, [
            el('a', { class: 'drawer-image', href: part.image_url, target: '_blank', rel: 'noopener noreferrer', title: 'Ouvrir la photo en grand' }, [
              el('img', { src: part.image_url, alt: part.name, loading: 'lazy' }),
            ]),
            el(
              'button',
              {
                class: 'mini-btn drawer-image-block',
                title: "Image générique ou mauvaise photo : ne plus l'afficher (pour toutes les pièces)",
                onclick: async () => {
                  try {
                    await api.blockImage(part.image_url);
                    toast('Photo masquée');
                    await actions.patchPart(part.id, {}, { silent: true });
                    openDrawer(part.id, actions);
                  } catch (error) {
                    toast(error.message, 'err');
                  }
                },
              },
              [icon('close'), 'Pas la bonne photo'],
            ),
          ])
        : null,

      part.buyer_details?.length
        ? el('div', { class: 'buyer-box' }, [
            el('div', { class: 'buyer-title' }, [icon('note'), 'Note / personnalisation du client']),
            ...part.buyer_details.map((detail) =>
              el('div', { class: 'buyer-line' }, [el('span', { class: 'cell-sub' }, detail.label), el('div', {}, detail.value)]),
            ),
          ])
        : null,

      part.pack_note
        ? el('div', { class: 'buyer-box pack-note-box' }, [
            el('div', { class: 'buyer-title' }, [icon('box'), 'Note du bac (interne)']),
            el('div', { class: 'buyer-line' }, el('div', {}, part.pack_note)),
          ])
        : null,

      presenceFor(part.order_id)
        ? el('div', { class: 'card-open-shop drawer-open-shop' }, [
            el('span', { class: 'open-dot' }),
            el('span', {}, `Cette commande est ouverte sur Shopify${presenceFor(part.order_id).users.length ? ` par ${presenceFor(part.order_id).users.join(', ')}` : ''}`),
          ])
        : null,

      Object.keys(part.links ?? {}).filter((kind) => kind !== 'chitchats').length
        ? el(
            'div',
            { class: 'drawer-links' },
            Object.entries(part.links).filter(([kind]) => kind !== 'chitchats').map(([kind, link]) =>
              el('a', { class: 'ghost-btn', href: link.url, target: '_blank', rel: 'noopener noreferrer' }, [
                icon('link'),
                link.label,
              ]),
            ),
          )
        : null,

      el('div', {}, [
        el('div', { class: 'section-title' }, 'Fiche'),
        el('dl', { class: 'kv' }, [
          el('dt', {}, 'Commande'),
          el('dd', {}, `${part.order_number ?? part.order_id} · ${SOURCE_LABEL[part.source] ?? part.source}`),
          el('dt', { class: 'adv' }, 'Client'),
          el('dd', { class: 'adv' }, part.customer_name ?? '—'),
          el('dt', {}, 'Reçue'),
          el('dd', {}, formatDate(part.placed_at)),
          el('dt', {}, 'SKU'),
          el('dd', {}, part.sku ?? '—'),
          el('dt', {}, 'Variante'),
          el('dd', {}, part.variant_title ?? '—'),
          el('dt', {}, 'Échecs'),
          el('dd', {}, String(part.fail_count)),
          el('dt', {}, 'Suivi'),
          el('dd', {}, part.tracking_number ?? '—'),
        ]),
      ]),

      el('div', { class: 'field' }, [el('label', {}, 'Couleur de résine'), colorSelect]),
      el('div', { class: 'field adv' }, [el('label', {}, 'Poste UV'), uvSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Tags'), commentSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Notes libres'), notesInput]),

      el('div', {}, [
        el('div', { class: 'section-title' }, 'Impression'),
        el(
          'button',
          {
            class: `chip${part.not_printed ? ' is-on' : ''}`,
            title: part.not_printed
              ? 'Remettre cette pièce dans « À imprimer »'
              : "Article en stock / pas imprimé ici : le retirer de « À imprimer » (il reste dans « Tout »)",
            onclick: async () => {
              await actions.patchPart(part.id, { not_printed: !part.not_printed });
              openDrawer(part.id, actions);
            },
          },
          [icon('printer'), part.not_printed ? "Pas imprimé ici — remettre dans « À imprimer »" : 'Pas imprimé ici (en stock)'],
        ),
      ]),

      el('div', { class: 'adv' }, [
        el('div', { class: 'section-title' }, 'Priorité'),
        el(
          'button',
          {
            class: `chip${part.priority ? ' is-on' : ''}`,
            onclick: async () => {
              await actions.patchPart(part.id, { priority: !part.priority });
              openDrawer(part.id, actions);
            },
          },
          [icon('bolt'), part.priority ? 'Rush activé' : 'Marquer en rush'],
        ),
      ]),

      el('div', {}, [
        el('div', { class: 'section-title' }, 'Historique'),
        el(
          'div',
          { class: 'timeline' },
          (part.events ?? []).map((event) =>
            el('div', { class: 'timeline-item' }, [
              el('div', { class: 'what' }, [
                event.from_status ? `${statusMeta(event.from_status).labelFr} → ` : 'Création → ',
                el('strong', {}, statusMeta(event.to_status).labelFr),
                el('span', { class: 'cell-sub' }, ` · ${event.actor}`),
              ]),
              event.note ? el('div', { class: 'cell-sub' }, event.note) : null,
              el('div', { class: 'when' }, `${fromNow(event.created_at)} — ${formatDate(event.created_at)}`),
            ]),
          ),
        ),
      ]),
    ]),
  );
};
