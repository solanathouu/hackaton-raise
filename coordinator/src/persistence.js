// persistence.js — log d'incidents/assignments/events en SQLite NATIF (node:sqlite, Node 22+).
// Zéro dépendance externe, zéro compilation (contrairement à better-sqlite3 qui ne build pas sur Node 26).
// Dégrade en no-op silencieux si node:sqlite est indisponible : le cœur temps réel n'en dépend jamais.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  /* node < 22 ou build sans sqlite : on tourne sans persistance */
}

const NULL_STORE = {
  enabled: false,
  logIncident() {},
  logAssignment() {},
  setAssignmentStatus() {},
  logEvent() {},
  listIncidents() { return []; },
  close() {},
};

export function createStore(dbPath) {
  if (!dbPath) return NULL_STORE; // persistance désactivée (PERSIST=false)
  if (!DatabaseSync) {
    console.warn('[persist] node:sqlite indisponible → log désactivé (le temps réel continue).');
    return NULL_STORE;
  }
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, ts INTEGER, transcript TEXT, lang TEXT, type TEXT,
        zone_id TEXT, severity INTEGER, primary_id TEXT, source TEXT, degraded INTEGER,
        warning TEXT, justification TEXT
      );
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY, incident_id TEXT, agent_id TEXT, role TEXT,
        target_zone TEXT, status TEXT, ts INTEGER
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, kind TEXT, payload TEXT
      );
    `);
    const stmtInc = db.prepare(
      `INSERT OR REPLACE INTO incidents
       (id,ts,transcript,lang,type,zone_id,severity,primary_id,source,degraded,warning,justification)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const stmtAs = db.prepare(
      `INSERT OR REPLACE INTO assignments (id,incident_id,agent_id,role,target_zone,status,ts)
       VALUES (?,?,?,?,?,?,?)`,
    );
    const stmtAsStatus = db.prepare(`UPDATE assignments SET status=? WHERE id=?`);
    const stmtEvent = db.prepare(`INSERT INTO events (ts,kind,payload) VALUES (?,?,?)`);
    const stmtList = db.prepare(`SELECT * FROM incidents ORDER BY ts DESC LIMIT ?`);
    const now = (i) => i.created_at || i.ts || Date.now();

    const guard = (fn) => (...a) => {
      try { return fn(...a); } catch (e) { console.warn(`[persist] ${e.message}`); }
    };

    return {
      enabled: true,
      logIncident: guard((inc) =>
        stmtInc.run(inc.id, now(inc), inc.transcript ?? null, inc.language ?? inc.lang ?? null,
          inc.type ?? null, inc.zone_id ?? null, inc.severity ?? null, inc.primary_id ?? null,
          inc.source ?? null, inc.degraded ? 1 : 0, inc.warning ?? null, inc.justification ?? null)),
      logAssignment: guard((as) =>
        stmtAs.run(as.id, as.incident_id ?? null, as.agent_id ?? null, as.role ?? null,
          as.target_zone ?? null, as.status ?? 'sent', as.sent_at ?? Date.now())),
      setAssignmentStatus: guard((id, status) => stmtAsStatus.run(status, id)),
      logEvent: guard((kind, payload) => stmtEvent.run(Date.now(), kind, JSON.stringify(payload ?? {}))),
      listIncidents(limit = 50) {
        try { return stmtList.all(limit); } catch (e) { console.warn(`[persist] ${e.message}`); return []; }
      },
      close: guard(() => db.close()),
    };
  } catch (e) {
    console.warn(`[persist] init KO (${e.message}) → log désactivé.`);
    return NULL_STORE;
  }
}
