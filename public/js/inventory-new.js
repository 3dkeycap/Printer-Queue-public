/*
 * Page /inventory/new : ajouter un objet d'inventaire depuis le téléphone (on se promène, on prend la
 * photo, on note le minimum et le fournisseur). Même API que le tableau de bord ; les questions au
 * scan se règlent ensuite sur l'ordinateur.
 */
import { resizePhoto } from './photo-resize.js';

const box = document.getElementById('box');
const suppliers = JSON.parse(document.body.dataset.suppliers || '[]');

const node = (tag, attrs = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  element.append(...[].concat(children));
  return element;
};

const showForm = () => {
  let photo = null;
  const name = node('input', { id: 'n', type: 'text', maxlength: '80', placeholder: 'Ex. Ruban d’emballage', autocomplete: 'off', required: true });
  const minimum = node('input', { type: 'number', min: '0', inputmode: 'numeric', value: '2' });
  const supplier = node('input', { type: 'text', maxlength: '80', list: 'suppliers', placeholder: 'Ex. Sticker Mule', autocomplete: 'off' });
  const orderQty = node('input', { type: 'number', min: '0', inputmode: 'numeric', placeholder: 'Ex. 4200' });
  const preview = node('img', { alt: '', hidden: true });
  const file = node('input', { type: 'file', accept: 'image/*', capture: 'environment' });
  const error = node('p', { class: 'err' });
  const send = node('button', { class: 'send', type: 'submit', text: 'Ajouter à l’inventaire' });

  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      photo = await resizePhoto(picked);
      preview.src = photo;
      preview.hidden = false;
    } catch (failure) {
      error.textContent = failure.message;
    }
  });

  const form = node('form', {}, [
    node('label', { for: 'n', text: 'Nom de l’objet' }),
    name,
    node('label', { text: 'Photo ' }, [node('span', { class: 'opt', text: '(facultatif)' })]),
    node('div', { class: 'photo' }, [preview, node('label', { class: 'snap' }, [node('span', { text: '📷 Prendre / choisir' }), file])]),
    node('label', { text: 'Minimum : scanner quand il en reste' }),
    minimum,
    node('label', {}, ['Quantité à commander ', node('span', { class: 'opt', text: '(facultatif)' })]),
    orderQty,
    node('label', {}, ['Commander chez ', node('span', { class: 'opt', text: '(facultatif)' })]),
    supplier,
    node('datalist', { id: 'suppliers' }, suppliers.map((value) => node('option', { value }))),
    error,
    send,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    send.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, reorder_at: minimum.value, order_qty: orderQty.value, supplier: supplier.value, image: photo ?? undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? `Erreur ${response.status}`);
      if (payload.supplier && !suppliers.includes(payload.supplier)) suppliers.push(payload.supplier);
      showDone(payload);
    } catch (failure) {
      error.textContent = failure.message;
      send.disabled = false;
    }
  });

  box.replaceChildren(
    node('h1', { text: 'Ajouter à l’inventaire' }),
    node('p', { class: 'sub', text: 'Un objet = une étiquette avec un code QR à imprimer plus tard.' }),
    form,
  );
  name.focus();
};

const showDone = (item) =>
  box.replaceChildren(
    node('div', { class: 'done' }, [
      node('div', { class: 'big', text: '✅' }),
      node('h1', { text: 'Ajouté !' }),
      node('p', { class: 'sub', text: item.name }),
      node('button', { type: 'button', text: '➕ Ajouter un autre objet', onclick: showForm }),
      node('a', { href: `/inventory/cards?ids=${item.id}&style=large`, target: '_blank', rel: 'noopener', text: '🖨 Voir la grande étiquette' }),
    ]),
  );

showForm();
