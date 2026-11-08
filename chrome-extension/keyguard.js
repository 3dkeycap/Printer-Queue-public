/*
 * Shopify (et Etsy) ont des raccourcis clavier. La fenêtre « J'ai packé » est dans un Shadow DOM : pour la page, une touche
 * tapée dans nos champs vient de la fenêtre elle-même, pas d'un champ texte, et déclenchait ces raccourcis. Ce script est
 * chargé AVANT ceux de la page (document_start), donc son écouteur passe le premier : il arrête la touche quand elle vient
 * d'un champ de l'extension. Le texte s'écrit quand même (on n'annule pas la touche, on ne la fait juste pas circuler).
 */
(() => {
  const fromOurField = (event) => {
    const path = event.composedPath?.() ?? [];
    const first = path[0];
    if (!(first instanceof Element)) return false;
    const editable = first.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(first.tagName);
    return editable && path.some((node) => node instanceof Element && (node.hasAttribute('data-resin-queue-pack') || node.hasAttribute('data-resin-queue')));
  };
  for (const type of ['keydown', 'keypress', 'keyup']) {
    window.addEventListener(
      type,
      (event) => {
        if (fromOurField(event)) event.stopImmediatePropagation();
      },
      true,
    );
  }
})();
