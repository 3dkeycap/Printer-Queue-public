import { el, icon } from './ui.js';
import { commentOptions } from './store.js';

const ADD_CUSTOM = '__add_custom__';

/** Commentaires d'une pièce : une étiquette par ligne. */
export const commentList = (part) =>
  String(part?.comment ?? '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * Commentaires en étiquettes : chacune se retire avec ×, le menu en ajoute
 * une (liste prédéfinie, ou « + Autre… » pour en écrire une nouvelle).
 */
export const buildCommentTags = (part, actions, { compact = false } = {}) => {
  let current = commentList(part);
  const root = el('div', { class: `comment-tags${compact ? ' is-compact' : ''}`, onclick: (event) => event.stopPropagation() });

  const save = async (list) => {
    current = list;
    paint();
    await actions.patchPart(part.id, { comment: list }, { silent: true });
  };

  function paint() {
    const picker = el(
      'select',
      { class: compact ? 'cell-select comment-add' : 'comment-add', onclick: (event) => event.stopPropagation() },
      [
        el('option', { value: '', selected: true }, current.length ? '+ Ajouter' : '+ Commentaire'),
        ...commentOptions()
          .filter((option) => !current.includes(option))
          .map((option) => el('option', { value: option }, option)),
        el('option', { value: ADD_CUSTOM }, '+ Autre…'),
      ],
    );
    picker.addEventListener('change', async (event) => {
      const value = event.target.value;
      picker.value = '';
      if (!value) return;
      if (value === ADD_CUSTOM) {
        const added = await actions.addCustomComment(part.id, current);
        if (added) {
          current = added;
          paint();
        }
      } else {
        await save([...current, value]);
      }
    });

    root.replaceChildren(
      ...current.map((comment) =>
        el('span', { class: 'comment-tag' }, [
          comment,
          el(
            'button',
            {
              class: 'chip-x',
              type: 'button',
              title: 'Retirer ce commentaire',
              onclick: (event) => {
                event.stopPropagation();
                save(current.filter((value) => value !== comment));
              },
            },
            icon('close'),
          ),
        ]),
      ),
      picker,
    );
  }

  paint();
  return root;
};
