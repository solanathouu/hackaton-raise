// whisper.js — Fallback STT local via whisper.cpp (spawn binaire, zéro réseau, F9).
// Appelé par gradium.js si l'API Gradium échoue. Optionnel : sans WHISPER_BIN/MODEL
// configurés, gradium.js saute directement au filet mock.
//
// Setup (laptop de démo, une fois) :
//   1. Binaire whisper-cli : https://github.com/ggml-org/whisper.cpp/releases
//   2. Modèle multilingue : ggml-base.bin (~148 Mo, fr/en/es OK pour vocabulaire contraint)
//      https://huggingface.co/ggerganov/whisper.cpp/tree/main
//   3. .env : WHISPER_BIN=... WHISPER_MODEL=...   (+ ffmpeg dans le PATH pour le webm)

import { spawn } from 'node:child_process';
import { writeFile, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sniffFormat, toWav, hasFfmpeg } from './audio.js';
import { detectLang } from './lang.js';

// Lecture PARESSEUSE de l'env (pas à l'import) : dotenv (config.js) doit avoir
// tourné d'abord, ce qui n'est pas garanti pour un script/test isolé.
const WHISPER_BIN = () => process.env.WHISPER_BIN || '';
const WHISPER_MODEL = () => process.env.WHISPER_MODEL || '';
const WHISPER_TIMEOUT_MS = () => Number(process.env.WHISPER_TIMEOUT_MS || 15000);

export function whisperAvailable() {
  return Boolean(WHISPER_BIN() && WHISPER_MODEL());
}

// Même forme que le Contrat D : -> { text, lang }
export async function transcribeLocal(audioBuf, { lang } = {}) {
  if (!whisperAvailable()) {
    throw new Error('whisper.cpp non configuré (WHISPER_BIN / WHISPER_MODEL)');
  }

  // whisper.cpp exige du WAV 16kHz mono.
  let wavBuf = audioBuf;
  if (sniffFormat(audioBuf) !== 'wav') {
    if (!(await hasFfmpeg())) throw new Error('entrée non-WAV et ffmpeg absent');
    wavBuf = await toWav(audioBuf, 16000);
  }

  const dir = await mkdtemp(join(tmpdir(), 'whisper-'));
  const wavPath = join(dir, 'in.wav');
  const outPrefix = join(dir, 'out');
  await writeFile(wavPath, wavBuf);

  try {
    await new Promise((resolve, reject) => {
      const p = spawn(WHISPER_BIN(), [
        '-m', WHISPER_MODEL(),
        '-f', wavPath,
        '-l', lang || 'auto',
        '--output-txt', '--output-file', outPrefix,
        '--no-prints',
      ], { stdio: 'ignore' });
      const timer = setTimeout(() => { p.kill(); reject(new Error('whisper timeout')); }, WHISPER_TIMEOUT_MS());
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
      p.on('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`whisper exit ${code}`));
      });
    });
    const text = (await readFile(`${outPrefix}.txt`, 'utf8')).trim();
    if (!text) throw new Error('transcription whisper vide');
    return { text, lang: lang || detectLang(text) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
