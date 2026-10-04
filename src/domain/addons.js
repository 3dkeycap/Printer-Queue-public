import { getDb } from '../db/index.js';
import { createLogger } from '../lib/logger.js';
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
