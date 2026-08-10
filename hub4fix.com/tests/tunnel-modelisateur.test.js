// @vitest-environment node
//
// Tunnel de soumission modélisateur — règles qui coûtent de l'argent ou du droit si
// elles cassent : formats acceptés, unicité de la prolongation, acte de cession,
// démarrage des 72 h. Ce sont les seules choses qu'un test doit garder.
//
// Les bindings Cloudflare (D1, R2) sont simulés : ces tests vérifient la LOGIQUE, pas
// le pilote de base. Le parcours réel se rejoue avec `wrangler dev`.

import { describe, it, expect } from 'vitest';
import {
  checkDeposit, extOf, handleExtend, handleSubmission,
  WORK_WINDOW_MS, EXTENSION_MS, FILE_REVIEW_MS, MAX_FILE_BYTES, CESSION_VERSION,
} from '../worker/partner/partner.js';
import { decideReservation, decideSubmission, remaining, viewReservations, viewModeles, handleDepot, viewDepot } from '../worker/admin.js';

const SECRET = 'secret-de-test-assez-long-pour-hmac';
const UID = 'user-42';
const PIECE = 'brun/cafetiere/porte-filtre';

// ---------------------------------------------------------------- doublures
function makeDb(routes) {
  const log = [];
  return {
    log,
    prepare(sql) {
      const route = routes.find((r) => r.match.test(sql));
      return {
        bind(...params) {
          log.push({ sql, params });
          return {
            first: async () => (route && route.first ? route.first(params) : null),
            run: async () => (route && route.run ? route.run(params) : { meta: { changes: 1 } }),
            all: async () => (route && route.all ? route.all(params) : { results: [] }),
          };
        },
      };
    },
  };
}
function makeR2() {
  const store = new Map();
  return {
    store,
    async put(k, v, o) { store.set(k, { bytes: v.byteLength != null ? v.byteLength : 0, opts: o }); },
    async get(k) { return store.get(k) || null; },
    async delete(k) { store.delete(k); },
  };
}
// Reproduit makeToken() du worker : base64url(JSON) + '.' + HMAC-SHA256 base64url.
async function session(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return payload + '.' + Buffer.from(sig).toString('base64url');
}
async function req(body, contentType) {
  const token = await session({ sub: 'z1', email: 'mod@test.fr', uid: UID, name: 'Mod' });
  const init = { method: 'POST', headers: { Authorization: 'Bearer ' + token } };
  if (body) init.body = body;
  if (contentType) init.headers['Content-Type'] = contentType;
  return new Request('https://partner.test/x', init);
}
const ACTIVE_PARTNER = { match: /FROM partners WHERE user_id/, first: () => ({ ok: 1 }) };
const fakeFile = (name, size) => ({ name, size, arrayBuffer: () => new ArrayBuffer(0) });

// ---------------------------------------------------------------- formats
describe('formats de dépôt', () => {
  it('refuse un maillage comme source natif — c\'est une sortie de la chaîne, pas une entrée', () => {
    for (const ext of ['.stl', '.3mf', '.obj', '.gcode']) {
      const r = checkDeposit(fakeFile('piece' + ext, 1000), 'native');
      expect(r && r.error, ext).toBe('maillage_refuse');
    }
  });

  it('accepte un source natif quelconque : « ou équivalent suivant le logiciel »', () => {
    for (const ext of ['.f3d', '.fcstd', '.sldprt', '.scad', '.exotique']) {
      expect(checkDeposit(fakeFile('piece' + ext, 1000), 'native'), ext).toBeNull();
    }
  });

  it('exige un STEP en second fichier, et rien d\'autre', () => {
    expect(checkDeposit(fakeFile('piece.step', 900), 'step')).toBeNull();
    expect(checkDeposit(fakeFile('piece.stp', 900), 'step')).toBeNull();
    expect(checkDeposit(fakeFile('piece.f3d', 900), 'step').error).toBe('step_invalide');
    expect(checkDeposit(fakeFile('piece.stl', 900), 'step').error).toBe('step_invalide');
  });

  it('refuse un fichier sans extension, vide, ou trop lourd', () => {
    expect(checkDeposit(fakeFile('piece', 900), 'native').error).toBe('extension_absente');
    expect(checkDeposit(fakeFile('piece.f3d', 0), 'native').error).toBe('fichier_vide');
    expect(checkDeposit(fakeFile('piece.f3d', MAX_FILE_BYTES + 1), 'native').error).toBe('fichier_trop_lourd');
  });

  it('nomme le fichier manquant : le message doit dire lequel', () => {
    expect(checkDeposit(null, 'native').error).toBe('source_manquante');
    expect(checkDeposit(null, 'step').error).toBe('step_manquant');
  });

  it('extOf lit la dernière extension, en minuscules', () => {
    expect(extOf('Piece.Finale.F3D')).toBe('.f3d');
    expect(extOf('sans-extension')).toBe('');
  });
});

