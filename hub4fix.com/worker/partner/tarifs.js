/**
 * Hub4Fix — grille de rémunération PRINTER (P2). CONFIG ajustable : c'est le SEUL
 * endroit où vivent les tarifs (pas de valeur en dur ailleurs). Julien ajuste ici.
 *
 * Rému printer = temps machine (profil de la machine de RÉFÉRENCE, cf. règle A1) ×
 * tarif horaire(matériau) + poids × prix matière(matériau). On calcule à la CRÉATION
 * du job (snapshot figé dans print_jobs), jamais au moment de la réservation.
 *
 * Défauts de départ (à valider) : tarif horaire 3 €/h (PLA) … 8 €/h (résine) — cf.
 * PLAN_ESPACE_PRINTER §7 ; prix matière calé sur produit.html (0,025 €/g PLA).
 */

// €/h de temps machine, par matériau (profil machine de référence).
//
// ⚠️ QUATRE DE CES SEPT LIGNES N'ONT PAS DE BASE DE RÉFÉRENCE RÉELLE (relevé le 10/08/2026
// sur la fiche technique A2L, et déjà vrai de l'A1). La machine de référence est une FDM
// ouverte : plateau plafonné à 80 °C, pas de chambre chauffée, matériaux annoncés PLA, PETG,
// TPU, PVA (+ PLA-CF / PETG-CF avec buse acier trempé). Donc :
//   - ABS, ASA, nylon : la machine de référence ne les imprime pas. Le temps reste calculable
//     (le slicer accepte ces réglages sur un profil A1) mais il ne correspond à aucune
//     impression possible sur cette machine.
//   - resine : pire, c'est de la SLA. Un temps SLA dépend du nombre de couches et du temps
//     d'exposition, PAS de la vitesse d'une tête d'outil. Un profil FDM ne produit
//     strictement aucun temps de référence exploitable. Or `printer_profiles.techs` accepte
//     SLA, SLS, SLM, Material Jetting : ces commandes existeront.
// Ce n'est PAS un défaut de ce fichier, c'est une décision de rémunération à prendre (cf.
// PLAN_ESPACE_PRINTER §6bis et TodoList). Laissé en l'état volontairement : bricoler un
// coefficient ici sans arbitrage produirait des montants faux mais crédibles, le pire cas.
export const TARIF_HORAIRE = { PLA: 3, PETG: 3.5, ABS: 4, ASA: 4.5, TPU: 5, nylon: 6, resine: 8 };
// €/g de matière consommée, par matériau (= €/kg / 1000). Résine ~35 €/kg (marché 25-40).
export const PRIX_MATIERE = { PLA: 0.025, PETG: 0.03, ABS: 0.03, ASA: 0.035, TPU: 0.05, nylon: 0.06, resine: 0.035 };
export const DEFAULT_MATERIAL = 'PLA';

// ---------------------------------------------------------------- machine de référence
// Le temps facturé se calcule TOUJOURS sur ce profil, quelle que soit la machine réelle
// du printer (cf. PLAN_ESPACE_PRINTER §6bis). Référence évolutive : elle suit le marché
// et change chaque année.
export const REFERENCE_MACHINE = 'Bambu Lab A1';

