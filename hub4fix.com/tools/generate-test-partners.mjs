/**
 * Hub4Fix — Génère des inscriptions de test (modélisateur/printer/client)
 * pour vérifier le pipeline (anti-doublon, Hot List admin, matching...).
 *
 * SÉCURITÉ : par défaut ce script tourne en mode "dry-run" — il affiche ce
 * qu'il enverrait sans rien envoyer. Il ne POST réellement vers le worker de
 * production qu'avec le flag --yes explicite. Chaque compte généré porte
 * fields.test=true (colonne "test" du Sheet) : nettoyable en un clic via
 * POST /admin/inscriptions/nettoyer-test (worker h4f-admin, session admin).
 *
 * Usage :
 *   node tools/generate-test-partners.mjs                 # dry-run, 5 comptes mixtes
 *   node tools/generate-test-partners.mjs --count 10        # dry-run, 10 comptes
 *   node tools/generate-test-partners.mjs --type printer    # dry-run, un seul type
 *   node tools/generate-test-partners.mjs --count 10 --yes  # ENVOI REEL vers prod
 *   node tools/generate-test-partners.mjs --url http://localhost:8787 --yes  # vers un worker local
 */

const WORKER_URL_DEFAULT = 'https://h4f-collect.duclosjulien.workers.dev';

const PRENOMS = ['Camille', 'Lucas', 'Emma', 'Hugo', 'Léa', 'Nathan', 'Chloé', 'Louis', 'Manon', 'Adam'];
const NOMS = ['Martin', 'Bernard', 'Durand', 'Petit', 'Robert', 'Richard', 'Moreau', 'Simon', 'Laurent', 'Lefebvre'];
const VILLES = [
  { ville: 'Rouen', cp: '76000' }, { ville: 'Lyon', cp: '69000' },
  { ville: 'Nantes', cp: '44000' }, { ville: 'Toulouse', cp: '31000' },
  { ville: 'Lille', cp: '59000' },
];
const LOGICIELS = ['Fusion 360', 'SolidWorks', 'Blender', 'FreeCAD', 'OnShape'];
const MATERIAUX = ['PLA', 'PETG', 'ABS', 'ASA', 'Nylon'];
const MACHINES = ['Prusa MK4', 'Bambu Lab X1C', 'Creality K1', 'Anycubic Kobra 2'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickSome(arr, n) { return [...arr].sort(() => Math.random() - 0.5).slice(0, n); }
function randTel() { return '06' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join(''); }
function randSuffix() { return Math.random().toString(36).slice(2, 8); }

function genProfile(type) {
  const prenom = pick(PRENOMS), nom = pick(NOMS);
  const suffix = randSuffix();
  // Email clairement identifiable comme test — jamais un vrai domaine de messagerie.
  const email = `${prenom.toLowerCase()}.${nom.toLowerCase()}+test-${suffix}@hub4fix-test.example`;
  const { ville, cp } = pick(VILLES);
  const base = { prenom, nom, tel: randTel(), cp, ville, statut: '' };

  if (type === 'modelisateur') {
    return {
      email, type, name: `${prenom} ${nom}`,
      fields: { ...base, logiciels: pickSome(LOGICIELS, 2), experience: '2 à 5 ans', message: '(compte de test genere)' },
      consent: { version: 'test', at: new Date().toISOString() },
      test: true,
    };
  }
  if (type === 'printer') {
    return {
      email, type, name: `${prenom} ${nom}`,
      fields: { ...base, parc_machines: `1× ${pick(MACHINES)}`, materiaux: pickSome(MATERIAUX, 2), message: '(compte de test genere)' },
      consent: { version: 'test', at: new Date().toISOString() },
      test: true,
    };
  }
  return { email, type: 'client', name: prenom, fields: { prenom }, consent: { version: 'test', at: new Date().toISOString() }, test: true };
}

function parseArgs(argv) {
  const out = { count: 5, type: null, yes: false, url: WORKER_URL_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--count') out.count = parseInt(argv[++i], 10) || 5;
    else if (argv[i] === '--type') out.type = argv[++i];
    else if (argv[i] === '--yes') out.yes = true;
    else if (argv[i] === '--url') out.url = argv[++i];
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const types = opts.type ? [opts.type] : ['modelisateur', 'printer', 'client'];
  const profiles = Array.from({ length: opts.count }, (_, i) => genProfile(types[i % types.length]));

  console.log(`${opts.yes ? 'ENVOI REEL' : 'DRY-RUN (aucun envoi)'} — ${profiles.length} compte(s) vers ${opts.url}\n`);

  for (const p of profiles) {
    console.log(`  [${p.type}] ${p.email}`);
    if (!opts.yes) continue;
    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:9090' },
        body: JSON.stringify(p),
      });
      const json = await res.json().catch(() => ({}));
      console.log(`    -> ${res.status} ${json.error || json.message || ''}`);
    } catch (e) {
      console.log(`    -> échec réseau: ${e.message}`);
    }
  }

  if (!opts.yes) {
    console.log('\nDry-run terminé. Relancez avec --yes pour envoyer réellement.');
  }
}

main();
