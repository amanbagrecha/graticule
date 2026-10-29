import { morphs, lonLatToXYZ } from "@/core/globe.js";
import { hexToRgb, mixOklab } from "@/core/palette.js";
import { clamp } from "@/core/math.js";
import { drawLegend } from "@/core/map2d.js";

const LOW = "#2b65ad", MID = "#faf8f3", HIGH = "#b85217";
const PIN_LOW = "#1d63a8", PIN_HIGH = "#b85217", INK = "#1a1917";
export const N_MIN = -110, N_MAX = 90;
export const E_MAX = 20000;
export const RE = 6371000;

export const meta = {
  id: "geoid",
  title: "Sea level and the geoid",
  track: 1,
  order: 3,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Map heights start at sea level. But sea level follows gravity, so it rises and dips around the ellipsoid. This lumpy surface is the geoid.",
  deeper: [
    "The lowest point is in the Indian Ocean, south of India.",
    "The data is EGM96 on a 15′ grid.",
  ],
  keywords: ["EGM96", "gravity", "sea level", "undulation"],
  controls: [
    { key: "exaggerate", type: "range", label: "Exaggerate the bumps", min: 0, max: E_MAX, step: 500, default: 8000, unit: "×", ticks: [0, 8000, 20000] },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: { lon: 112, lat: 0, dist: 2.9 },
  data: ["egm96_15m.i16"],
};

const PREFIX = meta.id + ":";

export const RAMP_GAMMA = 0.6;
export function rampRGB(n) {
  const lo = hexToRgb(LOW), mid = hexToRgb(MID), hi = hexToRgb(HIGH);
  if (n < 0) return mixOklab(mid, lo, Math.pow(clamp(n / N_MIN, 0, 1), RAMP_GAMMA));
  return mixOklab(mid, hi, Math.pow(clamp(n / N_MAX, 0, 1), RAMP_GAMMA));
}

export const SKIN_DROP = 0.0008;
export const LIGHT = [-0.5, 0.5, Math.SQRT1_2];

export function reliefShade(gx, gy, e) {
  const nx = -gx * e, ny = -gy * e, len = Math.sqrt(nx * nx + ny * ny + 1);
  const d = (nx * LIGHT[0] + ny * LIGHT[1] + LIGHT[2]) / len;
  return clamp(1 + 1.1 * (d - LIGHT[2]), 0.5, 1.28);
}

export const morphT = (e) => clamp(e / E_MAX, 0, 1);
export const skinRadius = (N, e) => 1 + (N * e) / RE - SKIN_DROP;

export function gridStats(grid) {
  let lo = Infinity, hi = -Infinity, iLo = 0, iHi = 0;
  const d = grid.data;
  for (let i = 0; i < d.length; i++) { if (d[i] < lo) { lo = d[i]; iLo = i; } if (d[i] > hi) { hi = d[i]; iHi = i; } }
  const at = (i) => [((grid.originCol0Lon + (i % grid.width) * grid.step + 540) % 360) - 180, grid.originRow0Lat - Math.floor(i / grid.width) * grid.step];
  return { min: lo * grid.scale, max: hi * grid.scale, minAt: at(iLo), maxAt: at(iHi) };
}

export const signed = (v, digits = 0) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(digits);
export const pinLabel = (n) => `${signed(Math.round(n))} m`;

export function restSphere(globe) {
  const id = (lon, lat, t, out = [0, 0, 0]) => lonLatToXYZ(lon, lat, out, 0.9995);
  id.phased = false;
  globe.morph(id, 1);
  globe.morph(null, 0);
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const grid = ctx.data.get("egm96_15m.i16") || (await ctx.data.load("egm96_15m.i16"));
  const stats = gridStats(grid);
  const sample = (lon, lat) => grid.sample(lon, lat);
  let params = { ...ctx.params };
  let shownE = 0, booted = false, eTw = null;
  const ids = { skin: PREFIX + "skin", low: PREFIX + "low", high: PREFIX + "high" };

  await globe.ready;

  const SKIN = 2048, NX = 360, NY = 180;
  const skin = globe.addPanel(ids.skin, { size: SKIN, opacity: 1 });
  const img = document.createElement("canvas");
  img.width = grid.width; img.height = grid.height - 1;
  const id = img.getContext("2d").createImageData(img.width, img.height);
  const lut = [];
  for (let v = -120; v <= 100; v++) lut.push(rampRGB(v));
  const half = grid.width / 2;
  for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
    const n = grid.data[j * grid.width + ((i + half) % grid.width)] * grid.scale;
    const c = lut[clamp(Math.round(n) + 120, 0, lut.length - 1)];
    const k = (j * img.width + i) * 4;
    id.data[k] = c[0]; id.data[k + 1] = c[1]; id.data[k + 2] = c[2]; id.data[k + 3] = 255;
  }
  img.getContext("2d").putImageData(id, 0, 0);
  skin.ctx.imageSmoothingEnabled = true; skin.ctx.imageSmoothingQuality = "high";
  skin.ctx.drawImage(img, 0, 0, SKIN, SKIN);
  img.width = img.height = 0;
  skin.tex.needsUpdate = true;

  const skinMesh = globe.extra.get(ids.skin);
  const geom = skinMesh.geometry;
  const Attr = geom.attributes.position.constructor;
  const nv = (NX + 1) * (NY + 1);
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3).fill(1);
  const dir = new Float32Array(nv * 3), vN = new Float32Array(nv), gX = new Float32Array(nv), gY = new Float32Array(nv);
  const tmp = [0, 0, 0];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const k = j * (NX + 1) + i, lon = -180 + (360 * i) / NX, lat = 90 - (180 * j) / NY;
    lonLatToXYZ(lon, lat, tmp, 1);
    dir[k * 3] = tmp[0]; dir[k * 3 + 1] = tmp[1]; dir[k * 3 + 2] = tmp[2];
    uv[k * 2] = i / NX; uv[k * 2 + 1] = 1 - j / NY;
    vN[k] = sample(lon, clamp(lat, -89.9, 89.9));
  }
  const dLon = (2 * Math.PI) / NX, dLat = Math.PI / NY;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const k = j * (NX + 1) + i, lat = 90 - (180 * j) / NY;
    const cl = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const iw = i === 0 ? NX - 1 : i - 1, ie = i === NX ? 1 : i + 1;
    const jn = Math.max(0, j - 1), js = Math.min(NY, j + 1);
    gX[k] = (vN[j * (NX + 1) + ie] - vN[j * (NX + 1) + iw]) / (2 * dLon * RE * cl);
    gY[k] = (vN[jn * (NX + 1) + i] - vN[js * (NX + 1) + i]) / ((js - jn) * dLat * RE);
  }
  const index = new Uint32Array(NX * NY * 6);
  let q = 0;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    index[q++] = a; index[q++] = c; index[q++] = b; index[q++] = b; index[q++] = c; index[q++] = d;
  }
  geom.setAttribute("position", new Attr(pos, 3));
  geom.setAttribute("uv", new Attr(uv, 2));
  geom.setAttribute("color", new Attr(col, 3));
  geom.setIndex(new Attr(index, 1));
  skinMesh.material.vertexColors = true;
  skinMesh.material.needsUpdate = true;
  skinMesh.renderOrder = 0;
  globe.setLayer("surface", false);
  globe.setLayer("graticule", false);

  const shapeSkin = (e) => {
    for (let k = 0; k < nv; k++) {
      const r = skinRadius(vN[k], e);
      pos[k * 3] = dir[k * 3] * r; pos[k * 3 + 1] = dir[k * 3 + 1] * r; pos[k * 3 + 2] = dir[k * 3 + 2] * r;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = reliefShade(gX[k], gY[k], e);
    }
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  };

  globe.morph(morphs.toGeoid(sample, E_MAX), 0);
  const setE = (e) => { shownE = e; shapeSkin(e); globe.setMorphT(morphT(e)); };

  const legend = ctx.stage.element("div", "geoid-legend");
  legend.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:212px;height:58px;pointer-events:none;z-index:3;";
  const lc = document.createElement("canvas");
  lc.style.cssText = "width:212px;height:58px;display:block;";
  legend.append(lc);
  const paintLegend = () => {
    const dpr = ctx.stage.dpr;
    lc.width = 212 * dpr; lc.height = 58 * dpr;
    const g = lc.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLegend(g, { x: 0, y: 0, w: 180, h: 10, colourAt: (t) => rampRGB(N_MIN + (N_MAX - N_MIN) * t), ticks: [{ t: 0, label: "−110" }, { t: 0.55, label: "0" }, { t: 1, label: "+90 m" }], title: "Geoid above the ellipsoid" });
  };

  const pin = (id, at, color, text) => {
    const it = ctx.overlay.pin(id, { lon: at[0], lat: at[1] }, { color, label: text, size: 12 });
    const lab = it && it.el && it.el.querySelector(".pin-label");
    if (lab) { lab.style.cssText += `;font:600 17px/22px "Newsreader", Georgia, serif;color:${INK};top:-11px;-webkit-text-stroke:4px #faf8f3;paint-order:stroke fill;text-shadow:0 0 6px #faf8f3;`; it.w = 0; }
  };
  pin(ids.low, stats.minAt, PIN_LOW, pinLabel(stats.min));
  pin(ids.high, stats.maxAt, PIN_HIGH, pinLabel(stats.max));

  const fitBound = (e) => {
    const pts = [];
    const r = 1 + (N_MAX * e) / RE;
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r, 0], [0, Math.sin(a) * r, Math.cos(a) * r], [Math.cos(a) * r, 0, Math.sin(a) * r]); }
    return pts;
  };
  const fitFor = (e) => globe.camera.fit(fitBound(e), { padding: 24, insetTop: 70, insetBottom: ctx.stage.insetBottom, minDist: 2.6, apply: false });
  const frameAll = () => {
    if (ctx.side !== "A") return;
    const f = fitFor(params.exaggerate);
    globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  const tweenE = (to, duration, moveCamera) => {
    if (eTw) eTw.cancel();
    if (!booted || ctx.reducedMotion) { setE(to); if (moveCamera) frameAll(); ctx.overlay.update(); return; }
    const from = shownE;
    let cam = null;
    if (moveCamera && ctx.side === "A") {
      const st = globe.camera.state();
      const f = fitFor(to);
      cam = { d0: st.dist, p0: st.pan.slice(), d1: f.dist, p1: f.pan };
    }
    eTw = ctx.anim.tween({
      from: 0, to: 1, duration, ease: ctx.anim.ease.emph,
      onUpdate: (u) => {
        setE(from + (to - from) * u);
        if (cam) { globe.camera.setDist(cam.d0 + (cam.d1 - cam.d0) * u); globe.camera.setPan(cam.p0[0] + (cam.p1[0] - cam.p0[0]) * u, cam.p0[1] + (cam.p1[1] - cam.p0[1]) * u); }
      },
      onDone: () => { eTw = null; ctx.overlay.update(); },
    });
  };

  paintLegend();
  setE(ctx.reducedMotion ? params.exaggerate : 0);
  frameAll();
  setTimeout(() => {
    booted = true;
    tweenE(params.exaggerate, 1200);
  }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("exaggerate") && booted) tweenE(params.exaggerate, 480, true);
    },
    hover(lon, lat) {
      return [`Geoid ${signed(sample(lon, lat), 1)} m`];
    },
    probe() {
      return null;
    },
    unprobe() {},
    resize() { paintLegend(); frameAll(); },
    unmount() {
      if (eTw) eTw.cancel();
      globe.removePrefix(PREFIX);
      globe.setLayer("surface", true);
      restSphere(globe);
      globe.setLayer("graticule", true);
      ctx.overlay.clear(PREFIX);
    },
  };
}
