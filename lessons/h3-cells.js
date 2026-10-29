import * as h3 from "h3";
import { morphs } from "@/core/globe.js";
import { DEG, RAD, clamp, smoothstep } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const WARN = "#b7791f";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const GLOBAL_MAX = 4;
const LINE_MAX = 1;

export const meta = {
  id: "h3-cells",
  title: "Hexagons from an icosahedron",
  track: 5,
  order: 5,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Put a light at the centre and an icosahedron around the globe. On each face hexagons are regular. Twelve corners cannot be hexagons, so each resolution has exactly twelve pentagons. Every step splits a hexagon into seven children, turned a little. The icosahedron is placed so all twelve corners are in the ocean.",
  deeper: [
    "Resolution 0 has 122 cells; resolution r has 2 + 120·7^r.",
    "Average hexagon area at resolution 0 is 4,357,449 km².",
    "Children are rotated by 19.1° each step.",
    "Every pentagon lies in the ocean.",
  ],
  keywords: ["H3", "hexagon", "icosahedron", "pentagon", "aperture 7"],
  controls: [
    { key: "res", type: "range", label: "Resolution", min: 0, max: 15, step: 1, default: 1, ticks: [0, 4, 15] },
    { key: "colourBy", type: "segment", label: "Colour by", options: [{ value: "base", label: "Base cell" }, { value: "digit", label: "Child digit" }, { value: "none", label: "None" }], default: "base" },
    { key: "point", type: "point", label: "Place", default: [-3.7038, 40.4168] },
    { key: "children", type: "toggle", label: "Children", default: true, shortcut: "c" },
    { key: "closeUp", type: "toggle", label: "Close-up, resolutions 5 to 15", default: false },
    { key: "parent", type: "button", label: "Parent", icon: "i-chevron-left" },
    { key: "child", type: "button", label: "Child", icon: "i-chevron-right" },
    { type: "legend", label: "Key", items: [
      { color: WARN, line: true, label: "Pentagon, one at each icosahedron corner" },
      { color: "rgba(184,82,23,.7)", line: true, label: "Icosahedron edge" },
      { color: SIGNAL, line: true, label: "The cell of the place and its 7 children" },
    ] },
  ],
  readouts: [
    { key: "id", label: "Cell id" },
    { key: "res", label: "Resolution" },
    { key: "area", label: "Area" },
    { key: "pent", label: "Pentagon" },
    { key: "count", label: "Cells at this resolution" },
    { key: "base", label: "Base cell" },
  ],
  transport: { label: ["sphere", "icosahedron net"], key: "m" },
  compare: null,
  view: { lon: -10, lat: 25, dist: 3.2 },
  data: [],
};

const PREFIX = meta.id + ":";
const FIT_PADDING = 28;

export const ROTATION_DEG = Math.atan(Math.sqrt(3) / 5) * RAD;

export function cellCount(res) {
  return 2 + 120 * 7 ** res;
}

export function cellOf(lon, lat, res) {
  return h3.latLngToCell(lat, lon, res);
}

export function info(cell) {
  const res = h3.getResolution(cell);
  return { id: cell, res, area: h3.cellArea(cell, "km2"), pentagon: h3.isPentagon(cell), count: h3.getNumCells(res), base: h3.getBaseCellNumber(cell) };
}

export function boundaryLonLat(cell) {
  return h3.cellToBoundary(cell).map(([lat, lng]) => [lng, lat]);
}

export function centreLonLat(cell) {
  const [lat, lng] = h3.cellToLatLng(cell);
  return [lng, lat];
}

const xyz = (lon, lat) => { const c = Math.cos(lat * DEG); return [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)]; };
const ll = (v) => [Math.atan2(v[1], v[0]) * RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD];

export function bearing(a, b) {
  const p1 = a[1] * DEG, p2 = b[1] * DEG, dl = (b[0] - a[0]) * DEG;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * RAD;
}

export function destination(a, brg, distDeg) {
  const p1 = a[1] * DEG, l1 = a[0] * DEG, b = brg * DEG, d = distDeg * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 * RAD + 540) % 360) - 180, p2 * RAD];
}

