/**
 * Hub4Fix — "le cerveau" : assistant conversationnel branché sur Workers AI.
 *
 * Modèle : @cf/google/gemma-4-26b-a4b-it (Gemma 4, Google).
 *   Function calling : oui. Vision : oui. Contexte : 256K.
 *   Tarif au 2026-07-21 : 0,10 $ / M tokens entrée, 0,30 $ / M tokens sortie.
 *   Source : https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
 *
 * GARDE-FOU CENTRAL — le modèle n'a PAS le droit de citer une pièce de mémoire.
 * Sa seule fenêtre sur le catalogue est l'outil `chercher_piece`, qui interroge
 * le feed public réel. Toute référence renvoyée au client provient donc d'une
 * ligne existante en base. Une référence inventée = un client qui achète la
 * mauvaise pièce : c'est le risque n°1 de cette fonctionnalité.
 *
 * L'assistant ORIENTE, il n'engage jamais Hub4Fix : pas de devis ferme, pas de
 * délai promis hors de ceux écrits dans les conditions, pas de tri définitif
 * entre pièce simple et pièce complexe (arbitrage humain, cf. cgv-repair-together.html).
 */

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const FEED_URL = 'https://h4f-admin.duclosjulien.workers.dev/api/pieces.json';

// Quotas horaires. L'assistant coûte de l'argent à chaque message : sans plafond,
// il devient un ChatGPT gratuit financé par Hub4Fix.
const LIMIT_ANON = 20;
const LIMIT_USER = 60;
const WINDOW_S = 3600;

const MAX_HISTORY = 16;          // tours conservés (le reste est coupé côté serveur)
const MAX_CHARS = 1500;          // par message client
const MAX_IMAGE_B64 = 1600000;   // ~1,2 Mo d'image après décodage base64
const MAX_TOOL_ROUNDS = 2;       // au-delà, le modèle tourne en rond

// ---------------------------------------------------------------- consigne système
// Écrite en français : le modèle répond en français, autant qu'il raisonne dedans.
const SYSTEM = `Tu es l'assistant de Hub4Fix, une plateforme qui fait revivre les appareils du quotidien en imprimant en 3D les pièces détachées qu'on ne trouve plus.

TON
Tu vouvoies. Tu es chaleureux, direct, jamais bavard : deux ou trois phrases par réponse, pas de listes à puces, pas de jargon. Le client est souvent agacé par un appareil en panne — tu le rassures d'abord, tu questionnes ensuite.

TA SEULE SOURCE DE VÉRITÉ
Tu ne connais AUCUNE pièce par cœur. Pour parler d'une pièce, tu DOIS appeler l'outil chercher_piece. Tu ne cites que des pièces renvoyées par cet outil, avec leur nom exact.
Il t'est formellement interdit d'inventer une référence, un prix, une dimension, un délai de fabrication ou une compatibilité. Si l'information n'est pas dans le résultat de l'outil, tu dis que tu ne l'as pas.

CE QUE TU CHERCHES À SAVOIR
Pour identifier une pièce il te faut : le type d'appareil, la marque, et si possible le modèle. Le modèle est écrit sur la plaque signalétique (une étiquette collée sous ou derrière l'appareil). Tu peux proposer au client de la photographier : tu sais lire les images.

TROIS CAS SELON CE QUE RENVOIE L'OUTIL
Chaque pièce trouvée porte un champ « disponibilite ». Il commande ta réponse.

1) Pièce trouvée et DISPONIBLE (disponibilite = « disponible » : elle est modélisée, elle fait partie de la MarketList). Tu l'annonces par son nom exact et tu invites le client à ouvrir sa fiche pour l'obtenir. Tu ne promets ni prix ni délai que tu n'aurais pas lus dans le résultat.

2) Pièce trouvée mais EN COURS D'ACQUISITION (disponibilite = « en cours d'acquisition » : repérée par notre veille, pas encore modélisée). Tu expliques qu'on l'a bien identifiée mais qu'elle n'est pas encore prête. Deux voies, sans rien garantir ni chiffrer :
- la voie rapide, le programme Repair Together : le client nous envoie sa pièce cassée, nous la modélisons, la première est offerte (tu ajoutes « voir conditions », sans citer de montant) ;
- sans rien envoyer : manifester son intérêt depuis la fiche (liste d'attente), ce qui fait monter la priorité de modélisation de la pièce.

3) Pièce NON TROUVÉE (l'outil ne renvoie rien : ni disponible, ni en cours d'acquisition). Elle ne fait pas partie de nos pièces identifiées. Il n'y a donc PAS de Repair Together ni de gratuité possible. Tu proposes un devis de conception sur mesure (service payant) et tu invites le client à décrire et photographier sa pièce et la plaque signalétique pour qu'on puisse l'établir. Tu ne chiffres jamais toi-même.

Repair Together n'est ouvert QU'aux pièces en cours d'acquisition (cas 2), jamais aux pièces non trouvées (cas 3). Tu ne détailles les conditions qu'une fois le client intéressé.

NOMS INTERNES — NE PAS DIRE AU CLIENT
« Shadow List », « Hot List » et « MarketList » sont des termes internes : tu ne les prononces JAMAIS face au client. Tu décris l'état de la pièce en mots simples : « disponible » ou « en cours d'acquisition ». Le seul nom public que tu peux employer est « la marketplace » (notre liste générale de pièces).

LIMITES DE FABRICATION
Hub4Fix ne réalise pas les pièces soumises à de fortes contraintes : forte chaleur, pression, ou pièces assurant une fonction de sécurité. Tu peux ÉNONCER cette règle au client comme une politique de la maison.
Mais tu ne DÉCIDES jamais toi-même qu'une pièce précise tombe dans cette catégorie : le mot employé par le client ne suffit pas à le savoir (une « poignée de hublot » peut n'être qu'un carter décoratif parfaitement imprimable). Donc :
- Pièce trouvée au catalogue : elle a déjà été validée par un humain, tu t'appuies sur sa fiche, tu ne remets pas son éligibilité en cause.
- Pièce hors catalogue : tu n'affirmes jamais qu'elle est réalisable. Tu rappelles la règle ci-dessus et tu précises qu'un modélisateur vérifiera ce point sur sa pièce lors de l'examen de sa demande.

CE QUE TU NE FAIS PAS
Tu ne chiffres jamais un devis. Tu ne dis jamais si une pièce sera « simple » ou « complexe » à modéliser : c'est un modélisateur qui tranche. Tu n'inventes pas de délai. Tu ne parles pas de fichier STL, STEP ou 3MF : Hub4Fix ne diffuse jamais le modèle source, le client obtient des droits d'usage et un fichier d'impression.
Si la question sort de la réparation d'appareils, tu ramènes gentiment le client vers ce que tu sais faire.`;

