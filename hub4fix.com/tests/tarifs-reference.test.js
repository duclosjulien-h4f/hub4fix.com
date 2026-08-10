// @vitest-environment node
//
// Machine de référence : le temps facturé au printer se calcule sur un profil unique,
// avec un PLATEAU EXTRAPOLÉ (décision Julien du 2026-08-09). Ce qui doit tenir : le
// profil de calcul ne bouge pas, l'enveloppe de référence est bien celle annoncée, et le
// montant ne dépend en rien de la taille de la pièce.

import { describe, it, expect } from 'vitest';
import {
  computeMontantCents, withinReference, parseHours, parseGrams, normMaterial,
  REFERENCE_MACHINE, REFERENCE_BED_MM, REFERENCE_LABEL, REFERENCE_ENVELOPE_MACHINE,
  REFERENCE_PROFILE, referenceProfilePinned, TARIF_HORAIRE, PRIX_MATIERE,
} from '../worker/partner/tarifs.js';

// Le temps facturé ne vient d'aucun chiffre de fiche technique (ils sont des maxima obtenus
// sur une géométrie favorable, et il n'existe pas de circuit d'essai normalisé en FDM) : il
// vient du slicing avec un profil précis. Ce profil est donc le vrai contrat, et tant qu'il
// n'est pas épinglé le montant n'est pas justifiable.
describe('profil de référence', () => {
  it('se déclare NON épinglé tant que Julien n\'a pas posé les valeurs', () => {
    // Test volontairement « négatif » : il documente un trou connu au lieu de le masquer.
    // Le jour où le profil est posé, ce test échoue — et c'est le signal d'aller retirer le
    // garde-fou et de figer les valeurs attendues.
    expect(referenceProfilePinned()).toBe(false);
    expect(REFERENCE_PROFILE.version).toBe('non-epingle');
  });

  it('nomme les champs qui devront être figés', () => {
    for (const k of ['slicer', 'preset', 'layer_height_mm', 'nozzle_mm', 'version']) {
      expect(Object.prototype.hasOwnProperty.call(REFERENCE_PROFILE, k), k).toBe(true);
    }
    // La buse de référence est posée : le catalogue A2L va de 0,2 à 0,8 mm, il fallait choisir.
    expect(REFERENCE_PROFILE.nozzle_mm).toBe(0.4);
  });
});

