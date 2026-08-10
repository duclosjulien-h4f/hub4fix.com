/**
 * Hub4Fix — Worker "h4f-partner" : espace partenaires (modélisateurs, printers).
 *
 * Auth = Zitadel (OIDC Authorization Code + PKCE, même IdP que l'admin). Au retour
 * de connexion, le PONT (bridge.js) relie ou crée le compte D1 (h4f_site) du
 * partenaire par email -> il garde ses capacités B2C. Le STATUT partenaire vit
 * dans la base propre h4f_partner (binding DB) ; l'admin le valide (technique A).
 *
 * Variables (dashboard) : ISSUER, CLIENT_ID, SESSION_SECRET [secret], COOKIE_DOMAIN.
 *   ISSUER/CLIENT_ID : le même client Zitadel que l'admin, OU un client partenaire dédié.
 * Bindings (wrangler.toml) : DB (h4f_partner), DB_SITE (h4f_site = le pont), RESERV_R2, AI.
 *
 * Ce fichier = SOCLE (auth + /auth/me + candidature). Les endpoints métier (Hot
 * List, réservation, photos, validation IA) sont portés depuis h4f-api à l'étape suivante.
 */

import { findOrCreateD1User, partnerStatuses, applyForPartner, isActivePartner, savePrinterProfile, getPrinterProfile,
  createPrintJob, listPrinterJobs, reservePrintJob, releasePrintJob, advancePrintJob } from './bridge.js';
import { computeMontantCents, REFERENCE_MACHINE, REFERENCE_BED_MM, REFERENCE_LABEL,
  REFERENCE_PROFILE, referenceProfilePinned } from './tarifs.js';
import { APP_HTML } from './app-page.js';

const SCOPES = 'openid profile email';
const SESSION_TTL = 60 * 60 * 12;   // 12 h
const TMP_TTL = 60 * 10;
const SESS_COOKIE = 'h4f_partner_sess';

// Feed public des pièces (servi par l'admin). Source de la Hot List en attendant
// une vraie métrique de demande (wishlist) — chantier séparé.
const FEED_URL = 'https://h4f-admin.duclosjulien.workers.dev/api/pieces.json';
const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';   // Gemma vision (validation photos)
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// ---------------------------------------------------------------- horloges
// UNE seule colonne porte l'échéance (`reservations.expires_at`), et c'est elle qui
// bloque la pièce pour les autres modélisateurs. Son SENS change avec le statut :
//
//   pending-review, sans photos -> PHOTO_HOLD  : 2 h pour envoyer les photos, sinon
//                                  la pièce repart d'elle-même.
//   pending-review, photos là   -> REVIEW_HOLD : 7 j pour NOTRE feu vert. Le
//                                  modélisateur n'a aucun délai qui court : il
//                                  attend, on ne lui mange pas ses 72 h.
//   active                      -> WORK_WINDOW : 72 h pour déposer, ancrées sur
//                                  `validated_at`, pas sur la date de réservation.
//   submitted                   -> FILE_REVIEW : 60 j, le délai contractuel
//                                  d'examen (CGV modélisateurs art. 2.5). Un
//                                  fichier déposé ne peut pas se faire doubler
//                                  pendant qu'on le regarde.
//
// L'expiration est PARESSEUSE : aucune tâche ne balaie la table, toutes les
// lectures filtrent sur `expires_at > now`. Une échéance dépassée libère la pièce à
// la seconde où quelqu'un regarde — pas de planificateur à surveiller, pas de
// fenêtre pendant laquelle la base mentirait.
const PHOTO_HOLD_MS  = 2 * 3600 * 1000;
const REVIEW_HOLD_MS = 7 * 24 * 3600 * 1000;
const WORK_WINDOW_MS = 72 * 3600 * 1000;
const EXTENSION_MS   = 72 * 3600 * 1000;              // prolongation, UNE seule fois
const FILE_REVIEW_MS = 60 * 24 * 3600 * 1000;

// Statuts qui tiennent la pièce. 'pending-review' en fait partie : sans quoi deux
// modélisateurs travailleraient la même pièce pendant qu'on regarde les photos.
const HOLDING = "('pending-review','active','submitted','suspended')";

// ---------------------------------------------------------------- formats de dépôt
// VOCABULAIRE (arbitrage Julien du 09/08/2026) — deux fichiers portent le nom « 3MF »
// et ils n'ont pas les mêmes enjeux :
//   3MF SOURCE  géométrie seule, tessellée, AUCUN réglage de slicing. Neutre vis-à-vis
//               de la machine. C'est ce que notre conversion produit depuis le STEP.
//   3MF MASTER  le 3MF source + les réglages de slicing d'une machine donnée. Prêt à
//               partir au slicer. Un par pièce × machine, dans le bucket h4f-masters.
//               (Le PoC l'appelle « 3MF projet » — même objet.)
// Les deux sont REFUSÉS au modélisateur : le premier fige une tessellation que nous
// n'avons pas choisie, le second y ajoute des réglages qui ne sont pas les nôtres.
//
// Le modélisateur dépose DEUX fichiers, et jamais de maillage :
//   - le SOURCE NATIF (.f3d ou l'équivalent de son logiciel) = l'œuvre. Il sert
//     l'archive et les retouches ultérieures ; H4F ne sait pas nécessairement
//     l'ouvrir, et ce n'est pas son rôle.
//   - le STEP = format d'échange ouvert, à géométrie solide exacte. C'est LUI qui
//     alimente la conversion en 3MF et l'aperçu 3D. Sans lui, la préparation
//     retomberait dans le logiciel du modélisateur, à la main, pièce par pièce.
//
// Le natif est validé par LISTE NOIRE, pas par liste blanche : une liste blanche
// refuserait le prochain logiciel de CAO, et « ou équivalent suivant le logiciel »
// est la règle. Ce qu'on refuse est précis : les MAILLAGES. Ce sont des sorties de
// la chaîne H4F (le 3MF est notre format pivot), jamais des entrées.
const MESH_EXTS = ['.stl', '.3mf', '.obj', '.ply', '.amf', '.gcode', '.bgcode'];
const STEP_EXTS = ['.step', '.stp'];
// Sert uniquement à formuler un message utile, pas à filtrer.
const KNOWN_NATIVE = ['.f3d', '.fcstd', '.sldprt', '.ipt', '.prt', '.scad', '.blend', '.catpart', '.par', '.skp', '.3dm'];

