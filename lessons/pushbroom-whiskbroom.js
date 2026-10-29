import { viewGeometry, gcFromNadirAngle, RE } from "@/core/astro.js";
import { getBasemap } from "@/core/basemap.js";
import { FONT_UI, FONT_MONO } from "@/core/map2d.js";
import { clamp, DEG, RAD } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";

export const CENTRE = [10.8, 45.6];
export const HEADING = 192;
export const DET_DRAWN = 3;
export const MS_PER_SCAN = 300;
export const SWEEP = 0.8;
export const SUB = 4;

export const PRESETS = [
  { value: "sentinel2", label: "Sentinel-2 (290 km, 12 detectors)", name: "Sentinel-2", alt: 786, swath: 290, pixel: 0.01, sensor: "pushbroom", cells: 24, modules: 12, scans: 28, pushText: "12 modules", whisk: 16 },
  { value: "landsat", label: "Landsat OLI (185 km)", name: "Landsat 8", alt: 705, swath: 185, pixel: 0.03, sensor: "pushbroom", cells: 28, modules: 14, scans: 28, pushText: "about 7,000 per band", whisk: 16 },
  { value: "modis", label: "MODIS (2,330 km)", name: "Terra MODIS", alt: 705, swath: 2330, pixel: 1, sensor: "whiskbroom", cells: 33, modules: 0, scans: 16, pushText: null, whisk: 10 },
];

export const VIEWS = { sentinel2: [-50, 64], landsat: [-50, 66], modis: [-36, 56] };

export const presetOf = (v) => PRESETS.find((p) => p.value === v) || PRESETS[0];

export const meta = {
  id: "pushbroom-whiskbroom",
  title: "How a sensor sweeps",
  track: 7,
  order: 5,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A pushbroom sensor has a line of detectors and images the whole swath at once as it moves. A whiskbroom sweeps a mirror across the track. Wide sweeps give wide swaths, but pixels at the edge grow and overlap. Compare the two footprints as they move.",
  deeper: [
    "MODIS pixels grow from 1 km at nadir to about 2 × 4.8 km at the edge.",
    "Sentinel-2 has 12 detector modules across its 290 km swath.",
    "Landsat OLI has about 7,000 detectors per 30 m band.",
    "A whiskbroom needs fewer detectors but more time per pixel.",
  ],
  keywords: ["pushbroom", "whiskbroom", "scanner", "swath", "bow-tie", "bowtie", "MODIS", "Sentinel-2", "Landsat", "detector", "footprint", "scan angle"],
  controls: [
    { key: "sensor", type: "segment", label: "Sensor", options: [{ value: "pushbroom", label: "Pushbroom" }, { value: "whiskbroom", label: "Whiskbroom" }], default: "pushbroom" },
    { key: "preset", type: "select", label: "Instrument", options: PRESETS.map(({ value, label }) => ({ value, label })), default: "sentinel2" },
    { key: "play", type: "button", label: "Play", icon: "i-play" },
    { key: "showFootprints", type: "toggle", label: "Show footprints", default: true, shortcut: "f" },
    { type: "legend", label: "Key", items: [
      { color: SIGNAL, line: true, label: "Pushbroom line and its rows" },
      { color: BRASS, line: true, label: "Whiskbroom beam and its scans" },
      { color: "rgba(184,82,23,.55)", label: "Ground seen two times (bow-tie)" },
      { color: "#cdc6b7", label: "Ground not recorded yet" },
    ] },
  ],
  readouts: [
    { key: "swath", label: "Swath", digits: 0, unit: "km" },
    { key: "nadir", label: "Pixel at nadir" },
    { key: "edge", label: "Pixel at the edge", hero: true },
    { key: "detectors", label: "Detectors" },
  ],
  transport: { label: ["start", "end"], key: "m" },
  compare: null,
  view: { lon: -50, lat: 64, dist: 3.4 },
  data: [],
};

const PREFIX = meta.id + ":";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ecef = (lon, lat) => { const lo = lon * DEG, la = lat * DEG, c = Math.cos(la); return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)]; };

export const FRAME = (() => {
  const lo = CENTRE[0] * DEG, la = CENTRE[1] * DEG, h = HEADING * DEG;
  const e1 = ecef(CENTRE[0], CENTRE[1]);
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const e2 = norm([north[0] * Math.cos(h) + east[0] * Math.sin(h), north[1] * Math.cos(h) + east[1] * Math.sin(h), north[2] * Math.cos(h) + east[2] * Math.sin(h)]);
  const n = norm(cross(e2, e1));
  return { e1, e2, n };
})();

export function toLonLat(u, s) {
  const { e1, e2, n } = FRAME, cs = Math.cos(s), a = cs * Math.cos(u), b = cs * Math.sin(u), c = Math.sin(s);
  const v = [e1[0] * a + e2[0] * b + n[0] * c, e1[1] * a + e2[1] * b + n[1] * c, e1[2] * a + e2[2] * b + n[2] * c];
  return [Math.atan2(v[1], v[0]) * RAD, Math.asin(clamp(v[2], -1, 1)) * RAD];
}

export function fromLonLat(lon, lat) {
  const p = ecef(lon, lat), { e1, e2, n } = FRAME;
  return { u: Math.atan2(dot(p, e2), dot(p, e1)), s: Math.asin(clamp(dot(p, n), -1, 1)) };
}

export function maxScanAngle(alt, swathKm) {
  return viewGeometry(alt, (swathKm / 2 / RE) * RAD).nadirAngle;
}

export function arcOf(alt, nadirDeg) {
  return gcFromNadirAngle(alt, nadirDeg) * DEG;
}

export function factors(alt, nadirDeg) {
  const g = Math.abs(gcFromNadirAngle(alt, nadirDeg));
  const v = viewGeometry(alt, g);
  const c = Math.cos(nadirDeg * DEG);
  return { arc: g * DEG, across: v.acrossFactor, along: v.alongFactor, pushAcross: v.acrossFactor * c * c, pushAlong: Math.cos(g * DEG) };
}

export function pixelAt(presetValue, sensor, nadirDeg) {
  const P = presetOf(presetValue), f = factors(P.alt, nadirDeg);
  return sensor === "whiskbroom" ? { across: P.pixel * f.across, along: P.pixel * f.along } : { across: P.pixel * f.pushAcross, along: P.pixel * f.pushAlong };
}

export function edgePixel(presetValue, sensor) {
  const P = presetOf(presetValue);
  return pixelAt(presetValue, sensor, maxScanAngle(P.alt, P.swath));
}

export function bowtie(alt, swathKm, pixelKm, detectors) {
  const f = factors(alt, maxScanAngle(alt, swathKm));
  const strip = detectors * pixelKm * f.along, step = detectors * pixelKm * Math.cos(f.arc);
  return { strip, step, overlap: strip - step, fraction: (strip - step) / strip };
}

export function detectorsText(presetValue, sensor) {
  const P = presetOf(presetValue);
  if (sensor === "whiskbroom") return `${P.whisk} per band`;
  if (P.pushText) return P.pushText;
  const n = (2 * Math.tan(maxScanAngle(P.alt, P.swath) * DEG) * P.alt) / P.pixel;
  return `about ${(Math.round(n / 10) * 10).toLocaleString("en-US")} per band`;
}

export function fmtSize(p, pixelKm) {
  if (pixelKm < 1) return `${(p.across * 1000).toFixed(1)} × ${(p.along * 1000).toFixed(1)} m`;
  return `${p.across.toFixed(2)} × ${p.along.toFixed(2)} km`;
}

export function hit(alt, uSat, d) {
  const a = RE + alt, P = [a * Math.cos(uSat), a * Math.sin(uSat), 0];
  const b = dot(P, d), disc = b * b - (a * a - RE * RE);
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  const X = [P[0] + t * d[0], P[1] + t * d[1], P[2] + t * d[2]];
  return { X, u: Math.atan2(X[1], X[0]), s: Math.asin(clamp(X[2] / RE, -1, 1)) };
}

export function whiskDir(uSat, thDeg, alDeg) {
  const cu = Math.cos(uSat), su = Math.sin(uSat), ct = Math.cos(thDeg * DEG), st = Math.sin(thDeg * DEG), ca = Math.cos(alDeg * DEG), sa = Math.sin(alDeg * DEG);
  return [-ca * ct * cu - sa * su, -ca * ct * su + sa * cu, ca * st];
}

export function pushDir(uSat, x, y) {
  const cu = Math.cos(uSat), su = Math.sin(uSat), l = Math.sqrt(1 + x * x + y * y);
  return [(-cu - y * su) / l, (-su + y * cu) / l, x / l];
}

