// verify-visual.mjs — vérification visuelle headless du simulateur (mode demo, offline).
// Cross-platform : utilise le Chrome/Chromium système via playwright-core (channel chrome/msedge).
// Vérifie : 0 erreur console, canvas rendu non-vide (échantillonnage pixels), scénario S2 -> cartes
// de décision + déplacement. Usage : npm run build && node scripts/verify-visual.mjs
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, "../dist");
const ART = resolve(__dirname, "../artifacts");
if (!existsSync(resolve(DIST, "index.html"))) {
  console.error("❌ dist/ absent — lance `npm run build` d'abord.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
// Sert dist/ sous /sim/ (même base path qu'en prod derrière le coordinateur).
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/" || p === "/sim" || p === "/sim/") p = "/sim/index.html";
  const filePath = resolve(DIST, "." + p.replace(/^\/sim/, ""));
  if (!filePath.startsWith(DIST) || !existsSync(filePath) || !statSync(filePath).isFile()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(filePath));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const { chromium } = await import("playwright-core");
let browser = null;
for (const channel of ["chrome", "msedge", undefined]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; }
  catch { /* canal suivant */ }
}
if (!browser) { console.error("❌ Aucun Chrome/Edge/Chromium trouvé pour playwright-core."); process.exit(1); }

const failures = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/sim/?mode=demo`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

// 1) scène rendue (pixels non-noirs sur le canvas)
mkdirSync(ART, { recursive: true });
const shot0 = resolve(ART, "verify-initial.png");
await page.screenshot({ path: shot0 });
function analyze(file) {
  const png = PNG.sync.read(readFileSync(file));
  let bright = 0, colored = 0, sampled = 0;
  for (let i = 0; i < png.data.length; i += 4 * 11) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    sampled++;
    if (r + g + b > 90) bright++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored++;
  }
  return { brightRatio: bright / sampled, coloredRatio: colored / sampled };
}
const a0 = analyze(shot0);
if (a0.brightRatio < 0.02 && a0.coloredRatio < 0.02) failures.push(`écran quasi noir (bright=${a0.brightRatio.toFixed(3)}, colored=${a0.coloredRatio.toFixed(3)})`);

// 2) HUD présent
const chips = await page.locator(".chip").count();
if (chips < 10) failures.push(`bandeau couverture incomplet (${chips}/10 chips)`);

// 3) scénario S2 -> cartes + déplacement
await page.locator('button:has-text("S2 · Extrême")').click();
await page.waitForTimeout(6000);
const cards = await page.locator(".card").count();
if (cards < 3) failures.push(`S2 déclenché mais ${cards} carte(s) de décision (< 3)`);
const cardTitles = await page.locator(".card h3").allTextContents();
if (!cardTitles.some((t) => /Hugo|Extrême/i.test(t))) failures.push("aucune carte ne mentionne le dispatch attendu (Hugo/Extrême)");
await page.screenshot({ path: resolve(ART, "verify-s2.png") });

if (consoleErrors.length) failures.push(`erreurs console: ${consoleErrors.slice(0, 3).join(" | ")}`);

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n❌ verify-visual : ${failures.length} échec(s)`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log("\n✅ verify-visual OK — scène rendue, HUD complet, S2 joué (screenshots dans artifacts/)");
