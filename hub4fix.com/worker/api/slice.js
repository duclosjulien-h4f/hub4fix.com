/**
 * Hub4Fix — passerelle Cloud Slicer.
 *
 * Le Worker ne slice pas : les Workers Cloudflare ne peuvent pas exécuter
 * OrcaSlicer. Il tient ce que le service de slicing n'a pas le droit de savoir —
 * qui est le client, ce qu'il possède, ce qu'il paie — et délègue le calcul.
 *
 *   client -> Worker (session, propriété, token) -> service /slice -> G-code tracé
 *
 * Trois règles portent tout le reste :
 *
 * 1. Le débit d'un token est IDEMPOTENT. La référence du débit est le job_id, et
 *    un index unique (motif, ref) l'impose en base. Un client qui rafraîchit, un
 *    réseau qui renvoie, un retry : le solde ne bouge qu'une fois.
 * 2. Un slice raté REMBOURSE. Le client n'a rien reçu, il ne paie pas. Le
 *    remboursement est protégé par le même index : jamais versé deux fois.
 * 3. Le slice est le POINT DE NON-RETOUR. On exige le consentement à l'exécution
 *    immédiate ici, et on l'enregistre — c'est ce qui rend l'achat non
 *    remboursable ensuite, et seulement ensuite.
 *
 * Bindings attendus (wrangler.toml) :
 *   SLICER_URL     URL du service de slicing (ex. https://slicer.hub4fix.com)
 *   SLICER_SECRET  secret partagé (wrangler secret put SLICER_SECRET)
 */

const CONSENT_DOC = 'renonciation-retractation-slice';
const CONSENT_VERSION = '2026-08';
const SAFE_ID = /^[A-Za-z0-9_.-]{1,64}$/;

function nowIso() { return new Date().toISOString(); }

/** Le nom du 3MF maître encode la machine : une pièce a un maître par machine
 *  préparée. Tant que le normalisateur n'existe pas (Phase 2), c'est ainsi que
 *  le choix machine du client atteint le service. */
function sourceIdFor(productId, printer) {
  return printer ? `${productId}--${printer}` : productId;
}

async function callSlicer(env, path, init) {
  const base = (env.SLICER_URL || '').replace(/\/+$/, '');
  if (!base || !env.SLICER_SECRET) throw new Error('slicer_not_configured');
  return await fetch(base + path, {
    ...init,
    headers: { 'X-H4F-Secret': env.SLICER_SECRET, ...((init && init.headers) || {}) },
  });
}

/** Débit atomique : l'insertion ne se produit QUE si le solde le permet. Écrit en
 *  une seule requête pour que deux slices lancés en parallèle ne puissent pas
 *  passer tous les deux sur le dernier token. */
async function debitToken(env, uid, jobId) {
  const res = await env.DB.prepare(
    "INSERT INTO token_ledger (user_id, delta, motif, ref, created_at) " +
    "SELECT ?1, -1, 'slice', ?2, ?3 " +
    "WHERE (SELECT COALESCE(SUM(delta),0) FROM token_ledger WHERE user_id = ?1) >= 1"
  ).bind(uid, jobId, nowIso()).run();
  return res.meta && res.meta.changes === 1;
}

/** Remboursement. L'index unique (motif, ref) rend l'appel sans risque même
 *  répété : la seconde tentative échoue en base et on l'ignore. */
async function refundToken(env, uid, jobId) {
  try {
    await env.DB.prepare(
      "INSERT INTO token_ledger (user_id, delta, motif, ref, created_at) VALUES (?, 1, 'slice_refund', ?, ?)"
    ).bind(uid, jobId, nowIso()).run();
  } catch (e) { /* déjà remboursé */ }
  await env.DB.prepare('UPDATE slice_jobs SET refunded = 1 WHERE id = ?').bind(jobId).run();
}

async function ownsProduct(env, uid, productId) {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM purchases WHERE user_id = ? AND product_id = ? LIMIT 1'
  ).bind(uid, productId).first();
  return !!row;
}

async function requireSession(request, env, deps) {
  const data = await deps.readToken(deps.getSessionToken(request), env.SESSION_SECRET);
  return data && data.uid ? data.uid : null;
}