// ---------------------------------------------------------------- prolongation
describe('prolongation de la fenêtre de travail', () => {
  const RESV = { id: 7, expires_at: null, extended_at: null };

  it('ajoute 72 h À L\'ÉCHÉANCE en cours, pas à maintenant', async () => {
    const deadline = new Date(Date.now() + 10 * 3600 * 1000).toISOString();   // H+10
    let written = null;
    const db = makeDb([
      ACTIVE_PARTNER,
      { match: /SELECT id, expires_at, extended_at FROM reservations/, first: () => ({ ...RESV, expires_at: deadline }) },
      { match: /UPDATE reservations SET expires_at/, run: (p) => { written = p; return { meta: { changes: 1 } }; } },
    ]);
    const res = await handleExtend(await req(JSON.stringify({ piece_id: PIECE }), 'application/json'),
      { DB: db, SESSION_SECRET: SECRET }, 'https://hub4fix.com');
    const body = await res.json();
    expect(res.status).toBe(200);
    // Prolonger tôt ne fait rien gagner : le +72 h part de l'échéance existante.
    expect(Date.parse(body.expires_at) - Date.parse(deadline)).toBe(EXTENSION_MS);
    expect(written[1]).toBeTruthy();   // extended_at posé
  });

  it('refuse la deuxième prolongation', async () => {
    const db = makeDb([
      ACTIVE_PARTNER,
      {
        match: /SELECT id, expires_at, extended_at FROM reservations/,
        first: () => ({ id: 7, expires_at: new Date(Date.now() + 3600e3).toISOString(), extended_at: '2026-08-01T10:00:00.000Z' }),
      },
    ]);
    const res = await handleExtend(await req(JSON.stringify({ piece_id: PIECE }), 'application/json'),
      { DB: db, SESSION_SECRET: SECRET }, 'https://hub4fix.com');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('prolongation_deja_utilisee');
    // Aucune écriture : la garde a parlé avant.
    expect(db.log.some((c) => /UPDATE reservations/.test(c.sql))).toBe(false);
  });

  it('refuse de prolonger un délai déjà écoulé — la pièce est repartie', async () => {
    const db = makeDb([
      ACTIVE_PARTNER,
      {
        match: /SELECT id, expires_at, extended_at FROM reservations/,
        first: () => ({ id: 7, expires_at: new Date(Date.now() - 60e3).toISOString(), extended_at: null }),
      },
    ]);
    const res = await handleExtend(await req(JSON.stringify({ piece_id: PIECE }), 'application/json'),
      { DB: db, SESSION_SECRET: SECRET }, 'https://hub4fix.com');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('delai_depasse');
  });

  it('perd la course quand l\'UPDATE ne change aucune ligne (deux onglets)', async () => {
    const db = makeDb([
      ACTIVE_PARTNER,
      {
        match: /SELECT id, expires_at, extended_at FROM reservations/,
        first: () => ({ id: 7, expires_at: new Date(Date.now() + 3600e3).toISOString(), extended_at: null }),
      },
      { match: /UPDATE reservations SET expires_at/, run: () => ({ meta: { changes: 0 } }) },
    ]);
    const res = await handleExtend(await req(JSON.stringify({ piece_id: PIECE }), 'application/json'),
      { DB: db, SESSION_SECRET: SECRET }, 'https://hub4fix.com');
    expect(res.status).toBe(409);
  });

  it('404 quand la réservation n\'existe pas', async () => {
    const db = makeDb([ACTIVE_PARTNER]);
    const res = await handleExtend(await req(JSON.stringify({ piece_id: PIECE }), 'application/json'),
      { DB: db, SESSION_SECRET: SECRET }, 'https://hub4fix.com');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------- dépôt
describe('dépôt du fichier', () => {
  const activeResv = (over) => ({
    match: /SELECT id, status, expires_at, validated_at FROM reservations/,
    first: () => ({
      id: 7, status: 'active', validated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + WORK_WINDOW_MS).toISOString(), ...over,
    }),
  });
  const versionRoute = { match: /COALESCE\(MAX\(version\), 0\)/, first: () => ({ v: 0 }) };

  function form(over) {
    const fd = new FormData();
    fd.append('piece_id', PIECE);
    fd.append('cession', 'true');
    fd.append('native', new File([new Uint8Array(64)], 'porte-filtre.f3d'));
    fd.append('step', new File([new Uint8Array(32)], 'porte-filtre.step'));
    for (const [k, v] of Object.entries(over || {})) {
      fd.delete(k);
      if (v !== null) fd.append(k, v);
    }
    return fd;
  }
  const env = (db, r2) => ({ DB: db, SUBMIT_R2: r2 || makeR2(), SESSION_SECRET: SECRET });

  it('enregistre le fichier, l\'acte de cession et bascule la réservation en examen', async () => {
    const writes = [];
    const r2 = makeR2();
    const db = makeDb([
      ACTIVE_PARTNER, activeResv(), versionRoute,
      { match: /INSERT INTO submissions/, run: (p) => { writes.push({ kind: 'insert', p }); return { meta: { changes: 1 } }; } },
      { match: /UPDATE reservations SET status = 'submitted'/, run: (p) => { writes.push({ kind: 'submitted', p }); return { meta: { changes: 1 } }; } },
    ]);
    const res = await handleSubmission(await req(form()), env(db, r2), 'https://hub4fix.com');
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.version).toBe(1);
    expect(body.cession_version).toBe(CESSION_VERSION);
    expect(body.cession_at).toBeTruthy();

    // Les deux fichiers sont bien dans R2, sous la clé du dossier. Le fichier natif se
    // nomme « natif » et NON « source » : depuis l'arbitrage de vocabulaire du 09/08,
    // `source.3mf` désigne le 3MF SOURCE que la conversion produira dans ce même dossier.
    const keys = [...r2.store.keys()];
    expect(keys.some((k) => k.endsWith('/natif.f3d'))).toBe(true);
    expect(keys.some((k) => k.endsWith('/source.f3d'))).toBe(false);
    expect(keys.some((k) => k.endsWith('/model.step'))).toBe(true);

    // L'acte de cession porte une empreinte par fichier : c'est ce qui le lie à CETTE
    // version. Deux empreintes SHA-256 = 64 caractères hexadécimaux.
    const insert = writes.find((w) => w.kind === 'insert').p;
    const empreintes = insert.filter((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v));
    expect(empreintes).toHaveLength(2);

    // La pièce reste tenue le temps de l'examen : 60 j (CGV art. 2.5).
    const submitted = writes.find((w) => w.kind === 'submitted').p;
    const marge = Math.abs(Date.parse(submitted[0]) - (Date.now() + FILE_REVIEW_MS));
    expect(marge).toBeLessThan(5000);
  });

  it('exige l\'acte de cession — sans lui, rien n\'est écrit', async () => {
    const r2 = makeR2();
    const db = makeDb([ACTIVE_PARTNER, activeResv(), versionRoute]);
    const res = await handleSubmission(await req(form({ cession: null })), env(db, r2), 'https://hub4fix.com');
    expect(res.status).toBe(428);
    expect((await res.json()).error).toBe('cession_requise');
    expect(r2.store.size).toBe(0);
    expect(db.log.some((c) => /INSERT INTO submissions/.test(c.sql))).toBe(false);
  });

  it('refuse un maillage déposé comme source, avant tout stockage', async () => {
    const r2 = makeR2();
    const db = makeDb([ACTIVE_PARTNER, activeResv(), versionRoute]);
    const fd = form({ native: new File([new Uint8Array(64)], 'porte-filtre.stl') });
    const res = await handleSubmission(await req(fd), env(db, r2), 'https://hub4fix.com');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('maillage_refuse');
    expect(r2.store.size).toBe(0);
  });

  it('refuse le dépôt avant notre feu vert : le délai n\'a pas démarré', async () => {
    const db = makeDb([ACTIVE_PARTNER, activeResv({ status: 'pending-review', validated_at: null })]);
    const res = await handleSubmission(await req(form()), env(db), 'https://hub4fix.com');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('pas_encore_validee');
  });

  it('refuse le dépôt après les 72 h', async () => {
    const db = makeDb([ACTIVE_PARTNER, activeResv({ expires_at: new Date(Date.now() - 1000).toISOString() })]);
    const res = await handleSubmission(await req(form()), env(db), 'https://hub4fix.com');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('delai_depasse');
  });

  it('rend le dossier existant au lieu d\'une erreur quand deux envois se croisent', async () => {
    const r2 = makeR2();
    const db = makeDb([
      ACTIVE_PARTNER, activeResv(), versionRoute,
      { match: /INSERT INTO submissions/, run: () => { throw new Error('UNIQUE constraint failed'); } },
      { match: /SELECT id, version, created_at FROM submissions/, first: () => ({ id: 'deja-la', version: 1, created_at: 'x' }) },
    ]);
    const res = await handleSubmission(await req(form()), env(db, r2), 'https://hub4fix.com');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(body.submission_id).toBe('deja-la');
    // Les objets écrits pour rien sont nettoyés : pas de déchet dans le bucket.
    expect(r2.store.size).toBe(0);
  });
});

// ---------------------------------------------------------------- côté admin
describe('décisions admin', () => {
  const adminDb = (routes) => makeDb(routes);

  it('le feu vert démarre les 72 h et les inscrit dans l\'échéance', async () => {
    let written = null;
    const db = adminDb([
      { match: /SELECT id, status, plate_key, validated_at FROM reservations/, first: () => ({ id: 7, status: 'pending-review', plate_key: 'reservations/7/plate', validated_at: null }) },
      { match: /UPDATE reservations SET status = 'active', validated_at/, run: (p) => { written = p; return { meta: { changes: 1 } }; } },
    ]);
    const r = await decideReservation({ DB_PARTNER: db }, 7, 'validate', 'julien@h4f');
    expect(r.ok).toBe(true);
    const [validatedAt, deadline] = written;
    expect(Math.abs(Date.parse(deadline) - (Date.parse(validatedAt) + WORK_WINDOW_MS))).toBeLessThan(2000);
  });

  it('refuse le feu vert sans photos : il n\'y a rien à examiner', async () => {
    const db = adminDb([
      { match: /SELECT id, status, plate_key, validated_at FROM reservations/, first: () => ({ id: 7, status: 'pending-review', plate_key: null, validated_at: null }) },
    ]);
    const r = await decideReservation({ DB_PARTNER: db }, 7, 'validate', 'julien@h4f');
    expect(r.ok).toBe(false);
    expect(db.log.some((c) => /UPDATE reservations/.test(c.sql))).toBe(false);
  });

  it('lever une suspension AVANT validation ne donne pas le feu vert par effet de bord', async () => {
    let status = null;
    const db = adminDb([
      { match: /SELECT id, status, plate_key, validated_at FROM reservations/, first: () => ({ id: 7, status: 'suspended', plate_key: 'k', validated_at: null }) },
      { match: /UPDATE reservations SET status = \?, decided_by/, run: (p) => { status = p[0]; return { meta: { changes: 1 } }; } },
    ]);
    await decideReservation({ DB_PARTNER: db }, 7, 'reactivate', 'julien@h4f');
    expect(status).toBe('pending-review');
  });

  it('une demande de correction sans consigne est refusée', async () => {
    const db = adminDb([
      { match: /SELECT id, reservation_id, piece_id, status FROM submissions/, first: () => ({ id: 's1', reservation_id: 7, piece_id: PIECE, status: 'review' }) },
    ]);
    const r = await decideSubmission({ DB_PARTNER: db }, 's1', 'correct', 'ok', 'julien@h4f');
    expect(r.ok).toBe(false);
    expect(db.log.some((c) => /UPDATE submissions/.test(c.sql))).toBe(false);
  });

  it('une correction rend 72 h au modélisateur', async () => {
    let resvWrite = null;
    const db = adminDb([
      { match: /SELECT id, reservation_id, piece_id, status FROM submissions/, first: () => ({ id: 's1', reservation_id: 7, piece_id: PIECE, status: 'review' }) },
      { match: /UPDATE submissions SET status = 'rejected'/, run: () => ({ meta: { changes: 1 } }) },
      { match: /UPDATE reservations SET status = 'active', validated_at/, run: (p) => { resvWrite = p; return { meta: { changes: 1 } }; } },
    ]);
    const r = await decideSubmission({ DB_PARTNER: db }, 's1', 'correct', 'Le jeu de 0,3 mm sur l\'axe est trop serré, reprendre la cote.', 'julien@h4f');
    expect(r.ok).toBe(true);
    expect(Math.abs(Date.parse(resvWrite[1]) - (Date.now() + WORK_WINDOW_MS))).toBeLessThan(5000);
  });

  it('un dossier déjà tranché ne se re-tranche pas', async () => {
    const db = adminDb([
      { match: /SELECT id, reservation_id, piece_id, status FROM submissions/, first: () => ({ id: 's1', reservation_id: 7, piece_id: PIECE, status: 'accepted' }) },
    ]);
    const r = await decideSubmission({ DB_PARTNER: db }, 's1', 'accept', '', 'julien@h4f');
    expect(r.ok).toBe(false);
  });

  it('écarter libère la pièce immédiatement', async () => {
    let resvWrite = null;
    const db = adminDb([
      { match: /SELECT id, reservation_id, piece_id, status FROM submissions/, first: () => ({ id: 's1', reservation_id: 7, piece_id: PIECE, status: 'review' }) },
      { match: /UPDATE submissions SET status = 'rejected'/, run: () => ({ meta: { changes: 1 } }) },
      { match: /UPDATE reservations SET status = 'cancelled'/, run: (p) => { resvWrite = p; return { meta: { changes: 1 } }; } },
    ]);
    const r = await decideSubmission({ DB_PARTNER: db }, 's1', 'discard', 'Pièce sous pression, FA non pertinente.', 'julien@h4f');
    expect(r.ok).toBe(true);
    // L'échéance est repoussée dans le passé : l'expiration paresseuse fait le reste.
    expect(Date.parse(resvWrite[0])).toBeLessThanOrEqual(Date.now());
  });
});

// Les écrans admin vivent derrière Zitadel : on ne peut pas les ouvrir dans un
// navigateur en développement. On les REND ici, sur des données représentatives, pour
// attraper les fautes de gabarit et vérifier que le bon bouton apparaît au bon état.
describe('écrans admin', () => {
  const RESV = {
    id: 7, piece_id: PIECE, email: 'mod@test.fr', status: 'pending-review',
    ai_check: 'ok | plaque lisible', plate_key: 'reservations/7/plate', object_key: 'reservations/7/object',
    part_key: 'reservations/7/part', created_at: '2026-08-08T09:00:00.000Z',
    expires_at: new Date(Date.now() + 5 * 24 * 3600e3).toISOString(),
    validated_at: null, extended_at: null, decided_by: null,
  };

  it('propose le feu vert quand les photos sont là, jamais sans', () => {
    const avec = viewReservations({ rows: [RESV], now: new Date().toISOString() }, '');
    expect(avec).toContain('value="validate"');
    expect(avec).toContain('pour notre feu vert');
    const sans = viewReservations({ rows: [{ ...RESV, plate_key: null, part_key: null, object_key: null }], now: new Date().toISOString() }, '');
    expect(sans).not.toContain('value="validate"');
    expect(sans).toContain('pour envoyer ses photos');
  });

  it('dit ce que l\'échéance signifie à chaque étape', () => {
    const actif = viewReservations({ rows: [{ ...RESV, status: 'active', validated_at: '2026-08-09T08:00:00.000Z' }], now: new Date().toISOString() }, '');
    expect(actif).toContain('pour déposer le fichier');
    const examen = viewReservations({ rows: [{ ...RESV, status: 'submitted' }], now: new Date().toISOString() }, '');
    expect(examen).toContain('CGV art. 2.5');
  });

  it('signale une prolongation déjà consommée', () => {
    const html = viewReservations({ rows: [{ ...RESV, status: 'active', extended_at: '2026-08-09T08:00:00.000Z' }], now: new Date().toISOString() }, '');
    expect(html).toContain('non renouvelable');
  });

  const SUB = {
    id: 'sub-1', piece_id: PIECE, email: 'mod@test.fr', user_id: UID, version: 1,
    native_key: 'submissions/sub-1/source.f3d', native_name: 'verrou.f3d', native_bytes: 2400000, native_sha256: 'a'.repeat(64),
    step_key: 'submissions/sub-1/model.step', step_name: 'verrou.step', step_bytes: 810000, step_sha256: 'b'.repeat(64),
    status: 'review', cession_at: '2026-08-09T10:00:00.000Z', cession_version: CESSION_VERSION,
    review_note: null, created_at: '2026-08-09T10:00:00.000Z', decided_by: null,
  };

  it('offre les trois verbes d\'examen et les deux téléchargements', () => {
    const html = viewModeles({ rows: [SUB] }, '');
    for (const v of ['accept', 'correct', 'discard']) expect(html, v).toContain('value="' + v + '"');
    expect(html).toContain('/admin/submission-file/sub-1/native');
    expect(html).toContain('/admin/submission-file/sub-1/step');
    expect(html).toContain('2.3 Mo');
  });

  it('affiche l\'acte de cession avec sa date, sa version et ses empreintes', () => {
    const html = viewModeles({ rows: [SUB] }, '');
    expect(html).toContain('Acte de cession');
    expect(html).toContain(CESSION_VERSION);
    expect(html).toContain('a'.repeat(32));
    expect(html).toContain('b'.repeat(32));
  });

  it('un dossier accepté ne montre plus de boutons d\'examen mais dit ce qui reste', () => {
    const html = viewModeles({ rows: [{ ...SUB, status: 'accepted' }] }, '');
    expect(html).not.toContain('value="accept"');
    // La chaîne restante est nommée en deux temps depuis l'arbitrage de vocabulaire :
    // le STEP donne un 3MF source, dont on dérive un 3MF master par machine.
    expect(html).toContain('3MF source');
    expect(html).toContain('3MF master');
  });

  it('rappelle la tolérance de tessellation sur un dossier accepté', () => {
    // Tant que la conversion est manuelle, ce rappel EST le garde-fou de la règle de
    // haute résolution : un import STEP au réglage par défaut fige un maillage
    // grossier, et l'écart de corde devient un écart de cote. Si quelqu'un réécrit ce
    // texte et laisse tomber les valeurs, la règle cesse de s'appliquer en silence.
    const html = viewModeles({ rows: [{ ...SUB, status: 'accepted' }] }, '');
    expect(html).toContain('0,01 mm');
    expect(html).toContain('0,05 rad');
  });

  it('reste lisible quand il n\'y a rien à examiner', () => {
    const html = viewModeles({ rows: [] }, '');
    expect(html).toContain('Aucun fichier déposé');
  });
});

// Le dépôt interne (/admin/depot) est la seconde porte d'entrée de la MÊME table
// `submissions`. Ce qui doit tenir : la règle de résolution reste visible (drapeau
// mesh_only), et un fichier de tiers ne rentre pas sans acte de cession traçable.
describe('dépôt interne admin', () => {
  const ADMIN = 'julien@h4f';
  const versionRoute = (v) => ({ match: /COALESCE\(MAX\(version\), 0\)/, first: () => ({ v }) });
  const insertOk = (sink) => ({
    match: /INSERT INTO submissions/,
    run: (p) => { sink.push(p); return { meta: { changes: 1 } }; },
  });
  const file = (name, size) => new File([new Uint8Array(size)], name);

  function depotForm(over) {
    const fd = new FormData();
    fd.append('piece_id', PIECE);
    fd.append('mode', 'cao');
    fd.append('origine', 'interne');
    fd.append('fichier', file('verrou.f3d', 512));
    fd.append('step', file('verrou.step', 256));
    for (const [k, v] of Object.entries(over || {})) {
      fd.delete(k);
      if (v !== null) fd.append(k, v);
    }
    return fd;
  }
  const env = (sink, r2) => ({
    DB_PARTNER: makeDb([versionRoute(0), insertOk(sink || [])]),
    SUBMIT_R2: r2 || makeR2(),
  });

  it('un dépôt interne CAO part directement en « accepté » : personne à examiner', async () => {
    const sink = [], r2 = makeR2();
    const r = await handleDepot(env(sink, r2), depotForm(), ADMIN);
    expect(r.ok).toBe(true);
    const p = sink[0];
    expect(p).toContain('interne');
    expect(p).toContain('accepted');
    expect(p).toContain('admin:' + ADMIN);
    expect(p).toContain(0);              // mesh_only = 0
    expect([...r2.store.keys()].length).toBe(2);
  });

  it('le mode CAO exige le STEP — c\'est lui que la conversion consomme', async () => {
    const r2 = makeR2();
    const r = await handleDepot(env([], r2), depotForm({ step: null }), ADMIN);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/STEP est obligatoire/);
    expect(r2.store.size).toBe(0);
  });

  it('un maillage glissé en mode CAO est refusé, avec la sortie indiquée', async () => {
    const r = await handleDepot(env(), depotForm({ fichier: file('verrou.3mf', 512) }), ADMIN);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/maillage déjà prêt/);
  });

  it('le mode maillage accepte .3mf et .stl, sans STEP, et pose le drapeau', async () => {
    const sink = [], r2 = makeR2();
    const r = await handleDepot(env(sink, r2), depotForm({ mode: 'maillage', fichier: file('legacy.3mf', 900), step: null }), ADMIN);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/Résolution non maîtrisée/);
    expect(sink[0]).toContain(1);                      // mesh_only = 1
    expect([...r2.store.keys()].length).toBe(1);       // aucun STEP écrit
  });

  // « 3MF » désigne deux fichiers aux enjeux différents (vocabulaire du 09/08/2026) : le
  // SOURCE (géométrie seule, il manque un profil machine) et le MASTER (réglages inclus,
  // slicable en l'état). On ne demande pas à l'admin de trancher, on lit le fichier.
  describe('3MF source vs 3MF master', () => {
    // Un 3MF est un zip : signature PK\x03\x04, puis des noms d'entrées en clair.
    function fake3mf(entries) {
      const head = [0x50, 0x4b, 0x03, 0x04];
      const body = new TextEncoder().encode(['3D/3dmodel.model', ...entries].join(' '));
      const bytes = new Uint8Array(head.length + body.length);
      bytes.set(head, 0);
      bytes.set(body, head.length);
      return new File([bytes], 'piece.3mf');
    }
    const kindOf = async (f) => {
      const sink = [];
      const r = await handleDepot(env(sink), depotForm({ mode: 'maillage', fichier: f, step: null }), ADMIN);
      expect(r.ok, r.msg).toBe(true);
      return { kind: sink[0].find((v) => typeof v === 'string' && /^(3mf-source|3mf-master|stl|indetermine)$/.test(v)), msg: r.msg };
    };

    it('reconnaît un master au dialecte Orca', async () => {
      const { kind, msg } = await kindOf(fake3mf(['Metadata/project_settings.config']));
      expect(kind).toBe('3mf-master');
      expect(msg).toMatch(/slicable en l'état/);
    });

    it('reconnaît un master au dialecte Prusa', async () => {
      expect((await kindOf(fake3mf(['Metadata/Slic3r_PE.config']))).kind).toBe('3mf-master');
    });

    it('reconnaît un source : géométrie sans réglages', async () => {
      const { kind, msg } = await kindOf(fake3mf(['Metadata/thumbnail.png']));
      expect(kind).toBe('3mf-source');
      expect(msg).toMatch(/profil machine/);
    });

    it('ne devine pas quand le fichier n\'est pas un zip', async () => {
      const { kind, msg } = await kindOf(new File([new TextEncoder().encode('pas un zip du tout')], 'faux.3mf'));
      expect(kind).toBe('indetermine');
      expect(msg).toMatch(/à vérifier à la main/);
    });

    it('un .stl est marqué comme tel, sans inspection de zip', async () => {
      expect((await kindOf(file('legacy.stl', 500))).kind).toBe('stl');
    });

    it('un dépôt CAO ne porte aucun type de maillage', async () => {
      const sink = [];
      await handleDepot(env(sink), depotForm(), ADMIN);
      expect(sink[0].some((v) => typeof v === 'string' && /^3mf-/.test(v))).toBe(false);
    });

    it('la file d\'examen dit ce qui reste selon le type', () => {
      const base = {
        id: 'd2', piece_id: PIECE, user_id: 'admin:' + ADMIN, version: 1,
        native_key: 'submissions/d2/natif.3mf', native_name: 'legacy.3mf', native_bytes: 900000,
        native_sha256: 'c'.repeat(64), step_key: null, step_bytes: 0,
        mesh_only: 1, origine: 'interne', deposited_by: ADMIN, status: 'accepted',
        cession_at: '2026-08-09T10:00:00.000Z', cession_version: CESSION_VERSION, created_at: '2026-08-09T10:00:00.000Z',
      };
      const master = viewModeles({ rows: [{ ...base, mesh_kind: '3mf-master' }] }, '');
      expect(master).toContain('3MF master');
      expect(master).toContain('Rien à préparer');
      expect(master).toContain('h4f-masters');

      const source = viewModeles({ rows: [{ ...base, mesh_kind: '3mf-source' }] }, '');
      expect(source).toContain('3MF source');
      expect(source).toContain('profil machine');
      expect(source).not.toContain('Rien à préparer');

      const inconnu = viewModeles({ rows: [{ ...base, mesh_kind: 'indetermine' }] }, '');
      expect(inconnu).toContain('Type indéterminé');
    });
  });

  it('le mode maillage refuse un fichier CAO : ce n\'est pas un maillage', async () => {
    const r = await handleDepot(env(), depotForm({ mode: 'maillage', fichier: file('verrou.f3d', 900), step: null }), ADMIN);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/doit être un \.3mf/);
  });

  it('un fichier de tiers sans acte de cession traçable est refusé', async () => {
    const r2 = makeR2();
    // Auteur nommé, mais ni date ni référence : la cession ne serait pas opposable.
    const r = await handleDepot(env([], r2), depotForm({ origine: 'hors-tunnel', author_name: 'A. Martin' }), ADMIN);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/date de l'acte/);
    expect(r2.store.size).toBe(0);
  });

  it('un fichier de tiers complet passe, en EXAMEN et non en accepté', async () => {
    const sink = [];
    const fd = depotForm({ origine: 'hors-tunnel', author_name: 'A. Martin' });
    fd.append('cession_at', '2026-08-04');
    fd.append('cession_ref', 'mail du 04/08/2026 « cession porte-filtre »');
    const r = await handleDepot(env(sink), fd, ADMIN);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/attend ton examen/);
    const p = sink[0];
    expect(p).toContain('hors-tunnel');
    expect(p).toContain('review');
    expect(p).toContain('A. Martin');
    // La date saisie est conservée, pas remplacée par celle du dépôt.
    expect(p.some((v) => typeof v === 'string' && v.startsWith('2026-08-04T'))).toBe(true);
  });

  it('refuse une date de cession dans le futur', async () => {
    const fd = depotForm({ origine: 'hors-tunnel', author_name: 'A. Martin' });
    fd.append('cession_at', '2099-01-01');
    fd.append('cession_ref', 'mail');
    const r = await handleDepot(env(), fd, ADMIN);
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/futur/);
  });

  it('la version continue la numérotation de la pièce, tous canaux confondus', async () => {
    const sink = [];
    const e = { DB_PARTNER: makeDb([versionRoute(2), insertOk(sink)]), SUBMIT_R2: makeR2() };
    const r = await handleDepot(e, depotForm(), ADMIN);
    expect(r.ok).toBe(true);
    expect(r.msg).toMatch(/version 3/);
  });

  it('nettoie le stockage si l\'écriture en base échoue', async () => {
    const r2 = makeR2();
    const e = {
      DB_PARTNER: makeDb([versionRoute(0), { match: /INSERT INTO submissions/, run: () => { throw new Error('UNIQUE constraint failed'); } }]),
      SUBMIT_R2: r2,
    };
    const r = await handleDepot(e, depotForm(), ADMIN);
    expect(r.ok).toBe(false);
    expect(r2.store.size).toBe(0);
  });

  it('refuse sans pièce, et sans binding', async () => {
    expect((await handleDepot(env(), depotForm({ piece_id: null }), ADMIN)).ok).toBe(false);
    expect((await handleDepot({ SUBMIT_R2: makeR2() }, depotForm(), ADMIN)).ok).toBe(false);
    expect((await handleDepot({ DB_PARTNER: makeDb([]) }, depotForm(), ADMIN)).ok).toBe(false);
  });

  it('l\'écran de dépôt masque la cession pour un fichier H4F et la montre pour un tiers', () => {
    const html = viewDepot({ rows: [{ id: PIECE, name: 'Verrou de hublot', machine: 'Lave-linge', modeled: '' }] }, '', '');
    // Le repli est en CSS pur (l'admin n'a aucun JavaScript) : le bloc est masqué QUAND
    // une origine H4F est cochée, donc visible par défaut si :has() manquait.
    expect(html).toContain('#o-interne:checked) .cession');
    expect(html).toContain('#o-rt:checked) .cession');
    // L'origine « tiers » n'apparaît PAS dans le CSS de masquage : c'est elle qui laisse
    // le bloc visible. Sa présence se vérifie sur le bouton radio.
    expect(html).toContain('id="o-tiers"');
    expect(html).toContain('cession_ref');
    expect(html).toContain('0,01 mm');
    expect(html).toContain('<option value="' + PIECE + '"');
  });

  it('l\'écran de dépôt le dit quand la base pièces est vide', () => {
    const html = viewDepot({ rows: [] }, '', '');
    expect(html).toContain('Aucune pièce dans la base');
  });

  it('la file d\'examen distingue l\'origine et alerte sur un maillage', () => {
    const base = {
      id: 'd1', piece_id: PIECE, user_id: 'admin:' + ADMIN, version: 1,
      native_name: 'legacy.3mf', native_bytes: 900000, native_sha256: 'c'.repeat(64),
      step_key: null, step_name: null, step_sha256: null, step_bytes: 0,
      mesh_only: 1, origine: 'interne', deposited_by: ADMIN, status: 'accepted',
      cession_at: '2026-08-09T10:00:00.000Z', cession_version: CESSION_VERSION, created_at: '2026-08-09T10:00:00.000Z',
    };
    const html = viewModeles({ rows: [base] }, '');
    expect(html).toContain('Interne H4F');
    expect(html).toContain('Résolution non maîtrisée');
    // Pas de STEP déposé : aucun lien de téléchargement STEP ne doit apparaître.
    expect(html).not.toContain('/admin/submission-file/d1/step');
    expect(html).toContain('/admin/submission-file/d1/native');
    // Et on ne réclame pas une tolérance d'import là où il n'y a rien à tesseller.
    expect(html).toContain('Pas de tessellation à faire');
  });
});

describe('lisibilité des délais', () => {
  it('dit des heures sous 48 h, des jours au-delà', () => {
    const now = '2026-08-09T12:00:00.000Z';
    expect(remaining('2026-08-09T22:00:00.000Z', now)).toBe('10 h restantes');
    expect(remaining('2026-08-15T12:00:00.000Z', now)).toBe('6 j restants');
    expect(remaining('2026-08-09T11:00:00.000Z', now)).toBe('échu');
  });
});
