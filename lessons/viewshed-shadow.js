import { forward as utmForward, inverse as utmInverse } from "@/core/utm.js";
import { land as LAND_STOPS } from "@/core/palette.js";
import { clamp, DEG, RAD, rampOklab, hexToRgb } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const EYE = "#ffffff";
const SUN = "#e3a20b";
const DEM = "dem_alps_512.i16";
const ZONE = 32;
export const CHAMONIX = [6.8694, 45.9237];
export const BREVENT = [6.8394, 45.9342];
export const NW_LIGHT = { az: 315, el: 45 };

const U_FINITE = 99.5;
export function distanceOf(u) {
  if (u <= 0) return 0;
  if (u >= 100) return Infinity;
  return Math.pow(10, 1 + (5 * Math.min(u, U_FINITE)) / U_FINITE);
}
export function sliderOf(d) {
  if (d <= 0) return 0;
  if (!isFinite(d)) return 100;
  return clamp(((Math.log10(d) - 1) * U_FINITE) / 5, 0, U_FINITE);
}
export function formatDistance(d) {
  if (!isFinite(d)) return "∞";
  if (d < 1) return "0 m";
  if (d < 1000) return `${Math.round(d)} m`;
  if (d < 100000) return `${(d / 1000).toFixed(1)} km`;
  return `${Math.round(d / 1000).toLocaleString("en-US")} km`;
}

export function terrainFrom(grid) {
  const n = grid.width * grid.height, z = new Float32Array(n);
  for (let i = 0; i < n; i++) z[i] = grid.data[i] * (grid.scale ?? 1);
  return { z, w: grid.width, h: grid.height, cell: grid.meta?.step_m ?? 90 };
}

export function heightAt(T, col, row) {
  const c = clamp(col, 0, T.w - 1), r = clamp(row, 0, T.h - 1);
  const c0 = Math.min(Math.floor(c), T.w - 2), r0 = Math.min(Math.floor(r), T.h - 2), fx = c - c0, fy = r - r0, z = T.z, w = T.w;
  const a = z[r0 * w + c0], b = z[r0 * w + c0 + 1], d = z[(r0 + 1) * w + c0], e = z[(r0 + 1) * w + c0 + 1];
  return (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
}

export function sunVector(az, el) {
  return { e: Math.sin(az * DEG) * Math.cos(el * DEG), n: Math.cos(az * DEG) * Math.cos(el * DEG), u: Math.sin(el * DEG) };
}

export function eyePosition(T, spot, height, distance, az, el) {
  if (!isFinite(distance)) return null;
  const s = sunVector(az, el);
  return { x: spot.col + (distance * s.e) / T.cell, y: spot.row - (distance * s.n) / T.cell, z: heightAt(T, spot.col, spot.row) + height + distance * s.u };
}

export function viewshed(T, eye, out = new Uint8Array(T.w * T.h), K = new Float32Array(T.w * T.h)) {
  const { z, w, h, cell } = T;
  const ex = Math.round(eye.x), ey = Math.round(eye.y), ez = eye.z;
  out.fill(0);
  K.fill(-Infinity);
  const Kat = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -Infinity : K[y * w + x]);
  const interp = (x, yf) => {
    const y0 = Math.floor(yf), f = yf - y0;
    const a = Kat(x, y0);
    if (f < 1e-9) return a;
    const b = Kat(x, y0 + 1);
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    return a + (b - a) * f;
  };
  const interpY = (y, xf) => {
    const x0 = Math.floor(xf), f = xf - x0;
    const a = Kat(x0, y);
    if (f < 1e-9) return a;
    const b = Kat(x0 + 1, y);
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    return a + (b - a) * f;
  };
  const visit = (x, y) => {
    const dx = x - ex, dy = y - ey, adx = Math.abs(dx), ady = Math.abs(dy);
    const i = y * w + x;
    const s = (z[i] - ez) / (cell * Math.sqrt(dx * dx + dy * dy));
    let hz;
    if (adx >= ady) hz = interp(x - Math.sign(dx), ey + (dy * (adx - 1)) / adx);
    else hz = interpY(y - Math.sign(dy), ex + (dx * (ady - 1)) / ady);
    out[i] = s >= hz ? 1 : 0;
    K[i] = s > hz ? s : hz;
  };
  const inside = ex >= 0 && ey >= 0 && ex < w && ey < h;
  if (inside) out[ey * w + ex] = 1;
  const ox = ex < 0 ? -ex : ex > w - 1 ? ex - (w - 1) : 0, oy = ey < 0 ? -ey : ey > h - 1 ? ey - (h - 1) : 0;
  const rmin = Math.max(1, ox, oy), rmax = Math.max(Math.abs(ex), Math.abs(ex - (w - 1)), Math.abs(ey), Math.abs(ey - (h - 1)));
  for (let r = rmin; r <= rmax; r++) {
    const xa = Math.max(0, ex - r), xb = Math.min(w - 1, ex + r);
    for (const y of [ey - r, ey + r]) if (y >= 0 && y < h) for (let x = xa; x <= xb; x++) visit(x, y);
    const ya = Math.max(0, ey - r + 1), yb = Math.min(h - 1, ey + r - 1);
    for (const x of [ex - r, ex + r]) if (x >= 0 && x < w) for (let y = ya; y <= yb; y++) visit(x, y);
  }
  return out;
}

export function shadowMask(T, az, el, out = new Uint8Array(T.w * T.h), K = new Float32Array(T.w * T.h)) {
  const { z, w, h, cell } = T;
  if (el >= 89.999) { out.fill(1); return out; }
  const tanE = Math.tan(el * DEG);
  const sx = Math.sin(az * DEG), sy = -Math.cos(az * DEG);
  const xMajor = Math.abs(sx) >= Math.abs(sy);
  const sgn = xMajor ? Math.sign(sx) : Math.sign(sy);
  const t = xMajor ? sy / Math.abs(sx) : sx / Math.abs(sy);
  const drop = cell * Math.sqrt(1 + t * t) * tanE;
  const Kat = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -Infinity : K[y * w + x]);
  const lines = xMajor ? w : h, across = xMajor ? h : w;
  for (let k = 0; k < lines; k++) {
    const a = sgn > 0 ? lines - 1 - k : k, pa = a + sgn;
    for (let b = 0; b < across; b++) {
      const pb = b + t, b0 = Math.floor(pb), f = pb - b0;
      let ka, kb;
      if (xMajor) { ka = Kat(pa, b0); kb = f < 1e-9 ? ka : Kat(pa, b0 + 1); }
      else { ka = Kat(b0, pa); kb = f < 1e-9 ? ka : Kat(b0 + 1, pa); }
      const kp = ka === -Infinity ? kb : kb === -Infinity ? ka : ka + (kb - ka) * f;
      const hs = kp - drop;
      const i = xMajor ? b * w + a : a * w + b;
      out[i] = z[i] >= hs ? 1 : 0;
      K[i] = z[i] > hs ? z[i] : hs;
    }
  }
  return out;
}

