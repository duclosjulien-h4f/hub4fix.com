/**
 * Hub4Fix — Cloudflare Worker : collecte d'inscriptions vers Google Sheets
 *
 * Recoit un POST { email, type, name?, consent?, fields? }
 *   type = "modelisateur" | "printer" | "client"
 *
 * Ajoute chaque inscription comme UNE ligne dans un Google Sheet PRIVE.
 * La feuille est le document de travail vivant (editable, suppressions
 * durables, historique de versions Google = filet de securite).
 *
 * Variables d'environnement (Cloudflare > Settings > Variables) :
 *   SHEET_ID         — id du Google Sheet (dans l'URL .../d/<SHEET_ID>/edit)
 *   GOOGLE_SA_EMAIL  — email du compte de service (xxx@yyy.iam.gserviceaccount.com)
 *   GOOGLE_SA_KEY    — "private_key" du JSON de compte de service (PEM, secret)
 *   SHEET_TAB        — nom de l'onglet (optionnel, defaut "Inscriptions")
 *   CLIENT_SHEET_ID  — Sheet DEDIE aux clients B2C (separe des partenaires),
 *                      utilise par la route POST /client-login
 *   CLIENT_SHEET_TAB — nom de l'onglet clients (optionnel, defaut "Clients")
 *
 * Prerequis : partager les deux feuilles avec GOOGLE_SA_EMAIL en "Editeur".
 *
 * Route POST /client-login { email, prenom?, sub? } — appelee par
 * auth-callback.html apres un vrai login Zitadel reussi. Un seul
 * enregistrement par email (pas de doublon a chaque reconnexion).
 *
 * Ordre des colonnes (header a coller en ligne 1 de la feuille) :
 *   date | type | email | name | prenom | nom | tel | cp | ville | statut |
 *   parc_machines | materiaux | espace | dispo | logiciels | experience |
 *   capa | portfolio | message | consent_version | consent_at | source | ip_country | test
 *
 * "test" = "true" pour un compte genere par tools/generate-test-partners.mjs
 * (nettoyable en masse via POST /admin/inscriptions/nettoyer-test, worker h4f-admin).
 * "supprime_le" est ajoutee automatiquement en fin de colonnes par ce nettoyage.
 */

const ALLOWED_ORIGINS = [
  'https://duclosjulien-h4f.github.io',
  'https://hub4fix.com',
  'https://www.hub4fix.com',
  'http://localhost:8765',
  'http://localhost:9090',
];

const VALID_TYPES = ['modelisateur', 'printer', 'client'];

// Ordre des champs du formulaire dans la ligne (apres date/type/email/name)
const FIELDS_ORDER = [
  'prenom', 'nom', 'tel', 'cp', 'ville', 'statut',
  'parc_machines', 'materiaux', 'espace', 'dispo',
  'logiciels', 'experience', 'capa', 'portfolio', 'message',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- base64url helpers ----
function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Importe la cle privee PEM (gere le PEM brut ou la version JSON avec \n)
async function importPrivateKey(pem) {
  const body = pem
    .replace(/-----[^-]+-----/g, '') // enleve les en-tetes BEGIN/END
    .replace(/\\n/g, '')              // \n litteraux (cas JSON colle)
    .replace(/\s+/g, '');             // espaces / vrais sauts de ligne
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

// Cache du token dans l'isolat (evite de re-signer a chaque requete)
let _tokenCache = { token: null, exp: 0 };

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp > now + 60) return _tokenCache.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await importPrivateKey(env.GOOGLE_SA_KEY);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`OAuth: ${JSON.stringify(j)}`);
  _tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}

function buildRow(record) {
  const f = record.fields || {};
  const c = record.consent || {};
  const fmt = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));
  return [
    record.date, record.type, record.email, record.name || '',
    ...FIELDS_ORDER.map((k) => fmt(f[k])),
    c.version || '', c.at || '', record.source || '', record.ip_country || '',
    record.test ? 'true' : '', // colonne "test" : marque un compte genere pour les tests, nettoyable en masse
  ];
}

// Normalise un numero de tel pour comparaison (garde uniquement les chiffres,
// tronque a 9 chiffres pour ignorer les variations d'indicatif/0 initial).
function normalizeTel(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.slice(-9);
}

