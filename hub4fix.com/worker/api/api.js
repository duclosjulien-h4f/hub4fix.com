/**
 * Hub4Fix — Worker "h4f-api" : authentification B2C maison + bibliothèque + tokens.
 *
 * Source de vérité = D1 (base "h4f_site", schéma worker/site-schema.sql).
 * Aucun mot de passe en clair : hash PBKDF2-SHA256 (WebCrypto natif).
 * Session = cookie signé HMAC-SHA256 (httpOnly), pas de localStorage.
 *
 * Endpoints (JSON) :
 *   POST /auth/signup   {email, password}  -> crée le compte, +5 tokens, pose la session
 *   POST /auth/login    {email, password}  -> vérifie, pose la session
 *   GET  /auth/me                          -> {email, prenom, tokens, library:[...]}
 *   POST /auth/logout                      -> efface la session
 *
 * Bindings (wrangler.toml) :
 *   DB              D1 (base h4f_site)
 *   SESSION_SECRET  secret HMAC (wrangler secret put SESSION_SECRET)
 *   COOKIE_DOMAIN   ex. ".hub4fix.com" (cookie 1re partie ; voir note déploiement)
 *
 * Déploiement : cd hub4fix.com/worker/api && npx wrangler deploy
 */

const ALLOWED_ORIGINS = [
  'https://hub4fix.com',
  'https://www.hub4fix.com',
  'https://duclosjulien-h4f.github.io',
  'http://localhost:9091',
  'http://localhost:9090',
];

const COOKIE_NAME = 'h4f_sess';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 jours
const PBKDF2_ITER = 100000;

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
function json(data, status, origin, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin), ...(extraHeaders || {}) },
  });
}