// ENVELOPPE DE RÉFÉRENCE = le volume d'une machine RÉELLE (arbitrages Julien des 09 et
// 10/08/2026). Le plateau de l'A1 fait 256 × 256 : une pièce plus longue n'aurait aucun
// temps de référence, et la base de calcul disparaîtrait au moment où on en a besoin.
//
// Première idée écartée : extrapoler à 500 × 500. Julien a objecté, et il a raison : une
// vraie machine de 500 n'est pas une A1 avec un plateau plus grand. Axes plus longs ->
// masse mobile et énergie cinétique plus grandes (E = ½mv²) -> moteurs plus gros pour ne
// pas perdre de pas -> inertie rotorique bien supérieure (J croît comme r⁴) et couple qui
// s'effondre plus tôt en fréquence -> accélérations réelles plus basses. Une grande
// imprimante est structurellement plus lente. Une enveloppe de 500 aurait donc désigné une
// machine qui n'existe pas, et le chiffre aurait été contestable par n'importe quel printer
// grand format.
//
// Retenu : le volume de la **Bambu Lab A2L**, la remplaçante annoncée de l'A1 (elle
// n'existe qu'en grand format). L'enveloppe cesse d'être une fiction : c'est le volume
// d'une machine du marché, et de la future machine de référence. Elle couvre très largement
// des pièces de réparation qui dépassent rarement 235 mm (donnée métier de Julien).
//
// Valeur CONFIRMÉE sur la fiche technique A2L (Julien, 10/08/2026) : volume d'impression
// 330 × 320 × 325 mm. Autres cotes de cette fiche, pour mémoire : buses 0,2 / 0,4 / 0,6 /
// 0,8 mm · buse max 300 °C · plateau max 80 °C · débit max 28 mm³/s · FDM ouverte.
//
// ⚠️ NE JAMAIS RAISONNER SUR LES VITESSES DE FICHE TECHNIQUE (correction Julien, 10/08/2026).
// La fiche annonce 500 mm/s et 10 m/s². Ces chiffres sont des MAXIMA obtenus sur une
// géométrie choisie pour les atteindre — typiquement un grand carré à congés larges, qui ne
// demande quasiment aucune décélération et laisse la tête tenir sa vitesse de croisière. Sur
// une pièce détachée réelle, faite de courtes trajectoires et de changements de direction,
// cette vitesse n'est jamais atteinte : c'est l'accélération et la gestion des angles qui
// font le temps. Et il n'existe AUCUN circuit d'essai normalisé en FDM — le seul repère
// courant, le Benchy « en 8 min », mesure 60 × 31 × 48 mm, donc les mêmes courts
// déplacements, et il est massivement optimisé par la communauté avec des profils maison.
// Conséquence : deux fiches affichant les mêmes maxima ne disent RIEN de la comparabilité des
// temps réels. J'avais tiré de ces chiffres que « la dynamique ne se dégrade pas au grand
// format » : inférence retirée.
//
// Le temps de référence ne peut donc venir que d'UNE SEULE source : le slicing de la vraie
// pièce avec NOTRE profil de référence. Voir REFERENCE_PROFILE ci-dessous.
//
// Ce que l'enveloppe NE dit pas :
//  - que le temps calculé est le temps réel du printer. Le temps reste celui du PROFIL A1 :
//    un étalon commun à tous les partenaires, pas une prévision. Sur une pièce proche de la
//    limite, une machine capable de l'imprimer sera en pratique plus lente qu'une A1 (voir
//    ci-dessus) — l'écart est assumé, et marginal puisque ces tailles sont rares.
//  - que la pièce est imprimable sur la machine de référence. L'enveloppe sert à CHIFFRER ;
//    la compatibilité se vérifie sur le parc réel du printer. Deux notions distinctes.
export const REFERENCE_BED_MM = { x: 330, y: 320, z: 325 };   // Bambu Lab A2L
export const REFERENCE_ENVELOPE_MACHINE = 'Bambu Lab A2L';
export const REFERENCE_LABEL = REFERENCE_MACHINE + ' — enveloppe de référence ' +
  REFERENCE_BED_MM.x + ' × ' + REFERENCE_BED_MM.y + ' × ' + REFERENCE_BED_MM.z + ' mm (' +
  REFERENCE_ENVELOPE_MACHINE + ')';

// ---------------------------------------------------------------- profil de référence
// LE VRAI CONTRAT AVEC LE PRINTER, C'EST CE PROFIL — pas le nom de la machine.
//
// Aucun chiffre de fiche technique ne fait foi (voir ci-dessus), et il n'existe pas de circuit
// d'essai normalisé. Le temps de référence ne peut donc venir que du slicing de la pièce avec
// un profil PRÉCIS. Or « Bambu Lab A1 » ne désigne pas un profil : le même slicer propose
// plusieurs préréglages pour la même machine (qualité, standard, sport…), avec des vitesses et
// des hauteurs de couche différentes, donc des temps qui n'ont rien à voir. Et ces préréglages
// évoluent d'une version de slicer à l'autre.
//
// Sans épinglage, la rémunération des printers dériverait à chaque mise à jour du slicer, sans
// que personne ne l'ait décidé ni ne puisse l'expliquer. Même raisonnement que `engine_image`
// sur les jobs de slice : un temps livré doit rester explicable.
//
// ⚠️ VALEURS À POSER PAR JULIEN — celles ci-dessous sont des PLACEHOLDERS explicites, pas des
// choix. Elles ne servent qu'à rendre le trou visible en base et dans l'écran printer plutôt
// que de le laisser implicite.
export const REFERENCE_PROFILE = {
  slicer: 'à définir',          // ex. 'Bambu Studio 2.x' / 'OrcaSlicer 2.3.0'
  preset: 'à définir',          // nom EXACT du préréglage machine + process
  layer_height_mm: null,        // hauteur de couche du profil de référence
  nozzle_mm: 0.4,               // buse de référence (le catalogue A2L va de 0,2 à 0,8)
  version: 'non-epingle',       // identifiant à faire évoluer À CHAQUE changement de profil
};
/** Le profil est-il réellement épinglé ? Tant que non, tout `printTime` produit n'est pas
 *  reproductible : on peut afficher un montant, on ne peut pas le justifier. */
