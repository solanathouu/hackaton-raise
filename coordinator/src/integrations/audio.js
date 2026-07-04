// audio.js — Détection de format par magic bytes + conversion ffmpeg optionnelle.
// La PWA envoie du MediaRecorder : webm/opus (Chrome/Android) ou mp4 (iOS Safari).
// Gradium STT accepte wav / pcm / opus (OGG). Un conteneur webm n'est PAS de l'ogg
// -> conversion ffmpeg (spawn, dép. autorisée) quand dispo, sinon envoi direct tenté.

import { spawn } from 'node:child_process';

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

export function sniffFormat(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'mp4';
  return 'unknown';
}

// Content-Type Gradium par format sniffé ('webm'/'mp4' -> null : conversion requise).
export function contentTypeFor(format) {
  return { wav: 'audio/wav', ogg: 'audio/ogg' }[format] || null;
}

let ffmpegChecked = null;
export async function hasFfmpeg() {
  if (ffmpegChecked !== null) return ffmpegChecked;
  ffmpegChecked = await new Promise((resolve) => {
    const p = spawn(FFMPEG_BIN, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
  return ffmpegChecked;
}

// Convertit n'importe quelle entrée en WAV mono 16-bit au sample rate voulu
// (Gradium PCM = 24kHz ; whisper.cpp = 16kHz).
export function toWav(inputBuf, sampleRate = 24000) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-ac', '1', '-ar', String(sampleRate), '-sample_fmt', 's16',
      '-f', 'wav', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`));
    });
    p.stdin.end(inputBuf);
  });
}

// Normalise un buffer audio pour l'envoi Gradium : { body, contentType, format }.
// webm/mp4 : converti via ffmpeg si présent, sinon tenté tel quel en audio/webm
// (dernier recours — le fallback whisper/mock de gradium.js rattrape un 4xx/5xx).
export async function prepareForGradium(buf) {
  const format = sniffFormat(buf);
  const direct = contentTypeFor(format);
  if (direct) return { body: buf, contentType: direct, format };
  if (await hasFfmpeg()) {
    return { body: await toWav(buf, 24000), contentType: 'audio/wav', format: 'wav' };
  }
  console.warn(`[audio] format "${format}" non natif Gradium et ffmpeg absent -> envoi direct tenté`);
  return { body: buf, contentType: 'audio/webm', format };
}
