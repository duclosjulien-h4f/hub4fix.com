/**
 * Hub4Fix — Worker "h4f-admin" : espace administrateur.
 *
 * Connexion via OpenID Connect (OIDC) vers Zitadel (Authorization Code + PKCE).
 * Back-office structuré (barre latérale + sections). Lit le Google Sheet des
 * inscriptions (lecture seule) pour la liste + le badge "nouvelles".
 *
 * Variables d'environnement (Cloudflare > Settings > Variables) :
 *   ISSUER          = https://hub4fix-l2itdp.ch1.zitadel.cloud
 *   CLIENT_ID       = 378989531187151592
 *   SESSION_SECRET  = (secret aléatoire long) — signe les cookies            [Secret]
 *   ADMIN_EMAILS    = "julien@exemple.com,..." — liste blanche
 *   SHEET_ID        = 1SQ2HoBMVUzFITHjZEaztyq7yOtyLUA8cH-6WMd6x_s8
 *   GOOGLE_SA_EMAIL = h4f-sheets@hub4fix.iam.gserviceaccount.com
 *   GOOGLE_SA_KEY   = clé privée du compte de service (lecture du Sheet)      [Secret]
 *   SHEET_TAB       = Inscriptions (optionnel)
 */

const SCOPES = 'openid profile email';
const SESSION_TTL = 60 * 60 * 8; // 8 h
const TMP_TTL = 60 * 10;
const SEEN_TTL = 60 * 60 * 24 * 365;

// ---- base64url ----
function b64urlBytes(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStrDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(s)));
}
function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
}

// ---- cookies signés (HMAC-SHA256) ----
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64urlBytes(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}
async function makeToken(secret, obj) {
  const p = b64urlStr(JSON.stringify(obj));
  return p + '.' + (await hmac(secret, p));
}
async function readToken(secret, token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [p, sig] = token.split('.');
  if (sig !== (await hmac(secret, p))) return null;
  try {
    const obj = JSON.parse(b64urlStrDecode(p));
    if (obj.exp && obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch { return null; }
}

function getCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function killCookie(name) {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- découverte OIDC (cache isolat) ----
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

// ---- lecture du Google Sheet (compte de service, lecture seule) ----
async function importPkcs8(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
let _g = { t: null, exp: 0 };
async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_g.t && _g.exp > now + 60) return _g.t;
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
  const unsigned = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await importPkcs8(env.GOOGLE_SA_KEY);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64urlBytes(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token');
  _g = { t: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}
async function loadInscriptions(env) {
  if (!env.SHEET_ID || !env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) return { error: 'config' };
  try {
    const token = await googleToken(env);
    const tab = env.SHEET_TAB || 'Inscriptions';
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(tab)}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return { error: 'api' };
    const j = await r.json();
    const v = j.values || [];
    const header = v[0] || [];
    const rows = v.slice(1).map((a) => { const o = {}; header.forEach((h, i) => (o[h] = a[i] || '')); return o; });
    rows.reverse(); // plus récentes en premier
    return { rows };
  } catch { return { error: 'exception' }; }
}
function countNew(rows, seen) {
  if (!rows) return 0;
  if (!seen) return rows.length;
  return rows.filter((r) => (r.date || '') > seen).length;
}

// ==================== BASE CENTRALE « Pièces » (Google Sheet + R2) ====================
// Le Sheet "Pieces" est la source de vérité (une ligne par pièce, clé = id taxonomique).
// Les images vivent dans R2 : orig/<id> (privé) et h4f/<id> (visuel public).
const PIECES_TAB_DEFAULT = 'Pieces';
const PIECE_COLS = [
  'id', 'group', 'brand', 'range', 'model', 'piece',
  'name', 'machine', 'category',
  'demand', 'alerts', 'units', 'age', 'addedDate', 'modeled',
  'description', 'price', 'dimensions', 'weight', 'material', 'printTime', 'compat', 'ref',
  'model3d',
  'status', 'sourceUrl', 'sha256', 'dhash', 'validatedBy', 'validatedAt',
];
const PIECE_PUBLIC_COLS = [
  'id', 'group', 'brand', 'range', 'model', 'piece', 'name', 'machine', 'category',
  'demand', 'alerts', 'units', 'age', 'addedDate', 'modeled',
  'description', 'price', 'dimensions', 'weight', 'material', 'printTime', 'compat', 'ref',
  'model3d',
];
function truthy(v) { return /^(true|1|oui|yes|x)$/i.test(String(v == null ? '' : v).trim()); }

function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extraHeaders || {}),
  });
}
function piecesSheetId(env) { return env.PIECES_SHEET_ID || env.SHEET_ID; }
function piecesTab(env) { return env.PIECES_TAB || PIECES_TAB_DEFAULT; }

