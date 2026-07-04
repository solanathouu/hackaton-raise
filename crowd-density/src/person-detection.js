import { boxArea, clamp } from "./crowd-metrics.js";

const DEFAULT_OPTIONS = {
  minAreaRatio: 0.00008,
  maxAreaRatio: 0.14,
  maxWidthRatio: 0.38,
  maxHeightRatio: 0.72,
  minAspectRatio: 0.45,
  maxAspectRatio: 6.5,
  iouThreshold: 0.42,
  containerAreaFactor: 3,
  containerMinChildren: 2
};

export function toPersonDetection(item, frameWidth, frameHeight) {
  return {
    bbox: clipBox(item.bbox, frameWidth, frameHeight),
    score: item.score,
    class: item.class || "person",
    source: item.source || "full"
  };
}

export function postProcessPersonDetections(items, frameWidth, frameHeight, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const plausible = items
    .filter((item) => item.class === "person")
    .map((item) => toPersonDetection(item, frameWidth, frameHeight))
    .filter((item) => isPlausiblePersonDetection(item, frameWidth, frameHeight, opts));
  const withoutContainers = removeContainerBoxes(plausible, opts);
  return nonMaxSuppress(withoutContainers, opts.iouThreshold);
}

export function isPlausiblePersonDetection(detection, frameWidth, frameHeight, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const [x, y, width, height] = detection.bbox || [];
  if (![x, y, width, height].every(Number.isFinite)) return false;
  if (width < 4 || height < 6) return false;

  const frameArea = Math.max(1, frameWidth * frameHeight);
  const areaRatio = boxArea(detection.bbox) / frameArea;
  const widthRatio = width / Math.max(1, frameWidth);
  const heightRatio = height / Math.max(1, frameHeight);
  const aspectRatio = height / Math.max(1, width);

  if (areaRatio < opts.minAreaRatio || areaRatio > opts.maxAreaRatio) return false;
  if (widthRatio > opts.maxWidthRatio || heightRatio > opts.maxHeightRatio) return false;
  if (aspectRatio < opts.minAspectRatio || aspectRatio > opts.maxAspectRatio) return false;
  return true;
}

export function nonMaxSuppress(detections, iouThreshold = DEFAULT_OPTIONS.iouThreshold) {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const kept = [];

  for (const candidate of sorted) {
    if (kept.every((existing) => intersectionOverUnion(candidate.bbox, existing.bbox) <= iouThreshold)) {
      kept.push(candidate);
    }
  }

  return kept.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

export function removeContainerBoxes(detections, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  return detections.filter((candidate) => {
    const candidateArea = boxArea(candidate.bbox);
    const containedChildren = detections.filter((other) => {
      if (other === candidate) return false;
      const otherArea = boxArea(other.bbox);
      return candidateArea >= otherArea * opts.containerAreaFactor && centerInside(other.bbox, candidate.bbox);
    });
    return containedChildren.length < opts.containerMinChildren;
  });
}

export function intersectionOverUnion(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = boxArea(a) + boxArea(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

export function createCropPlan(width, height) {
  const crops = [{ x: 0, y: 0, width, height, source: "full", upscale: 1 }];
  if (width < 420 || height < 260) return crops;

  const tileWidth = Math.round(width * 0.58);
  const tileHeight = Math.round(height * 0.58);
  const xs = [0, Math.round((width - tileWidth) / 2), width - tileWidth];
  const ys = [0, Math.round((height - tileHeight) / 2), height - tileHeight];

  for (const y of ys) {
    for (const x of xs) {
      crops.push({
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        source: `tile-${x}-${y}`,
        upscale: 1.65
      });
    }
  }

  return crops;
}

export function mapDetectionFromCrop(item, crop, scaleX, scaleY) {
  const [x, y, width, height] = item.bbox;
  return {
    class: item.class,
    score: item.score,
    source: crop.source,
    bbox: [
      crop.x + x / scaleX,
      crop.y + y / scaleY,
      width / scaleX,
      height / scaleY
    ]
  };
}

function clipBox(box, frameWidth, frameHeight) {
  const [x, y, width, height] = box;
  const nx = clamp(x, 0, frameWidth);
  const ny = clamp(y, 0, frameHeight);
  const right = clamp(x + width, 0, frameWidth);
  const bottom = clamp(y + height, 0, frameHeight);
  return [nx, ny, Math.max(0, right - nx), Math.max(0, bottom - ny)];
}

function centerInside(inner, outer) {
  const [ix, iy, iw, ih] = inner;
  const [ox, oy, ow, oh] = outer;
  const cx = ix + iw / 2;
  const cy = iy + ih / 2;
  return cx >= ox && cx <= ox + ow && cy >= oy && cy <= oy + oh;
}

