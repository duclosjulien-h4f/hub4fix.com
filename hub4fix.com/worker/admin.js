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
 *   SHEET_ID        = <votre-sheet-id-ici>
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
    const rows = v.slice(1)
      .map((a) => { const o = {}; header.forEach((h, i) => (o[h] = a[i] || '')); return o; })
      .filter((o) => !o['supprime_le']); // masque les inscriptions supprimées (soft-delete)
    rows.reverse(); // plus récentes en premier
    return { rows };
  } catch { return { error: 'exception' }; }
}
// Colonne "supprime_le" : marquage (pas de suppression physique) + la ligne est
// deplacee en fin de feuille pour ne pas gener la lecture des inscriptions actives.
function colLetter(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
async function markInscriptionDeleted(env, type, email) {
  const tab = env.SHEET_TAB || 'Inscriptions';
  const token = await googleToken(env);
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(tab)}`;
  const r = await fetch(readUrl, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('sheets read ' + r.status);
  const values = (await r.json()).values || [];
  if (!values.length) return { error: 'empty' };

  let header = values[0].slice();
  let delCol = header.findIndex((h) => h === 'supprime_le');
  if (delCol === -1) { header.push('supprime_le'); delCol = header.length - 1; }
  const width = header.length;
  const pad = (row) => { const a = row.slice(0, width); while (a.length < width) a.push(''); return a; };

  const emailLower = String(email || '').toLowerCase().trim();
  const rows = values.slice(1).map(pad);
  const idx = rows.findIndex((row) => row[1] === type && (row[2] || '').toLowerCase().trim() === emailLower && !row[delCol]);
  if (idx === -1) return { error: 'not-found' };

  const [match] = rows.splice(idx, 1);
  match[delCol] = new Date().toISOString();
  rows.push(match); // en fin de liste

  const outValues = [header, ...rows];
  const range = `${tab}!A1:${colLetter(width)}${outValues.length}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const w = await fetch(writeUrl, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: outValues }),
  });
  if (!w.ok) throw new Error('sheets write ' + w.status);
  return { ok: true };
}

// Nettoyage en masse : toutes les lignes marquees test=true (et pas deja
// supprimees) sont marquees "supprime_le" et deplacees en fin de feuille, en
// une seule ecriture.
async function markAllTestDeleted(env) {
  const tab = env.SHEET_TAB || 'Inscriptions';
  const token = await googleToken(env);
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(tab)}`;
  const r = await fetch(readUrl, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('sheets read ' + r.status);
  const values = (await r.json()).values || [];
  if (!values.length) return { ok: true, count: 0 };

  let header = values[0].slice();
  let delCol = header.findIndex((h) => h === 'supprime_le');
  if (delCol === -1) { header.push('supprime_le'); delCol = header.length - 1; }
  let testCol = header.findIndex((h) => h === 'test');
  const width = header.length;
  const pad = (row) => { const a = row.slice(0, width); while (a.length < width) a.push(''); return a; };

  const rows = values.slice(1).map(pad);
  if (testCol === -1) return { ok: true, count: 0 };

  const kept = [], toDelete = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    if (truthy(row[testCol]) && !row[delCol]) { row[delCol] = now; toDelete.push(row); }
    else kept.push(row);
  }
  if (!toDelete.length) return { ok: true, count: 0 };

  const outValues = [header, ...kept, ...toDelete];
  const range = `${tab}!A1:${colLetter(width)}${outValues.length}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  const w = await fetch(writeUrl, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: outValues }),
  });
  if (!w.ok) throw new Error('sheets write ' + w.status);
  return { ok: true, count: toDelete.length };
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
  // nouvelles colonnes en FIN uniquement : la migration d'en-tête ajoute en queue
  'rejectReason',
  'regenHint', // précision donnée par l'admin à l'IA pour la régénération
  // score + preuve explicative en Shadow List (2026-08-11) — voir genimg/ingest_veille.py
  'priority_score', 'occurrences', 'sourceDomains', 'tier',
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

// Migration d'en-tête : si PIECE_COLS a gagné des colonnes (ajoutées en FIN),
// met à jour la ligne 1 du Sheet pour que les nouvelles colonnes soient écrites.
async function syncHeader(env, tab, v) {
  const cur = v[0] || [];
  if (cur.length >= PIECE_COLS.length) return cur;
  if (!PIECE_COLS.slice(0, cur.length).every((c, i) => c === cur[i])) return cur; // ordre inconnu : ne pas toucher
  await sheetsWrite(env, 'update', `${tab}!A1`, [PIECE_COLS]);
  v[0] = PIECE_COLS.slice();
  return v[0];
}

