// Journal des positions (GPS + check-in manuel) — console + fichier JSONL local, gratuit.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '..', config.gps.logPath);

export function logPosition(entry) {
  const row = {
    at: entry.at ?? Date.now(),
    agentId: entry.agentId,
    zoneId: entry.zoneId ?? null,
    lat: entry.lat ?? null,
    lon: entry.lon ?? null,
    accuracy: entry.accuracy ?? null,
    source: entry.source || 'unknown',
  };
  const line = JSON.stringify(row);
  console.log(`[gps] ${row.agentId} → ${row.zoneId || '?'} (${row.source}) ${row.lat?.toFixed(5)},${row.lon?.toFixed(5)} ±${row.accuracy ?? '?'}m`);
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, `${line}\n`);
  } catch (e) {
    console.warn('[gps] écriture log échouée:', e.message);
  }
  return row;
}
