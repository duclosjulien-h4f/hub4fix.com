/**
 * Hub4Fix — Worker "h4f-partenaire" : espace des modélisateurs / printers.
 *
 * Connexion OIDC vers Zitadel (Authorization Code + PKCE), passkey/Google.
 * PAS de liste blanche : tout utilisateur Zitadel connecté est admis, mais on
 * l'identifie par son e-mail dans le Google Sheet des inscriptions. S'il n'y est
 * pas → page "inscris-toi d'abord".
 *
 * Variables d'environnement (Cloudflare > Settings > Variables) :
 *   ISSUER          = https://hub4fix-l2itdp.ch1.zitadel.cloud
 *   CLIENT_ID       = 379554201174305525   (application "Espace Partenaire")
 *   SESSION_SECRET  = (secret aléatoire long, DIFFÉRENT de l'admin)          [Secret]
 *   SHEET_ID        = 1SQ2HoBMVUzFITHjZEaztyq7yOtyLUA8cH-6WMd6x_s8
 *   GOOGLE_SA_EMAIL = h4f-sheets@hub4fix.iam.gserviceaccount.com
 *   GOOGLE_SA_KEY   = clé privée du compte de service (lecture du Sheet)     [Secret]
 *   SHEET_TAB       = Inscriptions (optionnel)
 *   SITE_URL        = https://hub4fix.com (optionnel, pour les liens d'inscription)
 *
 * URI de redirection : <origin>/auth/callback
 * À venir : dépôt de fichiers 3D (#2), configuration des paiements (#3).
 */