// Le dépôt passe par un multipart que `formData()` met en mémoire, dans un Worker
// qui dispose de 128 Mo. 25 Mo par fichier laisse la marge nécessaire et couvre
// très largement une pièce détachée. Au-delà, il faudrait streamer vers R2 en deux
// requêtes séparées — inutile tant que les fichiers réels restent sous cette barre.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Version des CGV que l'acte de cession horodaté vise. À faire évoluer AVEC les CGV :
// c'est ce couple (date, version) qui rend l'acte opposable.
const CESSION_VERSION = 'cgv-modelisateurs-2026-08';

const ALLOWED_ORIGINS = [
  'https://hub4fix.com', 'https://www.hub4fix.com',
  'https://duclosjulien-h4f.github.io',
  'http://localhost:9091', 'http://localhost:9090',
];

// ---------------------------------------------------------------- CORS / JSON
function cors(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}
function json(data, status, origin, extra) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...cors(origin), ...(extra || {}) },
  });
}
function html(body, status) {
  return new Response(body, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---------------------------------------------------------------- base64url + HMAC (repris de l'admin)
function b64urlBytes(buf) { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlStr(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlStrDecode(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); return decodeURIComponent(escape(atob(s))); }
function sha256(str) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); }
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlBytes(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
async function makeToken(secret, obj) { const p = b64urlStr(JSON.stringify(obj)); return p + '.' + (await hmac(secret, p)); }
async function readToken(secret, token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  if (sig !== (await hmac(secret, p))) return null;
  try { const obj = JSON.parse(b64urlStrDecode(p)); if (obj.exp && obj.exp < Math.floor(Date.now() / 1000)) return null; return obj; }
  catch { return null; }
}
function getCookie(request, name) { const c = request.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
function setCookie(name, value, maxAge, domain) { return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/${domain ? '; Domain=' + domain : ''}; Max-Age=${maxAge}`; }
function killCookie(name, domain) { return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/${domain ? '; Domain=' + domain : ''}; Max-Age=0`; }

// La session voyage en cookie 1re partie (custom domain partner.hub4fix.com) OU en
// en-tête Authorization Bearer (repli cross-origin).
function getSessionToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : getCookie(request, SESS_COOKIE);
}

// ---------------------------------------------------------------- OIDC
let _disc = null;
async function discovery(env) {
  if (_disc) return _disc;
  const r = await fetch(env.ISSUER.replace(/\/$/, '') + '/.well-known/openid-configuration');
  _disc = await r.json();
  return _disc;
}
async function pkce() {
  const verifier = b64urlBytes(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64urlBytes(await sha256(verifier));
  return { verifier, challenge };
}

// ---------------------------------------------------------------- session partenaire
// La session porte l'identité Zitadel + l'id du compte D1 lié (posé au callback via
// le pont). Le STATUT partenaire (active/…) est relu EN BASE à chaque requête
// sensible (révocation immédiate) — voir requireAuth / requireActivePartner.
async function currentSession(request, env) {
  return readToken(env.SESSION_SECRET, getSessionToken(request));
}

// ---------------------------------------------------------------- handlers auth
async function handleLogin(request, env, origin, redirectUri) {
  const d = await discovery(env);
  const { verifier, challenge } = await pkce();
  const state = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
  const nonce = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
  const returnTo = new URL(request.url).searchParams.get('returnTo') || (origin + '/');
  const tmp = await makeToken(env.SESSION_SECRET, { v: verifier, st: state, n: nonce, rt: returnTo, exp: Math.floor(Date.now() / 1000) + TMP_TTL });
  const a = new URL(d.authorization_endpoint);
  a.searchParams.set('client_id', env.CLIENT_ID);
  a.searchParams.set('redirect_uri', redirectUri);
  a.searchParams.set('response_type', 'code');
  a.searchParams.set('scope', SCOPES);
  a.searchParams.set('state', state);
  a.searchParams.set('nonce', nonce);
  a.searchParams.set('code_challenge', challenge);
  a.searchParams.set('code_challenge_method', 'S256');
  return new Response(null, { status: 302, headers: { Location: a.toString(), 'Set-Cookie': setCookie('h4f_ptmp', tmp, TMP_TTL) } });
}

async function handleCallback(request, env, origin, redirectUri) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const tmp = await readToken(env.SESSION_SECRET, getCookie(request, 'h4f_ptmp'));
  if (!code || !tmp || tmp.st !== state) return html('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Connexion expirée. <a href="/auth/login">Réessayer</a></p>', 400);

  const d = await discovery(env);
  const tr = await fetch(d.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env.CLIENT_ID, code_verifier: tmp.v }),
  });
  if (!tr.ok) return html('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Échec de connexion. <a href="/auth/login">Réessayer</a></p>', 502);
  const tok = await tr.json();
  const ui = await fetch(d.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tok.access_token } });
  const info = await ui.json();
  const email = (info.email || '').toLowerCase().trim();
  if (!email) return html('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Email absent du profil. <a href="/auth/logout">Se déconnecter</a></p>', 403);

  // LE PONT : relie ou crée le compte D1 (capacités B2C conservées).
  const prenom = ((info.given_name || info.name || email.split('@')[0]) + '').trim();
  const d1 = await findOrCreateD1User(env.DB_SITE, { sub: info.sub, email, prenom }, crypto.randomUUID());

  const domain = env.COOKIE_DOMAIN || '';
  const sess = await makeToken(env.SESSION_SECRET, { sub: info.sub, email, uid: d1.id, name: prenom, exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
  const h = new Headers();
  h.append('Set-Cookie', killCookie('h4f_ptmp', ''));
  h.append('Set-Cookie', setCookie(SESS_COOKIE, sess, SESSION_TTL, domain));
  h.append('Location', tmp.rt || (origin + '/'));
  return new Response(null, { status: 302, headers: h });
}

function handleLogout(env, origin) {
  const domain = env.COOKIE_DOMAIN || '';
  const h = new Headers();
  h.append('Set-Cookie', killCookie(SESS_COOKIE, domain));
  h.append('Location', origin + '/');
  return new Response(null, { status: 302, headers: h });
}

// Emails admins (var ADMIN_EMAILS, liste séparée par des virgules). Sert UNIQUEMENT à
// débloquer l'outil « commande de test » (seed) dans l'espace printer — aucune action
// destructive. Vide = personne (le seed est alors refusé).
function isAdmin(env, email) {
  const list = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return list.indexOf(String(email || '').toLowerCase().trim()) >= 0;
}

// GET /auth/me — identité + statuts partenaire (+ lien vers les capacités B2C : le
// compte D1 est le même, le front peut interroger h4f-api pour tokens/bibliothèque).
async function handleMe(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ authenticated: false }, 200, origin);
  const statuses = await partnerStatuses(env.DB, sess.uid).catch(() => ({}));
  return json({ authenticated: true, email: sess.email, prenom: sess.name, uid: sess.uid, partner: statuses, is_admin: isAdmin(env, sess.email) }, 200, origin);
}

