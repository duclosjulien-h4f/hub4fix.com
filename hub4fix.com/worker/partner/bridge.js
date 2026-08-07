/**
 * Hub4Fix — le PONT identité partenaire <-> compte B2C (D1).
 *
 * Le partenaire s'authentifie via Zitadel. Pour qu'il conserve ses capacités B2C
 * (bibliothèque, tokens, achats), chaque identité Zitadel est reliée à un compte
 * D1 (h4f_site.users) :
 *   - s'il existe déjà (le partenaire était d'abord client B2C) -> on le relie
 *     (on complète `sub` s'il manquait) ;
 *   - s'il n'existe pas (partenaire arrivé directement) -> on le CRÉE
 *     (auth_provider='zitadel', sans mot de passe, email vérifié par Zitadel).
 *
 * Fonctions pures (dbSite = binding D1 h4f_site, dbPartner = binding D1 h4f_partner),
 * isolées de l'OIDC pour être testables sans Zitadel.
 */

// Retrouve le compte D1 par email, ou le crée. Renvoie { id, email, prenom, role, created }.
export async function findOrCreateD1User(dbSite, identity, uuid) {
  const email = String(identity && identity.email || '').toLowerCase().trim();
  if (!email) throw new Error('email_manquant');
  const sub = identity.sub || null;
  const prenom = identity.prenom || (identity.name || email.split('@')[0]);
  const now = new Date().toISOString();

  const existing = await dbSite.prepare('SELECT id, email, prenom, role, sub FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    // Compte B2C déjà là : on complète le lien Zitadel s'il manque, puis on l'utilise tel quel.
    if (sub && !existing.sub) {
      await dbSite.prepare('UPDATE users SET sub = ?, last_login = ? WHERE id = ?').bind(sub, now, existing.id).run();
    } else {
      await dbSite.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now, existing.id).run();
    }
    return { id: existing.id, email: existing.email, prenom: existing.prenom, role: existing.role, created: false };
  }

  // Aucun compte B2C : auto-provision. role reste 'client' (le statut PARTENAIRE
  // vit dans h4f_partner, séparé) ; pas de mot de passe (auth = Zitadel).
  const id = (uuid || (globalThis.crypto && crypto.randomUUID()) || String(Date.now()));
  await dbSite.prepare(
    "INSERT INTO users (id, sub, email, prenom, role, auth_provider, password_hash, email_verified, created_at, last_login) " +
    "VALUES (?, ?, ?, ?, 'client', 'zitadel', NULL, 1, ?, ?)"
  ).bind(id, sub, email, prenom, now, now).run();
  return { id, email, prenom, role: 'client', created: true };
}

// Statuts partenaire d'un compte D1 : { modelisateur: 'active'|'pending'|..., printer: ... }.
export async function partnerStatuses(dbPartner, userId) {
  const r = await dbPartner.prepare('SELECT type, status FROM partners WHERE user_id = ?').bind(userId).all();
  const out = {};
  for (const row of (r && r.results) || []) out[row.type] = row.status;
  return out;
}

// true si le compte est un partenaire ACTIF du type demandé (ex. 'modelisateur').
export async function isActivePartner(dbPartner, userId, type) {
  const row = await dbPartner.prepare(
    "SELECT 1 AS ok FROM partners WHERE user_id = ? AND type = ? AND status = 'active' LIMIT 1"
  ).bind(userId, type).first();
  return !!(row && row.ok);
}

// Valeurs autorisées pour le parc (whitelist — on ne stocke pas n'importe quoi).
export const PRINTER_TECHS = ['FDM', 'SLA', 'Material Jetting', 'SLM', 'SLS'];
export const PRINTER_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'nylon', 'resine'];
function cleanList(v, allowed) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return arr.map((x) => String(x).trim()).filter((x) => allowed.includes(x));
}

