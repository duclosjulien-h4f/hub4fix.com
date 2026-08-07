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
import { computeMontantCents, REFERENCE_MACHINE } from './tarifs.js';
import { APP_HTML } from './app-page.js';

const SCOPES = 'openid profile email';
const SESSION_TTL = 60 * 60 * 12;   // 12 h
const TMP_TTL = 60 * 10;
const SESS_COOKIE = 'h4f_partner_sess';

// Feed public des pièces (servi par l'admin). Source de la Hot List en attendant
// une vraie métrique de demande (wishlist) — chantier séparé.
const FEED_URL = 'https://h4f-admin.duclosjulien.workers.dev/api/pieces.json';
const AI_MODEL = '@cf/google/gemma-4-26b-a4b-it';   // Gemma vision (validation photos)
const RESERVATION_TTL = 30 * 24 * 3600 * 1000;      // 30 jours, renouvelable
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

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
  return json({ jobs, now: new Date().toISOString(), reference_machine: REFERENCE_MACHINE }, 200, origin);
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

// Réservations BLOQUANTES (active|suspended, non expirées) : piece_id -> user_id.
async function activeReservationMap(env) {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    "SELECT piece_id, user_id FROM reservations WHERE status IN ('active','suspended') AND expires_at > ?"
  ).bind(now).all();
  const m = {};
  for (const row of (r && r.results) || []) if (!m[row.piece_id]) m[row.piece_id] = row.user_id;
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
  const now = Date.now();
  return products
    .filter((p) => !p.modeled)
    .map((p) => {
      const t = p.addedDate ? Date.parse(p.addedDate) : NaN;
      const boost = isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / (30 * 24 * 3600 * 1000)));
      const holder = resv[p.id];
      return {
        id: p.id, nom: p.name, appareil: p.machine, marque: p.brand,
        demande: Number(p.demand) || 0, alertes: Number(p.alerts) || 0,
        boost, addedDate: p.addedDate || '', image: p.image || ('/img/h4f/' + p.id),
        reserved: !!holder, reserved_by_me: !!holder && holder === uid,
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
async function handleReserve(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT id, user_id FROM reservations WHERE piece_id = ? AND status IN ('active','suspended') AND expires_at > ? LIMIT 1"
  ).bind(pieceId, now).first();
  if (existing) {
    const mine = existing.user_id === user.id;
    return json({ error: mine ? 'deja_reservee_par_vous' : 'deja_reservee', reservation_id: existing.id }, 409, origin);
  }
  const expires = new Date(Date.now() + RESERVATION_TTL).toISOString();
  const ins = await env.DB.prepare(
    "INSERT INTO reservations (piece_id, user_id, status, ai_check, created_at, expires_at) VALUES (?, ?, 'active', 'pending', ?, ?)"
  ).bind(pieceId, user.id, now, expires).run();
  return json({ ok: true, reservation_id: ins && ins.meta ? ins.meta.last_row_id : null, expires_at: expires }, 201, origin);
}

// POST /modelisateur/reservation/renew {piece_id} — repousse SA réservation active.
async function handleRenew(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);
  const row = await env.DB.prepare(
    "SELECT id FROM reservations WHERE piece_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
  ).bind(pieceId, user.id).first();
  if (!row) return json({ error: 'aucune_reservation' }, 404, origin);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + RESERVATION_TTL).toISOString();
  await env.DB.prepare('UPDATE reservations SET expires_at = ?, renewed_at = ? WHERE id = ?').bind(expires, now, row.id).run();
  return json({ ok: true, expires_at: expires }, 200, origin);
}

function decodeImageDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch (e) { return null; }
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return null;
  return { bytes, contentType: m[1] };
}

// POST /modelisateur/reservation/photos {piece_id, plate, object} — R2 + validation IA.
async function handleReservePhotos(request, env, origin) {
  const { user, resp } = await requireActivePartner(request, env, origin, 'modelisateur');
  if (resp) return resp;
  if (!env.RESERV_R2) return json({ error: 'stockage_indisponible' }, 503, origin);
  const body = await request.json().catch(() => ({}));
  const pieceId = String(body.piece_id || '').trim();
  if (!pieceId) return json({ error: 'piece_id_manquant' }, 400, origin);
  const row = await env.DB.prepare(
    "SELECT id FROM reservations WHERE piece_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
  ).bind(pieceId, user.id).first();
  if (!row) return json({ error: 'aucune_reservation' }, 404, origin);
  const plate = decodeImageDataUrl(body.plate);
  const object = decodeImageDataUrl(body.object);
  if (!plate || !object) return json({ error: 'photos_invalides' }, 400, origin);

  const plateKey = 'reservations/' + row.id + '/plate';
  const objectKey = 'reservations/' + row.id + '/object';
  await env.RESERV_R2.put(plateKey, plate.bytes, { httpMetadata: { contentType: plate.contentType } });
  await env.RESERV_R2.put(objectKey, object.bytes, { httpMetadata: { contentType: object.contentType } });
  await env.DB.prepare("UPDATE reservations SET plate_key = ?, object_key = ?, ai_check = 'pending' WHERE id = ?")
    .bind(plateKey, objectKey, row.id).run();

  const check = await checkPhotosCoherence(env, body.plate, body.object);
  if (check) {
    await env.DB.prepare('UPDATE reservations SET ai_check = ? WHERE id = ?')
      .bind(check.verdict + (check.raison ? ' | ' + check.raison : ''), row.id).run();
  }
  return json({ ok: true, ai_check: check ? check.verdict : 'pending' }, 200, origin);
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
      if (request.method === 'POST' && p === '/modelisateur/reservation') return await handleReserve(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/reservation/renew') return await handleRenew(request, env, origin);
      if (request.method === 'POST' && p === '/modelisateur/reservation/photos') return await handleReservePhotos(request, env, origin);
      return json({ error: 'not_found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500, origin);
    }
  },
};
