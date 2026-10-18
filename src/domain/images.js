import { getDb } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { getSettings, updateSettings } from './settings.service.js';

/**
 * Photos « bouche-trou » : quand un article n'a pas de vraie photo, Etsy
 * (et parfois Shopify) renvoie quand même une image générique, la même pour
 * des articles différents. On ne peut pas la reconnaître à son adresse, mais
 * à son usage : une image partagée par plusieurs articles différents n'est
 * pas la photo d'UN produit. S'y ajoutent les images masquées à la main
 * (« Pas la bonne photo » dans la fiche).
 */
export const SHARED_IMAGE_MIN_TITLES = 3;

export const placeholderImages = () => {
  const shared = getDb()
    .prepare(
      `SELECT image_url FROM order_items WHERE image_url IS NOT NULL
        GROUP BY image_url HAVING COUNT(DISTINCT lower(trim(title))) >= ?`,
    )
    .all(SHARED_IMAGE_MIN_TITLES)
    .map((row) => row.image_url);
  return new Set([...shared, ...(getSettings()['production.blockedImages'] ?? [])]);
};

/** L'image si c'est une vraie photo, sinon null. */
export const realImage = (url, placeholders) => (url && !placeholders.has(url) ? url : null);

export const blockImage = (url) => {
  const value = String(url ?? '').trim();
  if (!/^https?:\/\//.test(value)) throw badRequest('Adresse d’image invalide');
  const list = getSettings()['production.blockedImages'] ?? [];
  if (!list.includes(value)) updateSettings({ 'production.blockedImages': [...list, value] });
  return { blocked: value };
};