async function sheetsValues(env, tab) {
  const token = await googleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${piecesSheetId(env)}/values/${encodeURIComponent(tab)}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('sheets read ' + r.status);
  const j = await r.json();
  return j.values || [];
}
// Écrit une plage (PUT values.update) ou ajoute une ligne (append).
async function sheetsWrite(env, method, range, values) {
  const token = await googleToken(env);
  const sid = piecesSheetId(env);
  let url = `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${encodeURIComponent(range)}`;
  url += method === 'append'
    ? ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
    : '?valueInputOption=RAW';
  const r = await fetch(url, {
    method: method === 'append' ? 'POST' : 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!r.ok) throw new Error('sheets write ' + r.status);
  return true;
}

async function loadPieces(env) {
  if (!piecesSheetId(env) || !env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_KEY) return { error: 'config' };
  try {
    const v = await sheetsValues(env, piecesTab(env));
    const header = v.length ? v[0] : PIECE_COLS;
    const rows = v.slice(1).map((a) => { const o = {}; header.forEach((h, i) => (o[h] = a[i] != null ? a[i] : '')); return o; });
    return { rows, header, raw: v };
  } catch { return { error: 'api' }; }
}
function countToValidate(rows) {
  return rows ? rows.filter((r) => (r.status || '') === 'to-validate').length : 0;
}

// Compteurs « vivants » : amorcés à la création, mais jamais écrasés ensuite par
// le pipeline (la wishlist incrémente alerts en direct — un re-push ne doit pas
// ramener le compteur à sa valeur locale).
const LIVE_COLS = ['demand', 'alerts'];

// Upsert par id. Les champs vides entrants ne SUPPRIMENT pas une valeur existante
// (permet de compléter la fiche technique à la main dans le Sheet sans être écrasé).
async function upsertPiece(env, piece) {
  const tab = piecesTab(env);
  let v = [];
  try { v = await sheetsValues(env, tab); } catch { v = []; }
  if (!v.length) { await sheetsWrite(env, 'append', tab, [PIECE_COLS]); v = [PIECE_COLS]; }
  const header = v[0];
  const idIdx = header.indexOf('id');
  let found = -1;
  for (let i = 1; i < v.length; i++) { if ((v[i][idIdx] || '') === piece.id) { found = i; break; } }
  if (found >= 0) {
    const existing = v[found];
    const merged = header.map((h, i) => {
      const cur = existing[i] != null ? existing[i] : '';
      // compteurs vivants : la valeur du Sheet fait foi une fois posée
      if (LIVE_COLS.includes(h) && cur !== '') return cur;
      const inc = piece[h];
      return (inc == null || inc === '') ? cur : String(inc);
    });
    await sheetsWrite(env, 'update', `${tab}!A${found + 1}`, [merged]);
  } else {
    await sheetsWrite(env, 'append', tab, [header.map((h) => (piece[h] != null ? String(piece[h]) : ''))]);
  }
  return { ok: true };
}
// Patch ciblé (publish / reject) : ne touche que les colonnes de `patch`.
async function patchPiece(env, id, patch) {
  const tab = piecesTab(env);
  const v = await sheetsValues(env, tab);
  if (!v.length) return { ok: false };
  const header = v[0];
  const idIdx = header.indexOf('id');
  let found = -1;
  for (let i = 1; i < v.length; i++) { if ((v[i][idIdx] || '') === id) { found = i; break; } }
  if (found < 0) return { ok: false };
  const row = header.map((h, i) => (patch[h] != null ? String(patch[h]) : (v[found][i] != null ? v[found][i] : '')));
  await sheetsWrite(env, 'update', `${tab}!A${found + 1}`, [row]);
  return { ok: true };
}

// ---- R2 (stockage images + fichiers 3D privé) ----
async function r2Put(env, key, buf, ct, filename) {
  if (!env.PIECES_R2) return false;
  await env.PIECES_R2.put(key, buf, {
    httpMetadata: { contentType: ct || 'application/octet-stream' },
    customMetadata: filename ? { filename } : undefined,
  });
  return true;
}
async function serveR2(env, key, extraHeaders) {
  if (!env.PIECES_R2) return json({ error: 'r2-unbound' }, 503);
  const obj = await env.PIECES_R2.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png';
  return new Response(obj.body, {
    headers: Object.assign({ 'Content-Type': ct, 'Cache-Control': 'private, max-age=300' }, extraHeaders || {}),
  });
}

// Extensions acceptées pour le fichier source 3D (jamais servi publiquement).
const SRC_3D_EXTS = ['.stl', '.3mf', '.step', '.stp', '.f3d'];
function extOf(name) { const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/); return m ? m[0] : ''; }

// POST /admin/upload3d — dépôt du fichier 3D prêt (+ GLB d'affichage optionnel).
// Source -> R2 src/<id> (PRIVÉ). GLB -> R2 glb/<id> (public via /model/<id>).
// Le dépôt du source marque la pièce modeled=true dans le Sheet.
async function adminUpload3d(request, env, sess) {
  let form;
  try { form = await request.formData(); } catch { return new Response('Formulaire invalide', { status: 400 }); }
  const id = (form.get('id') || '').toString();
  if (!id) return new Response('id manquant', { status: 400 });
  const src = form.get('source');
  const glb = form.get('glb');
  const patch = {};
  const done = [];
  if (src && src.arrayBuffer && src.name) {
    if (!SRC_3D_EXTS.includes(extOf(src.name))) {
      return new Response('Format source non accepté (' + esc(extOf(src.name)) + ') — attendu : ' + SRC_3D_EXTS.join(', '), { status: 400 });
    }
    await r2Put(env, 'src/' + id, await src.arrayBuffer(), 'application/octet-stream', src.name);
    patch.modeled = 'true';
    done.push('source ' + src.name);
  }
  if (glb && glb.arrayBuffer && glb.name) {
    if (extOf(glb.name) !== '.glb') return new Response('Le mesh d\'affichage doit être un .glb', { status: 400 });
    await r2Put(env, 'glb/' + id, await glb.arrayBuffer(), 'model/gltf-binary', glb.name);
    patch.model3d = '/model/' + id;
    done.push('glb ' + glb.name);
  }
  if (done.length) {
    try { await patchPiece(env, id, patch); } catch { /* fichier stocké, patch Sheet à rejouer */ }
    await audit(env, sess.email, 'piece-file', id + ' — ' + done.join(', '));
  }
  return new Response(null, { status: 302, headers: { Location: '/admin/shadowlist' } });
}

// POST /api/pieces — le pipeline pousse méta + original + visuel (auth token).
async function apiPiecesPost(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.PIPELINE_TOKEN || token !== env.PIPELINE_TOKEN) return json({ error: 'unauthorized' }, 401);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad-multipart' }, 400); }
  let meta;
  try { meta = JSON.parse(form.get('meta') || '{}'); } catch { return json({ error: 'bad-meta' }, 400); }
  if (!meta.id) return json({ error: 'missing-id' }, 400);
  const out = { id: meta.id, r2: false, sheet: false };
  try {
    const orig = form.get('original');
    const visual = form.get('visual');
    if (orig && orig.arrayBuffer) await r2Put(env, 'orig/' + meta.id, await orig.arrayBuffer(), orig.type || 'image/png');
    if (visual && visual.arrayBuffer) await r2Put(env, 'h4f/' + meta.id, await visual.arrayBuffer(), visual.type || 'image/png');
    out.r2 = !!env.PIECES_R2;
  } catch (e) { out.r2error = String(e); }
  try {
    await upsertPiece(env, Object.assign({}, meta, { status: 'to-validate' }));
    out.sheet = true;
  } catch (e) { out.sheeterror = String(e); }
  await audit(env, 'pipeline', 'piece-push', meta.id);
  return json(out, 200);
}

