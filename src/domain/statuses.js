/**
 * The seven production states of a single physical part.
 * Order matters: it drives the Kanban column order.
 */
export const STATUSES = [
  {
    key: 'TO_PRINT',
    label: 'To print',
    labelFr: 'À imprimer',
    hint: 'Commande reçue, fichier pas encore tranché',
    accent: '#8C8579',
    icon: 'inbox',
  },
  {
    key: 'FILE_READY',
    label: 'File ready',
    labelFr: 'Fichier prêt',
    hint: 'Tranché, supports posés, prêt pour la machine',
    accent: '#6E8FA6',
    icon: 'file',
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
    label: 'Done',
    labelFr: 'Terminé',
    hint: 'Imprimé, lavé, post-durci',
    accent: '#6E8F63',
    icon: 'check',
  },
  {
    key: 'IN_INVENTORY',
    label: 'In inventory',
    labelFr: 'En stock',
    hint: 'En bac, prêt à être emballé',
    accent: '#7E6CA8',
    icon: 'box',
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

/** Statuses displayed on the production board (SHIPPED leaves the board). */
export const ACTIVE_STATUSES = STATUS_KEYS.filter((key) => key !== 'SHIPPED');

export const isStatus = (value) => STATUS_KEYS.includes(value);

export const getStatus = (key) => STATUSES.find((s) => s.key === key) ?? null;

/**
 * Allowed transitions. The board is deliberately permissive (an operator must
 * be able to drag a card back when they mis-click) but a few moves make no
 * sense and are rejected unless `force` is used.
 */
const TRANSITIONS = {
  TO_PRINT: ['FILE_READY', 'PRINTING', 'FAILED', 'DONE', 'IN_INVENTORY'],
  FILE_READY: ['TO_PRINT', 'PRINTING', 'FAILED', 'DONE', 'IN_INVENTORY'],
  PRINTING: ['FAILED', 'DONE', 'IN_INVENTORY', 'FILE_READY', 'TO_PRINT'],
  FAILED: ['TO_PRINT', 'FILE_READY', 'PRINTING', 'DONE'],
  DONE: ['IN_INVENTORY', 'SHIPPED', 'FAILED', 'PRINTING'],
  IN_INVENTORY: ['SHIPPED', 'DONE', 'FAILED', 'TO_PRINT'],
  SHIPPED: ['IN_INVENTORY', 'DONE'],
};

export const canTransition = (from, to) => {
  if (!isStatus(to)) return false;
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
};

export const nextStatuses = (from) => TRANSITIONS[from] ?? [];

/** The one-click "advance" button of the dashboard. */
export const defaultNextStatus = (from) => {
  const flow = {
    TO_PRINT: 'FILE_READY',
    FILE_READY: 'PRINTING',
    PRINTING: 'DONE',
    FAILED: 'TO_PRINT',
    DONE: 'IN_INVENTORY',
    IN_INVENTORY: 'SHIPPED',
    SHIPPED: null,
  };
  return flow[from] ?? null;
};