const SCOPES = 'openid profile email';
const SESSION_TTL = 60 * 60 * 8;
const TMP_TTL = 60 * 10;

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
  try { const o = JSON.parse(b64urlStrDecode(p)); if (o.exp && o.exp < Math.floor(Date.now() / 1000)) return null; return o; } catch { return null; }
}
function getCookie(request, name) { const c = request.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
function setCookie(name, value, maxAge) { return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`; }
function killCookie(name) { return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

let _disc = null;
async function discovery(env) {
  if (_disc) return _disc;
  const r = await fetch(env.ISSUER.replace(/\/$/, '') + '/.well-known/openid-configuration');
  _disc = await r.json();
  return _disc;
}
async function pkce() { const v = b64urlBytes(crypto.getRandomValues(new Uint8Array(32))); return { verifier: v, challenge: b64urlBytes(await sha256(v)) }; }

// ---- lecture du Sheet (compte de service, lecture seule) ----
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
  const claim = { iss: env.GOOGLE_SA_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = b64urlStr(JSON.stringify(header)) + '.' + b64urlStr(JSON.stringify(claim));
  const key = await importPkcs8(env.GOOGLE_SA_KEY);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + unsigned + '.' + b64urlBytes(sig) });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token');
  _g = { t: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}
async function inscriptionsFor(env, email) {
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
    const rows = v.slice(1).map((a) => { const o = {}; header.forEach((h, i) => (o[h] = a[i] || '')); return o; })
      .filter((o) => (o.email || '').toLowerCase().trim() === email);
    return { rows };
  } catch { return { error: 'exception' }; }
}

function htmlResponse(body, status) { return new Response(body, { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }); }

const STYLE = `
:root{--red:#C8102E;--ink:#1C1A18;--earth:#7A7268;--cream:#F3EEE8;--line:#EDE6DC;--ivory:#FAF8F5;--green:#2D8B5E;--gold:#B8963E}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Karla',sans-serif;color:var(--ink);background:var(--ivory)}
.top{background:#fff;border-bottom:1px solid var(--line);padding:1rem 2rem;display:flex;justify-content:space-between;align-items:center}
.brand{font-family:'Cormorant Garamond',serif;font-size:1.25rem;font-weight:600}
.brand sup{color:var(--red)}.brand span{font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--earth);font-weight:600;margin-left:.4rem}
.top a{color:var(--earth);text-decoration:none;font-size:.82rem}.top a:hover{color:var(--red)}
.main{max-width:860px;margin:2.4rem auto;padding:0 1.4rem}
h1{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:2rem;margin-bottom:.3rem}
.sub{color:var(--earth);margin-bottom:1.8rem}
.tag{display:inline-block;font-size:.72rem;font-weight:600;border-radius:6px;padding:.12rem .5rem;margin-left:.4rem}
.tag.printer{background:#e8f1f8;color:#2c6e9b}.tag.modelisateur{background:#f5ece5;color:#a0522d}.tag.client{background:var(--cream);color:var(--earth)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1.4rem 1.6rem;margin-bottom:1.1rem}
.card h3{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:1.2rem;margin-bottom:.4rem}
.card p{color:var(--earth);line-height:1.6;font-size:.92rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
.action{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:1.3rem 1.4rem;text-decoration:none;color:var(--ink)}
.action:hover{border-color:var(--red)}
.action .t{font-weight:600;margin-bottom:.25rem}.action .d{color:var(--earth);font-size:.85rem}
.soon{color:var(--earth);font-size:.82rem;font-style:italic;margin-top:.4rem}
.btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:.8rem 1.6rem;border-radius:8px;font-weight:600}
.row{font-size:.88rem;color:var(--earth);margin:.2rem 0}
.row b{color:var(--ink);font-weight:600}
`;

function layout(title, body) {
  return htmlResponse(
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(title) + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Karla:wght@400;500;600&display=swap" rel="stylesheet">' +
    '<style>' + STYLE + '</style></head><body>' + body + '</body></html>'
  );
}

function shellTop(sess) {
  const banner = (sess && sess.demo)
    ? '<div style="background:var(--gold);color:#fff;text-align:center;padding:.45rem 1rem;font-size:.82rem;font-weight:600">MODE DÉMO — exploration libre, aucune action réelle · ⬡ ' + (sess.tokens || 0) + ' tokens virtuels</div>'
    : '';
  return banner + '<div class="top"><div class="brand">Hub<sup>4</sup>Fix<span>Espace partenaire</span></div>' +
    '<div>' + (sess ? esc(sess.name) + ' · <a href="/auth/logout">' + (sess.demo ? 'Quitter la démo' : 'Déconnexion') + '</a>' : '') + '</div></div>';
}

function dashboard(sess, rows) {
  const types = [...new Set(rows.map((r) => (r.type || '').toLowerCase()).filter(Boolean))];
  const tags = types.map((t) => '<span class="tag ' + esc(t) + '">' + esc(t) + '</span>').join('');
  const last = rows[rows.length - 1] || {};
  return shellTop(sess) + '<div class="main">' +
    '<h1>Bonjour ' + esc(sess.name) + tags + '</h1>' +
    '<p class="sub">Bienvenue dans ton espace partenaire Hub⁴Fix.</p>' +
    '<div class="card"><h3>Mon profil</h3>' +
      '<div class="row"><b>E-mail :</b> ' + esc(sess.email) + '</div>' +
      (last.tel ? '<div class="row"><b>Téléphone :</b> ' + esc(last.tel) + '</div>' : '') +
      (last.ville ? '<div class="row"><b>Ville :</b> ' + esc(last.ville) + '</div>' : '') +
      '<div class="row"><b>Inscription(s) :</b> ' + (types.join(', ') || '—') + '</div>' +
    '</div>' +
    '<div class="grid">' +
      '<a class="action" href="#"><div class="t">Mes modèles 3D</div><div class="d">Déposer et suivre mes fichiers.</div><div class="soon">à venir</div></a>' +
      '<a class="action" href="#"><div class="t">Mes paiements</div><div class="d">Configurer mes coordonnées bancaires (via prestataire sécurisé).</div><div class="soon">à venir</div></a>' +
    '</div></div>';
}

function notFound(sess, siteUrl) {
  return shellTop(sess) + '<div class="main">' +
    '<h1>Aucune inscription trouvée</h1>' +
    '<p class="sub">Le compte <b>' + esc(sess.email) + '</b> n\'est lié à aucune inscription Hub⁴Fix.</p>' +
    '<div class="card"><p>Pour rejoindre le réseau, inscris-toi d\'abord comme printer ou modélisateur, avec <b>cette même adresse e-mail</b>.</p>' +
    '<p style="margin-top:1rem"><a class="btn" href="' + esc(siteUrl) + '/printer.html">Devenir printer</a> &nbsp; ' +
    '<a class="btn" style="background:#a0522d" href="' + esc(siteUrl) + '/modelisateur.html">Devenir modélisateur</a></p></div>' +
    '<p style="margin-top:1rem"><a href="/auth/logout" style="color:var(--earth)">Se déconnecter</a></p></div>';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const redirectUri = origin + '/auth/callback';
    const path = url.pathname;
    const siteUrl = (env.SITE_URL || 'https://hub4fix.com').replace(/\/$/, '');

    if (path === '/auth/login') {
      const d = await discovery(env);
      const { verifier, challenge } = await pkce();
      const state = b64urlBytes(crypto.getRandomValues(new Uint8Array(16)));
      const tmp = await makeToken(env.SESSION_SECRET, { v: verifier, st: state, exp: Math.floor(Date.now() / 1000) + TMP_TTL });
      const a = new URL(d.authorization_endpoint);
      a.searchParams.set('client_id', env.CLIENT_ID);
      a.searchParams.set('redirect_uri', redirectUri);
      a.searchParams.set('response_type', 'code');
      a.searchParams.set('scope', SCOPES);
      a.searchParams.set('state', state);
      a.searchParams.set('code_challenge', challenge);
      a.searchParams.set('code_challenge_method', 'S256');
      return new Response(null, { status: 302, headers: { Location: a.toString(), 'Set-Cookie': setCookie('h4f_ptmp', tmp, TMP_TTL) } });
    }

    if (path === '/auth/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const tmp = await readToken(env.SESSION_SECRET, getCookie(request, 'h4f_ptmp'));
      if (!code || !tmp || tmp.st !== state) return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Connexion invalide. <a href="/auth/login">Réessayer</a></p>', 400);
      const d = await discovery(env);
      const tr = await fetch(d.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: env.CLIENT_ID, code_verifier: tmp.v }) });
      if (!tr.ok) return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">Échec du jeton. <a href="/auth/login">Réessayer</a></p>', 502);
      const tok = await tr.json();
      const ui = await fetch(d.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tok.access_token } });
      const info = await ui.json();
      const email = (info.email || '').toLowerCase().trim();
      if (!email) return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:4rem">E-mail introuvable.</p>', 400);
      const name = ((info.given_name || '') + ' ' + (info.family_name || '')).trim() || info.name || email;
      const sess = await makeToken(env.SESSION_SECRET, { sub: info.sub, email, name, exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
      const h = new Headers();
      h.append('Set-Cookie', setCookie('h4f_psession', sess, SESSION_TTL));
      h.append('Set-Cookie', killCookie('h4f_ptmp'));
      h.append('Location', '/');
      return new Response(null, { status: 302, headers: h });
    }

    if (path === '/auth/logout') {
      const d = await discovery(env);
      const h = new Headers();
      h.append('Set-Cookie', killCookie('h4f_psession'));
      let loc = origin + '/';
      if (d.end_session_endpoint) { const e = new URL(d.end_session_endpoint); e.searchParams.set('post_logout_redirect_uri', origin + '/'); e.searchParams.set('client_id', env.CLIENT_ID); loc = e.toString(); }
      h.append('Location', loc);
      return new Response(null, { status: 302, headers: h });
    }

    // Mode démo : session sans authentification, aucune incidence réelle.
    if (path === '/demo') {
      const demo = await makeToken(env.SESSION_SECRET, {
        demo: true, name: 'Compte Démo', email: 'demo@hub4fix.com',
        types: ['printer', 'modelisateur'], tokens: 5,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
      });
      const h = new Headers();
      h.append('Set-Cookie', setCookie('h4f_psession', demo, SESSION_TTL));
      h.append('Location', '/');
      return new Response(null, { status: 302, headers: h });
    }

    // Protégé
    const sess = await readToken(env.SESSION_SECRET, getCookie(request, 'h4f_psession'));
    if (!sess) {
      return layout('Espace partenaire', shellTop(null) +
        '<div class="main" style="text-align:center;margin-top:4rem">' +
        '<h1>Espace partenaire</h1><p class="sub">Modélisateurs et printers Hub⁴Fix.</p>' +
        '<a class="btn" href="/auth/login">Se connecter</a>' +
        '<p style="margin-top:1.3rem"><a href="/demo" style="color:var(--earth);font-size:.9rem;text-decoration:none">Explorer en mode démo →</a></p></div>');
    }
    // Démo : tableau de bord simulé (printer + modélisateur), sans lecture du Sheet.
    if (sess.demo) {
      const demoRows = [
        { type: 'printer', tel: '06 00 00 00 00', ville: 'Démoville' },
        { type: 'modelisateur', portfolio: 'https://exemple.fr' },
      ];
      return layout('Espace partenaire — démo', dashboard(sess, demoRows));
    }

    const res = await inscriptionsFor(env, sess.email);
    if (res.error) {
      return layout('Espace partenaire', shellTop(sess) + '<div class="main"><h1>Service indisponible</h1><p class="sub">Impossible de vérifier ton inscription pour le moment. Réessaie plus tard.</p></div>');
    }
    if (!res.rows.length) return layout('Espace partenaire', notFound(sess, siteUrl));
    return layout('Espace partenaire', dashboard(sess, res.rows));
  },
};