// POST /partner/apply {type, motivation, portfolio} — candidature (auth requise ;
// être partenaire actif n'est PAS requis pour candidater).
async function handleApply(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ error: 'non_authentifie' }, 401, origin);
  const body = await request.json().catch(() => ({}));
  const type = body.type === 'printer' ? 'printer' : 'modelisateur';
  const motivation = String(body.motivation || '').trim();
  const portfolio = String(body.portfolio || '').trim().slice(0, 500);
  if (motivation.length < 20) return json({ error: 'motivation_trop_courte' }, 400, origin);
  const r = await applyForPartner(env.DB, sess.uid, sess.email, type, motivation.slice(0, 2000), portfolio);
  if (!r.ok) return json({ error: 'deja_' + r.reason }, 409, origin);
  return json({ ok: true, status: 'pending', type }, 201, origin);
}

// POST /printer/apply {motivation, techs, materials, postal_code, ville} — candidature
// printer EN UN ACTE : dépose la candidature (type 'printer') + enregistre le profil parc.
async function handlePrinterApply(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ error: 'non_authentifie' }, 401, origin);
  const body = await request.json().catch(() => ({}));
  const motivation = String(body.motivation || '').trim();
  if (motivation.length < 20) return json({ error: 'motivation_trop_courte' }, 400, origin);

  const r = await applyForPartner(env.DB, sess.uid, sess.email, 'printer', motivation.slice(0, 2000), '');
  if (!r.ok) return json({ error: 'deja_' + r.reason }, 409, origin);
  const profile = await savePrinterProfile(env.DB, sess.uid, body);
  return json({ ok: true, status: 'pending', type: 'printer', profile }, 201, origin);
}

// GET /printer/profile — le parc du printer connecté (pour pré-remplir le formulaire).
async function handleGetPrinterProfile(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ error: 'non_authentifie' }, 401, origin);
  return json({ profile: await getPrinterProfile(env.DB, sess.uid) }, 200, origin);
}

// POST /printer/profile — maj du parc (printer déjà inscrit).
async function handleSavePrinterProfile(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ error: 'non_authentifie' }, 401, origin);
  const body = await request.json().catch(() => ({}));
  const profile = await savePrinterProfile(env.DB, sess.uid, body);
  return json({ ok: true, profile }, 200, origin);
}

// ---------------------------------------------------------------- P2 : commandes réservables
// GET /printer/commandes — commandes d'impression de sa zone + parc compatible + les
// siennes. `now` = heure SERVEUR (ancre le compte à rebours, honnêteté L121). Réservé
// aux printers ACTIFS.
async function handlePrinterJobs(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'printer');
  if (resp) return resp;
  const profile = await getPrinterProfile(env.DB, user.id).catch(() => null);
  const jobs = await listPrinterJobs(env.DB, user.id, profile);
  return json({
    jobs, now: new Date().toISOString(),
    reference_machine: REFERENCE_MACHINE,
    // L'écran doit pouvoir EXPLIQUER la base de calcul, pas seulement l'afficher : le
    // plateau de référence est étendu, un printer qui découvre un montant sur une pièce
    // de 400 mm doit comprendre d'où il sort.
    reference_label: REFERENCE_LABEL,
    reference_bed_mm: REFERENCE_BED_MM,
    // Le profil est le vrai déterminant du temps facturé : tant qu'il n'est pas épinglé, on
    // l'annonce comme tel plutôt que de laisser croire à une base stable.
    reference_profile: REFERENCE_PROFILE,
    reference_profile_pinned: referenceProfilePinned(),
  }, 200, origin);
}

// POST /printer/reservation {job_id} — réservation EXCLUSIVE (409 si prise/expirée).
async function handleReservePrintJob(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'printer');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  if (!jobId) return json({ error: 'job_id_manquant' }, 400, origin);
  const r = await reservePrintJob(env.DB, jobId, user.id);
  if (r.ok) return json({ ok: true, reserved_at: r.reserved_at }, 200, origin);
  const code = r.reason === 'introuvable' ? 404 : 409;
  return json({ error: r.reason }, code, origin);
}

// POST /printer/reservation/release {job_id} — le printer rend SA réservation (repart
// 'open'). Refuse un job 'committed' (GCODE téléchargé, P4) : anti-abus.
async function handleReleasePrintJob(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'printer');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  if (!jobId) return json({ error: 'job_id_manquant' }, 400, origin);
  const r = await releasePrintJob(env.DB, jobId, user.id);
  if (r.ok) return json({ ok: true }, 200, origin);
  const code = r.reason === 'introuvable' ? 404 : 409;
  return json({ error: r.reason }, code, origin);
}