// Upsert par id. Les champs vides entrants ne SUPPRIMENT pas une valeur existante
// (permet de compléter la fiche technique à la main dans le Sheet sans être écrasé).
async function upsertPiece(env, piece) {
  const tab = piecesTab(env);
  let v = [];
  try { v = await sheetsValues(env, tab); } catch { v = []; }
  if (!v.length) { await sheetsWrite(env, 'append', tab, [PIECE_COLS]); v = [PIECE_COLS]; }
  const header = await syncHeader(env, tab, v);
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
  const header = await syncHeader(env, tab, v);
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

// POST /admin/replace-original — dépose/remplace la référence privée (orig/<id>)
// quand aucune photo isolée n'existe (seule une photo d'assemblage complet a
// été trouvée -> l'admin la recadre côté navigateur avant envoi ; ou l'admin
// a pris sa propre photo d'une pièce réelle -> rétro-conception). Le crop
// lui-même est 100% côté client (canvas) : le worker ne reçoit qu'un fichier
// image, jamais de traitement d'image côté serveur. Réutilise regenerateCloud()
// telle quelle -- même chemin que le bouton Régénérer, aucune nouvelle logique
// de génération.
async function adminReplaceOriginal(request, env, sess, ctx) {
  let form;
  try { form = await request.formData(); } catch { return new Response('Formulaire invalide', { status: 400 }); }
  const id = (form.get('id') || '').toString();
  if (!id) return new Response('id manquant', { status: 400 });
  const img = form.get('image');
  if (!img || !img.arrayBuffer || !img.type || !img.type.startsWith('image/')) {
    return new Response('Fichier image requis', { status: 400 });
  }
  await r2Put(env, 'orig/' + id, await img.arrayBuffer(), img.type);
  await audit(env, sess.email, 'piece-original-replaced', id);
  if (env.GEMINI_API_KEY && env.PIECES_R2) {
    const row = (await loadPieces(env)).rows?.find?.((r) => r.id === id);
    const bg = regenerateCloud(env, id, row?.regenHint || '');
    if (ctx && ctx.waitUntil) ctx.waitUntil(bg); else await bg;
  }
  return new Response(null, { status: 302, headers: { Location: '/admin/shadowlist' } });
}

// ---- Régénération cloud (immédiate) : le worker appelle Gemini lui-même ----
// Déclenchée en tâche de fond (ctx.waitUntil) au clic « Régénérer » : l'admin
// continue de valider pendant que l'image se refait (~10-25 s). Si l'appel
// échoue, la pièce reste en 'regenerate' et le pipeline local la reprendra.
function b64FromBuf(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function b64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function geminiGenerate(env, prompt, imgBuf, mime) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash-image';
  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || 'image/png', data: b64FromBuf(imgBuf) } }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('gemini HTTP ' + r.status);
  const j = await r.json();
  for (const c of j.candidates || []) {
    for (const p of (c.content || {}).parts || []) {
      const blob = p.inline_data || p.inlineData;
      if (blob && blob.data) return b64ToBuf(blob.data);
    }
  }
  throw new Error('gemini: aucune image dans la reponse');
}
async function regenerateCloud(env, id, hint) {
  try {
    const orig = await env.PIECES_R2.get('orig/' + id);
    if (!orig) throw new Error('pas d\'original dans R2');
    const promptObj = await env.PIECES_R2.get('config/prompt-hotlist.txt');
    if (!promptObj) throw new Error('prompt config/prompt-hotlist.txt absent de R2');
    let prompt = await promptObj.text();
    if (hint) prompt += '\n\nAdmin guidance for this specific piece (must be respected): ' + hint;
    const mime = (orig.httpMetadata && orig.httpMetadata.contentType) || 'image/png';
    const out = await geminiGenerate(env, prompt, await orig.arrayBuffer(), mime);
    await r2Put(env, 'h4f/' + id, out, 'image/png');
    await patchPiece(env, id, { status: 'to-validate' });
    await audit(env, 'cloud-regen', 'piece-regen-done', id);
  } catch (e) {
    // la pièce reste en 'regenerate' -> le pipeline local prendra le relais
    await audit(env, 'cloud-regen', 'piece-regen-fail', id + ' — ' + String(e).slice(0, 150));
  }
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

// GET /api/pieces/regen — ids dont l'admin a demandé la régénération du visuel
// (non-correspondance original/H4F). Réservé au pipeline (Bearer PIPELINE_TOKEN).
async function apiPiecesRegen(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.PIPELINE_TOKEN || token !== env.PIPELINE_TOKEN) return json({ error: 'unauthorized' }, 401);
  const data = await loadPieces(env);
  if (data.error) return json({ ids: [], items: [], verify: [] });
  const rows = data.rows.filter((r) => (r.status || '') === 'regenerate');
  const verify = data.rows.filter((r) => (r.status || '') === 'verify-original');
  return json({
    ids: rows.map((r) => r.id),
    items: rows.map((r) => ({ id: r.id, hint: r.regenHint || '' })),
    // originaux à re-sourcer (commande /source) : le pipeline invalide la
    // référence locale et repasse la pièce dans la découverte
    verify: verify.map((r) => ({ id: r.id, hint: r.regenHint || '' })),
  });
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
  { path: '/admin/modelisateurs', label: 'Candidatures partenaire', roles: ['admin', 'sous-admin'] },
  { path: '/admin/reservations', label: 'Réservations', roles: ['admin', 'sous-admin'] },
  { path: '/admin/depot', label: 'Dépôt interne', roles: ['admin', 'sous-admin'] },
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
/* Pense-bête des commandes du champ note (bulle +) */
.cmd-help{display:inline-block}
.cmd-help summary{list-style:none;cursor:pointer;width:27px;height:27px;border-radius:50%;border:1px solid var(--line);background:#fff;color:var(--earth);font-weight:700;font-size:1rem;line-height:25px;text-align:center;user-select:none}
.cmd-help summary::-webkit-details-marker{display:none}
.cmd-help summary:hover{background:var(--cream);color:var(--ink)}
.cmd-help[open] summary{background:var(--ink);color:#fff;border-color:var(--ink)}
.cmd-panel{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:min(360px,100%);background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 14px 36px rgba(0,0,0,.14);padding:.9rem 1.05rem;font-size:.78rem;line-height:1.55}
.cmd-panel h4{font-size:.7rem;letter-spacing:.07em;text-transform:uppercase;color:var(--earth);margin:.55rem 0 .25rem}
.cmd-panel h4:first-child{margin-top:0}
.cmd-panel .row{display:flex;gap:.55rem;align-items:baseline;margin:.2rem 0}
.cmd-panel code{flex:0 0 auto;background:var(--cream);border-radius:4px;padding:.05rem .4rem;font-size:.7rem;white-space:nowrap}
.cmd-panel .row span{color:var(--ink)}
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

function shell(activePath, sess, content, newCount, toValidate, pendingModelers) {
  const role = sess.role || 'admin';
  const items = NAV.filter((n) => n.roles.includes(role))
    .map((n) => {
      let badge = '';
      if (n.path === '/admin/inscriptions' && newCount > 0) badge = `<span class="pill">${newCount}</span>`;
      else if (n.path === '/admin/shadowlist' && toValidate > 0) badge = `<span class="pill">${toValidate}</span>`;
      else if (n.path === '/admin/modelisateurs' && pendingModelers > 0) badge = `<span class="pill">${pendingModelers}</span>`;
      return `<a href="${n.path}"${n.path === activePath ? ' class="active"' : ''}><span>${esc(n.label)}</span>${badge}</a>`;
    }).join('');
  return htmlResponse(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub4Fix — Admin</title>' +
    '<link rel="icon" type="image/svg+xml" href="https://hub4fix.com/favicon-admin.svg">' +
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

function viewInscriptions(data, flash) {
  const banner = flash ? '<div class="banner">' + esc(flash) + '</div>' : '';
  if (data.error) {
    return '<h1 class="page">Inscriptions</h1><p class="sub">Printers, modélisateurs et clients.</p>' + banner + dataError(data.error);
  }
  const rows = data.rows;
  if (!rows.length) {
    return '<h1 class="page">Inscriptions</h1><p class="sub">Printers, modélisateurs et clients.</p>' + banner + '<div class="soon">Aucune inscription pour le moment.</div>';
  }
  const seen = data.seen;
  const delBtn = 'font-family:inherit;font-size:.72rem;font-weight:600;border:1px solid #f3c2c2;background:#fff;color:var(--red);border-radius:6px;padding:.3rem .6rem;cursor:pointer';
  const head = '<tr><th>Date</th><th>Type</th><th>Nom</th><th>Email</th><th>Ville</th><th>Téléphone</th><th>Détail</th><th></th></tr>';
  const body = rows.map((r) => {
    const isNew = seen && (r.date || '') > seen;
    const type = (r.type || '').toLowerCase();
    const nom = esc(r.name || ((r.prenom || '') + ' ' + (r.nom || '')).trim());
    const detail = type === 'printer' ? (r.parc_machines || r.materiaux || '')
      : type === 'modelisateur' ? (r.logiciels || r.portfolio || '')
      : (r.message || '');
    // Suppression (soft-delete par type+email) : form POST + confirmation, ligne archivée dans le Sheet.
    const del = '<form method="post" action="/admin/inscriptions/supprimer" style="margin:0" onsubmit="return confirm(\'Supprimer cette inscription de la liste ? Elle est archivée (colonne supprime_le), pas effacée du Sheet.\')">' +
      '<input type="hidden" name="type" value="' + esc(r.type || '') + '">' +
      '<input type="hidden" name="email" value="' + esc(r.email || '') + '">' +
      '<button type="submit" style="' + delBtn + '">Supprimer</button></form>';
    return '<tr' + (isNew ? ' class="is-new"' : '') + '>' +
      '<td>' + fmtDate(r.date) + (isNew ? ' <span class="tag" style="background:var(--green);color:#fff">nouveau</span>' : '') + '</td>' +
      '<td><span class="tag ' + esc(type) + '">' + esc(r.type || '?') + '</span></td>' +
      '<td>' + nom + '</td>' +
      '<td>' + esc(r.email) + '</td>' +
      '<td>' + esc(r.ville) + '</td>' +
      '<td>' + esc(r.tel) + '</td>' +
      '<td class="muted">' + esc(String(detail).slice(0, 80)) + '</td>' +
      '<td>' + (r.email ? del : '') + '</td>' +
      '</tr>';
  }).join('');
  return '<h1 class="page">Inscriptions</h1><p class="sub">' + rows.length + ' inscription' + (rows.length > 1 ? 's' : '') + ' — les plus récentes en premier.</p>' +
    banner + '<table>' + head + body + '</table>';
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
// ==================== Modèles 3D : examen des fichiers déposés ====================
// Les soumissions vivent dans h4f_partner (écrites par h4f-partner) ; les fichiers
// dans le bucket h4f-submissions, lu ici par binding.

async function loadSubmissions(env) {
  if (!env.DB_PARTNER) return { error: 'no_binding' };
  try {
    const r = await env.DB_PARTNER.prepare(
      'SELECT s.*, p.email FROM submissions s ' +
      "LEFT JOIN partners p ON p.user_id = s.user_id AND p.type = 'modelisateur' " +
      "ORDER BY CASE s.status WHEN 'review' THEN 0 WHEN 'accepted' THEN 1 WHEN 'prepared' THEN 2 " +
      "WHEN 'published' THEN 3 ELSE 4 END, s.created_at DESC LIMIT 200"
    ).all();
    return { rows: (r && r.results) || [] };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

// Trois verbes distincts, trois intentions distinctes :
//   accept   -> le fichier est bon, il part en préparation (conversion 3MF).
//   correct  -> il est corrigeable : on REND 72 h au modélisateur, avec la consigne.
//               Il pourra déposer une version 2. La cession de la version refusée est
//               résolue (CGV art. 2.5), celle de la v2 sera un acte neuf.
//   discard  -> non corrigeable : la pièce retourne au pot commun.
// Confondre « corrige-moi ça » et « on arrête » dans un seul bouton « refuser »
// forcerait à deviner l'intention à la lecture du motif.
async function decideSubmission(env, subId, action, note, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée.' };
  const sub = await env.DB_PARTNER.prepare('SELECT id, reservation_id, piece_id, status FROM submissions WHERE id = ?')
    .bind(subId).first();
  if (!sub) return { ok: false, msg: 'Soumission introuvable.' };
  if (sub.status !== 'review') return { ok: false, msg: 'Ce dossier a déjà été tranché (' + sub.status + ').' };
  const ts = nowIso();
  const trimmed = String(note || '').trim().slice(0, 1000);

  if (action === 'accept') {
    await env.DB_PARTNER.prepare(
      "UPDATE submissions SET status = 'accepted', review_note = ?, decided_at = ?, decided_by = ? WHERE id = ?"
    ).bind(trimmed, ts, adminEmail || '', subId).run();
    await audit(env, adminEmail, 'submission_acceptee', sub.piece_id + ' — ' + subId);
    return { ok: true, msg: 'Fichier accepté. Reste la préparation du 3MF.' };
  }

  if (action === 'correct') {
    if (trimmed.length < 10) return { ok: false, msg: 'Écris la consigne de correction : sans elle, le modélisateur ne sait pas quoi reprendre.' };
    await env.DB_PARTNER.prepare(
      "UPDATE submissions SET status = 'rejected', review_note = ?, decided_at = ?, decided_by = ? WHERE id = ?"
    ).bind(trimmed, ts, adminEmail || '', subId).run();
    // Nouvelle fenêtre de 72 h, ancrée sur maintenant. La prolongation déjà consommée
    // reste consommée : la correction n'est pas une occasion de la récupérer.
    await env.DB_PARTNER.prepare(
      "UPDATE reservations SET status = 'active', validated_at = ?, expires_at = ? WHERE id = ?"
    ).bind(ts, new Date(Date.now() + WORK_WINDOW_MS).toISOString(), sub.reservation_id).run();
    await audit(env, adminEmail, 'submission_correction', sub.piece_id + ' — ' + subId + ' — ' + trimmed.slice(0, 120));
    return { ok: true, msg: 'Correction demandée : 72 h de plus pour déposer une version 2.' };
  }

  if (action === 'discard') {
    await env.DB_PARTNER.prepare(
      "UPDATE submissions SET status = 'rejected', review_note = ?, decided_at = ?, decided_by = ? WHERE id = ?"
    ).bind(trimmed, ts, adminEmail || '', subId).run();
    // La pièce est libérée immédiatement : expires_at dans le passé suffit, toutes les
    // lectures filtrent dessus (expiration paresseuse, cf. partner.js).
    await env.DB_PARTNER.prepare(
      "UPDATE reservations SET status = 'cancelled', expires_at = ? WHERE id = ?"
    ).bind(ts, sub.reservation_id).run();
    await audit(env, adminEmail, 'submission_ecartee', sub.piece_id + ' — ' + subId + ' — ' + trimmed.slice(0, 120));
    return { ok: true, msg: 'Fichier écarté, pièce rendue à la Hot List.' };
  }
  return { ok: false, msg: 'Action inconnue.' };
}

// ==================== Dépôt interne (/admin/depot) ====================
// Accès direct : une page, un formulaire, pas besoin de retrouver la pièce dans la
// Shadow List. Écrit dans la MÊME table `submissions` que le tunnel modélisateur —
// deux portes, une seule chaîne en aval (examen, conversion, publication).

const DEPOT_MESH_EXTS = ['.3mf', '.stl'];
const DEPOT_STEP_EXTS = ['.step', '.stp'];
const DEPOT_MAX_BYTES = 25 * 1024 * 1024;
const DEPOT_CESSION_VERSION = 'cgv-modelisateurs-2026-08';

function depotExt(name) { const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/); return m ? m[0] : ''; }
async function depotSha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Deux fichiers portent le nom « 3MF » et n'ont PAS le même aval (vocabulaire du
// 09/08/2026) :
//   3MF SOURCE — géométrie seule. Il lui manque encore un profil machine pour devenir
//                slicable : la préparation n'est pas terminée.
//   3MF MASTER — porte déjà les réglages de slicing. Slicable en l'état.
// Confondre les deux ferait injecter un profil dans un fichier qui en a déjà un, ou
// envoyer au slicer un fichier qui n'en a aucun. On ne demande donc pas à l'admin de
// nous le dire : on le lit dans le fichier.
//
// Un 3MF est un zip, et les NOMS d'entrées y sont stockés en clair (jamais compressés).
// Chercher le chemin du fichier de réglages suffit — inutile de dérouler le zip. C'est
// le même test que `detect_dialect()` du PoC, qui compare les noms d'entrées.
const MF_CONFIG_ENTRIES = ['Metadata/project_settings.config', 'Metadata/Slic3r_PE.config'];
function bytesContain(hay, needle) {
  const n = needle.length;
  outer: for (let i = 0; i + n <= hay.length; i++) {
    for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
function detect3mfKind(buf) {
  const bytes = new Uint8Array(buf);
  // Signature zip « PK\x03\x04 ». Absente = ce n'est pas un 3MF exploitable, et on ne
  // prétend pas savoir ce que c'est.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return 'indetermine';
  }
  const enc = new TextEncoder();
  for (const entry of MF_CONFIG_ENTRIES) {
    if (bytesContain(bytes, enc.encode(entry))) return '3mf-master';
  }
  return '3mf-source';
}

// POST /admin/depot — dépôt interne. Renvoie { ok, msg } ; le routeur redirige avec le
// message. Toute sortie en erreur laisse la base ET le stockage inchangés.
async function handleDepot(env, form, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée (DB_PARTNER).' };
  if (!env.SUBMIT_R2) return { ok: false, msg: 'Stockage non lié (SUBMIT_R2).' };

  const pieceId = String(form.get('piece_id') || '').trim();
  if (!pieceId) return { ok: false, msg: 'Choisis une pièce.' };
  const mode = form.get('mode') === 'maillage' ? 'maillage' : 'cao';
  const origines = ['interne', 'hors-tunnel', 'repair-together'];
  const origine = origines.includes(String(form.get('origine'))) ? String(form.get('origine')) : 'interne';

  // Auteur tiers : l'acte de cession existe hors plateforme, on garde de quoi le
  // retrouver. Sans date ni référence, il ne vaut rien le jour où il est contesté
  // (cession horodatée fichier par fichier, art. L.131-1 CPI / CGV art. 2.1).
  const authorName = String(form.get('author_name') || '').trim().slice(0, 200);
  const cessionRef = String(form.get('cession_ref') || '').trim().slice(0, 400);
  let cessionAt = String(form.get('cession_at') || '').trim();
  if (origine === 'hors-tunnel') {
    if (!authorName) return { ok: false, msg: 'Nomme l\'auteur du fichier : sans lui, la cession ne se rattache à personne.' };
    if (!cessionAt) return { ok: false, msg: 'Donne la date de l\'acte de cession signé par l\'auteur.' };
    if (!cessionRef) return { ok: false, msg: 'Indique où retrouver l\'acte (référence du mail, nom du PDF signé…).' };
    // <input type="date"> renvoie AAAA-MM-JJ : on le normalise en horodatage.
    const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(cessionAt) ? cessionAt + 'T12:00:00Z' : cessionAt);
    if (isNaN(parsed)) return { ok: false, msg: 'Date de cession illisible.' };
    if (parsed > Date.now() + 86400000) return { ok: false, msg: 'La date de cession est dans le futur.' };
    cessionAt = new Date(parsed).toISOString();
  } else {
    // Interne ou Repair Together : H4F détient déjà les droits, l'acte est ce dépôt.
    cessionAt = nowIso();
  }

  // Fichiers. En mode CAO, deux ; en mode maillage, un seul (le stock existant). Le
  // fichier principal arrive par le même champ dans les deux cas : c'est le mode qui dit
  // comment le lire, pas deux champs à choisir.
  const main = form.get('fichier');
  if (!main || typeof main.arrayBuffer !== 'function' || !main.name) {
    return { ok: false, msg: mode === 'maillage' ? 'Choisis le fichier maillage.' : 'Choisis le fichier source (CAO).' };
  }
  const mainExt = depotExt(main.name);
  if (!main.size) return { ok: false, msg: 'Le fichier ' + main.name + ' est vide.' };
  if (main.size > DEPOT_MAX_BYTES) {
    return { ok: false, msg: main.name + ' pèse ' + Math.round(main.size / 1048576) + ' Mo : maximum ' + Math.round(DEPOT_MAX_BYTES / 1048576) + ' Mo.' };
  }
  let step = null;
  if (mode === 'maillage') {
    if (!DEPOT_MESH_EXTS.includes(mainExt)) {
      return { ok: false, msg: 'En mode maillage, le fichier doit être un ' + DEPOT_MESH_EXTS.join(' ou un ') + ' (reçu : ' + (mainExt || 'sans extension') + ').' };
    }
  } else {
    if (DEPOT_MESH_EXTS.includes(mainExt)) {
      return { ok: false, msg: 'Un ' + mainExt + ' est un maillage : bascule sur « maillage déjà prêt », ou dépose le fichier CAO et son STEP.' };
    }
    if (!mainExt) return { ok: false, msg: 'Le fichier source doit porter son extension d\'origine.' };
    step = form.get('step');
    if (!step || typeof step.arrayBuffer !== 'function' || !step.name) {
      return { ok: false, msg: 'Le STEP est obligatoire en mode CAO : c\'est lui que la conversion haute résolution consomme.' };
    }
    if (!DEPOT_STEP_EXTS.includes(depotExt(step.name))) {
      return { ok: false, msg: 'Le second fichier doit être un STEP (' + DEPOT_STEP_EXTS.join(' ou ') + ').' };
    }
    if (!step.size) return { ok: false, msg: 'Le STEP est vide.' };
    if (step.size > DEPOT_MAX_BYTES) return { ok: false, msg: 'Le STEP pèse trop lourd (max ' + Math.round(DEPOT_MAX_BYTES / 1048576) + ' Mo).' };
  }

  // Version comptée par PIÈCE : le canal interne et le tunnel partagent la numérotation.
  const last = await env.DB_PARTNER.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM submissions WHERE piece_id = ?')
    .bind(pieceId).first();
  const version = ((last && last.v) || 0) + 1;

  const id = crypto.randomUUID();
  // « natif » et non « source » : « source » est réservé au 3MF SOURCE que la conversion
  // produira (`submissions/<id>/source.3mf`). Deux choses différentes ne peuvent pas
  // porter le même nom dans le même dossier.
  const mainKey = 'submissions/' + id + '/natif' + mainExt;
  const stepKey = step ? 'submissions/' + id + '/model' + depotExt(step.name) : null;
  const mainBuf = await main.arrayBuffer();
  const stepBuf = step ? await step.arrayBuffer() : null;

  // Quel « 3MF » avons-nous reçu ? La réponse change ce qu'il reste à faire.
  const meshKind = mode !== 'maillage' ? null
    : mainExt === '.stl' ? 'stl'
    : detect3mfKind(mainBuf);

  await env.SUBMIT_R2.put(mainKey, mainBuf, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { filename: main.name, piece: pieceId, origine },
  });
  if (stepKey) {
    await env.SUBMIT_R2.put(stepKey, stepBuf, {
      httpMetadata: { contentType: 'application/step' },
      customMetadata: { filename: step.name, piece: pieceId, origine },
    });
  }

  // Un dépôt interne n'a personne à examiner : c'est l'admin qui l'a fait, il ne va pas
  // relire son propre fichier. Il part donc directement en « accepté, à préparer ». Un
  // fichier reçu d'un tiers, lui, passe par l'examen comme une soumission du tunnel.
  const status = origine === 'hors-tunnel' ? 'review' : 'accepted';
  const ts = nowIso();
  try {
    await env.DB_PARTNER.prepare(
      'INSERT INTO submissions (id, reservation_id, piece_id, user_id, origine, version, ' +
      'native_key, native_name, native_ext, native_sha256, native_bytes, ' +
      'step_key, step_name, step_sha256, step_bytes, mesh_only, mesh_kind, status, ' +
      'cession_at, cession_version, author_name, cession_ref, deposited_by, decided_at, decided_by, created_at) ' +
      'VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, pieceId, 'admin:' + (adminEmail || 'inconnu'), origine, version,
      mainKey, main.name.slice(0, 200), mainExt, await depotSha256(mainBuf), mainBuf.byteLength,
      stepKey, step ? step.name.slice(0, 200) : null, stepBuf ? await depotSha256(stepBuf) : null,
      stepBuf ? stepBuf.byteLength : 0,
      mode === 'maillage' ? 1 : 0, meshKind, status,
      cessionAt, DEPOT_CESSION_VERSION, authorName || null, cessionRef || null, adminEmail || '',
      status === 'accepted' ? ts : null, status === 'accepted' ? (adminEmail || '') : null, ts
    ).run();
  } catch (e) {
    await env.SUBMIT_R2.delete(mainKey).catch(() => {});
    if (stepKey) await env.SUBMIT_R2.delete(stepKey).catch(() => {});
    const msg = String(e && e.message || e);
    if (/UNIQUE/i.test(msg)) return { ok: false, msg: 'Un dépôt vient d\'être enregistré pour cette pièce — recharge la liste avant de recommencer.' };
    return { ok: false, msg: 'Enregistrement impossible : ' + msg.slice(0, 200) };
  }

  await audit(env, adminEmail, 'depot_interne', pieceId + ' — v' + version + ' — ' + origine + (meshKind ? ' — ' + meshKind : ''));
  // Le message dit ce qu'il RESTE à faire, et ça dépend de ce qu'on a reçu : un 3MF
  // master est slicable en l'état, un 3MF source attend encore un profil machine.
  const suite = status === 'review' ? ' Il attend ton examen.'
    : meshKind === '3mf-master' ? ' 3MF master reconnu : slicable en l\'état, il ne lui manque rien.'
    : meshKind === '3mf-source' ? ' 3MF source (sans réglages) : il lui faut encore un profil machine.'
    : meshKind === 'stl' ? ' STL : ni unité déclarée ni réglages — à convertir avant slicing.'
    : meshKind === 'indetermine' ? ' ⚠ Fichier illisible comme zip : type indéterminé, à vérifier à la main.'
    : ' Il est prêt à préparer.';
  return {
    ok: true,
    msg: 'Fichier déposé pour ' + pieceId + ' (version ' + version + ').' + suite +
      (mode === 'maillage' ? ' Résolution non maîtrisée.' : ''),
  };
}

function viewDepot(pieces, flash, err) {
  const head = '<h1 class="page">Dépôt interne</h1>' +
    '<p class="sub">Déposer un fichier sans passer par le tunnel modélisateur : pièce modélisée par Hub⁴Fix, ' +
    'fichier reçu hors plateforme, ou Repair Together. Le dossier rejoint la <b>même file</b> que les soumissions ' +
    'des modélisateurs — même examen, même conversion, même publication.</p>';
  if (pieces && pieces.error) return head + dataError(pieces.error);
  const rows = (pieces && pieces.rows) || [];
  const banner = flash ? '<div class="banner">' + esc(flash) + '</div>' : '';
  const erreur = err ? '<div class="err">' + esc(err) + '</div>' : '';

  // Les pièces non encore modélisées d'abord : c'est pour elles qu'on dépose.
  const opts = rows.slice()
    .sort((a, b) => (truthy(a.modeled) - truthy(b.modeled)) || String(a.name || '').localeCompare(String(b.name || '')))
    .map((r) => '<option value="' + esc(r.id) + '">' + esc((r.name || r.id) + (r.machine ? ' — ' + r.machine : '') + (truthy(r.modeled) ? ' (déjà modélisée)' : '')) + '</option>')
    .join('');

  const lbl = 'display:block;font-size:.78rem;font-weight:600;margin:.9rem 0 .3rem';
  const inp = 'width:100%;border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;font:inherit;background:#fff';
  const radio = 'display:flex;gap:.5rem;align-items:flex-start;font-size:.85rem;padding:.5rem .1rem;cursor:pointer';
  const hint = 'font-size:.76rem;color:var(--earth);margin:.25rem 0 0';

  // Le bloc de cession n'apparaît que pour un auteur tiers. En CSS pur : l'admin n'a
  // aucun JavaScript, et si :has() manquait, le bloc resterait VISIBLE — dégradation
  // dans le bon sens (on demande une info en trop plutôt que d'en perdre une).
  const css = '<style>' +
    'form.depot:has(#o-interne:checked) .cession, form.depot:has(#o-rt:checked) .cession{display:none}' +
    'form.depot:has(#m-maillage:checked) .champ-step{display:none}' +
    'form.depot:has(#m-maillage:checked) .avert-maillage{display:block}' +
    'form.depot .avert-maillage{display:none}' +
    '</style>';

  return head + css + banner + erreur +
    '<form class="depot" method="post" action="/admin/depot" enctype="multipart/form-data" style="max-width:640px">' +
      '<div class="card" style="display:grid;gap:.2rem">' +
        '<label style="' + lbl + '">Pièce</label>' +
        (rows.length
          ? '<select name="piece_id" required style="' + inp + '"><option value="">— choisir —</option>' + opts + '</select>'
          : '<div class="err">Aucune pièce dans la base : rien à quoi rattacher un fichier.</div>') +

        '<label style="' + lbl + '">Ce que tu déposes</label>' +
        '<label style="' + radio + '"><input type="radio" name="mode" id="m-cao" value="cao" checked>' +
          '<span><b>Fichier CAO + STEP</b><div style="' + hint + '">Le chemin normal. Le STEP est tessellé en ' +
          'haute résolution (0,01 mm / 0,05 rad) pour donner un <b>3MF source</b>, dont on dérive ensuite un ' +
          '<b>3MF master</b> par machine. Rien n\'est perdu de la cote.</div></span></label>' +
        '<label style="' + radio + '"><input type="radio" name="mode" id="m-maillage" value="maillage">' +
          '<span><b>Maillage déjà prêt</b> (.3mf, .stl)<div style="' + hint + '">Pour le stock existant. ' +
          'Marqué « résolution non maîtrisée » : sa finesse est celle de son export d\'origine. ' +
          'Nous lisons le fichier pour savoir s\'il s\'agit d\'un <b>3MF source</b> (géométrie seule) ou d\'un ' +
          '<b>3MF master</b> (réglages de slicing inclus) — tu n\'as pas à le préciser.</div></span></label>' +

        '<label style="' + lbl + '">Le fichier</label>' +
        '<input type="file" name="fichier" required style="' + inp + '">' +
        '<p style="' + hint + '">CAO (.f3d, .fcstd, .sldprt…) ou maillage (.3mf, .stl) selon le mode choisi ci-dessus. ' +
        '25 Mo maximum.</p>' +

        '<div class="champ-step">' +
          '<label style="' + lbl + '">Export STEP (.step / .stp)</label>' +
          '<input type="file" name="step" accept=".step,.stp" style="' + inp + '">' +
        '</div>' +
        '<div class="avert-maillage" style="background:#fff8e6;border:1px solid #e3c46a;border-radius:9px;padding:.7rem .9rem;font-size:.8rem;margin-top:.6rem">' +
          '<b>Résolution non maîtrisée.</b> Ce fichier ne passera pas par notre tessellation : ' +
          'sa finesse est figée par l\'export qui l\'a produit. À refaire depuis un STEP le jour où une cote pose problème.' +
        '</div>' +

        '<label style="' + lbl + '">Origine du fichier</label>' +
        '<label style="' + radio + '"><input type="radio" name="origine" id="o-interne" value="interne" checked>' +
          '<span><b>Interne Hub⁴Fix</b><div style="' + hint + '">Modélisé par nous. Passe directement en « à préparer ».</div></span></label>' +
        '<label style="' + radio + '"><input type="radio" name="origine" id="o-rt" value="repair-together">' +
          '<span><b>Repair Together</b><div style="' + hint + '">Droits à 100 % Hub⁴Fix par le programme.</div></span></label>' +
        '<label style="' + radio + '"><input type="radio" name="origine" id="o-tiers" value="hors-tunnel">' +
          '<span><b>Modélisateur, hors tunnel</b><div style="' + hint + '">Reçu par mail ou transfert. Passe par l\'examen, ' +
          'et l\'acte de cession doit être traçable.</div></span></label>' +

        '<div class="cession" style="border-left:3px solid var(--line);padding-left:.9rem;margin-top:.5rem">' +
          '<label style="' + lbl + '">Auteur du fichier</label>' +
          '<input type="text" name="author_name" placeholder="Nom et prénom, ou raison sociale" style="' + inp + '">' +
          '<label style="' + lbl + '">Date de l\'acte de cession</label>' +
          '<input type="date" name="cession_at" style="' + inp + '">' +
          '<label style="' + lbl + '">Où retrouver l\'acte</label>' +
          '<input type="text" name="cession_ref" placeholder="ex. mail du 04/08/2026 « cession porte-filtre », PDF signé n°12" style="' + inp + '">' +
          '<p style="' + hint + '">La cession doit être horodatée <b>fichier par fichier</b> pour être opposable ' +
          '(art. L.131-1 CPI, CGV art. 2.1). L\'empreinte du fichier est calculée automatiquement et rattachée à l\'acte.</p>' +
        '</div>' +

        '<button type="submit" style="justify-self:start;margin-top:1.1rem;font-family:inherit;font-size:.82rem;font-weight:600;' +
          'border:none;border-radius:8px;padding:.6rem 1.3rem;cursor:pointer;background:var(--ink);color:#fff">Déposer</button>' +
      '</div>' +
    '</form>';
}

function viewModeles(data, flash) {
  const head = '<h1 class="page">Modèles 3D</h1>' +
    '<p class="sub">Fichiers déposés par les modélisateurs. Chaque dossier porte <b>deux fichiers</b> : ' +
    'le <b>source natif</b> (l\'œuvre, archivée, jamais distribuée) et le <b>STEP</b>, qui alimente la conversion en 3MF. ' +
    'L\'<b>acte de cession</b> est horodaté et lié au fichier par son empreinte.</p>';
  if (data.error === 'no_binding') return head + dataError('Base « partenaire » non liée (binding DB_PARTNER manquant).');
  if (data.error) return head + dataError(data.error);
  const rows = data.rows || [];
  const banner = flash ? '<div class="banner">' + esc(flash) + '</div>' : '';

  const count = (s) => rows.filter((r) => r.status === s).length;
  const cards = '<div class="cards">' +
    '<div class="card"><div class="k">Dossiers</div><div class="v">' + rows.length + '</div></div>' +
    '<div class="card' + (count('review') ? ' new' : '') + '"><div class="k">À examiner</div><div class="v">' + count('review') + '</div></div>' +
    '<div class="card"><div class="k">Acceptés, à préparer</div><div class="v">' + count('accepted') + '</div></div>' +
    '<div class="card"><div class="k">Publiés</div><div class="v">' + count('published') + '</div></div>' +
    '</div>';

  if (!rows.length) {
    return head + banner + cards +
      '<div class="soon">Aucun fichier déposé pour le moment. Un dossier arrive ici quand un modélisateur dépose ' +
      'son source et son STEP sur une pièce dont tu as validé la réservation.</div>';
  }

  const stTag = (s) => {
    const m = {
      review: ['À examiner', 'var(--red)'],
      accepted: ['Accepté — à préparer', '#2c6e9b'],
      prepared: ['3MF préparé', '#b8860b'],
      published: ['Publié', 'var(--green)'],
      rejected: ['Refusé', 'var(--earth)'],
    }[s] || [s, 'var(--earth)'];
    return '<span class="tag" style="background:' + m[1] + ';color:#fff">' + esc(m[0]) + '</span>';
  };
  const btn = 'font-family:inherit;font-size:.76rem;font-weight:600;border:none;border-radius:7px;padding:.45rem .9rem;cursor:pointer';
  const dl = (id, slot, name, bytes) =>
    '<a href="/admin/submission-file/' + encodeURIComponent(id) + '/' + slot + '" ' +
    'style="font-size:.78rem;color:var(--earth);text-decoration:none;border:1px solid var(--line);border-radius:7px;padding:.4rem .8rem;display:inline-block;background:#fff">' +
    '⤓ ' + esc(name) + ' <span class="muted">(' + (bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' Mo' : Math.round(bytes / 1024) + ' Ko') + ')</span></a>';

  const list = rows.map((r) => {
    let actions = '';
    if (r.status === 'review') {
      actions = '<form method="post" action="/admin/modeles" style="display:grid;gap:.5rem;margin-top:.8rem">' +
        '<input type="hidden" name="id" value="' + esc(r.id) + '">' +
        '<input type="text" name="note" placeholder="consigne de correction, ou motif d\'exclusion" ' +
        'style="font-size:.78rem;padding:.5rem .7rem;border:1px solid var(--line);border-radius:7px">' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button name="action" value="accept" style="' + btn + ';background:var(--green);color:#fff">Accepter</button>' +
          '<button name="action" value="correct" style="' + btn + ';background:#b8860b;color:#fff" title="Rend 72 h au modélisateur pour déposer une version corrigée">Demander une correction</button>' +
          '<button name="action" value="discard" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2" title="Non corrigeable : la pièce retourne à la Hot List">Écarter</button>' +
        '</div></form>';
    } else if (r.status === 'accepted') {
      // Pas de bouton mort : la préparation n'est pas encore branchée, on dit où en est
      // la chaîne et on donne le STEP pour la faire à la main entre-temps. Le rappel de
      // la tolérance n'est pas décoratif : un import STEP au réglage par défaut fige un
      // maillage grossier, et l'erreur de corde devient une erreur de cote sur la pièce.
      // Ce qui reste dépend de ce qui a été déposé. Un 3MF master n'a plus besoin de rien ;
      // un 3MF source attend un profil ; un STEP attend la tessellation.
      const reste = r.mesh_kind === '3mf-master'
        ? '<b>Rien à préparer :</b> ce 3MF master porte déjà ses réglages. Il ne reste qu\'à le ranger dans ' +
          '<code>h4f-masters</code> sous <code>&lt;pièce&gt;--&lt;machine&gt;.3mf</code> pour que le slicer le trouve.'
        : r.mesh_only
        // Pas de STEP : il n'y a rien à tesseller, rappeler la tolérance n'aurait aucun
        // sens ici. Ce qu'il faut savoir, c'est que la finesse est déjà figée.
        ? '<b>Pas de tessellation à faire :</b> la géométrie est déjà maillée, sa finesse est celle de son export. ' +
          'Il reste à en dériver un <b>3MF master</b> (injection du profil machine). Si la cote se révèle fausse, ' +
          'la correction passe par un nouveau dépôt en CAO + STEP.'
        : '<b>En attendant, préparation à la main dans le slicer — et la tolérance d\'import n\'est pas facultative :</b> ' +
          'déflexion linéaire <b>0,01 mm</b>, angulaire <b>0,05 rad</b> (≈ 2,9°). ' +
          'Au réglage par défaut, le maillage est facetté et l\'écart de corde devient un écart de cote sur une pièce ' +
          'fonctionnelle — irrécupérable ensuite.';
      actions = '<div class="soon" style="margin-top:.8rem;font-size:.8rem">Étape suivante : ' +
        '<b>STEP → 3MF source</b> (tessellation + sceau, une fois par pièce), puis ' +
        '<b>3MF source → 3MF master</b> (profil machine, un par machine). ' +
        'Cela demande le service de conversion — voir <code>context/PLAN_TUNNEL_MODELISATEUR.md</code>.<br><br>' +
        reste + '</div>';
    } else if (r.review_note) {
      actions = '<div class="muted" style="font-size:.78rem;margin-top:.6rem">« ' + esc(r.review_note) + ' »' +
        (r.decided_by ? ' — ' + esc(r.decided_by) : '') + '</div>';
    }

    // D'où vient le dossier : le tunnel n'a pas besoin d'être annoncé (c'est le cas
    // normal), les autres portes si — elles n'ont pas la même valeur juridique.
    const origTag = {
      interne: ['Interne H4F', '#2c6e9b'],
      'hors-tunnel': ['Hors tunnel', '#b8860b'],
      'repair-together': ['Repair Together', 'var(--green)'],
    }[r.origine];
    const origine = origTag ? ' <span class="tag" style="background:' + origTag[1] + ';color:#fff">' + esc(origTag[0]) + '</span>' : '';
    // Le type de maillage n'est pas une étiquette : il dit ce qu'il RESTE à faire.
    const kindSays = {
      '3mf-master': '<b>3MF master.</b> Il porte déjà les réglages de slicing : slicable en l\'état, rien à lui ajouter.',
      '3mf-source': '<b>3MF source.</b> Géométrie seule, sans réglages : il lui faut encore un profil machine pour devenir un master.',
      stl: '<b>STL.</b> Ni unité déclarée ni métadonnée — à convertir avant slicing.',
      indetermine: '<b>Type indéterminé.</b> Le fichier n\'a pas pu être lu comme un zip : à ouvrir à la main pour savoir ce que c\'est.',
    }[r.mesh_kind] || '';
    const meshWarn = r.mesh_only
      ? '<div style="background:#fff8e6;border:1px solid #e3c46a;border-radius:8px;padding:.55rem .8rem;font-size:.78rem;margin:.6rem 0">' +
        (kindSays ? kindSays + '<br>' : '') +
        '<b>Résolution non maîtrisée.</b> Ce fichier n\'est pas passé par notre tessellation ' +
        '(0,01 mm / 0,05 rad) : sa finesse est celle de son export d\'origine. À refaire depuis un STEP ' +
        'si une cote pose problème.</div>'
      : '';
    const qui = r.origine === 'hors-tunnel' && r.author_name ? esc(r.author_name) + ' (via ' + esc(r.deposited_by || '') + ')'
      : r.deposited_by ? esc(r.deposited_by)
      : esc(r.email || r.user_id);

    return '<div style="border:1px solid var(--line);border-radius:9px;padding:1rem;background:var(--cream);margin-bottom:.8rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:.6rem;flex-wrap:wrap">' +
        '<div><strong style="font-size:.88rem">' + esc(r.piece_id) + '</strong>' +
          (r.version > 1 ? ' <span class="tag" style="background:var(--cream);color:var(--earth)">version ' + r.version + '</span>' : '') + origine +
          '<div class="muted" style="font-size:.8rem">' + qui + ' · déposé le ' + fmtDate(r.created_at) + '</div></div>' +
        stTag(r.status) +
      '</div>' + meshWarn +
      '<div style="display:flex;gap:.5rem;margin:.7rem 0;flex-wrap:wrap">' +
        dl(r.id, 'native', r.native_name, r.native_bytes) +
        (r.step_key ? dl(r.id, 'step', r.step_name, r.step_bytes) : '') +
      '</div>' +
      '<details style="font-size:.76rem"><summary style="cursor:pointer;color:var(--earth);font-weight:600">Acte de cession</summary>' +
        '<div class="muted" style="margin-top:.4rem;line-height:1.6">' +
          (r.origine === 'interne' ? 'Fichier Hub⁴Fix — pas de cession de tiers.<br>'
            : r.origine === 'repair-together' ? 'Repair Together : droits à 100 % Hub⁴Fix par le programme.<br>' : '') +
          'Acte daté du <b>' + fmtDate(r.cession_at) + '</b> · CGV <code>' + esc(r.cession_version) + '</code><br>' +
          (r.author_name ? 'Auteur : <b>' + esc(r.author_name) + '</b><br>' : '') +
          (r.cession_ref ? 'Acte retrouvable : ' + esc(r.cession_ref) + '<br>' : '') +
          'Empreinte du fichier : <code style="font-size:.7rem">' + esc(String(r.native_sha256 || '').slice(0, 32)) + '…</code>' +
          (r.step_sha256 ? '<br>Empreinte du STEP : <code style="font-size:.7rem">' + esc(String(r.step_sha256).slice(0, 32)) + '…</code>' : '') +
        '</div></details>' +
      actions + '</div>';
  }).join('');

  return head + banner + cards + list;
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
    'regenerate': ['Régénération demandée', '#b8860b', '#fff'],
    'verify-original': ['Source à vérifier', '#2c6e9b', '#fff'],
    'rejected': ['Écarté — FA non pertinente', 'var(--earth)', '#fff'],
    'pending': ['En attente', 'var(--cream)', 'var(--earth)'],
  };
  const m = map[s] || [s || '—', 'var(--cream)', 'var(--earth)'];
  return `<span class="tag" style="background:${m[1]};color:${m[2]}">${esc(m[0])}</span>`;
}

const TIER_LABEL = {
  confirme: 'Confirmé (≥10 témoignages)',
  confirme_score3: 'Confirmé, score business modéré',
  signal_faible: 'Signal faible (5-9 témoignages)',
};

// Barre de score (priority_score = diversité des sources x fraîcheur, voir
// genimg/ingest_veille.py) + chiffre explicatif traçable (occurrences +
// domaines sources) + badge "preuve partielle" si la pièce est entrée via
// un palier de repli (tier != confirme). Absence gracieuse : les pièces
// plus anciennes ou ajoutées à la main n'ont pas ces champs.
function scoreExplain(r) {
  const score = parseFloat(r.priority_score);
  if (!isFinite(score)) return '';
  const pct = Math.max(4, Math.min(100, (score / 5) * 100));
  const isPartial = r.tier && r.tier !== 'confirme';
  const barColor = isPartial ? '#b8860b' : 'var(--green)';
  const occ = parseInt(r.occurrences, 10);
  const explain = (isFinite(occ) ? occ + ' témoignage' + (occ > 1 ? 's' : '') : '')
    + (r.sourceDomains ? (isFinite(occ) ? ' · ' : '') + esc(r.sourceDomains) : '');
  const badge = isPartial
    ? ' <span class="tag" style="background:#fdf1da;color:#8a6116" title="' + esc(TIER_LABEL[r.tier] || r.tier) + '">preuve partielle</span>'
    : '';
  return '<div style="display:flex;align-items:center;gap:.55rem;margin-bottom:.7rem;flex-wrap:wrap">' +
    '<div style="width:70px;height:6px;background:var(--line);border-radius:3px;overflow:hidden;flex:0 0 auto">' +
      '<div style="width:' + pct.toFixed(0) + '%;height:100%;background:' + barColor + '"></div></div>' +
    '<span style="font-size:.74rem;font-weight:700;color:var(--ink)">' + score.toFixed(2) + '</span>' +
    (explain ? '<span class="muted" style="font-size:.78rem">' + explain + '</span>' : '') +
    badge +
  '</div>';
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
  const order = { 'to-validate': 0, 'regenerate': 1, 'verify-original': 2, 'published': 3, 'rejected': 4 };
  rows.sort((a, b) => (order[a.status] == null ? 5 : order[a.status]) - (order[b.status] == null ? 5 : order[b.status]));

  const exportBtn = '<a href="/admin/pieces.csv" style="display:inline-block;margin-bottom:1.2rem;font-size:.82rem;font-weight:600;color:var(--earth);text-decoration:none;border:1px solid var(--line);border-radius:7px;padding:.45rem .9rem">⤓ Exporter la base en tableur (CSV)</a>';

  const box = 'flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--cream)';
  const lbl = 'font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--earth);font-weight:600;padding:.4rem .7rem;background:#fff;border-bottom:1px solid var(--line)';
  const img = 'display:block;width:100%;height:210px;object-fit:contain;background:#faf8f5';

  const cards = rows.map((r) => {
    const id = String(r.id || '');
    const enc = id.split('/').map(encodeURIComponent).join('/');
    const st = r.status || '';
    let actions = '';
    {
      const btn = 'font-family:inherit;font-size:.78rem;font-weight:600;border:none;border-radius:7px;padding:.55rem 1.1rem;cursor:pointer';
      const publish = '<button name="action" value="publish" style="' + btn + ';background:var(--green);color:#fff">Publier</button>';
      // Régénérer = le visuel ne correspond pas -> le pipeline refait l'image
      const regen = '<button name="action" value="regenerate" style="' + btn + ';background:#b8860b;color:#fff" title="Le visuel ne correspond pas : relancer la génération">Régénérer</button>';
      // Rejeter = verdict métier : la fabrication additive n\'est pas pertinente pour cette pièce
      const reject = '<button name="action" value="reject" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2" title="Écarter : fabrication additive non pertinente (transparence, sécurité…)">Rejeter</button>';
      // Champ partagé : précision pour l'IA (Régénérer) ou motif (Rejeter).
      // Commande force : /new = repartir à zéro (efface la consigne mémorisée).
      const note = '<input type="text" name="note" placeholder="précision IA / motif — /new = à zéro · /source = vérifier la réf" style="flex:1;min-width:190px;font-size:.75rem;padding:.45rem .6rem;border:1px solid var(--line);border-radius:7px">' +
        // Bulle (+) : pense-bête du langage complet du champ note
        '<details class="cmd-help"><summary title="Pense-bête des commandes">+</summary><div class="cmd-panel">' +
          '<h4>Régénérer</h4>' +
          '<div class="row"><code>(vide)</code><span>ré-essai avec la consigne mémorisée</span></div>' +
          '<div class="row"><code>texte</code><span>consigne pour l\'IA — gardée entre essais, effacée à la publication</span></div>' +
          '<div class="row"><code>/new [texte]</code><span>repartir à zéro : efface l\'historique de consignes, régénère depuis l\'original + prompt de base pur (anti-artefacts)</span></div>' +
          '<div class="row"><code>/source [texte]</code><span>la référence est douteuse ou indisponible : re-sourcing par le pipeline, aucune régénération sur une mauvaise base</span></div>' +
          '<h4>Rejeter</h4>' +
          '<div class="row"><code>texte</code><span>motif d\'exclusion FA — réévaluable quand l\'état de l\'art évolue (bouton Réactiver)</span></div>' +
        '</div></details>';
      const reactivate = '<button name="action" value="reactivate" style="' + btn + ';background:#fff;color:var(--ink);border:1px solid var(--line)">Réactiver</button>';
      let inner = '';
      if (st === 'to-validate') inner = publish + regen + note + reject;
      else if (st === 'published') inner = regen + note + reject;
      else if (st === 'regenerate') inner = publish + regen + note + reject;
      else if (st === 'verify-original') inner = publish + regen + note + reject;
      else if (st === 'rejected') inner = reactivate;
      if (inner) {
        actions = '<form method="post" action="/admin/shadowlist" style="position:relative;display:flex;gap:.6rem;margin-top:.9rem;flex-wrap:wrap;align-items:center">' +
          '<input type="hidden" name="id" value="' + esc(id) + '">' + inner + '</form>';
      }
      if (st === 'regenerate' && r.regenHint) {
        actions = '<div class="muted" style="font-size:.78rem;margin-top:.6rem">Consigne IA : « ' + esc(r.regenHint) + ' »</div>' + actions;
      }
      if (st === 'verify-original') {
        actions = '<div class="muted" style="font-size:.78rem;margin-top:.6rem">Référence originale en re-sourcing par le pipeline' +
          (r.regenHint ? ' — « ' + esc(r.regenHint) + ' »' : '') + '</div>' + actions;
      }
      if (st === 'rejected') {
        actions = '<div class="muted" style="font-size:.78rem;margin-top:.6rem">' +
          (r.rejectReason ? 'Motif : ' + esc(r.rejectReason) + ' — ' : '') +
          '<em>réévaluable quand l\'état de l\'art FA évolue (transparence, SLS abordable…)</em></div>' + actions;
      }
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
    // Remplacer la référence : upload direct (photo prise soi-même — rétro-conception)
    // ou recadrage d'une photo générale du produit (quand seule une photo de
    // l'assemblage complet existe). Le recadrage est 100% côté navigateur
    // (canvas) : le worker ne voit jamais l'image non recadrée.
    // heuristique d'affichage (auto-ouvrir + badge) : 'pending'/'verify-original'
    // sont les 2 statuts qui signifient concretement "pas de reference exploitable"
    const hasOrig = r.status !== 'pending' && r.status !== 'verify-original';
    const replaceOriginal =
      '<details' + (hasOrig ? '' : ' open') + ' style="margin-top:.8rem;border-top:1px solid var(--line);padding-top:.7rem">' +
        '<summary style="cursor:pointer;font-size:.78rem;font-weight:600;color:var(--earth)">Remplacer la référence' +
          (hasOrig ? '' : ' <span class="tag" style="background:#fdf1da;color:#8a6116">aucune référence — recommandé</span>') +
        '</summary>' +
        '<div style="margin-top:.7rem;display:grid;gap:.8rem">' +
          '<form method="post" action="/admin/replace-original" enctype="multipart/form-data" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">' +
            '<input type="hidden" name="id" value="' + esc(id) + '">' +
            '<label style="' + inp + '">Photo prise soi-même (pièce réelle en main) : <input type="file" name="image" accept="image/*" required></label>' +
            '<button style="font-family:inherit;font-size:.75rem;font-weight:600;border:none;border-radius:7px;padding:.5rem 1rem;cursor:pointer;background:var(--ink);color:#fff">Remplacer</button>' +
          '</form>' +
          '<div class="orig-cropper" data-id="' + esc(id) + '">' +
            '<label style="' + inp + '">Ou recadrer une photo générale du produit (seule une photo de l\'assemblage complet existe) : ' +
              '<input type="file" class="crop-input" accept="image/*"></label>' +
            '<div class="crop-canvas-wrap" style="display:none;margin-top:.5rem">' +
              '<canvas class="crop-canvas" style="max-width:100%;border:1px solid var(--line);cursor:crosshair;display:block"></canvas>' +
              '<div style="margin-top:.5rem;display:flex;gap:.7rem;align-items:center;flex-wrap:wrap">' +
                '<span class="muted" style="font-size:.72rem">Dessine un rectangle autour de la pièce, puis valide</span>' +
                '<button type="button" class="crop-confirm" style="font-family:inherit;font-size:.75rem;font-weight:600;border:none;border-radius:7px;padding:.45rem .9rem;cursor:pointer;background:#b8860b;color:#fff">Utiliser cette zone</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</details>';
    return '<div class="card" style="padding:1.1rem 1.2rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;margin-bottom:.8rem">' +
        '<div><div style="font-weight:600">' + esc(r.name || id) + '</div>' +
        '<div class="muted" style="font-size:.82rem">' + esc(r.machine || '') + '</div></div>' +
        statusTag(r.status) + '</div>' +
      scoreExplain(r) +
      '<div style="display:flex;gap:.9rem">' +
        '<div style="' + box + '"><div style="' + lbl + '">Original (privé)</div>' +
          '<img style="' + img + '" src="/img/orig/' + enc + '" alt="original" ' +
          'onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'<div style=&quot;padding:2rem;text-align:center;color:#7A7268;font-size:.8rem&quot;>indisponible</div>\')"></div>' +
        '<div style="' + box + '"><div style="' + lbl + '">Version Hub⁴Fix</div>' +
          '<img style="' + img + '" src="/img/h4f/' + enc + '" alt="version H4F" ' +
          'onerror="this.style.display=\'none\';this.insertAdjacentHTML(\'afterend\',\'<div style=&quot;padding:2rem;text-align:center;color:#7A7268;font-size:.8rem&quot;>indisponible</div>\')"></div>' +
      '</div>' + actions + upload + replaceOriginal + '</div>';
  }).join('');

  return head + exportBtn + '<div style="display:grid;gap:1.2rem">' + cards + '</div>' + CROPPER_SCRIPT;
}

// Recadreur de référence : logique partagée, câblée une seule fois sur toutes
// les cartes via data-id (pas de duplication par carte). Pur canvas natif,
// aucune dépendance. Le crop produit un nouveau blob envoyé tel quel à
// /admin/replace-original — le worker ne fait jamais de traitement d'image.
const CROPPER_SCRIPT = `<script>
document.querySelectorAll('.orig-cropper').forEach(function (wrap) {
  var id = wrap.dataset.id;
  var input = wrap.querySelector('.crop-input');
  var canvasWrap = wrap.querySelector('.crop-canvas-wrap');
  var canvas = wrap.querySelector('.crop-canvas');
  var confirmBtn = wrap.querySelector('.crop-confirm');
  var ctx2d = canvas.getContext('2d');
  var img = new Image();
  var rect = null, dragging = false, start = null;

  function redraw() {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (rect) { ctx2d.strokeStyle = '#C8102E'; ctx2d.lineWidth = 2; ctx2d.strokeRect(rect.x, rect.y, rect.w, rect.h); }
  }

  input.addEventListener('change', function () {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      img.onload = function () {
        var maxW = 520, scale = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        rect = null;
        redraw();
        canvasWrap.style.display = 'block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  canvas.addEventListener('mousedown', function (e) {
    var r = canvas.getBoundingClientRect();
    start = { x: e.clientX - r.left, y: e.clientY - r.top };
    dragging = true;
  });
  canvas.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var r = canvas.getBoundingClientRect();
    var cur = { x: e.clientX - r.left, y: e.clientY - r.top };
    rect = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    redraw();
  });
  window.addEventListener('mouseup', function () { dragging = false; });

  confirmBtn.addEventListener('click', function () {
    if (!rect || rect.w < 5 || rect.h < 5) { alert("Dessine d'abord un rectangle autour de la pièce."); return; }
    // Recadre depuis l'image source d'origine (jamais le rectangle rouge dessiné
    // par-dessus dans le canvas d'affichage) : évite de polluer la référence avec
    // le trait de sélection, et conserve la pleine résolution du fichier choisi.
    var toSrc = img.width / canvas.width;
    var sx = rect.x * toSrc, sy = rect.y * toSrc, sw = rect.w * toSrc, sh = rect.h * toSrc;
    var crop = document.createElement('canvas');
    crop.width = Math.round(sw); crop.height = Math.round(sh);
    crop.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, crop.width, crop.height);
    crop.toBlob(function (blob) {
      var fd = new FormData();
      fd.append('id', id);
      fd.append('image', blob, 'crop.png');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Envoi…';
      fetch('/admin/replace-original', { method: 'POST', body: fd })
        .then(function () { location.reload(); })
        .catch(function () { alert("Échec de l'envoi."); confirmBtn.disabled = false; confirmBtn.textContent = 'Utiliser cette zone'; });
    }, 'image/png');
  });
});
</script>`;

function piecesToCsv(rows) {
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [PIECE_COLS.join(',')];
  rows.forEach((r) => lines.push(PIECE_COLS.map((c) => q(r[c])).join(',')));
  return lines.join('\r\n');
}

const SECTIONS = {
  '/admin/comptabilite': () => viewSoon('Comptabilité', 'Paiements et reversements.',
    'À venir : accès <b>comptabilité</b> aux données de paiement (via le Prestataire de Services de Paiement), réservé aux rôles autorisés.'),
  '/admin/journal': () => viewSoon("Journal d'audit", 'Traçabilité des actions.',
    'À venir : <b>journal</b> des connexions, approbations d\'appareils et actions sensibles.'),
};

// ==================== Candidatures modélisateur ====================
// Technique A : binding direct vers la base partenaire (DB_PARTNER = h4f_partner).
// Valider une candidature passe partners.status -> 'active' (l'accès Hot List
// se lit sur ce statut, plus sur users.role). Tolérant à l'absence du binding.

// Nombre de candidatures modélisateur EN ATTENTE (badge de nav). Tolère l'absence du binding.
async function countPendingModelers(env) {
  if (!env.DB_PARTNER) return 0;
  try {
    const r = await env.DB_PARTNER.prepare("SELECT COUNT(*) AS n FROM partners WHERE status = 'pending'").first();
    return (r && r.n) || 0;
  } catch (e) { return 0; }
}

async function loadModelerApplications(env) {
  if (!env.DB_PARTNER) return { error: 'no_binding' };
  try {
    const r = await env.DB_PARTNER.prepare(
      "SELECT p.id, p.user_id, p.email, p.type, p.motivation, p.portfolio, p.status, p.created_at, p.decided_at, p.decided_by, " +
      "pp.techs, pp.materials, pp.postal_code, pp.ville " +
      "FROM partners p LEFT JOIN printer_profiles pp ON pp.user_id = p.user_id " +
      "ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.id DESC LIMIT 200"
    ).all();
    return { rows: (r && r.results) || [] };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

// Approuve (partners.status -> 'active') ou rejette une candidature partenaire.
async function decideModelerApplication(env, appId, decision, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée (binding DB_PARTNER manquant).' };
  const app = await env.DB_PARTNER.prepare('SELECT id, status FROM partners WHERE id = ?').bind(appId).first();
  if (!app) return { ok: false, msg: 'Candidature introuvable.' };
  if (app.status !== 'pending') return { ok: false, msg: 'Candidature déjà traitée.' };
  const ts = nowIso();
  const status = decision === 'approve' ? 'active' : 'rejected';
  await env.DB_PARTNER.prepare('UPDATE partners SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .bind(status, ts, adminEmail || '', appId).run();
  await audit(env, adminEmail, 'partner_' + status, 'partner#' + appId);
  return { ok: true };
}

// Modifie les champs libres d'une candidature (motivation, portfolio) — ex. retirer un
// lien suspect sans tout supprimer.
async function updatePartnerApplication(env, appId, motivation, portfolio, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée.' };
  const app = await env.DB_PARTNER.prepare('SELECT id FROM partners WHERE id = ?').bind(appId).first();
  if (!app) return { ok: false, msg: 'Candidature introuvable.' };
  await env.DB_PARTNER.prepare('UPDATE partners SET motivation = ?, portfolio = ? WHERE id = ?')
    .bind(String(motivation || '').slice(0, 2000), String(portfolio || '').slice(0, 500), appId).run();
  await audit(env, adminEmail, 'partner_edited', 'partner#' + appId);
  return { ok: true };
}

// Supprime DÉFINITIVEMENT une candidature + les données de CE rôle uniquement (un
// modélisateur a des réservations ; un printer a un parc). Ne touche PAS au compte D1
// (le compte B2C reste), ni à l'autre rôle si le compte cumule les deux.
async function deletePartner(env, appId, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée.' };
  const p = await env.DB_PARTNER.prepare('SELECT id, user_id, type FROM partners WHERE id = ?').bind(appId).first();
  if (!p) return { ok: false, msg: 'Candidature introuvable.' };
  if (p.type === 'printer') {
    await env.DB_PARTNER.prepare('DELETE FROM printer_profiles WHERE user_id = ?').bind(p.user_id).run();
  } else {
    await env.DB_PARTNER.prepare('DELETE FROM reservations WHERE user_id = ?').bind(p.user_id).run();
  }
  await env.DB_PARTNER.prepare('DELETE FROM partners WHERE id = ?').bind(appId).run();
  await audit(env, adminEmail, 'partner_deleted', 'partner#' + appId + ' (' + p.type + ')');
  return { ok: true };
}

function viewModelerApplications(data, flash, editId) {
  const head = '<h1 class="page">Candidatures partenaire</h1>' +
    '<p class="sub">Valider une candidature active le statut correspondant : <b>modélisateur</b> (accès Hot List) ou <b>printer</b> (accès aux commandes de sa zone). Le rejet laisse le compte sans ce statut. <b>Modifier</b> permet de retirer un lien suspect ; <b>Supprimer</b> efface la candidature.</p>';
  if (data.error === 'no_binding') {
    return head + dataError('Base « partenaire » non liée. Ajoute le binding DB_PARTNER (base h4f_partner) au worker admin, puis redéploie.');
  }
  if (data.error) return head + dataError(data.error);
  const rows = data.rows || [];
  const banner = flash ? '<div class="banner">' + esc(flash) + '</div>' : '';
  if (!rows.length) return head + banner + '<div class="soon">Aucune candidature pour le moment.</div>';

  const tag = (s) => {
    const m = { pending: ['En attente', '#b8860b'], active: ['Active', 'var(--green)'], rejected: ['Rejetée', 'var(--earth)'], suspended: ['Suspendue', 'var(--earth)'] }[s] || [s, 'var(--earth)'];
    return '<span class="tag" style="background:' + m[1] + ';color:#fff">' + esc(m[0]) + '</span>';
  };
  const typeColor = (t) => t === 'printer' ? '#185FA5' : '#DD7A2B';
  const typeTag = (t) => t === 'printer'
    ? '<span class="tag" style="background:#185FA5;color:#fff">Printer</span>'
    : '<span class="tag" style="background:#DD7A2B;color:#fff">Modélisateur</span>';
  const btn = 'font-family:inherit;font-size:.78rem;font-weight:600;border:none;border-radius:7px;padding:.5rem 1rem;cursor:pointer';
  // Tout le contour de la carte prend la couleur du type (bleu printer / violet modélisateur).
  const cardWrap = (inner, t) => '<div style="border:2px solid ' + typeColor(t) + ';border-radius:9px;padding:1rem;background:var(--cream);margin-bottom:.8rem">' + inner + '</div>';
  const header = (r) => '<div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem">' +
    '<div><strong>' + esc([r.prenom, r.nom].filter(Boolean).join(' ') || r.email) + '</strong> <span class="muted" style="font-size:.8rem">' + esc(r.email) + '</span></div>' +
    '<div style="display:flex;gap:.4rem">' + typeTag(r.type) + tag(r.status) + '</div></div>';

  const cards = rows.map((r) => {
    // Mode ÉDITION : formulaire pour corriger motivation + portfolio (ex. lien suspect).
    if (String(editId) === String(r.id)) {
      return cardWrap(header(r) +
        '<form method="post" action="/admin/modelisateurs" style="margin-top:.7rem">' +
        '<input type="hidden" name="id" value="' + esc(r.id) + '"><input type="hidden" name="action" value="edit">' +
        '<label style="font-size:.78rem;font-weight:600">Motivation</label>' +
        '<textarea name="motivation" style="width:100%;min-height:80px;margin:.2rem 0 .6rem;font-family:inherit;font-size:.85rem;padding:.5rem;border:1px solid var(--line);border-radius:7px">' + esc(r.motivation || '') + '</textarea>' +
        '<label style="font-size:.78rem;font-weight:600">Portfolio / lien</label>' +
        '<input name="portfolio" value="' + esc(r.portfolio || '') + '" style="width:100%;margin:.2rem 0 .7rem;font-family:inherit;font-size:.85rem;padding:.5rem;border:1px solid var(--line);border-radius:7px">' +
        '<div style="display:flex;gap:.5rem"><button type="submit" style="' + btn + ';background:var(--green);color:#fff">Enregistrer</button>' +
        '<a href="/admin/modelisateurs" style="' + btn + ';background:#fff;color:var(--earth);border:1px solid var(--line);text-decoration:none">Annuler</a></div></form>', r.type);
    }

    let detail;
    if (r.type === 'printer') {
      const loc = [r.postal_code, r.ville].filter(Boolean).map(esc).join(' ');
      detail = '<div style="font-size:.8rem;line-height:1.6">' +
        'Technologies : <b>' + esc(r.techs || '—') + '</b><br>' +
        'Matériaux : ' + esc(r.materials || '—') + '<br>' +
        'Zone : ' + (loc || '<span class="muted">—</span>') + '</div>';
    } else {
      // SÉCURITÉ : n'afficher un lien cliquable QUE si l'URL est http(s). Sinon texte brut,
      // pour neutraliser un href="javascript:…"/"data:…" injecté via le portfolio (XSS admin).
      const port = r.portfolio
        ? (/^https?:\/\//i.test(String(r.portfolio).trim())
            ? '<a href="' + esc(r.portfolio) + '" target="_blank" rel="noopener noreferrer" style="color:var(--earth)">' + esc(r.portfolio) + '</a>'
            : '<span style="color:var(--earth)">' + esc(r.portfolio) + '</span>')
        : '<span class="muted">—</span>';
      detail = '<div style="font-size:.8rem">Portfolio : ' + port + '</div>';
    }

    let decide = '';
    if (r.status === 'pending') {
      decide = '<form method="post" action="/admin/modelisateurs" style="display:flex;gap:.5rem">' +
        '<input type="hidden" name="id" value="' + esc(r.id) + '">' +
        '<button name="action" value="approve" style="' + btn + ';background:var(--green);color:#fff">Approuver</button>' +
        '<button name="action" value="reject" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2">Rejeter</button>' +
        '</form>';
    } else {
      decide = '<div class="muted" style="font-size:.78rem">Traitée le ' + esc((r.decided_at || '').slice(0, 10)) + (r.decided_by ? ' par ' + esc(r.decided_by) : '') + '</div>';
    }
    // Modifier + Supprimer : toujours disponibles (gestion du contenu / lien suspect).
    const manage = '<a href="/admin/modelisateurs?edit=' + esc(r.id) + '" style="' + btn + ';background:#fff;color:var(--earth);border:1px solid var(--line);text-decoration:none">Modifier</a>' +
      '<form method="post" action="/admin/modelisateurs" style="display:inline" onsubmit="return confirm(\'Supprimer définitivement cette candidature ? (le compte client reste)\')">' +
      '<input type="hidden" name="id" value="' + esc(r.id) + '"><input type="hidden" name="action" value="delete">' +
      '<button type="submit" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2">Supprimer</button></form>';

    return cardWrap(header(r) +
      '<p style="margin:.6rem 0 .3rem;font-size:.9rem;white-space:pre-wrap">' + esc(r.motivation || '') + '</p>' +
      detail +
      '<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.7rem">' + decide + manage + '</div>', r.type);
  }).join('');
  return head + banner + cards;
}

// ==================== Réservations (Hot List modélisateur) ====================
// Lecture via DB_PARTNER (h4f_partner) ; photos servies depuis RESERV_R2. L'admin
// peut suspendre / annuler une réservation (photo suspecte) ou la réactiver.

// La fenêtre de travail du modélisateur, en millisecondes. DUPLIQUÉE depuis
// worker/partner/partner.js (deux workers, deux déploiements — pas de module commun).
// Toute modification doit se faire des deux côtés : ici c'est la valeur qui est
// ÉCRITE à la validation, là-bas celle qui est lue et prolongée.
const WORK_WINDOW_MS = 72 * 3600 * 1000;

async function loadReservations(env) {
  if (!env.DB_PARTNER) return { error: 'no_binding' };
  try {
    // reservations et partners sont dans la même base (h4f_partner) : on joint pour
    // l'email du modélisateur (LEFT JOIN au cas où le partenaire aurait été purgé).
    // Tri : ce qui attend une décision d'abord (feu vert à donner, photo suspecte),
    // le reste ensuite. L'écran doit dire quoi faire, pas seulement ce qui existe.
    const r = await env.DB_PARTNER.prepare(
      "SELECT r.id, r.piece_id, r.status, r.ai_check, r.plate_key, r.object_key, r.part_key, " +
      "r.created_at, r.expires_at, r.validated_at, r.extended_at, r.decided_by, " +
      "r.user_id, p.email " +
      "FROM reservations r LEFT JOIN partners p ON p.user_id = r.user_id AND p.type = 'modelisateur' " +
      "ORDER BY CASE WHEN r.status='pending-review' AND r.plate_key IS NOT NULL THEN 0 " +
      "WHEN r.ai_check LIKE 'suspect%' THEN 1 WHEN r.status='submitted' THEN 2 " +
      "WHEN r.status='active' THEN 3 ELSE 4 END, r.id DESC LIMIT 300"
    ).all();
    return { rows: (r && r.results) || [], now: nowIso() };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

// Le FEU VERT est ici, et nulle part ailleurs : c'est cette action qui démarre les
// 72 h du modélisateur. Tant qu'elle n'est pas donnée, la pièce est tenue mais aucun
// délai ne court contre lui.
async function decideReservation(env, resvId, action, adminEmail) {
  if (!env.DB_PARTNER) return { ok: false, msg: 'Base partenaire non liée.' };
  const row = await env.DB_PARTNER.prepare(
    'SELECT id, status, plate_key, validated_at FROM reservations WHERE id = ?'
  ).bind(resvId).first();
  if (!row) return { ok: false, msg: 'Réservation introuvable.' };
  const ts = nowIso();

  if (action === 'validate') {
    if (!row.plate_key) return { ok: false, msg: 'Pas de photos : rien à valider.' };
    if (row.status === 'submitted') return { ok: false, msg: 'Le fichier est déjà déposé.' };
    const deadline = new Date(Date.now() + WORK_WINDOW_MS).toISOString();
    await env.DB_PARTNER.prepare(
      "UPDATE reservations SET status = 'active', validated_at = ?, expires_at = ?, decided_by = ? WHERE id = ?"
    ).bind(ts, deadline, adminEmail || '', resvId).run();
    await audit(env, adminEmail, 'reservation_validee', 'reservation#' + resvId + ' — dépôt attendu avant ' + deadline);
    return { ok: true, msg: 'Feu vert donné : 72 h pour déposer le fichier.' };
  }

  const map = { suspend: 'suspended', cancel: 'cancelled', reactivate: 'active' };
  let status = map[action];
  if (!status) return { ok: false, msg: 'Action inconnue.' };
  // Lever une suspension ne doit pas donner le feu vert par effet de bord : une
  // réservation suspendue AVANT validation retourne en attente de décision, pas en
  // 'active' — sinon le délai courrait sans jamais avoir été ouvert.
  if (action === 'reactivate' && !row.validated_at) status = 'pending-review';
  await env.DB_PARTNER.prepare('UPDATE reservations SET status = ?, decided_by = ? WHERE id = ?').bind(status, adminEmail || '', resvId).run();
  await audit(env, adminEmail, 'reservation_' + status, 'reservation#' + resvId);
  return { ok: true };
}

// Délai restant en clair. Une date ISO ne dit rien à la lecture ; « 41 h » si.
function remaining(iso, nowIso) {
  const end = Date.parse(iso || '');
  const now = Date.parse(nowIso || '') || Date.now();
  if (isNaN(end)) return '';
  const ms = end - now;
  if (ms <= 0) return 'échu';
  const h = Math.floor(ms / 3600000);
  if (h < 48) return h + ' h restantes';
  return Math.floor(h / 24) + ' j restants';
}

function viewReservations(data, flash) {
  const head = '<h1 class="page">Réservations</h1>' +
    '<p class="sub">Options posées par les modélisateurs sur la Hot List. ' +
    'Ce qui attend une décision remonte en tête. <b>Valider</b> donne le feu vert et démarre ses <b>72 h</b> pour déposer le fichier — ' +
    'avant ça, la pièce lui est réservée mais aucun délai ne court contre lui.</p>';
  if (data.error === 'no_binding') return head + dataError('Base « partenaire » non liée (binding DB_PARTNER manquant).');
  if (data.error) return head + dataError(data.error);
  const rows = data.rows || [];
  const now = data.now || nowIso();
  const banner = flash ? '<div class="banner">' + esc(flash) + '</div>' : '';
  if (!rows.length) return head + banner + '<div class="soon">Aucune réservation pour le moment.</div>';

  const stTag = (s) => {
    const m = {
      'pending-review': ['À valider', 'var(--red)'],
      active: ['Modélisation en cours', 'var(--green)'],
      submitted: ['Fichier déposé', '#2c6e9b'],
      suspended: ['Suspendue', '#b8860b'],
      cancelled: ['Annulée', 'var(--earth)'],
      expired: ['Expirée', 'var(--earth)'],
      done: ['Terminée', '#2c6e9b'],
    }[s] || [s, 'var(--earth)'];
    return '<span class="tag" style="background:' + m[1] + ';color:#fff">' + esc(m[0]) + '</span>';
  };
  const aiTag = (a) => {
    const v = (a || 'pending').split(' | ')[0];
    const raison = (a || '').split(' | ')[1] || '';
    const m = { ok: ['IA : cohérent', 'var(--green)'], suspect: ['IA : suspect', 'var(--red)'], pending: ['IA : en attente', 'var(--earth)'] }[v] || [v, 'var(--earth)'];
    return '<span class="tag" style="background:' + m[1] + ';color:#fff" title="' + esc(raison) + '">' + esc(m[0]) + '</span>' +
      (raison ? '<div class="muted" style="font-size:.76rem;margin-top:.3rem">« ' + esc(raison) + ' »</div>' : '');
  };
  const photo = (key) => key
    ? '<a href="/admin/reservation-photo/' + key.split('/').map(encodeURIComponent).join('/') + '" target="_blank">' +
      '<img src="/admin/reservation-photo/' + key.split('/').map(encodeURIComponent).join('/') + '" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"></a>'
    : '<span class="muted">—</span>';

  const btn = 'font-family:inherit;font-size:.76rem;font-weight:600;border:none;border-radius:7px;padding:.45rem .9rem;cursor:pointer';
  const cards = rows.map((r) => {
    const who = esc(r.email || r.user_id || '—');
    const noPhotos = !r.plate_key;
    let actions = '<form method="post" action="/admin/reservations" style="display:flex;gap:.5rem;margin-top:.7rem;flex-wrap:wrap;align-items:center">' +
      '<input type="hidden" name="id" value="' + esc(r.id) + '">';
    if (r.status === 'pending-review') {
      if (noPhotos) {
        actions += '<span class="muted" style="font-size:.78rem">En attente de ses photos — la pièce se libère seule si elles n\'arrivent pas.</span>';
      } else {
        actions += '<button name="action" value="validate" style="' + btn + ';background:var(--green);color:#fff" ' +
          'title="Donne le feu vert : 72 h pour déposer le fichier">Valider — démarrer les 72 h</button>';
      }
      actions += '<button name="action" value="cancel" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2">Refuser</button>';
    } else if (r.status === 'active' || r.status === 'submitted' || r.status === 'suspended') {
      if (r.status !== 'suspended') actions += '<button name="action" value="suspend" style="' + btn + ';background:#b8860b;color:#fff">Suspendre</button>';
      if (r.status === 'suspended') actions += '<button name="action" value="reactivate" style="' + btn + ';background:var(--green);color:#fff">Réactiver</button>';
      actions += '<button name="action" value="cancel" style="' + btn + ';background:#fff;color:var(--red);border:1px solid #f3c2c2">Annuler</button>';
    } else {
      actions += '<span class="muted" style="font-size:.78rem">' + (r.decided_by ? 'par ' + esc(r.decided_by) : '') + '</span>';
    }
    actions += '</form>';

    // La ligne de délai dit ce que l'échéance signifie À CETTE ÉTAPE : la même colonne
    // porte 2 h, 7 j, 72 h ou 60 j selon le statut, l'afficher sans le dire induirait
    // en erreur.
    const sens = r.status === 'pending-review' ? (noPhotos ? 'pour envoyer ses photos' : 'pour notre feu vert')
      : r.status === 'active' ? 'pour déposer le fichier'
      : r.status === 'submitted' ? 'de délai d\'examen (CGV art. 2.5)' : '';
    const rest = remaining(r.expires_at, now);
    const delai = sens && rest
      ? '<div class="muted" style="font-size:.78rem;margin:.4rem 0"><b>' + esc(rest) + '</b> ' + esc(sens) +
        (r.validated_at ? ' · feu vert le ' + fmtDate(r.validated_at) : '') +
        (r.extended_at ? ' · <span style="color:#b8860b">prolongée le ' + fmtDate(r.extended_at) + ' (non renouvelable)</span>' : '') +
        '</div>'
      : '';

    return '<div style="border:1px solid var(--line);border-radius:9px;padding:1rem;background:var(--cream);margin-bottom:.8rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap">' +
        '<div><strong style="font-size:.85rem">' + esc(r.piece_id) + '</strong><div class="muted" style="font-size:.8rem">' + who + '</div></div>' +
        '<div style="display:flex;gap:.4rem;align-items:center">' + stTag(r.status) + '</div>' +
      '</div>' + delai +
      '<div style="margin:.6rem 0">' + aiTag(r.ai_check) + '</div>' +
      '<div style="display:flex;gap:.7rem;margin:.6rem 0;flex-wrap:wrap">' +
        '<div><div class="muted" style="font-size:.72rem;margin-bottom:.2rem">Plaque signalétique</div>' + photo(r.plate_key) + '</div>' +
        '<div><div class="muted" style="font-size:.72rem;margin-bottom:.2rem">Appareil donneur</div>' + photo(r.object_key) + '</div>' +
        '<div><div class="muted" style="font-size:.72rem;margin-bottom:.2rem">La pièce' + (r.part_key ? '' : ' (non fournie)') + '</div>' + photo(r.part_key) + '</div>' +
      '</div>' + actions + '</div>';
  }).join('');
  return head + banner + cards;
}

// Exports nommés pour tests unitaires uniquement (le runtime n'utilise que `default`).
export { loadModelerApplications, decideModelerApplication, updatePartnerApplication, deletePartner, loadReservations, decideReservation,
  loadSubmissions, decideSubmission, remaining, viewReservations, viewModeles, handleDepot, viewDepot };

// ============================ ROUTAGE ============================

export default {
  async fetch(request, env, ctx) {
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

    // 3 bis bis) L'e-mail tapé sur le site public est-il un e-mail admin ? (pour rediriger
    // vers l'espace admin depuis le modal de connexion client, cf. js/client-auth.js).
    // Ne renvoie qu'un booléen — jamais la liste des e-mails admin elle-même.
    if (path === '/api/is-admin') {
      const email = (url.searchParams.get('email') || '').toLowerCase().trim();
      const allow = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
      return json({ isAdmin: !!email && allow.includes(email) }, 200, { 'Access-Control-Allow-Origin': '*' });
    }

    // 3 ter) API publique « Pièces » (pas de session : token pipeline ou lecture publique)
    if (path === '/api/pieces' && request.method === 'POST') return apiPiecesPost(request, env);
    if (path === '/api/pieces/regen') return apiPiecesRegen(request, env);
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
        '<link rel="icon" type="image/svg+xml" href="https://hub4fix.com/favicon-admin.svg">' +
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
    const pendingModelers = await countPendingModelers(env);

    // Fichier source 3D : upload (POST) et téléchargement (GET) — admin connecté uniquement.
    if (request.method === 'POST' && path === '/admin/upload3d') {
      return adminUpload3d(request, env, sess);
    }

    // Remplacement manuel de la référence privée (photo recadrée ou prise soi-même).
    if (request.method === 'POST' && path === '/admin/replace-original') {
      return adminReplaceOriginal(request, env, sess, ctx);
    }

    // Nettoyage des inscriptions (comptes test, doublons...) : marque "supprime_le"
    // et deplace la ligne en fin de feuille — jamais de suppression physique.
    if (request.method === 'POST' && path === '/admin/inscriptions/supprimer') {
      const redirect = (flash) => new Response(null, { status: 302, headers: { Location: '/admin/inscriptions?m=' + encodeURIComponent(flash) } });
      const form = await request.formData().catch(() => null);
      const type = form ? String(form.get('type') || '') : '';
      const email = form ? String(form.get('email') || '') : '';
      if (!type || !email) return redirect('type et email requis');
      try {
        const result = await markInscriptionDeleted(env, type, email);
        if (result.error === 'not-found') return redirect('Inscription introuvable ou déjà supprimée.');
        if (result.error) return redirect('Erreur : ' + result.error);
        await audit(env, sess.email, 'inscription-supprimer', type + ':' + email);
        return redirect('Inscription supprimée (archivée dans le Sheet).');
      } catch (e) {
        return redirect('Erreur serveur.');
      }
    }

    // Nettoyage en masse de tous les comptes marques test=true (genere par
    // tools/generate-test-partners.mjs).
    if (request.method === 'POST' && path === '/admin/inscriptions/nettoyer-test') {
      try {
        const result = await markAllTestDeleted(env);
        await audit(env, sess.email, 'inscriptions-nettoyer-test', String(result.count) + ' ligne(s)');
        return json(result);
      } catch (e) {
        return json({ error: 'Erreur serveur' }, 500);
      }
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
      const stamp = { validatedBy: sess.email, validatedAt: nowIso() };
      const note = (form.get('note') || '').toString().slice(0, 300);
      if (id && action === 'publish') {
        // publication = consigne de régénération consommée -> on l'efface
        await patchPiece(env, id, Object.assign({ status: 'published', regenHint: '' }, stamp));
        await audit(env, sess.email, 'piece-publish', id);
      } else if (id && action === 'regenerate') {
        // Non-correspondance original/H4F. La précision saisie est transmise à
        // l'IA ; sans saisie, la consigne précédente est gardée. La régénération
        // part IMMÉDIATEMENT en tâche de fond (l'admin continue de valider) ;
        // en cas d'échec cloud, le pipeline local prend le relais.
        //
        // Commandes force dans le champ note :
        //   /new [consigne]       -> repartir à zéro : efface la consigne mémorisée
        //                            (anti-artefacts quand la proposition est trop
        //                            éloignée), régénère depuis l'original + prompt
        //                            de base, avec l'éventuelle consigne neuve.
        //   /source [comment]     -> l'ORIGINAL est douteux ou indisponible : pas de
        //                            régénération (elle tournerait sur une mauvaise
        //                            base) ; la pièce part en re-sourcing de référence
        //                            (pipeline/agent), puis regénérera automatiquement.
        //                            (statut interne 'verify-original' conservé tel
        //                            quel — deja utilise par des lignes Sheet reelles)
        const cmd = note.match(/^\/(\w+)\s*([\s\S]*)$/);
        const cmdName = cmd ? cmd[1].toLowerCase() : '';
        if (cmdName === 'source') {
          const comment = (cmd[2] || '').trim();
          const patch = Object.assign({ status: 'verify-original' }, stamp);
          if (comment) patch.regenHint = comment;
          await patchPiece(env, id, patch);
          await audit(env, sess.email, 'piece-verify-original', id + (comment ? ' — ' + comment : ''));
        } else {
          const freshStart = cmdName === 'new';
          const hintNote = freshStart ? (cmd[2] || '').trim() : note;
          const patch = Object.assign({ status: 'regenerate' }, stamp);
          if (freshStart) patch.regenHint = hintNote; // remplace TOUJOURS (y compris par vide)
          else if (hintNote) patch.regenHint = hintNote;
          await patchPiece(env, id, patch);
          await audit(env, sess.email, 'piece-regenerate', id + (freshStart ? ' [/new]' : '') + (hintNote ? ' — ' + hintNote : ''));
          if (env.GEMINI_API_KEY && env.PIECES_R2) {
            const row = pdata.error ? null : pdata.rows.find((r) => r.id === id);
            const hint = freshStart ? hintNote : (hintNote || (row && row.regenHint) || '');
            const bg = regenerateCloud(env, id, hint);
            if (ctx && ctx.waitUntil) ctx.waitUntil(bg); else await bg;
          }
        }
      } else if (id && action === 'reject') {
        // Verdict métier définitif : fabrication additive non pertinente.
        await patchPiece(env, id, Object.assign({ status: 'rejected', rejectReason: note }, stamp));
        await audit(env, sess.email, 'piece-reject', id + (note ? ' — ' + note : ''));
      } else if (id && action === 'reactivate') {
        await patchPiece(env, id, Object.assign({ status: 'to-validate', rejectReason: '' }, stamp));
        await audit(env, sess.email, 'piece-reactivate', id);
      }
      return new Response(null, { status: 302, headers: { Location: '/admin/shadowlist' } });
    }
    if (path === '/admin/shadowlist') {
      return shell('/admin/shadowlist', sess, viewShadowList(pdata), 0, toValidate, pendingModelers);
    }

    // Candidatures modélisateur : décision (POST, admin/sous-admin) puis liste (GET).
    if (request.method === 'POST' && path === '/admin/modelisateurs') {
      if (sess.role !== 'admin' && sess.role !== 'sous-admin') return new Response('Interdit', { status: 403 });
      const form = await request.formData();
      const id = parseInt((form.get('id') || '').toString(), 10);
      const action = (form.get('action') || '').toString();
      let flash = '';
      if (id && (action === 'approve' || action === 'reject')) {
        const r = await decideModelerApplication(env, id, action, sess.email);
        flash = r.ok ? (action === 'approve' ? 'Candidature approuvée : le statut partenaire est désormais actif.' : 'Candidature rejetée.') : r.msg;
      } else if (id && action === 'edit') {
        const r = await updatePartnerApplication(env, id, form.get('motivation') || '', form.get('portfolio') || '', sess.email);
        flash = r.ok ? 'Candidature modifiée.' : r.msg;
      } else if (id && action === 'delete') {
        const r = await deletePartner(env, id, sess.email);
        flash = r.ok ? 'Candidature supprimée.' : r.msg;
      }
      return new Response(null, { status: 302, headers: { Location: '/admin/modelisateurs' + (flash ? '?m=' + encodeURIComponent(flash) : '') } });
    }
    if (path === '/admin/modelisateurs') {
      const apps = await loadModelerApplications(env);
      return shell('/admin/modelisateurs', sess, viewModelerApplications(apps, url.searchParams.get('m'), url.searchParams.get('edit')), 0, toValidate, pendingModelers);
    }

    // Photo de réservation (privée) — admin connecté uniquement, lue dans RESERV_R2.
    if (path.startsWith('/admin/reservation-photo/')) {
      const key = decodeURIComponent(path.slice('/admin/reservation-photo/'.length));
      if (!env.RESERV_R2) return new Response('R2 non lié', { status: 503 });
      const obj = await env.RESERV_R2.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
      return new Response(obj.body, { headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=300' } });
    }

    // Réservations : décision (POST, admin/sous-admin) puis liste (GET).
    if (request.method === 'POST' && path === '/admin/reservations') {
      if (sess.role !== 'admin' && sess.role !== 'sous-admin') return new Response('Interdit', { status: 403 });
      const form = await request.formData();
      const id = parseInt((form.get('id') || '').toString(), 10);
      const action = (form.get('action') || '').toString();
      let flash = '';
      if (id && ['validate', 'suspend', 'cancel', 'reactivate'].includes(action)) {
        const r = await decideReservation(env, id, action, sess.email);
        flash = r.ok ? (r.msg || 'Réservation mise à jour.') : r.msg;
      }
      return new Response(null, { status: 302, headers: { Location: '/admin/reservations' + (flash ? '?m=' + encodeURIComponent(flash) : '') } });
    }
    if (path === '/admin/reservations') {
      const resvs = await loadReservations(env);
      return shell('/admin/reservations', sess, viewReservations(resvs, url.searchParams.get('m')), 0, toValidate, pendingModelers);
    }

    // Fichier déposé par un modélisateur (source natif ou STEP) — admin connecté
    // uniquement. La clé R2 est relue EN BASE, jamais prise dans l'URL : sinon
    // l'adresse deviendrait un droit de lecture sur tout le bucket.
    if (path.startsWith('/admin/submission-file/')) {
      const parts = path.slice('/admin/submission-file/'.length).split('/');
      const subId = decodeURIComponent(parts[0] || '');
      const slot = parts[1] === 'step' ? 'step' : 'native';
      if (!env.SUBMIT_R2) return new Response('R2 non lié (SUBMIT_R2)', { status: 503 });
      if (!env.DB_PARTNER) return new Response('Base partenaire non liée', { status: 503 });
      const row = await env.DB_PARTNER.prepare(
        'SELECT native_key, native_name, step_key, step_name FROM submissions WHERE id = ?'
      ).bind(subId).first();
      if (!row) return new Response('Not found', { status: 404 });
      const key = slot === 'step' ? row.step_key : row.native_key;
      const name = slot === 'step' ? row.step_name : row.native_name;
      const obj = await env.SUBMIT_R2.get(key);
      if (!obj) return new Response('Fichier absent du stockage', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': 'attachment; filename="' + String(name || 'fichier').replace(/[^\w.\-]/g, '_') + '"',
          'Cache-Control': 'no-store',
        },
      });
    }

    // Dépôt interne : accès direct, sans passer par le tunnel modélisateur.
    if (request.method === 'POST' && path === '/admin/depot') {
      if (sess.role !== 'admin' && sess.role !== 'sous-admin') return new Response('Interdit', { status: 403 });
      let r;
      try { r = await handleDepot(env, await request.formData(), sess.email); }
      catch (e) { r = { ok: false, msg: 'Dépôt impossible : ' + String(e && e.message || e).slice(0, 200) }; }
      const q = r.ok ? '?m=' + encodeURIComponent(r.msg) : '?e=' + encodeURIComponent(r.msg);
      // Succès -> la file d'examen, là où le dossier vient d'atterrir. Échec -> on reste
      // sur le formulaire, avec le motif.
      return new Response(null, { status: 302, headers: { Location: (r.ok ? '/admin/modeles' : '/admin/depot') + q } });
    }
    if (path === '/admin/depot') {
      const pieces = await loadPieces(env);
      return shell('/admin/depot', sess, viewDepot(pieces, url.searchParams.get('m'), url.searchParams.get('e')), 0, toValidate, pendingModelers);
    }

    // Modèles 3D : décision d'examen (POST) puis file d'attente (GET).
    if (request.method === 'POST' && path === '/admin/modeles') {
      if (sess.role !== 'admin' && sess.role !== 'sous-admin') return new Response('Interdit', { status: 403 });
      const form = await request.formData();
      const id = (form.get('id') || '').toString();
      const action = (form.get('action') || '').toString();
      const note = (form.get('note') || '').toString();
      let flash = '';
      if (id && ['accept', 'correct', 'discard'].includes(action)) {
        const r = await decideSubmission(env, id, action, note, sess.email);
        flash = r.ok ? (r.msg || 'Dossier mis à jour.') : r.msg;
      }
      return new Response(null, { status: 302, headers: { Location: '/admin/modeles' + (flash ? '?m=' + encodeURIComponent(flash) : '') } });
    }
    if (path === '/admin/modeles') {
      const subs = await loadSubmissions(env);
      return shell('/admin/modeles', sess, viewModeles(subs, url.searchParams.get('m')), 0, toValidate, pendingModelers);
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
      return shell('/admin/admins', sess, viewAdmins(admins, sess), newCount, toValidate, pendingModelers);
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
      return shell('/admin/appareils', sess, viewDevices(devices, sess, url.searchParams.get('e')), newCount, toValidate, pendingModelers);
    }

    // Tableau de bord
    if (path === '/' || path === '/admin') {
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell('/admin', sess, viewDashboard(sess, data, seen, toValidate), newCount, toValidate, pendingModelers);
    }

    // Inscriptions : marque comme "vues" (met à jour le repère) après affichage
    if (path === '/admin/inscriptions') {
      const data = await loadInscriptions(env);
      data.seen = seen;
      const resp = shell('/admin/inscriptions', sess, viewInscriptions(data, url.searchParams.get('m')), 0, toValidate, pendingModelers);
      // après consultation, on déplace le repère "dernière visite" à maintenant
      resp.headers.append('Set-Cookie', setCookie('h4f_seen', new Date().toISOString(), SEEN_TTL));
      return resp;
    }

    if (SECTIONS[path]) {
      const data = await loadInscriptions(env);
      const newCount = data.error ? 0 : countNew(data.rows, seen);
      return shell(path, sess, SECTIONS[path](), newCount, toValidate, pendingModelers);
    }

    return new Response(null, { status: 302, headers: { Location: '/admin' } });
  },
};
