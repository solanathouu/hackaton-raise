// P3 — tests sans réseau, mode mock (USE_MOCKS défaut true) : Contrat D,
// détection de langue déterministe, sniff de format audio.  (npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { transcribe, speak } = await import('../src/integrations/gradium.js');
const { detectLang } = await import('../src/integrations/lang.js');
const { sniffFormat, contentTypeFor } = await import('../src/integrations/audio.js');

test('Contrat D mock : transcribe() renvoie la fixture fr du kickoff §4', async () => {
  const out = await transcribe('n-importe-quoi-base64');
  assert.deepEqual(out, { text: 'arrêt cardiaque au manège extrême, il ne respire plus', lang: 'fr' });
});

test('Contrat D mock : hint es -> fixture es (scénario S4)', async () => {
  const out = await transcribe('x', { lang: 'es' });
  assert.deepEqual(out, { text: 'un hombre se desplomó en la entrada, no respira', lang: 'es' });
});

test('Contrat D mock : speak() renvoie la fixture audioUrl', async () => {
  assert.deepEqual(await speak('Rejoins le Manège Extrême.', 'fr'), { audioUrl: '/mock/tts-sample.mp3' });
});

test('detectLang : fr / es / en sur les phrases des scénarios de démo', () => {
  assert.equal(detectLang('arrêt cardiaque au manège extrême, il ne respire plus'), 'fr');
  assert.equal(detectLang('un hombre se desplomó en la entrada, no respira'), 'es');
  assert.equal(detectLang('a man collapsed at the entrance, he is not breathing'), 'en');
});

test('detectLang : fallback fr sur vide/inconnu', () => {
  assert.equal(detectLang(''), 'fr');
  assert.equal(detectLang('zzz kkk 123'), 'fr');
});

test('sniffFormat : wav / ogg / webm / inconnu par magic bytes', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)]);
  assert.equal(sniffFormat(wav), 'wav');
  assert.equal(sniffFormat(ogg), 'ogg');
  assert.equal(sniffFormat(webm), 'webm');
  assert.equal(sniffFormat(Buffer.alloc(20)), 'unknown');
  assert.equal(contentTypeFor('wav'), 'audio/wav');
  assert.equal(contentTypeFor('webm'), null); // -> conversion ffmpeg requise
});
