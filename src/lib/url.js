/**
 * Retire les `/` de fin d'une URL de base. L'URL publique du serveur est
 * souvent collée avec un slash final (copiée depuis la barre d'adresse) ;
 * sans ce nettoyage, la concaténation avec un chemin produirait un double
 * slash et l'URL de callback OAuth ne matcherait plus jamais ce qui est
 * enregistré chez Shopify/Etsy, avec un rejet silencieux à la clé.
 */
export const normalizeBaseUrl = (url) => String(url ?? '').trim().replace(/\/+$/, '');
