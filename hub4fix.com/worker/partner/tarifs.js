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
export const TARIF_HORAIRE = { PLA: 3, PETG: 3.5, ABS: 4, ASA: 4.5, TPU: 5, nylon: 6, resine: 8 };
// €/g de matière consommée, par matériau (= €/kg / 1000). Résine ~35 €/kg (marché 25-40).
export const PRIX_MATIERE = { PLA: 0.025, PETG: 0.03, ABS: 0.03, ASA: 0.035, TPU: 0.05, nylon: 0.06, resine: 0.035 };
export const DEFAULT_MATERIAL = 'PLA';
export const REFERENCE_MACHINE = 'Bambu Lab A1';   // machine de référence (config annuelle — cf. plan)

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
