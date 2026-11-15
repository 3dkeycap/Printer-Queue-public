/*
 * Extension : traduit SEULEMENT nos éléments ([data-resin-queue] ; le bac dans son shadow root, voir pack-panel.js),
 * jamais la page de Shopify / Etsy / Chit Chats. La langue est celle de la personne réglée dans les options de
 * l'extension (ou, à défaut, de la dernière personne qui a packé), d'après Réglages → Équipe de l'app.
 */
(() => {
  const i18n = globalThis.RQI18n;
  if (!i18n) return;
  i18n.observe(document.documentElement, { scope: '[data-resin-queue]' });
  const apply = () =>
    chrome.runtime
      .sendMessage({ type: 'ui-lang' })
      .then((result) => result?.lang && i18n.setLang(result.lang, { remember: false }))
      .catch(() => {});
  apply();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.user || changes.lastPacker) apply();
  });
})();
