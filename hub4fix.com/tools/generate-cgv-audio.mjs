/**
 * Hub4Fix — Génère la voix-off premium des CGV via ElevenLabs.
 *
 * Pour chaque page CGV, produit :
 *   audio/<doc>.mp3          — la lecture vocale (voix française naturelle)
 *   audio/<doc>.align.json   — { voice, generatedAt, chunks:[{start}] }
 *                              temps de début de chaque ligne (h1/h2/h3/p/li)
 *                              pour le surlignage karaoké côté client.
 *
 * Le client (js/cgv-accept.js) charge ces deux fichiers et synchronise le
 * surlignage sur audio.currentTime. Si absents, il retombe sur la Web Speech API.
 *
 * IMPORTANT : l'ordre des lignes ici DOIT correspondre au sélecteur runtime
 * (.doc h1, h2, h3, p, li). Toute modification d'une CGV impose de relancer ce
 * script, sinon l'audio et le texte affiché se désynchronisent.
 *
 * Prérequis : Node 18+ (fetch natif).
 * Usage :
 *   ELEVENLABS_API_KEY=xxxx node tools/generate-cgv-audio.mjs
 *   ELEVENLABS_API_KEY=xxxx ELEVENLABS_VOICE_ID=yyyy node tools/generate-cgv-audio.mjs cgv-printer.html
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_KEY = process.env.ELEVENLABS_API_KEY;
// Voix FR par défaut (multilingue). Remplaçable via ELEVENLABS_VOICE_ID.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'XrExE9yKIg1WjnnlVkGX';
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

const DOCS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['cgv-modelisateurs.html', 'cgv-printer.html', 'cgv-clients.html'];

const SEP = ' \n ';   // séparateur entre lignes dans le texte parlé

// Extrait les lignes (mêmes sélecteurs que le runtime) dans l'ordre du document.
function extractChunks(html) {
  const main = (html.match(/<main[^>]*class="doc"[^>]*>([\s\S]*?)<\/main>/i) || [, html])[1];
  const chunks = [];
  const re = /<(h1|h2|h3|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(main))) {
    const text = m[2]
      .replace(/<[^>]+>/g, ' ')        // retire les balises internes
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
      .replace(/&euro;/g, '€').replace(/&#x2074;/g, '⁴').replace(/&[a-z0-9#]+;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (text.length > 1) chunks.push(text);
  }
  return chunks;
}

// Appel ElevenLabs "with-timestamps" : renvoie audio (base64) + alignement char.
async function synthesize(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return res.json(); // { audio_base64, alignment:{characters, character_start_times_seconds, ...} }
}

// À partir de l'alignement char, calcule le temps de début de chaque chunk.
function chunkStarts(chunks, alignment) {
  const startsByChar = alignment.character_start_times_seconds || [];
  const starts = [];
  let charPos = 0;
  for (let i = 0; i < chunks.length; i++) {
    starts.push({ start: +(startsByChar[charPos] || 0).toFixed(3) });
    charPos += chunks[i].length;
    if (i < chunks.length - 1) charPos += SEP.length; // compter le séparateur
  }
  return starts;
}

async function run() {
  if (!API_KEY) {
    console.error('ERREUR : définir ELEVENLABS_API_KEY (voir en-tête du script).');
    process.exit(1);
  }
  await mkdir(join(ROOT, 'audio'), { recursive: true });
  for (const doc of DOCS) {
    const html = await readFile(join(ROOT, doc), 'utf8');
    const chunks = extractChunks(html);
    const spoken = chunks.join(SEP);
    console.log(`${doc} : ${chunks.length} lignes, ${spoken.length} caractères → ElevenLabs…`);
    const out = await synthesize(spoken);
    const stem = basename(doc).replace(/\.html?$/i, '');
    await writeFile(join(ROOT, 'audio', `${stem}.mp3`), Buffer.from(out.audio_base64, 'base64'));
    const align = {
      voice: VOICE_ID, model: MODEL, generatedAt: new Date().toISOString(),
      chunks: chunkStarts(chunks, out.alignment || {}),
    };
    await writeFile(join(ROOT, 'audio', `${stem}.align.json`), JSON.stringify(align));
    console.log(`  → audio/${stem}.mp3 + audio/${stem}.align.json`);
  }
  console.log('Terminé.');
}

run().catch((e) => { console.error(e); process.exit(1); });