// ---------------------------------------------------------------- POST /slice
export async function handleSliceCreate(request, env, origin, deps) {
  const { json } = deps;
  const uid = await requireSession(request, env, deps);
  if (!uid) return json({ error: 'non_authentifie' }, 401, origin);

  const body = await request.json().catch(() => ({}));
  const productId = String(body.product_id || '').trim();
  const printer = String(body.printer || '').trim();

  if (!SAFE_ID.test(productId)) return json({ error: 'product_id_invalide' }, 400, origin);
  if (printer && !SAFE_ID.test(printer)) return json({ error: 'printer_invalide' }, 400, origin);

  // Le client doit posséder le fichier. Le service, lui, ne connaît pas les clients.
  if (!await ownsProduct(env, uid, productId)) {
    return json({ error: 'non_possede', message: "Cette pièce n'est pas dans votre bibliothèque." }, 403, origin);
  }

  // Point de non-retour : sans consentement explicite, on ne slice pas. Avant ce
  // moment l'achat reste annulable ; après, il ne l'est plus.
  if (body.consent !== true) {
    return json({
      error: 'consentement_requis',
      message: "La génération du G-code démarre l'exécution immédiate : elle met fin au droit de rétractation.",
      doc: CONSENT_DOC, version: CONSENT_VERSION,
    }, 428, origin);
  }

  const jobId = crypto.randomUUID();
  const sourceId = sourceIdFor(productId, printer);

  if (!await debitToken(env, uid, jobId)) {
    return json({ error: 'solde_insuffisant', message: 'Il vous faut au moins 1 token pour générer un G-code.' }, 402, origin);
  }

  await env.DB.prepare(
    'INSERT INTO slice_jobs (id, user_id, product_id, source_id, printer, status, created_at) ' +
    "VALUES (?, ?, ?, ?, ?, 'queued', ?)"
  ).bind(jobId, uid, productId, sourceId, printer || null, nowIso()).run();

  await env.DB.prepare(
    'INSERT INTO consents (user_id, doc, version, accepted_at) VALUES (?, ?, ?, ?)'
  ).bind(uid, CONSENT_DOC, CONSENT_VERSION, nowIso()).run();

  // ICI viendra la capture du paiement Stripe préautorisé (le slice est
  // l'événement qui déclenche le prélèvement, cf. TodoList.md). Tant qu'elle
  // n'existe pas, un échec après ce point ne laisse rien à annuler côté paiement.

  let accepted = false;
  try {
    const res = await callSlicer(env, '/slice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, source_id: sourceId }),
    });
    accepted = res.ok;
    if (!accepted) {
      const detail = (await res.text()).slice(0, 300);
      await env.DB.prepare("UPDATE slice_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
        .bind('service ' + res.status + ': ' + detail, nowIso(), jobId).run();
    }
  } catch (err) {
    await env.DB.prepare("UPDATE slice_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
      .bind(String(err && err.message || err), nowIso(), jobId).run();
  }

  if (!accepted) {
    // Le service n'a jamais pris le travail : le client ne doit pas le payer.
    await refundToken(env, uid, jobId);
    return json({ error: 'slicer_indisponible', job_id: jobId, refunded: true }, 503, origin);
  }

  return json({ job_id: jobId, status: 'queued', tokens: await deps.tokenBalance(env, uid) }, 202, origin);
}

// ---------------------------------------------------------------- GET /slice/:id
export async function handleSliceStatus(request, env, origin, deps, jobId) {
  const { json } = deps;
  const uid = await requireSession(request, env, deps);
  if (!uid) return json({ error: 'non_authentifie' }, 401, origin);

  const job = await env.DB.prepare('SELECT * FROM slice_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, uid).first();
  if (!job) return json({ error: 'job_inconnu' }, 404, origin);

  // Terminé : l'état local fait foi, inutile de redemander au service.
  if (job.status === 'done' || (job.status === 'failed' && job.refunded)) {
    return json({
      job_id: job.id, status: job.status, sn: job.sn,
      engine_image: job.engine_image, error: job.error, refunded: !!job.refunded,
    }, 200, origin);
  }

  let remote = null;
  try {
    const res = await callSlicer(env, '/slice/' + encodeURIComponent(jobId), { method: 'GET' });
    if (res.ok) remote = await res.json();
  } catch (e) { /* service injoignable : on rend l'état connu, sans rien casser */ }

  if (remote && remote.status !== job.status) {
    if (remote.status === 'done') {
      await env.DB.prepare("UPDATE slice_jobs SET status='done', sn=?, engine_image=?, finished_at=? WHERE id=?")
        .bind(remote.sn || null, remote.engine_image || null, nowIso(), jobId).run();
    } else if (remote.status === 'failed') {
      await env.DB.prepare("UPDATE slice_jobs SET status='failed', error=?, finished_at=? WHERE id=?")
        .bind(String(remote.error || 'echec').slice(0, 500), nowIso(), jobId).run();
      await refundToken(env, uid, jobId);
    } else {
      await env.DB.prepare('UPDATE slice_jobs SET status=? WHERE id=?').bind(remote.status, jobId).run();
    }
  }

  const fresh = await env.DB.prepare('SELECT * FROM slice_jobs WHERE id = ?').bind(jobId).first();
  return json({
    job_id: fresh.id, status: fresh.status, sn: fresh.sn,
    engine_image: fresh.engine_image, error: fresh.error, refunded: !!fresh.refunded,
    tokens: await deps.tokenBalance(env, uid),
  }, 200, origin);
}

// ---------------------------------------------------------------- GET /slice/:id/gcode
export async function handleSliceGcode(request, env, origin, deps, jobId) {
  const { json } = deps;
  const uid = await requireSession(request, env, deps);
  if (!uid) return json({ error: 'non_authentifie' }, 401, origin);

  const job = await env.DB.prepare('SELECT * FROM slice_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, uid).first();
  if (!job) return json({ error: 'job_inconnu' }, 404, origin);
  if (job.status !== 'done') return json({ error: 'pas_pret', status: job.status }, 409, origin);

  const res = await callSlicer(env, '/slice/' + encodeURIComponent(jobId) + '/gcode', { method: 'GET' });
  if (!res.ok) return json({ error: 'gcode_indisponible' }, 502, origin);

  // Le G-code transite par le Worker : le service n'est jamais exposé au client,
  // et aucune URL directe vers un artefact ne circule.
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${job.source_id}.gcode"`,
      'Cache-Control': 'no-store',
      ...deps.cors(origin),
    },
  });
}