export function faceNormal(lonlat) {
  const P = xyz(lonlat[0], lonlat[1]);
  let best = null, bd = -2;
  for (const tri of icosahedronFaces()) {
    const X = tri.map(([lo, la]) => xyz(lo, la));
    const C = [X[0][0] + X[1][0] + X[2][0], X[0][1] + X[1][1] + X[2][1], X[0][2] + X[1][2] + X[2][2]];
    const l = Math.hypot(...C);
    const n = [C[0] / l, C[1] / l, C[2] / l];
    const d = n[0] * P[0] + n[1] * P[1] + n[2] * P[2];
    if (d > bd) { bd = d; best = n; }
  }
  return best;
}

export function childRotation(cell) {
  const n = faceNormal(centreLonLat(cell));
  const e = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [0, -n[2], n[1]];
  const el = Math.hypot(...e);
  const E = e.map((v) => v / el), N = [n[1] * E[2] - n[2] * E[1], n[2] * E[0] - n[0] * E[2], n[0] * E[1] - n[1] * E[0]];
  const plane = ([lo, la]) => { const P = xyz(lo, la); const d = P[0] * n[0] + P[1] * n[1] + P[2] * n[2]; const g = P.map((v) => v / d); return [g[0] * E[0] + g[1] * E[1] + g[2] * E[2], g[0] * N[0] + g[1] * N[1] + g[2] * N[2]]; };
  const angles = (c) => { const ctr = plane(centreLonLat(c)); return boundaryLonLat(c).map((v) => { const q = plane(v); return Math.atan2(q[1] - ctr[1], q[0] - ctr[0]) * RAD; }); };
  const kid = h3.cellToCenterChild(cell, h3.getResolution(cell) + 1);
  let best = Infinity;
  for (const a of angles(cell)) for (const b of angles(kid)) {
    let d = (((b - a) % 60) + 60) % 60;
    if (d > 30) d -= 60;
    if (Math.abs(d) < Math.abs(best)) best = d;
  }
  return Math.abs(best);
}

export function icosahedronFaces() {
  const V = h3.getPentagons(0).map(centreLonLat);
  const X = V.map(([lo, la]) => xyz(lo, la));
  const adj = (i, j) => X[i][0] * X[j][0] + X[i][1] * X[j][1] + X[i][2] * X[j][2] > 0.3;
  const faces = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (adj(i, j) && adj(j, k) && adj(i, k)) faces.push([V[i], V[j], V[k]]);
  return faces;
}

export function arcDeg(a, b) {
  const A = xyz(a[0], a[1]), B = xyz(b[0], b[1]);
  return Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)) * RAD;
}

export function labelAnchor(cell) {
  const c = centreLonLat(cell);
  return destination(c, 0, Math.max(...boundaryLonLat(cell).map((v) => arcDeg(c, v))));
}

export function slerpPath(a, b, stepDeg = 1) {
  const A = xyz(a[0], a[1]), B = xyz(b[0], b[1]);
  const w = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1));
  const n = Math.max(1, Math.ceil(w / (stepDeg * DEG)));
  const out = [a];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (w < 1e-12) { out.push(b); continue; }
    const s0 = Math.sin((1 - t) * w) / Math.sin(w), s1 = Math.sin(t * w) / Math.sin(w);
    out.push(ll([A[0] * s0 + B[0] * s1, A[1] * s0 + B[1] * s1, A[2] * s0 + B[2] * s1]));
  }
  return out;
}

const pathSegs = (pts) => { const s = []; for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]); return s; };

function ringSegs(ring, stepDeg) {
  const segs = [];
  for (let i = 0; i < ring.length; i++) segs.push(...pathSegs(slerpPath(ring[i], ring[(i + 1) % ring.length], stepDeg)));
  return segs;
}

const allCells = new Map();
export function cellsAt(res) {
  if (!allCells.has(res)) allCells.set(res, h3.uncompactCells(h3.getRes0Cells(), res));
  return allCells.get(res);
}

export function uniqueEdges(cells, stepDeg) {
  const seen = new Set();
  const segs = [];
  const key = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  for (const c of cells) {
    const ring = boundaryLonLat(c);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ka = key(a), kb = key(b);
      const k = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      if (seen.has(k)) continue;
      seen.add(k);
      segs.push(...pathSegs(slerpPath(a, b, stepDeg)));
    }
  }
  return segs;
}