export function geometry(presetValue, sensor) {
  const P = presetOf(presetValue), alt = P.alt, K = P.cells, D = DET_DRAWN;
  const thMax = maxScanAngle(alt, P.swath), dTh = (2 * thMax) / K;
  const stripRad = 2 * arcOf(alt, (D * dTh) / 2);
  const scans = P.scans, U = scans * stripRad, u0 = -U / 2;
  const xMax = Math.tan(thMax * DEG), dx = (2 * xMax) / K;
  const rows = Math.max(4, Math.round(U / (2 * arcOf(alt, Math.atan(dx / 2) * RAD))));
  const rho = U / rows;
  const sEdge = arcOf(alt, thMax);
  const G = { P, preset: P.value, sensor, scans, alt, K, D, thMax, dTh, stripRad, U, u0, xMax, dx, rows, rho, sEdge };
  const NQ = K * SUB + 1;
  G.NQ = NQ;
  G.tu = new Float64Array((D + 1) * NQ);
  G.ts = new Float64Array((D + 1) * NQ);
  let bulge = 0;
  for (let d = 0; d <= D; d++) for (let q = 0; q < NQ; q++) {
    const h = hit(alt, 0, whiskDir(0, -thMax + (q * dTh) / SUB, (d - D / 2) * dTh));
    G.tu[d * NQ + q] = h.u; G.ts[d * NQ + q] = h.s;
    bulge = Math.max(bulge, Math.abs(h.u) - stripRad / 2);
  }
  G.sx = new Float64Array(K + 1);
  for (let j = 0; j <= K; j++) G.sx[j] = hit(alt, 0, pushDir(0, -xMax + j * dx, 0)).s;
  G.sHalf = sEdge * 1.2;
  G.uHalf = U / 2 + 0.08 * U + bulge;
  return G;
}

export const scanCentre = (G, k) => G.u0 + (k + 0.5) * G.stripRad;

export function whiskCell(G, k, d, j) {
  const uc = scanCentre(G, k), NQ = G.NQ, out = [];
  for (let q = j * SUB; q <= (j + 1) * SUB; q++) out.push([G.tu[d * NQ + q] + uc, G.ts[d * NQ + q]]);
  for (let q = (j + 1) * SUB; q >= j * SUB; q--) out.push([G.tu[(d + 1) * NQ + q] + uc, G.ts[(d + 1) * NQ + q]]);
  return out;
}

export function pushCell(G, r, j) {
  const ua = G.u0 + r * G.rho, ub = ua + G.rho, sa = G.sx[j], sb = G.sx[j + 1];
  return [[ua, sa], [ua, sb], [ub, sb], [ub, sa]];
}

export function cellAngle(G, j) {
  if (G.sensor === "whiskbroom") return -G.thMax + (j + 0.5) * G.dTh;
  return Math.atan(-G.xMax + (j + 0.5) * G.dx) * RAD;
}

const inPoly = (pts, u, s) => {
  let inside = false;
  for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
    const [ui, si] = pts[i], [uk, sk] = pts[k];
    if ((si > s) !== (sk > s) && u < ((uk - ui) * (s - si)) / (sk - si) + ui) inside = !inside;
  }
  return inside;
};

export function findCells(G, u, s) {
  if (Math.abs(s) > G.sHalf || Math.abs(u) > G.uHalf) return [];
  const out = [];
  if (G.sensor === "pushbroom") {
    const r = Math.floor((u - G.u0) / G.rho);
    if (r < 0 || r >= G.rows) return out;
    for (let j = 0; j < G.K; j++) if (s >= G.sx[j] && s < G.sx[j + 1]) out.push({ r, j });
    return out;
  }
  const a = RE + G.alt, as = Math.abs(s);
  const th = Math.sign(s) * Math.atan((RE * Math.sin(as)) / (a - RE * Math.cos(as))) * RAD;
  const j0 = Math.floor((th + G.thMax) / G.dTh), k0 = Math.floor((u - G.u0) / G.stripRad);
  for (let k = k0 - 2; k <= k0 + 2; k++) {
    if (k < 0 || k >= G.scans) continue;
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      if (j < 0 || j >= G.K) continue;
      for (let d = 0; d < G.D; d++) if (inPoly(whiskCell(G, k, d, j), u, s)) out.push({ k, d, j });
    }
  }
  return out;
}

export function progress(G, m) {
  const pos = clamp(m, 0, 1) * G.U;
  if (G.sensor === "pushbroom") {
    const row = Math.min(G.rows, Math.floor(pos / G.rho + 1e-9));
    return { uEnd: G.u0 + pos, row, done: m >= 1 };
  }
  const f = pos / G.stripRad;
  let k = Math.floor(f + 1e-9), ph = f - k;
  if (k >= G.scans) { k = G.scans; ph = 0; }
  const sweeping = k < G.scans && ph < SWEEP;
  const nj = k >= G.scans ? 0 : sweeping ? Math.min(G.K, Math.ceil((ph / SWEEP) * G.K - 1e-9)) : G.K;
  const beam = sweeping && ph > 0 ? -G.thMax + (2 * G.thMax * ph) / SWEEP : null;
  const mirror = sweeping ? -G.thMax + (2 * G.thMax * ph) / SWEEP : G.thMax - (2 * G.thMax * (ph - SWEEP)) / (1 - SWEEP);
  return { k, ph, count: k * G.K + nj, beam, mirror, done: m >= 1 };
}

export function timeOfCell(G, c) {
  if (G.sensor === "pushbroom") return clamp(((c.r + 1) * G.rho) / G.U, 0, 1);
  return clamp(((c.k + ((c.j + 1) / G.K) * SWEEP) * G.stripRad) / G.U, 0, 1);
}

const TEX = 1024;
const MESH = 73;
const GAP = 14;

export function panelLayout(W, H, insetBottom = 0, legendW = 300) {
  if (W >= 640) {
    const pw = Math.min(W - 2 * GAP, 1060), ph = 150;
    const left = Math.round((W - pw) / 2), top = Math.round(H - insetBottom - GAP - ph);
    const capW = clamp(Math.round(pw * 0.4), 230, 400);
    const chart = { x: capW + 34, y: 38, w: pw - capW - 34 - 16, h: ph - 38 - 28 };
    return { W, H, pw, ph, left, top, inset: H - top + 6, capW, chart, stacked: false, titleY: 28, capY: 46, capLines: 5, barH: ph - 28 };
  }
  const m = 8, room = H - insetBottom, pw = W - 2 * m;
  const capLines = room >= 300 ? 2 : room >= 240 ? 1 : 0;
  const titleY = 24, capY = 42, capEnd = capLines ? capY + 15 * (capLines - 1) : titleY;
  const chartTitleY = capEnd + 19;
  const chart = { x: 34, y: chartTitleY + 8, w: pw - 48, h: room >= 400 ? 64 : room >= 300 ? 56 : 44 };
  const legendRows = legendW <= chart.w ? 1 : 2;
  const legendY = chart.y + chart.h + 29;
  const ph = legendY + 13 * (legendRows - 1) + 11;
  const top = Math.round(H - insetBottom - m - ph);
  return { W, H, pw, ph, left: m, top, inset: H - top + 6, capW: pw - 32, chart, stacked: true, titleY, capY, capLines, chartTitleY, legendY, legendRows, barH: capEnd + 4 - 14 };
}