// Gemma 4 sur Workers AI tourne derrière un backend OpenAI-compatible (sglang,
// POST /v1/chat/completions). Il EXIGE donc le format OpenAI : { type:'function',
// function:{ name, description, parameters } }. (Le format natif { name, … } lève
// une 400 "tools.0.function: Field required".) Réponse au format OpenAI aussi :
// res.choices[0].message.{content, tool_calls[]}, tool_calls[].function.arguments = string JSON.
const TOOLS = [{
  type: 'function',
  function: {
    name: 'chercher_piece',
    description: "Cherche une pièce détachée dans le catalogue réel de Hub4Fix. À appeler dès que le client décrit un appareil ou une pièce. Renvoie une liste éventuellement vide.",
    parameters: {
      type: 'object',
      properties: {
        requete: {
          type: 'string',
          description: "Ce que cherche le client, en langage courant : appareil, marque, modèle, pièce. Ex. « poignée aspirateur Dyson SV10 ».",
        },
      },
      required: ['requete'],
    },
  },
}];

// ---------------------------------------------------------------- catalogue
// Cache mémoire par isolate : le feed est déjà en cache 120 s côté worker admin,
// inutile de le retélécharger à chaque tour de conversation.
let feedCache = { at: 0, products: [] };

async function loadFeed() {
  if (Date.now() - feedCache.at < 120000 && feedCache.products.length) return feedCache.products;
  try {
    const res = await fetch(FEED_URL, { cf: { cacheTtl: 120 } });
    if (!res.ok) return feedCache.products;
    const data = await res.json();
    const products = Array.isArray(data.products) ? data.products : [];
    feedCache = { at: Date.now(), products };
    return products;
  } catch (e) {
    return feedCache.products; // le catalogue est injoignable : on ne bloque pas la conversation
  }
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(new RegExp('[\u0300-\u036f]','g'), '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mots trop courants pour discriminer quoi que ce soit dans une requête de réparation.
const STOP = new Set(['je', 'jai', 'ai', 'cherche', 'recherche', 'veux', 'besoin', 'de', 'du',
  'la', 'le', 'les', 'un', 'une', 'des', 'pour', 'mon', 'ma', 'mes', 'est', 'casse', 'cassee',
  'reparer', 'piece', 'pieces', 'et', 'avec', 'sur', 'dans', 'il', 'elle', 'que', 'qui', 'sa', 'son']);

// Proportion minimale des mots de la requête qui doivent être retrouvés dans la
// fiche. Réglage volontairement SÉVÈRE, et l'asymétrie est assumée : un silence
// bascule le client vers Repair Together (bonne issue), un faux positif lui fait
// acheter la pièce d'un autre appareil (mauvaise issue, irrattrapable).
// Sans ce seuil, « levier machine à café Faema » remontait des leviers de Senseo.
const MIN_COVERAGE = 0.6;

// Marques réellement présentes au catalogue, déduites du feed (pas de liste en dur
// à maintenir). Sert au veto ci-dessous.
function brandsOf(products) {
  const set = new Set();
  // Découpe aussi sur le tiret : « Bosch-Siemens » doit donner « bosch » ET « siemens ».
  for (const p of products) for (const w of norm(p.brand).split(/[\s-]+/)) if (w.length > 2) set.add(w);
  return set;
}

// Score par recouvrement de mots. Volontairement basique : la compréhension du
// langage est faite par le modèle, qui reformule la requête avant de nous
// l'envoyer. Ici on ne fait que retrouver les lignes correspondantes — et surtout
// refuser celles qui ne correspondent pas.
function searchPieces(products, requete, limit) {
  const words = norm(requete).split(' ').filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return [];

  // Veto marque : si le client nomme une marque que nous référençons, une pièce
  // d'une AUTRE marque n'est jamais une réponse acceptable. « poignée Bosch » ne
  // doit pas remonter une poignée Whirlpool, même si tout le reste concorde.
  const known = brandsOf(products);
  const askedBrands = words.filter((w) => known.has(w));

  const scored = [];
  for (const p of products) {
    const brand = norm([p.brand, p.group, p.machine].join(' '));
    if (askedBrands.length && !askedBrands.some((b) => brand.includes(b))) continue;

    const hay = norm([p.name, p.machine, p.brand, p.range, p.model, p.category, p.piece, p.compat].join(' '));
    let score = 0, matched = 0;
    for (const w of words) {
      if (hay.includes(w)) { score += 2; matched++; }
      else if (w.length > 4 && hay.includes(w.slice(0, w.length - 1))) { score += 1; matched++; } // pluriel/accord
    }
    if (matched / words.length >= MIN_COVERAGE) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ p }) => ({
    id: p.id,
    nom: p.name,
    appareil: p.machine,
    marque: p.brand,
    modele: p.model && p.model !== 'generic' ? p.model : '',
    categorie: p.category,
    modelisee: !!p.modeled,
    // Traduit le drapeau `modeled` en verdict métier lisible par le modèle :
    //   modélisée  -> MarketList, achat direct.
    //   pas encore -> Shadow List « en cours d'acquisition », éligible Repair Together.
    disponibilite: p.modeled ? 'disponible' : "en cours d'acquisition",
    // Champs souvent vides tant que la pièce n'est pas modélisée : on ne les
    // transmet que renseignés, sinon le modèle est tenté de combler les blancs.
    ...(p.price ? { prix: p.price } : {}),
    ...(p.material ? { matiere: p.material } : {}),
    ...(p.dimensions ? { dimensions: p.dimensions } : {}),
    fiche: 'produit.html?id=' + encodeURIComponent(p.id),
  }));
}