const W = 4096, H = 2048;
function ringToCanvas(g, ring) {
  let prev = null, total = 0;
  const pts = [];
  for (const [lon, lat] of ring) {
    let L = lon;
    if (prev !== null) { while (L - prev > 180) L -= 360; while (L - prev < -180) L += 360; total += L - prev; }
    pts.push([L, lat]);
    prev = L;
  }
  const first = pts[0];
  let close = first[0];
  while (close - prev > 180) close -= 360; while (close - prev < -180) close += 360;
  total += close - prev;
  const polar = Math.abs(total) > 180;
  if (polar) {
    const north = ring.reduce((a, p) => a + p[1], 0) > 0;
    const lastL = prev;
    pts.push([lastL, north ? 90 : -90], [first[0], north ? 90 : -90]);
  }
  let lo = Infinity, hi = -Infinity;
  for (const q of pts) { if (q[0] < lo) lo = q[0]; if (q[0] > hi) hi = q[0]; }
  const offs = [0];
  if (lo < -180) offs.push(360);
  if (hi > 180) offs.push(-360);
  for (const off of offs) {
    g.moveTo(((pts[0][0] + off + 180) / 360) * W, ((90 - pts[0][1]) / 180) * H);
    for (let i = 1; i < pts.length; i++) g.lineTo(((pts[i][0] + off + 180) / 360) * W, ((90 - pts[i][1]) / 180) * H);
    g.closePath();
  }
}

function strokeRing(g, ring) {
  let px = null;
  const pts = [...ring, ring[0]];
  pts.forEach(([lon, lat], i) => {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
    if (i === 0 || Math.abs(x - px) > W / 2) g.moveTo(x, y); else g.lineTo(x, y);
    px = x;
  });
}

