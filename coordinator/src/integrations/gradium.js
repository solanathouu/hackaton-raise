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
import { prepareForGradium } from './audio.js';
import { detectLang } from './lang.js';
import { transcribeLocal, whisperAvailable } from './whisper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TTS_DIR = resolve(__dirname, '../../tts-cache');

const BASE = process.env.GRADIUM_BASE_URL || 'https://api.gradium.ai/api';
// Gradium détermine la langue TTS par le voice_id -> une voix par langue.
const VOICE = {
  fr: process.env.GRADIUM_VOICE_FR || 'default',
  en: process.env.GRADIUM_VOICE_EN || 'default',
  es: process.env.GRADIUM_VOICE_ES || 'default',
};
const STT_TIMEOUT_MS = Number(process.env.GRADIUM_STT_TIMEOUT_MS || 8000);
const TTS_TIMEOUT_MS = Number(process.env.GRADIUM_TTS_TIMEOUT_MS || 8000);

function fetchWithTimeout(url, options, timeoutMs) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// --- transcribe : audio -> { text, lang } ---------------------------------
// Chaîne de résilience (F9) : Gradium -> whisper.cpp local (si configuré) -> fixture mock.
// `strict: true` (smoke tests) propage l'erreur Gradium au lieu de fallback.
export async function transcribe(audio, { lang, strict = false } = {}) {
  if (config.mockGradium) {
    const fx = loadMockFixtures();
    return lang === 'es' ? fx.transcribe_es : fx.transcribe_fr; // hint 'es' pour la démo S4
  }
  const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio, 'base64');
  try {
    return await gradiumTranscribe(buf, lang);
  } catch (err) {
    if (strict) throw err;
    console.warn(`[gradium] STT KO (${err.message}) -> fallback whisper local`);
    if (whisperAvailable()) {
      try {
        return await transcribeLocal(buf, { lang });
      } catch (werr) {
        console.warn(`[gradium] whisper KO aussi (${werr.message}) -> fixture mock`);
      }
    }
    // Dernier filet : fixture déterministe, le pipeline continue (jamais d'écran figé).
    const fx = loadMockFixtures();
    return lang === 'es' ? fx.transcribe_es : fx.transcribe_fr;
  }
}

async function gradiumTranscribe(buf, lang) {
  // Sniff par magic bytes : la PWA envoie du webm/opus (MediaRecorder) que
  // Gradium ne prend pas en direct -> conversion ffmpeg en WAV si dispo.
  const { body, contentType } = await prepareForGradium(buf);
  const qs = new URLSearchParams();
  if (lang) qs.set('json_config', JSON.stringify({ language: lang }));
  const res = await fetchWithTimeout(`${BASE}/post/speech/asr?${qs}`, {
    method: 'POST',
    headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': contentType },
    body,
  }, STT_TIMEOUT_MS);
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
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Gradium STT : transcription vide');
  // Gradium ne renvoie PAS la langue détectée -> hint sinon détection déterministe locale.
  return { text, lang: lang || detectLang(text) };
}

// --- speak : (text, lang) -> { audioUrl } ----------------------------------
export async function speak(text, lang = 'fr', { id, format = 'wav' } = {}) {
  if (config.mockGradium) return loadMockFixtures().speak; // { audioUrl: "/mock/tts-sample.mp3" }
  const res = await fetchWithTimeout(`${BASE}/post/speech/tts`, {
    method: 'POST',
    headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: VOICE[lang] || VOICE.fr, output_format: format, only_audio: true }),
  }, TTS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Gradium TTS ${res.status}: ${await res.text().catch(() => '')}`);
  const audio = Buffer.from(await res.arrayBuffer());
  mkdirSync(TTS_DIR, { recursive: true });
  const fname = `${id || 'tts'}_${lang}.${format}`;
  writeFileSync(resolve(TTS_DIR, fname), audio);
  return { audioUrl: `/tts/${fname}` };
}

// Vérif crédits/coupon : GET /usages/credits -> { remaining_credits, allocated_credits, ... }
export async function getCredits() {
  const res = await fetchWithTimeout(`${BASE}/usages/credits`, {
    headers: { 'x-api-key': config.gradium.apiKey },
  }, 5000);
  if (!res.ok) throw new Error(`Gradium credits ${res.status}`);
  return res.json();
}

// Smoke helpers (scripts/smoke-gradium.js). strict : pas de fallback, on veut VOIR l'erreur.
export async function pingSTT(audioBuf, lang) {
  const t0 = Date.now();
  const r = await transcribe(audioBuf, { lang, strict: true });
  return { ms: Date.now() - t0, result: r };
}
export async function pingTTS(text, lang) {
  const t0 = Date.now();
  const r = await speak(text, lang, { id: 'smoke' });
  return { ms: Date.now() - t0, result: r };
}
