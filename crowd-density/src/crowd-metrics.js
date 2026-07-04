export const DENSITY_LEVELS = ["Low", "Moderate", "High", "Critical"];

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function boxArea(box) {
  if (!box) return 0;
  const [x, y, width, height] = box;
  return Math.max(0, width) * Math.max(0, height);
}

export function estimateOccupiedRatio(detections, frameWidth, frameHeight) {
  const frameArea = Math.max(1, frameWidth * frameHeight);
  const area = detections.reduce((sum, detection) => sum + boxArea(detection.bbox), 0);
  return clamp(area / frameArea, 0, 1);
}

export function scoreFrame({ personCount, occupiedRatio, avgConfidence = 0.5, fallbackComplexity = null }) {
  if (fallbackComplexity != null) {
    return clamp(fallbackComplexity);
  }

  const countScore = clamp(personCount / 18);
  const occupancyScore = clamp(occupiedRatio / 0.22);
  const confidenceBoost = clamp(avgConfidence, 0.35, 0.95);
  return clamp((countScore * 0.65 + occupancyScore * 0.35) * (0.72 + confidenceBoost * 0.28));
}

export function classifyDensity(score) {
  if (score >= 0.78) return "Critical";
  if (score >= 0.52) return "High";
  if (score >= 0.24) return "Moderate";
  return "Low";
}

export function summarizeFrames(frames) {
  if (!frames.length) {
    return {
      level: "Low",
      score: 0,
      maxPeople: 0,
      avgPeople: 0,
      occupiedRatio: 0,
      confidence: 0,
      method: "none",
      reason: "No frames analyzed"
    };
  }

  const scores = frames.map((frame) => frame.score);
  const peakScore = Math.max(...scores);
  const avgScore = average(scores);
  const blendedScore = clamp(peakScore * 0.62 + avgScore * 0.38);
  const maxPeople = Math.max(...frames.map((frame) => frame.personCount || 0));
  const avgPeople = average(frames.map((frame) => frame.personCount || 0));
  const occupiedRatio = Math.max(...frames.map((frame) => frame.occupiedRatio || 0));
  const confidenceValues = frames.flatMap((frame) =>
    frame.detections?.length ? frame.detections.map((detection) => detection.score || 0) : []
  );
  const confidence = confidenceValues.length ? average(confidenceValues) : average(frames.map((frame) => frame.confidence || 0));
  const hasDetector = frames.some((frame) => frame.method?.startsWith("person-detector"));
  const level = classifyDensity(blendedScore);

  return {
    level,
    score: blendedScore,
    maxPeople,
    avgPeople,
    occupiedRatio,
    confidence,
    method: hasDetector ? "person-detector" : "visual-heuristic",
    reason: reasonFor(level, maxPeople, occupiedRatio)
  };
}

export function computeVisualComplexity(imageData) {
  const { data, width, height } = imageData;
  const step = 4;
  let edgeSum = 0;
  let samples = 0;
  let brightPixels = 0;
  const histogram = new Array(16).fill(0);

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const right = luminanceAt(data, width, x + step, y);
      const below = luminanceAt(data, width, x, y + step);
      edgeSum += Math.abs(lum - right) + Math.abs(lum - below);
      histogram[Math.min(15, Math.floor(lum / 16))] += 1;
      if (lum > 35 && lum < 235) brightPixels += 1;
      samples += 1;
    }
  }

  const edgeDensity = clamp(edgeSum / Math.max(1, samples * 130));
  const entropy = histogramEntropy(histogram);
  const usableLight = samples ? brightPixels / samples : 0;
  return clamp(edgeDensity * 0.55 + entropy * 0.3 + usableLight * 0.15);
}

function luminanceAt(data, width, x, y) {
  const i = (y * width + x) * 4;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

function histogramEntropy(histogram) {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  const entropy = histogram.reduce((sum, value) => {
    if (!value) return sum;
    const p = value / total;
    return sum - p * Math.log2(p);
  }, 0);
  return clamp(entropy / 4);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reasonFor(level, maxPeople, occupiedRatio) {
  const occupiedPercent = Math.round(occupiedRatio * 100);
  if (level === "Critical") return `peak ${maxPeople} people, ${occupiedPercent}% frame occupied`;
  if (level === "High") return `dense crowd signal, ${occupiedPercent}% frame occupied`;
  if (level === "Moderate") return `visible grouping, ${maxPeople} people at peak`;
  return `light crowd signal, ${maxPeople} people at peak`;
}
