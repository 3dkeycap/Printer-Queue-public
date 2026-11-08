/*
 * Sur la liste des commandes d'Etsy Shop Manager (/your/orders/sold) : la même
 * barre que sur Shopify, accrochée au bord droit (poignée ⋮⋮ pour la déplacer,
 * position partagée avec Shopify). Etsy n'a pas de page « une commande » : la
 * barre agit sur la commande sélectionnée en cliquant sa ligne (elle est alors
 * entourée) ; s'il n'y en a qu'une à l'écran, elle est sélectionnée d'office.
 * Chit Chats est cherché par le nom de l'acheteur (« Ship to »), pas par le
 * numéro Etsy, que Chit Chats ne connaît pas toujours.
 */
(() => {
  // lien d'une commande (repli) : ?order_id=123…
  const ORDER_ID = /[?&]order_id=(\d{6,})/i;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => null);
  globalThis.ResinQueuePackSource = 'etsy';

  let dock = null;
  let selected = null; // { id, row, name }
  let linkStatus = {};

  const orderIdOf = (href) => ORDER_ID.exec(href ?? '')?.[1] ?? null;

  /** Une entrée par commande : le numéro affiché sous le nom (« #4208091578 ») est celui de l'app. */
  const findOrders = () => {
    const found = new Map();
    for (const node of document.querySelectorAll('a, span, div')) {
      if (node.children.length > 1) continue;
      const match = /^#(\d{8,})$/.exec((node.textContent ?? '').trim());
      if (match && !found.has(match[1])) found.set(match[1], node);
    }
    if (!found.size) {
      for (const anchor of document.querySelectorAll('a[href]')) {
        const id = orderIdOf(anchor.getAttribute('href'));
        if (id && !found.has(id)) found.set(id, anchor);
      }
    }
    return found;
  };

  /** La ligne de la commande : le plus petit bloc qui contient aussi sa case à cocher. */
  const rowOf = (anchor, id, all) => {
    let node = anchor;
    for (let depth = 0; depth < 14 && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      if (parent === document.body || parent.tagName === 'MAIN') break;
      // un bloc qui contient une autre commande n'est plus « la » ligne
      for (const [other, otherNode] of all) if (other !== id && parent.contains(otherNode)) return node;
      node = parent;
      if (node.querySelector('input[type="checkbox"]')) return node;
    }
    return node;
  };

  /** Nom de l'acheteur : la ligne qui suit « Ship to » dans la commande. */
  const buyerName = (row) => {
    const lines = (row?.innerText ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const at = lines.findIndex((line) => /^ship to$/i.test(line));
    return (at >= 0 && lines[at + 1]) || null;
  };

  const mine = () => linkStatus.link && linkStatus.link.shopifyTabId === linkStatus.tabId;
  const refreshLink = async () => {
    linkStatus = (await send({ type: 'link-status' })) ?? {};
    render();
  };

  /** Lien live : la commande sélectionnée s'affiche dans l'onglet Chit Chats lié. */
  const syncLinkedOrder = () => {
    if (selected) send({ type: 'link-order', orderNumber: selected.id, customerName: selected.name });
  };

  /**
   * Identifiants possibles de la commande dans l'app : ceux des liens de la ligne
   * (le receipt_id Etsy, souvent plus long que le numéro affiché) puis le numéro affiché.
   */
  const candidatesOf = (id, row) => {
    const ids = new Set();
    for (const anchor of row.querySelectorAll('a[href]')) {
      for (const match of (anchor.getAttribute('href') ?? '').matchAll(/\d{8,}/g)) ids.add(match[0]);
    }
    ids.delete(id);
    return [...[...ids].slice(0, 7), id];
  };

  /** Cherche dans l'app laquelle de ces identifiants est une commande Etsy connue. */
  const resolveKey = async (entry) => {
    const found = await send({ type: 'etsy-find', ids: entry.candidates });
    if (selected !== entry || !found?.id) return;
    entry.key = found.id;
    if (globalThis.ResinQueuePack?.isOpen() && globalThis.ResinQueuePack.openOrder() !== found.id) globalThis.ResinQueuePack.open(found.id, dock);
  };

  const select = (id, row) => {
    if (selected?.id === id) return;
    if (selected?.row?.isConnected) selected.row.style.outline = selected.previousOutline ?? '';
    const previousOutline = row.style.outline;
    row.style.outline = '3px solid #1f5fd6';
    row.style.outlineOffset = '-3px';
    selected = { id, key: id, row, name: buyerName(row), previousOutline, candidates: candidatesOf(id, row) };
    const entry = selected;
    // la boîte du bac déjà ouverte passe sur cette commande
    if (globalThis.ResinQueuePack?.isOpen()) globalThis.ResinQueuePack.open(id, dock);
    syncLinkedOrder();
    render();
    resolveKey(entry);
  };

  const openChitChats = async () => {
    if (!selected) return;
    const info = await send({ type: 'resolve', pageOrderNumber: selected.id, customerName: selected.name });
    if (!info?.chitchatsUrl) return;
    try {
      await navigator.clipboard.writeText(selected.name || selected.id);
    } catch {
      /* presse-papiers refusé : on ouvre quand même */
    }
    window.open(info.chitchatsUrl, '_blank', 'noopener');
  };


  /*
   * Étiquette VAT 2 po × 1 po (600 × 300 px à 300 dpi) en PNG. Etsy impose, pour l'Europe, de donner son numéro IOSS au
   * transporteur et d'écrire sur le colis la valeur de la commande en euros : « You must share Etsy's IOSS number,
   * IM3720000224 … write the value of this order in euros, €105.34, on your package ». L'étiquette porte les deux ; la valeur
   * en euros est lue dans ce texte sur la page Etsy (le numéro IOSS, à défaut, vient des réglages de l'app).
   */
  const readVatNotice = (row) => {
    for (const source of [row?.innerText, document.body.innerText]) {
      const text = String(source ?? '').replace(/\s+/g, ' ');
      const ioss = /IOSS number,?\s*([A-Z]{2}\d{8,})/i.exec(text)?.[1] ?? null;
      const euro = /(?:value of this order in euros|valeur de cette commande en euros)[^\d€]{0,20}€?\s?(\d[\d\s.,]*\d)/i.exec(text)?.[1] ?? /€\s?(\d[\d.,]*\d)\s*,?\s*on your package/i.exec(text)?.[1] ?? null;
      if (ioss || euro) return { ioss, euro: euro ? euro.replace(/\s/g, '').replace(',', '.') : null };
    }
    return { ioss: null, euro: null };
  };

  const drawVatLabel = ({ orderNumber, country, euro, ioss }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 300);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    // le texte rétrécit pour toujours tenir dans l'étiquette (jamais coupé)
    const fit = (text, weight, size, y) => {
      let px = size;
      ctx.font = `${weight} ${px}px ${FONT}`;
      while (ctx.measureText(text).width > 552 && px > 16) {
        px -= 2;
        ctx.font = `${weight} ${px}px ${FONT}`;
      }
      ctx.fillText(text, 24, y);
    };
    fit(`#${orderNumber}${country ? `  ·  ${country}` : ''}`, 700, 34, 20);
    fit(euro ? `€${euro}` : '€ —', 800, 120, 66);
    fit(ioss ? `IOSS ${ioss}` : 'IOSS —', 700, 52, 206);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 596, 296);
    return canvas;
  };

  const downloadVatLabel = async () => {
    if (!selected) return;
    const data = await send({ type: 'order-vat', orderExternalId: selected.key });
    if (!data || data.error) {
      alert(`Étiquette VAT impossible : ${data?.error ?? 'pas de réponse de l’app'}`);
      return;
    }
    const notice = readVatNotice(selected.row);
    if (!notice.euro) {
      alert('Je ne trouve pas « la valeur de cette commande en euros » sur la page : ouvre le détail de la commande (le texte « You must share Etsy’s IOSS number… ») puis réessaie. L’étiquette affichera « € — ».');
    }
    const canvas = drawVatLabel({ orderNumber: data.orderNumber, country: data.country, euro: notice.euro, ioss: notice.ioss ?? data.ioss });
    // imprimante choisie dans les options (QZ Tray) : l'étiquette sort directement, sans fenêtre ni fichier
    const { qzPrinter } = await chrome.storage.local.get('qzPrinter');
    if (qzPrinter) {
      if (!notice.euro) return; // pas d'étiquette « € — » gâchée : le message ci-dessus dit quoi faire
      const printed = await send({ type: 'qz-print', image: canvas.toDataURL('image/png').split(',')[1] });
      if (printed?.ok) return flashVat(`🖨 VAT envoyée à ${printed.printer}`);
      alert(`Impression directe impossible (${printed?.error ?? 'pas de réponse'}) : l’étiquette est téléchargée à la place.`);
    }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `vat-${data.orderNumber}.png`;
    document.documentElement.append(link);
    link.click();
    link.remove();
  };

  // petit message de confirmation, 3 s, en bas de l'écran
  const flashVat = (text) => {
    const note = document.createElement('div');
    note.setAttribute('data-resin-queue', '');
    note.textContent = text;
    note.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#2f7a4f;color:#fff;font:700 15px system-ui;padding:10px 16px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);';
    document.documentElement.append(note);
    setTimeout(() => note.remove(), 3000);
  };

  const removeDock = () => {
    dock?.remove();
    dock = null;
  };

  async function render() {
    const { dockTop = 14 } = await chrome.storage.local.get('dockTop');
    if (!dock) {
      dock = document.createElement('div');
      dock.setAttribute('data-resin-queue', '');
      document.documentElement.append(dock);
    }
    dock.style.cssText =
      `position:fixed;right:0;top:${dockTop}%;z-index:2147483646;display:flex;align-items:stretch;` +
      'font:600 13px system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px -8px rgba(20,30,60,.45);' +
      'border-radius:10px 0 0 10px;overflow:hidden;user-select:none;';

    const grip = document.createElement('span');
    grip.title = 'Glisser pour déplacer';
    grip.textContent = '⋮⋮';
    grip.style.cssText = 'display:flex;align-items:center;padding:0 5px;background:#163f8f;color:#9db7ea;cursor:ns-resize;font-size:11px;letter-spacing:-2px;';
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const move = (e) => {
        dock.style.top = `${Math.min(92, Math.max(4, (e.clientY / window.innerHeight) * 100))}%`;
        globalThis.ResinQueuePack?.place();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        chrome.storage.local.set({ dockTop: Number.parseFloat(dock.style.top) });
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
    });

    const btn = (label, title, color, onClick, extra = '') => {
      const node = document.createElement('button');
      node.type = 'button';
      node.title = title;
      node.textContent = label;
      node.style.cssText = `all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 12px;background:${color};color:#fff;${extra}`;
      node.addEventListener('click', onClick);
      return node;
    };

    const parts = [grip];
    if (!selected) {
      const hint = document.createElement('span');
      hint.textContent = 'Clique une commande';
      hint.title = 'Clique la ligne d’une commande pour la sélectionner';
      hint.style.cssText = 'display:flex;align-items:center;padding:10px 14px;background:#1f5fd6;color:#fff;';
      parts.push(hint);
    } else {
      const label = `${selected.name ?? ''} #${selected.id}`.trim();
      const live = mine() && linkStatus.link?.state === 'live';
      if (live) {
        // lien actif : plus de bouton « Chit Chats », un petit point vert devant le numéro (cliquer coupe le lien)
        const dot = btn(`● #${selected.id}`, `Lien Chit Chats actif : ${label} (cliquer pour couper)`, '#1f5fd6', () => send({ type: 'link-stop' }), 'padding:10px 12px;');
        dot.firstChild.textContent = '';
        const point = document.createElement('span');
        point.style.cssText = 'width:9px;height:9px;border-radius:99px;background:#3ccf7a;box-shadow:0 0 0 2px rgba(60,207,122,.35)';
        dot.append(point, `#${selected.id}`);
        parts.push(dot);
      } else parts.push(
        btn(`Chit Chats ${selected.name ?? '#' + selected.id}`, `Ouvrir ${label} sur Chit Chats (cherché par le nom de l’acheteur)`, '#1f5fd6', openChitChats, 'padding:10px 14px 10px 11px;'),
      );
      parts.push(btn('🏷 VAT', 'Étiquette VAT (2 × 1 po) : valeur en euros et numéro IOSS. Imprimée directement si une imprimante QZ Tray est choisie (options), sinon téléchargée en PNG', '#2f7a4f', async () => {
        if (selected.key === selected.id && selected.candidates.length > 1) await resolveKey(selected);
        downloadVatLabel();
      }, 'border-left:1px solid rgba(255,255,255,.25);'));
      const open = globalThis.ResinQueuePack?.isOpen();
      parts.push(
        btn(open ? '📦 J’ai packé ▴' : '📦 J’ai packé ▾', 'Indiquer ce qui est dans le bac de cette commande', '#7a4fd0', async () => {
          // l'identifiant exact est cherché avant d'ouvrir la boîte (un clic très rapide ne tombe pas sur « inconnue »)
          if (selected.key === selected.id && selected.candidates.length > 1) await resolveKey(selected);
          globalThis.ResinQueuePack?.toggle(selected.key, dock);
        }, 'border-left:1px solid rgba(255,255,255,.25);'),
      );
    }

    // lien live avec un onglet Chit Chats (même fonctionnement que sur Shopify)
    const link = linkStatus.link;
    const linkPart = document.createElement('span');
    linkPart.style.cssText = 'display:flex;align-items:stretch;border-left:1px solid rgba(255,255,255,.25);';
    if (mine() && link.state === 'live') {
      // « Stop live » est remplacé par « Bug » (signalement d'un bug dans l'app)
      linkPart.append(
        btn('🐞 Bug', 'Signaler un bug (ouvre l’app sur la fenêtre de signalement)', '#b43a3a', async () => {
          const result = await send({ type: 'open-bugs' });
          if (result && !result.ok && result.error) alert(result.error);
        }),
      );
    } else if (mine() && link.state === 'pending') {
      linkPart.append(btn('Clique « Link » sur Chit Chats… ✕', 'Annuler', '#8a6414', () => send({ type: 'link-stop' })));
    } else {
      linkPart.append(
        btn('🔗 Link', 'Lier un onglet Chit Chats : il suivra la commande sélectionnée ici', '#163f8f', async () => {
          const result = await send({ type: 'link-start' });
          if (result?.warning) alert(result.warning);
        }),
      );
    }
    parts.push(linkPart);

    dock.replaceChildren(...parts);
    globalThis.ResinQueuePack?.place();
  }

  /** Sélection d'une commande : un clic n'importe où sur sa ligne. */
  document.addEventListener(
    'click',
    (event) => {
      if (dock?.contains(event.target) || event.target.closest?.('[data-resin-queue-pack]')) return;
      const orders = findOrders();
      for (const [id, node] of orders) {
        const row = rowOf(node, id, orders);
        if (row.contains(event.target)) return select(id, row);
      }
    },
    true,
  );

  // une seule commande à l'écran : sélectionnée d'office (et à chaque rechargement de la liste)
  const autoSelect = () => {
    const orders = findOrders();
    if (selected && !selected.row.isConnected) {
      const again = orders.get(selected.id);
      if (again) selected = { ...selected, row: rowOf(again, selected.id, orders) };
    }
    if (!selected && orders.size === 1) {
      const [[id, node]] = [...orders];
      select(id, rowOf(node, id, orders));
    } else if (!selected) {
      const fromUrl = orderIdOf(location.href);
      if (fromUrl && orders.has(fromUrl)) select(fromUrl, rowOf(orders.get(fromUrl), fromUrl, orders));
    }
  };
  /*
   * Un petit bouton (le logo) reste sur chaque commande, en plus de la barre : il sélectionne
   * la commande et ouvre / ferme sa boîte « J'ai packé ».
   */
  const logoUrl = chrome.runtime.getURL('icon32.png');
  const addCardButtons = () => {
    const orders = findOrders();
    for (const [id, node] of orders) {
      const row = rowOf(node, id, orders);
      if (row.querySelector(':scope > [data-resin-queue-card]')) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-resin-queue-card', '');
      button.title = `Resin Queue : bac de la commande ${id}`;
      button.style.cssText =
        'all:unset;position:absolute;right:56px;top:12px;z-index:5;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
        'width:34px;height:34px;box-sizing:border-box;border-radius:999px;background:#fff;border:1px solid #c9d3e8;box-shadow:0 4px 12px -6px rgba(20,30,60,.5);';
      const icon = document.createElement('img');
      icon.src = logoUrl;
      icon.alt = 'Resin Queue';
      icon.style.cssText = 'width:22px;height:22px;display:block;';
      button.append(icon);
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        select(id, row);
        if (selected.key === selected.id && selected.candidates.length > 1) await resolveKey(selected);
        globalThis.ResinQueuePack?.toggle(selected.key, dock);
      });
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
      row.append(button);
    }
  };

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      addCardButtons();
      autoSelect();
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'link-changed') refreshLink();
    if (message?.type === 'link-sync') syncLinkedOrder();
    return false;
  });
  globalThis.addEventListener('resin-queue-pack', () => render());

  render();
  refreshLink();
  addCardButtons();
  autoSelect();
})();