// Parc machines : liste [{brand, range, model, nozzle, bed, quantite}] issue du sélecteur
// cascade (PRINTER_TREE côté front). On assainit (trim/longueur) sans re-valider l'arbre
// entier côté serveur (le front fournit des valeurs valides). quantite 1..999 (lot identique).
function cleanMachines(v) {
  if (!Array.isArray(v)) return [];
  return v.map((m) => ({
    brand: String((m && m.brand) || '').trim().slice(0, 60),
    range: String((m && m.range) || '').trim().slice(0, 60),
    model: String((m && m.model) || '').trim().slice(0, 80),
    nozzle: /^0\.[468]$/.test(m && m.nozzle) ? m.nozzle : '0.4',
    bed: String((m && m.bed) || '').trim().slice(0, 20),
    plate: String((m && m.plate) || '').trim().slice(0, 20),
    quantite: Math.max(1, Math.min(999, parseInt(m && m.quantite, 10) || 1)),
  })).filter((m) => m.brand && m.model);
}
// L'arbre PRINTER_TREE est aujourd'hui 100% FDM -> techs='FDM' dès qu'il y a une machine
// (le matching P2 lit `techs`). À revoir si des machines résine/autre entrent dans l'arbre.
function techsFromMachines(machines) {
  return machines.length ? 'FDM' : '';
}

// Enregistre/maj le profil parc d'un printer (upsert, 1 par compte). Renvoie le profil nettoyé.
// Le parc est une LISTE de machines (json) ; les technos pour le matching en sont DÉRIVÉES.
// Repli : si aucune machine fournie mais des `techs` (rétrocompat), on garde les techs bruts.
export async function savePrinterProfile(dbPartner, userId, p) {
  const machines = cleanMachines(p.machines);
  const techs = machines.length ? techsFromMachines(machines) : cleanList(p.techs, PRINTER_TECHS).join(',');
  const materials = cleanList(p.materials, PRINTER_MATERIALS).join(',');
  const postal = String(p.postal_code || '').trim().slice(0, 10);
  const ville = String(p.ville || '').trim().slice(0, 120);
  const available = p.available === false || p.available === 0 ? 0 : 1;
  const machinesJson = JSON.stringify(machines);
  const now = new Date().toISOString();
  await dbPartner.prepare(
    "INSERT INTO printer_profiles (user_id, techs, materials, postal_code, ville, available, machines, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET techs=excluded.techs, materials=excluded.materials, " +
    "postal_code=excluded.postal_code, ville=excluded.ville, available=excluded.available, machines=excluded.machines, updated_at=excluded.updated_at"
  ).bind(userId, techs, materials, postal, ville, available, machinesJson, now, now).run();
  return { techs, materials, postal_code: postal, ville, available, machines };
}

export async function getPrinterProfile(dbPartner, userId) {
  const r = await dbPartner.prepare('SELECT techs, materials, postal_code, ville, available, machines FROM printer_profiles WHERE user_id = ?').bind(userId).first();
  if (!r) return null;
  let machines = [];
  try { machines = r.machines ? JSON.parse(r.machines) : []; } catch (e) { machines = []; }
  return { techs: r.techs || '', materials: r.materials || '', postal_code: r.postal_code || '', ville: r.ville || '', available: r.available !== 0, machines };
}

// ------------------------------------------------------------------ P2 : commandes réservables
const OFFER_TTL_MS = 24 * 3600 * 1000;   // offre valable 24 h (échéance absolue serveur)

// Département = 2 premiers chiffres du code postal (matching zone v1, simple et RGPD-friendly).
function dept(pc) { return String(pc || '').replace(/\D/g, '').slice(0, 2); }

// Un job est compatible avec le parc du printer si celui-ci a la techno ET le matériau
// requis (quand le job les précise). Parc vide sur un axe = pas de filtre sur cet axe.
export function jobMatchesPrinter(job, profile) {
  if (!profile) return false;
  const techs = String(profile.techs || '').split(',').filter(Boolean);
  const mats = String(profile.materials || '').split(',').filter(Boolean);
  if (job.tech && techs.length && techs.indexOf(job.tech) < 0) return false;
  if (job.material && mats.length && mats.indexOf(job.material) < 0) return false;
  return true;
}

