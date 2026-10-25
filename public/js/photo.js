/*
 * Photo d'un objet d'inventaire (étiquette grand format) : choisie sur l'ordinateur ou prise avec
 * le téléphone, réduite ici (700 px, JPEG) pour rester légère avant d'être envoyée à l'app.
 */
import { el } from './ui.js';
import { resizePhoto } from './photo-resize.js';

/**
 * Champ photo : value() vaut undefined (inchangée), null (retirée) ou une data URL (nouvelle photo).
 * `current` : adresse de la photo déjà enregistrée (aperçu), `initial` : photo choisie avant un redessin.
 */
export const photoField = ({ current = null, initial, onChange = () => {} } = {}) => {
  let value = initial;
  const preview = el('img', { class: 'photo-preview', alt: '', hidden: true });
  const input = el('input', { type: 'file', accept: 'image/*' });
  const remove = el('button', { class: 'mini-btn', type: 'button', hidden: true }, 'Retirer la photo');
  const status = el('span', { class: 'field-hint' }, '');

  const paint = () => {
    const src = value === undefined ? current : value;
    preview.hidden = !src;
    if (src) preview.src = src;
    remove.hidden = !src;
  };
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = '';
    try {
      value = await resizePhoto(file);
      onChange(value);
    } catch (error) {
      status.textContent = error.message;
    }
    paint();
  });
  remove.addEventListener('click', () => {
    value = null;
    input.value = '';
    onChange(null);
    paint();
  });
  paint();
  return { node: el('div', { class: 'photo-field' }, [preview, el('div', {}, [input, remove, status])]), value: () => value };
};