// POST /printer/job/step {job_id, step} — suivi de production : le printer valide une
// étape (start|success|ship). Séquentiel, serveur-vérifié. ship -> commande 'done'.
async function handleAdvanceJob(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'printer');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const jobId = String(body.job_id || '').trim();
  const step = String(body.step || '').trim();
  if (!jobId) return json({ error: 'job_id_manquant' }, 400, origin);
  const r = await advancePrintJob(env.DB, jobId, user.id, step);
  if (r.ok) return json({ ok: true, step: r.step, at: r.at }, 200, origin);
  const code = r.reason === 'introuvable' ? 404 : (r.reason === 'etape_inconnue' ? 400 : 409);
  return json({ error: r.reason }, code, origin);
}

// POST /printer/seed-test — OUTIL DE TEST (admin only) : crée une commande d'impression
// fictive, calée sur la zone et le parc du demandeur pour qu'elle lui soit visible. En
// attendant le tunnel d'achat physique B2C (qui créera les vrais `orders`). Le montant
// est calculé par la grille (tarifs.js) depuis une vraie pièce du feed si possible.
async function handleSeedTestJob(request, env, origin) {
  const sess = await currentSession(request, env);
  if (!sess) return json({ error: 'non_authentifie' }, 401, origin);
  if (!isAdmin(env, sess.email)) return json({ error: 'reserve_admin' }, 403, origin);
  const profile = await getPrinterProfile(env.DB, sess.uid).catch(() => null);

  // Une pièce réaliste depuis le feed (sinon valeurs par défaut).
  let product = null;
  try {
    const res = await fetchFeed(env);
    if (res.ok) { const d = await res.json(); const arr = Array.isArray(d.products) ? d.products : []; product = arr.find((p) => p.printTime || p.weight) || arr[0] || null; }
  } catch (e) { /* feed indisponible -> défauts */ }

  const techs = String((profile && profile.techs) || '').split(',').filter(Boolean);
  const mats = String((profile && profile.materials) || '').split(',').filter(Boolean);
  const material = (product && product.material) || mats[0] || 'PLA';
  const tech = techs[0] || 'FDM';
  const printTime = (product && product.printTime) || '2h30';
  const weight = (product && product.weight) || '18 g';
  const montant_cents = computeMontantCents({ printTime, weight, material });

  const job = await createPrintJob(env.DB, {
    order_id: null, is_test: 1,
    product_id: (product && product.id) || 'test',
    product_name: (product && product.name) || 'Commande de test',
    material, tech, print_time: printTime, weight, montant_cents,
    postal_code: (profile && profile.postal_code) || '', ville: (profile && profile.ville) || '',
  });
  return json({ ok: true, job_id: job.id, offer_expires_at: job.offer_expires_at, montant_cents }, 201, origin);
}

// ---------------------------------------------------------------- endpoints métier (Hot List + réservation)
// Portés depuis h4f-api : même logique, mais l'auth est le STATUT partenaire ACTIF
// (relu en base -> révocation immédiate), et les réservations vivent dans h4f_partner.

async function requireActivePartner(request, env, origin, type) {
  const sess = await currentSession(request, env);
  if (!sess) return { resp: json({ error: 'non_authentifie' }, 401, origin) };
  const active = await isActivePartner(env.DB, sess.uid, type).catch(() => false);
  if (!active) return { resp: json({ error: 'reserve_' + type }, 403, origin) };
  return { user: { id: sess.uid, email: sess.email } };
}

// Pièces dont un fichier est DÉJÀ dans le circuit, quel que soit le canal : déposé par
// un modélisateur, ou déposé en interne depuis /admin/depot. Elles doivent disparaître
// des pièces à prendre, sinon quelqu'un réserve une pièce déjà traitée et brûle ses
// 72 h pour rien — le cas se produit dès qu'un dépôt interne précède la réservation.
async function pieceIdsWithLiveSubmission(env) {
  const r = await env.DB.prepare(
    "SELECT DISTINCT piece_id FROM submissions WHERE status IN ('review','accepted','prepared','published')"
  ).all();
  const s = new Set();
  for (const row of (r && r.results) || []) s.add(row.piece_id);
  return s;
}

// Réservations BLOQUANTES (non expirées) : piece_id -> { user_id, status }.
async function activeReservationMap(env) {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    'SELECT piece_id, user_id, status FROM reservations WHERE status IN ' + HOLDING + ' AND expires_at > ?'
  ).bind(now).all();
  const m = {};
  for (const row of (r && r.results) || []) if (!m[row.piece_id]) m[row.piece_id] = row;
  return m;
}

// Hot List : pièces EN ATTENTE de modélisation (feed, non modélisées), classées par
// demande. boost = mois depuis l'ajout (avance royalties). Annote reserved / reserved_by_me.
// Récupère le feed des pièces. Priorité au SERVICE BINDING (env.ADMIN) — fiable
// entre workers du même compte ; repli sur le fetch public (dev/local).
function fetchFeed(env) {
  return env.ADMIN
    ? env.ADMIN.fetch('https://admin/api/pieces.json')
    : fetch(FEED_URL, { cf: { cacheTtl: 120 } });
}

async function loadHotlistPieces(env, uid) {
  let products = [];
  try {
    const res = await fetchFeed(env);
    if (res.ok) { const d = await res.json(); products = Array.isArray(d.products) ? d.products : []; }
  } catch (e) { return []; }
  const resv = await activeReservationMap(env).catch(() => ({}));
  const deposees = await pieceIdsWithLiveSubmission(env).catch(() => new Set());
  const now = Date.now();
  return products
    .filter((p) => !p.modeled)
    .map((p) => {
      const t = p.addedDate ? Date.parse(p.addedDate) : NaN;
      const boost = isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / (30 * 24 * 3600 * 1000)));
      const holder = resv[p.id];
      const mine = !!holder && holder.user_id === uid;
      const deposee = deposees.has(p.id);
      return {
        id: p.id, nom: p.name, appareil: p.machine, marque: p.brand,
        demande: Number(p.demand) || 0, alertes: Number(p.alerts) || 0,
        boost, addedDate: p.addedDate || '', image: p.image || ('/img/h4f/' + p.id),
        reserved: !!holder || deposee, reserved_by_me: mine,
        // Un fichier déjà déposé n'est pas la même chose qu'une pièce réservée : dans le
        // premier cas il n'y a plus rien à faire, dans le second il reste à attendre.
        deja_deposee: deposee && !mine,
        // L'étape n'est révélée qu'au titulaire : les autres voient « réservée »,
        // sans savoir où en est le dossier.
        etape: mine ? holder.status : null,
      };
    })
    .sort((a, b) => (a.reserved - b.reserved) || (b.demande - a.demande) || (b.boost - a.boost));
}

