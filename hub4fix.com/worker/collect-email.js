/**
 * Hub4Fix — Cloudflare Worker : collecte d'emails
 *
 * Recoit un POST { email, type, name? }
 *   type = "modelisateur" | "printer" | "client"
 *
 * Commit un fichier JSON dans le repo GitHub :
 *   leads/{type}/{timestamp}_{hash}.json
 *
 * Variables d'environnement requises (dans Cloudflare dashboard) :
 *   GITHUB_TOKEN  — Personal Access Token (fine-grained, contents:write)
 *   GITHUB_REPO   — "duclosjulien-h4f/hub4fix.com"
 *
 * Deploiement :
 *   1. Creer un Worker sur https://dash.cloudflare.com
 *   2. Coller ce code
 *   3. Ajouter les variables d'environnement (Settings > Variables)
 *   4. Publier
 */

const ALLOWED_ORIGINS = [
  'https://duclosjulien-h4f.github.io',
  'https://hub4fix.com',
  'https://www.hub4fix.com',
  'http://localhost:8765',
];

const VALID_TYPES = ['modelisateur', 'printer', 'client'];

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

// Hash simple pour generer un ID court a partir de l'email
async function shortHash(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(hash));
  return arr.slice(0, 4).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Valide le format email
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Commit un fichier dans le repo GitHub via l'API Contents
async function commitToGitHub(env, path, content, message) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`;

  // Verifier si le fichier existe deja (doublon)
  const check = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Hub4Fix-Worker',
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (check.status === 200) {
    return { exists: true };
  }

  // Creer le fichier
  const body = JSON.stringify({
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: 'main',
  });

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Hub4Fix-Worker',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${err}`);
  }

  return { exists: false, committed: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }

    // Parse le body
    let data;
    try {
      data = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400, origin);
    }

    const { email, type, name } = data;

    // Validation
    if (!email || !isValidEmail(email)) {
      return jsonResponse({ error: 'Email invalide' }, 400, origin);
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return jsonResponse({ error: `Type invalide. Attendu: ${VALID_TYPES.join(', ')}` }, 400, origin);
    }

    // Generer le chemin du fichier
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const hash = await shortHash(email.toLowerCase());
    const fileName = `${timestamp}_${hash}.json`;
    const filePath = `leads/${type}s/${fileName}`;

    // Contenu du fichier
    const fileContent = JSON.stringify({
      email: email.toLowerCase().trim(),
      type,
      name: name ? name.trim() : null,
      date: now.toISOString(),
      source: origin || 'unknown',
      ip_country: request.cf?.country || null,
    }, null, 2);

    // Commit dans GitHub
    try {
      const result = await commitToGitHub(
        env,
        filePath,
        fileContent,
        `lead: nouveau ${type} — ${email.split('@')[0]}@***`
      );

      if (result.exists) {
        return jsonResponse({ ok: true, message: 'Deja enregistre' }, 200, origin);
      }

      return jsonResponse({ ok: true, message: 'Inscription enregistree' }, 201, origin);
    } catch (err) {
      console.error('GitHub commit failed:', err.message);
      return jsonResponse({ error: 'Erreur serveur' }, 500, origin);
    }
  },
};