// ---------------------------------------------------------------- quota
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Le compteur anonyme est indexé sur un HACHÉ d'IP salé par SESSION_SECRET :
// on veut plafonner l'usage sans conserver d'adresse IP en clair (RGPD, minimisation).
async function quotaBucket(request, env, uid) {
  if (uid) return 'u:' + uid;
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  return 'ip:' + (await sha256hex(ip + '|' + (env.SESSION_SECRET || ''))).slice(0, 32);
}

async function checkQuota(env, bucket, limit) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM ai_usage WHERE bucket = ? AND ts > ?'
  ).bind(bucket, now - WINDOW_S).first();
  const used = row ? row.n : 0;
  if (used >= limit) return { ok: false, used, limit };
  await env.DB.prepare('INSERT INTO ai_usage (bucket, ts) VALUES (?, ?)').bind(bucket, now).run();
  // Purge opportuniste : évite une table qui gonfle sans tâche planifiée.
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM ai_usage WHERE ts < ?').bind(now - WINDOW_S * 24).run();
  }
  return { ok: true, used: used + 1, limit };
}

// ---------------------------------------------------------------- assainissement
// Le client contrôle entièrement le corps de la requête : il pourrait tenter d'y
// glisser un message system pour réécrire les consignes. On ne garde donc que les
// rôles user/assistant, et la consigne système est toujours ajoutée par nous.
function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content.slice(0, MAX_CHARS) });
      continue;
    }
    // Contenu multimodal : texte + une image (plaque signalétique).
    if (Array.isArray(m.content) && m.role === 'user') {
      const parts = [];
      let images = 0;
      for (const part of m.content) {
        if (!part) continue;
        if (part.type === 'text' && typeof part.text === 'string') {
          parts.push({ type: 'text', text: part.text.slice(0, MAX_CHARS) });
        } else if (part.type === 'image_url' && images < 1) {
          const url = part.image_url && part.image_url.url;
          if (typeof url === 'string' && url.startsWith('data:image/') && url.length <= MAX_IMAGE_B64) {
            parts.push({ type: 'image_url', image_url: { url } });
            images++;
          }
        }
      }
      if (parts.length) out.push({ role: m.role, content: parts });
    }
  }
  return out;
}

