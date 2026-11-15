import { getDb } from '../db/index.js';

/*
 * Réglages → SKU : tous les produits Shopify et Etsy déjà vendus (d'après les commandes importées), avec leur variante
 * et leur SKU. Lecture seule. Pas le catalogue complet : un produit jamais commandé n'y est pas (le lire chez Etsy
 * demanderait une permission de plus, « listings_r »).
 */
export const listSkus = () =>
  getDb()
    .prepare(
      `SELECT o.source,
              i.title,
              NULLIF(TRIM(COALESCE(i.variant_title, '')), '') AS variant,
              NULLIF(TRIM(COALESCE(i.sku, '')), '') AS sku,
              COUNT(DISTINCT o.id) AS orders,
              SUM(i.quantity) AS units,
              MAX(COALESCE(o.placed_at, o.created_at)) AS last_at
         FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.source IN ('shopify', 'etsy')
        GROUP BY o.source, i.title, COALESCE(TRIM(i.variant_title), ''), COALESCE(TRIM(i.sku), '')
        ORDER BY o.source, i.title COLLATE NOCASE, variant COLLATE NOCASE`,
    )
    .all();
