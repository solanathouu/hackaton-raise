// gradium.js — Voix (Contrat D). transcribe(audio) et speak(text, lang).
// Endpoints RÉELS (docs.gradium.ai, vérifiés au kickoff) :
//   STT : POST {base}/post/speech/asr   header x-api-key, body = octets audio bruts,
//         réponse application/x-ndjson : lignes {type:"text",text,...} / {type:"end_text"}.
//   TTS : POST {base}/post/speech/tts   header x-api-key, JSON {text,voice_id,output_format,only_audio:true}
//         -> octets audio bruts (only_audio:true).
// Clé = serveur uniquement, jamais côté client. Mock 100% fonctionnel via USE_MOCKS.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config, loadMockFixtures } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TTS_DIR = resolve(__dirname, '../../tts-cache');

const BASE = process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai/api';
// Gradium détermine la langue TTS par le voice_id -> une voix par langue.
const VOICE = {
  fr: process.env.GRADIUM_VOICE_FR || 'default',
  en: process.env.GRADIUM_VOICE_EN || 'default',
  es: process.env.GRADIUM_VOICE_ES || 'default',
};
const CT_BY_FORMAT = { wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };

// --- transcribe : audio -> { text, lang } ---------------------------------
export async function transcribe(audio, { lang, inputFormat = 'opus' } = {}) {
  if (config.useMocks) {
    const fx = loadMockFixtures();
    return lang === 'es' ? fx.transcribe_es : fx.transcribe_fr; // hint 'es' pour la démo S4
  }
  const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio, 'base64');
  const qs = new URLSearchParams({ input_format: inputFormat });
  if (lang) qs.set('json_config', JSON.stringify({ language: lang }));
  const res = await fetch(`${BASE}/post/speech/asr?${qs}`, {
    method: 'POST',
    headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': CT_BY_FORMAT[inputFormat] || 'audio/wav' },
    body: buf,
  });
  if (!res.ok) throw new Error(`Gradium STT ${res.status}: ${await res.text().catch(() => '')}`);
  // Réponse ndjson : concatène tous les messages type:"text".
  const raw = await res.text();
  let text = '';
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const msg = JSON.parse(s);
      if (msg.type === 'text' && msg.text) text += msg.text;
      if (msg.type === 'error') throw new Error(`Gradium STT stream error: ${msg.message}`);
    } catch (e) {
      if (/stream error/.test(e.message)) throw e; // vraie erreur -> propage
    }
  }
  // Gradium ne renvoie pas la langue détectée -> on garde le hint (défaut fr).
  return { text: text.trim(), lang: lang || 'fr' };
}

// --- speak : (text, lang) -> { audioUrl } ----------------------------------
export async function speak(text, lang = 'fr', { id, format = 'wav' } = {}) {
  if (config.useMocks) return loadMockFixtures().speak; // { audioUrl: "/mock/tts-sample.mp3" }
  const res = await fetch(`${BASE}/post/speech/tts`, {
    method: 'POST',
    headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: VOICE[lang] || VOICE.fr, output_format: format, only_audio: true }),
  });
  if (!res.ok) throw new Error(`Gradium TTS ${res.status}: ${await res.text().catch(() => '')}`);
  const audio = Buffer.from(await res.arrayBuffer());
  mkdirSync(TTS_DIR, { recursive: true });
  const fname = `${id || 'tts'}_${lang}.${format}`;
  writeFileSync(resolve(TTS_DIR, fname), audio);
  return { audioUrl: `/tts/${fname}` };
}

// Smoke helpers (scripts/smoke-gradium.js).
export async function pingSTT(audioBuf, lang, inputFormat) {
  const t0 = Date.now();
  const r = await transcribe(audioBuf, { lang, inputFormat });
  return { ms: Date.now() - t0, result: r };
}
export async function pingTTS(text, lang) {
  const t0 = Date.now();
  const r = await speak(text, lang, { id: 'smoke' });
  return { ms: Date.now() - t0, result: r };
}
