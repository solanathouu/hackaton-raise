// labels.js — étiquettes 3D en sprites canvas : nettes (haute résolution), billboard automatique,
// AUCUNE ressource réseau (fiable sur hotspot de démo sans internet), accents français natifs.
import * as THREE from "three";

const PX_PER_UNIT = 46; // résolution du canvas par unité de fontSize

/**
 * Crée un sprite-étiquette. `setText()` permet la mise à jour (headcounts live).
 * options: { fontSize, color, bg, borderColor, bold, padding }
 */
export function makeLabel(text, options = {}) {
  const {
    fontSize = 0.62,
    color = "#e6edf3",
    bg = "rgba(13, 17, 23, 0.78)",
    borderColor = null,
    bold = true,
    padding = 0.34,
  } = options;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false, sizeAttenuation: true }),
  );
  sprite.renderOrder = 20;

  let lastText = null;
  function setText(t) {
    if (t === lastText) return; // pas de re-rasterisation si le texte n'a pas changé
    lastText = t;
    const fontPx = Math.round(fontSize * PX_PER_UNIT * 2);
    const padPx = Math.round(padding * PX_PER_UNIT);
    ctx.font = `${bold ? "700" : "500"} ${fontPx}px -apple-system, system-ui, sans-serif`;
    const metrics = ctx.measureText(t);
    const w = Math.ceil(metrics.width + padPx * 2);
    const h = Math.ceil(fontPx * 1.5 + padPx);
    canvas.width = w;
    canvas.height = h;
    // (le resize du canvas réinitialise le contexte)
    ctx.font = `${bold ? "700" : "500"} ${fontPx}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const r = Math.min(h / 2, 14 + padPx * 0.4);
    ctx.beginPath();
    ctx.roundRect(1, 1, w - 2, h - 2, r);
    ctx.fillStyle = bg;
    ctx.fill();
    if (borderColor) {
      ctx.lineWidth = Math.max(2, fontPx * 0.07);
      ctx.strokeStyle = borderColor;
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.fillText(t, w / 2, h / 2 + fontPx * 0.05);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    sprite.material.map?.dispose();
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
    // échelle monde : hauteur = fontSize * ~1.6
    const worldH = fontSize * 1.55 + padding * 0.5;
    sprite.scale.set((w / h) * worldH, worldH, 1);
  }

  setText(text);
  sprite.userData.setText = setText;
  return sprite;
}
