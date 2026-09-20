/**
 * Les états de production d'une pièce, calqués sur les cases à cocher de la
 * feuille de calcul remplacée par l'application :
 *   Print Started -> PRINTING, Print Fail -> FAILED,
 *   Printed Successfully -> DONE, Done (colis parti) -> SHIPPED.
 */
export const STATUSES = [
  {
    key: 'TO_PRINT',
    label: 'To print',
    labelFr: 'À imprimer',
    hint: 'Commande reçue, pas encore lancée sur une machine',
    accent: '#8C8579',
    icon: 'inbox',
  },
  {
    key: 'PRINTING',
    label: 'Printing',
    labelFr: 'En impression',
    hint: 'Sur une imprimante en ce moment',
    accent: '#C9922E',
    icon: 'printer',
  },
  {
    key: 'FAILED',
    label: 'Failed',
    labelFr: 'Échec',
    hint: 'Impression ratée, à relancer',
    accent: '#B4553F',
    icon: 'alert',
  },
  {
    key: 'DONE',
    label: 'Printed',
    labelFr: 'Imprimé',
    hint: 'Imprimé, lavé, post-durci, prêt à être emballé',
    accent: '#6E8F63',
    icon: 'check',
  },
  {
    key: 'SHIPPED',
    label: 'Shipped',
    labelFr: 'Expédié',
    hint: 'Scanné par Chit Chats, sorti de la production',
    accent: '#5E8C84',
    icon: 'truck',
  },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);

/** Colonnes du tableau « À imprimer » (SHIPPED quitte la production). */
export const BOARD_STATUSES = STATUS_KEYS.filter((key) => key !== 'SHIPPED');

/** Alias historique conservé pour les filtres « scope=board ». */
export const ACTIVE_STATUSES = BOARD_STATUSES;

export const isStatus = (value) => STATUS_KEYS.includes(value);

export const getStatus = (key) => STATUSES.find((s) => s.key === key) ?? null;

/**
 * Transitions autorisées. Volontairement permissif (un opérateur doit pouvoir
 * revenir en arrière après un mauvais clic), sauf les sauts absurdes.
 */
const TRANSITIONS = {
  TO_PRINT: ['PRINTING', 'FAILED', 'DONE'],
  PRINTING: ['FAILED', 'DONE', 'TO_PRINT'],
  FAILED: ['TO_PRINT', 'PRINTING', 'DONE'],
  DONE: ['SHIPPED', 'FAILED', 'PRINTING', 'TO_PRINT'],
  SHIPPED: ['DONE'],
};

export const canTransition = (from, to) => {
  if (!isStatus(to)) return false;
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
};

export const nextStatuses = (from) => TRANSITIONS[from] ?? [];

/** Bouton « avancer d'un cran » du tableau de bord. */
export const defaultNextStatus = (from) => {
  const flow = {
    TO_PRINT: 'PRINTING',
    PRINTING: 'DONE',
    FAILED: 'TO_PRINT',
    DONE: 'SHIPPED',
    SHIPPED: null,
  };
  return flow[from] ?? null;
};

/** Statuts retirés en v2 et réécrits au démarrage sur leur équivalent. */
export const LEGACY_STATUS_MAP = {
  FILE_READY: 'TO_PRINT',
  IN_INVENTORY: 'DONE',
};
