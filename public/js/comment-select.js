import { el, icon } from './ui.js';
import { commentOptions } from './store.js';

let datalistSeq = 0;

/** Commentaires d'une pièce : une étiquette par ligne. */
export const commentList = (part) =>
  String(part?.comment ?? '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * Tags d'une pièce, comme les listes des Réglages : on tape puis Entrée (ou
 * virgule) pour ajouter, avec les tags prédéfinis en suggestion ; × retire.
 * Un nouveau tag rejoint automatiquement la liste prédéfinie.
 */
export const buildCommentTags = (part, actions, { compact = false } = {}) => {
  let current = commentList(part);
  const listId = `tag-options-${(datalistSeq += 1)}`;
  const root = el('div', {
    class: `comment-tags chip-editor${compact ? ' is-compact' : ''}`,
    onclick: (event) => {
      event.stopPropagation();
      root.querySelector('input')?.focus();
    },
  });

  const save = async (list) => {
    current = list;
    paint();
    await actions.patchPart(part.id, { comment: list }, { silent: true });
  };

  const add = async (raw) => {
    const value = String(raw ?? '').replace(/,$/, '').trim();
    if (!value || current.includes(value)) return;
    await save([...current, value]);
    if (!commentOptions().includes(value)) await actions.addCommentOption(value);
    root.querySelector('input')?.focus();
  };

  function paint() {
    const input = el('input', {
      class: 'chip-input',
      list: listId,
      placeholder: current.length ? 'Ajouter…' : 'Ajouter un tag…',
      enterkeyhint: 'done',
      onclick: (event) => event.stopPropagation(),
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        add(input.value);
      } else if (event.key === 'Backspace' && !input.value && current.length) {
        save(current.slice(0, -1)).then(() => root.querySelector('input')?.focus());
      }
    });
    // choix d'une suggestion dans la liste : ajouté directement
    input.addEventListener('input', () => {
      if (commentOptions().includes(input.value) && !current.includes(input.value)) add(input.value);
    });
    input.addEventListener('blur', () => {
      if (input.value.trim()) add(input.value);
    });

    root.replaceChildren(
      ...current.map((comment) =>
        el('span', { class: 'chip-tag' }, [
          comment,
          el(
            'button',
            {
              class: 'chip-x',
              type: 'button',
              title: 'Retirer ce tag',
              onclick: (event) => {
                event.stopPropagation();
                save(current.filter((value) => value !== comment));
              },
            },
            icon('close'),
          ),
        ]),
      ),
      input,
      el('datalist', { id: listId }, commentOptions().filter((o) => !current.includes(o)).map((o) => el('option', { value: o }))),
    );
  }

  paint();
  return root;
};
