import { el } from './ui.js';
import { commentOptions } from './store.js';

const ADD_CUSTOM = '__add_custom__';

/** Select de commentaire avec une option « + Ajouter » qui ouvre une invite pour un nouveau commentaire. */
export const buildCommentSelect = (part, actions, { className, placeholder = 'Aucun commentaire', stopClickPropagation = false } = {}) => {
  const options = commentOptions();
  const node = el(
    'select',
    { class: className, onclick: stopClickPropagation ? (event) => event.stopPropagation() : undefined },
    [
      el('option', { value: '', selected: !part.comment }, placeholder),
      ...options.map((option) => el('option', { value: option, selected: option === part.comment }, option)),
      part.comment && !options.includes(part.comment)
        ? el('option', { value: part.comment, selected: true }, part.comment)
        : null,
      el('option', { value: ADD_CUSTOM }, '+ Ajouter un commentaire…'),
    ].filter(Boolean),
  );

  node.addEventListener('change', async (event) => {
    const value = event.target.value;
    if (value === ADD_CUSTOM) {
      node.value = part.comment || '';
      await actions.addCustomComment(part.id);
    } else {
      await actions.patchPart(part.id, { comment: value || null }, { silent: true });
    }
  });

  return node;
};
