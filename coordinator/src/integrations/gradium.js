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

// Gradium limite ~2 sessions TTS simultanées -> file d'attente + retry sur 1008 (apport P4).
// Défaut 2 (garde le bénéfice du Promise.all d'agent.js ; la PR mettait 1 = tout sérialisé).
const TTS_MAX = Math.max(1, Number(process.env.GRADIUM_TTS_CONCURRENCY || 2));
let ttsSlots = 0;
const ttsWait = [];
function acquireTtsSlot() {
  if (ttsSlots < TTS_MAX) { ttsSlots++; return Promise.resolve(); }
  return new Promise((resolve) => ttsWait.push(resolve));
}
function releaseTtsSlot() {
  ttsSlots = Math.max(0, ttsSlots - 1);
  const next = ttsWait.shift();
  if (next) { ttsSlots++; next(); } // hand-off du slot, pas de double-décrément
}
async function withTtsSlot(fn) {
  await acquireTtsSlot();
  try { return await fn(); } finally { releaseTtsSlot(); }
}
// POST TTS avec retry (backoff linéaire) sur la limite de concurrence Gradium (1008). Garde le timeout P3.
async function gradiumTtsRequest(body) {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetchWithTimeout(`${BASE}/post/speech/tts`, {
      method: 'POST',
      headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, TTS_TIMEOUT_MS);
    if (res.ok) return res;
    const errText = await res.text().catch(() => '');
    if (/Concurrency limit|1008/.test(errText) && attempt < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    throw new Error(`Gradium TTS ${res.status}: ${errText}`);
  }
  throw new Error('Gradium TTS: retries épuisés');
}

// --- transcribe : audio -> { text, lang } ---------------------------------
// Chaîne de résilience (F9) : Gradium -> whisper.cpp local (si configuré) -> fixture mock.
// `strict: true` (smoke tests) propage l'erreur Gradium au lieu de fallback.
export async function transcribe(audio, { lang, strict = false } = {}) {
  if (config.mockGradium) {
    const fx = loadMockFixtures();
    if (lang === 'es') return fx.transcribe_es;
    if (lang === 'fr') return fx.transcribe_fr;
    return fx.transcribe_en;
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
    return lang === 'es' ? fx.transcribe_es : lang === 'fr' ? fx.transcribe_fr : fx.transcribe_en;
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
  // Réponse ndjson : messages type:"text" = TOKENS (souvent sans espaces) ->
  // à joindre par ' ' comme dans la doc Gradium, sinon "Arrêtcardiaque-manège…"
  // et detectZone ne matche plus rien.
  const raw = await res.text();
  const parts = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const msg = JSON.parse(s);
      if (msg.type === 'text' && msg.text) parts.push(msg.text.trim());
      if (msg.type === 'error') throw new Error(`Gradium STT stream error: ${msg.message}`);
    } catch (e) {
      if (/stream error/.test(e.message)) throw e; // vraie erreur -> propage
    }
  }
  const text = parts.join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1') // pas d'espace avant la ponctuation
    .trim();
  if (!text) throw new Error('Gradium STT : transcription vide');
  // Gradium ne renvoie PAS la langue détectée -> hint sinon détection déterministe locale.
  return { text, lang: lang || detectLang(text) };
}

// --- speak : (text, lang) -> { audioUrl } ----------------------------------
export async function speak(text, lang = 'fr', { id, format = 'wav' } = {}) {
  if (config.mockGradium) return loadMockFixtures().speak; // { audioUrl: "/mock/tts-sample.mp3" }
  return withTtsSlot(async () => {
    const res = await gradiumTtsRequest({ text, voice_id: VOICE[lang] || VOICE.fr, output_format: format, only_audio: true });
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(TTS_DIR, { recursive: true });
    const fname = `${id || 'tts'}_${lang}.${format}`;
    writeFileSync(resolve(TTS_DIR, fname), audio);
    return { audioUrl: `/tts/${fname}` };
  });
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
