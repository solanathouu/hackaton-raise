// Smoke-test Gradium RÉEL : crédits (coupon), STT (voix -> texte), TTS fr/en/es + latences.
// (npm run smoke:gradium [chemin/audio.wav|webm])  Exige GRADIUM_API_KEY + MOCK_GRADIUM=false.
// Pour tester TA voix (bruitée/accentuée) : enregistre un sample au tel et passe-le en argument.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../src/config.js';
import { pingSTT, pingTTS, getCredits } from '../src/integrations/gradium.js';
import { detectLang } from '../src/integrations/lang.js';
import { hasFfmpeg } from '../src/integrations/audio.js';
import { whisperAvailable } from '../src/integrations/whisper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (config.mockGradium) console.warn('⚠ Gradium est MOCKÉ (USE_MOCKS/MOCK_GRADIUM). Passe MOCK_GRADIUM=false pour la vraie API.\n');
if (!config.gradium.apiKey) {
  console.error('❌ GRADIUM_API_KEY manquante. Coupon RAISE-2026 pour +100k crédits. Remplis .env.');
  process.exit(2);
}

console.log(`→ Base : ${process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai/api'} (auth x-api-key)`);
console.log(`→ ffmpeg : ${(await hasFfmpeg()) ? 'OK' : 'ABSENT (le webm de la PWA ne sera pas converti !)'}`);
console.log(`→ whisper fallback : ${whisperAvailable() ? 'configuré' : 'non configuré (optionnel)'}\n`);

let failures = 0;

// --- Crédits (le coupon est-il appliqué ?) ---
try {
  const c = await getCredits();
  console.log(`[credits] ✅ ${c.remaining_credits} / ${c.allocated_credits} restants\n`);
} catch (e) { failures++; console.error('[credits] ❌', e.message, '\n'); }

// --- STT ---
const samplePath = process.argv[2] || resolve(__dirname, 'sample.wav');
if (existsSync(samplePath)) {
  const buf = readFileSync(samplePath);
  console.log(`[STT] envoi ${samplePath} (${statSync(samplePath).size} o)…`);
  try {
    const { ms, result } = await pingSTT(buf, undefined); // pas de hint -> teste detectLang
    console.log(`  ⏱ ${ms} ms  →  texte: "${result.text}"  lang détectée: ${result.lang}`);
    if (!result.text) { failures++; console.error('  ❌ texte vide (voix bruitée ? format ?)\n'); }
    else console.log('  ✅ STT OK\n');
  } catch (e) { failures++; console.error('  ❌ STT échoué :', e.message, '\n'); }
} else {
  console.warn(`[STT] pas de sample (${samplePath}) — passe un .wav/.webm en argument.\n`);
}

// --- TTS dans les 3 langues de démo (valide les 3 voice_ids) ---
const PHRASES = {
  fr: 'Arrêt cardiaque au Manège Extrême, tu es le plus proche. Vas-y.',
  en: 'Cardiac arrest at the Extreme Ride, you are the closest. Go now.',
  es: 'Paro cardíaco en la Atracción Extrema, eres el más cercano. Ve ahora.',
};
for (const [lang, text] of Object.entries(PHRASES)) {
  console.log(`[TTS ${lang}] "${text.slice(0, 45)}…"`);
  try {
    const { ms, result } = await pingTTS(text, lang);
    console.log(`  ⏱ ${ms} ms  →  ${result.audioUrl}  ✅\n`);
  } catch (e) {
    failures++;
    console.error(`  ❌ TTS ${lang} échoué :`, e.message);
    console.error(`     Vérifie GRADIUM_VOICE_${lang.toUpperCase()} (la langue TTS = la voix).\n`);
  }
}

console.log('Rappel : le STT Gradium ne renvoie pas la langue -> hint app sinon detectLang (déterministe).');
console.log(failures === 0 ? '\n✅ SMOKE GRADIUM OK — passe MOCK_GRADIUM=false en démo.' : `\n❌ ${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
