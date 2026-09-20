import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('colors');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { getColor, listColors, resolveColorKey, updateColor } = await import('../src/domain/colors.js');

describe('résolution des couleurs de résine', () => {
  before(() => migrate());
  after(() => closeDb());

  it('reconnaît un nom exact, en anglais comme en français', () => {
    assert.equal(resolveColorKey(['Black']), 'black');
    assert.equal(resolveColorKey(['Noir']), 'black');
  });

  it('extrait la couleur du titre de variante', () => {
    assert.equal(resolveColorKey(['Glow in the dark / R1']), 'glow');
    assert.equal(resolveColorKey(['Mint / SA']), 'mint');
  });

  it('préfère l\'alias le plus long', () => {
    // "bleu nuit" doit gagner contre "bleu"
    assert.equal(resolveColorKey(['Bleu nuit / R2']), 'navy');
  });

  it('ignore la casse et les accents', () => {
    assert.equal(resolveColorKey(['TRANSPARENT']), 'clear');
    assert.equal(resolveColorKey(['doré']), 'gold');
  });

  it('retombe sur "unassigned" quand rien ne correspond', () => {
    assert.equal(resolveColorKey(['Taille XL']), 'unassigned');
    assert.equal(resolveColorKey([]), 'unassigned');
    assert.equal(resolveColorKey([null, undefined]), 'unassigned');
  });

  it('tient compte des alias personnalisés ajoutés par l\'atelier', () => {
    updateColor('red', { aliases: ['rouge', 'red', 'lava'] });
    assert.equal(resolveColorKey(['Lava / R3'], listColors()), 'red');
  });
});

describe('le nylon est toujours séparé de la résine, jamais mélangé à la couleur de base', () => {
  before(() => migrate());
  after(() => closeDb());

  it('crée une entrée dédiée à la première rencontre, distincte de la couleur de base', () => {
    const before1 = listColors().find((c) => c.key === 'nylon-grey');
    assert.equal(before1, undefined);

    const key = resolveColorKey(['Nylon Grey / R2']);
    assert.equal(key, 'nylon-grey');
    assert.notEqual(key, 'grey');

    const created = getColor('nylon-grey');
    assert.equal(created.name, 'Nylon Gris');
    assert.ok(created.sort_order > getColor('grey').sort_order, 'classée après les résines');
  });

  it('réutilise la même entrée nylon aux passages suivants (pas de doublon)', () => {
    const totalBefore = listColors().length;
    const key = resolveColorKey(['NYLON  Grey'], listColors()); // casse et espace différents
    assert.equal(key, 'nylon-grey');
    assert.equal(listColors().length, totalBefore, 'aucune nouvelle entrée créée');
  });

  it('ne touche pas la couleur de base : "Grey" seul reste "grey"', () => {
    assert.equal(resolveColorKey(['Grey / R2'], listColors()), 'grey');
  });

  it("fonctionne avec n'importe quelle couleur, pas seulement celle déjà vue", () => {
    const key = resolveColorKey(['Nylon Black / SA'], listColors());
    assert.equal(key, 'nylon-black');
    assert.notEqual(key, 'black');
  });

  it('retombe sur une entrée "nylon" générique si aucune couleur précise n\'est reconnue', () => {
    const key = resolveColorKey(['Nylon (couleur au choix)'], listColors());
    assert.equal(key, 'nylon');
  });

  it('un nom de couleur qui contiendrait accidentellement "nylon" ailleurs ne boucle pas', () => {
    // une entrée déjà nylon ne doit jamais se re-préfixer elle-même
    const first = resolveColorKey(['Nylon Grey'], listColors());
    const second = resolveColorKey(['Nylon Grey'], listColors());
    assert.equal(first, 'nylon-grey');
    assert.equal(second, 'nylon-grey');
  });
});
