import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  applyAssignmentPlan,
  applyDecision,
  buildSnapshot,
  decideDeterministically,
  findReplacementForAssignment,
  publicState
} from "../src/p2/engine.js";
import { createInitialState, loadSeed } from "../src/p2/state.js";

const testConfig = {
  zonesPath: fileURLToPath(new URL("../../data/zones.json", import.meta.url)),
  rosterPath: fileURLToPath(new URL("../../data/roster.json", import.meta.url)),
  constraintsPath: fileURLToPath(new URL("../../data/learned_constraints.json", import.meta.url))
};

function state() {
  return createInitialState(loadSeed(testConfig));
}

describe("deterministic coordinator engine", () => {
  it("handles S2 with a primary and skill-aware backfill", () => {
    const current = state();
    const snapshot = buildSnapshot(current, {
      transcript: "arrêt cardiaque au manège extrême, il ne respire plus",
      lang: "fr",
      zone_id: "Z8"
    });

    assert.equal(snapshot.candidates_primary[0].id, "A7");
    assert.equal(snapshot.candidates_backfill_by_zone.Z8[0].id, "A1");
    assert.equal(
      snapshot.candidates_backfill_by_zone.Z8.some((candidate) => candidate.id === "A3"),
      false,
      "Karim must not backfill Z8 because Z8 requires RCP"
    );

    const decision = decideDeterministically(snapshot);
    const plan = applyDecision(decision, current, { maxDepth: 2 });
    assert.equal(plan.warning, null);
    assert.deepEqual(
      plan.assignments.map((assignment) => [assignment.role, assignment.agent_id, assignment.target_zone]),
      [
        ["primary", "A7", "Z8"],
        ["backfill", "A1", "Z8"]
      ]
    );

    for (const assignment of plan.assignments) applyAssignmentPlan(current, assignment);
    const z8 = publicState(current).zones.find((zone) => zone.id === "Z8");
    assert.equal(z8.headcount, 2);
    assert.equal(z8.surplus, 0);
    assert.deepEqual(z8.missing_skills, []);
  });

  it("handles S1 by pulling from surplus without unnecessary backfill", () => {
    const current = state();
    const snapshot = buildSnapshot(current, {
      transcript: "arrêt cardiaque au grand huit, il ne respire plus",
      lang: "fr",
      zone_id: "Z2"
    });

    const decision = decideDeterministically(snapshot);
    const plan = applyDecision(decision, current, { maxDepth: 2 });
    assert.equal(plan.warning, null);
    assert.deepEqual(
      plan.assignments.map((assignment) => [assignment.role, assignment.target_zone]),
      [["primary", "Z2"]]
    );
  });

  it("does not reroute to timed-out or already busy agents", () => {
    const current = state();
    const snapshot = buildSnapshot(current, {
      transcript: "arrêt cardiaque au manège extrême, il ne respire plus",
      lang: "fr",
      zone_id: "Z8"
    });
    const plan = applyDecision(decideDeterministically(snapshot), current, { maxDepth: 2 });
    for (const assignment of plan.assignments) applyAssignmentPlan(current, assignment);

    const replacement = findReplacementForAssignment(
      current,
      {
        agent_id: "A7",
        role: "primary",
        target_zone: "Z8"
      },
      {
        zone_id: "Z8",
        skills_needed: ["RCP"]
      },
      ["A7"]
    );

    assert.notEqual(replacement.id, "A7");
    assert.notEqual(replacement.id, "A1", "A1 is already backfilling and should not be selected");
    assert.equal(replacement.skills.includes("RCP"), true);
  });
});
