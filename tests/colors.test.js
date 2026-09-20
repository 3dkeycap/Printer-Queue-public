import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { useTempDb } from './helpers.js';

useTempDb('colors');
const { migrate } = await import('../src/db/migrate.js');
const { closeDb } = await import('../src/db/index.js');
const { listColors, resolveColorKey, updateColor } = await import('../src/domain/colors.js');

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