async function handleModelerHotlist(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  return json({ pieces: await loadHotlistPieces(env, user.id) }, 200, origin);
}

// POST /modelisateur/reservation {piece_id} — option EXCLUSIVE (409 si déjà prise).
// La réservation naît en 'pending-review' : la pièce est tenue, mais AUCUN délai de
// travail ne court encore. Elle ne tient que 2 h sans photos, pour qu'un clic
// d'exploration ne gèle pas une pièce.
async function handleReserve(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    'SELECT id, user_id, status FROM reservations WHERE piece_id = ? AND status IN ' + HOLDING + ' AND expires_at > ? LIMIT 1'
  ).bind(pieceId, now).first();
  if (existing) {
    const mine = existing.user_id === user.id;
    return json({ error: mine ? 'deja_reservee_par_vous' : 'deja_reservee', reservation_id: existing.id }, 409, origin);
  }
  const expires = new Date(Date.now() + PHOTO_HOLD_MS).toISOString();
  const ins = await env.DB.prepare(
    "INSERT INTO reservations (piece_id, user_id, status, ai_check, created_at, expires_at) VALUES (?, ?, 'pending-review', 'pending', ?, ?)"
  ).bind(pieceId, user.id, now, expires).run();
  return json({
    ok: true, reservation_id: ins && ins.meta ? ins.meta.last_row_id : null,
    status: 'pending-review', expires_at: expires, now,
  }, 201, origin);
}

// POST /modelisateur/reservation/extend {piece_id} — prolongation de 72 h, UNE FOIS.
//
// Demandable à tout moment pendant la fenêtre de travail (arbitrage Julien du
// 09/08/2026) : pas de créneau à surveiller, donc aucune notification à câbler et
// aucun piège pour le modélisateur qui dort au mauvais moment. La contrepartie
// assumée : il peut prolonger à H+1 sans avoir rien tenté. C'est l'unicité qui
// tient la règle, pas le moment de la demande.
//
// Le +72 h part de L'ÉCHÉANCE en cours, pas de maintenant : prolonger tôt ne coûte
// rien et ne rapporte rien, ce qui retire tout intérêt à jouer avec le calendrier.
async function handleExtend(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);

  const now = new Date();
  const nowIso = now.toISOString();
  const row = await env.DB.prepare(
    "SELECT id, expires_at, extended_at FROM reservations WHERE piece_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
  ).bind(pieceId, user.id).first();
  if (!row) return json({ error: 'aucune_reservation' }, 404, origin);
  if (row.extended_at) {
    return json({
      error: 'prolongation_deja_utilisee',
      message: 'Votre réservation a déjà été prolongée une fois : la prolongation n\'est pas renouvelable.',
      extended_at: row.extended_at, expires_at: row.expires_at,
    }, 409, origin);
  }
  // Échéance dépassée : la pièce est déjà retournée au pot commun (expiration
  // paresseuse). Prolonger reviendrait à la reprendre à celui qui l'a peut-être
  // saisie entre-temps.
  const current = Date.parse(row.expires_at || '');
  if (!isNaN(current) && current <= now.getTime()) {
    return json({ error: 'delai_depasse', message: 'Le délai est écoulé : la pièce est de nouveau ouverte à tous.' }, 409, origin);
  }

  const base = isNaN(current) ? now.getTime() : current;
  const expires = new Date(base + EXTENSION_MS).toISOString();
  // Garde en base : l'UPDATE ne passe que si la prolongation n'a pas été posée
  // entre la lecture et l'écriture (double clic, deux onglets).
  const upd = await env.DB.prepare(
    "UPDATE reservations SET expires_at = ?, extended_at = ?, renewed_at = ? WHERE id = ? AND extended_at IS NULL AND status = 'active'"
  ).bind(expires, nowIso, nowIso, row.id).run();
  if (!upd.meta || upd.meta.changes !== 1) {
    return json({ error: 'prolongation_deja_utilisee' }, 409, origin);
  }
  return json({ ok: true, expires_at: expires, extended_at: nowIso, now: nowIso }, 200, origin);
}

function decodeImageDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch (e) { return null; }
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  return { bytes, contentType: m[1] };
}

