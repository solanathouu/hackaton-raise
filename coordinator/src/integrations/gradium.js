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

// Gradium limite ~2 sessions TTS simultanées — file d'attente + retry sur 1008.
const TTS_MAX = Math.max(1, Number(process.env.GRADIUM_TTS_CONCURRENCY || 1));
let ttsSlots = 0;
const ttsWait = [];

function acquireTtsSlot() {
  if (ttsSlots < TTS_MAX) {
    ttsSlots++;
    return Promise.resolve();
  }
  return new Promise((resolve) => ttsWait.push(resolve));
}

function releaseTtsSlot() {
  ttsSlots = Math.max(0, ttsSlots - 1);
  const next = ttsWait.shift();
  if (next) {
    ttsSlots++;
    next();
  }
}

async function withTtsSlot(fn) {
  await acquireTtsSlot();
  try {
    return await fn();
  } finally {
    releaseTtsSlot();
  }
}

async function gradiumTtsRequest(body) {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`${BASE}/post/speech/tts`, {
      method: 'POST',
      headers: { 'x-api-key': config.gradium.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
export async function transcribe(audio, { lang, inputFormat = 'opus' } = {}) {
  if (config.mockGradium) {
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
  if (config.mockGradium) return loadMockFixtures().speak;
  return withTtsSlot(async () => {
    const res = await gradiumTtsRequest({
      text,
      voice_id: VOICE[lang] || VOICE.fr,
      output_format: format,
      only_audio: true,
    });
    const audio = Buffer.from(await res.arrayBuffer());
    mkdirSync(TTS_DIR, { recursive: true });
    const fname = `${id || 'tts'}_${lang}.${format}`;
    writeFileSync(resolve(TTS_DIR, fname), audio);
    return { audioUrl: `/tts/${fname}` };
  });
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
