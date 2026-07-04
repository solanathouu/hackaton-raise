import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const chromePaths = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
];

const executablePath = chromePaths.find((path) => existsSync(path));
if (!executablePath) {
  throw new Error("No Chrome or Edge executable found for Playwright verification.");
}

const outputDir = join(process.cwd(), "artifacts");
mkdirSync(outputDir, { recursive: true });

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  const unique = new Set();
  let bright = 0;
  let colored = 0;
  const step = 11;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      const index = (png.width * y + x) << 2;
      const r = png.data[index];
      const g = png.data[index + 1];
      const b = png.data[index + 2];
      unique.add(`${r >> 4},${g >> 4},${b >> 4}`);
      if (r + g + b > 96) bright += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colored += 1;
    }
  }
  const samples = Math.ceil(png.width / step) * Math.ceil(png.height / step);
  return {
    unique: unique.size,
    brightRatio: bright / samples,
    coloredRatio: colored / samples
  };
}

async function verifyViewport(browser, baseUrl, name, viewport, options = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1300);

  if (options.forceTimeout) {
    await page.locator("#timeoutToggle").check();
  }

  if (options.clickScenario) {
    await page.locator(".incident-button.hot").click();
    await page.waitForTimeout(options.waitMs || 5000);
  }

  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("canvas").getBoundingClientRect();
    const panel = document.querySelector(".control-panel").getBoundingClientRect();
    const topHud = document.querySelector(".top-left").getBoundingClientRect();
    const bottomHud = document.querySelector(".bottom-left").getBoundingClientRect();
    const decisions = document.querySelectorAll(".decision-card").length;
    const decisionText = [...document.querySelectorAll(".decision-card")]
      .map((card) => card.textContent || "")
      .join("\n");
    const labels = [...document.querySelectorAll(".world-label")]
      .filter((label) => getComputedStyle(label).display !== "none")
      .length;
    return {
      canvas: { width: canvas.width, height: canvas.height },
      panel: { left: panel.left, top: panel.top, width: panel.width, height: panel.height },
      topHud: { right: topHud.right, bottom: topHud.bottom },
      bottomHud: { top: bottomHud.top, right: bottomHud.right },
      decisions,
      decisionText,
      labels,
      bodyScrollWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });

  const screenshot = await page.screenshot({
    path: join(outputDir, `${name}.png`),
    fullPage: false
  });
  const pixels = analyzePng(screenshot);

  const failures = [];
  if (errors.length) failures.push(`console errors: ${errors.join(" | ")}`);
  if (layout.canvas.width < 300 || layout.canvas.height < 300) failures.push("canvas too small");
  if (layout.labels < 8) failures.push(`too few visible world labels: ${layout.labels}`);
  if (options.clickScenario && layout.decisions < 3) failures.push(`scenario did not create enough decisions: ${layout.decisions}`);
  if (options.forceTimeout && !/did not acknowledge|Rerouting/i.test(layout.decisionText)) {
    failures.push("timeout reroute trace was not observed");
  }
  if (pixels.unique < 24 || pixels.brightRatio < 0.08 || pixels.coloredRatio < 0.08) {
    failures.push(`screenshot looks blank: ${JSON.stringify(pixels)}`);
  }
  if (layout.bodyScrollWidth > layout.viewportWidth + 2) failures.push("horizontal overflow detected");

  await page.close();
  return { name, layout, pixels, failures };
}

const vite = await createServer({
  root: process.cwd(),
  logLevel: "silent",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false
  }
});
await vite.listen();
const address = vite.httpServer.address();
const port = typeof address === "object" && address ? address.port : 5173;
const baseUrl = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-gpu=false", "--use-angle=default"]
});

const results = [];
try {
  results.push(await verifyViewport(browser, baseUrl, "desktop-dispatch", { width: 1440, height: 900 }, { clickScenario: true }));
  results.push(await verifyViewport(browser, baseUrl, "desktop-reroute", { width: 1280, height: 800 }, { clickScenario: true, forceTimeout: true, waitMs: 6200 }));
  results.push(await verifyViewport(browser, baseUrl, "mobile-initial", { width: 390, height: 844 }, {}));
} finally {
  await browser.close();
  await vite.close();
}

for (const result of results) {
  console.log(`${result.name}: labels=${result.layout.labels}, decisions=${result.layout.decisions}, unique=${result.pixels.unique}, bright=${result.pixels.brightRatio.toFixed(3)}, colored=${result.pixels.coloredRatio.toFixed(3)}`);
  if (result.failures.length) {
    console.error(`FAIL ${result.name}: ${result.failures.join("; ")}`);
  }
}

const failed = results.some((result) => result.failures.length);
if (failed) process.exit(1);
