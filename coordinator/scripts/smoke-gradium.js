// Smoke-test Gradium : STT (voix -> texte) + TTS (texte -> audio) + latence. (npm run smoke:gradium)
// Exige GRADIUM_API_KEY. Utilise scripts/sample.wav (voix FR) comme entrée STT.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from '../src/config.js';
import { pingSTT, pingTTS } from '../src/integrations/gradium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (config.useMocks) console.warn('⚠ USE_MOCKS=true : passe à false dans .env pour tester la VRAIE API Gradium.\n');
if (!config.gradium.apiKey) {
  console.error('❌ GRADIUM_API_KEY manquante. Coupon RAISE-2026 pour +100k crédits. Remplis .env.');
  process.exit(2);
}

const samplePath = process.argv[2] || resolve(__dirname, 'sample.wav');
console.log(`→ Base : ${process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai/api'} (auth x-api-key)\n`);

// --- STT ---
if (existsSync(samplePath)) {
  const buf = readFileSync(samplePath);
  console.log(`[STT] envoi ${samplePath} (${statSync(samplePath).size} o, format wav)…`);
  try {
    const { ms, result } = await pingSTT(buf, 'fr', 'wav');
    console.log(`  ⏱ ${ms} ms  →  texte: "${result.text}"  lang: ${result.lang}`);
    console.log(result.text ? '  ✅ STT OK\n' : '  ⚠ texte vide (voix bruitée ? mauvais format ? cf docs)\n');
  } catch (e) { console.error('  ❌ STT échoué :', e.message, '\n'); }
} else {
  console.warn(`[STT] pas de sample (${samplePath}). Génère-le : say -o /tmp/s.aiff "..."; ffmpeg -i /tmp/s.aiff sample.wav\n`);
}

// --- TTS ---
console.log('[TTS] synthèse "Arrêt cardiaque au manège extrême, tu es le plus proche."…');
try {
  const { ms, result } = await pingTTS('Arrêt cardiaque au manège extrême, tu es le plus proche. Vas-y.', 'fr');
  console.log(`  ⏱ ${ms} ms  →  audioUrl: ${result.audioUrl}`);
  console.log('  ✅ TTS OK (fichier écrit dans tts-cache/)\n');
} catch (e) {
  console.error('  ❌ TTS échoué :', e.message);
  console.error('     Vérifie voice_id (GRADIUM_VOICE_FR) : Gradium détermine la langue par la voix.\n');
}
console.log('Note : la langue détectée n\'est PAS renvoyée par le STT Gradium — on garde le hint côté app.');