// POST /modelisateur/reservation/photos {piece_id, plate, object, part?} — R2 + IA.
//
// TROIS photos : la plaque signalétique, l'appareil donneur, et la pièce seule quand
// le modélisateur l'a en main. La troisième est FACULTATIVE — une pièce cassée peut
// être inaccessible sans démonter l'appareil, exiger la photo bloquerait des
// réservations légitimes.
//
// L'envoi des photos fait passer l'échéance de 2 h (garde anti-clic) à 7 j : c'est
// maintenant NOTRE tour, le modélisateur ne doit pas voir son option fondre pendant
// qu'il attend le feu vert.
async function handleReservePhotos(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  if (!env.RESERV_R2) return json({ error: 'stockage_indisponible' }, 503, origin);
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);
  const row = await env.DB.prepare(
    "SELECT id, status FROM reservations WHERE piece_id = ? AND user_id = ? " +
    "AND status IN ('pending-review','active','suspended') LIMIT 1"
  ).bind(pieceId, user.id).first();
  if (!row) return json({ error: 'aucune_reservation' }, 404, origin);
  const plate = decodeImageDataUrl(body.plate);
  const object = decodeImageDataUrl(body.object);
  const part = body.part ? decodeImageDataUrl(body.part) : null;
  if (!plate || !object) return json({ error: 'photos_invalides' }, 400, origin);
  // Une 3e photo fournie mais illisible est une erreur, pas une absence : la traiter
  // en silence ferait croire au modélisateur qu'elle est arrivée.
  if (body.part && !part) return json({ error: 'photo_piece_invalide' }, 400, origin);

  const plateKey = 'reservations/' + row.id + '/plate';
  const objectKey = 'reservations/' + row.id + '/object';
  const partKey = part ? 'reservations/' + row.id + '/part' : null;
  await env.RESERV_R2.put(plateKey, plate.bytes, { httpMetadata: { contentType: plate.contentType } });
  await env.RESERV_R2.put(objectKey, object.bytes, { httpMetadata: { contentType: object.contentType } });
  if (part) await env.RESERV_R2.put(partKey, part.bytes, { httpMetadata: { contentType: part.contentType } });

  // L'échéance n'est repoussée que si le compteur de travail n'a PAS démarré :
  // renvoyer des photos sur une réservation déjà validée ne doit pas s'offrir 7 j
  // de rab au-delà des 72 h.
  const pending = row.status === 'pending-review';
  const expires = pending ? new Date(Date.now() + REVIEW_HOLD_MS).toISOString() : null;
  await env.DB.prepare(
    "UPDATE reservations SET plate_key = ?, object_key = ?, part_key = COALESCE(?, part_key), " +
    "ai_check = 'pending', expires_at = COALESCE(?, expires_at) WHERE id = ?"
  ).bind(plateKey, objectKey, partKey, expires, row.id).run();

  const check = await checkPhotosCoherence(env, body.plate, body.object);
  if (check) {
    await env.DB.prepare('UPDATE reservations SET ai_check = ? WHERE id = ?')
      .bind(check.verdict + (check.raison ? ' | ' + check.raison : ''), row.id).run();
  }
  return json({
    ok: true, ai_check: check ? check.verdict : 'pending',
    status: row.status, expires_at: expires, now: new Date().toISOString(),
  }, 200, origin);
}

// Gemma vision juge la cohérence des deux photos. null = IA absente/échec -> pending.
async function checkPhotosCoherence(env, plateUrl, objectUrl) {
  if (!env.AI) return null;
  try {
    const res = await env.AI.run(AI_MODEL, {
      messages: [
        { role: 'system', content: "Tu contrôles deux photos envoyées par un modélisateur pour réserver une pièce à imprimer. La 1re DOIT être une PLAQUE SIGNALÉTIQUE (étiquette avec références/modèle d'un appareil), la 2e l'APPAREIL ou la pièce. Réponds STRICTEMENT par un JSON compact {\"verdict\":\"ok\"|\"suspect\",\"raison\":\"...\"} et rien d'autre." },
        { role: 'user', content: [
          { type: 'text', text: 'Photo 1 = plaque signalétique. Photo 2 = objet.' },
          { type: 'image_url', image_url: { url: plateUrl } },
          { type: 'image_url', image_url: { url: objectUrl } },
        ] },
      ],
      max_completion_tokens: 150, temperature: 0.2,
    });
    const msg = res && res.choices && res.choices[0] && res.choices[0].message;
    const txt = (msg && typeof msg.content === 'string' && msg.content) || (typeof res.response === 'string' ? res.response : '');
    const m = /\{[\s\S]*\}/.exec(txt);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const verdict = parsed.verdict === 'suspect' ? 'suspect' : (parsed.verdict === 'ok' ? 'ok' : null);
    if (!verdict) return null;
    return { verdict, raison: String(parsed.raison || '').slice(0, 300) };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- soumission du fichier
function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}
async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Contrôle d'un fichier reçu. Renvoie null si tout va bien, sinon la réponse d'erreur
// déjà formulée pour le modélisateur — les messages disent quoi faire, pas seulement
// ce qui est refusé.
function checkDeposit(file, slot) {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.name) {
    return slot === 'native'
      ? { error: 'source_manquante', message: 'Le fichier source de votre logiciel est obligatoire.' }
      : { error: 'step_manquant', message: 'Le fichier STEP est obligatoire : c\'est lui que nous convertissons.' };
  }
  const ext = extOf(file.name);
  if (file.size > MAX_FILE_BYTES) {
    return { error: 'fichier_trop_lourd', message: 'Fichier trop lourd (' + Math.round(file.size / 1048576) + ' Mo) — maximum ' + Math.round(MAX_FILE_BYTES / 1048576) + ' Mo par fichier.' };
  }
  if (!file.size) return { error: 'fichier_vide', message: 'Le fichier ' + file.name + ' est vide.' };
  if (slot === 'step') {
    if (!STEP_EXTS.includes(ext)) {
      return { error: 'step_invalide', message: 'Le second fichier doit être un STEP (' + STEP_EXTS.join(' ou ') + '), exporté depuis votre logiciel.' };
    }
    return null;
  }
  if (MESH_EXTS.includes(ext)) {
    return {
      error: 'maillage_refuse',
      message: 'Un maillage (' + ext + ') n\'est pas un fichier source. Déposez le fichier de votre logiciel de conception (' +
        KNOWN_NATIVE.slice(0, 4).join(', ') + '…) et son export STEP.',
    };
  }
  if (!ext) return { error: 'extension_absente', message: 'Le fichier source doit porter son extension d\'origine.' };
  return null;
}