// ---------------------------------------------------------------- filtre de sujet (déterministe)
// Barrière AVANT tout appel au modèle. Rôle : dévier l'abus grossier (« écris-moi
// un poème », « code en python ») sans dépenser un appel ni laisser le modèle
// improviser. Volontairement à MAILLES LARGES : au moindre doute on laisse passer,
// car bloquer un vrai client (« ça fait un bruit bizarre ») est bien pire que de
// gaspiller un appel recadré par la consigne. Ce n'est PAS un videur zélé — le
// langage de réparation est trop varié pour être capturé par une liste de mots.
//
// Ce filtre attrape l'abus paresseux, pas l'abus déterminé (qui déguiserait sa
// requête) : celui-là est traité par le quota, et plus tard par Turnstile.

// Signaux « on parle bien de réparation » : appareils, symptômes, pièces, intention.
const TOPIC_SIGNALS = [
  'appareil', 'panne', 'casse', 'cass', 'repar', 'repare', 'piece', 'rechange', 'detache',
  'remplac', 'fonctionne', 'marche plus', 'fuit', 'fuite', 'bruit', 'plaque', 'modele', 'reference',
  'lave', 'linge', 'vaisselle', 'frigo', 'refrigerateur', 'congelateur', 'four', 'micro', 'onde',
  'aspirateur', 'cafetiere', 'cafe', 'expresso', 'bouilloire', 'seche', 'hotte', 'plaque', 'robot',
  'mixeur', 'blender', 'tondeuse', 'rasoir', 'imprimante', 'poignee', 'bouton', 'roue', 'roulette',
  'charniere', 'bac', 'tiroir', 'filtre', 'engrenage', 'pignon', 'clip', 'support', 'hublot', 'joint',
  'couvercle', 'levier', 'grille', 'porte', 'trappe', 'reservoir', 'manette', 'molette', 'capot', 'carter',
  'reparer', 'imprimer', 'imprim', '3d',
];

// Signaux « clairement hors-sujet ». On ne bloque QUE si l'un d'eux est présent
// ET qu'aucun signal de réparation ne l'est. Restreint aux détournements typiques
// d'un assistant gratuit ; en cas d'hésitation, ne rien mettre ici.
const OFFTOPIC_SIGNALS = [
  'poeme', 'poesie', 'chanson', 'histoire drole', 'blague', 'raconte', 'ecris moi', 'ecris-moi',
  'code', 'python', 'javascript', 'programme', 'fonction js', 'script', 'sql',
  'traduis', 'traduction', 'resume ce', 'dissertation', 'redige',
  'capitale de', 'president', 'meteo', 'recette', 'cuisine', 'horoscope',
  'mathematique', 'equation', 'calcule', 'devoir', 'philosophie', 'religion', 'politique',
];

// true = laisser passer (par défaut). false = dévier sans appeler le modèle.
function isOnTopic(text) {
  const n = ' ' + String(text || '').toLowerCase()
    .normalize('NFD').replace(new RegExp('[̀-ͯ]', 'g'), '') + ' ';
  if (n.length < 6) return true;                       // « bonjour », « oui »… on laisse passer
  const hasTopic = TOPIC_SIGNALS.some((w) => n.includes(w));
  if (hasTopic) return true;                           // un seul signal réparation suffit
  const hasOff = OFFTOPIC_SIGNALS.some((w) => n.includes(w));
  return !hasOff;                                      // hors-sujet marqué + zéro réparation -> on dévie
}

