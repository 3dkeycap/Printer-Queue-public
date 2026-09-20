/**
 * Diagnostic Shopify : interroge l'Admin API directement, avec et sans le
 * filtre « non honorée », pour trancher entre deux causes possibles d'une
 * synchro qui revient toujours à 0 commande :
 *   1. la boutique n'a réellement aucune commande correspondante
 *   2. un filtre (fulfillment_status), un scope ou l'accès aux données
 *      protégées bloque la réponse
 *
 * Affiche la réponse brute de Shopify (tronquée), scope par scope, pour
 * qu'on n'ait plus à deviner.
 *
 *   docker compose exec app node scripts/diagnose-shopify.js
 */
import { migrate } from '../src/db/migrate.js';
import { getSettings } from '../src/domain/settings.service.js';
import { requestJson } from '../src/lib/http.js';

migrate();
const settings = getSettings();
const shop = settings['shopify.shopDomain'];
const token = settings['shopify.accessToken'];
const version = settings['shopify.apiVersion'];

if (!shop || !token) {
  console.error('Shopify non configuré (domaine de boutique ou token manquant dans Intégrations).');
  process.exit(1);
}

const call = async (label, params) => {
  const url = new URL(`https://${shop}/admin/api/${version}/orders.json`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('limit', '5');

  console.log(`\n--- ${label} ---`);
  console.log('URL :', url.toString());

  try {
    const body = await requestJson(url.toString(), {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      retries: 0,
    });
    const orders = body?.orders ?? [];
    console.log(`Résultat : ${orders.length} commande(s)`);
    if (orders.length) {
      console.log(
        'Exemple :',
        JSON.stringify(
          {
            id: orders[0].id,
            name: orders[0].name,
            fulfillment_status: orders[0].fulfillment_status,
            created_at: orders[0].created_at,
            customer: orders[0].customer ? '(présent)' : '(absent - donnée protégée non approuvée ?)',
          },
          null,
          2,
        ),
      );
    } else if (body?.errors) {
      console.log('Shopify a répondu avec des erreurs :', JSON.stringify(body.errors));
    }
  } catch (error) {
    console.log('ÉCHEC -', 'statut HTTP :', error.status ?? '(réseau)');
    console.log('Corps de la réponse :', JSON.stringify(error.body ?? String(error)).slice(0, 500));
  }
};

console.log('Boutique :', shop);
console.log('Version API :', version);

await call('Toutes les commandes, tous statuts confondus (status=any)', { status: 'any' });
await call(
  "Non honorées seulement (le filtre utilisé par la vraie synchro)",
  { status: 'any', fulfillment_status: 'unfulfilled' },
);

console.log(`
Comment lire le résultat :
  - Les deux appels échouent avec un statut 401/403 et un message sur les
    données protégées -> l'approbation "Protected customer data access" du
    Partner Dashboard n'est pas encore effective (peut prendre quelques
    minutes après soumission).
  - Le 1er appel renvoie des commandes mais le 2e renvoie 0 -> aucune de tes
    commandes n'est "non honorée" (déjà marquées Fulfilled dans Shopify, ou
    ce sont des commandes brouillon). Le filtre fait son travail correctement.
  - Les deux appels renvoient 0 sans erreur -> la boutique ${shop} n'a
    tout simplement aucune commande dans les 60 derniers jours pour l'instant.
`);
