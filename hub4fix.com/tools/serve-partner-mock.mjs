/**
 * Hub4Fix — prévisualisation de l'espace partenaire SANS Zitadel ni D1.
 *
 * L'espace partenaire est une SPA servie par le worker h4f-partner. Pour la voir, il
 * faudrait normalement une session Zitadel valide et les bases D1 : impossible à
 * itérer vite sur l'écran. Ce serveur sert le MÊME html (importé de app-page.js, donc
 * jamais une copie qui divergerait) et répond aux endpoints avec des données figées
 * couvrant chaque état du tunnel.
 *
 *     node hub4fix.com/tools/serve-partner-mock.mjs        # http://localhost:9092
 *
 * Ce n'est PAS un test : ça ne prouve rien sur le worker. Ça montre les écrans.
 * La logique serveur est couverte par tests/tunnel-modelisateur.test.js, et le
 * parcours réel par `wrangler dev`.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_HTML } from '../worker/partner/app-page.js';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PORT = process.env.PORT ? Number(process.env.PORT) : 9092;
const h = (ms) => new Date(Date.now() + ms * 3600 * 1000).toISOString();

// Un jeu d'états qui couvre le tunnel : en attente du feu vert, fenêtre en cours,
// correction demandée, prolongation déjà consommée, fichier en examen.
const RESERVATIONS = [
  {
    id: 1, piece_id: 'brun/cafetiere/porte-filtre', nom: 'Porte-filtre Senseo HD7810',
    status: 'pending-review', expires_at: h(160), validated_at: null, extended_at: null,
    expired: false, can_extend: false, can_submit: false, has_part_photo: true,
    ai_verdict: 'ok', submission: null,
  },
  {
    id: 2, piece_id: 'blanc/lave-linge/verrou-hublot', nom: 'Verrou de hublot Indesit IWC',
    status: 'active', expires_at: h(41), validated_at: h(-31), extended_at: null,
    expired: false, can_extend: true, can_submit: true, has_part_photo: false,
    ai_verdict: 'ok', submission: null,
  },
  {
    id: 3, piece_id: 'brun/robot/couvercle-bol', nom: 'Couvercle de bol Kenwood KM28',
    status: 'active', expires_at: h(57), validated_at: h(-15), extended_at: h(-15),
    expired: false, can_extend: false, can_submit: true, has_part_photo: true,
    ai_verdict: 'ok',
    submission: { id: 's-3', version: 1, status: 'rejected', review_note: 'Le jeu de 0,3 mm sur l\'axe est trop serré : reprendre la cote et vérifier le retrait matière.', created_at: h(-20) },
  },
  {
    id: 4, piece_id: 'blanc/aspirateur/clip-tube', nom: 'Clip de tube Dyson V8',
    status: 'submitted', expires_at: h(1430), validated_at: h(-90), extended_at: null,
    expired: false, can_extend: false, can_submit: false, has_part_photo: true,
    ai_verdict: 'ok', submission: { id: 's-4', version: 2, status: 'review', review_note: null, created_at: h(-2) },
  },
];

const HOTLIST = [
  { id: 'brun/four/charniere', nom: 'Charnière de porte de four', appareil: 'Four encastrable', marque: 'Bosch', demande: 148, alertes: 12, boost: 3, addedDate: '2026-05-02', image: '', reserved: false, reserved_by_me: false, etape: null },
  { id: 'blanc/lave-linge/verrou-hublot', nom: 'Verrou de hublot Indesit IWC', appareil: 'Lave-linge', marque: 'Indesit', demande: 96, alertes: 7, boost: 2, addedDate: '2026-06-11', image: '', reserved: true, reserved_by_me: true, etape: 'active' },
  { id: 'brun/cafetiere/porte-filtre', nom: 'Porte-filtre Senseo HD7810', appareil: 'Cafetière', marque: 'Philips', demande: 74, alertes: 4, boost: 1, addedDate: '2026-07-01', image: '', reserved: true, reserved_by_me: true, etape: 'pending-review' },
  { id: 'blanc/seche-linge/filtre', nom: 'Cadre de filtre à peluches', appareil: 'Sèche-linge', marque: 'Beko', demande: 61, alertes: 2, boost: 0, addedDate: '2026-07-20', image: '', reserved: true, reserved_by_me: false, etape: null },
  // Pièce déposée par un autre canal (dépôt interne /admin/depot) : réservée pour le
  // moteur, mais l'écran doit dire « déjà déposé » et non « réservée » — il n'y a plus
  // rien à faire dessus, contrairement à une pièce que quelqu'un travaille encore.
  { id: 'brun/micro-ondes/loquet', nom: 'Loquet de porte micro-ondes', appareil: 'Micro-ondes', marque: 'Whirlpool', demande: 52, alertes: 1, boost: 0, addedDate: '2026-07-28', image: '', reserved: true, reserved_by_me: false, deja_deposee: true, etape: null },
];

const DEPOT = {
  max_mo: 25,
  step_exts: ['.step', '.stp'],
  mesh_refuses: ['.stl', '.3mf', '.obj', '.ply', '.amf', '.gcode', '.bgcode'],
  natifs_connus: ['.f3d', '.fcstd', '.sldprt', '.ipt', '.prt', '.scad', '.blend', '.catpart', '.par', '.skp', '.3dm'],
  cession_version: 'cgv-modelisateurs-2026-08',
};

const ROUTES = {
  // Les deux rôles actifs : la maquette doit permettre de voir aussi l'espace printer.
  'GET /auth/me': () => ({ authenticated: true, email: 'partenaire@exemple.fr', prenom: 'Alex', uid: 'mock-uid', partner: { modelisateur: 'active', printer: 'active' }, is_admin: false }),
  'GET /modelisateur/hotlist': () => ({ pieces: HOTLIST }),
  'GET /modelisateur/reservations': () => ({ now: new Date().toISOString(), reservations: RESERVATIONS, depot: DEPOT }),
  'POST /modelisateur/reservation': () => ({ ok: true, reservation_id: 99, status: 'pending-review', expires_at: h(2), now: new Date().toISOString() }),
  'POST /modelisateur/reservation/photos': () => ({ ok: true, ai_check: 'ok', status: 'pending-review', expires_at: h(168), now: new Date().toISOString() }),
  'POST /modelisateur/reservation/extend': () => ({ ok: true, expires_at: h(113), extended_at: new Date().toISOString(), now: new Date().toISOString() }),
  'POST /modelisateur/submission': () => ({ ok: true, submission_id: 'mock-sub', version: 1, status: 'review', cession_at: new Date().toISOString(), cession_version: DEPOT.cession_version, now: new Date().toISOString() }),
  // Une commande sur une pièce PLUS GRANDE que le plateau réel de la machine de
  // référence : c'est le cas qui rend l'explication du plateau extrapolé nécessaire.
  'GET /printer/commandes': () => ({
    jobs: [{
      id: 'job-1', product_id: 'blanc/etendoir/pied', product_name: 'Pied de séchoir (286 mm)',
      material: 'PETG', tech: 'FDM', print_time: '4h10', weight: '96 g', montant_cents: 1748,
      postal_code: '91170', ville: 'Viry-Châtillon', status: 'open',
      offer_expires_at: h(18), created_at: h(-6), is_test: 0, mine: false,
    }],
    now: new Date().toISOString(),
    reference_machine: 'Bambu Lab A1',
    reference_label: 'Bambu Lab A1 — enveloppe de référence 330 × 320 × 325 mm (Bambu Lab A2L)',
    reference_bed_mm: { x: 330, y: 320, z: 325 },
  }),
  'GET /printer/profile': () => ({ profile: { techs: 'FDM', materials: 'PLA,PETG', postal_code: '91170', ville: 'Viry-Châtillon', available: 1, machines: [{ modele: 'K1 Max', techno: 'FDM', quantite: 2 }] } }),
};

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/reserver')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(APP_HTML);
  }
  // Le worker relaie ce fichier depuis Pages ; ici on le lit sur le disque, à la
  // même adresse — sinon la SPA part chercher un script absent et l'écran printer
  // reste vide sans qu'on sache pourquoi.
  if (req.method === 'GET' && url === '/js/printer-selector.js') {
    try {
      const js = await readFile(path.join(SITE_ROOT, 'js', 'printer-selector.js'));
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(js);
    } catch (e) { /* absent : on tombe dans le 404 ci-dessous */ }
  }
  const handler = ROUTES[req.method + ' ' + url];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found', path: url }));
  }
  // Le corps est lu et jeté : le mock ne valide rien, c'est le worker qui valide.
  req.on('data', () => {});
  req.on('end', () => {
    res.writeHead(url === '/modelisateur/submission' ? 201 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(handler()));
  });
}).listen(PORT, () => console.log('Espace partenaire (mock) : http://localhost:' + PORT));
