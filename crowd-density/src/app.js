import {
  computeVisualComplexity,
  estimateOccupiedRatio,
  scoreFrame,
  summarizeFrames
} from "./crowd-metrics.js";
import {
  createCropPlan,
  mapDetectionFromCrop,
  postProcessPersonDetections
} from "./person-detection.js";

const els = {
  fileInput: document.querySelector("#fileInput"),
  dropzone: document.querySelector("#dropzone"),
  analyzeButton: document.querySelector("#analyzeButton"),
  videoPreview: document.querySelector("#videoPreview"),
  imagePreview: document.querySelector("#imagePreview"),
  sampleCount: document.querySelector("#sampleCount"),
  sampleCountOut: document.querySelector("#sampleCountOut"),
  scoreThreshold: document.querySelector("#scoreThreshold"),
  scoreThresholdOut: document.querySelector("#scoreThresholdOut"),
  modelStatus: document.querySelector("#modelStatus"),
  densityLevel: document.querySelector("#densityLevel"),
  densityReason: document.querySelector("#densityReason"),
  peopleMetric: document.querySelector("#peopleMetric"),
  occupiedMetric: document.querySelector("#occupiedMetric"),
  confidenceMetric: document.querySelector("#confidenceMetric"),
  methodMetric: document.querySelector("#methodMetric"),
  frames: document.querySelector("#frames"),
  frameSummary: document.querySelector("#frameSummary")
};

let selectedFile = null;
let selectedUrl = null;
let detector = null;
let detectorReady = false;

init();

function init() {
  bindControls();
  loadDetector();
}

function bindControls() {
  els.sampleCount.addEventListener("input", () => {
    els.sampleCountOut.value = els.sampleCount.value;
  });
  els.scoreThreshold.addEventListener("input", () => {
    els.scoreThresholdOut.value = (Number(els.scoreThreshold.value) / 100).toFixed(2);
  });
  els.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) setFile(file);
  });
  els.analyzeButton.addEventListener("click", analyzeSelectedFile);

  for (const eventName of ["dragenter", "dragover"]) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.add("drag");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    els.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropzone.classList.remove("drag");
    });
  }
  els.dropzone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files || [];
    if (file) setFile(file);
  });
}

async function loadDetector() {
  try {
    if (!globalThis.cocoSsd) throw new Error("COCO-SSD script unavailable");
    detector = await globalThis.cocoSsd.load({ base: "lite_mobilenet_v2" });
    detectorReady = true;
    setStatus("strong detector ready", "ready");
  } catch (error) {
    detectorReady = false;
    setStatus("heuristic mode", "warn");
    console.warn("[crowd-density] detector unavailable", error);
  }
}

function setFile(file) {
  selectedFile = file;
  if (selectedUrl) URL.revokeObjectURL(selectedUrl);
  selectedUrl = URL.createObjectURL(file);
  els.analyzeButton.disabled = false;
  resetResult();

  const isVideo = file.type.startsWith("video/");
  els.videoPreview.classList.toggle("active", isVideo);
  els.imagePreview.classList.toggle("active", !isVideo);

  if (isVideo) {
    els.videoPreview.src = selectedUrl;
    els.imagePreview.removeAttribute("src");
  } else {
    els.imagePreview.src = selectedUrl;
    els.videoPreview.removeAttribute("src");
  }
}

async function analyzeSelectedFile() {
  if (!selectedFile) return;
  els.analyzeButton.disabled = true;
  els.analyzeButton.textContent = "Analyzing";
  els.frames.textContent = "";
  els.frameSummary.textContent = "sampling";

  try {
    const sampleCount = Number(els.sampleCount.value);
    const threshold = Number(els.scoreThreshold.value) / 100;
    const frames = selectedFile.type.startsWith("video/")
      ? await analyzeVideo(selectedUrl, sampleCount, threshold)
      : [await analyzeImage(selectedUrl, threshold)];
    const summary = summarizeFrames(frames);
    renderSummary(summary);
    renderFrames(frames);
  } catch (error) {
    renderError(error);
  } finally {
    els.analyzeButton.disabled = false;
    els.analyzeButton.textContent = "Analyze";
  }
}

async function analyzeVideo(url, sampleCount, threshold) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const loaded = waitFor(video, "loadedmetadata");
  video.src = url;
  await loaded;

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const times = sampleTimes(duration, sampleCount);
  const frames = [];

  for (const [index, time] of times.entries()) {
    video.currentTime = time;
    await waitFor(video, "seeked");
    const canvas = drawMedia(video);
    frames.push(await analyzeCanvas(canvas, threshold, time, index + 1));
    els.frameSummary.textContent = `${frames.length}/${times.length} frames`;
  }

  return frames;
}

async function analyzeImage(url, threshold) {
  const image = new Image();
  const loaded = waitFor(image, "load");
  image.src = url;
  await loaded;
  const canvas = drawMedia(image);
  return analyzeCanvas(canvas, threshold, 0, 1);
}

