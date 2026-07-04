// P3 — mécanique RÉELLE de gradium.js contre un faux serveur Gradium local :
// parsing NDJSON, écriture tts-cache, chaîne de fallback STT. Zéro appel externe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Env AVANT tout import (config.js et gradium.js lisent à l'import).
process.env.MOCK_GRADIUM = 'false';
process.env.MOCK_CRUSOE = 'true';
process.env.GRADIUM_API_KEY = 'test-key';
process.env.GRADIUM_VOICE_FR = 'voice-fr-test';

let server;
let sttBehavior = 'ok'; // 'ok' | 'http500'

before(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/post/speech/asr')) {
      assert.equal(req.headers['x-api-key'], 'test-key');
      if (sttBehavior === 'http500') { res.statusCode = 500; res.end('error from server 1008: test'); return; }
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.end(
        '{"type":"text","text":"arrêt cardiaque ","start_s":0,"stream_id":0}\n' +
        '{"type":"text","text":"au manège extrême","start_s":1.2,"stream_id":0}\n' +
        '{"type":"end_text","stream_id":0}\n',
      );
    } else if (req.url === '/post/speech/tts') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        assert.equal(parsed.voice_id, 'voice-fr-test');
        assert.equal(parsed.only_audio, true);
        res.setHeader('Content-Type', 'audio/wav');
        res.end(Buffer.from('RIFFfakeWAVEdata'));
      });
    } else if (req.url === '/usages/credits') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remaining_credits: 145000, allocated_credits: 245000, billing_period: 'test' }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.GRADIUM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(resolve(__dirname, '../tts-cache/test_fr.wav'), { force: true });
});

// Import après before() ? Non : node:test exécute before avant les tests, mais les
// imports top-level partent avant. -> import dynamique dans chaque test.
const gradium = () => import('../src/integrations/gradium.js');

test('STT réel : POST bytes wav + concat NDJSON + detectLang -> fr', async () => {
  const { transcribe } = await gradium();
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);
  const out = await transcribe(wav, { strict: true });
  assert.equal(out.text, 'arrêt cardiaque au manège extrême');
  assert.equal(out.lang, 'fr');
});

test('STT réel : hint lang prioritaire sur la détection', async () => {
  const { transcribe } = await gradium();
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);
  const out = await transcribe(wav, { lang: 'es', strict: true });
  assert.equal(out.lang, 'es');
});

test('STT réel : HTTP 500 sans whisper -> retombe sur la fixture mock (F9, ne throw pas)', async () => {
  const { transcribe } = await gradium();
  sttBehavior = 'http500';
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);
  const out = await transcribe(wav);
  assert.equal(out.lang, 'fr');
  assert.match(out.text, /arrêt cardiaque/);
  sttBehavior = 'ok';
});

test('STT réel strict : HTTP 500 -> throw (pour les smoke tests)', async () => {
  const { transcribe } = await gradium();
  sttBehavior = 'http500';
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);
  await assert.rejects(() => transcribe(wav, { strict: true }), /Gradium STT 500/);
  sttBehavior = 'ok';
});

test('TTS réel : POST JSON voice_id + écrit tts-cache + audioUrl /tts/…', async () => {
  const { speak } = await gradium();
  const out = await speak('Vas-y, tu es le plus proche.', 'fr', { id: 'test' });
  assert.equal(out.audioUrl, '/tts/test_fr.wav');
  const written = readFileSync(resolve(__dirname, '../tts-cache/test_fr.wav'));
  assert.equal(written.toString('ascii', 0, 4), 'RIFF');
});

test('getCredits : GET /usages/credits', async () => {
  const { getCredits } = await gradium();
  const c = await getCredits();
  assert.equal(c.remaining_credits, 145000);
});