// Crée un job d'impression réservable (open). montant_cents = snapshot déjà calculé (tarifs.js).
export async function createPrintJob(dbPartner, job) {
  const id = job.id || (globalThis.crypto && crypto.randomUUID()) || ('job-' + Date.now());
  const now = job.created_at || new Date().toISOString();
  const expires = job.offer_expires_at || new Date(Date.parse(now) + OFFER_TTL_MS).toISOString();
  await dbPartner.prepare(
    "INSERT INTO print_jobs (id, order_id, product_id, product_name, material, tech, print_time, weight, montant_cents, postal_code, ville, status, offer_expires_at, created_at, is_test) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)"
  ).bind(
    id, job.order_id || null, job.product_id || null, job.product_name || '', job.material || '', job.tech || '',
    String(job.print_time == null ? '' : job.print_time), String(job.weight == null ? '' : job.weight),
    Number(job.montant_cents) || 0, job.postal_code || '', job.ville || '', expires, now, job.is_test ? 1 : 0
  ).run();
  return { id, offer_expires_at: expires };
}

// Commandes visibles pour un printer : les OUVERTES non expirées compatibles avec son
// parc, PLUS celles qu'il a lui-même réservées. Tri : son département d'abord, puis la
// plus urgente. Renvoie aussi `same_dept` pour l'affichage.
export async function listPrinterJobs(dbPartner, userId, profile) {
  const now = new Date().toISOString();
  const r = await dbPartner.prepare(
    "SELECT * FROM print_jobs WHERE (status = 'open' AND offer_expires_at > ?) OR (printer_id = ? AND status IN ('reserved','committed','production','done')) ORDER BY offer_expires_at ASC"
  ).bind(now, userId).all();
  const myDept = dept(profile && profile.postal_code);
  const out = [];
  for (const j of (r && r.results) || []) {
    const mine = j.printer_id === userId && j.status !== 'open';
    if (!mine && !jobMatchesPrinter(j, profile)) continue;
    out.push({
      id: j.id, product_name: j.product_name || '', material: j.material || '', tech: j.tech || '',
      print_time: j.print_time || '', weight: j.weight || '', montant_cents: j.montant_cents || 0,
      postal_code: j.postal_code || '', ville: j.ville || '', offer_expires_at: j.offer_expires_at,
      status: j.status, mine, is_test: j.is_test === 1,
      same_dept: !!(myDept && myDept === dept(j.postal_code)),
      started_at: j.started_at || null, succeeded_at: j.succeeded_at || null, shipped_at: j.shipped_at || null,
    });
  }
  out.sort((a, b) => (b.same_dept - a.same_dept) || (a.offer_expires_at < b.offer_expires_at ? -1 : a.offer_expires_at > b.offer_expires_at ? 1 : 0));
  return out;
}

// Réservation EXCLUSIVE (premier arrivé) : UPDATE conditionnel atomique. Le serveur
// REVÉRIFIE l'expiration ici (offer_expires_at > now) — pas de confiance au client.
export async function reservePrintJob(dbPartner, jobId, userId) {
  const now = new Date().toISOString();
  const res = await dbPartner.prepare(
    "UPDATE print_jobs SET status = 'reserved', printer_id = ?, reserved_at = ? WHERE id = ? AND status = 'open' AND offer_expires_at > ?"
  ).bind(userId, now, jobId, now).run();
  const changed = res && res.meta ? res.meta.changes : 0;
  if (changed) return { ok: true, reserved_at: now };
  const j = await dbPartner.prepare("SELECT status, printer_id, offer_expires_at FROM print_jobs WHERE id = ?").bind(jobId).first();
  if (!j) return { ok: false, reason: 'introuvable' };
  if (j.status === 'reserved') return { ok: false, reason: j.printer_id === userId ? 'deja_par_vous' : 'deja_reservee' };
  if (String(j.offer_expires_at) <= now) return { ok: false, reason: 'expiree' };
  return { ok: false, reason: 'indisponible' };
}

