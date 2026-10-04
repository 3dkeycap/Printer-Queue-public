import { getDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
import { listColors } from './colors.js';
import { getSettings } from './settings.service.js';

const log = createLogger('addons');

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Vrai si un des textes contient un des mots-clés (insensible à la casse, aux
 * accents et aux espaces multiples).
 */
export const matchesAnyKeyword = (texts, keywords) => {
  const haystacks = (Array.isArray(texts) ? texts : [texts]).map(normalize).filter(Boolean);
  return (keywords ?? [])
    .map(normalize)
    .filter(Boolean)
    .some((keyword) => haystacks.some((text) => text.includes(keyword)));
};

/**
 * Retire de la file les pièces créées automatiquement pour un supplément
 * (articles toujours en stock : pas à imprimer).
 *
 * Une pièce n'est JAMAIS retirée dès qu'un humain s'en est occupé : pièce
 * manuelle, changement de statut, imprimante/UV/commentaire/notes modifiés...
 * C'est la façon de dire « celle-là, on la veut dans la file ».
 */
export const purgeNonPrintableParts = () => {
  const db = getDb();
  const keywords = getSettings()['production.nonPrintableKeywords'] ?? [];
  if (!keywords.length) return { removed: 0 };

  const candidates = db
    .prepare(
      `SELECT p.id, i.title, i.variant_title, i.sku
         FROM parts p
         JOIN order_items i ON i.id = p.order_item_id
         JOIN orders o ON o.id = p.order_id
        WHERE o.source <> 'manual'
          AND p.status = 'TO_PRINT'
          AND p.updated_at = p.created_at
          AND NOT EXISTS (SELECT 1 FROM part_events e WHERE e.part_id = p.id AND e.actor <> 'worker')`,
    )
    .all()
    .filter((row) => matchesAnyKeyword([row.title, row.variant_title, row.sku], keywords));

  const remove = db.prepare('DELETE FROM parts WHERE id = ?');
  db.transaction(() => candidates.forEach((row) => remove.run(row.id)))();
  if (candidates.length) log.info('supplement parts removed from the queue', { removed: candidates.length });
  return { removed: candidates.length };
};

/**
 * « Enlever tout maintenant » : parcourt la file et retire les pièces dont le
 * titre, la variante ou le SKU contient un des mots (liste passée par l'écran,
 * donc même non enregistrée). Action explicite de l'opérateur : on ne regarde
 * pas si un humain a touché la pièce. Reste hors de portée : les pièces
 * ajoutées à la main, celles en cours d'impression ou déjà imprimées.
 * `dryRun` ne supprime rien et renvoie seulement ce qui serait retiré.
 */
export const purgeNow = ({ keywords, dryRun = false } = {}) => {
  const db = getDb();
  const list = (Array.isArray(keywords) ? keywords : getSettings()['production.nonPrintableKeywords'] ?? [])
    .map((word) => String(word).trim())
    .filter(Boolean);
  if (!list.length) return { removed: 0, items: [], dryRun };

  const matches = db
    .prepare(
      `SELECT p.id, p.name, p.status, i.title, i.variant_title, i.sku, o.order_number
         FROM parts p
         JOIN order_items i ON i.id = p.order_item_id
         JOIN orders o ON o.id = p.order_id
        WHERE o.source <> 'manual' AND p.status IN ('TO_PRINT', 'FAILED')`,
    )
    .all()
    .filter((row) => matchesAnyKeyword([row.title, row.variant_title, row.sku], list));

  if (!dryRun) {
    const remove = db.prepare('DELETE FROM parts WHERE id = ?');
    db.transaction(() => matches.forEach((row) => remove.run(row.id)))();
    if (matches.length) log.info('queue cleaned by operator', { removed: matches.length });
  }

  // regroupé par nom pour que l'écran puisse montrer ce qui part
  const byName = new Map();
  for (const row of matches) byName.set(row.name, (byName.get(row.name) ?? 0) + 1);
  return {
    removed: matches.length,
    items: [...byName].map(([name, count]) => ({ name, count })),
    dryRun,
  };
};

/**
 * Clés des résines à retirer du tableau « À imprimer » : celles cochées dans
 * les réglages, plus toute résine dont le nom, la clé ou un alias CONTIENT un
 * des mots de la liste « à ne pas imprimer » (ex. « Nylon » retire toutes les
 * couleurs Nylon, « Nylon Gray » aussi).
 */
export const hiddenColorKeys = () => {
  const settings = getSettings();
  const hidden = new Set(settings['production.hiddenColors'] ?? []);
  const keywords = settings['production.nonPrintableKeywords'] ?? [];
  if (keywords.length) {
    for (const color of listColors()) {
      if (matchesAnyKeyword([color.key, color.name, ...(color.aliases ?? [])], keywords)) hidden.add(color.key);
    }
  }
  return [...hidden];
};
