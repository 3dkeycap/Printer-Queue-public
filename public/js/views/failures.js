import { el, formatDate, fromNow, icon, swatch } from '../ui.js';
import { state } from '../store.js';

const SOURCE_LABEL = { shopify: 'Shopify', etsy: 'Etsy', manual: 'Interne' };

const percent = (rate) => `${Math.round(rate * 100)} %`;

/** Gravité du taux : sert à la couleur de la barre. */
const level = (rate, attempts) => {
  if (attempts < 2) return 'low'; // un seul essai : pas une tendance
  if (rate >= 0.5) return 'high';
  if (rate >= 0.25) return 'mid';
  return 'low';
};

const rateCell = (rate, failures, attempts) =>
  el('div', { class: `rate rate-${level(rate, attempts)}` }, [
    el('div', { class: 'rate-bar' }, el('span', { style: { width: `${Math.max(rate * 100, 3)}%` } })),
    el('strong', {}, percent(rate)),
    el('span', { class: 'cell-sub' }, `${failures} sur ${attempts}`),
  ]);

const colorTags = (file) =>
  el(
    'div',
    { class: 'rate-colors' },
    // une résine sans aucun échec (100 % de réussite) n'a rien à faire ici
    file.colors.filter((color) => color.failures > 0).map((color) =>
      el(
        'span',
        { class: 'tag', title: `${color.name} : ${color.failures} échec(s) sur ${color.attempts} impression(s)` },
        [swatch(color.hex), `${color.name} ${color.failures}/${color.attempts}`],
      ),
    ),
  );

export const renderFailures = (root, actions) => {
  const report = state.failures;
  if (!report) return;

  const { totals } = report;
  const showHidden = state.showHiddenFailures;
  const hiddenCount = report.files.filter((file) => file.hidden).length;
  const files = report.files.filter((file) => showHidden || !file.hidden);
  const history = report.history.filter((item) => showHidden || !item.hidden);
  const selected = state.failureFile;
  const rows = selected ? history.filter((item) => item.name === selected) : history;

  if (!totals.failures) {
    root.append(
      el('div', { class: 'empty' }, [
        icon('alert'),
        el('strong', {}, "Aucun échec pour l'instant"),
        "Quand tu appuies sur le triangle rouge d'une carte, la pièce retourne dans « À imprimer » et l'échec est gardé ici, avec le taux d'échec par fichier.",
      ]),
    );
    return;
  }

  root.append(
    el('p', { class: 'failures-summary' }, [
      el('strong', {}, `${totals.failures} échec(s)`),
      ` sur ${totals.attempts} impression(s) terminées — ${percent(totals.rate)} au total. `,
      "Une impression compte quand elle est « Imprimé » ou en échec ; celles en cours ne comptent pas encore. Un fichier sans aucun échec n'apparaît pas ici. ",
      hiddenCount
        ? el(
            'button',
            { class: `chip${showHidden ? ' is-on' : ''}`, onclick: () => actions.toggleHiddenFailures() },
            showHidden ? `Cacher les ${hiddenCount} fichier(s) masqué(s)` : `Afficher les ${hiddenCount} fichier(s) masqué(s)`,
          )
        : null,
    ]),

    el('div', { class: 'section-title' }, 'Taux d’échec par fichier'),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Fichier'),
          el('th', { style: { width: '190px' } }, 'Taux d’échec'),
          el('th', { style: { width: '90px' } }, 'Échecs'),
          el('th', {}, 'Par résine (échecs / impressions)'),
          el('th', { style: { width: '120px' } }, 'Dernier échec'),
          el('th', { style: { width: '100px' } }, ''),
        ])),
        el('tbody', {}, files.map((file) =>
          el(
            'tr',
            {
              class: [selected === file.name ? 'is-selected' : '', file.hidden ? 'is-muted' : ''].filter(Boolean).join(' '),
              title: 'Voir seulement les échecs de ce fichier',
              onclick: () => actions.selectFailureFile(file.name),
            },
            [
              el('td', {}, el('div', { class: 'cell-name' }, file.name)),
              el('td', {}, rateCell(file.rate, file.failures, file.attempts)),
              el('td', {}, String(file.failures)),
              el('td', {}, colorTags(file)),
              el('td', {}, [el('div', {}, fromNow(file.lastFailure)), el('div', { class: 'cell-sub' }, formatDate(file.lastFailure))]),
              el('td', {}, el(
                'button',
                {
                  class: 'mini-btn',
                  title: file.hidden
                    ? 'Remettre ce fichier dans la liste'
                    : "Masquer ce fichier de la liste (fichier corrigé, cas réglé…). Ses échecs restent gardés.",
                  onclick: (event) => {
                    event.stopPropagation();
                    actions.hideFailureFile(file.name, !file.hidden);
                  },
                },
                file.hidden ? 'Réafficher' : 'Masquer',
              )),
            ],
          ),
        )),
      ]),
    ]),

    el('div', { class: 'section-title failures-history-title' }, [
      'Historique des échecs',
      selected
        ? el('button', { class: 'chip is-on', onclick: () => actions.selectFailureFile('') }, [icon('close'), selected])
        : null,
    ]),
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'grid' }, [
        el('thead', {}, el('tr', {}, [
          el('th', { style: { width: '150px' } }, 'Quand'),
          el('th', {}, 'Pièce'),
          el('th', {}, 'Résine'),
          el('th', {}, 'Commande'),
          el('th', {}, 'Par'),
        ])),
        el('tbody', {}, rows.map((item) =>
          el('tr', {}, [
            el('td', {}, [el('div', {}, formatDate(item.created_at)), el('div', { class: 'cell-sub' }, fromNow(item.created_at))]),
            el('td', {}, [
              el('div', { class: 'cell-name' }, item.name),
              el('div', { class: 'cell-sub' }, [item.sku, item.variant_title].filter(Boolean).join(' · ') || '—'),
            ]),
            el('td', {}, el('span', { class: 'tag' }, [swatch(item.color_hex), item.color_name])),
            el('td', {}, [
              el('div', {}, item.order_number ?? '—'),
              el('div', { class: 'cell-sub' }, SOURCE_LABEL[item.source] ?? item.source ?? ''),
            ]),
            el('td', { class: 'cell-sub' }, item.actor ?? '—'),
          ]),
        )),
      ]),
    ]),
    el('p', { class: 'table-foot' }, `${rows.length} échec(s) affiché(s)${history.length >= 300 ? ' (les 300 plus récents)' : ''}`),
  );
};