// POST /api/wishlist — un visiteur s'inscrit pour être alerté sur une pièce non
// encore disponible. Enregistre le lead + fait monter le signal de demande (alerts).
// Requête simple (form-urlencoded) => pas de préflight CORS.
async function apiWishlistPost(request, env) {
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad-form' }, 400, { 'Access-Control-Allow-Origin': '*' }); }
  const id = (form.get('id') || '').toString().trim();
  const email = (form.get('email') || '').toString().trim();
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (!id || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid' }, 400, cors);
  try {
    // lead -> onglet Wishlist (création de l'en-tête si absent)
    const tab = env.WISHLIST_TAB || 'Wishlist';
    let v = [];
    try { v = await sheetsValues(env, tab); } catch { v = []; }
    if (!v.length) await sheetsWrite(env, 'append', tab, [['date', 'id', 'email']]);
    await sheetsWrite(env, 'append', tab, [[nowIso(), id, email]]);
    // signal de demande : +1 alerte sur la pièce
    const pd = await loadPieces(env);
    if (!pd.error) {
      const row = pd.rows.find((r) => r.id === id);
      if (row) await patchPiece(env, id, { alerts: (parseInt(row.alerts, 10) || 0) + 1 });
    }
  } catch (e) {
    return json({ error: 'store', detail: String(e) }, 200, cors); // on ne bloque pas le visiteur
  }
  return json({ ok: true }, 200, cors);
}

// GET /api/pieces.json — feed public (pièces publiées, colonnes sûres uniquement).
async function apiPiecesJson(env) {
  const data = await loadPieces(env);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=120' };
  if (data.error) return json({ products: [] }, 200, cors);
  const products = data.rows
    .filter((r) => (r.status || '') === 'published')
    .map((r) => {
      const o = {};
      PIECE_PUBLIC_COLS.forEach((k) => (o[k] = r[k]));
      o.modeled = truthy(r.modeled);
      o.image = '/img/h4f/' + r.id;
      return o;
    });
  return json({ products }, 200, cors);
}

// ---- base D1 : admins / rôles / audit ----
const ROLES = ['admin', 'sous-admin', 'comptabilite'];
function nowIso() { return new Date().toISOString(); }
async function audit(env, actor, action, detail) {
  if (!env.DB) return;
  try { await env.DB.prepare('INSERT INTO audit (ts,actor,action,detail) VALUES (?,?,?,?)').bind(nowIso(), actor, action, detail || '').run(); } catch {}
}
// Upsert au login ; renvoie le rôle (admin par défaut si pas de base / 1er login).
async function loginAdmin(env, sub, email, name) {
  if (!env.DB) return 'admin';
  const ts = nowIso();
  try {
    const row = await env.DB.prepare('SELECT role FROM admins WHERE email=?').bind(email).first();
    if (row) {
      await env.DB.prepare('UPDATE admins SET sub=?, name=?, last_login=? WHERE email=?').bind(sub, name, ts, email).run();
      await audit(env, email, 'login', '');
      return row.role || 'admin';
    }
    await env.DB.prepare('INSERT INTO admins (sub,email,name,role,created_at,last_login) VALUES (?,?,?,?,?,?)')
      .bind(sub, email, name, 'admin', ts, ts).run();
    await audit(env, email, 'login', 'premier login (compte créé)');
    return 'admin';
  } catch { return 'admin'; }
}
async function listAdmins(env) {
  if (!env.DB) return null;
  try {
    const r = await env.DB.prepare('SELECT email,name,role,last_login FROM admins ORDER BY created_at').all();
    return r.results || [];
  } catch { return null; }
}
async function setRole(env, email, role, actor) {
  if (!env.DB || !ROLES.includes(role)) return;
  await env.DB.prepare('UPDATE admins SET role=? WHERE email=?').bind(role, email).run();
  await audit(env, actor, 'role', email + ' -> ' + role);
}

// ---- appareils de confiance ----
function deviceLabel(request) {
  const ua = request.headers.get('User-Agent') || '';
  let b = 'Navigateur', o = '';
  if (/Edg\//.test(ua)) b = 'Edge'; else if (/Chrome\//.test(ua)) b = 'Chrome'; else if (/Firefox\//.test(ua)) b = 'Firefox'; else if (/Safari\//.test(ua)) b = 'Safari';
  if (/Windows/.test(ua)) o = 'Windows'; else if (/Mac OS|Macintosh/.test(ua)) o = 'macOS'; else if (/Android/.test(ua)) o = 'Android'; else if (/iPhone|iPad/.test(ua)) o = 'iOS'; else if (/Linux/.test(ua)) o = 'Linux';
  const country = request.cf && request.cf.country ? ' · ' + request.cf.country : '';
  return b + (o ? ' / ' + o : '') + country + ' · ' + nowIso().slice(0, 10);
}
// Résout l'appareil courant ; crée un "pending" si inconnu. Échec = on laisse passer
// (la passkey reste la vraie barrière ; on ne verrouille pas sur une erreur de base).
async function resolveDevice(env, email, cookieId, request) {
  try {
    if (cookieId) {
      const d = await env.DB.prepare('SELECT id,status FROM devices WHERE id=? AND admin_email=?').bind(cookieId, email).first();
      if (d) return { id: d.id, status: d.status, label: '' };
    }
    const id = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
    const label = deviceLabel(request);
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE status='approved'").first();
    const first = (c.n || 0) === 0;                 // tout premier appareil = founder bootstrap
    const status = first ? 'approved' : 'pending';
    await env.DB.prepare('INSERT INTO devices (id,admin_email,label,status,created_at,approved_by) VALUES (?,?,?,?,?,?)')
      .bind(id, email, label, status, nowIso(), first ? 'bootstrap (1er appareil)' : null).run();
    await audit(env, email, 'device', (first ? 'auto-approuvé (1er appareil)' : 'en attente') + ' — ' + label);
    return { id, status, label };
  } catch { return { id: cookieId || '', status: 'approved', label: '' }; }
}
async function countAdmins(env) {
  try { const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first(); return r.n || 0; } catch { return 1; }
}
async function listDevices(env) {
  if (!env.DB) return null;
  try {
    const r = await env.DB.prepare("SELECT id,admin_email,label,status,created_at,approved_by FROM devices ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC").all();
    return r.results || [];
  } catch { return null; }
}
async function approveDevice(env, id, actorEmail) {
  const d = await env.DB.prepare('SELECT admin_email FROM devices WHERE id=?').bind(id).first();
  if (!d) return { ok: false, msg: 'Appareil introuvable.' };
  if ((await countAdmins(env)) > 1 && d.admin_email === actorEmail) {
    return { ok: false, msg: 'Un AUTRE administrateur doit approuver cet appareil.' };
  }
  await env.DB.prepare("UPDATE devices SET status='approved', approved_by=? WHERE id=?").bind(actorEmail, id).run();
  await audit(env, actorEmail, 'device-approve', id + ' (' + d.admin_email + ')');
  return { ok: true };
}
async function revokeDevice(env, id, actorEmail) {
  await env.DB.prepare("UPDATE devices SET status='revoked' WHERE id=?").bind(id).run();
  await audit(env, actorEmail, 'device-revoke', id);
  return { ok: true };
}

function htmlResponse(body, status) {
  return new Response(body, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ===================== BACK-OFFICE =====================

const NAV = [
  { path: '/admin', label: 'Tableau de bord', roles: ['admin', 'sous-admin', 'comptabilite'] },
  { path: '/admin/inscriptions', label: 'Inscriptions', roles: ['admin', 'sous-admin'] },
  { path: '/admin/shadowlist', label: 'Shadow List', roles: ['admin', 'sous-admin'] },
  { path: '/admin/modeles', label: 'Modèles 3D', roles: ['admin', 'sous-admin'] },
  { path: '/admin/admins', label: 'Administrateurs', roles: ['admin'] },
  { path: '/admin/appareils', label: 'Appareils', roles: ['admin'] },
  { path: '/admin/comptabilite', label: 'Comptabilité', roles: ['admin', 'comptabilite'] },
  { path: '/admin/journal', label: "Journal d'audit", roles: ['admin'] },
];

const STYLE = `
:root{--red:#C8102E;--ink:#1C1A18;--earth:#7A7268;--cream:#F3EEE8;--line:#EDE6DC;--ivory:#FAF8F5;--green:#2D8B5E}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Karla',sans-serif;color:var(--ink);background:var(--ivory)}
.wrap{display:flex;min-height:100vh}
.side{width:236px;flex:0 0 236px;background:#fff;border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:600;padding:1.3rem 1.4rem;border-bottom:1px solid var(--line)}
.brand sup{color:var(--red)}
.brand span{display:block;font-family:system-ui,sans-serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--earth);font-weight:600;margin-top:.15rem}
.nav{padding:.6rem .5rem;flex:1}
.nav a{display:flex;justify-content:space-between;align-items:center;padding:.6rem .9rem;margin:.15rem 0;border-radius:7px;color:var(--ink);text-decoration:none;font-size:.9rem;font-weight:500;border-left:3px solid transparent}
.nav a:hover{background:var(--cream)}
.nav a.active{background:rgba(200,16,46,.07);border-left-color:var(--red);color:var(--red)}
.pill{background:var(--red);color:#fff;font-size:.66rem;font-weight:700;border-radius:10px;padding:.05rem .42rem;min-width:18px;text-align:center}
.side-foot{border-top:1px solid var(--line);padding:.9rem 1.1rem}
.who{font-size:.82rem;font-weight:600;line-height:1.3}
.who small{display:block;font-weight:400;color:var(--earth);font-size:.7rem;margin-top:.15rem;word-break:break-all}
.logout{display:inline-block;margin-top:.6rem;font-size:.78rem;color:var(--earth);text-decoration:none}
.logout:hover{color:var(--red)}
.content{flex:1;padding:2.2rem 2.6rem;max-width:1100px}
h1.page{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:1.9rem;margin-bottom:.3rem}
.sub{color:var(--earth);font-size:.92rem;margin-bottom:1.8rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1rem;margin-bottom:1.8rem}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:1.2rem 1.3rem}
.card.new{border-color:var(--green);background:rgba(45,139,94,.05)}
.card .k{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:var(--earth);font-weight:600}
.card .v{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:500;margin-top:.3rem}
.card.new .v{color:var(--green)}
.banner{background:rgba(45,139,94,.1);border:1px solid var(--green);color:#1f6b46;border-radius:10px;padding:.8rem 1.1rem;margin-bottom:1.4rem;font-size:.92rem;font-weight:600}
.soon{background:#fff;border:1px dashed var(--line);border-radius:10px;padding:1.4rem 1.6rem;color:var(--earth);font-size:.92rem;line-height:1.6}
.soon b{color:var(--ink)}
.err{background:#fff4f4;border:1px solid #f3c2c2;color:#9b1c1c;border-radius:10px;padding:1.1rem 1.3rem;font-size:.9rem;line-height:1.6}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:.86rem}
th,td{text-align:left;padding:.6rem .8rem;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.68rem;letter-spacing:.05em;text-transform:uppercase;color:var(--earth);background:var(--cream)}
tr.is-new td{background:rgba(45,139,94,.05)}
.tag{display:inline-block;font-size:.7rem;font-weight:600;border-radius:6px;padding:.1rem .45rem}
.tag.printer{background:#e8f1f8;color:#2c6e9b}
.tag.modelisateur{background:#f5ece5;color:#a0522d}
.tag.client{background:var(--cream);color:var(--earth)}
.muted{color:var(--earth)}
@media(max-width:760px){
  .wrap{flex-direction:column}
  .side{width:100%;height:auto;position:static}
  .nav{display:flex;flex-wrap:wrap}
  .nav a{flex:1 1 auto;border-left:none;border-bottom:3px solid transparent}
  .nav a.active{border-left:none;border-bottom-color:var(--red)}
  .content{padding:1.4rem 1rem}
  table{font-size:.78rem}
}
`;

function shell(activePath, sess, content, newCount, toValidate) {
  const role = sess.role || 'admin';
  const items = NAV.filter((n) => n.roles.includes(role))
    .map((n) => {
      let badge = '';
      if (n.path === '/admin/inscriptions' && newCount > 0) badge = `<span class="pill">${newCount}</span>`;
      else if (n.path === '/admin/shadowlist' && toValidate > 0) badge = `<span class="pill">${toValidate}</span>`;
      return `<a href="${n.path}"${n.path === activePath ? ' class="active"' : ''}><span>${esc(n.label)}</span>${badge}</a>`;
    }).join('');
  return htmlResponse(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub4Fix — Admin</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Karla:wght@400;500;600&display=swap" rel="stylesheet">' +
    '<style>' + STYLE + '</style></head><body><div class="wrap">' +
    '<aside class="side">' +
      '<div class="brand">Hub<sup>4</sup>Fix<span>Administration</span></div>' +
      '<nav class="nav">' + items + '</nav>' +
      '<div class="side-foot"><div class="who">' + esc(sess.name) + '<small>' + esc(sess.email) + ' · ' + esc(role) + '</small></div>' +
      '<a class="logout" href="/auth/logout">Déconnexion</a></div>' +
    '</aside>' +
    '<main class="content">' + content + '</main>' +
    '</div></body></html>'
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  return esc(String(iso).replace('T', ' ').slice(0, 16));
}

function viewDashboard(sess, data, seen, toValidate) {
  const tvBanner = toValidate > 0
    ? '<div class="banner" style="background:rgba(200,16,46,.08);border-color:var(--red);color:#9b1c1c">' +
      toValidate + ' pièce' + (toValidate > 1 ? 's' : '') + ' H4F en attente de validation — <a href="/admin/shadowlist">les voir</a>.</div>'
    : '';
  if (data.error) {
    return '<h1 class="page">Tableau de bord</h1><p class="sub">Bonjour ' + esc(sess.name) + '.</p>' +
      tvBanner + dataError(data.error);
  }
  const rows = data.rows;
  const nb = (t) => rows.filter((r) => (r.type || '') === t).length;
  const nouveau = countNew(rows, seen);
  return '<h1 class="page">Tableau de bord</h1>' +
    '<p class="sub">Bonjour ' + esc(sess.name) + '. Vue d\'ensemble de l\'activité Hub⁴Fix.</p>' +
    '<div class="cards">' +
      '<div class="card"><div class="k">Inscriptions</div><div class="v">' + rows.length + '</div></div>' +
      '<div class="card' + (nouveau > 0 ? ' new' : '') + '"><div class="k">Nouvelles</div><div class="v">' + nouveau + '</div></div>' +
      '<div class="card"><div class="k">Printers</div><div class="v">' + nb('printer') + '</div></div>' +
      '<div class="card"><div class="k">Modélisateurs</div><div class="v">' + nb('modelisateur') + '</div></div>' +
    '</div>' + tvBanner +
    (nouveau > 0
      ? '<div class="banner">' + nouveau + ' nouvelle' + (nouveau > 1 ? 's' : '') + ' inscription' + (nouveau > 1 ? 's' : '') + ' depuis ta dernière visite — <a href="/admin/inscriptions">les voir</a>.</div>'
      : '<div class="soon">Aucune nouvelle inscription depuis ta dernière visite.</div>');
}

function viewInscriptions(data) {
  if (data.error) {
    return '<h1 class="page">Inscriptions</h1><p class="sub">Printers, modélisateurs et clients.</p>' + dataError(data.error);
  }
  const rows = data.rows;
  if (!rows.length) {
    return '<h1 class="page">Inscriptions</h1><p class="sub">Printers, modélisateurs et clients.</p><div class="soon">Aucune inscription pour le moment.</div>';
  }
  const seen = data.seen;
  const head = '<tr><th>Date</th><th>Type</th><th>Nom</th><th>Email</th><th>Ville</th><th>Téléphone</th><th>Détail</th></tr>';
  const body = rows.map((r) => {
    const isNew = seen && (r.date || '') > seen;
    const type = (r.type || '').toLowerCase();
    const nom = esc(r.name || ((r.prenom || '') + ' ' + (r.nom || '')).trim());
    const detail = type === 'printer' ? (r.parc_machines || r.materiaux || '')
      : type === 'modelisateur' ? (r.logiciels || r.portfolio || '')
      : (r.message || '');
    return '<tr' + (isNew ? ' class="is-new"' : '') + '>' +
      '<td>' + fmtDate(r.date) + (isNew ? ' <span class="tag" style="background:var(--green);color:#fff">nouveau</span>' : '') + '</td>' +
      '<td><span class="tag ' + esc(type) + '">' + esc(r.type || '?') + '</span></td>' +
      '<td>' + nom + '</td>' +
      '<td>' + esc(r.email) + '</td>' +
      '<td>' + esc(r.ville) + '</td>' +
      '<td>' + esc(r.tel) + '</td>' +
      '<td class="muted">' + esc(String(detail).slice(0, 80)) + '</td>' +
      '</tr>';
  }).join('');
  return '<h1 class="page">Inscriptions</h1><p class="sub">' + rows.length + ' inscription' + (rows.length > 1 ? 's' : '') + ' — les plus récentes en premier.</p>' +
    '<table>' + head + body + '</table>';
}

function dataError(kind) {
  if (kind === 'config') {
    return '<div class="err"><b>Lecture du Sheet non configurée.</b><br>Ajoute les variables <code>SHEET_ID</code>, <code>GOOGLE_SA_EMAIL</code> et <code>GOOGLE_SA_KEY</code> (les mêmes que sur le Worker h4f-collect) dans les réglages de ce Worker, puis redéploie.</div>';
  }
  return '<div class="err"><b>Impossible de lire le Google Sheet.</b><br>Vérifie que la feuille est partagée avec le compte de service et que les variables Google sont correctes.</div>';
}

function viewSoon(title, sub, text) {
  return '<h1 class="page">' + esc(title) + '</h1><p class="sub">' + esc(sub) + '</p><div class="soon">' + text + '</div>';
}
function viewModeles() {
  // Compteurs en attente de la pipeline de soumission/validation des fichiers.
  return '<h1 class="page">Modèles 3D</h1>' +
    '<p class="sub">Fichiers soumis par les modélisateurs et file de validation.</p>' +
    '<div class="cards">' +
      '<div class="card"><div class="k">Fichiers 3D</div><div class="v">—</div></div>' +
      '<div class="card new"><div class="k">En attente de validation</div><div class="v">—</div></div>' +
      '<div class="card"><div class="k">Validés</div><div class="v">—</div></div>' +
      '<div class="card"><div class="k">Refusés</div><div class="v">—</div></div>' +
    '</div>' +
    '<h2 style="font-family:\'Cormorant Garamond\',serif;font-weight:500;font-size:1.2rem;margin:.4rem 0 .8rem">À valider</h2>' +
    '<div class="soon">Chaque fichier en attente apparaîtra ici avec un bouton <b>« Examiner »</b> (aperçu du modèle, fiche du modélisateur, accepter / refuser).<br><br>' +
    '<b>Prérequis :</b> la <b>pipeline de soumission</b> (le modélisateur dépose un 3MF/STEP → stockage → file de relecture → publication au catalogue). C\'est un sous-système à construire, lié au Cloud Slicer.</div>';
}
function viewAdmins(admins, sess) {
  if (admins === null) {
    return '<h1 class="page">Administrateurs</h1><p class="sub">Comptes et rôles.</p>' +
      '<div class="err"><b>Base D1 non connectée.</b><br>Crée la base, exécute le schéma <code>admin-schema.sql</code> et ajoute la liaison <code>DB</code> au Worker, puis redéploie.</div>';
  }
  const canEdit = sess.role === 'admin';
  const head = '<tr><th>E-mail</th><th>Nom</th><th>Rôle</th><th>Dernière connexion</th>' + (canEdit ? '<th>Modifier</th>' : '') + '</tr>';
  const body = admins.map((a) => {
    const opts = ROLES.map((r) => '<option value="' + r + '"' + (a.role === r ? ' selected' : '') + '>' + r + '</option>').join('');
    const cell = canEdit
      ? '<td><form method="post" action="/admin/admins" style="display:flex;gap:.4rem;align-items:center">' +
        '<input type="hidden" name="email" value="' + esc(a.email) + '">' +
        '<select name="role">' + opts + '</select>' +
        '<button type="submit" style="border:1px solid var(--line);background:var(--cream);border-radius:6px;padding:.35rem .7rem;cursor:pointer">OK</button>' +
        '</form></td>'
      : '';
    return '<tr><td>' + esc(a.email) + '</td><td>' + esc(a.name) + '</td>' +
      '<td><span class="tag" style="background:var(--cream);color:var(--earth)">' + esc(a.role) + '</span></td>' +
      '<td class="muted">' + fmtDate(a.last_login) + '</td>' + cell + '</tr>';
  }).join('');
  return '<h1 class="page">Administrateurs</h1>' +
    '<p class="sub">' + admins.length + ' compte(s). ' + (canEdit ? 'Tu peux modifier les rôles.' : 'Seul un rôle « admin » peut modifier les rôles.') + '</p>' +
    '<table>' + head + body + '</table>';
}
function pendingPage(id, label) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>En attente</title></head>' +
    '<body style="font-family:system-ui,sans-serif;color:#1C1A18;background:#FAF8F5">' +
    '<div style="max-width:520px;margin:4rem auto;text-align:center;padding:0 1rem">' +
    '<h1 style="font-weight:500">Appareil en attente d\'approbation</h1>' +
    '<p style="color:#7A7268;line-height:1.6">Cette machine (<b>' + esc(label) + '</b>) doit être approuvée par un administrateur avant d\'accéder à l\'espace admin.</p>' +
    '<p style="color:#7A7268;font-size:.82rem">Identifiant de l\'appareil :<br><code>' + esc(id) + '</code></p>' +
    '<p style="margin-top:1.5rem"><a href="/auth/logout" style="color:#7A7268">Se déconnecter</a></p>' +
    '</div></body></html>';
}
function viewDevices(devices, sess, errMsg) {
  if (devices === null) {
    return '<h1 class="page">Appareils</h1><p class="sub">Machines de confiance.</p><div class="err"><b>Base D1 non connectée.</b></div>';
  }
  const canEdit = sess.role === 'admin';
  const pending = devices.filter((d) => d.status === 'pending').length;
  const head = '<tr><th>Appareil</th><th>Admin</th><th>Statut</th><th>Approuvé par</th>' + (canEdit ? '<th>Action</th>' : '') + '</tr>';
  const body = devices.map((d) => {
    const badge = d.status === 'approved'
      ? '<span class="tag" style="background:rgba(45,139,94,.12);color:#1f6b46">approuvé</span>'
      : d.status === 'pending'
      ? '<span class="tag" style="background:rgba(200,16,46,.1);color:#9b1c1c">en attente</span>'
      : '<span class="tag" style="background:var(--cream);color:var(--earth)">révoqué</span>';
    let action = '';
    if (canEdit) {
      let btns = '';
      if (d.status !== 'approved') btns += '<button name="action" value="approve" style="border:none;background:var(--green);color:#fff;border-radius:6px;padding:.35rem .7rem;cursor:pointer">Approuver</button>';
      if (d.status !== 'revoked') btns += '<button name="action" value="revoke" style="border:1px solid var(--line);background:#fff;border-radius:6px;padding:.35rem .7rem;cursor:pointer">Révoquer</button>';
      action = '<td><form method="post" action="/admin/appareils" style="display:flex;gap:.4rem"><input type="hidden" name="id" value="' + esc(d.id) + '">' + btns + '</form></td>';
    }
    return '<tr><td>' + esc(d.label) + '<br><span class="muted" style="font-size:.7rem">' + fmtDate(d.created_at) + '</span></td>' +
      '<td>' + esc(d.admin_email) + '</td><td>' + badge + '</td><td class="muted">' + esc(d.approved_by || '') + '</td>' + action + '</tr>';
  }).join('');
  const note = pending ? '<div class="banner" style="background:rgba(200,16,46,.08);border-color:var(--red);color:#9b1c1c">' + pending + ' appareil(s) en attente d\'approbation.</div>' : '';
  return '<h1 class="page">Appareils</h1><p class="sub">Machines de confiance et demandes en attente.</p>' +
    (errMsg ? '<div class="err">' + esc(errMsg) + '</div>' : '') + note +
    '<table>' + head + body + '</table>';
}
function statusTag(s) {
  const map = {
    'to-validate': ['À valider', 'var(--red)', '#fff'],
    'published': ['Publié', 'var(--green)', '#fff'],
    'pending': ['En attente', 'var(--cream)', 'var(--earth)'],
  };
  const m = map[s] || [s || '—', 'var(--cream)', 'var(--earth)'];
  return `<span class="tag" style="background:${m[1]};color:${m[2]}">${esc(m[0])}</span>`;
}

function viewShadowList(data) {
  const head = '<h1 class="page">Shadow List</h1>' +
    '<p class="sub">Comparer l\'original (privé) et la version Hub⁴Fix, puis valider. ' +
    'Rien n\'apparaît côté client tant que tu n\'as pas cliqué « Publier ».</p>';
  if (data.error) return head + dataError(data.error);
  const rows = (data.rows || []).slice();
  if (!rows.length) {
    return head + '<div class="soon">Aucune pièce dans la base pour le moment. ' +
      'Le pipeline les ajoute automatiquement après génération (statut <b>à valider</b>).</div>';
  }
  const order = { 'to-validate': 0, 'published': 1 };
  rows.sort((a, b) => (order[a.status] == null ? 2 : order[a.status]) - (order[b.status] == null ? 2 : order[b.status]));

  const exportBtn = '<a href="/admin/pieces.csv" style="display:inline-block;margin-bottom:1.2rem;font-size:.82rem;font-weight:600;color:var(--earth);text-decoration:none;border:1px solid var(--line);border-radius:7px;padding:.45rem .9rem">⤓ Exporter la base en tableur (CSV)</a>';

  const box = 'flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--cream)';
  const lbl = 'font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--earth);font-weight:600;padding:.4rem .7rem;background:#fff;border-bottom:1px solid var(--line)';
  const img = 'display:block;width:100%;height:210px;object-fit:contain;background:#faf8f5';

  const cards = rows.map((r) => {
    const id = String(r.id || '');
    const enc = id.split('/').map(encodeURIComponent).join('/');
    const isTV = (r.status || '') === 'to-validate';
    const isPub = (r.status || '') === 'published';
    let actions = '';
    if (isTV || isPub) {
      const btn = 'font-family:inherit;font-size:.78rem;font-weight:600;border:none;border-radius:7px;padding:.55rem 1.1rem;cursor:pointer';
      const publish = '<button name="action" value="publish" style="' + btn + ';background:var(--green);color:#fff">Publier</button>';
      const reject = '<button name="action" value="reject" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2">Rejeter</button>';
      actions = '<form method="post" action="/admin/shadowlist" style="display:flex;gap:.6rem;margin-top:.9rem">' +
        '<input type="hidden" name="id" value="' + esc(id) + '">' +
        (isTV ? publish + reject : reject) + '</form>';
    }
    // Canal fichiers 3D : source privé (STL/3MF/STEP) + GLB d'affichage optionnel.
    const isModeled = truthy(r.modeled);
    const fileState =
      (isModeled ? '<span class="tag" style="background:var(--green);color:#fff">Fichier source ✓</span> <a href="/admin/file/' + enc + '" style="font-size:.75rem;color:var(--earth)">télécharger</a>'
                 : '<span class="tag" style="background:var(--cream);color:var(--earth)">Pas de fichier source</span>') +
      (r.model3d ? ' <span class="tag" style="background:var(--green);color:#fff">GLB 3D ✓</span>' : '');
    const inp = 'font-size:.72rem;color:var(--earth)';
    const upload =
      '<details style="margin-top:.8rem;border-top:1px solid var(--line);padding-top:.7rem">' +
        '<summary style="cursor:pointer;font-size:.78rem;font-weight:600;color:var(--earth)">Fichiers 3D — ' + fileState + '</summary>' +
        '<form method="post" action="/admin/upload3d" enctype="multipart/form-data" style="display:grid;gap:.5rem;margin-top:.7rem">' +
          '<input type="hidden" name="id" value="' + esc(id) + '">' +
          '<label style="' + inp + '">Fichier source (privé, jamais distribué) : <input type="file" name="source" accept=".stl,.3mf,.step,.stp,.f3d"></label>' +
          '<label style="' + inp + '">Mesh d\'affichage GLB (visualiseur fiche produit, optionnel) : <input type="file" name="glb" accept=".glb"></label>' +
          '<button style="justify-self:start;font-family:inherit;font-size:.75rem;font-weight:600;border:none;border-radius:7px;padding:.5rem 1rem;cursor:pointer;background:var(--ink);color:#fff">Déposer</button>' +
        '</form>' +
      '</details>';
    return '<div class="card" style="padding:1.1rem 1.2rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:.8rem">' +
        '<div><div style="font-weight:600">' + esc(r.name || id) + '</div>' +
        '<div class="muted" style="font-size:.82rem">' + esc(r.machine || '') + '</div></div>' +
        statusTag(r.status) + '</div>' +
      '<div style="display:flex;gap:.9rem">' +
        '<div style="' + box + '"><div style="' + lbl + '">Original (privé)</div>' +
          '<img style="' + img + '" src="/img/orig/' + enc + '" alt="original" ' +
          'onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'<div style=&quot;padding:2rem;text-align:center;color:#7A7268;font-size:.8rem&quot;>indisponible</div>\')"></div>' +
        '<div style="' + box + '"><div style="' + lbl + '">Version Hub⁴Fix</div>' +
          '<img style="' + img + '" src="/img/h4f/' + enc + '" alt="version H4F" ' +
          'onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'<div style=&quot;padding:2rem;text-align:center;color:#7A7268;font-size:.8rem&quot;>indisponible</div>\')"></div>' +
      '</div>' + actions + upload + '</div>';
  }).join('');

  return head + exportBtn + '<div style="display:grid;gap:1.2rem">' + cards + '</div>';
}

function piecesToCsv(rows) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [PIECE_COLS.join(',')];
  rows.forEach((r) => lines.push(PIECE_COLS.map((c) => q(r[c])).join(',')));
  return lines.join('\r\n');
}

const SECTIONS = {
  '/admin/modeles': () => viewModeles(),
  '/admin/comptabilite': () => viewSoon('Comptabilité', 'Paiements et reversements.',
    'À venir : accès <b>comptabilité</b> aux données de paiement (via le Prestataire de Services de Paiement), réservé aux rôles autorisés.'),
  '/admin/journal': () => viewSoon("Journal d'audit", 'Traçabilité des actions.',
    'À venir : <b>journal</b> des connexions, approbations d\'appareils et actions sensibles.'),
};

// ============================ ROUTAGE ============================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const redirectUri = origin + '/auth/callback';
    const path = url.pathname;

    // 1) Démarrer la connexion
    if (path === '/auth/login') {
      const d = await discovery(env);
      const { verifier, challenge } = await pkce();
      const state = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
      const nonce = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
      const tmp = await makeToken(env.SESSION_SECRET, { v: verifier, st: state, n: nonce, exp: Math.floor(Date.now() / 1000) + TMP_TTL });
      const a = new URL(d.authorization_endpoint);
      a.searchParams.set('client_id', env.CLIENT_ID);
      a.searchParams.set('redirect_uri', redirectUri);
      a.searchParams.set('response_type', 'code');
      a.searchParams.set('scope', SCOPES);
      a.searchParams.set('state', state);
      a.searchParams.set('nonce', nonce);
      a.searchParams.set('code_challenge', challenge);
      a.searchParams.set('code_challenge_method', 'S256');
      return new Response(null, { status: 302, headers: { Location: a.toString(), 'Set-Cookie': setCookie('h4f_tmp', tmp, TMP_TTL) } });
    }

    // 2) Retour de Zitadel
    if (path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const tmp = await readToken(env.SESSION_SECRET, getCookie(request, 'h4f_tmp'));
      if (!code || !tmp || tmp.st !== state) {
        return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Connexion expirée ou invalide. <a href="/auth/login">Réessayer</a></p>', 400);
      }
      const d = await discovery(env);
      const tr = await fetch(d.token_endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env.CLIENT_ID, code_verifier: tmp.v }),
      });
      if (!tr.ok) {
        return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Échec de l\'échange du jeton. <a href="/auth/login">Réessayer</a></p>', 502);
      }
      const tok = await tr.json();
      const ui = await fetch(d.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tok.access_token } });
      const info = await ui.json();
      const email = (info.email || '').toLowerCase().trim();
      const allow = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
      if (!email || !allow.includes(email)) {
        const h = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
        h.append('Set-Cookie', killCookie('h4f_session'));
        return new Response(
          '<!doctype html><meta charset=utf-8><div style="font-family:sans-serif;max-width:520px;margin:4rem auto;text-align:center">' +
          '<h2>Accès refusé</h2><p>Le compte <b>' + esc(email || 'inconnu') + '</b> n\'est pas autorisé sur l\'espace admin Hub4Fix.</p>' +
          '<p><a href="/auth/logout">Se déconnecter</a></p></div>',
          { status: 403, headers: h }
        );
      }
      const fullName = ((info.given_name || '') + ' ' + (info.family_name || '')).trim();
      const name = fullName || info.name || email;
      const role = await loginAdmin(env, info.sub, email, name);

      const h = new Headers();
      h.append('Set-Cookie', killCookie('h4f_tmp'));

      // Garde d'appareil (seulement si la base D1 est connectée).
      if (env.DB) {
        const dev = await resolveDevice(env, email, getCookie(request, 'h4f_device'), request);
        if (dev.id) h.append('Set-Cookie', setCookie('h4f_device', dev.id, 60 * 60 * 24 * 365));
        if (dev.status !== 'approved') {
          h.append('Content-Type', 'text/html; charset=utf-8');
          h.append('Cache-Control', 'no-store');
          return new Response(pendingPage(dev.id, dev.label || deviceLabel(request)), { status: 200, headers: h });
        }
      }

      const sess = await makeToken(env.SESSION_SECRET, {
        sub: info.sub, email, name, role,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
      });
      h.append('Set-Cookie', setCookie('h4f_session', sess, SESSION_TTL));
      h.append('Location', '/admin');
      return new Response(null, { status: 302, headers: h });
    }

    // 3) Déconnexion
    if (path === '/auth/logout') {
      const d = await discovery(env);
      const h = new Headers();
      h.append('Set-Cookie', killCookie('h4f_session'));
      let loc = origin + '/';
      if (d.end_session_endpoint) {
        const e = new URL(d.end_session_endpoint);
        e.searchParams.set('post_logout_redirect_uri', origin + '/');
        e.searchParams.set('client_id', env.CLIENT_ID);
        loc = e.toString();
      }
      h.append('Location', loc);
      return new Response(null, { status: 302, headers: h });
    }

    // 3 bis) Approbation d'appareil par code de secours (récupération / solo)
    if (path === '/admin/device/approve') {
      const id = url.searchParams.get('id');
      const k = url.searchParams.get('k');
      if (env.DB && id && k && env.BOOTSTRAP_SECRET && k === env.BOOTSTRAP_SECRET) {
        await env.DB.prepare("UPDATE devices SET status='approved', approved_by='bootstrap' WHERE id=?").bind(id).run();
        await audit(env, 'bootstrap', 'device-approve', id);
        return htmlResponse('<!doctype html><meta charset=utf-8><div style="font-family:sans-serif;text-align:center;margin-top:4rem"><h2>Appareil approuvé</h2><p>Tu peux maintenant <a href="/auth/login">te connecter</a>.</p></div>');
      }
      return htmlResponse('<!doctype html><meta charset=utf-8><div style="font-family:sans-serif;text-align:center;margin-top:4rem">Lien invalide.</div>', 400);
    }

    // 3 ter) API publique « Pièces » (pas de session : token pipeline ou lecture publique)
    if (path === '/api/pieces' && request.method === 'POST') return apiPiecesPost(request, env);
    if (path === '/api/wishlist' && request.method === 'POST') return apiWishlistPost(request, env);
    if (path === '/api/pieces.json') return apiPiecesJson(env);
    if (path.startsWith('/img/h4f/')) return serveR2(env, 'h4f/' + decodeURIComponent(path.slice('/img/h4f/'.length)));
    // Mesh d'affichage GLB (lecture seule, public) — CORS requis pour model-viewer sur hub4fix.com.
    if (path.startsWith('/model/')) {
      return serveR2(env, 'glb/' + decodeURIComponent(path.slice('/model/'.length)),
        { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' });
    }

    // 4) Zone protégée
    const sess = await readToken(env.SESSION_SECRET, getCookie(request, 'h4f_session'));
    if (!sess) {
      return htmlResponse(
        '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
        '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:5rem auto;text-align:center;color:#1C1A18">' +
        '<h1 style="font-weight:500">Hub<sup>4</sup>Fix — Admin</h1>' +
        '<p style="color:#7A7268">Espace réservé aux administrateurs.</p>' +
        '<a href="/auth/login" style="display:inline-block;margin-top:1rem;background:#C8102E;color:#fff;text-decoration:none;padding:.8rem 1.6rem;border-radius:6px;font-weight:600">Se connecter</a>' +
        '</div>'
      );
    }

    const seen = getCookie(request, 'h4f_seen');

    // Image originale (privée) — réservée aux admins connectés (pas de cache Sheet).
    if (path.startsWith('/img/orig/')) return serveR2(env, 'orig/' + decodeURIComponent(path.slice('/img/orig/'.length)));

    // Base « Pièces » chargée une fois : sert le compteur "à valider" (badge + bandeau,
    // visibles sur toutes les sections) et la section Shadow List.
    const pdata = await loadPieces(env);
    const toValidate = pdata.error ? 0 : countToValidate(pdata.rows);

    // Fichier source 3D : upload (POST) et téléchargement (GET) — admin connecté uniquement.
    if (request.method === 'POST' && path === '/admin/upload3d') {
      return adminUpload3d(request, env, sess);
    }
    if (path.startsWith('/admin/file/')) {
      const id = decodeURIComponent(path.slice('/admin/file/'.length));
      const obj = env.PIECES_R2 ? await env.PIECES_R2.get('src/' + id) : null;
      if (!obj) return new Response('Aucun fichier source pour cette pièce.', { status: 404 });
      const fname = (obj.customMetadata && obj.customMetadata.filename) || id.replace(/\//g, '_') + '.stl';
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="' + fname.replace(/"/g, '') + '"',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Shadow List : validation (POST publish/reject) puis affichage (GET).
    if (request.method === 'POST' && path === '/admin/shadowlist') {
      const form = await request.formData();
      const id = (form.get('id') || '').toString();
      const action = (form.get('action') || '').toString();
      if (id && action === 'publish') {
        await patchPiece(env, id, { status: 'published', validatedBy: sess.email, validatedAt: nowIso() });
        await audit(env, sess.email, 'piece-publish', id);
      } else if (id && action === 'reject') {
        await patchPiece(env, id, { status: 'pending', validatedBy: sess.email, validatedAt: nowIso() });
        await audit(env, sess.email, 'piece-reject', id);
      }
      return new Response(null, { status: 302, headers: { Location: '/admin/shadowlist' } });
    }
    if (path === '/admin/shadowlist') {
      return shell('/admin/shadowlist', sess, viewShadowList(pdata), 0, toValidate);
    }
    if (path === '/admin/pieces.csv') {
      const csv = pdata.error ? '' : piecesToCsv(pdata.rows);
      return new Response('﻿' + csv, {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hub4fix-pieces.csv"', 'Cache-Control': 'no-store' },
      });
    }

    // POST : changement de rôle (réservé au rôle admin)
    if (request.method === 'POST' && path === '/admin/admins') {
      if (sess.role !== 'admin') return new Response('Interdit', { status: 403 });
      const form = await request.formData();
      const targetEmail = (form.get('email') || '').toString().toLowerCase().trim();
      const newRole = (form.get('role') || '').toString();
      if (targetEmail && ROLES.includes(newRole)) await setRole(env, targetEmail, newRole, sess.email);
      return new Response(null, { status: 302, headers: { Location: '/admin/admins' } });
    }

    // Administrateurs (liste + rôles, depuis D1)
    if (path === '/admin/admins') {
      const admins = await listAdmins(env);
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell('/admin/admins', sess, viewAdmins(admins, sess), newCount, toValidate);
    }

    // Appareils : approbation / révocation (POST réservé admin), liste (GET)
    if (request.method === 'POST' && path === '/admin/appareils') {
      if (sess.role !== 'admin') return new Response('Interdit', { status: 403 });
      const form = await request.formData();
      const id = (form.get('id') || '').toString();
      const action = (form.get('action') || '').toString();
      let msg = '';
      if (id && action === 'approve') { const r = await approveDevice(env, id, sess.email); if (!r.ok) msg = r.msg; }
      else if (id && action === 'revoke') { await revokeDevice(env, id, sess.email); }
      return new Response(null, { status: 302, headers: { Location: '/admin/appareils' + (msg ? '?e=' + encodeURIComponent(msg) : '') } });
    }
    if (path === '/admin/appareils') {
      const devices = await listDevices(env);
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell('/admin/appareils', sess, viewDevices(devices, sess, url.searchParams.get('e')), newCount, toValidate);
    }

    // Tableau de bord
    if (path === '/' || path === '/admin') {
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell('/admin', sess, viewDashboard(sess, data, seen, toValidate), newCount, toValidate);
    }

    // Inscriptions : marque comme "vues" (met à jour le repère) après affichage
    if (path === '/admin/inscriptions') {
      const data = await loadInscriptions(env);
      data.seen = seen;
      const resp = shell('/admin/inscriptions', sess, viewInscriptions(data), 0, toValidate);
      // après consultation, on déplace le repère "dernière visite" à maintenant
      resp.headers.append('Set-Cookie', setCookie('h4f_seen', new Date().toISOString(), SEEN_TTL));
      return resp;
    }

    if (SECTIONS[path]) {
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell(path, sess, SECTIONS[path](), newCount, toValidate);
    }

    return new Response(null, { status: 302, headers: { Location: '/admin' } });
  },
};