export async function mount(ctx) {
  const stage = ctx.stage, globe = stage.globe;
  const ui = await import("@/core/ui.js");
  let params = { ...ctx.params };
  let G = null, S = 1, m = clamp(+params.m || 0, 0, 1);
  let bm = null, bmKind = null, cols = null;
  let painted = -1, paintedU = -Infinity;
  let hoverHits = [], chartHover = null;
  let playing = false, playTw = null, jumpTw = null, holdTimer = 0, autoTimer = 0, booted = false, framedKey = "";
  let L = null;

  const saved = {};
  for (const k of ["surface", "coast", "graticule", "atmosphere", "labels"]) { saved[k] = globe.layers[k]; globe.setLayer(k, false); }

  const tex = globe.addPanel(PREFIX + "ground", { size: TEX, opacity: 1 });
  const gmesh = globe.extra.get(PREFIX + "ground");
  const geom = gmesh.geometry;
  const Attr = geom.attributes.position.constructor;
  const gpos = new Float32Array(MESH * MESH * 3), guv = new Float32Array(MESH * MESH * 2), gidx = [];
  for (let j = 0; j < MESH; j++) for (let i = 0; i < MESH; i++) { const k = j * MESH + i; guv[k * 2] = i / (MESH - 1); guv[k * 2 + 1] = j / (MESH - 1); }
  for (let j = 0; j < MESH - 1; j++) for (let i = 0; i < MESH - 1; i++) { const a = j * MESH + i, b = a + 1, c = a + MESH, d = c + 1; gidx.push(a, b, c, b, d, c); }
  geom.setAttribute("position", new Attr(gpos, 3));
  geom.setAttribute("uv", new Attr(guv, 2));
  geom.setIndex(gidx);
  const g2 = tex.ctx;
  const base = document.createElement("canvas");
  base.width = base.height = TEX;

  const empty = [[[0, 0, 0], [0, 0, 0]]];
  const tri0 = new Float32Array(9);
  const zeros = (n) => new Float32Array(n);
  globe.addTriangles(PREFIX + "wallA", tri0, { color: "#ece7dd", lit: false, order: 1 });
  globe.addTriangles(PREFIX + "wallB", tri0, { color: "#ffffff", lit: false, order: 1 });
  globe.addSegments3D(PREFIX + "rim", empty, { color: "rgba(107,102,94,.55)", width: 1 });
  globe.addSegments3D(PREFIX + "track", empty, { color: "rgba(26,25,23,.5)", width: 1.2, dash: [4, 4], order: 3 });
  globe.addSegments3D(PREFIX + "edges", empty, { color: "rgba(60,52,40,.35)", width: 1, dash: [3, 4], order: 3 });
  globe.addTriangles(PREFIX + "sweep", tri0, { color: BRASS, opacity: 0.17, lit: false, depthWrite: false, order: 2.6, normals: zeros(9) });
  globe.addTriangles(PREFIX + "beam", tri0, { color: BRASS, opacity: 0.34, lit: false, depthWrite: false, order: 2.7, normals: zeros(9) });
  globe.addSegments3D(PREFIX + "beamFoot", empty, { color: "#e3a20b", width: 2.2, depth: false, order: 6 });
  globe.addSegments3D(PREFIX + "fanEdge", empty, { color: "rgba(184,82,23,.6)", width: 1, dash: [3, 4], order: 4 });
  globe.addTriangles(PREFIX + "sheet", tri0, { color: SIGNAL, opacity: 0.2, lit: false, depthWrite: false, order: 2.6, normals: zeros(9) });
  globe.addSegments3D(PREFIX + "line", empty, { color: "#174f86", width: 2.6, depth: false, order: 6 });
  globe.addSegments3D(PREFIX + "sheetEdge", empty, { color: "rgba(29,99,168,.75)", width: 1.1, order: 4 });
  globe.addSegments3D(PREFIX + "nadir", empty, { color: "rgba(26,25,23,.55)", width: 1, dash: [2, 3], order: 4 });
  globe.addTriangles(PREFIX + "body", new Float32Array(36 * 3), { color: INK2, opacity: 1, lit: true, order: 5 });
  globe.addTriangles(PREFIX + "panels", new Float32Array(12 * 3), { color: VIOLET, opacity: 0.95, lit: false, order: 5, normals: zeros(36) });
  globe.addSegments3D(PREFIX + "bar", empty, { color: SIGNAL, width: 3.2, depth: false, order: 7 });
  globe.addPoints3D(PREFIX + "mods", [[0, 0, 0]], { color: "#174f86", size: 4, depth: false, order: 8 });
  globe.addSegments3D(PREFIX + "mirror", empty, { color: BRASS, width: 3.4, depth: false, order: 7 });
  globe.addSegments3D(PREFIX + "hover", empty, { color: INK, width: 2, depth: false, order: 8 });
  globe.addSegments3D(PREFIX + "hover2", empty, { color: VIOLET, width: 2, depth: false, order: 8 });
  for (const id of ["hover", "hover2"]) globe.setLayer(PREFIX + id, false);

  const toScene = (X, out = [0, 0, 0]) => { out[0] = S * X[2]; out[1] = S * (X[0] - RE); out[2] = -S * X[1]; return out; };
  const usX = (u, s, h = 0) => { const r = RE + h, cs = Math.cos(s); return [r * cs * Math.cos(u), r * cs * Math.sin(u), r * Math.sin(s)]; };
  const lifted = (X, liftKm) => { const k = (RE + liftKm) / Math.hypot(X[0], X[1], X[2]); return [X[0] * k, X[1] * k, X[2] * k]; };
  const lift = () => 0.004 / S;
  const sceneUS = (u, s, h = lift()) => toScene(usX(u, s, h));
  const sensorCol = () => (params.sensor === "whiskbroom" ? BRASS : SIGNAL);

  const panel = stage.element("div", "pw-panel");
  const pc = document.createElement("canvas");
  pc.style.cssText = "display:block;width:100%;height:100%;";
  panel.append(pc);

  const LEGEND = [[BRASS, "whiskbroom"], [SIGNAL, "pushbroom"]];
  const LEGEND_NOTE = "solid across · dashed along";
  const compactLegendW = (c) => {
    c.font = `500 10px ${FONT_UI}`;
    let w = 0;
    for (const [, t] of LEGEND) w += 17 + c.measureText(t).width + 12;
    return w + c.measureText(LEGEND_NOTE).width;
  };

  const layout = () => {
    L = panelLayout(stage.width, stage.height, stage.insetBottom, compactLegendW(pc.getContext("2d")));
    panel.style.cssText = `position:absolute;left:${L.left}px;top:${L.top}px;width:${L.pw}px;height:${L.ph}px;right:auto;bottom:auto;border-radius:12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;box-shadow:0 10px 30px -18px rgba(0,0,0,.9);pointer-events:auto;z-index:3;overflow:hidden;cursor:default;`;
    const dpr = stage.dpr;
    pc.width = Math.round(L.pw * dpr); pc.height = Math.round(L.ph * dpr);
    globe.labelInsetBottom = L.inset;
  };

  const sampleBM = (lon, lat, out) => {
    const W = bm.width, H = bm.height, c = bm.color;
    const fx = ((lon + 180) / 360) * W - 0.5, fy = ((90 - lat) / 180) * H - 0.5;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    const ax = fx - x0, ay = fy - y0;
    const x1 = (x0 + 1 + W) % W; x0 = (x0 + W) % W;
    const ya = clamp(y0, 0, H - 1), yb = clamp(y0 + 1, 0, H - 1);
    for (let ch = 0; ch < 3; ch++) {
      const p = c[(ya * W + x0) * 4 + ch], q = c[(ya * W + x1) * 4 + ch], r = c[(yb * W + x0) * 4 + ch], t = c[(yb * W + x1) * 4 + ch];
      out[ch] = (p * (1 - ax) + q * ax) * (1 - ay) + (r * (1 - ax) + t * ax) * ay;
    }
    return out;
  };

  const groundColour = (u, s, out) => {
    if (!bm) { out[0] = 70; out[1] = 84; out[2] = 104; return out; }
    const ll = toLonLat(u, s);
    return sampleBM(ll[0], ll[1], out);
  };

  const buildBase = () => {
    const bctx = base.getContext("2d");
    const id = bctx.createImageData(TEX, TEX), px = id.data;
    const { e1, e2, n } = FRAME;
    const cs = new Float64Array(TEX), ss = new Float64Array(TEX);
    for (let i = 0; i < TEX; i++) { const s = -G.sHalf + ((i + 0.5) / TEX) * 2 * G.sHalf; cs[i] = Math.cos(s); ss[i] = Math.sin(s); }
    const c = [0, 0, 0];
    for (let j = 0; j < TEX; j++) {
      const u = G.uHalf - ((j + 0.5) / TEX) * 2 * G.uHalf, cu = Math.cos(u), su = Math.sin(u);
      for (let i = 0; i < TEX; i++) {
        const o = (j * TEX + i) * 4;
        if (bm) {
          const a = cs[i] * cu, b = cs[i] * su, z = ss[i];
          const vx = e1[0] * a + e2[0] * b + n[0] * z, vy = e1[1] * a + e2[1] * b + n[1] * z, vz = e1[2] * a + e2[2] * b + n[2] * z;
          sampleBM(Math.atan2(vy, vx) * RAD, Math.asin(clamp(vz, -1, 1)) * RAD, c);
        } else { c[0] = 60; c[1] = 72; c[2] = 96; }
        const l = 0.3 * c[0] + 0.55 * c[1] + 0.15 * c[2];
        px[o] = 14 + (c[0] * 0.45 + l * 0.55) * 0.36;
        px[o + 1] = 18 + (c[1] * 0.45 + l * 0.55) * 0.36;
        px[o + 2] = 34 + (c[2] * 0.45 + l * 0.55) * 0.4;
        px[o + 3] = 255;
      }
    }
    bctx.putImageData(id, 0, 0);
  };

  const buildColours = () => {
    const c = [0, 0, 0], acc = [0, 0, 0];
    const avg = (poly, gain = 1.12) => {
      let cu = 0, cs = 0;
      for (const p of poly) { cu += p[0]; cs += p[1]; }
      cu /= poly.length; cs /= poly.length;
      acc[0] = acc[1] = acc[2] = 0;
      const pts = [[cu, cs], [(cu + poly[0][0]) / 2, (cs + poly[0][1]) / 2], [(cu + poly[Math.floor(poly.length / 2)][0]) / 2, (cs + poly[Math.floor(poly.length / 2)][1]) / 2]];
      for (const p of pts) { groundColour(p[0], p[1], c); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; }
      return `rgb(${Math.min(255, Math.round((acc[0] / pts.length) * gain))},${Math.min(255, Math.round((acc[1] / pts.length) * gain))},${Math.min(255, Math.round((acc[2] / pts.length) * gain))})`;
    };
    if (G.sensor === "pushbroom") {
      cols = new Array(G.rows * G.K);
      for (let r = 0; r < G.rows; r++) for (let j = 0; j < G.K; j++) cols[r * G.K + j] = avg(pushCell(G, r, j));
    } else {
      cols = new Array(G.scans * G.D * G.K);
      for (let k = 0; k < G.scans; k++) for (let d = 0; d < G.D; d++) for (let j = 0; j < G.K; j++) cols[(k * G.D + d) * G.K + j] = avg(whiskCell(G, k, d, j), k % 2 ? 0.9 : 1.04);
    }
  };

  const TX = (s) => ((s + G.sHalf) / (2 * G.sHalf)) * TEX;
  const TY = (u) => ((G.uHalf - u) / (2 * G.uHalf)) * TEX;
  const tq = (d, q, uc) => { const i = d * G.NQ + q; return [TX(G.ts[i]), TY(G.tu[i] + uc)]; };
  const edgePath = (g, d, q0, q1, uc, move = true) => {
    const step = q1 >= q0 ? 1 : -1;
    for (let q = q0; step > 0 ? q <= q1 : q >= q1; q += step) { const p = tq(d, q, uc); if (q === q0 && move) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); }
  };
  const quadPath = (g, k, d0, d1, j0, j1) => {
    const uc = scanCentre(G, k);
    edgePath(g, d0, j0 * SUB, j1 * SUB, uc, true);
    edgePath(g, d1, j1 * SUB, j0 * SUB, uc, false);
    g.closePath();
  };

  let hatchPat = null;
  const hatch = () => {
    if (hatchPat) return hatchPat;
    const hc = document.createElement("canvas");
    hc.width = hc.height = 8;
    const h = hc.getContext("2d");
    h.strokeStyle = "rgba(227,162,11,.9)"; h.lineWidth = 1.6;
    h.beginPath(); h.moveTo(-2, 10); h.lineTo(10, -2); h.moveTo(-2, 2); h.lineTo(2, -2); h.moveTo(6, 10); h.lineTo(10, 6); h.stroke();
    hatchPat = g2.createPattern(hc, "repeat");
    return hatchPat;
  };

  const paintColumn = (k, j) => {
    const fp = params.showFootprints;
    for (let d = 0; d < G.D; d++) {
      g2.beginPath(); quadPath(g2, k, d, d + 1, j, j + 1);
      g2.fillStyle = cols[(k * G.D + d) * G.K + j]; g2.fill();
      g2.lineWidth = 0.9; g2.strokeStyle = g2.fillStyle; g2.stroke();
    }
    if (!fp) return;
    if (k > 0) {
      g2.save();
      g2.beginPath(); quadPath(g2, k - 1, 0, G.D, 0, G.K); g2.clip();
      g2.beginPath(); quadPath(g2, k, 0, G.D, j, j + 1);
      g2.fillStyle = "rgba(184,82,23,.22)"; g2.fill();
      g2.fillStyle = hatch(); g2.fill();
      g2.restore();
    }
    g2.beginPath();
    for (let d = 0; d < G.D; d++) quadPath(g2, k, d, d + 1, j, j + 1);
    g2.lineWidth = 0.8; g2.strokeStyle = "rgba(250,248,243,.5)"; g2.stroke();
    const uc = scanCentre(G, k);
    g2.beginPath();
    edgePath(g2, 0, j * SUB, (j + 1) * SUB, uc);
    edgePath(g2, G.D, j * SUB, (j + 1) * SUB, uc);
    if (j === 0) { const a = tq(0, 0, uc), b = tq(G.D, 0, uc); g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); }
    if (j === G.K - 1) { const a = tq(0, G.K * SUB, uc), b = tq(G.D, G.K * SUB, uc); g2.moveTo(a[0], a[1]); g2.lineTo(b[0], b[1]); }
    g2.lineWidth = 2.4; g2.strokeStyle = BRASS; g2.stroke();
    if (k > 0) {
      g2.beginPath(); edgePath(g2, G.D, j * SUB, (j + 1) * SUB, scanCentre(G, k - 1));
      g2.lineWidth = 1.8; g2.strokeStyle = "rgba(184,82,23,.85)"; g2.stroke();
    }
  };

  const paintRow = (r, uEnd) => {
    const ua = G.u0 + r * G.rho, ub = ua + G.rho, ue = Math.min(ub, uEnd);
    if (ue <= ua) return;
    const y0 = TY(ua), y1 = TY(ue);
    for (let j = 0; j < G.K; j++) {
      const x0 = TX(G.sx[j]), x1 = TX(G.sx[j + 1]);
      g2.fillStyle = cols[r * G.K + j];
      g2.fillRect(x0 - 0.3, y1 - 0.3, x1 - x0 + 0.6, y0 - y1 + 0.6);
    }
    if (!params.showFootprints) return;
    const xa = TX(G.sx[0]), xb = TX(G.sx[G.K]);
    g2.beginPath();
    for (let j = 1; j < G.K; j++) { const x = Math.round(TX(G.sx[j])) + 0.5; g2.moveTo(x, y1); g2.lineTo(x, y0); }
    if (ue >= ub - 1e-12) { g2.moveTo(xa, Math.round(y1) + 0.5); g2.lineTo(xb, Math.round(y1) + 0.5); }
    g2.moveTo(xa, Math.round(y0) + 0.5); g2.lineTo(xb, Math.round(y0) + 0.5);
    g2.lineWidth = 0.8; g2.strokeStyle = "rgba(250,248,243,.5)"; g2.stroke();
    const per = G.P.modules && params.preset !== "modis" ? G.K / G.P.modules : 0;
    g2.beginPath();
    for (let j = 0; j <= G.K; j++) {
      if (!(j === 0 || j === G.K || (per && j % per === 0))) continue;
      const x = TX(G.sx[j]); g2.moveTo(x, y1); g2.lineTo(x, y0);
    }
    g2.lineWidth = 1.5; g2.strokeStyle = SIGNAL; g2.stroke();
  };

  const repaint = (pr) => {
    g2.drawImage(base, 0, 0);
    if (G.sensor === "whiskbroom") {
      for (let i = 0; i < pr.count; i++) paintColumn(Math.floor(i / G.K), i % G.K);
      painted = pr.count;
    } else {
      const last = Math.min(G.rows - 1, Math.floor((pr.uEnd - G.u0) / G.rho + 1e-9));
      for (let r = 0; r <= last; r++) paintRow(r, pr.uEnd);
      paintedU = pr.uEnd;
    }
    tex.tex.needsUpdate = true;
  };

  const paintTo = (pr) => {
    if (G.sensor === "whiskbroom") {
      if (painted < 0 || pr.count < painted) { repaint(pr); return; }
      if (pr.count === painted) return;
      for (let i = painted; i < pr.count; i++) paintColumn(Math.floor(i / G.K), i % G.K);
      painted = pr.count;
    } else {
      if (pr.uEnd < paintedU - 1e-12 || paintedU === -Infinity) { repaint(pr); return; }
      if (Math.abs(pr.uEnd - paintedU) < 1e-12) return;
      const r0 = Math.max(0, Math.floor((paintedU - G.u0) / G.rho + 1e-9)), r1 = Math.min(G.rows - 1, Math.floor((pr.uEnd - G.u0) / G.rho + 1e-9));
      for (let r = r0; r <= r1; r++) paintRow(r, pr.uEnd);
      paintedU = pr.uEnd;
    }
    tex.tex.needsUpdate = true;
  };

  const buildGround = () => {
    let ymin = Infinity;
    const p = [0, 0, 0];
    for (let j = 0; j < MESH; j++) {
      const u = -G.uHalf + (2 * G.uHalf * j) / (MESH - 1);
      for (let i = 0; i < MESH; i++) {
        const s = -G.sHalf + (2 * G.sHalf * i) / (MESH - 1);
        toScene(usX(u, s), p);
        const k = (j * MESH + i) * 3;
        gpos[k] = p[0]; gpos[k + 1] = p[1]; gpos[k + 2] = p[2];
        if (p[1] < ymin) ymin = p[1];
      }
    }
    geom.attributes.position.needsUpdate = true;
    geom.computeBoundingSphere();
    const by = ymin - 0.07;
    const walls = [[], []], rim = [];
    const at = (j, i) => { const k = (j * MESH + i) * 3; return [gpos[k], gpos[k + 1], gpos[k + 2]]; };
    const edges = [[(t) => at(0, t), 0], [(t) => at(MESH - 1, t), 0], [(t) => at(t, 0), 1], [(t) => at(t, MESH - 1), 1]];
    for (const [f, side] of edges) for (let t = 0; t < MESH - 1; t++) {
      const a = f(t), b = f(t + 1);
      walls[side].push(...a, ...b, b[0], by, b[2], ...a, b[0], by, b[2], a[0], by, a[2]);
      rim.push([a, b]);
    }
    const c = [at(0, 0), at(0, MESH - 1), at(MESH - 1, MESH - 1), at(MESH - 1, 0)];
    for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; rim.push([[a[0], by, a[2]], [b[0], by, b[2]]]); rim.push([a, [a[0], by, a[2]]]); }
    globe.setTriangles(PREFIX + "wallA", Float32Array.from(walls[0]), { normals: zeros(walls[0].length) });
    globe.setTriangles(PREFIX + "wallB", Float32Array.from(walls[1]), { normals: zeros(walls[1].length) });
    globe.setSegments3D(PREFIX + "rim", rim);
    G.yBase = by;
    const tr = [], ed = [];
    const N = 80;
    for (let i = 0; i < N; i++) {
      const ua = -G.uHalf + (2 * G.uHalf * i) / N, ub = -G.uHalf + (2 * G.uHalf * (i + 1)) / N;
      tr.push([sceneUS(ua, 0), sceneUS(ub, 0)]);
      for (const sg of [-1, 1]) ed.push([sceneUS(ua, sg * G.sEdge), sceneUS(ub, sg * G.sEdge)]);
    }
    globe.setSegments3D(PREFIX + "track", tr);
    globe.setSegments3D(PREFIX + "edges", ed);
  };

  const satKm = () => 0.026 / S;

  const drawSatellite = (uSat, pr) => {
    const a = RE + G.alt, cu = Math.cos(uSat), su = Math.sin(uSat);
    const P = [a * cu, a * su, 0], up = [cu, su, 0], al = [-su, cu, 0], ac = [0, 0, 1];
    const b = satKm();
    const at = (x, y, z) => toScene([P[0] + up[0] * x + al[0] * y + ac[0] * z, P[1] + up[1] * x + al[1] * y + ac[1] * z, P[2] + up[2] * x + al[2] * y + ac[2] * z]);
    const C = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => at(x * b, y * b * 1.4, z * b));
    const box = [];
    for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [1, 5, 6, 2], [0, 3, 7, 4]]) box.push(C[f[0]], C[f[1]], C[f[2]], C[f[0]], C[f[2]], C[f[3]]);
    globe.setTriangles(PREFIX + "body", box.flat());
    const pan = [];
    for (const sg of [1, -1]) {
      const q = [at(b * 0.2, -b * 0.9, sg * b * 1.3), at(b * 0.2, b * 0.9, sg * b * 1.3), at(b * 0.2, b * 0.9, sg * b * 5.4), at(b * 0.2, -b * 0.9, sg * b * 5.4)];
      pan.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
    globe.setTriangles(PREFIX + "panels", pan.flat(), { normals: zeros(36) });
    const Ps = toScene(P);
    const nh = hit(G.alt, uSat, [-cu, -su, 0]);
    globe.setSegments3D(PREFIX + "nadir", [[Ps, toScene(lifted(nh.X, lift()))]]);
    const whisk = G.sensor === "whiskbroom";
    for (const id of ["sweep", "beam", "beamFoot", "fanEdge", "mirror"]) globe.setLayer(PREFIX + id, whisk);
    for (const id of ["sheet", "line", "sheetEdge", "bar", "mods"]) globe.setLayer(PREFIX + id, !whisk);
    if (whisk) {
      const md = whiskDir(uSat, pr.mirror ?? 0, 0);
      const pad = norm(cross(md, al));
      const M0 = [P[0] - up[0] * b * 1.6, P[1] - up[1] * b * 1.6, P[2] - up[2] * b * 1.6];
      globe.setSegments3D(PREFIX + "mirror", [[toScene([M0[0] - pad[0] * b * 1.7, M0[1] - pad[1] * b * 1.7, M0[2] - pad[2] * b * 1.7]), toScene([M0[0] + pad[0] * b * 1.7, M0[1] + pad[1] * b * 1.7, M0[2] + pad[2] * b * 1.7])]]);
      const k = Math.min(pr.k, G.scans - 1), uc = scanCentre(G, k);
      const fan = [];
      const g0 = hit(G.alt, uc, whiskDir(uc, -G.thMax, 0)), g1 = hit(G.alt, uc, whiskDir(uc, G.thMax, 0));
      globe.setSegments3D(PREFIX + "fanEdge", [[Ps, toScene(lifted(g0.X, lift()))], [Ps, toScene(lifted(g1.X, lift()))]]);
      if (pr.beam !== null) {
        const N = 28;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const th = -G.thMax + ((pr.beam + G.thMax) * i) / N;
          const h = toScene(lifted(hit(G.alt, uc, whiskDir(uc, th, 0)).X, lift() * 0.5));
          if (prev) fan.push(...Ps, ...prev, ...h);
          prev = h;
        }
        const half = G.dTh / 2, al2 = (G.D * G.dTh) / 2;
        const t0 = clamp(pr.beam - half, -G.thMax, G.thMax), t1 = clamp(pr.beam + half, -G.thMax, G.thMax);
        const corners = [[t0, -al2], [t1, -al2], [t1, al2], [t0, al2]].map(([t, a2]) => toScene(lifted(hit(G.alt, uc, whiskDir(uc, t, a2)).X, lift() * 1.5)));
        const beam = [];
        for (let i = 0; i < 4; i++) beam.push(...Ps, ...corners[i], ...corners[(i + 1) % 4]);
        globe.setTriangles(PREFIX + "beam", Float32Array.from(beam), { normals: zeros(beam.length) });
        globe.setSegments3D(PREFIX + "beamFoot", corners.map((c, i) => [c, corners[(i + 1) % 4]]));
        globe.setLayer(PREFIX + "beam", true);
        globe.setLayer(PREFIX + "beamFoot", true);
      } else {
        globe.setLayer(PREFIX + "beam", false);
        globe.setLayer(PREFIX + "beamFoot", false);
      }
      globe.setLayer(PREFIX + "sweep", fan.length > 0);
      if (fan.length) globe.setTriangles(PREFIX + "sweep", Float32Array.from(fan), { normals: zeros(fan.length) });
    } else {
      const N = 2 * G.K, pts = [];
      for (let i = 0; i <= N; i++) pts.push(toScene(lifted(hit(G.alt, uSat, pushDir(uSat, -G.xMax + (2 * G.xMax * i) / N, 0)).X, lift() * 1.5)));
      const sheet = [], line = [];
      for (let i = 0; i < N; i++) { sheet.push(...Ps, ...pts[i], ...pts[i + 1]); line.push([pts[i], pts[i + 1]]); }
      globe.setTriangles(PREFIX + "sheet", Float32Array.from(sheet), { normals: zeros(sheet.length) });
      globe.setSegments3D(PREFIX + "line", line);
      globe.setSegments3D(PREFIX + "sheetEdge", [[Ps, pts[0]], [Ps, pts[N]]]);
      const B0 = [P[0] - up[0] * b * 1.5, P[1] - up[1] * b * 1.5, P[2] - up[2] * b * 1.5];
      const w = b * 3.2;
      globe.setSegments3D(PREFIX + "bar", [[toScene([B0[0], B0[1], B0[2] - w]), toScene([B0[0], B0[1], B0[2] + w])]]);
      const nm = G.P.modules && params.preset !== "modis" ? G.P.modules : 9;
      const mods = [];
      for (let i = 0; i < nm; i++) mods.push(toScene([B0[0], B0[1], B0[2] - w + ((i + 0.5) * 2 * w) / nm]));
      globe.setPoints3D(PREFIX + "mods", mods);
    }
    return Ps;
  };

  const label3D = (name, p, text, color, dx = 12, dy = -18, away = null) => {
    const id = PREFIX + "label-" + name;
    if (!p) { if (globe.labels3d.has(id)) globe.setLabel3D(id, { visible: false }); return; }
    if (!globe.labels3d.has(id)) globe.addLabel3D(id, p, text, { color, dx, dy, away });
    else globe.setLabel3D(id, { point: p, text, color, dx, dy, away, visible: true });
  };

  const sizeLabels = (pr) => {
    const P = G.P;
    const nadir = fmtSize(pixelAt(P.value, G.sensor, 0), P.pixel), edge = fmtSize(edgePixel(P.value, G.sensor), P.pixel);
    let uN = null, sE = null;
    if (G.sensor === "whiskbroom") {
      const kl = Math.floor(pr.count / G.K) - 1;
      if (kl >= 0) { uN = scanCentre(G, kl); sE = G.sEdge; }
    } else {
      const rl = Math.floor((pr.uEnd - G.u0) / G.rho + 1e-9) - 1;
      if (rl >= 0) { uN = G.u0 + (rl + 0.5) * G.rho; sE = G.sEdge; }
    }
    if (uN === null) { label3D("nadir", null); label3D("edge", null); return; }
    const pn = sceneUS(uN, 0), narrow = L && L.stacked, edgeText = `edge pixel ${edge}`;
    let pe = sceneUS(uN, sE);
    if (narrow) {
      const lab = globe.labels3d.get(PREFIX + "label-edge"), w = (lab && lab.w) || edgeText.length * 6.7, h = (lab && lab.h) || 14;
      const scr = (p) => { const q = globe.projectPoint(p, false); return [q.x, q.y]; };
      const qn = scr(pn), qs = scr(toScene(usX(G.u0 + m * G.U, 0, G.alt)));
      const top = [], foot = [];
      for (const [ua, sa, ub, sb] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) for (let i = 0; i < 6; i++) {
        const p = toScene(usX(G.uHalf * (ua + ((ub - ua) * i) / 6), G.sHalf * (sa + ((sb - sa) * i) / 6)));
        top.push(scr(p)); foot.push(scr([p[0], G.yBase, p[2]]));
      }
      const other = sceneUS(uN, -sE), rays = [scr(pe), scr(other)], sl = globe.labels3d.get(PREFIX + "label-sat");
      let sr = null;
      if (sl && sl.w) {
        let sx = qs[0] + 16;
        if (sx + sl.w > globe.width - 8) sx = qs[0] - 16 - sl.w;
        if (sx < 8) sx = Math.min(qs[0] + 16, globe.width - sl.w - 8);
        const sy = clamp(qs[1] - 26, 8, Math.max(8, globe.height - globe.labelInsetBottom - sl.h - 8));
        sr = [sx - 6, sy - 4, sx + sl.w + 6, sy + sl.h + 4];
      }
      const cost = (p) => {
        const q = scr(p), l = Math.hypot(q[0] - qn[0], q[1] - qn[1]) || 1, nx = (q[0] - qn[0]) / l, ny = (q[1] - qn[1]) / l;
        let x = q[0] + nx * 12 - (nx < -0.3 ? w : nx < 0.3 ? w / 2 : 0);
        if (x + w > globe.width - 8) x = q[0] - 12 - w;
        if (x < 8) x = Math.min(q[0] + 12, globe.width - w - 8);
        const y = q[1] + ny * 12 - (ny < -0.3 ? h : ny < 0.3 ? h / 2 : 0);
        let hits = 0;
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) {
          const sx = x + (w * i) / 4, sy = y + (h * j) / 2;
          if (inPoly(top, sx, sy) || inPoly(foot, sx, sy)) hits++;
        }
        for (const r of rays) for (let t = 0; t <= 1; t += 0.05) {
          const sx = qs[0] + (r[0] - qs[0]) * t, sy = qs[1] + (r[1] - qs[1]) * t;
          if (sx > x - 4 && sx < x + w + 4 && sy > y - 4 && sy < y + h + 4) hits++;
        }
        if (sr && x < sr[2] && x + w > sr[0] && y < sr[3] && y + h > sr[1]) hits += 10;
        return { hits, score: hits * 1e4 - Math.hypot(q[0] - qs[0], q[1] - qs[1]) };
      };
      const a = cost(pe), b = cost(other);
      const best = b.score < a.score ? b : a;
      if (best === b) pe = other;
      if (best.hits > 2) pe = null;
    }
    label3D("nadir", narrow ? null : pn, `nadir pixel ${nadir}`, INK, -14, -24);
    label3D("edge", pe, edgeText, sensorCol(), 14, -24, narrow ? pn : null);
  };

  const drawHover = () => {
    const outline = (poly) => {
      const segs = [];
      for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; segs.push([sceneUS(a[0], a[1], lift() * 2), sceneUS(b[0], b[1], lift() * 2)]); }
      return segs;
    };
    const polyOf = (c) => (G.sensor === "pushbroom" ? pushCell(G, c.r, c.j) : whiskCell(G, c.k, c.d, c.j));
    const h = hoverHits;
    globe.setLayer(PREFIX + "hover", h.length > 0);
    globe.setLayer(PREFIX + "hover2", h.length > 1);
    if (h.length) globe.setSegments3D(PREFIX + "hover", outline(polyOf(h[0])));
    if (h.length > 1) globe.setSegments3D(PREFIX + "hover2", outline(polyOf(h[1])));
  };

  const fitPoints = () => {
    const pts = [];
    for (const u of [-G.uHalf, 0, G.uHalf]) for (const s of [-G.sHalf, 0, G.sHalf]) { const p = toScene(usX(u, s)); pts.push(p, [p[0], G.yBase, p[2]]); }
    for (const u of [G.u0, G.u0 + G.U]) pts.push(toScene(usX(u, 0, G.alt + satKm() * 2)), toScene(usX(u, (satKm() * 5.4) / RE, G.alt)), toScene(usX(u, -(satKm() * 5.4) / RE, G.alt)));
    return pts;
  };

  const frameAll = (duration = 0) => {
    if (ctx.side !== "A" || !G || !L) return;
    const f = globe.camera.fit(fitPoints(), { padding: 16, insetTop: 30, insetBottom: L.inset, minDist: 1.3, apply: false });
    if (duration > 0 && !ctx.reducedMotion) globe.camera.glideTo(f, { duration });
    else { globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]); }
  };

  const wrapLines = (c, text, w) => {
    const out = [];
    let line = "";
    for (const wd of text.split(" ")) {
      const t = line ? line + " " + wd : wd;
      if (c.measureText(t).width > w && line) { out.push(line); line = wd; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };

  const wrapText = (c, text, x, y, w, lh, maxLines = 9) => {
    const words = text.split(" ");
    let line = "", n = 0;
    for (const wd of words) {
      const t = line ? line + " " + wd : wd;
      if (c.measureText(t).width > w && line) { c.fillText(line, x, y); y += lh; line = wd; if (++n >= maxLines) return y; }
      else line = t;
    }
    if (line) { c.fillText(line, x, y); y += lh; }
    return y;
  };

  const curves = () => {
    const P = G.P, N = 120, wk = [], pb = [];
    for (let i = 0; i <= N; i++) {
      const th = -G.thMax + (2 * G.thMax * i) / N, f = factors(P.alt, th);
      wk.push([Math.sign(th) * f.arc * RE, f.across, f.along]);
      const x = -G.xMax + (2 * G.xMax * i) / N, tp = Math.atan(x) * RAD, fp = factors(P.alt, tp);
      pb.push([Math.sign(tp) * fp.arc * RE, fp.pushAcross, fp.pushAlong]);
    }
    return { wk, pb };
  };

  let CV = null;
  const YMAX = 5;
  const drawPanel = (pr) => {
    if (!L || !G) return;
    const c = pc.getContext("2d"), dpr = stage.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, L.pw, L.ph);
    const P = G.P, whisk = G.sensor === "whiskbroom", col = sensorCol();
    const x0 = 18;
    c.fillStyle = col; c.beginPath(); c.roundRect(10, 14, 2, L.barH, 1); c.fill();
    c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.font = `600 13px ${FONT_UI}`; c.fillStyle = INK;
    const title = whisk
      ? `Whiskbroom · scan ${Math.min(G.scans, pr.k + (pr.done ? 0 : 1))} of ${G.scans}`
      : `Pushbroom · line ${Math.min(G.rows, pr.row + (pr.done ? 0 : 1))} of ${G.rows}`;
    c.fillText(title, x0, L.titleY);
    c.font = `400 11.5px ${FONT_UI}`; c.fillStyle = INK2;
    const eA = factors(P.alt, G.thMax);
    const edgeText = `At the edge a pixel is ${eA.across.toFixed(eA.across < 1.5 ? 2 : 1)} times wider and ${eA.along.toFixed(eA.along < 1.5 ? 2 : 1)} times longer.`;
    const bowText = bowtie(P.alt, P.swath, P.pixel, P.whisk).fraction > 0.1 ? "Each scan then overlaps the next: the bow-tie." : "A narrow sweep gives almost no bow-tie.";
    const sameText = "All rows have the same length along the track.";
    const body = whisk
      ? `A mirror sweeps ${P.whisk} detectors across the track, one scan at a time. ${edgeText} ${bowText}`
      : `A line of detectors sees the full swath at one time. As the satellite moves, each line becomes one row of pixels. ${sameText}`;
    if (L.stacked) {
      const options = whisk ? [body, `${edgeText} ${bowText}`, edgeText] : [body, `A line of detectors sees the full swath at one time. ${sameText}`, sameText];
      const lines = options.map((t) => wrapLines(c, t, L.capW)).find((ls) => ls.length <= L.capLines) || [];
      lines.forEach((ln, i) => c.fillText(ln, x0, L.capY + i * 15));
    } else {
      const y = wrapText(c, body, x0, L.capY, L.capW - 6, 15, L.capLines);
      c.font = `400 10.5px ${FONT_UI}`; c.fillStyle = INK3;
      const nadirCell = G.sensor === "whiskbroom" ? 2 * arcOf(P.alt, G.dTh / 2) * RE : 2 * arcOf(P.alt, Math.atan(G.dx / 2) * RAD) * RE;
      const nPix = Math.round(nadirCell / P.pixel);
      const what = P.sensor !== G.sensor ? `${P.name} uses a ${P.sensor}. This is a what-if ${G.sensor}. ` : "";
      wrapText(c, `${what}One drawn cell is about ${nPix.toLocaleString("en-US")} × ${nPix.toLocaleString("en-US")} real pixels.`, x0, Math.max(y + 3, L.ph - 30), L.capW - 6, 13, 2);
    }

    const R = L.chart;
    const { wk, pb } = curves();
    const half = G.sEdge * RE;
    const X = (km) => R.x + ((km + half) / (2 * half)) * R.w;
    const Y = (v) => R.y + R.h - (v / YMAX) * R.h;
    CV = { R, X, Y, half, wk, pb };
    const heads = ["PIXEL SIZE ÷ NADIR PIXEL, ACROSS THE SWATH", "PIXEL SIZE ÷ NADIR PIXEL"];
    c.font = `500 10px ${FONT_UI}`;
    if (L.stacked) {
      let lx = R.x, ly = L.legendY;
      for (const [cc, t] of LEGEND) {
        c.fillStyle = cc; c.fillRect(lx, ly - 4, 12, 2);
        c.textAlign = "left"; c.fillText(t, lx + 17, ly);
        lx += 17 + c.measureText(t).width + 12;
      }
      if (L.legendRows > 1) { lx = R.x; ly += 13; }
      c.fillStyle = INK3; c.fillText(LEGEND_NOTE, lx, ly);
      c.font = `600 10px ${FONT_UI}`; c.fillStyle = INK3; c.textAlign = "left";
      c.fillText(heads.find((h) => c.measureText(h).width <= L.pw - x0 - 14) || heads[1], x0, L.chartTitleY);
    } else {
      let lx = R.x + R.w, legendW = -10;
      for (const [, t] of LEGEND) legendW += c.measureText(t).width + 28;
      c.textAlign = "right";
      c.fillStyle = INK3; c.fillText(LEGEND_NOTE, lx, R.y - 4);
      for (const [cc, t] of LEGEND.slice().reverse()) {
        c.fillStyle = cc; c.fillText(t, lx, R.y - 16);
        lx -= c.measureText(t).width + 6;
        c.fillRect(lx - 12, R.y - 20, 12, 2);
        lx -= 22;
      }
      c.font = `600 10px ${FONT_UI}`; c.fillStyle = INK3; c.textAlign = "left";
      c.fillText(heads.find((h) => c.measureText(h).width + 16 + legendW <= R.w) || heads[1], R.x, R.y - 16);
    }
    c.strokeStyle = "rgba(60,52,40,.12)"; c.lineWidth = 1;
    c.font = `500 9.5px ${FONT_MONO}`; c.textAlign = "right"; c.fillStyle = INK3;
    for (let v = 1; v <= YMAX; v++) {
      const yy = Math.round(Y(v)) + 0.5;
      c.beginPath(); c.moveTo(R.x, yy); c.lineTo(R.x + R.w, yy); c.stroke();
      c.fillText(`×${v}`, R.x - 4, yy + 3);
    }
    c.strokeStyle = "rgba(60,52,40,.3)";
    c.beginPath(); c.moveTo(R.x, Math.round(Y(0)) + 0.5); c.lineTo(R.x + R.w, Math.round(Y(0)) + 0.5); c.stroke();
    c.beginPath(); c.moveTo(Math.round(X(0)) + 0.5, R.y); c.lineTo(Math.round(X(0)) + 0.5, R.y + R.h); c.setLineDash([2, 3]); c.stroke(); c.setLineDash([]);
    c.textAlign = "center"; c.textBaseline = "top";
    c.fillText("nadir", X(0), R.y + R.h + 5);
    c.textAlign = "left"; c.fillText(`−${Math.round(half).toLocaleString("en-US")} km`, R.x, R.y + R.h + 5);
    c.textAlign = "right"; c.fillText(`+${Math.round(half).toLocaleString("en-US")} km`, R.x + R.w, R.y + R.h + 5);
    c.textBaseline = "alphabetic";
    if (whisk && pr.beam !== null) {
      const f = factors(P.alt, pr.beam), bx = X(Math.sign(pr.beam) * f.arc * RE);
      c.fillStyle = "rgba(184,82,23,.14)"; c.fillRect(X(-half), R.y, bx - X(-half), R.h);
      c.strokeStyle = BRASS; c.lineWidth = 1; c.beginPath(); c.moveTo(bx, R.y); c.lineTo(bx, R.y + R.h); c.stroke();
    }
    if (!whisk) { c.fillStyle = "rgba(29,99,168,.08)"; c.fillRect(R.x, R.y, R.w, R.h); }
    c.save();
    c.beginPath(); c.rect(R.x, R.y - 2, R.w, R.h + 4); c.clip();
    const plot = (arr, idx, color, dash, width, alpha) => {
      c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash);
      c.beginPath(); arr.forEach((p, i) => { const xx = X(p[0]), yy = Y(Math.min(p[idx], YMAX + 0.2)); if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); }); c.stroke();
      c.setLineDash([]); c.globalAlpha = 1;
    };
    const aW = whisk ? 1 : 0.35, aP = whisk ? 0.35 : 1;
    plot(pb, 1, SIGNAL, [], whisk ? 1.3 : 2.2, aP);
    plot(pb, 2, SIGNAL, [5, 4], whisk ? 1.3 : 2, aP);
    plot(wk, 1, BRASS, [], whisk ? 2.2 : 1.3, aW);
    plot(wk, 2, BRASS, [5, 4], whisk ? 2 : 1.3, aW);
    c.restore();
    const mark = (km, th) => {
      const f = factors(P.alt, th);
      const a = whisk ? f.across : f.pushAcross, b = whisk ? f.along : f.pushAlong;
      const xx = X(km);
      c.strokeStyle = INK; c.lineWidth = 1; c.setLineDash([2, 2]);
      c.beginPath(); c.moveTo(xx, R.y); c.lineTo(xx, R.y + R.h); c.stroke(); c.setLineDash([]);
      for (const v of [a, b]) { c.beginPath(); c.arc(xx, Y(v), 3.5, 0, Math.PI * 2); c.fillStyle = INK; c.fill(); c.strokeStyle = "#faf8f3"; c.stroke(); }
    };
    if (chartHover) mark(chartHover.km, chartHover.th);
    else if (hoverHits.length) { const th = cellAngle(G, hoverHits[0].j); mark(Math.sign(th) * arcOf(P.alt, th) * RE, th); }
  };

  const readouts = () => {
    const P = G.P;
    ctx.readout.setMany({
      swath: P.swath,
      nadir: fmtSize(pixelAt(P.value, G.sensor, 0), P.pixel),
      edge: fmtSize(edgePixel(P.value, G.sensor), P.pixel),
      detectors: detectorsText(P.value, G.sensor),
    });
  };

  let lastPr = null;
  const render = () => {
    if (!G) return;
    const pr = progress(G, m);
    lastPr = pr;
    paintTo(pr);
    drawSatellite(G.u0 + m * G.U, pr);
    const Ps = toScene(usX(G.u0 + m * G.U, 0, G.alt));
    label3D("sat", Ps, `${G.P.name} · ${G.P.alt} km`, INK, 16, -26);
    sizeLabels(pr);
    drawPanel(pr);
    globe.invalidate();
    if (pr.done) ctx.done();
  };

  const rebuild = (keepView) => {
    G = geometry(params.preset, params.sensor);
    S = 2 / Math.max(2 * G.sHalf * RE, 2 * G.uHalf * RE);
    buildGround();
    buildBase();
    buildColours();
    painted = -1; paintedU = -Infinity;
    hoverHits = [];
    drawHover();
    const key = params.preset;
    if (!keepView || framedKey !== key) {
      const turn = framedKey && booted && ctx.side === "A";
      framedKey = key;
      if (turn) {
        const v = VIEWS[key] || VIEWS.sentinel2;
        Promise.resolve(globe.camera.lookAt(v[0], v[1], null, { duration: ctx.reducedMotion ? 0 : 600 })).then(() => { if (!ctx.signal.aborted && framedKey === key) frameAll(500); });
      } else frameAll(0);
    }
  };

  const reSensor = () => {
    G = geometry(params.preset, params.sensor);
    buildColours();
    painted = -1; paintedU = -Infinity;
    hoverHits = [];
    drawHover();
  };

  const setM = (v) => { m = clamp(v, 0, 1); render(); };

  const bar = stage.el.parentElement ? stage.el.parentElement.querySelector(".transport") : null;
  const playBtn = bar ? bar.querySelector(".tp-play") : null;
  const range = bar ? bar.querySelector(".tp-range") : null;
  const paintPlay = (on) => {
    ctx.controls.setLabel("play", on ? "Pause" : "Play");
    if (!playBtn) return;
    playBtn.replaceChildren(ui.icon(on ? "i-pause" : "i-play", 18));
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
  };
  const paintRange = () => { if (range) { range.value = String(m); range.style.setProperty("--b", m * 100 + "%"); } };
  const clearTimers = () => {
    if (playTw) { playTw.cancel(); playTw = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  };
  const stopPlay = (commit = true) => {
    if (!playing) return;
    playing = false;
    clearTimers();
    paintPlay(false);
    if (commit && ctx.transport) ctx.transport.set(m);
  };
  const run = () => {
    playTw = ctx.anim.tween({
      from: m, to: 1, duration: Math.max(1, (1 - m) * G.scans * MS_PER_SCAN), ease: ctx.anim.ease.linear,
      onUpdate: (v) => { setM(v); paintRange(); },
      onDone: () => {
        playTw = null;
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          if (!playing) return;
          playTw = ctx.anim.tween({ from: 1, to: 0, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
        }, 1800);
      },
    });
  };
  const startPlay = () => {
    if (playing) return;
    if (jumpTw) { jumpTw.cancel(); jumpTw = null; }
    playing = true;
    paintPlay(true);
    if (m >= 0.999) playTw = ctx.anim.tween({ from: m, to: 0, duration: 700, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
    else run();
  };
  const togglePlay = () => { if (playing) stopPlay(); else startPlay(); };
  if (bar && ctx.side === "A") {
    bar.addEventListener("click", (e) => {
      if (!e.target.closest || !e.target.closest(".tp-play")) return;
      e.stopPropagation(); e.preventDefault();
      togglePlay();
    }, { capture: true, signal: ctx.signal });
  }
  const unkey = ctx.side === "A" ? ui.keymap({ space: () => togglePlay() }) : null;

  const jumpTo = (target) => {
    stopPlay(false);
    if (jumpTw) jumpTw.cancel();
    if (ctx.reducedMotion) { setM(target); paintRange(); if (ctx.transport) ctx.transport.set(m); return; }
    jumpTw = ctx.anim.tween({ from: m, to: target, duration: 500, ease: ctx.anim.ease.standard, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { jumpTw = null; if (ctx.transport) ctx.transport.set(m); } });
  };

  if (ctx.transport) ctx.transport.onScrub((v) => {
    if (playing) stopPlay(false);
    if (jumpTw) { jumpTw.cancel(); jumpTw = null; }
    if (G) setM(v); else m = v;
  });

  const ownPick = (x, y) => {
    if (!G) return null;
    const { origin: o, dir: d } = globe.ray(x, y);
    const c = [0, -RE * S, 0], oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - (RE * S) ** 2, disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    const X = [p[1] / S + RE, -p[2] / S, p[0] / S];
    const u = Math.atan2(X[1], X[0]), s = Math.asin(clamp(X[2] / Math.hypot(X[0], X[1], X[2]), -1, 1));
    if (Math.abs(u) > G.uHalf || Math.abs(s) > G.sHalf) return null;
    const [lon, lat] = toLonLat(u, s);
    return { lon, lat };
  };
  const ownProject = (lon, lat) => {
    if (!G) return { x: NaN, y: NaN, visible: false };
    const q = fromLonLat(lon, lat);
    const sp = globe.projectPoint(sceneUS(q.u, q.s), false);
    return { x: sp.x, y: sp.y, visible: Math.abs(q.u) <= G.uHalf && Math.abs(q.s) <= G.sHalf && sp.visible };
  };
  globe.pick = ownPick;
  globe.project = ownProject;

  const offHover = globe.on("hover", (hv) => { if (!hv && hoverHits.length) { hoverHits = []; drawHover(); if (lastPr) drawPanel(lastPr); } });

  const recorded = (c) => {
    if (G.sensor === "pushbroom") return G.u0 + (c.r + 1) * G.rho <= G.u0 + m * G.U + 1e-12 ? "done" : G.u0 + c.r * G.rho < G.u0 + m * G.U ? "now" : "no";
    const idx = c.k * G.K + c.j;
    return idx < (lastPr ? lastPr.count : 0) ? "done" : "no";
  };

  const chipLines = (hits) => {
    const P = G.P, c = hits[0], th = cellAngle(G, c.j);
    const f = factors(P.alt, th), real = pixelAt(P.value, G.sensor, th);
    const lines = [];
    if (G.sensor === "pushbroom") {
      const per = P.modules && P.value !== "modis" ? G.K / P.modules : 0;
      lines.push(`line ${c.r + 1} of ${G.rows} · cell ${c.j + 1} of ${G.K}${per ? ` · module ${Math.floor(c.j / per) + 1} of ${P.modules}` : ""}`);
      lines.push(`view angle ${Math.abs(th).toFixed(1)}° · real pixel ${fmtSize(real, P.pixel)}`);
      lines.push(`width ×${f.pushAcross.toFixed(2)} · length ×${f.pushAlong.toFixed(3)} of the nadir pixel`);
      lines.push("every cell in a row has the same length along the track");
    } else {
      lines.push(`scan ${c.k + 1} of ${G.scans} · cell ${c.j + 1} of ${G.K} · detector row ${c.d + 1} of ${G.D}`);
      lines.push(`scan angle ${Math.abs(th).toFixed(1)}° · real pixel ${fmtSize(real, P.pixel)}`);
      lines.push(`width ×${f.across.toFixed(2)} · length ×${f.along.toFixed(2)} of the nadir pixel`);
      const ks = [...new Set(hits.map((h) => h.k))].sort((a, b) => a - b);
      if (ks.length > 1) lines.push(`seen two times: scans ${ks[0] + 1} and ${ks[1] + 1} (bow-tie)`);
    }
    const st = recorded(c);
    if (st === "no") lines.push("not recorded yet");
    else if (st === "now") lines.push("the line records it now");
    return lines;
  };

  const panelXY = (e) => { const r = panel.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  panel.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    if (!CV || !G) return;
    const [x, y] = panelXY(e), R = CV.R;
    if (x < R.x || x > R.x + R.w || y < R.y - 4 || y > R.y + R.h + 4) { if (chartHover) { chartHover = null; drawPanel(lastPr); } ctx.overlay.hideChip(); return; }
    const km = ((x - R.x) / R.w) * 2 * CV.half - CV.half;
    const a = RE + G.alt, g = Math.abs(km) / RE;
    const th = Math.sign(km) * Math.atan((RE * Math.sin(g)) / (a - RE * Math.cos(g))) * RAD;
    chartHover = { km, th };
    drawPanel(lastPr);
    const P = G.P, f = factors(P.alt, th);
    const w = { across: P.pixel * f.across, along: P.pixel * f.along }, pb = { across: P.pixel * f.pushAcross, along: P.pixel * f.pushAlong };
    const r = stage.el.getBoundingClientRect();
    ctx.overlay.chip(e.clientX - r.left, e.clientY - r.top, [
      `${km >= 0 ? "+" : "−"}${Math.abs(km).toFixed(0)} km from nadir · angle ${Math.abs(th).toFixed(1)}°`,
      `whiskbroom pixel ${fmtSize(w, P.pixel)}`,
      `pushbroom pixel ${fmtSize(pb, P.pixel)}`,
    ]);
  }, { signal: ctx.signal });
  panel.addEventListener("pointerleave", () => { ctx.overlay.hideChip(); if (chartHover) { chartHover = null; drawPanel(lastPr); } }, { signal: ctx.signal });
  for (const ev of ["pointerdown", "wheel", "dblclick", "click"]) panel.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  const useBasemap = (b, kind) => {
    if (ctx.signal.aborted || !b || !b.color) return;
    if (bmKind === "satellite" && kind !== "satellite") return;
    bm = b; bmKind = kind;
    if (!G) return;
    buildBase();
    buildColours();
    painted = -1; paintedU = -Infinity;
    render();
  };
  getBasemap({ colour: "ramp" }).then((b) => useBasemap(b, "ramp")).catch(() => {});
  getBasemap({ colour: "satellite" }).then((b) => useBasemap(b, "satellite")).catch(() => {});

  layout();
  if (ctx.side === "A" && ctx.url.get("v") === undefined && params.preset !== "sentinel2") {
    const v = VIEWS[params.preset];
    if (v) globe.camera.lookAt(v[0], v[1], null, { duration: 0 });
  }
  rebuild(false);
  setTimeout(() => {
    booted = true;
    if (ctx.side === "A" && !ctx.reducedMotion && ctx.url.get("m") === undefined && !ctx.signal.aborted) autoTimer = setTimeout(() => { autoTimer = 0; if (!ctx.signal.aborted && m < 0.001) startPlay(); }, 900);
  }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("play")) { togglePlay(); return; }
      if (keys.length === 1 && keys[0] === "preset" && booted) {
        const want = presetOf(params.preset).sensor;
        if (want !== params.sensor) {
          params.sensor = want;
          setTimeout(() => { if (!ctx.signal.aborted && params.sensor === want) ctx.controls.set("sensor", want); }, 0);
        }
      }
      if (!G || keys.length === 0 || keys.length > 2 || G.preset !== params.preset) rebuild(true);
      else if (G.sensor !== params.sensor) reSensor();
      if (keys.includes("showFootprints")) { painted = -1; paintedU = -Infinity; }
      if (keys.includes("m") && !playing && !jumpTw) m = clamp(+params.m || 0, 0, 1);
      render();
      paintRange();
      readouts();
    },
    hover(lon, lat) {
      if (!G) return [];
      const q = fromLonLat(lon, lat);
      const hits = findCells(G, q.u, q.s);
      hoverHits = hits;
      drawHover();
      if (lastPr) drawPanel(lastPr);
      if (!hits.length) return Math.abs(q.s) < G.sHalf ? ["outside the swath"] : [];
      return chipLines(hits);
    },
    probe(lon, lat) {
      if (!G) return null;
      const q = fromLonLat(lon, lat);
      const hits = findCells(G, q.u, q.s);
      if (hits.length) jumpTo(timeOfCell(G, hits[hits.length - 1]));
      return null;
    },
    unprobe() {},
    resize() { layout(); frameAll(0); if (lastPr) { sizeLabels(lastPr); drawPanel(lastPr); } },
    unmount() {
      stopPlay(false);
      clearTimers();
      if (autoTimer) clearTimeout(autoTimer);
      if (jumpTw) jumpTw.cancel();
      if (unkey) unkey();
      paintPlay(false);
      offHover();
      delete globe.pick;
      delete globe.project;
      globe.removePrefix(PREFIX);
      globe.labelInsetBottom = 0;
      for (const k of Object.keys(saved)) globe.setLayer(k, k === "labels" ? saved[k] : true);
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
      panel.remove();
    },
  };
}