// Libère une réservation : le printer rend la commande, elle repart 'open' pour les
// autres. GARDE `status='reserved'` : un job passé en 'committed' (GCODE téléchargé +
// clause acceptée, P4) N'EST PAS libérable ici — anti-abus (pas de GCODE emporté puis
// désistement gratuit). Seul le détenteur peut libérer.
export async function releasePrintJob(dbPartner, jobId, userId) {
  const res = await dbPartner.prepare(
    "UPDATE print_jobs SET status = 'open', printer_id = NULL, reserved_at = NULL WHERE id = ? AND printer_id = ? AND status = 'reserved'"
  ).bind(jobId, userId).run();
  const changed = res && res.meta ? res.meta.changes : 0;
  if (changed) return { ok: true };
  const j = await dbPartner.prepare("SELECT status, printer_id FROM print_jobs WHERE id = ?").bind(jobId).first();
  if (!j) return { ok: false, reason: 'introuvable' };
  if (j.printer_id !== userId) return { ok: false, reason: 'pas_la_votre' };
  if (j.status === 'committed') return { ok: false, reason: 'engagee' };   // GCODE téléchargé -> verrouillée (P4)
  return { ok: false, reason: 'non_liberable' };
}

// Suivi de production : 3 étapes SÉQUENTIELLES déclarées par le printer sur SA commande.
// start   : impression lancée   -> status 'production' (verrouille la libération : engagé).
// success : impression réussie  -> succeeded_at.
// ship    : pièce expédiée      -> status 'done' + shipped_at.
// Chaque étape n'est applicable que si la précédente est faite (UPDATE conditionnel).
const PROD_STEPS = {
  start:   { set: "status = 'production', started_at = ?", where: "status IN ('reserved','committed') AND started_at IS NULL" },
  success: { set: "succeeded_at = ?", where: "status = 'production' AND started_at IS NOT NULL AND succeeded_at IS NULL" },
  ship:    { set: "status = 'done', shipped_at = ?", where: "succeeded_at IS NOT NULL AND shipped_at IS NULL" },
};
export async function advancePrintJob(dbPartner, jobId, userId, step) {
  const cfg = PROD_STEPS[step];
  if (!cfg) return { ok: false, reason: 'etape_inconnue' };
  const now = new Date().toISOString();
  const res = await dbPartner.prepare(
    "UPDATE print_jobs SET " + cfg.set + " WHERE id = ? AND printer_id = ? AND " + cfg.where
  ).bind(now, jobId, userId).run();
  const changed = res && res.meta ? res.meta.changes : 0;
  if (changed) return { ok: true, step, at: now };
  const j = await dbPartner.prepare("SELECT printer_id, status FROM print_jobs WHERE id = ?").bind(jobId).first();
  if (!j) return { ok: false, reason: 'introuvable' };
  if (j.printer_id !== userId) return { ok: false, reason: 'pas_la_votre' };
  return { ok: false, reason: 'etape_non_applicable' };   // hors séquence (précédente non faite ou déjà faite)
}

// Dépose une candidature partenaire (pending) pour un compte D1 lié. Idempotent :
// refuse un doublon en attente ou déjà actif du même type.
export async function applyForPartner(dbPartner, userId, email, type, motivation, portfolio) {
  const cur = await dbPartner.prepare(
    'SELECT status FROM partners WHERE user_id = ? AND type = ? LIMIT 1'
  ).bind(userId, type).first();
  if (cur && (cur.status === 'pending' || cur.status === 'active')) {
    return { ok: false, reason: cur.status };  // déjà en cours / déjà partenaire
  }
  const now = new Date().toISOString();
  if (cur) {
    // une précédente candidature rejetée/suspendue : on la repasse en pending.
    await dbPartner.prepare(
      "UPDATE partners SET status='pending', motivation=?, portfolio=?, created_at=?, decided_at=NULL, decided_by=NULL WHERE user_id=? AND type=?"
    ).bind(motivation || '', portfolio || '', now, userId, type).run();
  } else {
    await dbPartner.prepare(
      "INSERT INTO partners (user_id, email, type, status, motivation, portfolio, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)"
    ).bind(userId, email, type, motivation || '', portfolio || '', now).run();
  }
  return { ok: true, status: 'pending' };
}
