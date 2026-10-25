/*
 * Photo d'un objet d'inventaire (étiquette grand format) : choisie sur l'ordinateur ou prise avec
 * le téléphone, réduite ici (700 px, JPEG) pour rester légère avant d'être envoyée à l'app.
 */
import { el } from './ui.js';

const MAX_SIDE = 700;

// FileReader (data URL) plutôt qu'une adresse blob: : la politique de sécurité de l'app n'autorise que 'self' et data:
const readFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image illisible'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      image.onerror = () => reject(new Error('Image illisible'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

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
      value = await readFile(file);
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