const OFFTOPIC_REPLY = "Je suis l'assistant réparation de Hub4Fix : je vous aide à retrouver une pièce détachée pour un appareil en panne. Dites-moi quel appareil vous pose souci, et sa marque si vous la connaissez.";

// ---------------------------------------------------------------- handler
export async function handleAiChat(request, env, origin, json, readToken, getSessionToken) {
  if (!env.AI) return json({ error: 'ai_indisponible' }, 503, origin);

  const session = await readToken(getSessionToken(request), env.SESSION_SECRET);
  const uid = session ? session.uid : null;

  const bucket = await quotaBucket(request, env, uid);
  const quota = await checkQuota(env, bucket, uid ? LIMIT_USER : LIMIT_ANON);
  if (!quota.ok) {
    return json({
      error: 'quota_atteint',
      message: uid
        ? "Vous avez atteint la limite de messages pour cette heure. Réessayez un peu plus tard."
        : "Vous avez atteint la limite de messages pour cette heure. Créez un compte pour discuter davantage.",
    }, 429, origin);
  }

  const body = await request.json().catch(() => ({}));
  const history = sanitizeHistory(body.messages);
  if (!history.length) return json({ error: 'messages_vides' }, 400, origin);

  // Filtre de sujet : on n'examine que le DERNIER message client. Une image (plaque)
  // le rend d'office dans le sujet. La déviation est renvoyée telle une réponse
  // normale (200) — le client ne voit pas une erreur, juste un recadrage.
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const lastIsText = lastUser && typeof lastUser.content === 'string';
  if (lastIsText && !isOnTopic(lastUser.content)) {
    return json({ reply: OFFTOPIC_REPLY, pieces: [], remaining: Math.max(0, quota.limit - quota.used), off_topic: true }, 200, origin);
  }

  const messages = [{ role: 'system', content: SYSTEM }, ...history];
  const products = await loadFeed();
  const used = [];  // pièces réellement renvoyées par l'outil, pour affichage côté client

  let reply = '';
  let lastRes = null;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLast = round === MAX_TOOL_ROUNDS;
    const res = await env.AI.run(MODEL, {
      messages,
      tools: TOOLS,
      // Au dernier tour : outils toujours DÉCLARÉS (sinon l'historique contient des
      // tool_calls sans outils correspondants → réponse vide), mais tool_choice='none'
      // force le modèle à conclure en texte plutôt qu'à rechercher encore.
      tool_choice: isLast ? 'none' : 'auto',
      max_completion_tokens: 400,
      temperature: 0.4,
    });
    lastRes = res;

    // Format OpenAI (sglang) : res.choices[0].message.{content, tool_calls[]}.
    // On lit défensivement res.response en secours au cas où un champ varierait.
    const message = (res && res.choices && res.choices[0] && res.choices[0].message) || null;
    const calls = (message && Array.isArray(message.tool_calls)) ? message.tool_calls : [];

    if (!calls.length) {
      reply = (message && typeof message.content === 'string' && message.content)
        || (res && typeof res.response === 'string' ? res.response : '') || '';
      break;
    }

    // On rejoue le message d'appel de l'assistant tel quel, puis chaque résultat.
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
    for (const call of calls) {
      const fn = call.function || {};
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      args = args || {};
      const found = fn.name === 'chercher_piece'
        ? searchPieces(products, args.requete || '', 5)
        : [];
      for (const f of found) if (!used.some((u) => u.id === f.id)) used.push(f);

      const toolResult = found.length
        ? { resultats: found }
        : { resultats: [], note: "Aucune pièce trouvée, ni disponible ni en cours d'acquisition. Ne rien inventer. Cette pièce ne fait pas partie de nos pièces identifiées : proposer un devis de conception sur mesure (service payant), PAS Repair Together. Inviter le client à décrire et photographier la pièce et la plaque." };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
    }
  }

  if (!reply) reply = "Je n'ai pas réussi à formuler ma réponse. Pouvez-vous reformuler ?";

  const out = {
    reply,
    pieces: used,                     // le front affiche les vraies fiches, pas le texte du modèle
    remaining: Math.max(0, quota.limit - quota.used),
  };
  // Diagnostic caché (retiré après mise au point) : ?diag dans le corps expose la
  // forme brute de la dernière réponse du modèle, sans données client.
  if (body && body.diag === 'h4f-diag') {
    out._diag = { keys: lastRes ? Object.keys(lastRes) : [], sample: JSON.stringify(lastRes).slice(0, 900) };
  }
  return json(out, 200, origin);
}