// ---------------------------------------------------------------- encodage
const enc = (s) => new TextEncoder().encode(s);
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)); }
function b64url(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlStr(str) { return b64url(enc(str)); }
function unb64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return unb64(str);
}
function b64urlToStr(str) { return new TextDecoder().decode(unb64url(str)); }

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------- mots de passe (PBKDF2)
async function deriveBits(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256));
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveBits(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}
async function verifyPassword(password, stored) {
  try {
    const [algo, iterStr, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'pbkdf2') return false;
    const hash = await deriveBits(password, unb64(saltB64), parseInt(iterStr, 10));
    return timingSafeEqual(hash, unb64(hashB64));
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- session (cookie HMAC)
async function hmac(data, secret) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc(data)));
}
async function makeToken(uid, secret) {
  const payload = b64urlStr(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL }));
  const sig = b64url(await hmac(payload, secret));
  return `${payload}.${sig}`;
}
async function readToken(token, secret) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(payload, secret));
  if (!timingSafeEqual(enc(sig), enc(expected))) return null;
  try {
    const data = JSON.parse(b64urlToStr(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (e) { return null; }
}
function cookieHeader(value, env, maxAge) {
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/${domain}; Max-Age=${maxAge}`;
}
function getCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
// La session voyage dans l'en-tête Authorization (Bearer) — marche en cross-origin
// sans cookie 1re partie. Repli sur le cookie si présent (setup api.hub4fix.com futur).
function getSessionToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : getCookie(request, COOKIE_NAME);
}

// ---------------------------------------------------------------- réinitialisation mot de passe
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function genCode() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
}
// Envoi de l'e-mail via Resend (https://resend.com). Nécessite le secret RESEND_API_KEY.
// MAIL_FROM par défaut = domaine de test Resend (n'envoie qu'à l'adresse du compte Resend
// tant que le domaine hub4fix.com n'est pas vérifié chez Resend).
async function sendResetEmail(env, email, code) {
  // Tolérant à un nom de secret mal saisi (ex. espace en trop "RESEND_API_KEY ").
  const apiKey = env.RESEND_API_KEY || env['RESEND_API_KEY '] ||
    (Object.keys(env).map((k) => k.trim() === 'RESEND_API_KEY' ? env[k] : null).find(Boolean));
  if (!apiKey) throw new Error('RESEND_API_KEY non configuré');
  const from = env.MAIL_FROM || 'Hub4Fix <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Hub4Fix — ton code de réinitialisation',
      html: '<div style="font-family:sans-serif;color:#3B3632">' +
        '<p>Ton code de réinitialisation Hub4Fix :</p>' +
        '<p style="font-size:26px;font-weight:700;letter-spacing:5px;color:#C8102E">' + code + '</p>' +
        '<p>Valable 15 minutes. Si tu n\'as rien demandé, ignore cet e-mail.</p></div>',
    }),
  });
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + (await res.text()).slice(0, 200));
}

// ---------------------------------------------------------------- D1 helpers
async function findUserByEmail(env, email) {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}
async function tokenBalance(env, uid) {
  const r = await env.DB.prepare('SELECT COALESCE(SUM(delta),0) AS bal FROM token_ledger WHERE user_id = ?').bind(uid).first();
  return r ? r.bal : 0;
}
async function library(env, uid) {
  const r = await env.DB.prepare(
    'SELECT product_id, product_name, flux, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(uid).all();
  return (r && r.results) || [];
}
function safeParse(str) { try { return JSON.parse(str); } catch (e) { return []; } }

async function profilePayload(env, user) {
  return {
    email: user.email,
    // Obligatoires (remplis progressivement, requis avant de commander) :
    nom: user.nom || '',
    prenom: user.prenom || (user.email ? user.email.split('@')[0] : ''),
    // Facultatifs :
    adresse: user.adresse || '',
    telephone: user.telephone || '',
    pseudo: user.pseudo || '',
    avatar_key: user.avatar_key || '',
    social_links: user.social_links ? safeParse(user.social_links) : [],
    tokens: await tokenBalance(env, user.id),
    library: await library(env, user.id),
  };
}

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Roue "100% gagnant" — tirage AUTORITATIF côté serveur (le front ne fait qu'animer
// jusqu'à ce résultat). Pondéré vers 5 (avant-dernier) : le 10 reste rare (ancrage
// + near-miss), le 5 est le résultat modal. Moyenne ~4,2 tokens/inscrit.
// Pas de probabilités affichées côté client (cf. L121, pratiques commerciales).
function spinReward() {
  const weighted = [[10, 5], [5, 55], [3, 20], [2, 12], [1, 8]];
  let total = 0; for (const w of weighted) total += w[1];
  let r = Math.random() * total;
  for (const [val, wt] of weighted) { r -= wt; if (r < 0) return val; }
  return 5;
}

// ---------------------------------------------------------------- handlers
async function handleSignup(request, env, origin) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!isValidEmail(email)) return json({ error: 'email_invalide' }, 400, origin);
  if (!password || password.length < 8) return json({ error: 'mdp_trop_court' }, 400, origin);

  const existing = await findUserByEmail(env, email);
  if (existing) return json({ error: 'email_deja_utilise' }, 409, origin);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const hash = await hashPassword(password);
  const prenom = email.split('@')[0];

  await env.DB.prepare(
    'INSERT INTO users (id, email, prenom, role, auth_provider, password_hash, email_verified, created_at, last_login) ' +
    "VALUES (?, ?, ?, 'client', 'password', ?, 0, ?, ?)"
  ).bind(id, email, prenom, hash, now, now).run();

  // Bonus d'inscription = tirage de la roue "100% gagnant" (autoritatif serveur).
  const reward = spinReward();
  await env.DB.prepare(
    "INSERT INTO token_ledger (user_id, delta, motif, created_at) VALUES (?, ?, 'inscription', ?)"
  ).bind(id, reward, now).run();

  const token = await makeToken(id, env.SESSION_SECRET);
  const payload = await profilePayload(env, { id, email, prenom });
  payload.signup_bonus = reward; // le front anime la roue jusqu'à cette valeur
  payload.token = token;         // session à conserver côté navigateur (en-tête Authorization)
  return json(payload, 201, origin, { 'Set-Cookie': cookieHeader(token, env, SESSION_TTL) });
}

async function handleLogin(request, env, origin) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!isValidEmail(email) || !password) return json({ error: 'identifiants_invalides' }, 400, origin);

  const user = await findUserByEmail(env, email);
  // Vérifie toujours un hash (même si l'utilisateur n'existe pas) pour ne pas révéler l'existence du compte.
  const ok = user && user.password_hash
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'pbkdf2$1$AAAA$AAAA'); // leurre à coût constant
  if (!user || !ok) return json({ error: 'identifiants_invalides' }, 401, origin);

  await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run();
  const token = await makeToken(user.id, env.SESSION_SECRET);
  const payload = await profilePayload(env, user);
  payload.token = token;         // session à conserver côté navigateur (en-tête Authorization)
  return json(payload, 200, origin, { 'Set-Cookie': cookieHeader(token, env, SESSION_TTL) });
}

async function handleMe(request, env, origin) {
  const session = await readToken(getSessionToken(request), env.SESSION_SECRET);
  if (!session) return json({ authenticated: false }, 200, origin);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.uid).first();
  if (!user) return json({ authenticated: false }, 200, origin);
  return json({ authenticated: true, ...(await profilePayload(env, user)) }, 200, origin);
}

function handleLogout(env, origin) {
  return json({ ok: true }, 200, origin, { 'Set-Cookie': cookieHeader('', env, 0) });
}

// Mise à jour du profil (champs texte facultatifs + nom/prenom). Photo (avatar)
// = canal séparé vers R2, à ajouter (l'image ne transite pas par ici).
async function handleProfile(request, env, origin) {
  const session = await readToken(getSessionToken(request), env.SESSION_SECRET);
  if (!session) return json({ error: 'non_authentifie' }, 401, origin);

  const body = await request.json().catch(() => ({}));
  const sets = [], binds = [];
  for (const f of ['nom', 'prenom', 'adresse', 'telephone', 'pseudo']) {
    if (typeof body[f] === 'string') { sets.push(`${f} = ?`); binds.push(body[f].trim().slice(0, 200)); }
  }
  if (Array.isArray(body.social_links)) {
    const clean = body.social_links
      .filter((l) => l && typeof l.url === 'string' && l.url.trim())
      .slice(0, 10)
      .map((l) => ({ reseau: String(l.reseau || '').slice(0, 40), url: String(l.url).trim().slice(0, 300) }));
    sets.push('social_links = ?'); binds.push(JSON.stringify(clean));
  }
  if (!sets.length) return json({ error: 'rien_a_modifier' }, 400, origin);

  binds.push(session.uid);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.uid).first();
  return json(await profilePayload(env, user), 200, origin);
}

// Demande de réinitialisation : génère un code, l'envoie par e-mail. Réponse
// TOUJOURS générique (ne révèle pas si le compte existe).
async function handleResetRequest(request, env, origin) {
  const { email } = await request.json().catch(() => ({}));
  const generic = json({ ok: true }, 200, origin);
  if (!isValidEmail(email)) return generic;
  const user = await findUserByEmail(env, email);
  if (!user) return generic;

  const code = genCode();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO password_resets (user_id, code_hash, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(user.id, await sha256hex(code), now + 900, new Date().toISOString()).run();

  try { await sendResetEmail(env, email, code); }
  catch (e) { return json({ error: 'envoi_impossible', detail: String(e.message || e) }, 500, origin); }
  return generic;
}

// Validation : vérifie le code, change le mot de passe, connecte l'utilisateur.
async function handleResetConfirm(request, env, origin) {
  const { email, code, password } = await request.json().catch(() => ({}));
  if (!isValidEmail(email) || !code) return json({ error: 'donnees_invalides' }, 400, origin);
  if (!password || password.length < 8) return json({ error: 'mdp_trop_court' }, 400, origin);

  const user = await findUserByEmail(env, email);
  if (!user) return json({ error: 'code_invalide' }, 401, origin);

  const now = Math.floor(Date.now() / 1000);
  const reset = await env.DB.prepare(
    'SELECT * FROM password_resets WHERE user_id = ? AND code_hash = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).bind(user.id, await sha256hex(String(code).trim()), now).first();
  if (!reset) return json({ error: 'code_invalide' }, 401, origin);

  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id).run();
  await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').bind(reset.id).run();

  const token = await makeToken(user.id, env.SESSION_SECRET);
  const payload = await profilePayload(env, user);
  payload.token = token;
  return json(payload, 200, origin, { 'Set-Cookie': cookieHeader(token, env, SESSION_TTL) });
}

// ---------------------------------------------------------------- routeur
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/auth/signup') return await handleSignup(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/auth/login') return await handleLogin(request, env, origin);
      if (request.method === 'GET' && url.pathname === '/auth/me') return await handleMe(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/auth/profile') return await handleProfile(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/auth/reset-request') return await handleResetRequest(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/auth/reset-confirm') return await handleResetConfirm(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/auth/logout') return handleLogout(env, origin);
      return json({ error: 'not_found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server_error', detail: String(err && err.message || err) }, 500, origin);
    }
  },
};
