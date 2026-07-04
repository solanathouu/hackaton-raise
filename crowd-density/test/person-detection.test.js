import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCropPlan,
  intersectionOverUnion,
  isPlausiblePersonDetection,
  nonMaxSuppress,
  postProcessPersonDetections
} from "../src/person-detection.js";

describe("person detection post-processing", () => {
  it("rejects plaza-sized false person boxes", () => {
    const giant = { class: "person", score: 0.82, bbox: [80, 40, 760, 410] };

    assert.equal(isPlausiblePersonDetection(giant, 960, 540), false);
    assert.deepEqual(postProcessPersonDetections([giant], 960, 540), []);
  });

  it("keeps small overhead person boxes", () => {
    const people = [
      { class: "person", score: 0.7, bbox: [120, 60, 18, 42] },
      { class: "person", score: 0.66, bbox: [220, 100, 20, 46] }
    ];

    const kept = postProcessPersonDetections(people, 960, 540);
    assert.equal(kept.length, 2);
  });

  it("removes group container boxes when smaller people exist inside", () => {
    const detections = [
      { class: "person", score: 0.7, bbox: [80, 40, 260, 170] },
      { class: "person", score: 0.68, bbox: [110, 70, 22, 48] },
      { class: "person", score: 0.64, bbox: [180, 90, 20, 44] },
      { class: "person", score: 0.66, bbox: [260, 130, 18, 42] }
    ];

    const kept = postProcessPersonDetections(detections, 960, 540);
    assert.equal(kept.length, 3);
    assert.equal(kept.some((item) => item.bbox[2] === 260), false);
  });

  it("suppresses duplicate detections from tiled inference", () => {
    const kept = nonMaxSuppress([
      { score: 0.9, bbox: [100, 100, 30, 70] },
      { score: 0.7, bbox: [104, 104, 30, 70] },
      { score: 0.8, bbox: [220, 120, 30, 70] }
    ]);

    assert.equal(kept.length, 2);
    assert.ok(intersectionOverUnion([100, 100, 30, 70], [104, 104, 30, 70]) > 0.42);
  });

  it("creates overlapping crops for large CCTV frames", () => {
    const crops = createCropPlan(960, 540);

    assert.equal(crops[0].source, "full");
    assert.equal(crops.length, 10);
    assert.ok(crops.slice(1).every((crop) => crop.upscale > 1));
  });
});

