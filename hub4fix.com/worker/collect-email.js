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
 *
 * Prerequis : partager la feuille avec GOOGLE_SA_EMAIL en "Editeur".
 *
 * Ordre des colonnes (header a coller en ligne 1 de la feuille) :
 *   date | type | email | name | prenom | nom | tel | cp | ville | statut |
 *   parc_machines | materiaux | espace | dispo | logiciels | experience |
 *   capa | portfolio | message | consent_version | consent_at | source | ip_country
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
// ne bloque que si le MEME type est deja enregistre pour cet email/tel.
async function findDuplicate(env, type, email, tel) {
  const token = await getAccessToken(env);
  const tab = env.SHEET_TAB || 'Inscriptions';
  const range = encodeURIComponent(`${tab}!A2:G`); // date|type|email|name|prenom|nom|tel
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets read ${res.status}: ${await res.text()}`);
  const { values } = await res.json();
  if (!values) return null;

  const telNorm = tel ? normalizeTel(tel) : null;
  for (const row of values) {
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

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

    const { email, type, name, consent, fields } = data;
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
