import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class IncidentStore {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        transcript TEXT,
        language TEXT,
        type TEXT,
        zone_id TEXT,
        skills_needed TEXT NOT NULL,
        severity INTEGER,
        primary_id TEXT,
        backfills TEXT NOT NULL,
        warning TEXT,
        status TEXT NOT NULL,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        target_zone TEXT NOT NULL,
        from_zone TEXT,
        status TEXT NOT NULL,
        text TEXT,
        audio_url TEXT,
        sent_at TEXT,
        acked_at TEXT,
        timeout_at TEXT,
        rerouted_to TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (incident_id) REFERENCES incidents(id)
      );

      CREATE TABLE IF NOT EXISTS constraints (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        source_override TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close() {
    this.db.close();
  }

  upsertIncident(incident) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO incidents (
          id, transcript, language, type, zone_id, skills_needed, severity,
          primary_id, backfills, warning, status, source, created_at, updated_at
        )
        VALUES (
          @id, @transcript, @language, @type, @zone_id, @skills_needed, @severity,
          @primary_id, @backfills, @warning, @status, @source, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          transcript = excluded.transcript,
          language = excluded.language,
          type = excluded.type,
          zone_id = excluded.zone_id,
          skills_needed = excluded.skills_needed,
          severity = excluded.severity,
          primary_id = excluded.primary_id,
          backfills = excluded.backfills,
          warning = excluded.warning,
          status = excluded.status,
          source = excluded.source,
          updated_at = excluded.updated_at
      `
      )
      .run({
        id: incident.id,
        transcript: incident.transcript || "",
        language: incident.language || incident.lang || "fr",
        type: incident.type || incident.incident_type || "unknown",
        zone_id: incident.zone_id,
        skills_needed: json(incident.skills_needed || []),
        severity: incident.severity || 3,
        primary_id: incident.primary_id || null,
        backfills: json(incident.backfills || []),
        warning: incident.warning ? json(incident.warning) : null,
        status: incident.status || "open",
        source: incident.source || null,
        created_at: incident.created_at || now,
        updated_at: now
      });
  }

  upsertAssignment(assignment) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO assignments (
          id, incident_id, agent_id, role, target_zone, from_zone, status, text, audio_url,
          sent_at, acked_at, timeout_at, rerouted_to, payload, created_at, updated_at
        )
        VALUES (
          @id, @incident_id, @agent_id, @role, @target_zone, @from_zone, @status, @text, @audio_url,
          @sent_at, @acked_at, @timeout_at, @rerouted_to, @payload, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          agent_id = excluded.agent_id,
          role = excluded.role,
          target_zone = excluded.target_zone,
          from_zone = excluded.from_zone,
          status = excluded.status,
          text = excluded.text,
          audio_url = excluded.audio_url,
          sent_at = excluded.sent_at,
          acked_at = excluded.acked_at,
          timeout_at = excluded.timeout_at,
          rerouted_to = excluded.rerouted_to,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `
      )
      .run({
        id: assignment.id,
        incident_id: assignment.incident_id,
        agent_id: assignment.agent_id,
        role: assignment.role,
        target_zone: assignment.target_zone,
        from_zone: assignment.from_zone || null,
        status: assignment.status,
        text: assignment.text || null,
        audio_url: assignment.audioUrl || assignment.audio_url || null,
        sent_at: assignment.sent_at || null,
        acked_at: assignment.acked_at || null,
        timeout_at: assignment.timeout_at || null,
        rerouted_to: assignment.rerouted_to || null,
        payload: json(assignment.payload || {}),
        created_at: assignment.created_at || now,
        updated_at: now
      });
  }

  insertConstraint(constraint) {
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO constraints (id, scope, rule_text, source_override, created_at)
        VALUES (@id, @scope, @rule_text, @source_override, @created_at)
      `
      )
      .run({
        id: constraint.id,
        scope: constraint.scope || "global",
        rule_text: constraint.rule_text,
        source_override: constraint.source_override ? json(constraint.source_override) : null,
        created_at: constraint.created_at
      });
  }

  loadConstraints() {
    return this.db
      .prepare("SELECT * FROM constraints ORDER BY created_at ASC")
      .all()
      .map((row) => ({
        id: row.id,
        scope: row.scope,
        rule_text: row.rule_text,
        source_override: parseJson(row.source_override),
        created_at: row.created_at
      }));
  }

  logEvent(type, payload) {
    this.db
      .prepare("INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)")
      .run(type, json(payload), new Date().toISOString());
  }

  listIncidents(limit = 50) {
    return this.db
      .prepare("SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?")
      .all(limit)
      .map((row) => ({
        id: row.id,
        transcript: row.transcript,
        language: row.language,
        incident_type: row.type,
        zone_id: row.zone_id,
        skills_needed: parseJson(row.skills_needed, []),
        severity: row.severity,
        primary_id: row.primary_id,
        backfills: parseJson(row.backfills, []),
        warning: parseJson(row.warning),
        status: row.status,
        source: row.source,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));
  }
}

export class NullIncidentStore {
  constructor() {
    this.dbPath = null;
    this.constraints = [];
    this.incidents = [];
    this.assignments = [];
    this.events = [];
  }

  close() {}

  upsertIncident(incident) {
    this.incidents = this.incidents.filter((item) => item.id !== incident.id);
    this.incidents.push({ ...incident });
  }

  upsertAssignment(assignment) {
    this.assignments = this.assignments.filter((item) => item.id !== assignment.id);
    this.assignments.push({ ...assignment });
  }

  insertConstraint(constraint) {
    this.constraints.push({ ...constraint });
  }

  loadConstraints() {
    return this.constraints.map((constraint) => ({ ...constraint }));
  }

  logEvent(type, payload) {
    this.events.push({ type, payload, created_at: new Date().toISOString() });
  }

  listIncidents() {
    return this.incidents.map((incident) => ({ ...incident })).reverse();
  }
}

