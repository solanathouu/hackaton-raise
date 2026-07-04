import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { IncidentStore } from "../src/p2/persistence.js";

describe("IncidentStore", () => {
  it("persists incidents, assignments, constraints, and events in SQLite", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conductor-"));
    const dbPath = path.join(dir, "test.sqlite");
    const store = new IncidentStore(dbPath);

    store.upsertIncident({
      id: "inc_1",
      transcript: "test",
      language: "fr",
      incident_type: "arret_cardiaque",
      zone_id: "Z8",
      skills_needed: ["RCP"],
      severity: 5,
      primary_id: "A7",
      backfills: [{ agent_id: "A1", target_zone: "Z8" }],
      status: "dispatching",
      created_at: "2026-07-04T00:00:00.000Z"
    });
    store.upsertAssignment({
      id: "as_1",
      incident_id: "inc_1",
      agent_id: "A7",
      role: "primary",
      target_zone: "Z8",
      from_zone: "Z8",
      status: "sent",
      payload: { assignmentId: "as_1" },
      created_at: "2026-07-04T00:00:00.000Z"
    });
    store.insertConstraint({
      id: "constraint_1",
      scope: "agent",
      rule_text: "A7 en pause",
      source_override: { incidentId: "inc_1" },
      created_at: "2026-07-04T00:00:01.000Z"
    });
    store.logEvent("smoke", { ok: true });

    assert.equal(store.listIncidents()[0].id, "inc_1");
    assert.equal(store.loadConstraints()[0].rule_text, "A7 en pause");

    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