// POST /modelisateur/submission — multipart : piece_id, cession, native, step.
//
// Un SEUL acte : les deux fichiers et la cession arrivent ensemble. Découper en
// plusieurs requêtes créerait des états intermédiaires (un fichier sans l'autre, une
// cession sans fichier) dont aucun n'a de sens juridique.
//
// L'acte de cession est HORODATÉ ET LIÉ À CE FICHIER par son empreinte SHA-256 : une
// case cochée à l'inscription ne vaudrait rien (cession globale d'œuvres futures =
// nulle, art. L.131-1 CPI). Deux versions successives portent deux actes distincts,
// et l'empreinte dit laquelle a été cédée.
async function handleSubmission(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  if (!env.SUBMIT_R2) return json({ error: 'stockage_indisponible', message: 'Le stockage des fichiers n\'est pas configuré.' }, 503, origin);

  let form;
  try { form = await request.formData(); } catch (e) { return json({ error: 'formulaire_invalide' }, 400, origin); }
  const pieceId = String(form.get('piece_id') || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const resv = await env.DB.prepare(
    'SELECT id, status, expires_at, validated_at FROM reservations WHERE piece_id = ? AND user_id = ? ' +
    'AND status IN ' + HOLDING + ' ORDER BY id DESC LIMIT 1'
  ).bind(pieceId, user.id).first();
  if (!resv) return json({ error: 'aucune_reservation', message: 'Vous n\'avez pas de réservation sur cette pièce.' }, 404, origin);
  if (resv.status === 'pending-review') {
    return json({ error: 'pas_encore_validee', message: 'Votre réservation attend notre feu vert : le délai de dépôt n\'a pas encore démarré.' }, 409, origin);
  }
  if (resv.status === 'suspended') {
    return json({ error: 'reservation_suspendue', message: 'Votre réservation est suspendue : un administrateur vérifie vos photos.' }, 409, origin);
  }
  const deadline = Date.parse(resv.expires_at || '');
  if (resv.status === 'active' && !isNaN(deadline) && deadline <= nowMs) {
    return json({ error: 'delai_depasse', message: 'Le délai de dépôt est écoulé : la pièce est de nouveau ouverte à tous.' }, 409, origin);
  }

  // Le consentement est exigé À CET INSTANT, pas déduit d'un état antérieur. 428 =
  // « la requête est valide mais il manque la condition préalable », même code que le
  // consentement au slice : un front qui l'oublie le voit tout de suite.
  const cession = String(form.get('cession') || '').toLowerCase();
  if (cession !== 'true' && cession !== 'on' && cession !== '1') {
    return json({
      error: 'cession_requise',
      message: 'Le dépôt vaut cession de vos droits sur ce fichier à Hub4Fix (CGV modélisateurs art. 2). Cochez l\'acte de cession pour déposer.',
      version: CESSION_VERSION,
    }, 428, origin);
  }

  const native = form.get('native');
  const step = form.get('step');
  const badNative = checkDeposit(native, 'native');
  if (badNative) return json(badNative, 400, origin);
  const badStep = checkDeposit(step, 'step');
  if (badStep) return json(badStep, 400, origin);

  // Version : 1 au premier dépôt, +1 après un refus (correction demandée). Comptée
  // PAR PIÈCE et non par réservation — le canal interne (/admin/depot) alimente la même
  // table sans réservation, et le numéro décrit l'histoire de la pièce.
  const last = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM submissions WHERE piece_id = ?')
    .bind(pieceId).first();
  const version = ((last && last.v) || 0) + 1;

  const id = crypto.randomUUID();
  const nativeExt = extOf(native.name);
  // « natif » et non « source » : depuis l'arbitrage de vocabulaire du 09/08, « source »
  // désigne le 3MF SOURCE (géométrie tessellée, sans réglages de slicing) que la
  // conversion produira sous `submissions/<id>/source.3mf`. Deux choses différentes ne
  // peuvent pas porter le même nom dans le même dossier.
  const nativeKey = 'submissions/' + id + '/natif' + nativeExt;
  const stepKey = 'submissions/' + id + '/model' + extOf(step.name);
  const nativeBuf = await native.arrayBuffer();
  const stepBuf = await step.arrayBuffer();

  await env.SUBMIT_R2.put(nativeKey, nativeBuf, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { filename: native.name, piece: pieceId },
  });
  await env.SUBMIT_R2.put(stepKey, stepBuf, {
    httpMetadata: { contentType: 'application/step' },
    customMetadata: { filename: step.name, piece: pieceId },
  });

  try {
    await env.DB.prepare(
      'INSERT INTO submissions (id, reservation_id, piece_id, user_id, version, ' +
      'native_key, native_name, native_ext, native_sha256, native_bytes, ' +
      'step_key, step_name, step_sha256, step_bytes, ' +
      "status, cession_at, cession_version, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?)"
    ).bind(
      id, resv.id, pieceId, user.id, version,
      nativeKey, native.name.slice(0, 200), nativeExt, await sha256Hex(nativeBuf), nativeBuf.byteLength,
      stepKey, step.name.slice(0, 200), await sha256Hex(stepBuf), stepBuf.byteLength,
      now, CESSION_VERSION, now
    ).run();
  } catch (e) {
    // L'index unique (piece_id, version) a parlé : un second envoi simultané. On efface
    // ce qu'on venait d'écrire et on rend le dossier déjà ouvert — le modélisateur voit
    // un succès, pas une erreur qu'il ne peut pas comprendre.
    await env.SUBMIT_R2.delete(nativeKey).catch(() => {});
    await env.SUBMIT_R2.delete(stepKey).catch(() => {});
    const existing = await env.DB.prepare(
      'SELECT id, version, created_at FROM submissions WHERE piece_id = ? AND version = ?'
    ).bind(pieceId, version).first();
    if (existing) return json({ ok: true, submission_id: existing.id, version: existing.version, duplicate: true }, 200, origin);
    return json({ error: 'enregistrement_impossible', detail: String(e && e.message || e) }, 500, origin);
  }

  // La pièce reste tenue pendant l'examen, jusqu'au délai contractuel de 60 jours
  // (CGV art. 2.5 : au-delà, la cession est résolue de plein droit).
  await env.DB.prepare("UPDATE reservations SET status = 'submitted', expires_at = ? WHERE id = ?")
    .bind(new Date(nowMs + FILE_REVIEW_MS).toISOString(), resv.id).run();

  return json({
    ok: true, submission_id: id, version, status: 'review',
    cession_at: now, cession_version: CESSION_VERSION, now,
  }, 201, origin);
}

