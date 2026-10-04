import { api } from './api.js';
import { clear, el, formatDate, fromNow, icon, swatch, toast } from './ui.js';
import { openChitChats, presenceFor, printerOptions, state, statusMeta, uvOptions } from './store.js';
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
  const printerSelect = buildSelect(printerOptions(), part.printer, 'Aucune imprimante assignée', (value) =>
    actions.patchPart(part.id, { printer: value }));

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
        ? el('a', { class: 'drawer-image', href: part.image_url, target: '_blank', rel: 'noopener noreferrer', title: 'Ouvrir la photo en grand' }, [
            el('img', { src: part.image_url, alt: part.name, loading: 'lazy' }),
          ])
        : null,

      part.chitchats_import_status === 'error'
        ? el('div', { class: 'cc-error-box' }, [
            el('div', { class: 'cc-error-title' }, [icon('alert'), "Import Chit Chats impossible"]),
            el('p', {}, part.chitchats_import_error ?? 'Raison inconnue'),
            el('div', { class: 'cc-error-foot' }, [
              el('span', { class: 'cell-sub' }, part.chitchats_import_at ? `Dernier essai ${fromNow(part.chitchats_import_at)}` : ''),
              el(
                'button',
                {
                  class: 'ghost-btn',
                  onclick: async (event) => {
                    const button = event.currentTarget;
                    button.disabled = true;
                    try {
                      await api.importOrderToChitChats(part.order_id);
                      await openDrawer(part.id, actions);
                      toast('Import Chit Chats relancé');
                    } catch (error) {
                      toast(error.message, 'err');
                      button.disabled = false;
                    }
                  },
                },
                [icon('refresh'), 'Réessayer maintenant'],
              ),
            ]),
          ])
        : null,

      presenceFor(part.order_id)
        ? el('div', { class: 'card-open-shop drawer-open-shop' }, [
            el('span', { class: 'open-dot' }),
            el('span', {}, `Cette commande est ouverte sur Shopify${presenceFor(part.order_id).users.length ? ` par ${presenceFor(part.order_id).users.join(', ')}` : ''}`),
            presenceFor(part.order_id).chitchatsUrl
              ? el('button', { class: 'primary-btn', onclick: () => openChitChats(presenceFor(part.order_id)) }, [icon('truck'), 'Ouvrir sur Chit Chats'])
              : null,
          ])
        : null,

      Object.keys(part.links ?? {}).length
        ? el(
            'div',
            { class: 'drawer-links' },
            Object.values(part.links).map((link) =>
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
          el('dt', {}, 'Client'),
          el('dd', {}, part.customer_name ?? '—'),
          el('dt', {}, 'Reçue'),
          el('dd', {}, formatDate(part.placed_at)),
          el('dt', {}, 'SKU'),
          el('dd', {}, part.sku ?? '—'),
          el('dt', {}, 'Variante'),
          el('dd', {}, part.variant_title ?? '—'),
          el('dt', {}, 'Résine'),
          el('dd', {}, el('span', { class: 'tag' }, [swatch(part.color_hex), part.color_name])),
          el('dt', {}, 'UV'),
          el('dd', {}, part.uv ?? '—'),
          el('dt', {}, 'Imprimante'),
          el('dd', {}, part.printer ?? '—'),
          el('dt', {}, 'Échecs'),
          el('dd', {}, String(part.fail_count)),
          el('dt', {}, 'Suivi'),
          el('dd', {}, part.tracking_number ?? '—'),
          el('dt', {}, 'Chit Chats'),
          el('dd', {}, {
            imported: 'Envoi créé (en attente d\'achat)',
            linked: 'Envoi déjà présent, relié',
            error: 'Erreur — voir ci-dessus',
          }[part.chitchats_import_status] ?? (part.source === 'manual' ? '—' : 'Pas encore importé')),
        ]),
      ]),

      el('div', { class: 'field' }, [el('label', {}, 'Couleur de résine'), colorSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Poste UV'), uvSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Tags'), commentSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Imprimante'), printerSelect]),
      el('div', { class: 'field' }, [el('label', {}, 'Notes libres'), notesInput]),

      el('div', {}, [
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