export function rgba(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function hslRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

export function baseColour(base, alpha = 0.34) {
  const [r, g, b] = hslRgb((base * 137.508) % 360, 0.5, 0.58);
  return rgba(r, g, b, alpha);
}

export const DIGIT_RGB = [[184, 82, 23], [29, 99, 168], [112, 70, 166], [47, 125, 79], [180, 35, 53], [86, 140, 200], [107, 102, 94]];
export const DIGIT_COLOURS = DIGIT_RGB.map(([r, g, b], i) => rgba(r, g, b, i === 6 ? 0.22 : 0.34));
const DIGIT_PANEL = DIGIT_RGB.map(([r, g, b]) => `rgba(${r},${g},${b},.38)`);

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let booted = false;
  let oriented = false;
  let gridKey = "", fillKey = "";
  let picked = null;
  let bloom = null, bloomU = 1;
  const morph = morphs.toPolyhedron("icosahedron");
  globe.morph(morph, t);
  globe.labelInsetBottom = ctx.stage.insetBottom;
  globe.addLabel3D(PREFIX + "cell-label", null, "", { color: SIGNAL, gap: 8 });
  globe.addLabel3D(PREFIX + "rot-label", null, "", { color: BRASS, dx: 8, dy: -6 });

  const faces = icosahedronFaces();
  const nudge = (p, c, f = 0.004) => ll([p[0] + (c[0] - p[0]) * f, p[1] + (c[1] - p[1]) * f, p[2] + (c[2] - p[2]) * f]);

  const drawIcosa = () => {
    const segs = [];
    for (const tri of faces) {
      const X = tri.map(([lo, la]) => xyz(lo, la));
      const C = [(X[0][0] + X[1][0] + X[2][0]) / 3, (X[0][1] + X[1][1] + X[2][1]) / 3, (X[0][2] + X[1][2] + X[2][2]) / 3];
      const P = X.map((p) => nudge(p, C, 0.01));
      for (let i = 0; i < 3; i++) segs.push(...pathSegs(slerpPath(P[i], P[(i + 1) % 3], 1.5)));
    }
    globe.addLines(PREFIX + "icosa", segs, { color: "rgba(184,82,23,.7)", width: 1.5 });
  };

  const drawPentagons = () => {
    const r = Math.min(level(), GLOBAL_MAX);
    const segs = [];
    for (const p of h3.getPentagons(r)) segs.push(...ringSegs(boundaryLonLat(p), r <= 1 ? 0.8 : 0.3));
    globe.addLines(PREFIX + "pentagons", segs, { color: WARN, width: 2.5 });
  };

  const level = () => (params.closeUp ? params.res : Math.min(params.res, GLOBAL_MAX));
  const gridRes = () => Math.min(level(), params.closeUp ? 3 : GLOBAL_MAX);

  const ringCache = new Map();
  const ringsAt = (r) => { if (!ringCache.has(r)) ringCache.set(r, cellsAt(r).map((c) => ({ c, ring: boundaryLonLat(c) }))); return ringCache.get(r); };

  const syncGrid = () => {
    const r = gridRes();
    const key = r + "|" + params.colourBy;
    if (key === gridKey) return;
    gridKey = key;
    globe.remove(PREFIX + "fill");
    globe.remove(PREFIX + "grid-ov");
    if (params.colourBy !== "none") {
      const groups = new Map();
      const fillRes = params.colourBy === "digit" ? r : Math.min(r, 3);
      for (const { c, ring } of ringsAt(fillRes)) {
        const fa = r <= 1 ? 0.34 : r === 2 ? 0.3 : r === 3 ? 0.24 : 0.2;
        const d = params.colourBy === "digit" && r > 0 ? h3.getIndexDigit(c, r) : -1;
        const colour = d >= 0 ? rgba(...DIGIT_RGB[d], fa * (d === 6 ? 0.7 : 1)) : baseColour(h3.getBaseCellNumber(c), fa);
        if (!groups.has(colour)) groups.set(colour, []);
        groups.get(colour).push(ring);
      }
      globe.addCanvasOverlay(PREFIX + "fill", (g) => {
        for (const [colour, rings] of groups) {
          g.fillStyle = colour;
          for (let i = 0; i < rings.length; i += 1500) { g.beginPath(); for (const ring of rings.slice(i, i + 1500)) ringToCanvas(g, ring); g.fill(); }
        }
      });
    }
    if (r <= LINE_MAX) {
      if (fillKey !== String(r)) { fillKey = String(r); globe.addLines(PREFIX + "grid", uniqueEdges(cellsAt(r), 0.75), { color: "rgba(26,25,23,.7)", width: 1.25 }); }
      return;
    }
    fillKey = "";
    globe.remove(PREFIX + "grid");
    const rings = ringsAt(r);
    globe.addCanvasOverlay(PREFIX + "grid-ov", (g) => {
      g.strokeStyle = rgba(26,25,23, r === 2 ? 0.55 : r === 3 ? 0.4 : 0.3);
      g.lineWidth = r === 2 ? 2.2 : r === 3 ? 1.5 : 1;
      g.lineJoin = "round";
      for (let i = 0; i < rings.length; i += 1500) { g.beginPath(); for (const { ring } of rings.slice(i, i + 1500)) strokeRing(g, ring); g.stroke(); }
    });
  };

  const point3 = (p) => [...morph(p[0], p[1], t, [0, 0, 0])];
  const placeCellLabel = () => globe.setLabel3D(PREFIX + "cell-label", { point: point3(labelAnchor(picked)), away: point3(centreLonLat(picked)) });

  const scaled = (ring, c, u) => ring.map((v) => {
    const A = xyz(c[0], c[1]), B = xyz(v[0], v[1]);
    return ll([A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u]);
  });

  const drawPicked = () => {
    const [lon, lat] = params.point;
    picked = cellOf(lon, lat, level());
    const r = level();
    const step = r <= 1 ? 0.6 : r <= 3 ? 0.25 : 0.05;
    globe.addLines(PREFIX + "cell", ringSegs(boundaryLonLat(picked), step), { color: SIGNAL, width: 2.75 });
    globe.setLabel3D(PREFIX + "cell-label", { text: picked });
    placeCellLabel();
    drawChildren();
  };

  const drawChildren = () => {
    const r = level();
    if (!params.children || r >= 15 || !picked) { globe.remove(PREFIX + "kids"); globe.remove(PREFIX + "rot"); globe.setLabel3D(PREFIX + "rot-label", { text: "" }); return; }
    const c = centreLonLat(picked);
    const kids = h3.cellToChildren(picked, r + 1);
    const step = r <= 1 ? 0.4 : r <= 3 ? 0.15 : 0.03;
    const segs = [];
    for (const k of kids) segs.push(...ringSegs(scaled(boundaryLonLat(k), c, bloomU), step));
    globe.addLines(PREFIX + "kids", segs, { color: "rgba(29,99,168,.85)", width: 1.5 });
    const pv = boundaryLonLat(picked);
    const centreKid = h3.cellToCenterChild(picked, r + 1);
    const a0 = bearing(c, pv[0]);
    const kb = boundaryLonLat(centreKid).map((v) => bearing(c, v));
    let b0 = kb[0], best = Infinity;
    for (const b of kb) { let d = (((b - a0) % 360) + 540) % 360 - 180; if (Math.abs(d) < Math.abs(best)) { best = d; b0 = a0 + d; } }
    const rad = arcDeg(c, pv[0]);
    const rk = rad / Math.sqrt(7);
    const arc = [];
    for (let i = 0; i <= 16; i++) arc.push(destination(c, a0 + ((b0 - a0) * i) / 16, rk * 0.75));
    const rays = [[c, destination(c, a0, rad)], [c, destination(c, b0, rk)]];
    const rsegs = [...pathSegs(arc), ...rays.flatMap(([p, q]) => pathSegs(slerpPath(p, q, step)))];
    if (bloomU >= 1) {
      globe.addLines(PREFIX + "rot", rsegs, { color: BRASS, width: 1.75 });
      globe.setLabel3D(PREFIX + "rot-label", { point: point3(arc[16]), text: `${ROTATION_DEG.toFixed(1)}°` });
    } else { globe.remove(PREFIX + "rot"); globe.setLabel3D(PREFIX + "rot-label", { text: "" }); }
  };

  const startBloom = () => {
    if (bloom) bloom.cancel();
    if (!booted || ctx.reducedMotion || !params.children) { bloomU = 1; drawChildren(); return; }
    bloom = ctx.anim.tween({ from: 0.05, to: 1, duration: 300, ease: ctx.anim.ease.out, onUpdate: (u) => { bloomU = u; drawChildren(); }, onDone: () => { bloom = null; bloomU = 1; drawChildren(); } });
  };

  const panel = ctx.stage.element("div", "h3-panel");
  panel.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:auto;height:auto;padding:10px 12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;display:none;";
  const pTitle = document.createElement("div");
  pTitle.style.cssText = `font:600 12px/16px ${FONT_UI};color:${INK};margin-bottom:6px;`;
  const pCanvas = document.createElement("canvas");
  const pCap = document.createElement("div");
  pCap.style.cssText = `font:500 11px/15px ${FONT_MONO};color:${INK2};margin-top:6px;max-width:230px;`;
  panel.append(pTitle, pCanvas, pCap);

  const drawPanel = () => {
    panel.style.display = params.closeUp ? "" : "none";
    const covered = params.closeUp && globe.width < 640;
    globe.setLabel3D(PREFIX + "cell-label", { visible: !covered });
    globe.setLabel3D(PREFIX + "rot-label", { visible: !covered });
    if (!params.closeUp || !picked) return;
    const Wp = 230, Hp = 230;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pCanvas.width = Wp * dpr; pCanvas.height = Hp * dpr;
    pCanvas.style.width = Wp + "px"; pCanvas.style.height = Hp + "px";
    const g = pCanvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, Wp, Hp);
    const c = centreLonLat(picked);
    const cosL = Math.cos(c[1] * DEG);
    const ring = boundaryLonLat(picked);
    const rad = Math.max(...ring.map((v) => Math.hypot((((v[0] - c[0] + 540) % 360) - 180) * cosL, v[1] - c[1])));
    const s = (Wp / 2 - 14) / (rad * 2.1);
    const P = (v) => [Wp / 2 + (((v[0] - c[0] + 540) % 360) - 180) * cosL * s, Hp / 2 - (v[1] - c[1]) * s];
    const poly = (r) => { g.beginPath(); r.forEach((v, i) => { const q = P(v); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.closePath(); };
    for (const n of h3.gridDisk(picked, 1)) { if (n === picked) continue; poly(boundaryLonLat(n)); g.strokeStyle = "rgba(26,25,23,.25)"; g.lineWidth = 1; g.stroke(); }
    const r = h3.getResolution(picked);
    if (r < 15) {
      const kids = h3.cellToChildren(picked, r + 1);
      kids.forEach((k) => { poly(boundaryLonLat(k)); g.fillStyle = DIGIT_PANEL[h3.getIndexDigit(k, r + 1)]; g.fill(); g.strokeStyle = "rgba(29,99,168,.8)"; g.lineWidth = 1; g.stroke(); });
      g.font = `500 10px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = INK;
      kids.forEach((k) => { const q = P(centreLonLat(k)); g.fillText(String(h3.getIndexDigit(k, r + 1)), q[0], q[1]); });
    }
    poly(ring); g.strokeStyle = SIGNAL; g.lineWidth = 2.25; g.stroke();
    pTitle.textContent = r < 15 ? `Resolution ${r} cell and its 7 children` : "Resolution 15, the finest";
    const area = h3.cellArea(picked, "m2");
    const across = Math.sqrt(area);
    pCap.textContent = `${picked} · about ${across >= 1000 ? (across / 1000).toFixed(1) + " km" : across.toFixed(across < 10 ? 1 : 0) + " m"} across. The globe shows resolution ${gridRes()}.`;
  };

  const fmtArea = (km2) => { const m2 = km2 * 1e6; return km2 >= 1 ? `${km2 >= 100 ? Math.round(km2).toLocaleString("en-US") : km2.toFixed(2)} km²` : `${m2 >= 100 ? Math.round(m2).toLocaleString("en-US") : m2.toPrecision(3)} m²`; };

  const readouts = () => {
    if (!picked) return;
    const i = info(picked);
    ctx.readout.setMany({ id: i.id, res: String(i.res), area: fmtArea(i.area), pent: i.pentagon ? "yes" : "no", count: i.count.toLocaleString("en-US"), base: String(i.base) });
  };

  const netPoints = () => {
    const pts = [];
    for (const tri of faces) {
      const X = tri.map(([lo, la]) => xyz(lo, la));
      const C = [(X[0][0] + X[1][0] + X[2][0]) / 3, (X[0][1] + X[1][1] + X[2][1]) / 3, (X[0][2] + X[1][2] + X[2][2]) / 3];
      const cl = ll(C);
      const f = morph.face(cl[0], cl[1]);
      for (const p of X) { const q = nudge(p, C, 0.02); pts.push([...morph(q[0], q[1], t, [0, 0, 0], f)]); }
    }
    return pts;
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) { oriented = false; return; }
    if (t > 0.5 && !oriented) { oriented = true; globe.camera.lookAt(0, 0, null, { duration: booted && !ctx.reducedMotion ? 600 : 0 }); }
    if (t <= 0.5) oriented = false;
    const f = globe.camera.fit(netPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
    const w = smoothstep(0, 0.2, t);
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0] * w, f.pan[1] * w);
  };

  const closeUpCamera = (duration) => {
    if (ctx.side !== "A" || t !== 0) return;
    const [lon, lat] = params.point;
    globe.camera.lookAt(lon, lat, params.closeUp ? 1.45 : meta.view.dist, { duration: ctx.reducedMotion ? 0 : duration });
  };

  drawIcosa();
  syncGrid();
  drawPentagons();
  drawPicked();
  readouts();
  drawPanel();
  if (params.closeUp) closeUpCamera(0);

  if (ctx.transport) ctx.transport.onScrub((v) => {
    t = v;
    globe.setMorphT(t);
    if (picked) placeCellLabel();
    drawChildren();
    frameCamera();
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (keys.length === 1 && (keys[0] === "parent" || keys[0] === "child")) {
        const next = clamp(level() + (keys[0] === "child" ? 1 : -1), 0, 15);
        Promise.resolve().then(() => { if (next > GLOBAL_MAX && !params.closeUp) ctx.controls.set("closeUp", true); ctx.controls.set("res", next); });
        return;
      }
      if (keys.includes("res") && params.res > GLOBAL_MAX && !params.closeUp && ctx.side === "A") { Promise.resolve().then(() => ctx.controls.set("closeUp", true)); }
      if (keys.includes("closeUp") && !params.closeUp && params.res > GLOBAL_MAX && ctx.side === "A") { Promise.resolve().then(() => ctx.controls.set("res", GLOBAL_MAX)); return; }
      syncGrid();
      if (keys.includes("res") || keys.includes("closeUp")) drawPentagons();
      drawPicked();
      if (keys.length <= 2 && keys.some((k) => k === "res" || k === "point" || k === "children")) startBloom();
      readouts();
      drawPanel();
      if (keys.includes("closeUp") || (keys.includes("point") && params.closeUp)) closeUpCamera(650);
      if (keys.length > 3 && t > 0) frameCamera();
    },
    hover(lon, lat) {
      const c = cellOf(lon, lat, level());
      const i = info(c);
      const lines = [`${c}`, `base cell ${i.base}`];
      if (i.pentagon) lines.push("pentagon: five sides, an icosahedron corner");
      return lines;
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      drawPanel();
      if (t > 0) frameCamera();
    },
    unmount() {
      if (bloom) bloom.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      panel.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
