/**
 * Hub4Fix — Worker "h4f-early" : inscriptions early access (modélisateurs / printers).
 *
 * Surface volontairement minimale : UNE route, POST /api/early-access. Ce worker ne lit rien
 * et n'écrit rien lui-même : après avoir filtré la requête, il TRANSMET l'inscription au
 * collecteur existant h4f-collect par une liaison interne (service binding COLLECT), qui
 * possède déjà l'accès au Google Sheet. Aucun secret Google n'est donc dupliqué ici.
 * Les inscriptions arrivent dans le même onglet que les autres, avec statut = "Early access".
 * Un profil = une ligne ; un double profil (modélisateur + printer) = deux lignes.
 *
 * Variables optionnelles :
 *   TURNSTILE_SECRET — si présent, le jeton Turnstile devient obligatoire
 * Binding optionnel : RATE_LIMITER (voir wrangler-early.toml) — limite par IP.
 */

const ALLOWED_ORIGINS = new Set([
  'https://hub4fix.com', 'https://www.hub4fix.com',
  'https://hub4fix.fr', 'https://www.hub4fix.fr',
  'https://hub4fix.net', 'https://www.hub4fix.net',
]);

const MAX_BODY = 8 * 1024;
const PROFILS = ['modelisateur', 'printer'];
// Longueur maximale par champ : borne la taille de la feuille et le bruit.
const LIMITS = {
  prenom: 80, nom: 80, email: 160, ville: 80, logiciels: 200, experience: 40,
  portfolio: 300, parc_machines: 300, materiaux: 200, dispo: 40, parcours: 2000, motivation: 2000,
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

function reply(status, body, origin) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? cors(origin) : {}),
    },
  });
}

// Texte brut, sans caractères de contrôle, tronqué. Aucune interprétation HTML ici : la
// feuille est écrite en RAW (une cellule "=..." reste du texte).
function clean(v, max) {
  if (Array.isArray(v)) v = v.join(', ');
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' }),
  });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

// Transmet UNE inscription au collecteur existant (liaison interne, jamais publique).
async function forward(env, profil, f, consentAt) {
  const msg = [];
  if (f.parcours) msg.push('PARCOURS : ' + f.parcours);
  msg.push('MOTIVATION : ' + f.motivation);
  const res = await env.COLLECT.fetch('https://h4f-collect.internal/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://hub4fix.com' },
    body: JSON.stringify({
      email: f.email, type: profil, name: f.prenom,
      consent: { version: 'early-access-2026-10', at: consentAt },
      fields: {
        prenom: f.prenom, nom: f.nom, ville: f.ville, statut: 'Early access',
        logiciels: f.logiciels, experience: f.experience, portfolio: f.portfolio,
        parc_machines: f.parc_machines, materiaux: f.materiaux, dispo: f.dispo,
        message: msg.join('\n\n'),
      },
    }),
  });
  // 409 = déjà inscrit avec ce profil : succès silencieux (on ne révèle pas qu'une adresse existe).
  if (!res.ok && res.status !== 409) throw new Error('collect ' + res.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (url.pathname !== '/api/early-access') return reply(404, { error: 'not-found' });

    if (request.method === 'OPTIONS') {
      return ALLOWED_ORIGINS.has(origin) ? new Response(null, { status: 204, headers: cors(origin) }) : reply(403, { error: 'forbidden' });
    }
    if (request.method !== 'POST') return reply(405, { error: 'method' });
    // CORS n'empêche pas curl : on refuse aussi côté serveur toute origine inconnue.
    if (!ALLOWED_ORIGINS.has(origin)) return reply(403, { error: 'forbidden' });
    if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return reply(415, { error: 'type' }, origin);

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip || 'anon' });
      if (!success) return reply(429, { error: 'trop-de-demandes' }, origin);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return reply(413, { error: 'trop-gros' }, origin);
    let d;
    try { d = JSON.parse(raw); } catch { return reply(400, { error: 'json' }, origin); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return reply(400, { error: 'json' }, origin);

    // Champ piège rempli : on répond "ok" sans rien écrire (le robot ne sait pas qu'il est repéré).
    if (d.website) return reply(201, { ok: true }, origin);

    if (!(await verifyTurnstile(env, d.turnstile, ip))) return reply(403, { error: 'verification' }, origin);

    const profils = (Array.isArray(d.profils) ? d.profils : []).filter((p) => PROFILS.includes(p));
    const f = {};
    for (const k of Object.keys(LIMITS)) f[k] = clean(d[k], LIMITS[k]);
    if (!profils.length || !f.prenom || !f.ville || !f.motivation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) {
      return reply(400, { error: 'champs' }, origin);
    }
    // Minimum de sens, doublé côté serveur : la page seule se contourne.
    if (f.prenom.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 2 || f.motivation.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 25
        || /(.)\1{5,}/i.test(f.motivation)) {
      return reply(400, { error: 'champs' }, origin);
    }
    f.email = f.email.toLowerCase();
    if (d.consent !== true) return reply(400, { error: 'consentement' }, origin);

    try {
      const at = new Date().toISOString();
      for (const p of new Set(profils)) await forward(env, p, f, at);
      return reply(201, { ok: true }, origin);
    } catch (e) {
      console.error('early-access forward failed:', e.message);
      return reply(500, { error: 'serveur' }, origin);
    }
  },
};