export function maskStats(T, mask, spot) {
  let n = 0, far = 0;
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) {
    if (!mask[y * T.w + x]) continue;
    n++;
    const d = (x - spot.col) * (x - spot.col) + (y - spot.row) * (y - spot.row);
    if (d > far) far = d;
  }
  return { cells: n, area: (n * T.cell * T.cell) / 1e6, pct: (100 * n) / (T.w * T.h), far: (Math.sqrt(far) * T.cell) / 1000 };
}

function sunStep(az) {
  const sx = Math.sin(az * DEG), sy = -Math.cos(az * DEG), m = Math.max(Math.abs(sx), Math.abs(sy));
  return [sx / m, sy / m];
}

export function shadowLength(T, lit, col, row, az) {
  const at = (c, r) => { const x = Math.round(c), y = Math.round(r); return x < 0 || y < 0 || x >= T.w || y >= T.h ? -1 : lit[y * T.w + x]; };
  if (at(col, row) !== 0) return 0;
  const [dx, dy] = sunStep(az), step = T.cell * Math.hypot(dx, dy);
  let a = 1;
  while (at(col + a * dx, row + a * dy) === 0) a++;
  let b = 1;
  while (at(col - b * dx, row - b * dy) === 0) b++;
  return (a + b) * step;
}

export function horizonTowardSun(T, col, row, az, height = 0) {
  const [dx, dy] = sunStep(az), step = T.cell * Math.hypot(dx, dy), z0 = heightAt(T, col, row) + height;
  let best = -90;
  for (let k = 1; ; k++) {
    const c = col + k * dx, r = row + k * dy;
    if (c < 0 || r < 0 || c > T.w - 1 || r > T.h - 1) break;
    const a = Math.atan2(heightAt(T, c, r) - z0, k * step) * RAD;
    if (a > best) best = a;
  }
  return best;
}

export const WEDGES = [
  { name: "N", az: 0, f: [0, 1] },
  { name: "E", az: 90, f: [1, 0] },
  { name: "S", az: 180, f: [0, -1] },
  { name: "W", az: 270, f: [-1, 0] },
];

export function wedgeOf(de, dn) {
  if (Math.abs(dn) >= Math.abs(de)) return dn >= 0 ? 0 : 2;
  return de > 0 ? 1 : 3;
}

export function gnomonic(de, dn, dz, k = wedgeOf(de, dn)) {
  const [fe, fn] = WEDGES[k].f;
  const along = de * fe + dn * fn, side = de * fn - dn * fe;
  return along > 0 ? [side / along, dz / along, k] : null;
}

export function wedgeColumn(T, view, k, u, { stepCells = 0.7, onSample = null } = {}) {
  const [fe, fn] = WEDGES[k].f;
  const ge = fe + u * fn, gn = fn - u * fe;
  const pc = ge / T.cell, pr = -gn / T.cell;
  let a0 = T.cell * 0.5, a1 = Infinity;
  for (const [p, d, lo, hi] of [[view.x, pc, 0, T.w - 1], [view.y, pr, 0, T.h - 1]]) {
    if (Math.abs(d) < 1e-15) { if (p < lo || p > hi) return { v: -Infinity, a: NaN }; continue; }
    let ta = (lo - p) / d, tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    a0 = Math.max(a0, ta); a1 = Math.min(a1, tb);
  }
  let best = -Infinity, bestA = NaN;
  if (!(a1 > a0)) return { v: best, a: bestA };
  const da = (stepCells * T.cell) / Math.hypot(ge, gn);
  for (let a = a0; a <= a1; a += da) {
    const c = view.x + a * pc, r = view.y + a * pr;
    const v = (heightAt(T, c, r) - view.z) / a;
    if (v > best) {
      if (onSample) onSample(a, v, best, c, r);
      best = v; bestA = a;
    }
  }
  return { v: best, a: bestA, ge, gn };
}

export function skylineMaxAngle(T, view, perWedge = 90) {
  let best = -90;
  for (let k = 0; k < 4; k++) for (let i = 0; i < perWedge; i++) {
    const u = ((i + 0.5) / perWedge) * 2 - 1;
    const s = wedgeColumn(T, view, k, u);
    if (s.v > -Infinity) best = Math.max(best, Math.atan(s.v / Math.sqrt(1 + u * u)) * RAD);
  }
  return best;
}

const RAMP_LUT = (() => {
  const out = [];
  for (let m = 0; m <= 6000; m += 20) out.push(rampOklab(LAND_STOPS, m));
  return out;
})();
const rampAt = (m) => RAMP_LUT[clamp(Math.round(m / 20), 0, RAMP_LUT.length - 1)];

export function shadeField(T, az, el, out = new Float32Array(T.w * T.h)) {
  const L = sunVector(az, el), { z, w, h, cell } = T;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xe = Math.min(w - 1, x + 1), xw = Math.max(0, x - 1), yn = Math.max(0, y - 1), ys = Math.min(h - 1, y + 1);
    const ge = (z[y * w + xe] - z[y * w + xw]) / ((xe - xw) * cell), gn = (z[yn * w + x] - z[ys * w + x]) / ((ys - yn) * cell);
    const d = (-ge * L.e - gn * L.n + L.u) / Math.sqrt(ge * ge + gn * gn + 1);
    out[y * w + x] = Math.max(0, d);
  }
  return out;
}

export const meta = {
  id: "viewshed-shadow",
  title: "What an eye can see",
  track: 7,
  order: 1,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Project the terrain through the eye onto a plane. That is the gnomonic map, the pinhole camera. Add ground nearest first and keep the horizon. Ground that rises above the horizon is visible. Move the eye far away toward the Sun and the same test gives shadows.",
  deeper: [
    "A cast shadow is a viewshed with the eye at infinity.",
    "In each wedge, higher in the image means higher in the view.",
    "Only cells fewer rows plus columns away can hide a cell.",
    "The gnomonic keeps straight lines straight.",
  ],
  keywords: ["viewshed", "line of sight", "shadow", "horizon", "gnomonic", "DEM", "terrain"],
  controls: [
    { key: "eye", type: "point", label: "Eye on the tile", default: BREVENT },
    { key: "height", type: "range", label: "Eye height above ground", min: 0, max: 200, step: 1, default: 2, unit: "m", ticks: [0, 50, 100, 150, 200] },
    { key: "distance", type: "range", label: "Eye distance toward the Sun", min: 0, max: 100, step: 0.5, default: 0, unit: "", format: (u) => formatDistance(distanceOf(u)), ticks: [0, +sliderOf(1000).toFixed(1), +sliderOf(10000).toFixed(1), +sliderOf(100000).toFixed(1), 100], tickFormat: (u) => (u >= 100 ? "∞" : u <= 0 ? "0" : formatDistance(distanceOf(u)).replace(".0", "")) },
    { key: "sunAz", type: "range", label: "Sun azimuth", min: 0, max: 359, step: 1, default: 135, unit: "°", ticks: [0, 90, 180, 270] },
    { key: "sunEl", type: "range", label: "Sun elevation", min: 2, max: 90, step: 1, default: 35, unit: "°", ticks: [2, 45, 90] },
    { key: "wedges", type: "toggle", label: "Four wedges", default: true, shortcut: "w" },
    { type: "legend", label: "Key", items: [
      { color: SIGNAL, label: "Visible from the eye, or lit by the Sun" },
      { color: "#262d40", label: "Hidden, or in shadow" },
      { color: BRASS, line: true, label: "Skyline" },
      { color: BRASS, dash: true, label: "Wedge edges" },
      { color: EYE, label: "Eye (drag it)" },
    ] },
  ],
  readouts: [
    { key: "area", label: "Visible area", digits: 1, unit: "km²", hero: true },
    { key: "pct", label: "Share of the tile", digits: 1, unit: "%" },
    { key: "far", label: "Max visible distance", digits: 1, unit: "km" },
    { key: "sky", label: "Skyline max angle", digits: 1, unit: "°" },
    { key: "shadow", label: "Shadow length at probe", digits: 0, unit: "m" },
  ],
  transport: null,
  compare: null,
  view: { lon: -150, lat: 38, dist: 3 },
  data: [DEM],
};

