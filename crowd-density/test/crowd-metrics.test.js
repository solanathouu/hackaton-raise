import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyDensity,
  estimateOccupiedRatio,
  scoreFrame,
  summarizeFrames
} from "../src/crowd-metrics.js";

describe("crowd metrics", () => {
  it("estimates occupied ratio from person boxes", () => {
    const ratio = estimateOccupiedRatio(
      [
        { bbox: [0, 0, 100, 100] },
        { bbox: [100, 0, 100, 100] }
      ],
      400,
      200
    );

    assert.equal(ratio, 0.25);
  });

  it("classifies increasing density scores", () => {
    assert.equal(classifyDensity(0.1), "Low");
    assert.equal(classifyDensity(0.3), "Moderate");
    assert.equal(classifyDensity(0.6), "High");
    assert.equal(classifyDensity(0.9), "Critical");
  });

  it("scores dense detected frames above sparse frames", () => {
    const sparse = scoreFrame({ personCount: 2, occupiedRatio: 0.03, avgConfidence: 0.8 });
    const dense = scoreFrame({ personCount: 18, occupiedRatio: 0.28, avgConfidence: 0.8 });

    assert.ok(dense > sparse);
    assert.equal(classifyDensity(dense), "Critical");
  });

  it("summarizes peak crowd signal across sampled frames", () => {
    const summary = summarizeFrames([
      {
        method: "person-detector+",
        personCount: 2,
        occupiedRatio: 0.02,
        score: 0.12,
        detections: [{ score: 0.8 }, { score: 0.7 }]
      },
      {
        method: "person-detector+",
        personCount: 22,
        occupiedRatio: 0.35,
        score: 0.82,
        detections: [{ score: 0.9 }]
      }
    ]);

    assert.equal(summary.level, "High");
    assert.equal(summary.maxPeople, 22);
    assert.equal(summary.method, "person-detector");
  });
});