// Doublon verifie PAR TYPE (modelisateur/printer/client) : un meme email peut
// legitimement cumuler plusieurs profils (ex. modelisateur + printer), donc on
// ne bloque que si le MEME type est deja enregistre pour cet email/tel. Les
// lignes marquees "supprime_le" (nettoyage admin) sont ignorees — un email
// nettoye redevient utilisable.
async function findDuplicate(env, type, email, tel) {
  const token = await getAccessToken(env);
  const tab = env.SHEET_TAB || 'Inscriptions';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${encodeURIComponent(tab)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read ${res.status}: ${await res.text()}`);
  const { values } = await res.json();
  if (!values || values.length < 2) return null;

  const header = values[0];
  const delCol = header.findIndex((h) => h === 'supprime_le');
  const telNorm = tel ? normalizeTel(tel) : null;

  for (const row of values.slice(1)) {
    if (delCol !== -1 && row[delCol]) continue; // ligne nettoyee : ignoree
    const rowType = (row[1] || '').trim();
    if (rowType !== type) continue;
    const rowEmail = (row[2] || '').trim().toLowerCase();
    if (rowEmail === email) return 'email';
    if (telNorm && telNorm.length >= 8) {
      const rowTel = normalizeTel(row[6]);
      if (rowTel && rowTel === telNorm) return 'tel';
    }
  }
  return null;
}

async function appendToSheet(env, row) {
  const token = await getAccessToken(env);
  const tab = env.SHEET_TAB || 'Inscriptions';
  const range = encodeURIComponent(`${tab}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${range}:append`
    + `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
}

// Centralisation des clients B2C — Sheet DEDIE (env.CLIENT_SHEET_ID), separe
// des inscriptions partenaires. Un seul enregistrement par email (pas de ligne
// dupliquee a chaque reconnexion) : appele depuis auth-callback.html apres un
// vrai login Zitadel reussi.
async function appendClientIfNew(env, { email, prenom, sub }) {
  if (!env.CLIENT_SHEET_ID) throw new Error('CLIENT_SHEET_ID non configure');
  const token = await getAccessToken(env);
  const tab = env.CLIENT_SHEET_TAB || 'Clients';
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.CLIENT_SHEET_ID}/values/${encodeURIComponent(tab)}`;
  const r = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Sheets read ${r.status}: ${await r.text()}`);
  const { values } = await r.json();
  const emailLower = email.toLowerCase().trim();
  if (values && values.length > 1) {
    const exists = values.slice(1).some((row) => (row[1] || '').toLowerCase().trim() === emailLower);
    if (exists) return { ok: true, alreadyExists: true };
  }
  const range = encodeURIComponent(`${tab}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.CLIENT_SHEET_ID}/values/${range}:append`
    + `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[new Date().toISOString(), emailLower, prenom || '', sub || '']] }),
  });
  if (!res.ok) throw new Error(`Sheets ${res.status}: ${await res.text()}`);
  return { ok: true, alreadyExists: false };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
    }

    // Centralisation client (post-login Zitadel reel) : { email, prenom?, sub? }
    if (url.pathname === '/client-login') {
      if (!data.email || !isValidEmail(data.email)) {
        return jsonResponse({ error: 'Email invalide' }, 400, origin);
      }
      try {
        const result = await appendClientIfNew(env, data);
        return jsonResponse(result, 200, origin);
      } catch (err) {
        console.error('client-login failed:', err.message);
        return jsonResponse({ error: 'Erreur serveur' }, 500, origin);
      }
    }

    const { email, type, name, consent, fields, test } = data;
    if (!email || !isValidEmail(email)) {
      return jsonResponse({ error: 'Email invalide' }, 400, origin);
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return jsonResponse({ error: `Type invalide. Attendu: ${VALID_TYPES.join(', ')}` }, 400, origin);
    }

    const record = {
      date: new Date().toISOString(),
      email: email.toLowerCase().trim(),
      type,
      name: name ? String(name).trim() : null,
      source: origin || 'unknown',
      ip_country: request.cf?.country || null,
      consent: consent || null,
      fields: fields || null,
      test: !!test,
    };

    try {
      const tel = (fields && fields.tel) || null;
      const dup = await findDuplicate(env, type, record.email, tel);
      if (dup) {
        const label = dup === 'email' ? 'cet email' : 'ce numero de telephone';
        return jsonResponse({ error: `Une inscription ${type} existe deja avec ${label}.` }, 409, origin);
      }
      await appendToSheet(env, buildRow(record));
      return jsonResponse({ ok: true, message: 'Inscription enregistree' }, 201, origin);
    } catch (err) {
      console.error('sheet append failed:', err.message);
      return jsonResponse({ error: 'Erreur serveur' }, 500, origin);
    }
  },
};