export function referenceProfilePinned() {
  return REFERENCE_PROFILE.version !== 'non-epingle'
    && REFERENCE_PROFILE.preset !== 'à définir'
    && REFERENCE_PROFILE.layer_height_mm != null;
}

/** La pièce entre-t-elle dans l'enveloppe de référence ?
 *
 *  Les cotes sont TRIÉES avant comparaison, ce qui autorise la réorientation sur les axes —
 *  exactement ce qu'un slicer fait : une pièce de 326 mm de haut se couche. En revanche pas
 *  de placement en DIAGONALE : l'enveloppe est un cadre de chiffrage, pas un solveur de
 *  calepinage, et une diagonale ne serait pas reproductible d'une machine à l'autre.
 *
 *  Renvoie null si les dimensions ne sont pas exploitables — on ne conclut pas sans donnée.
 *  (La colonne `dimensions` de la base pièces est encore du texte libre : ce cas est la
 *  règle, pas l'exception, jusqu'à ce qu'elle porte trois nombres.) */
export function withinReference(dims) {
  const d = Array.isArray(dims) ? dims.map(Number).filter((n) => n > 0 && isFinite(n)) : [];
  if (d.length !== 3) return null;
  // On trie LES DEUX suites par ordre décroissant et on compare terme à terme. C'est
  // exactement équivalent à essayer les six orientations, et c'est exact — là où un tri
  // naïf se trompe : avec l'enveloppe A2L (330 × 320 × 325), la HAUTEUR est intermédiaire
  // entre les deux côtés du plateau. Comparer la 2e cote de la pièce au plus petit côté du
  // plateau rejetait des pièces qui tiennent, par exemple 330 × 320 × 325 elle-même.
  const p = d.slice().sort((x, y) => y - x);
  const box = [REFERENCE_BED_MM.x, REFERENCE_BED_MM.y, REFERENCE_BED_MM.z].sort((x, y) => y - x);
  return p[0] <= box[0] && p[1] <= box[1] && p[2] <= box[2];
}

// "2h30" / "45min" / "2,5" -> heures décimales. Robuste aux formats de la fiche pièce
// (même logique que produit.html _printMinutes, exprimée en heures).
export function parseHours(printTime) {
  const t = String(printTime == null ? '' : printTime).trim();
  const hm = t.match(/(\d+)\s*h\s*(\d+)?/i);
  if (hm) return parseInt(hm[1], 10) + (hm[2] ? parseInt(hm[2], 10) / 60 : 0);
  const mn = t.match(/(\d+)\s*min/i);
  if (mn) return parseInt(mn[1], 10) / 60;
  const n = parseFloat(t.replace(',', '.'));
  return isNaN(n) ? 0 : n;   // nombre nu = heures
}

// "12,5 g" / "12" -> grammes.
export function parseGrams(weight) {
  const m = String(weight == null ? '' : weight).match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

// Normalise le matériau vers une clé connue (insensible à la casse / aux accents),
// sinon retombe sur PLA.
export function normMaterial(material) {
  const m = String(material == null ? '' : material).trim().toLowerCase().replace(/é|è|ê/g, 'e');
  for (const k of Object.keys(TARIF_HORAIRE)) if (k.toLowerCase() === m) return k;
  return DEFAULT_MATERIAL;
}

// Montant printer en CENTIMES (entier). Snapshot à la création du job.
export function computeMontantCents({ printTime, weight, material }) {
  const mat = normMaterial(material);
  const euros = parseHours(printTime) * TARIF_HORAIRE[mat] + parseGrams(weight) * PRIX_MATIERE[mat];
  return Math.max(0, Math.round(euros * 100));
}

// "12,34 €" pour l'affichage.
export function eurosLabel(cents) {
  return (Math.round(Number(cents) || 0) / 100).toFixed(2).replace('.', ',') + ' €';
}