const PREFIX = meta.id + ":";
const HW = 1;
const EX = 1.5;
const GAP = 16;
const LMAX = 1.35;
const FLOOD_MS = 400;
const DRAW_MS = 520;

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const grid = ctx.data.get(DEM) || (await ctx.data.load(DEM));
  const T = terrainFrom(grid);
  const { w, h, cell } = T;
  const G = grid.meta;
  const xmin = G.bounds.xmin, ymax = G.bounds.ymax;
  let params = { ...ctx.params };
  const n = w * h;
  const mask = new Uint8Array(n), lit = new Uint8Array(n), Kbuf = new Float32Array(n);
  const shade = new Float32Array(n), shadeSun = new Float32Array(n);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) { if (T.z[i] < zmin) zmin = T.z[i]; if (T.z[i] > zmax) zmax = T.z[i]; }
  const ZMID = (zmin + zmax) / 2;
  const S = (2 * HW) / w;
  const KY = (S / cell) * EX;
  const yOf = (m) => (m - ZMID) * KY;
  const BASE_Y = yOf(zmin) - 0.06;

  const centreLL = G.centre_lonlat;
  const c0 = utmForward(centreLL[0], centreLL[1], ZONE, false), c1 = utmForward(centreLL[0], centreLL[1] + 0.01, ZONE, false);
  const CONV = Math.atan2(c1.E - c0.E, c1.N - c0.N) * RAD;
  const gridAz = (trueAz) => trueAz + CONV;

  const llToCell = (lon, lat) => { const p = utmForward(lon, lat, ZONE, false); return { col: (p.E - xmin) / cell - 0.5, row: (ymax - p.N) / cell - 0.5 }; };
  const cellToLL = (col, row) => { const g = utmInverse(xmin + (col + 0.5) * cell, ymax - (row + 0.5) * cell, ZONE, false); return [g.lon, g.lat]; };
  const model = (col, row, m = heightAt(T, col, row), lift = 0) => [(col + 0.5 - w / 2) * S, yOf(m) + lift, (row + 0.5 - h / 2) * S];
  const toCell = (p) => ({ col: p[0] / S + w / 2 - 0.5, row: p[2] / S + h / 2 - 0.5 });

  let spot = null, eye = null, view = null, sunMode = false, distance = 0;
  let floodR = Infinity, floodTw = null, drawP = 1, drawTw = null, sunTw = null;
  let hoverCell = null, probeCell = null, dragging = null, booted = false, stats = null, skyMax = 0;
  let skyline = [];
  let lastUpdate = 0, settle = 0;
  let STRIP_H = 176;

  const tex = globe.addPanel(PREFIX + "terrain", { size: 512, opacity: 1 });
  const tmesh = globe.extra.get(PREFIX + "terrain");
  const geom = tmesh.geometry;
  const Attr = geom.attributes.position.constructor;
  const NV = 256;
  const pos = new Float32Array(NV * NV * 3), uv = new Float32Array(NV * NV * 2), index = [];
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
    const col = (i * (w - 1)) / (NV - 1), row = (j * (h - 1)) / (NV - 1), k = j * NV + i;
    const p = model(col, row);
    pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    uv[k * 2] = (col + 0.5) / w; uv[k * 2 + 1] = 1 - (row + 0.5) / h;
  }
  for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NV - 1; i++) {
    const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  geom.setAttribute("position", new Attr(pos, 3));
  geom.setAttribute("uv", new Attr(uv, 2));
  geom.setIndex(index);
  geom.computeBoundingSphere();
  tex.tex.anisotropy = 8;

  const walls = [[], []];
  const edge = (k) => { const t = (k * (w - 1)) / (NV - 1); return t; };
  for (let k = 0; k < NV - 1; k++) {
    const a = edge(k), b = edge(k + 1);
    for (const [ca, ra, cb, rb, side] of [[a, 0, b, 0, 0], [a, h - 1, b, h - 1, 0], [0, a, 0, b, 1], [w - 1, a, w - 1, b, 1]]) {
      const p = model(ca, ra), q = model(cb, rb);
      const pb = [p[0], BASE_Y, p[2]], qb = [q[0], BASE_Y, q[2]];
      walls[side].push(...p, ...q, ...qb, ...p, ...qb, ...pb);
    }
  }
  globe.addTriangles(PREFIX + "wallNS", Float32Array.from(walls[0]), { color: "#ece7dd", lit: false, order: 1 });
  globe.addTriangles(PREFIX + "wallEW", Float32Array.from(walls[1]), { color: "#ffffff", lit: false, order: 1 });
  globe.addSegments3D(PREFIX + "rim", [[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]].map((c, i, arr) => { const d = arr[(i + 1) % 4]; return [[(c[0] + 0.5 - w / 2) * S, BASE_Y, (c[1] + 0.5 - h / 2) * S], [(d[0] + 0.5 - w / 2) * S, BASE_Y, (d[1] + 0.5 - h / 2) * S]]; }), { color: "rgba(107,102,94,.6)", width: 1 });

  const empty = [[[0, 0, 0], [0, 0, 0]]];
  globe.addSegments3D(PREFIX + "wedgeEdges", empty, { color: BRASS, width: 1.4, dash: [5, 4], depth: true, opacity: 0.85 });
  globe.addSegments3D(PREFIX + "skyline", empty, { color: BRASS, width: 2.4, depth: false, order: 4 });
  globe.addSegments3D(PREFIX + "stalk", empty, { color: "rgba(255,255,255,.85)", width: 1.6, depth: false, order: 4 });
  globe.addSegments3D(PREFIX + "toSun", empty, { color: "rgba(227,162,11,.7)", width: 1.2, dash: [6, 5], depth: false, order: 4 });
  globe.addSegments3D(PREFIX + "rays", empty, { color: "rgba(227,162,11,.55)", width: 1.1, depth: true, order: 4 });
  globe.addSegments3D(PREFIX + "los", empty, { color: SIGNAL, width: 2, depth: false, order: 5 });
  globe.addSegments3D(PREFIX + "losHidden", empty, { color: "rgba(63,60,55,.6)", width: 1.4, dash: [4, 4], depth: false, order: 5 });
  globe.addPoints3D(PREFIX + "spot", [[0, 0, 0]], { color: SIGNAL, size: 9, depth: false, order: 6 });
  globe.addPoints3D(PREFIX + "eye", [[0, 0, 0]], { color: EYE, size: 15, depth: false, order: 7 });
  globe.addPoints3D(PREFIX + "sun", [[0, 0, 0]], { color: SUN, size: 26, depth: false, order: 7 });
  globe.addPoints3D(PREFIX + "block", [[0, 0, 0]], { color: BRASS, size: 9, depth: false, order: 7 });
  for (const id of ["los", "losHidden", "block", "sun", "rays", "toSun"]) globe.setLayer(PREFIX + id, false);

  const savedLayers = {};
  for (const k of ["surface", "coast", "graticule", "atmosphere", "labels"]) { savedLayers[k] = globe.layers[k]; globe.setLayer(k, false); }

  const ownPick = (x, y) => {
    const { origin: o, dir: d } = globe.ray(x, y);
    let t0 = 0, t1 = 100;
    for (const [oo, dd, lo, hi] of [[o[0], d[0], -HW, HW], [o[1], d[1], yOf(zmin) - 0.01, yOf(zmax) + 0.01], [o[2], d[2], -HW, HW]]) {
      if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return null; continue; }
      let a = (lo - oo) / dd, b = (hi - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t1 <= t0) return null;
    const above = (t) => { const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; const c = toCell(p); return p[1] - yOf(heightAt(T, c.col, c.row)); };
    const dt = S * 0.4;
    let prev = t0, fa = above(t0);
    if (fa < 0) return null;
    for (let t = t0 + dt; t <= t1 + dt; t += dt) {
      const tt = Math.min(t, t1), f = above(tt);
      if (f < 0) {
        let a = prev, b = tt;
        for (let k = 0; k < 18; k++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; }
        const p = [o[0] + d[0] * b, o[1] + d[1] * b, o[2] + d[2] * b];
        const c = toCell(p);
        if (c.col < -0.5 || c.row < -0.5 || c.col > w - 0.5 || c.row > h - 0.5) return null;
        const [lon, lat] = cellToLL(c.col, c.row);
        return { lon, lat, col: c.col, row: c.row, point: p };
      }
      prev = tt;
      if (tt >= t1) break;
    }
    return null;
  };
  const ownProject = (lon, lat) => {
    const c = llToCell(lon, lat);
    const inTile = c.col >= -0.5 && c.row >= -0.5 && c.col <= w - 0.5 && c.row <= h - 0.5;
    const s = globe.projectPoint(model(c.col, c.row, heightAt(T, c.col, c.row), 0.004), false);
    return { x: s.x, y: s.y, visible: inTile && s.visible };
  };
  globe.pick = ownPick;
  globe.project = ownProject;

  const strip = ctx.stage.element("div", "vs-strip");
  const sc = document.createElement("canvas");
  sc.style.cssText = "width:100%;height:100%;display:block;";
  strip.append(sc);
  const pano = document.createElement("canvas");
  const dpr = ctx.stage.dpr;

  const lightFor = () => (sunMode ? { az: gridAz(params.sunAz), el: params.sunEl } : NW_LIGHT);
  const base = new Uint8ClampedArray(n * 3);
  const SIG = hexToRgb(SIGNAL), DARK = hexToRgb("#faf8f3");
  const rebuildBase = () => {
    const L = lightFor();
    shadeField(T, L.az, L.el, shade);
    const flat = Math.sin(L.el * DEG);
    for (let i = 0; i < n; i++) {
      const c = rampAt(T.z[i]);
      const k = clamp(0.42 + 0.7 * shade[i] / Math.max(0.35, flat) * 0.75, 0.25, 1.25);
      base[i * 3] = c[0] * k; base[i * 3 + 1] = c[1] * k; base[i * 3 + 2] = c[2] * k;
    }
  };
  const imgData = new ImageData(w, h);
  const paint = () => {
    const px = imgData.data, m = sunMode ? lit : mask;
    const R2 = floodR * floodR, front = (floodR + 6) * (floodR + 6), sc0 = spot.col, sr0 = spot.row;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4, b = i * 3;
      const d2 = (x - sc0) * (x - sc0) + (y - sr0) * (y - sr0);
      const on = m[i] && d2 <= R2;
      if (on) {
        const glow = d2 > R2 * 0.8 && d2 <= front && floodR < 2000 ? 0.3 : 0;
        const lum = (0.3 * base[b] + 0.59 * base[b + 1] + 0.11 * base[b + 2]) / 255;
        const k = (0.3 + 0.75 * lum + glow) * 0.78;
        px[o] = SIG[0] * k + base[b] * 0.22; px[o + 1] = SIG[1] * k + base[b + 1] * 0.22; px[o + 2] = SIG[2] * k + base[b + 2] * 0.22;
      } else {
        px[o] = base[b] * 0.36 + DARK[0] * 0.2; px[o + 1] = base[b + 1] * 0.36 + DARK[1] * 0.2; px[o + 2] = base[b + 2] * 0.38 + DARK[2] * 0.25;
      }
      px[o + 3] = 255;
    }
    tex.ctx.putImageData(imgData, 0, 0);
    tex.tex.needsUpdate = true;
    globe.invalidate();
  };

  const readSpot = () => {
    const c = llToCell(params.eye[0], params.eye[1]);
    spot = { col: clamp(c.col, 0, w - 1), row: clamp(c.row, 0, h - 1) };
  };
  const eyeLift = () => 0.035 + params.height * 0.0004;
  const sunDisplayDir = () => {
    const s = sunVector(gridAz(params.sunAz), params.sunEl);
    const v = [s.e, s.u * EX, -s.n];
    const l = Math.hypot(...v);
    return v.map((q) => q / l);
  };
  const eyeDisplay = () => {
    const g = model(spot.col, spot.row, undefined, eyeLift());
    if (distance <= 0) return { p: g, far: false };
    const dir = sunDisplayDir(), L = isFinite(distance) ? (distance * S) / cell : Infinity;
    const len = Math.min(L, LMAX);
    return { p: [g[0] + dir[0] * len, g[1] + dir[1] * len, g[2] + dir[2] * len], far: L > LMAX, ground: g };
  };

  const label = (name, p, text, color, dx = 12, dy = -18) => {
    const id = PREFIX + "label-" + name;
    globe.labelInsetBottom = ctx.stage.insetBottom + (params.wedges ? STRIP_H + GAP * 2 : 0);
    if (!p) { if (globe.labels3d.has(id)) globe.setLabel3D(id, { visible: false }); return; }
    if (!globe.labels3d.has(id)) globe.addLabel3D(id, p, text, { color, dx, dy });
    else globe.setLabel3D(id, { point: p, text, color, dx, dy, visible: true });
  };

  const drape = (c0, r0, c1, r1, steps, lift = 0.006) => {
    const segs = [];
    let prev = null;
    for (let k = 0; k <= steps; k++) {
      const c = c0 + ((c1 - c0) * k) / steps, r = r0 + ((r1 - r0) * k) / steps;
      if (c < 0 || r < 0 || c > w - 1 || r > h - 1) { prev = null; continue; }
      const p = model(c, r, undefined, lift);
      if (prev) segs.push([prev, p]);
      prev = p;
    }
    return segs;
  };

  const drawWedgeEdges = () => {
    const on = !!params.wedges && !sunMode;
    globe.setLayer(PREFIX + "wedgeEdges", on);
    if (!on) return;
    const vx = Math.round(view.x), vy = Math.round(view.y), L = w + h;
    const segs = [];
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) segs.push(...drape(vx, vy, vx + dx * L, vy + dy * L, 2 * L));
    globe.setSegments3D(PREFIX + "wedgeEdges", segs.length ? segs : empty);
  };

  const drawSkyline3D = () => {
    const on = !!params.wedges && skyline.length > 1;
    globe.setLayer(PREFIX + "skyline", on);
    if (!on) return;
    const segs = [];
    for (let i = 1; i < skyline.length; i++) {
      const a = skyline[i - 1], b = skyline[i];
      if (!a || !b || Math.hypot(a.col - b.col, a.row - b.row) > 4) continue;
      segs.push([model(a.col, a.row, undefined, 0.008), model(b.col, b.row, undefined, 0.008)]);
    }
    const shown = segs.slice(0, Math.ceil(segs.length * drawP));
    globe.setSegments3D(PREFIX + "skyline", shown.length ? shown : empty);
  };

  const groundHit = (from, dir, maxT) => {
    const dt = S * 0.5;
    for (let t = 0; t <= maxT; t += dt) {
      const p = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
      const c = toCell(p);
      if (c.col < 0 || c.row < 0 || c.col > w - 1 || c.row > h - 1) continue;
      if (p[1] <= yOf(heightAt(T, c.col, c.row))) return p;
    }
    return null;
  };

  const drawEye = () => {
    const e = eyeDisplay();
    const g = model(spot.col, spot.row, undefined, 0.003);
    globe.setPoints3D(PREFIX + "spot", [g]);
    globe.setLayer(PREFIX + "eye", !sunMode);
    globe.setLayer(PREFIX + "sun", sunMode);
    globe.setLayer(PREFIX + "rays", sunMode);
    if (!sunMode) {
      globe.setPoints3D(PREFIX + "eye", [e.p]);
      const g2 = model(spot.col, spot.row, undefined, eyeLift());
      globe.setSegments3D(PREFIX + "stalk", [[g, g2]]);
      globe.setLayer(PREFIX + "toSun", distance > 0);
      if (distance > 0) globe.setSegments3D(PREFIX + "toSun", [[g2, e.p]]);
      const txt = distance > 0 ? `eye ${formatDistance(distance)} toward the Sun${e.far ? ", out of the frame" : ""}` : `eye ${params.height} m above the ground`;
      label("eye", e.p, txt, EYE);
    } else {
      const dir = sunDisplayDir();
      const sunP = [dir[0] * LMAX * 1.25, dir[1] * LMAX * 1.25, dir[2] * LMAX * 1.25];
      globe.setPoints3D(PREFIX + "sun", [sunP]);
      const g2 = model(spot.col, spot.row, undefined, eyeLift());
      globe.setSegments3D(PREFIX + "stalk", [[g, g2]]);
      globe.setLayer(PREFIX + "toSun", false);
      const rays = [];
      for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
        const tc = ((i + 0.5) / 5) * (w - 1), tr = ((j + 0.5) / 5) * (h - 1);
        const tp = model(tc, tr);
        const start = [tp[0] + dir[0] * 0.9, tp[1] + dir[1] * 0.9, tp[2] + dir[2] * 0.9];
        const hit = groundHit(start, dir.map((q) => -q), 1.2) || tp;
        rays.push([start, hit]);
      }
      globe.setSegments3D(PREFIX + "rays", rays);
      label("eye", sunP, `Sun  az ${params.sunAz}°  el ${params.sunEl}°  eye at ∞`, SUN, 16, -10);
    }
  };

  const fitPoints = () => {
    const pts = [];
    for (const x of [-HW, HW]) for (const z of [-HW, HW]) pts.push([x, yOf(zmax), z], [x, BASE_Y, z]);
    if (!sunMode) pts.push(eyeDisplay().p);
    return pts;
  };
  const bottomInset = () => ctx.stage.insetBottom + (params.wedges ? STRIP_H + GAP * 2 : 0);
  const frameAll = (duration = 0) => {
    if (ctx.side !== "A") return;
    const f = globe.camera.fit(fitPoints(), { padding: 26, insetTop: 8, insetBottom: bottomInset(), minDist: 1.6, apply: false });
    if (duration > 0 && !ctx.reducedMotion) globe.camera.glideTo(f, { duration });
    else { globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]); }
  };

  const layout = () => {
    const W = ctx.stage.width;
    STRIP_H = Math.round(clamp((W - 2 * GAP - 52) / 4 / 1.9 + 52, 168, 300));
    strip.style.cssText = `position:absolute;inset:auto;left:${GAP}px;right:${GAP}px;bottom:${GAP + ctx.stage.insetBottom}px;width:auto;height:${STRIP_H}px;pointer-events:auto;z-index:3;display:${params.wedges ? "block" : "none"};`;
    const cw = Math.max(320, W - 2 * GAP);
    sc.width = Math.round(cw * dpr); sc.height = Math.round(STRIP_H * dpr);
  };

  const stripGeom = () => {
    const W = sc.width / dpr, pad = 14, top = 30, bottom = 22, gap = 10;
    const Wp = Math.floor((W - 2 * pad - 3 * gap) / 4), Hp = STRIP_H - top - bottom;
    return { W, pad, top, gap, Wp, Hp, s: Wp / 2 };
  };

  const panoState = { vTop: 0.3, cols: [] };
  const renderPanorama = () => {
    const g = stripGeom();
    const cols = g.Wp, rows = g.Hp;
    pano.width = 4 * cols; pano.height = rows;
    const pg = pano.getContext("2d");
    const id = pg.createImageData(4 * cols, rows), px = id.data;
    const skyTop = hexToRgb("#faf8f3"), skyLow = hexToRgb("#2a3a66"), HAZE = hexToRgb("#3a4c7c");
    const results = [];
    let vmax = -Infinity;
    for (let k = 0; k < 4; k++) for (let i = 0; i < cols; i++) {
      const u = ((i + 0.5) / cols) * 2 - 1;
      const samples = [];
      const r = wedgeColumn(T, view, k, u, { stepCells: 0.7, onSample: (a, v, prev, c, rr) => samples.push(a, v, c, rr) });
      results.push({ k, u, r, samples });
      if (r.v > vmax) vmax = r.v;
    }
    let vTop = !isFinite(vmax) ? 0.5 : vmax < 0 ? vmax + 0.18 : Math.max(vmax + 0.1, (rows / g.s) * 0.72);
    const sp = sunMode ? sunInStrip() : null;
    if (sp) vTop = Math.max(vTop, sp.v + 0.16);
    panoState.vTop = vTop;
    panoState.cols = [];
    skyline = [];
    for (let y = 0; y < rows; y++) {
      const t = y / rows, c = [skyTop[0] + (skyLow[0] - skyTop[0]) * t, skyTop[1] + (skyLow[1] - skyTop[1]) * t, skyTop[2] + (skyLow[2] - skyTop[2]) * t];
      for (let x = 0; x < 4 * cols; x++) { const o = (y * 4 * cols + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }
    }
    results.forEach((res, idx) => {
      const x = idx;
      let hz = rows;
      const smp = res.samples;
      for (let q = 0; q < smp.length; q += 4) {
        const a = smp[q], v = smp[q + 1], cc = smp[q + 2], rr = smp[q + 3];
        const yv = Math.max(0, Math.floor((vTop - v) * g.s));
        if (yv >= hz) continue;
        const ci = Math.round(rr) * w + Math.round(cc);
        const haze = 0.7 * (1 - Math.exp(-a / 22000));
        const cr = base[ci * 3] * (1 - haze) + HAZE[0] * haze, cg = base[ci * 3 + 1] * (1 - haze) + HAZE[1] * haze, cb = base[ci * 3 + 2] * (1 - haze) + HAZE[2] * haze;
        for (let y = yv; y < hz; y++) { const o = (y * 4 * cols + x) * 4; px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; }
        hz = yv;
      }
      const top = res.r.v > -Infinity ? (vTop - res.r.v) * g.s : NaN;
      panoState.cols.push(top);
      if (isFinite(res.r.a)) {
        const c = view.x + res.r.a * res.r.ge / cell, r = view.y - res.r.a * res.r.gn / cell;
        skyline.push({ col: c, row: r });
      } else skyline.push(null);
    });
    pg.putImageData(id, 0, 0);
    let best = -90;
    results.forEach((res) => { if (res.r.v > -Infinity) best = Math.max(best, Math.atan(res.r.v / Math.sqrt(1 + res.u * res.u)) * RAD); });
    skyMax = best;
  };

  const sunInStrip = () => {
    const az = gridAz(params.sunAz), s = sunVector(az, params.sunEl);
    const k = wedgeOf(s.e, s.n);
    const gp = gnomonic(s.e, s.n, s.u, k);
    return gp ? { k, u: gp[0], v: gp[1] } : null;
  };

  const drawStrip = () => {
    if (!params.wedges) return;
    const g = stripGeom(), c = sc.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, g.W, STRIP_H);
    c.fillStyle = "rgba(255,255,255,.94)";
    c.beginPath(); c.roundRect(0.5, 0.5, g.W - 1, STRIP_H - 1, 14); c.fill();
    c.strokeStyle = "#e3ded3"; c.lineWidth = 1; c.stroke();
    c.font = `500 10px ${FONT_UI}`; c.fillStyle = INK3; c.textAlign = "left"; c.textBaseline = "alphabetic";
    const titles = sunMode ? ["VIEW FROM THE SPOT · FOUR GNOMONIC WEDGES · THE SPOT IS LIT WHEN THE SUN IS ABOVE THE SKYLINE", "VIEW FROM THE SPOT · FOUR GNOMONIC WEDGES", "VIEW FROM THE SPOT"] : ["VIEW FROM THE EYE · FOUR GNOMONIC WEDGES · NEAREST GROUND FIRST, KEEP THE HORIZON", "VIEW FROM THE EYE · FOUR GNOMONIC WEDGES", "VIEW FROM THE EYE"];
    c.fillText(titles.find((t) => c.measureText(t).width <= g.W - 2 * g.pad) || titles[2], g.pad, 19);
    const total = 4 * g.Wp;
    c.font = `500 10px ${FONT_MONO}`;
    const eyeW = c.measureText("eye level").width, eyeY = g.top + panoState.vTop * g.s;
    const eyeHits = ({ k, dy }) => {
      const base = eyeY + dy;
      if (base - 9 < g.top || base + 3 > g.top + g.Hp) return Infinity;
      let n = 0;
      for (let i = 4; i < Math.min(g.Wp, 10 + eyeW); i++) { const y = g.top + panoState.cols[k * g.Wp + i]; if (y > base - 10 && y < base + 4) n++; }
      return n;
    };
    const eyeAt = [0, 1, 2, 3].flatMap((k) => [{ k, dy: -4 }, { k, dy: 11 }]).reduce((a, b) => (eyeHits(b) < eyeHits(a) ? b : a));
    for (let k = 0; k < 4; k++) {
      const x0 = g.pad + k * (g.Wp + g.gap);
      c.save();
      c.beginPath(); c.roundRect(x0, g.top, g.Wp, g.Hp, 6); c.clip();
      c.imageSmoothingEnabled = true;
      c.drawImage(pano, k * g.Wp, 0, g.Wp, g.Hp, x0, g.top, g.Wp, g.Hp);
      const y0 = g.top + panoState.vTop * g.s;
      if (y0 > g.top && y0 < g.top + g.Hp) {
        c.strokeStyle = "rgba(63,60,55,.5)"; c.setLineDash([4, 4]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + g.Wp, y0); c.stroke(); c.setLineDash([]);
        if (k === eyeAt.k) { c.font = `500 10px ${FONT_MONO}`; c.fillStyle = INK2; c.fillText("eye level", x0 + 6, y0 + eyeAt.dy); }
      }
      const lim = drawP * total - k * g.Wp;
      if (lim > 0) {
        c.strokeStyle = BRASS; c.lineWidth = 2; c.lineJoin = "round";
        c.beginPath();
        let pen = false;
        for (let i = 0; i < Math.min(g.Wp, lim); i++) {
          const y = panoState.cols[k * g.Wp + i];
          if (!isFinite(y)) { pen = false; continue; }
          const X = x0 + i + 0.5, Y = g.top + y;
          if (pen) c.lineTo(X, Y); else { c.moveTo(X, Y); pen = true; }
        }
        c.stroke();
      }
      if (sunMode) {
        const sp = sunInStrip();
        if (sp && sp.k === k) {
          const X = x0 + (sp.u + 1) * g.s, Y = g.top + (panoState.vTop - sp.v) * g.s;
          const col = Math.round(clamp((sp.u + 1) * g.s, 0, g.Wp - 1));
          const sky = panoState.cols[k * g.Wp + col];
          const clear = !isFinite(sky) || Y < g.top + sky;
          const gr = c.createRadialGradient(X, Y, 0, X, Y, 18);
          gr.addColorStop(0, "rgba(227,162,11,.95)"); gr.addColorStop(0.35, "rgba(227,162,11,.5)"); gr.addColorStop(1, "rgba(227,162,11,0)");
          c.fillStyle = gr; c.beginPath(); c.arc(X, Y, 18, 0, Math.PI * 2); c.fill();
          c.fillStyle = SUN; c.beginPath(); c.arc(X, Y, 5.5, 0, Math.PI * 2); c.fill();
          c.font = `500 11px ${FONT_MONO}`;
          const roomR = x0 + g.Wp - X - 16, roomL = X - x0 - 16, side = roomR >= roomL ? 1 : -1;
          const says = clear ? ["Sun above the skyline: lit", "Sun above: lit", "lit"] : ["Sun below the skyline: shadow", "Sun below: shadow", "shadow"];
          const said = says.find((t) => c.measureText(t).width <= Math.max(roomR, roomL)) || says[2], tw = c.measureText(said).width;
          let tx = side > 0 ? X + 12 : X - 12 - tw, ty = clamp(Y - 10, g.top + 30, g.top + g.Hp - 6);
          if (tx < x0 + 4 || tx + tw > x0 + g.Wp - 4) { tx = clamp(X - tw / 2, x0 + 4, x0 + g.Wp - 4 - tw); ty = Y - 12 >= g.top + 30 ? Y - 12 : Y + 20; }
          c.fillStyle = clear ? SUN : INK2;
          c.lineJoin = "round"; c.lineWidth = 3; c.strokeStyle = "rgba(250,248,243,.85)";
          c.strokeText(said, tx, ty);
          c.fillText(said, tx, ty);
        }
      }
      if (hoverCell && hoverCell.gn && hoverCell.gn[2] === k) {
        const X = x0 + (hoverCell.gn[0] + 1) * g.s, Y = g.top + (panoState.vTop - hoverCell.gn[1]) * g.s;
        c.strokeStyle = SIGNAL; c.lineWidth = 1.5; c.beginPath(); c.arc(X, Y, 5, 0, Math.PI * 2); c.stroke();
      }
      c.restore();
      c.strokeStyle = "rgba(107,102,94,.45)"; c.lineWidth = 1; c.beginPath(); c.roundRect(x0 + 0.5, g.top + 0.5, g.Wp - 1, g.Hp - 1, 6); c.stroke();
      c.font = `600 12px ${FONT_MONO}`; c.fillStyle = INK; c.fillText(WEDGES[k].name, x0 + 8, g.top + 16);
      c.font = `500 10px ${FONT_MONO}`; c.fillStyle = INK3;
      const caps = [-1, 0, 1].map((u) => [u, `${Math.round(((WEDGES[k].az + Math.atan(u) * RAD - CONV) % 360 + 360) % 360)}°`]);
      const [wl, wc, wr] = caps.map(([, t]) => c.measureText(t).width);
      const roomy = g.s - wc / 2 - 2 - Math.max(wl, wr) >= 6;
      for (const [u, t] of caps) {
        if (u === 0 && !roomy) continue;
        c.textAlign = u < 0 ? "left" : u > 0 ? "right" : "center";
        c.fillText(t, x0 + (u + 1) * g.s + (u < 0 ? 2 : u > 0 ? -2 : 0), g.top + g.Hp + 14);
      }
      c.textAlign = "left";
    }
  };

  const compute = () => {
    readSpot();
    distance = distanceOf(params.distance);
    sunMode = !isFinite(distance);
    const azg = gridAz(params.sunAz);
    eye = eyePosition(T, spot, params.height, distance, azg, params.sunEl);
    shadowMask(T, azg, params.sunEl, lit, Kbuf);
    if (!sunMode) viewshed(T, eye, mask, Kbuf);
    view = sunMode || distance <= 0 ? { x: spot.col, y: spot.row, z: heightAt(T, spot.col, spot.row) + params.height } : eye;
    stats = maskStats(T, sunMode ? lit : mask, spot);
  };

  const readouts = () => {
    const out = { area: stats.area, pct: stats.pct, far: sunMode ? "–" : stats.far, sky: skyMax };
    out.shadow = probeCell ? shadowLength(T, lit, probeCell.col, probeCell.row, gridAz(params.sunAz)) : "–";
    ctx.readout.setMany(out);
  };

  const startFlood = () => {
    if (floodTw) floodTw.cancel();
    if (!booted || ctx.reducedMotion || sunMode) { floodR = Infinity; paint(); return; }
    const far = Math.hypot(Math.max(spot.col, w - spot.col), Math.max(spot.row, h - spot.row));
    floodR = 0;
    floodTw = ctx.anim.tween({ from: 0, to: far, duration: FLOOD_MS, ease: ctx.anim.ease.out, onUpdate: (v) => { floodR = v; paint(); }, onDone: () => { floodTw = null; floodR = Infinity; paint(); } });
  };
  const startDraw = () => {
    if (drawTw) drawTw.cancel();
    if (!booted || ctx.reducedMotion) { drawP = 1; drawStrip(); drawSkyline3D(); return; }
    drawP = 0;
    drawTw = ctx.anim.tween({ from: 0, to: 1, duration: DRAW_MS, ease: ctx.anim.ease.out, onUpdate: (v) => { drawP = v; drawStrip(); drawSkyline3D(); }, onDone: () => { drawTw = null; } });
  };

  const refresh = ({ live = false, rebuild = true } = {}) => {
    compute();
    if (rebuild) rebuildBase();
    renderPanorama();
    drawEye();
    drawWedgeEdges();
    if (live) { if (floodTw) { floodTw.cancel(); floodTw = null; } floodR = Infinity; paint(); drawP = 1; drawStrip(); drawSkyline3D(); }
    else { startFlood(); startDraw(); }
    if (hoverCell) hoverAt(hoverCell.col, hoverCell.row);
    readouts();
    ctx.overlay.update();
  };

  const losInfo = (col, row) => {
    if (sunMode) {
      const az = gridAz(params.sunAz), hz = horizonTowardSun(T, col, row, az);
      return { visible: lit[Math.round(row) * w + Math.round(col)] === 1, angle: hz };
    }
    const tz = heightAt(T, col, row), dx = (col - eye.x) * cell, dy = (row - eye.y) * cell, d = Math.hypot(dx, dy);
    const angle = Math.atan2(tz - eye.z, d) * RAD;
    const steps = Math.max(2, Math.ceil(Math.hypot(col - eye.x, row - eye.y) * 2));
    let block = null;
    for (let k = 1; k < steps; k++) {
      const s = k / steps, c = eye.x + (col - eye.x) * s, r = eye.y + (row - eye.y) * s;
      if (c < 0 || r < 0 || c > w - 1 || r > h - 1) continue;
      if (heightAt(T, c, r) > eye.z + (tz - eye.z) * s + 0.5) { block = { col: c, row: r }; break; }
    }
    return { visible: mask[Math.round(row) * w + Math.round(col)] === 1, angle, block };
  };

  const hoverAt = (col, row) => {
    const info = losInfo(col, row);
    const tz = heightAt(T, col, row);
    hoverCell = { col, row, gn: gnomonic((col - view.x) * cell, -(row - view.y) * cell, tz - view.z) };
    const target = model(col, row, tz, 0.004);
    if (sunMode) {
      const dir = sunDisplayDir();
      const hit = groundHit([target[0] + dir[0] * 0.012, target[1] + dir[1] * 0.012, target[2] + dir[2] * 0.012], dir, 1.6);
      if (hit) { globe.setSegments3D(PREFIX + "losHidden", [[target, hit]]); globe.setPoints3D(PREFIX + "block", [hit]); globe.setLayer(PREFIX + "losHidden", true); globe.setLayer(PREFIX + "block", true); globe.setLayer(PREFIX + "los", false); }
      else { globe.setSegments3D(PREFIX + "los", [[target, [target[0] + dir[0] * 0.7, target[1] + dir[1] * 0.7, target[2] + dir[2] * 0.7]]]); globe.setLayer(PREFIX + "los", true); globe.setLayer(PREFIX + "losHidden", false); globe.setLayer(PREFIX + "block", false); }
    } else {
      const e = eyeDisplay().p;
      if (info.block) {
        const bp = model(info.block.col, info.block.row, undefined, 0.004);
        globe.setSegments3D(PREFIX + "los", [[e, bp]]);
        globe.setSegments3D(PREFIX + "losHidden", [[bp, target]]);
        globe.setPoints3D(PREFIX + "block", [bp]);
        globe.setLayer(PREFIX + "losHidden", true); globe.setLayer(PREFIX + "block", true);
      } else {
        globe.setSegments3D(PREFIX + "los", [[e, target]]);
        globe.setLayer(PREFIX + "losHidden", false); globe.setLayer(PREFIX + "block", false);
      }
      globe.setLayer(PREFIX + "los", true);
    }
    drawStrip();
    return info;
  };
  const clearHover = () => {
    hoverCell = null;
    for (const id of ["los", "losHidden", "block"]) globe.setLayer(PREFIX + id, false);
    drawStrip();
  };

  const offHover = globe.on("hover", (hv) => { if (!hv && hoverCell) clearHover(); });

  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const near = (p, x, y, tol) => { const s = globe.projectPoint(p, false); return isFinite(s.x) && Math.hypot(s.x - x, s.y - y) < tol; };
  const onHandle = (x, y) => near(model(spot.col, spot.row, undefined, 0.003), x, y, 16) || (!sunMode && near(eyeDisplay().p, x, y, 16));
  const el = ctx.stage.el;
  if (ctx.side === "A") {
    el.addEventListener("dblclick", (e) => { if (!e.target.closest(".vs-strip")) e.stopPropagation(); }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".vs-strip") || e.target.closest(".transport")) return;
      const [x, y] = stagePos(e);
      if (!onHandle(x, y)) return;
      e.stopPropagation(); e.preventDefault();
      dragging = { id: e.pointerId };
      ctx.overlay.hideChip();
      clearHover();
      globe.canvas.style.cursor = "grabbing";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      if (e.target.closest && e.target.closest(".vs-strip")) return;
      const [x, y] = stagePos(e);
      if (!dragging) { if (onHandle(x, y)) globe.canvas.style.cursor = "grab"; return; }
      if (e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const p = ownPick(x, y);
      if (!p) return;
      ctx.controls.set("eye", [+p.lon.toFixed(4), +p.lat.toFixed(4)], { live: true });
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      dragging = null;
      globe.canvas.style.cursor = "grab";
      ctx.controls.set("eye", params.eye.slice());
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
  }
  for (const ev of ["pointerdown", "click", "wheel", "dblclick"]) strip.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  const sunTween = (from, to) => {
    if (sunTw) sunTw.cancel();
    const da = ((to.az - from.az + 540) % 360) - 180;
    sunTw = ctx.anim.tween({ from: 0, to: 1, duration: 520, ease: ctx.anim.ease.emph, onUpdate: (k) => {
      params.sunAz = (from.az + da * k + 360) % 360; params.sunEl = from.el + (to.el - from.el) * k;
      refresh({ live: true });
    }, onDone: () => { sunTw = null; params.sunAz = to.az; params.sunEl = to.el; refresh({ live: true }); } });
  };

  layout();
  refresh({ live: true });
  frameAll(0);
  setTimeout(() => { if (!dragging) frameAll(0); }, 700);
  setTimeout(() => { booted = true; startFlood(); startDraw(); }, 0);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      const now = performance.now(), rapid = now - lastUpdate < 250;
      lastUpdate = now;
      const all = keys.length > 3 || keys.length === 0;
      if (keys.includes("wedges")) { layout(); frameAll(booted ? 420 : 0); }
      const sunOnly = !all && keys.length > 0 && keys.every((k) => k === "sunAz" || k === "sunEl");
      const sunJump = booted && sunOnly && !rapid && (Math.abs(((p.sunAz - prev.sunAz + 540) % 360) - 180) > 12 || Math.abs(p.sunEl - prev.sunEl) > 8);
      if (sunJump) { const to = { az: p.sunAz, el: p.sunEl }; params.sunAz = prev.sunAz; params.sunEl = prev.sunEl; sunTween({ az: prev.sunAz, el: prev.sunEl }, to); return; }
      if (sunTw && sunOnly) { sunTw.cancel(); sunTw = null; }
      const wasSun = sunMode;
      refresh({ live: true });
      clearTimeout(settle);
      if (!sunOnly && booted) settle = setTimeout(() => { if (!dragging) { startFlood(); startDraw(); } }, 200);
      if (sunMode && !wasSun && booted) ctx.done();
      if (all || keys.includes("distance") || keys.includes("height")) frameAll(booted && !all && !rapid ? 360 : 0);
    },
    hover(lon, lat) {
      if (dragging) return [];
      const c = llToCell(lon, lat);
      if (c.col < 0 || c.row < 0 || c.col > w - 1 || c.row > h - 1) return [];
      const info = hoverAt(c.col, c.row);
      const z = heightAt(T, c.col, c.row);
      if (sunMode) return [info.visible ? "lit" : "in shadow", `horizon toward the Sun ${info.angle.toFixed(1)}°, Sun ${params.sunEl}°`, `height ${Math.round(z).toLocaleString("en-US")} m`];
      return [info.visible ? "visible" : "hidden", `elevation angle ${info.angle.toFixed(1)}°`, `height ${Math.round(z).toLocaleString("en-US")} m`];
    },
    probe(lon, lat) {
      const c = llToCell(lon, lat);
      if (c.col < 0 || c.row < 0 || c.col > w - 1 || c.row > h - 1) return null;
      probeCell = { col: c.col, row: c.row };
      const L = shadowLength(T, lit, c.col, c.row, gridAz(params.sunAz));
      const vis = sunMode ? null : mask[Math.round(c.row) * w + Math.round(c.col)] === 1;
      const txt = `${vis === null ? "" : vis ? "visible · " : "hidden · "}${L > 0 ? `in shadow, shadow ${Math.round(L).toLocaleString("en-US")} m long` : "in sunlight"}`;
      ctx.overlay.label(PREFIX + "probe", { lon, lat }, txt, { color: SIGNAL, leader: true, dx: 18, dy: -22, mono: true });
      return { shadow: L };
    },
    unprobe() { probeCell = null; ctx.overlay.remove(PREFIX + "probe"); ctx.readout.set("shadow", "–"); },
    resize() { layout(); renderPanorama(); drawStrip(); frameAll(0); },
    unmount() {
      for (const t of [floodTw, drawTw, sunTw]) if (t) t.cancel();
      clearTimeout(settle);
      offHover();
      delete globe.pick;
      delete globe.project;
      globe.removePrefix(PREFIX);
      for (const k of Object.keys(savedLayers)) globe.setLayer(k, k === "labels" ? savedLayers[k] : true);
      globe.labelInsetBottom = 0;
      globe.canvas.style.cursor = "grab";
      ctx.overlay.clear(PREFIX);
    },
  };
}