// GET /modelisateur/reservations — mes réservations, avec l'heure SERVEUR pour ancrer
// le compte à rebours côté écran (une horloge de poste mal réglée ne doit pas décider
// d'un délai contractuel), et l'état du dossier déposé s'il existe.
async function handleMyReservations(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const r = await env.DB.prepare(
    'SELECT id, piece_id, status, ai_check, part_key, created_at, expires_at, validated_at, extended_at ' +
    'FROM reservations WHERE user_id = ? AND status IN ' + HOLDING + ' ORDER BY id DESC LIMIT 50'
  ).bind(user.id).all();
  const rows = (r && r.results) || [];

  // Le nom lisible vient du feed : une réservation dont la pièce a quitté la Hot List
  // (parce qu'elle est justement passée en « modélisée ») garderait sinon son seul id.
  const names = {};
  try {
    const res = await fetchFeed(env);
    if (res.ok) {
      const d = await res.json();
      for (const p of (Array.isArray(d.products) ? d.products : [])) names[p.id] = p.name;
    }
  } catch (e) { /* feed indisponible : on rend les id, l'écran reste utilisable */ }

  const subs = {};
  if (rows.length) {
    const ids = rows.map((x) => x.id);
    const q = await env.DB.prepare(
      'SELECT id, reservation_id, version, status, review_note, created_at, decided_at ' +
      'FROM submissions WHERE reservation_id IN (' + ids.map(() => '?').join(',') + ') ORDER BY version ASC'
    ).bind(...ids).all();
    for (const s of (q && q.results) || []) subs[s.reservation_id] = s;   // la plus récente gagne
  }

  const reservations = rows.map((x) => {
    const exp = Date.parse(x.expires_at || '');
    const expired = !isNaN(exp) && exp <= nowMs;
    return {
      id: x.id, piece_id: x.piece_id, nom: names[x.piece_id] || x.piece_id,
      status: x.status, expires_at: x.expires_at, validated_at: x.validated_at,
      extended_at: x.extended_at, created_at: x.created_at,
      expired,
      // Le bouton ne s'affiche que s'il servirait : fenêtre en cours, prolongation
      // encore disponible.
      can_extend: x.status === 'active' && !x.extended_at && !expired,
      can_submit: x.status === 'active' && !expired,
      has_part_photo: !!x.part_key,
      ai_verdict: String(x.ai_check || 'pending').split(' | ')[0],
      submission: subs[x.id] || null,
    };
  });

  return json({
    now, reservations,
    depot: {
      max_mo: Math.round(MAX_FILE_BYTES / 1048576),
      step_exts: STEP_EXTS, mesh_refuses: MESH_EXTS, natifs_connus: KNOWN_NATIVE,
      cession_version: CESSION_VERSION,
    },
  }, 200, origin);
}

// Exports nommés pour les tests unitaires (le runtime n'utilise que `default`).
export { checkDeposit, extOf, handleExtend, handleSubmission,
  PHOTO_HOLD_MS, REVIEW_HOLD_MS, WORK_WINDOW_MS, EXTENSION_MS, FILE_REVIEW_MS,
  MESH_EXTS, STEP_EXTS, MAX_FILE_BYTES, CESSION_VERSION };

// ---------------------------------------------------------------- routeur
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || url.origin;
    const redirectUri = url.origin + '/auth/callback';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    try {
      const p = url.pathname;
      // L'espace partenaire (SPA) est servi PAR le worker -> cookie même origine.
      if (request.method === 'GET' && (p === '/' || p === '/reserver')) return html(APP_HTML);
      // Sélecteur d'imprimante partagé (SOURCE UNIQUE = hub4fix.com/js/printer-selector.js,
      // servi par Pages). Le worker le RELAIE en même origine pour la SPA (cache 24 h),
      // pour éviter une dépendance cross-origin côté client. produit.html le charge, lui,
      // directement depuis Pages. Un seul fichier édité, deux consommateurs.
      if (request.method === 'GET' && p === '/js/printer-selector.js') {
        const upstream = await fetch('https://hub4fix.com/js/printer-selector.js', { cf: { cacheTtl: 86400, cacheEverything: true } });
        const body = await upstream.text();
        return new Response(body, { status: upstream.status, headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
      }
      if (p === '/auth/login') return await handleLogin(request, env, url.origin, redirectUri);
      if (p === '/auth/callback') return await handleCallback(request, env, url.origin, redirectUri);
      if (p === '/auth/logout') return handleLogout(env, url.origin);
      if (request.method === 'GET' && p === '/auth/me') return await handleMe(request, env, origin);
      if (request.method === 'POST' && p === '/partner/apply') return await handleApply(request, env, origin);
      if (request.method === 'POST' && p === '/printer/apply') return await handlePrinterApply(request, env, origin);
      if (request.method === 'GET' && p === '/printer/profile') return await handleGetPrinterProfile(request, env, origin);
      if (request.method === 'POST' && p === '/printer/profile') return await handleSavePrinterProfile(request, env, origin);
      if (request.method === 'GET' && p === '/printer/commandes') return await handlePrinterJobs(request, env, origin);
      if (request.method === 'POST' && p === '/printer/reservation') return await handleReservePrintJob(request, env, origin);
      if (request.method === 'POST' && p === '/printer/reservation/release') return await handleReleasePrintJob(request, env, origin);
      if (request.method === 'POST' && p === '/printer/job/step') return await handleAdvanceJob(request, env, origin);
      if (request.method === 'POST' && p === '/printer/seed-test') return await handleSeedTestJob(request, env, origin);
      if (request.method === 'GET' && p === '/modelisateur/hotlist') return await handleModelerHotlist(request, env, origin);
      if (request.method === 'GET' && p === '/modelisateur/reservations') return await handleMyReservations(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/reservation') return await handleReserve(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/reservation/extend') return await handleExtend(request, env, origin);
      // Ancien nom du renouvellement illimité. Conservé le temps que les onglets
      // ouverts se ferment : il tombe maintenant sur la prolongation UNIQUE, donc un
      // vieux front ne peut plus repousser l'échéance indéfiniment.
      if (request.method === 'POST' && p === '/modelisateur/reservation/renew') return await handleExtend(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/reservation/photos') return await handleReservePhotos(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/submission') return await handleSubmission(request, env, origin);
      return json({ error: 'not_found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500, origin);
    }
  },
};