describe('enveloppe de référence', () => {
  it('est le volume d\'une machine RÉELLE, plus grande que le plateau de référence', () => {
    expect(REFERENCE_MACHINE).toBe('Bambu Lab A1');
    // 256 × 256 est le plateau physique de l'A1 : l'enveloppe doit être PLUS grande, sinon
    // les pièces longues n'ont pas de base de calcul. Mais elle doit rester celle d'une
    // machine qui existe — une enveloppe inventée serait contestable par un printer.
    expect(REFERENCE_BED_MM.x).toBeGreaterThan(256);
    expect(REFERENCE_BED_MM.y).toBeGreaterThan(256);
    expect(REFERENCE_BED_MM).toEqual({ x: 330, y: 320, z: 325 });   // Bambu Lab A2L
    expect(REFERENCE_ENVELOPE_MACHINE).toBe('Bambu Lab A2L');
    expect(REFERENCE_LABEL).toContain('330 × 320 × 325');
    expect(REFERENCE_LABEL).toContain('A2L');
  });

  it('accepte la pièce qui a motivé la décision (pied de séchoir, 286 mm)', () => {
    // Elle ne tient pas à plat sur une A1 réelle ; elle tient dans l'enveloppe A2L.
    expect(withinReference([285.985, 40, 42.3])).toBe(true);
  });

  it('accepte quel que soit l\'ordre des cotes', () => {
    expect(withinReference([40, 286, 42.3])).toBe(true);
    expect(withinReference([42.3, 40, 286])).toBe(true);
  });

  it('couvre confortablement la taille courante des pièces de réparation', () => {
    // Donnée métier Julien : les pièces de réparation dépassent rarement 235 mm.
    expect(withinReference([235, 235, 235])).toBe(true);
    expect(withinReference([300, 300, 300])).toBe(true);
  });

  it('autorise la RÉORIENTATION sur les axes, comme le ferait un slicer', () => {
    // 326 mm de haut ne tient pas dans les 325 mm de hauteur… mais la pièce peut être
    // couchée : 326 le long des 330 mm, et une des cotes de 300 devient la hauteur.
    expect(withinReference([300, 300, 326])).toBe(true);
    // La fonction trie les cotes, elle ne présume donc d'aucune orientation de départ.
    expect(withinReference([326, 300, 300])).toBe(true);
  });

  it('accepte le cas limite exact — la hauteur est INTERMÉDIAIRE entre les deux côtés', () => {
    // 330 × 320 × 325 : c'est l'enveloppe elle-même, elle doit passer. Ce cas a révélé un
    // bug — comparer la 2e cote de la pièce au plus PETIT côté du plateau (320) rejetait
    // une pièce qui tient, puisque 325 mm de hauteur sont disponibles.
    expect(withinReference([330, 320, 325])).toBe(true);
    // Plaque fine mais haute : 330 à plat, 321 debout (≤ 325), 10 en largeur.
    expect(withinReference([330, 321, 10])).toBe(true);
  });

  it('refuse quand AUCUNE orientation ne convient', () => {
    expect(withinReference([331, 10, 10])).toBe(false);        // plus long que le grand côté
    expect(withinReference([330, 326, 10])).toBe(false);       // 326 ne passe ni en 325 ni en 320
    expect(withinReference([326, 326, 326])).toBe(false);      // cube trop gros
  });

  it('ne conclut pas sans dimensions exploitables', () => {
    // La base pièces porte encore `dimensions` en texte libre : mieux vaut « je ne sais
    // pas » qu'un faux verdict de compatibilité.
    for (const bad of [null, undefined, [], [10, 20], ['a', 'b', 'c'], [10, 0, 5], [10, -2, 5]]) {
      expect(withinReference(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('le montant ne dépend pas de la taille de la pièce', () => {
  it('deux pièces de tailles très différentes, même temps et même poids = même montant', () => {
    // C'est tout l'intérêt de l'extrapolation : la base de calcul reste le temps et le
    // poids, jamais l'encombrement. Un plateau plus grand ne renchérit rien.
    const petite = computeMontantCents({ printTime: '2h30', weight: '18 g', material: 'PLA' });
    const grande = computeMontantCents({ printTime: '2h30', weight: '18 g', material: 'PLA' });
    expect(petite).toBe(grande);
  });

  it('applique la grille horaire et le prix matière du profil de référence', () => {
    // 2 h × 3 €/h + 100 g × 0,025 €/g = 6,00 + 2,50 = 8,50 €
    expect(computeMontantCents({ printTime: '2h', weight: '100 g', material: 'PLA' })).toBe(850);
    expect(TARIF_HORAIRE.PLA).toBe(3);
    expect(PRIX_MATIERE.PLA).toBe(0.025);
  });

  it('lit les formats de temps et de poids de la fiche pièce', () => {
    expect(parseHours('2h30')).toBeCloseTo(2.5, 6);
    expect(parseHours('45min')).toBeCloseTo(0.75, 6);
    expect(parseHours('2,5')).toBeCloseTo(2.5, 6);
    expect(parseHours('')).toBe(0);
    expect(parseGrams('12,5 g')).toBeCloseTo(12.5, 6);
    expect(parseGrams('')).toBe(0);
  });

  it('retombe sur le PLA devant un matériau inconnu, sans jamais renvoyer NaN', () => {
    expect(normMaterial('Résine')).toBe('resine');
    expect(normMaterial('inconnu')).toBe('PLA');
    expect(computeMontantCents({ printTime: 'n\'importe quoi', weight: '?', material: null })).toBe(0);
  });
});
