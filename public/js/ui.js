/** Tiny DOM helpers — the dashboard is deliberately build-step free. */

/** Custom properties (--foo) need setProperty; Object.assign silently drops them. */
const applyStyle = (node, style) => {
  for (const [property, value] of Object.entries(style)) {
    if (property.startsWith('--')) node.style.setProperty(property, value);
    else node.style[property] = value;
  }
};

export const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') applyStyle(node, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

export const icon = (name, cls = 'icon') => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};

export const swatch = (hex, cls = '') => el('span', { class: `swatch ${cls}`, style: { background: hex } });

export const clear = (node) => {
  while (node.firstChild) node.firstChild.remove();
  return node;
};

const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const DATE = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });

export const formatDate = (value) => (value ? DATE.format(new Date(value)) : '—');

export const fromNow = (value) => {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(-hours, 'hour');
  return RELATIVE.format(-Math.round(hours / 24), 'day');
};

export const plural = (count, one, many) => `${count} ${count > 1 ? many : one}`;

let toastTimer = 0;
export const toast = (message, kind = 'ok') => {
  const host = document.getElementById('toasts');
  const node = el('div', { class: `toast ${kind}` }, [icon(kind === 'err' ? 'alert' : 'check'), message]);
  host.append(node);
  clearTimeout(toastTimer);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity .25s';
    setTimeout(() => node.remove(), 250);
  }, 3200);
};

/** Small promise-based confirm/prompt dialog built on <dialog>. */
export const modal = ({ title, body, confirmLabel = 'Confirmer', onConfirm }) =>
  new Promise((resolve) => {
    const dialog = document.getElementById('modal');
    clear(dialog);
    const content = el('div', {}, [
      el('div', { class: 'modal-head' }, title),
      el('div', { class: 'modal-body' }, body),
      el('div', { class: 'modal-foot' }, [
        el('button', { class: 'ghost-btn', onclick: () => { dialog.close(); resolve(null); } }, 'Annuler'),
        el(
          'button',
          {
            class: 'primary-btn',
            onclick: async () => {
              const result = onConfirm ? await onConfirm() : true;
              dialog.close();
              resolve(result);
            },
          },
          confirmLabel,
        ),
      ]),
    ]);
    dialog.append(content);
    dialog.showModal();
  });