async function analyzeCanvas(canvas, threshold, time, index) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let detections = [];
  let method = "visual-heuristic";
  let fallbackComplexity = null;

  if (detectorReady && detector) {
    detections = await detectPeopleStrong(canvas, threshold);
    method = "person-detector+";
  }

  if (!detections.length) {
    const preview = downscale(canvas, 240);
    const imageData = preview.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, preview.width, preview.height);
    fallbackComplexity = computeVisualComplexity(imageData);
  }

  const occupiedRatio = estimateOccupiedRatio(detections, canvas.width, canvas.height);
  const avgConfidence = detections.length
    ? detections.reduce((sum, detection) => sum + detection.score, 0) / detections.length
    : fallbackComplexity ?? 0;
  const score = scoreFrame({
    personCount: detections.length,
    occupiedRatio,
    avgConfidence,
    fallbackComplexity
  });

  return {
    index,
    time,
    canvas,
    detections,
    personCount: detections.length,
    occupiedRatio,
    confidence: avgConfidence,
    score,
    method
  };
}

async function detectPeopleStrong(canvas, threshold) {
  const cropPlan = createCropPlan(canvas.width, canvas.height);
  const raw = [];
  const tileThreshold = Math.max(0.22, threshold - 0.16);

  for (const crop of cropPlan) {
    const { canvas: cropCanvas, scaleX, scaleY } = cropCanvasFrom(canvas, crop);
    const predictions = await detector.detect(cropCanvas);
    for (const prediction of predictions) {
      const minScore = crop.source === "full" ? threshold : tileThreshold;
      if (prediction.class !== "person" || prediction.score < minScore) continue;
      raw.push(mapDetectionFromCrop(prediction, crop, scaleX, scaleY));
    }
  }

  return postProcessPersonDetections(raw, canvas.width, canvas.height);
}

function renderSummary(summary) {
  els.densityLevel.textContent = summary.level;
  els.densityLevel.className = summary.level.toLowerCase();
  els.densityReason.textContent = summary.reason;
  els.peopleMetric.textContent = `${Math.round(summary.avgPeople * 10) / 10} avg / ${summary.maxPeople} peak`;
  els.occupiedMetric.textContent = `${Math.round(summary.occupiedRatio * 100)}%`;
  els.confidenceMetric.textContent = `${Math.round(summary.confidence * 100)}%`;
  els.methodMetric.textContent = summary.method;
}

function renderFrames(frames) {
  els.frames.textContent = "";
  els.frameSummary.textContent = `${frames.length} frames`;

  for (const frame of frames) {
    const card = document.createElement("article");
    card.className = "frame-card";
    const canvas = cloneCanvas(frame.canvas);
    drawDetections(canvas, frame.detections);
    const meta = document.createElement("div");
    meta.className = "frame-meta";
    meta.innerHTML = `
      <strong>${frame.personCount} people</strong>
      <span>${formatTime(frame.time)} · ${Math.round(frame.score * 100)} score</span>
      <span>${Math.round(frame.occupiedRatio * 100)}% occupied</span>
    `;
    card.append(canvas, meta);
    els.frames.append(card);
  }
}

function renderError(error) {
  els.densityLevel.textContent = "Error";
  els.densityLevel.className = "critical";
  els.densityReason.textContent = error.message;
  els.frameSummary.textContent = "0 frames";
}

function resetResult() {
  els.densityLevel.textContent = "Ready";
  els.densityLevel.className = "";
  els.densityReason.textContent = selectedFile?.name || "No footage loaded";
  els.peopleMetric.textContent = "-";
  els.occupiedMetric.textContent = "-";
  els.confidenceMetric.textContent = "-";
  els.methodMetric.textContent = "-";
  els.frames.textContent = "";
  els.frameSummary.textContent = "0 frames";
}

function setStatus(text, mode = "") {
  els.modelStatus.textContent = text;
  els.modelStatus.className = `status ${mode}`.trim();
}

function sampleTimes(duration, count) {
  const safeCount = Math.max(1, count);
  if (safeCount === 1) return [Math.min(duration * 0.5, Math.max(0, duration - 0.05))];
  const start = duration * 0.06;
  const end = duration * 0.94;
  return Array.from({ length: safeCount }, (_, index) => start + ((end - start) * index) / (safeCount - 1));
}

function drawMedia(media) {
  const maxWidth = 960;
  const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
  const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  canvas.getContext("2d").drawImage(media, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function downscale(canvas, width) {
  const scale = Math.min(1, width / canvas.width);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function cropCanvasFrom(source, crop) {
  const maxOutputWidth = 768;
  const scale = Math.min(crop.upscale || 1, maxOutputWidth / crop.width);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(crop.width * scale));
  out.height = Math.max(1, Math.round(crop.height * scale));
  out
    .getContext("2d")
    .drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
  return {
    canvas: out,
    scaleX: out.width / crop.width,
    scaleY: out.height / crop.height
  };
}

function cloneCanvas(source) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d").drawImage(source, 0, 0);
  return canvas;
}

function drawDetections(canvas, detections) {
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = Math.max(2, canvas.width / 260);
  ctx.font = `${Math.max(13, canvas.width / 48)}px Inter, sans-serif`;
  ctx.textBaseline = "top";

  for (const detection of detections) {
    const [x, y, width, height] = detection.bbox;
    ctx.strokeStyle = "#0d7b63";
    ctx.fillStyle = "rgba(13, 123, 99, 0.14)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    const label = `${Math.round(detection.score * 100)}%`;
    const labelWidth = ctx.measureText(label).width + 10;
    ctx.fillStyle = "#0d7b63";
    ctx.fillRect(x, Math.max(0, y - 24), labelWidth, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 5, Math.max(0, y - 21));
  }
}

function waitFor(target, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, done);
      target.removeEventListener("error", fail);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(`Could not load ${eventName}`));
    };
    target.addEventListener(eventName, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

function formatTime(seconds) {
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = String(rounded % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}
