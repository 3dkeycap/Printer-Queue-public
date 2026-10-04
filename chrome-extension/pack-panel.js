/*
 * Fenêtre « J'ai packé la commande » (page commande de l'admin Shopify).
 *
 * Former quelqu'un : il ne ship pas, il met les pièces dans un bac « commande
 * #1234 ». Ici il indique, article par article, combien il en a mis dans le
 * bac, pourquoi il en manque, et qui il est (un seul ordi pour plusieurs
 * personnes). Toutes les infos de la commande sont affichées : note client,
 * état de chaque article, Chit Chats, historique des passages.
 *
 * Affichée dans un Shadow DOM pour que le style de Shopify ne la casse pas.
 */
(() => {
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => ({ error: 'Extension rechargée : recharge la page' }));

  const STATUS_LABEL = { TO_PRINT: 'à imprimer', PRINTING: 'en impression', FAILED: 'échec', DONE: 'imprimée', SHIPPED: 'expédiée' };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { position: fixed; right: 0; width: min(420px, calc(100vw - 16px)); z-index: 2147483646;
      display: flex; flex-direction: column; background: #fff; color: #14213d; border: 1px solid #d5dcea; border-right: 0;
      border-radius: 12px 0 0 12px; box-shadow: 0 24px 60px -18px rgba(15, 30, 70, .45);
      font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
      transform-origin: top right; transform: scaleY(.6); opacity: 0; transition: transform .16s ease, opacity .16s ease; }
    .panel.open { transform: none; opacity: 1; }
    textarea { font: inherit; width: 100%; min-height: 64px; padding: 8px; border: 1px solid #ccd5e5; border-radius: 8px; resize: vertical; color: #14213d; }
    header { display: flex; align-items: center; gap: 10px; padding: 10px 14px 8px; border-bottom: 1px solid #e6ebf3; }
    header h2 { margin: 0; font-size: 14.5px; }
    header .sub { color: #5b6a86; font-size: 12px; }
    .x { margin-left: auto; border: 0; background: #eef2f8; border-radius: 8px; width: 30px; height: 30px; font-size: 16px; cursor: pointer; color: #14213d; }
    .body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
    .box { border: 1px solid #e3e8f1; border-radius: 10px; padding: 10px 12px; }
    .box h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5b6a86; }
    .note { background: #fff7e6; border-color: #f0d49a; }
    .note .v { white-space: pre-wrap; font-size: 13.5px; }
    .note .l { color: #7a6a45; font-size: 11.5px; margin-top: 6px; }
    .bad { background: #fdecec; border-color: #f0b7b7; color: #8f2424; }
    .hist { font-size: 12px; color: #33415c; display: flex; flex-direction: column; gap: 4px; }
    .item { display: grid; grid-template-columns: 44px 1fr auto; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid #eef1f6; }
    .item:first-of-type { border-top: 0; }
    .thumb { width: 44px; height: 44px; border-radius: 8px; background: #eef2f8 center/cover no-repeat; }
    .title { font-weight: 600; overflow-wrap: anywhere; }
    .meta { color: #5b6a86; font-size: 11.5px; }
    .tag { display: inline-block; padding: 0 6px; border-radius: 5px; background: #eef2f8; color: #33415c; font-size: 11px; margin-right: 4px; }
    .tag.stock { background: #f1ecfb; color: #5b3aa6; }
    .qty { display: flex; align-items: center; gap: 4px; }
    .qty button { width: 28px; height: 28px; border: 1px solid #ccd5e5; background: #fff; border-radius: 7px; cursor: pointer; font-size: 15px; color: #14213d; }
    .qty span { min-width: 46px; text-align: center; font-weight: 700; font-size: 14px; }
    .qty span.full { color: #1c7c45; }
    .qty span.partial { color: #b4532a; }
    .reason { grid-column: 2 / -1; display: flex; gap: 6px; flex-wrap: wrap; }
    select, input { font: inherit; padding: 6px 8px; border: 1px solid #ccd5e5; border-radius: 8px; background: #fff; color: #14213d; min-width: 0; }
    .reason select { flex: 1 1 150px; }
    .reason input { flex: 1 1 150px; }
    footer { padding: 12px 16px 14px; border-top: 1px solid #e6ebf3; display: flex; flex-direction: column; gap: 8px; }
    .who { display: flex; gap: 6px; align-items: center; }
    .who select { flex: 1; }
    .row { display: flex; gap: 8px; }
    .btn { flex: 1; padding: 10px 12px; border: 0; border-radius: 9px; font: 600 13.5px system-ui, sans-serif; cursor: pointer; }
    .btn.primary { background: #1f5fd6; color: #fff; }
    .btn.ghost { background: #eef2f8; color: #14213d; }
    .btn[disabled] { opacity: .55; cursor: default; }
    .msg { font-size: 12.5px; }
    .msg.ok { color: #1c7c45; } .msg.err { color: #b42828; }
    .empty { color: #5b6a86; padding: 20px 0; text-align: center; }
  `;

  const h = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  let host = null;
  let root = null;
  let anchor = null; // la barre (bouton accroché au bord droit) : la boîte s'ouvre juste en dessous
  let currentOrder = null;

  /** Place la boîte sous la barre, sur la hauteur restante de l'écran. */
  const place = () => {
    const panel = root?.querySelector('.panel');
    if (!panel) return;
    const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : { bottom: 60 };
    const top = Math.round(rect.bottom + 6);
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(220, window.innerHeight - top - 10)}px`;
  };
  window.addEventListener('resize', place);

  const ensureHost = () => {
    if (host?.isConnected) return;
    host = h('div', { 'data-resin-queue-pack': '' });
    root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, CSS));
    document.documentElement.append(host);
  };

  const close = () => {
    currentOrder = null;
    const panel = root?.querySelector('.panel');
    globalThis.dispatchEvent(new CustomEvent('resin-queue-pack', { detail: { open: false } }));
    if (!panel) return;
    panel.classList.remove('open');
    setTimeout(() => {
      if (!currentOrder) host?.remove();
    }, 200);
  };

  /*
   * Ouverte ou fermée par la personne : l'état est mémorisé. Ouverte, la boîte
   * se rouvre toute seule sur chaque commande ; fermée, elle reste fermée.
   */
  const remember = (open) => chrome.storage.local.set({ packOpen: open });
  const userClose = () => {
    remember(false);
    close();
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');

  const statusText = (item) =>
    Object.entries(item.statuses ?? {})
      .map(([status, count]) => `${count} ${STATUS_LABEL[status] ?? status}`)
      .join(', ');

  const render = async (orderExternalId, view, flash) => {
    ensureHost();
    const old = root.querySelector('.panel');
    const wasOpen = Boolean(old);
    old?.remove();

    const panel = h('div', { class: `panel${wasOpen ? ' open' : ''}` });
    root.append(panel);
    if (!wasOpen) requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('open')));
    // la position est recalculée une fois le contenu ajouté
    queueMicrotask(place);

    if (view?.error) {
      panel.append(
        h('header', {}, [h('div', {}, [h('h2', {}, "J'ai packé la commande")]), h('button', { class: 'x', onclick: userClose, title: 'Fermer' }, '×')]),
        h('div', { class: 'body' }, [h('div', { class: 'box bad' }, view.error)]),
      );
      return;
    }

    const order = view.order;
    // quantités choisies, pré-remplies avec ce qui est déjà dans le bac
    const draft = new Map(view.items.map((item) => [item.id, { packed: item.packed, reason: item.lastReason ?? '', other: '' }]));
    const { lastPacker = '' } = await chrome.storage.local.get('lastPacker');

    const msg = h('div', { class: `msg ${flash?.ok ? 'ok' : 'err'}` }, flash?.text ?? '');

    const itemRow = (item) => {
      const state = draft.get(item.id);
      const count = h('span', {});
      const reasonBox = h('div', { class: 'reason' });
      const paint = () => {
        count.textContent = `${state.packed} / ${item.total}`;
        count.className = state.packed >= item.total ? 'full' : 'partial';
        reasonBox.replaceChildren();
        if (state.packed < item.total) {
          const known = view.reasons.includes(state.reason);
          const select = h(
            'select',
            {
              onchange: (event) => {
                state.reason = event.target.value === '__other__' ? '' : event.target.value;
                state.other = event.target.value === '__other__' ? state.other || ' ' : '';
                paint();
              },
            },
            [
              h('option', { value: '', selected: !state.reason && !state.other }, `Pourquoi il en manque ${item.total - state.packed} ?`),
              ...view.reasons.map((reason) => h('option', { value: reason, selected: reason === state.reason }, reason)),
              h('option', { value: '__other__', selected: Boolean(state.other) || Boolean(state.reason && !known) }, 'Autre…'),
            ],
          );
          reasonBox.append(select);
          if (state.other || Boolean(state.reason && !known)) {
            const input = h('input', { placeholder: 'Raison', value: (state.reason && !known ? state.reason : state.other).trim() });
            input.addEventListener('input', () => {
              state.other = input.value || ' ';
              state.reason = input.value.trim();
            });
            reasonBox.append(input);
          }
        }
      };
      const step = (delta) => {
        state.packed = Math.min(item.total, Math.max(0, state.packed + delta));
        paint();
      };
      paint();
      return [
        h('div', { class: 'item' }, [
          h('div', { class: 'thumb', style: item.image ? `background-image:url("${item.image.replace(/"/g, '%22')}")` : '' }),
          h('div', {}, [
            h('div', { class: 'title' }, item.title),
            h('div', { class: 'meta' }, [
              item.variant ? h('span', { class: 'tag' }, item.variant) : null,
              item.notPrinted ? h('span', { class: 'tag stock' }, 'en stock') : null,
              statusText(item),
            ]),
          ]),
          h('div', { class: 'qty' }, [
            h('button', { title: 'Une de moins', onclick: () => step(-1) }, '−'),
            count,
            h('button', { title: 'Une de plus', onclick: () => step(1) }, '+'),
          ]),
          reasonBox,
        ]),
      ];
    };

    const who = h('select', {}, [
      h('option', { value: '' }, 'Qui es-tu ?'),
      ...view.packers.map((name) => h('option', { value: name, selected: name === lastPacker }, name)),
      h('option', { value: '__new__' }, '+ Ajouter une personne…'),
    ]);
    who.addEventListener('change', async () => {
      if (who.value !== '__new__') return;
      const name = (prompt('Nom de la personne') ?? '').trim();
      if (!name) {
        who.value = '';
        return;
      }
      const result = await send({ type: 'packer-add', name });
      if (result?.error) {
        msg.className = 'msg err';
        msg.textContent = result.error;
        return;
      }
      view.packers = result.packers;
      who.replaceChildren(
        h('option', { value: '' }, 'Qui es-tu ?'),
        ...view.packers.map((n) => h('option', { value: n, selected: n === name }, n)),
        h('option', { value: '__new__' }, '+ Ajouter une personne…'),
      );
    });

    const save = h('button', { class: 'btn primary' }, "Enregistrer le bac");
    save.addEventListener('click', async () => {
      if (!who.value || who.value === '__new__') {
        msg.className = 'msg err';
        msg.textContent = 'Choisis qui a packé la commande.';
        return;
      }
      const missingReason = view.items.find((item) => draft.get(item.id).packed < item.total && !draft.get(item.id).reason.trim());
      if (missingReason) {
        msg.className = 'msg err';
        msg.textContent = `Indique pourquoi il manque « ${missingReason.title} ».`;
        return;
      }
      save.disabled = true;
      await chrome.storage.local.set({ lastPacker: who.value });
      const result = await send({
        type: 'pack-save',
        orderExternalId,
        body: {
          packer: who.value,
          note: noteInput.value,
          items: view.items.map((item) => ({ orderItemId: item.id, packed: draft.get(item.id).packed, reason: draft.get(item.id).reason.trim() })),
        },
      });
      if (result?.error) {
        save.disabled = false;
        msg.className = 'msg err';
        msg.textContent = result.error;
        return;
      }
      const complete = result.history?.[0]?.complete;
      render(orderExternalId, result, { ok: true, text: complete ? '✓ Bac complet enregistré.' : '✓ Enregistré — bac incomplet (raisons notées).' });
      globalThis.dispatchEvent(new CustomEvent('resin-queue-pack', { detail: { open: true, saved: true } }));
    });

    const allIn = h('button', { class: 'btn ghost' }, 'Tout est dans le bac');
    allIn.addEventListener('click', () => {
      for (const item of view.items) draft.get(item.id).packed = item.total;
      const body = panel.querySelector('.items');
      body.replaceChildren(...view.items.flatMap(itemRow));
    });

    const last = view.history[0];
    const noteInput = h('textarea', { placeholder: 'Ex. bac 4, la keycap rouge est dans le sac à part…' });
    noteInput.value = order.packNote ?? '';
    panel.append(
      h('header', {}, [
        h('div', {}, [h('h2', {}, `📦 Bac — commande ${order.number ?? ''}`)]),
        h('button', { class: 'x', onclick: userClose, title: 'Fermer' }, '×'),
      ]),
      h('div', { class: 'body' }, [
        order.shippedAt ? h('div', { class: 'box bad' }, `Attention : commande déjà marquée expédiée le ${fmt(order.shippedAt)}.`) : null,
        h('div', { class: 'box' }, [
          h('h3', {}, 'Mis dans le bac'),
          view.items.length ? h('div', { class: 'items' }, view.items.flatMap(itemRow)) : h('div', { class: 'empty' }, 'Aucun article'),
        ]),
        h('div', { class: 'box' }, [h('h3', {}, 'Notes (internes, pas envoyées à Shopify)'), noteInput]),
      ]),
      h('footer', {}, [
        last ? h('div', { class: `msg ${last.complete ? 'ok' : 'err'}` }, last.complete ? `Déjà packée par ${last.packer} (${fmt(last.created_at)}).` : `Dernier passage incomplet (${last.packer}) : complète les quantités.`) : null,
        h('div', { class: 'who' }, [who]),
        h('div', { class: 'row' }, [allIn, save]),
        msg,
      ]),
    );
  };

  const open = async (orderExternalId, anchorNode) => {
    anchor = anchorNode ?? anchor;
    currentOrder = orderExternalId;
    ensureHost();
    globalThis.dispatchEvent(new CustomEvent('resin-queue-pack', { detail: { open: true } }));
    const view = await send({ type: 'pack-get', orderExternalId });
    if (currentOrder !== orderExternalId) return;
    render(orderExternalId, view ?? { error: "Pas de réponse de l'app" });
  };

  globalThis.ResinQueuePack = {
    open,
    close,
    place,
    isOpen: () => Boolean(currentOrder),
    openOrder: () => currentOrder,
    wantsOpen: async () => Boolean((await chrome.storage.local.get('packOpen')).packOpen),
    /** « J'ai packé » : ouvre / referme la boîte sous la barre (choix mémorisé). */
    toggle(orderExternalId, anchorNode) {
      if (currentOrder === orderExternalId) userClose();
      else {
        remember(true);
        open(orderExternalId, anchorNode);
      }
    },
  };
})();
