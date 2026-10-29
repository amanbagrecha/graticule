import { forward as utmForward, inverse as utmInverse } from "@/core/utm.js";
import { clamp, DEG, hexToRgb } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const CAM = "#ffffff";
const DEM = "dem_alps_512.i16";
const ZONE = 32;

export const FOCAL_MM = 152.4;
export const HALF_FORMAT_MM = 115;
export const START = [6.7722, 45.8422];
export const WINDOW_K = 1.5;

export function reliefDisplacement(h, r, H) {
  return (h * r) / H;
}

export function demFrom(grid) {
  const G = grid.meta, n = grid.width * grid.height, z = new Float32Array(n);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = grid.data[i] * (grid.scale ?? 1);
    z[i] = v;
    if (v < zmin) zmin = v;
    if (v > zmax) zmax = v;
  }
  return { z, w: grid.width, h: grid.height, cell: G.step_m, xmin: G.bounds.xmin, ymax: G.bounds.ymax, xmax: G.bounds.xmax, ymin: G.bounds.ymin, zmin, zmax };
}

export function heightAtEN(T, E, N) {
  const c = clamp((E - T.xmin) / T.cell - 0.5, 0, T.w - 1), r = clamp((T.ymax - N) / T.cell - 0.5, 0, T.h - 1);
  const c0 = Math.min(Math.floor(c), T.w - 2), r0 = Math.min(Math.floor(r), T.h - 2), fx = c - c0, fy = r - r0, z = T.z, w = T.w;
  const a = z[r0 * w + c0], b = z[r0 * w + c0 + 1], d = z[(r0 + 1) * w + c0], e = z[(r0 + 1) * w + c0 + 1];
  return (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
}

export function makeCamera(T, E, N, H, f = FOCAL_MM) {
  const datum = heightAtEN(T, E, N);
  return { E, N, H, f, datum, Z: datum + H };
}

export function footprintHalf(H, f = FOCAL_MM) {
  return (H * HALF_FORMAT_MM) / f;
}

export function projectRaw(cam, mode, E, N, Z) {
  const dz = cam.Z - Z;
  if (!(dz > 1e-6)) return null;
  const x = (cam.f * (E - cam.E)) / dz;
  const y = mode === "pushbroom" ? (cam.f * (N - cam.N)) / cam.H : (cam.f * (N - cam.N)) / dz;
  return [x, y];
}

export function projectOrtho(cam, E, N) {
  return [(cam.f * (E - cam.E)) / cam.H, (cam.f * (N - cam.N)) / cam.H];
}

export function displacement(cam, mode, E, N, Z) {
  const raw = projectRaw(cam, mode, E, N, Z);
  if (!raw) return null;
  const ortho = projectOrtho(cam, E, N);
  const across = raw[0] - ortho[0], along = raw[1] - ortho[1];
  const d = Math.hypot(across, along);
  const r = mode === "pushbroom" ? Math.abs(raw[0]) : Math.hypot(raw[0], raw[1]);
  const h = Z - cam.datum;
  return { raw, ortho, across, along, d, r, h, ground: (d * cam.H) / cam.f };
}

export function castRay(T, ox, oy, oz, dx, dy) {
  const g = heightAtEN(T, ox, oy);
  if (oz <= g) return null;
  const step = T.cell / 4 / Math.max(1, Math.hypot(dx, dy));
  const tmax = oz - T.zmin + 1;
  const above = (t) => oz - t - heightAtEN(T, ox + dx * t, oy + dy * t);
  const inside = (t) => { const E = ox + dx * t, N = oy + dy * t; return E >= T.xmin && E <= T.xmax && N >= T.ymin && N <= T.ymax; };
  let prev = Math.max(0, oz - T.zmax - 1);
  for (let t = prev + step; t <= tmax + step; t += step) {
    if (!inside(t)) return null;
    if (above(t) <= 0) {
      let a = prev, b = t;
      for (let k = 0; k < 30; k++) { const mid = (a + b) / 2; if (above(mid) > 0) a = mid; else b = mid; }
      const E = ox + dx * b, N = oy + dy * b;
      return { E, N, Z: heightAtEN(T, E, N), t: b };
    }
    prev = t;
  }
  return null;
}

export function rayToGround(T, cam, mode, x, y) {
  if (mode === "pushbroom") return castRay(T, cam.E, cam.N + (y * cam.H) / cam.f, cam.Z, x / cam.f, 0);
  return castRay(T, cam.E, cam.N, cam.Z, x / cam.f, y / cam.f);
}

const pixelMm = (i, n) => -HALF_FORMAT_MM + ((i + 0.5) * 2 * HALF_FORMAT_MM) / n;

export function rawImage(T, cam, mode, n) {
  const E = new Float64Array(n * n), N = new Float64Array(n * n), ok = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const hit = rayToGround(T, cam, mode, pixelMm(i, n), -pixelMm(j, n));
    if (!hit) continue;
    const k = j * n + i;
    E[k] = hit.E; N[k] = hit.N; ok[k] = 1;
  }
  return { n, E, N, ok };
}

export function rasterSampler(raw) {
  const n = raw.n, A = HALF_FORMAT_MM;
  return (x, y) => {
    const fx = ((x + A) / (2 * A)) * n - 0.5, fy = ((A - y) / (2 * A)) * n - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fy), ax = fx - i0, ay = fy - j0;
    let E = 0, N = 0, W = 0;
    for (const [di, dj, w] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) {
      const i = clamp(i0 + di, 0, n - 1), j = clamp(j0 + dj, 0, n - 1), k = j * n + i;
      if (!raw.ok[k] || w <= 0) continue;
      E += raw.E[k] * w; N += raw.N[k] * w; W += w;
    }
    return W > 0 ? { E: E / W, N: N / W } : null;
  };
}

export function orthorectify(sample, T, cam, mode, n) {
  const A = HALF_FORMAT_MM;
  const out = { n, E: new Float64Array(n * n), N: new Float64Array(n * n), x: new Float64Array(n * n), y: new Float64Array(n * n), ok: new Uint8Array(n * n) };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = pixelMm(i, n), y = -pixelMm(j, n);
    const Eg = cam.E + (x * cam.H) / cam.f, Ng = cam.N + (y * cam.H) / cam.f;
    const p = projectRaw(cam, mode, Eg, Ng, heightAtEN(T, Eg, Ng));
    if (!p || Math.abs(p[0]) > A || Math.abs(p[1]) > A) continue;
    const g = sample(p[0], p[1]);
    if (!g) continue;
    const k = j * n + i;
    out.E[k] = g.E; out.N[k] = g.N; out.x[k] = p[0]; out.y[k] = p[1]; out.ok[k] = 1;
  }
  return out;
}

export function makeGrid(T, cE, cN, half, M) {
  const E = new Float64Array(M * M), N = new Float64Array(M * M), Z = new Float32Array(M * M);
  let zmin = Infinity, zmax = -Infinity;
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const k = j * M + i;
    E[k] = cE - half + (2 * half * i) / (M - 1);
    N[k] = cN + half - (2 * half * j) / (M - 1);
    const z = heightAtEN(T, E[k], N[k]);
    Z[k] = z;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }
  return { M, E, N, Z, cE, cN, half, zmin, zmax };
}

export function projectGrid(G, cam, mode, P = {}) {
  const n = G.M * G.M;
  for (const key of ["rx", "ry", "ox", "oy", "dep", "e", "n", "hid"]) if (!P[key] || P[key].length !== n) P[key] = new Float32Array(n);
  if (!P.valid || P.valid.length !== n) P.valid = new Uint8Array(n);
  const f = cam.f, H = cam.H, push = mode === "pushbroom";
  for (let k = 0; k < n; k++) {
    const e = G.E[k] - cam.E, nn = G.N[k] - cam.N, dz = cam.Z - G.Z[k];
    P.e[k] = e; P.n[k] = nn;
    P.ox[k] = (f * e) / H; P.oy[k] = (f * nn) / H;
    const ok = dz > 0.02 * H;
    P.valid[k] = ok ? 1 : 0;
    P.rx[k] = ok ? (f * e) / dz : 0;
    P.ry[k] = ok ? (push ? (f * nn) / H : (f * nn) / dz) : 0;
    P.dep[k] = push ? Math.hypot(e, dz) : Math.hypot(e, nn, dz);
    P.hid[k] = 0;
  }
  P.M = G.M;
  P.spacing = (2 * G.half) / (G.M - 1);
  return P;
}

export function makeRaster(n) {
  return { n, zb: new Float32Array(n * n), e: new Float32Array(n * n), nn: new Float32Array(n * n), hid: new Float32Array(n * n), fill: new Uint8Array(n * n), sx: null, sy: null };
}

export function rasterize(P, m, out) {
  const M = P.M, n = out.n, A = HALF_FORMAT_MM, k = n / (2 * A), nv = M * M;
  if (!out.sx || out.sx.length !== nv) { out.sx = new Float32Array(nv); out.sy = new Float32Array(nv); }
  const sx = out.sx, sy = out.sy, um = 1 - m;
  for (let i = 0; i < nv; i++) {
    sx[i] = (um * P.rx[i] + m * P.ox[i] + A) * k;
    sy[i] = (A - (um * P.ry[i] + m * P.oy[i])) * k;
  }
  const zb = out.zb, oe = out.e, on = out.nn, oh = out.hid, fill = out.fill;
  zb.fill(Infinity);
  fill.fill(0);
  const valid = P.valid, dep = P.dep, pe = P.e, pn = P.n, ph = P.hid;
  const tri = (a, b, c) => {
    const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    let x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(n - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
    let y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(n - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
    if (x0 > x1 || y0 > y1) return;
    const inv = 1 / area;
    const da = dep[a], db = dep[b], dc = dep[c];
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const d = w0 * da + w1 * db + w2 * dc, i = y * n + x;
        if (d >= zb[i]) continue;
        zb[i] = d;
        oe[i] = w0 * pe[a] + w1 * pe[b] + w2 * pe[c];
        on[i] = w0 * pn[a] + w1 * pn[b] + w2 * pn[c];
        oh[i] = w0 * ph[a] + w1 * ph[b] + w2 * ph[c];
        fill[i] = 1;
      }
    }
  };
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) {
    const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
    if (!valid[a] || !valid[b] || !valid[c] || !valid[d]) continue;
    const xmn = Math.min(sx[a], sx[b], sx[c], sx[d]), xmx = Math.max(sx[a], sx[b], sx[c], sx[d]);
    const ymn = Math.min(sy[a], sy[b], sy[c], sy[d]), ymx = Math.max(sy[a], sy[b], sy[c], sy[d]);
    if (xmx < 0 || ymx < 0 || xmn > n || ymn > n) continue;
    tri(a, c, b);
    tri(b, c, d);
  }
  return out;
}

export function markHidden(P, out0) {
  const n = out0.n, A = HALF_FORMAT_MM, k = n / (2 * A), M = P.M;
  for (let v = 0; v < M * M; v++) {
    if (!P.valid[v]) { P.hid[v] = 1; continue; }
    const x = Math.floor((P.rx[v] + A) * k), y = Math.floor((A - P.ry[v]) * k);
    if (x < 0 || y < 0 || x >= n || y >= n) { P.hid[v] = 1; continue; }
    const zb = out0.zb[y * n + x];
    P.hid[v] = P.dep[v] > zb + 2.5 * P.spacing + 0.002 * P.dep[v] ? 1 : 0;
  }
  return P;
}

export function findPeaks(T, cam, half, count = 3, keep = null) {
  const c0 = Math.max(2, Math.floor((cam.E - half - T.xmin) / T.cell)), c1 = Math.min(T.w - 3, Math.ceil((cam.E + half - T.xmin) / T.cell));
  const r0 = Math.max(2, Math.floor((T.ymax - cam.N - half) / T.cell)), r1 = Math.min(T.h - 3, Math.ceil((T.ymax - cam.N + half) / T.cell));
  const list = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const v = T.z[r * T.w + c];
    if (v - cam.datum < 120) continue;
    let top = true;
    for (let dr = -2; dr <= 2 && top; dr++) for (let dc = -2; dc <= 2; dc++) if ((dr || dc) && T.z[(r + dr) * T.w + c + dc] > v) { top = false; break; }
    if (!top) continue;
    const E = T.xmin + (c + 0.5) * T.cell, N = T.ymax - (r + 0.5) * T.cell;
    if (Math.abs(E - cam.E) > half || Math.abs(N - cam.N) > half) continue;
    if (keep && !keep(E, N, v)) continue;
    list.push({ E, N, Z: v });
  }
  list.sort((a, b) => b.Z - a.Z);
  const out = [];
  for (const p of list) {
    if (out.every((q) => Math.hypot(q.E - p.E, q.N - p.N) > 0.45 * half)) out.push(p);
    if (out.length >= count) break;
  }
  return out;
}

export function shadeCells(T, az = 315, el = 45) {
  const { z, w, h, cell } = T, shade = new Float32Array(w * h), slope = new Float32Array(w * h);
  const Le = Math.sin(az * DEG) * Math.cos(el * DEG), Ln = Math.cos(az * DEG) * Math.cos(el * DEG), Lu = Math.sin(el * DEG);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xe = Math.min(w - 1, x + 1), xw = Math.max(0, x - 1), yn = Math.max(0, y - 1), ys = Math.min(h - 1, y + 1);
    const ge = (z[y * w + xe] - z[y * w + xw]) / ((xe - xw) * cell), gn = (z[yn * w + x] - z[ys * w + x]) / ((ys - yn) * cell);
    const g2 = ge * ge + gn * gn;
    shade[y * w + x] = Math.max(0, (-ge * Le - gn * Ln + Lu) / Math.sqrt(g2 + 1));
    slope[y * w + x] = Math.sqrt(g2);
  }
  return { shade, slope };
}

const hash2 = (i, j) => {
  let q = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  q = Math.imul(q ^ (q >>> 13), 1274126177);
  return ((q ^ (q >>> 16)) >>> 0) / 4294967295;
};
const valueNoise = (x, y) => {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
};
export function groundNoise(E, N) {
  return 0.55 * valueNoise(E / 140, N / 140) + 0.3 * valueNoise(E / 45, N / 45) + 0.15 * valueNoise(E / 16, N / 16);
}

const PHOTO = {
  forest: hexToRgb("#3d5236"), meadow: hexToRgb("#7d8a52"), scree: hexToRgb("#8d867b"), rock: hexToRgb("#5f5a55"), snow: hexToRgb("#e8edf2"), valley: hexToRgb("#6f7f4e"),
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const band = (z, a, b) => clamp((z - a) / (b - a), 0, 1);
export function photoColour(z, slope, nz) {
  const j = (nz - 0.5) * 260;
  let c = mix(PHOTO.valley, PHOTO.forest, band(z + j * 0.5, 1050, 1250));
  c = mix(c, PHOTO.meadow, band(z + j, 1850, 2100));
  c = mix(c, PHOTO.scree, band(z + j, 2350, 2650));
  const snow = band(z + j * 1.4, 2850, 3150) * (1 - band(slope, 0.75, 1.1));
  c = mix(c, PHOTO.rock, band(slope, 0.85, 1.3) * band(z, 1900, 2300));
  c = mix(c, PHOTO.snow, snow);
  return c;
}

const fmtInt = (v) => Math.round(v).toLocaleString("en-US");
const fmtSigned = (v) => (v >= 0 ? "+" : "−") + fmtInt(Math.abs(v));

export const meta = {
  id: "orthorectify",
  title: "Relief displacement",
  track: 7,
  order: 2,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A photo is made by rays through one point. A tall object leans away from the image centre, more at the edge. The lean is relief displacement. Orthorectification moves each pixel back to where its ground point is. For that you need the terrain and the camera. A pushbroom sensor leans only across track.",
  deeper: [
    "d = h · r / H.",
    "h = 100 m, H = 1,000 m, r = 50 mm → 5 mm on the image.",
    "Four control points fix a flat photo; terrain needs a DEM.",
    "Pushbroom images have no displacement along track.",
  ],
  keywords: ["orthorectify", "orthorectification", "relief displacement", "camera", "pushbroom", "DEM", "ortho", "aerial photo", "collinearity"],
  controls: [
    { key: "camera", type: "segment", label: "Sensor", options: [{ value: "frame", label: "Frame camera" }, { value: "pushbroom", label: "Pushbroom" }], default: "frame" },
    { key: "cam", type: "point", label: "Camera above", default: START },
    { key: "H", type: "range", label: "Flying height H above the nadir ground", min: 500, max: 10000, step: 100, default: 2000, unit: "m", ticks: [500, 2500, 5000, 7500, 10000], format: (v) => fmtInt(v), tickFormat: (v) => (v >= 1000 ? `${v / 1000}k` : String(v)) },
    { key: "exag", type: "range", label: "Vertical exaggeration (3D view)", min: 1, max: 5, step: 0.5, default: 2, unit: "×", ticks: [1, 2, 3, 4, 5] },
    { key: "rays", type: "toggle", label: "Rays", default: true, shortcut: "y" },
    { type: "legend", label: "Key", items: [
      { color: SIGNAL, line: true, label: "Rays and the raw footprint" },
      { color: BRASS, line: true, label: "Displacement, from the true place to the image place" },
      { color: BRASS, dash: true, label: "Ortho footprint (true ground positions)" },
      { color: "#cdc6b7", label: "Ground the sensor did not see" },
      { color: CAM, label: "Camera (drag it)" },
    ] },
  ],
  readouts: [
    { key: "disp", label: "Displacement at probe", digits: 0, unit: "m", hero: true },
    { key: "r", label: "Radial distance r", digits: 1, unit: "mm" },
    { key: "h", label: "Height h above the datum", digits: 0, unit: "m" },
    { key: "H", label: "Flying height H", digits: 0, unit: "m" },
  ],
  transport: { label: ["raw", "ortho"], key: "m" },
  compare: null,
  view: { lon: -35, lat: 38, dist: 3 },
  data: [DEM],
};

const PREFIX = meta.id + ":";
const M = 161;
const TEX = 512;
const GAP = 16;
const FAN_MS = 650;
const SWEEP_S = 4.2;
const RAYS_N = 5;

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const grid = ctx.data.get(DEM) || (await ctx.data.load(DEM));
  const T = demFrom(grid);
  const { shade, slope } = shadeCells(T);
  const A = HALF_FORMAT_MM;
  let params = { ...ctx.params };
  let m = clamp(+params.m || 0, 0, 1);
  let mode = params.camera;
  let cam = null, win = null, S = 1, F = 0;
  let P = {};
  let raster = null, raster0 = null;
  let peaks = [];
  let probe = null, hoverPt = null, dragging = null, booted = false;
  let fanP = 1, fanTw = null, recentreTw = null;
  let sweep = 0;
  const texRGB = new Uint8ClampedArray(TEX * TEX * 3);

  const enOf = (lonlat) => { const p = utmForward(lonlat[0], lonlat[1], ZONE, false); return { E: p.E, N: p.N }; };
  const llOf = (E, N) => { const g = utmInverse(E, N, ZONE, false); return [g.lon, g.lat]; };

  const tex = globe.addPanel(PREFIX + "terrain", { size: TEX, opacity: 1 });
  const tmesh = globe.extra.get(PREFIX + "terrain");
  const geom = tmesh.geometry;
  const Attr = geom.attributes.position.constructor;
  const tpos = new Float32Array(M * M * 3), tuv = new Float32Array(M * M * 2), tindex = [];
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const k = j * M + i; tuv[k * 2] = i / (M - 1); tuv[k * 2 + 1] = 1 - j / (M - 1); }
  for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i, b = a + 1, c = a + M, d = c + 1; tindex.push(a, c, b, b, c, d); }
  geom.setAttribute("position", new Attr(tpos, 3));
  geom.setAttribute("uv", new Attr(tuv, 2));
  geom.setIndex(tindex);
  tex.tex.anisotropy = 8;

  const empty = [[[0, 0, 0], [0, 0, 0]]];
  const emptyTri = new Float32Array(9);
  globe.addTriangles(PREFIX + "wallNS", emptyTri, { color: "#ece7dd", lit: false, order: 1 });
  globe.addTriangles(PREFIX + "wallEW", emptyTri, { color: "#ffffff", lit: false, order: 1 });
  globe.addSegments3D(PREFIX + "rim", empty, { color: "rgba(107,102,94,.6)", width: 1 });
  globe.addTriangles(PREFIX + "datum", emptyTri, { color: "rgba(184,82,23,.12)", lit: false, depthWrite: false, order: 2.2 });
  globe.addTriangles(PREFIX + "fan", emptyTri, { color: "rgba(29,99,168,.16)", lit: false, depthWrite: false, order: 2.3 });
  globe.addSegments3D(PREFIX + "footRaw", empty, { color: SIGNAL, width: 2, depth: true, order: 3 });
  globe.addSegments3D(PREFIX + "footOrtho", empty, { color: BRASS, width: 1.8, dash: [6, 4], depth: true, order: 3 });
  globe.addSegments3D(PREFIX + "rays", empty, { color: "rgba(29,99,168,.55)", width: 1.1, depth: true, order: 4 });
  globe.addSegments3D(PREFIX + "edges", empty, { color: "rgba(29,99,168,.9)", width: 1.5, depth: true, order: 4 });
  globe.addSegments3D(PREFIX + "peakRays", empty, { color: BRASS, width: 1.6, depth: false, opacity: 0.9, order: 5 });
  globe.addSegments3D(PREFIX + "body", empty, { color: "rgba(26,25,23,.9)", width: 1.6, depth: false, order: 6 });
  globe.addSegments3D(PREFIX + "flight", empty, { color: "rgba(26,25,23,.55)", width: 1.2, dash: [5, 5], depth: false, order: 6 });
  globe.addSegments3D(PREFIX + "hvRay", empty, { color: SIGNAL, width: 2.2, depth: false, order: 7 });
  globe.addSegments3D(PREFIX + "hvExt", empty, { color: SIGNAL, width: 1.4, dash: [4, 4], depth: false, order: 7 });
  globe.addSegments3D(PREFIX + "hvStick", empty, { color: "rgba(26,25,23,.75)", width: 1.4, dash: [3, 3], depth: false, order: 7 });
  globe.addSegments3D(PREFIX + "hvDisp", empty, { color: BRASS, width: 3.2, depth: false, order: 8 });
  globe.addPoints3D(PREFIX + "hvPts", [[0, 0, 0]], { color: BRASS, size: 9, depth: false, order: 8 });
  globe.addPoints3D(PREFIX + "peakPts", [[0, 0, 0]], { color: BRASS, size: 8, depth: false, order: 6 });
  globe.addPoints3D(PREFIX + "sensor", [[0, 0, 0]], { color: SIGNAL, size: 11, depth: false, order: 9 });
  globe.addPoints3D(PREFIX + "cam", [[0, 0, 0]], { color: CAM, size: 15, depth: false, order: 9 });
  const HOVER_IDS = ["hvRay", "hvExt", "hvStick", "hvDisp", "hvPts", "datum"];
  for (const id of HOVER_IDS) globe.setLayer(PREFIX + id, false);

  const savedLayers = {};
  for (const k of ["surface", "coast", "graticule", "atmosphere", "labels"]) { savedLayers[k] = globe.layers[k]; globe.setLayer(k, false); }

  const yOf = (Z) => (Z - win.zMid) * S * params.exag;
  const M3 = (E, N, Z, lift = 0) => [(E - win.cE) * S, yOf(Z) + lift, -(N - win.cN) * S];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const baseY = () => yOf(win.zmin) - 0.06;

  const buildTexture = () => {
    const { cE, cN, half } = win;
    for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
      const E = cE - half + ((i + 0.5) * 2 * half) / TEX, N = cN + half - ((j + 0.5) * 2 * half) / TEX;
      const c = clamp((E - T.xmin) / T.cell - 0.5, 0, T.w - 1), r = clamp((T.ymax - N) / T.cell - 0.5, 0, T.h - 1);
      const c0 = Math.min(Math.floor(c), T.w - 2), r0 = Math.min(Math.floor(r), T.h - 2), fx = c - c0, fy = r - r0, w = T.w, o = r0 * w + c0;
      const z = (T.z[o] * (1 - fx) + T.z[o + 1] * fx) * (1 - fy) + (T.z[o + w] * (1 - fx) + T.z[o + w + 1] * fx) * fy;
      const s = (shade[o] * (1 - fx) + shade[o + 1] * fx) * (1 - fy) + (shade[o + w] * (1 - fx) + shade[o + w + 1] * fx) * fy;
      const sl = (slope[o] * (1 - fx) + slope[o + 1] * fx) * (1 - fy) + (slope[o + w] * (1 - fx) + slope[o + w + 1] * fx) * fy;
      const nz = groundNoise(E, N);
      const col = photoColour(z, sl, nz), kk = clamp(0.48 + 0.72 * s + (nz - 0.5) * 0.24, 0.36, 1.18), q = (j * TEX + i) * 3;
      texRGB[q] = col[0] * kk; texRGB[q + 1] = col[1] * kk; texRGB[q + 2] = col[2] * kk;
    }
    const id = new ImageData(TEX, TEX), px = id.data;
    for (let i = 0; i < TEX * TEX; i++) { px[i * 4] = texRGB[i * 3]; px[i * 4 + 1] = texRGB[i * 3 + 1]; px[i * 4 + 2] = texRGB[i * 3 + 2]; px[i * 4 + 3] = 255; }
    tex.ctx.putImageData(id, 0, 0);
    tex.tex.needsUpdate = true;
  };

  const buildTerrain3D = () => {
    const G = win.G;
    for (let k = 0; k < M * M; k++) { const p = M3(G.E[k], G.N[k], G.Z[k]); tpos[k * 3] = p[0]; tpos[k * 3 + 1] = p[1]; tpos[k * 3 + 2] = p[2]; }
    geom.attributes.position.needsUpdate = true;
    geom.computeBoundingSphere();
    const by = baseY(), walls = [[], []];
    const edges = [[(k) => k, 0], [(k) => (M - 1) * M + k, 0], [(k) => k * M, 1], [(k) => k * M + M - 1, 1]];
    for (const [at, side] of edges) for (let k = 0; k < M - 1; k++) {
      const p = M3(G.E[at(k)], G.N[at(k)], G.Z[at(k)]), q = M3(G.E[at(k + 1)], G.N[at(k + 1)], G.Z[at(k + 1)]);
      walls[side].push(...p, ...q, q[0], by, q[2], ...p, q[0], by, q[2], p[0], by, p[2]);
    }
    globe.setTriangles(PREFIX + "wallNS", Float32Array.from(walls[0]));
    globe.setTriangles(PREFIX + "wallEW", Float32Array.from(walls[1]));
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    globe.setSegments3D(PREFIX + "rim", c.map((a, i) => { const b = c[(i + 1) % 4]; return [[a[0], by, a[1]], [b[0], by, b[1]]]; }));
    globe.invalidate();
  };

  const windowFor = (E, N) => {
    let half = Math.min(WINDOW_K * F, (T.xmax - T.xmin) / 2 - T.cell, (T.ymax - T.ymin) / 2 - T.cell);
    const cE = clamp(E, T.xmin + half + T.cell / 2, T.xmax - half - T.cell / 2), cN = clamp(N, T.ymin + half + T.cell / 2, T.ymax - half - T.cell / 2);
    return { cE, cN, half };
  };
  const setWindow = (cE, cN, half) => {
    const G = makeGrid(T, cE, cN, half, M);
    win = { cE, cN, half, G, zmin: G.zmin, zmax: G.zmax, zMid: (G.zmin + G.zmax) / 2 };
    S = 1 / half;
    buildTexture();
    buildTerrain3D();
  };
  const clampCam = (E, N) => {
    const room = Math.max(0, win.half - F * 1.02);
    return { E: clamp(E, win.cE - room, win.cE + room), N: clamp(N, win.cN - room, win.cN + room) };
  };

  const panel = ctx.stage.element("div", "or-panel");
  const pc = document.createElement("canvas");
  pc.style.cssText = "width:100%;height:100%;display:block;";
  panel.append(pc);
  const imgC = document.createElement("canvas");
  const dpr = ctx.stage.dpr;
  let L = null;
  let imgData = null;

  const tipOf = (md, mm) => mm <= 0.001 ? (md === "pushbroom" ? "Peaks lean east or west, away from the nadir line. Scrub to move them back." : "Peaks lean away from the centre. Scrub to move each pixel back.")
    : mm >= 0.999 ? "Each pixel is on its ground point. Hatched ground is not in the photo."
    : "Each pixel slides from its image place to its ground place.";
  const wrapTip = (c, tip, s) => {
    c.font = `500 10.5px ${FONT_UI}`;
    const out = [];
    let line = "";
    for (const wd of tip.split(" ")) {
      const t = line ? line + " " + wd : wd;
      if (c.measureText(t).width > s && line) { out.push(line); line = wd; }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const notesOf = (md) => (md === "pushbroom" ? ["| nadir line: no lean along it", "| nadir line: no lean"] : ["+ principal point: no lean", "+ centre: no lean"]);
  const noteBeside = (c, md, s) => {
    c.font = `500 10px ${FONT_MONO}`;
    return c.measureText(notesOf(md)[0]).width <= s - (50 / (2 * A)) * s - 14 - c.measureText("50 mm").width;
  };
  const footFor = (c, img) => {
    const stacked = !["frame", "pushbroom"].every((md) => noteBeside(c, md, img));
    const lines = Math.max(...["frame", "pushbroom"].flatMap((md) => [0, 0.5, 1].map((mm) => wrapTip(c, tipOf(md, mm), img).length)));
    return { stacked, foot: Math.max(60, 46 + 14 * (lines - 1) + (stacked ? 15 : 0)) };
  };

  const layout = () => {
    const W = ctx.stage.width, Hs = ctx.stage.height - ctx.stage.insetBottom;
    const narrow = W < 640, head = 40, pad = 14, c = pc.getContext("2d");
    const avail = Hs - 2 * GAP - head - 60;
    let img = narrow ? Math.round(clamp(Math.min(W * 0.46 - 2 * pad, avail), 120, 220)) : Math.round(clamp(Math.min(W * 0.42 - 2 * pad, avail), 220, 640));
    let { stacked, foot } = footFor(c, img);
    if (narrow && head + img + foot > Hs - 2 * GAP) { img = Math.max(120, Hs - 2 * GAP - head - foot); ({ stacked, foot } = footFor(c, img)); }
    const pw = img + 2 * pad, ph = head + img + foot;
    const top = GAP + Math.max(0, (Hs - 2 * GAP - ph) / 2);
    L = { W, Hs, head, foot, pad, img, pw, ph, top, left: W - GAP - pw, stacked };
    panel.style.cssText = `position:absolute;inset:auto;left:${L.left}px;top:${top}px;width:${pw}px;height:${ph}px;pointer-events:auto;z-index:3;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.35);`;
    pc.width = Math.round(pw * dpr); pc.height = Math.round(ph * dpr);
    const n = clamp(Math.round(img * Math.min(dpr, 1.5)), 200, 560);
    if (!raster || raster.n !== n) { raster = makeRaster(n); raster0 = makeRaster(n); imgC.width = imgC.height = n; imgData = new ImageData(n, n); }
  };

  const recompute = () => {
    projectGrid(win.G, cam, mode, P);
    rasterize(P, 0, raster0);
    markHidden(P, raster0);
    peaks = findPeaks(T, cam, F * 0.92, 3, (E, N, Z) => { const r = projectRaw(cam, mode, E, N, Z); return !!r && Math.abs(r[0]) < A * 0.94 && Math.abs(r[1]) < A * 0.94; });
  };

  const shadeImage = () => {
    rasterize(P, m, raster);
    const n = raster.n, px = imgData.data, { cE, cN, half } = win, kt = TEX / (2 * half);
    const offE = cam.E - (cE - half), offN = cN + half - cam.N;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, o = i * 4;
      if (!raster.fill[i]) {
        const s = ((x + y) & 7) < 1 ? 22 : 14;
        px[o] = s; px[o + 1] = s + 4; px[o + 2] = s + 16; px[o + 3] = 255;
        continue;
      }
      const ti = clamp(Math.floor((raster.e[i] + offE) * kt), 0, TEX - 1), tj = clamp(Math.floor((offN - raster.nn[i]) * kt), 0, TEX - 1), q = (tj * TEX + ti) * 3;
      let r = texRGB[q], g = texRGB[q + 1], b = texRGB[q + 2];
      if (raster.hid[i] > 0.5) {
        const hatch = ((x - y) & 7) < 2;
        r = 34 + r * 0.12 + (hatch ? 22 : 0); g = 40 + g * 0.12 + (hatch ? 24 : 0); b = 66 + b * 0.12 + (hatch ? 34 : 0);
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    imgC.getContext("2d").putImageData(imgData, 0, 0);
  };

  const imgX = (xmm) => L.pad + ((xmm + A) / (2 * A)) * L.img;
  const imgY = (ymm) => L.head + ((A - ymm) / (2 * A)) * L.img;
  const at = (raw, ortho) => [raw[0] + (ortho[0] - raw[0]) * m, raw[1] + (ortho[1] - raw[1]) * m];

  const arrowHead = (c, x0, y0, x1, y1, size = 6) => {
    const a = Math.atan2(y1 - y0, x1 - x0);
    c.beginPath(); c.moveTo(x1, y1);
    c.lineTo(x1 - size * Math.cos(a - 0.45), y1 - size * Math.sin(a - 0.45));
    c.lineTo(x1 - size * Math.cos(a + 0.45), y1 - size * Math.sin(a + 0.45));
    c.closePath(); c.fill();
  };

  const drawPanel = () => {
    const c = pc.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, L.pw, L.ph);
    const x0 = L.pad, y0 = L.head, s = L.img;
    c.font = `600 10px ${FONT_UI}`; c.fillStyle = INK3; c.textAlign = "left"; c.textBaseline = "alphabetic";
    const state = m <= 0.001 ? "RAW IMAGE" : m >= 0.999 ? "ORTHO IMAGE" : `TO THE GROUND · ${Math.round(m * 100)} %`;
    c.fillStyle = m >= 0.999 ? BRASS : m <= 0.001 ? SIGNAL : INK;
    c.fillText(state, x0, 17);
    const kinds = mode === "pushbroom" ? ["PUSHBROOM · FLIGHT TO THE NORTH", "PUSHBROOM"] : ["FRAME CAMERA", "FRAME"];
    const kind = kinds.find((t) => c.measureText(t).width <= s - c.measureText(state).width - 12);
    c.textAlign = "right"; c.fillStyle = INK3;
    if (kind) c.fillText(kind, x0 + s, 17);
    c.textAlign = "left";
    c.font = `500 10px ${FONT_MONO}`; c.fillStyle = INK2;
    const sub = [`f 152 mm · 230 × 230 mm · 1 mm = ${fmtInt(cam.H / cam.f)} m at the datum`, `f 152 mm · 230 mm · 1 mm = ${fmtInt(cam.H / cam.f)} m on the datum`, `1 mm = ${fmtInt(cam.H / cam.f)} m on the datum`];
    c.fillText(sub.find((t) => c.measureText(t).width <= s) || sub[2], x0, 31);
    c.save();
    c.beginPath(); c.roundRect(x0, y0, s, s, 4); c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(imgC, x0, y0, s, s);
    const cx = imgX(0), cy = imgY(0);
    c.strokeStyle = "rgba(26,25,23,.22)"; c.lineWidth = 1; c.setLineDash([3, 5]);
    if (mode === "pushbroom") {
      c.beginPath(); c.moveTo(cx, y0); c.lineTo(cx, y0 + s); c.stroke();
    } else {
      for (const p of peaks) {
        const d = displacement(cam, mode, p.E, p.N, p.Z);
        if (!d) continue;
        const q = at(d.raw, d.ortho), len = Math.hypot(q[0], q[1]);
        if (len < 1) continue;
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(imgX((q[0] / len) * 2 * A), imgY((q[1] / len) * 2 * A)); c.stroke();
      }
    }
    c.setLineDash([]);
    if (mode === "pushbroom" && !ctx.reducedMotion) {
      const ys = imgY((sweep * cam.f) / cam.H);
      c.strokeStyle = "rgba(29,99,168,.85)"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x0, ys); c.lineTo(x0 + s, ys); c.stroke();
    }
    c.lineWidth = 1.5; c.font = `600 10.5px ${FONT_MONO}`;
    for (const p of peaks) {
      const d = displacement(cam, mode, p.E, p.N, p.Z);
      if (!d) continue;
      const q = at(d.raw, d.ortho);
      const tx = imgX(d.ortho[0]), ty = imgY(d.ortho[1]), qx = imgX(q[0]), qy = imgY(q[1]);
      c.strokeStyle = BRASS; c.fillStyle = BRASS;
      c.beginPath(); c.arc(tx, ty, 4.5, 0, Math.PI * 2); c.stroke();
      if (Math.hypot(qx - tx, qy - ty) > 7) {
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(qx, qy); c.stroke();
        arrowHead(c, tx, ty, qx, qy);
      }
      c.fillStyle = "rgba(250,248,243,.72)";
      const labels = [`h ${fmtSigned(d.h)} m · d ${d.d.toFixed(1)} mm`, `d ${d.d.toFixed(1)} mm`];
      const room = Math.max(x0 + s - 4 - (qx + 9), qx - 9 - (x0 + 4));
      const label = labels.find((t) => c.measureText(t).width + 10 <= room) || labels[1];
      const tw = c.measureText(label).width + 10;
      let lx = qx + 9, ly = qy - 9;
      if (lx + tw > x0 + s - 4) lx = qx - 9 - tw;
      lx = clamp(lx, x0 + 4, x0 + s - 4 - tw);
      ly = clamp(ly, y0 + 14, y0 + s - 6);
      c.beginPath(); c.roundRect(lx, ly - 12, tw, 16, 4); c.fill();
      c.fillStyle = BRASS; c.fillText(label, lx + 5, ly);
    }
    const mark = probe || null, hv = hoverPt;
    for (const [pt, col] of [[mark, BRASS], [hv, SIGNAL]]) {
      if (!pt || !pt.disp) continue;
      const d = pt.disp, q = at(d.raw, d.ortho);
      const tx = imgX(d.ortho[0]), ty = imgY(d.ortho[1]), qx = imgX(q[0]), qy = imgY(q[1]), rx = imgX(d.raw[0]), ry = imgY(d.raw[1]);
      c.strokeStyle = "rgba(184,82,23,.9)"; c.fillStyle = BRASS; c.lineWidth = 2;
      if (Math.hypot(rx - tx, ry - ty) > 3) { c.beginPath(); c.moveTo(tx, ty); c.lineTo(rx, ry); c.stroke(); arrowHead(c, tx, ty, rx, ry, 7); }
      c.strokeStyle = col; c.lineWidth = 2;
      c.beginPath(); c.arc(qx, qy, 7, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = "rgba(250,248,243,.8)"; c.lineWidth = 1;
      c.beginPath(); c.arc(qx, qy, 8.5, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
    c.strokeStyle = "rgba(107,102,94,.55)"; c.lineWidth = 1;
    c.beginPath(); c.roundRect(x0 + 0.5, y0 + 0.5, s - 1, s - 1, 4); c.stroke();
    c.fillStyle = INK2;
    for (const [fx, fy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const X = imgX(fx * A), Y = imgY(fy * A);
      c.beginPath();
      if (fy) { c.moveTo(X - 5, Y); c.lineTo(X + 5, Y); c.lineTo(X, Y - fy * 7); }
      else { c.moveTo(X, Y - 5); c.lineTo(X, Y + 5); c.lineTo(X + fx * 7, Y); }
      c.closePath(); c.fill();
    }
    c.strokeStyle = CAM; c.lineWidth = 1.5;
    if (mode === "pushbroom") {
      c.beginPath(); c.moveTo(cx, y0 - 4); c.lineTo(cx, y0 + 6); c.moveTo(cx, y0 + s - 6); c.lineTo(cx, y0 + s + 4); c.stroke();
    } else {
      c.beginPath(); c.moveTo(cx - 8, cy); c.lineTo(cx + 8, cy); c.moveTo(cx, cy - 8); c.lineTo(cx, cy + 8); c.stroke();
    }
    const fy = y0 + s + 18;
    c.font = `500 10px ${FONT_MONO}`; c.textAlign = "left";
    const mmPx = s / (2 * A), barMm = 50;
    c.strokeStyle = INK2; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x0, fy - 4); c.lineTo(x0, fy); c.lineTo(x0 + barMm * mmPx, fy); c.lineTo(x0 + barMm * mmPx, fy - 4); c.stroke();
    c.fillStyle = INK2; c.fillText(`${barMm} mm`, x0 + barMm * mmPx + 6, fy + 1);
    c.fillStyle = INK3;
    if (L.stacked) c.fillText(notesOf(mode).find((t) => c.measureText(t).width <= s) || notesOf(mode)[1], x0, fy + 16);
    else { c.textAlign = "right"; c.fillText(notesOf(mode)[0], x0 + s, fy + 1); c.textAlign = "left"; }
    wrapTip(c, tipOf(mode, m), s).forEach((t, i) => c.fillText(t, x0, fy + 20 + (L.stacked ? 15 : 0) + 14 * i));
  };

  const raySegs = [], edgeSegs = [], peakSegs = [];
  let rawFoot = [], orthoFoot = [];
  const hitModel = (hit, lift = 0.004) => M3(hit.E, hit.N, hit.Z, lift);
  const drapeSquare = (E0, N0, half, perSide = 28) => {
    const pts = [];
    const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    for (let s = 0; s < 4; s++) {
      const a = corners[s], b = corners[(s + 1) % 4];
      for (let k = 0; k < perSide; k++) {
        const t = k / perSide, E = E0 + (a[0] + (b[0] - a[0]) * t) * half, N = N0 + (a[1] + (b[1] - a[1]) * t) * half;
        pts.push([E, N]);
      }
    }
    pts.push(pts[0]);
    return pts;
  };

  const traceFootprints = () => {
    rawFoot = [];
    const per = 24;
    const edge = (x0, y0, x1, y1) => {
      for (let k = 0; k < per; k++) {
        const t = k / per, hit = rayToGround(T, cam, mode, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        rawFoot.push(hit);
      }
    };
    edge(-A, A, A, A); edge(A, A, A, -A); edge(A, -A, -A, -A); edge(-A, -A, -A, A);
    rawFoot.push(rawFoot[0]);
    orthoFoot = drapeSquare(cam.E, cam.N, F).map(([E, N]) => ({ E, N, Z: heightAtEN(T, E, N) }));
  };

  const camModel = () => M3(cam.E, cam.N, cam.Z);
  const sensorAt = (along) => M3(cam.E, cam.N + along, cam.Z);
  const vertTop = (hit) => M3(hit.E, hit.N, cam.Z);

  const rayLine = (from, hit) => {
    const g = hitModel(hit, 0.002), top = lerp3(from, vertTop(hit), m);
    return [top, lerp3(top, g, fanP)];
  };

  const drawRays = () => {
    const on = !!params.rays;
    const pc3 = camModel();
    raySegs.length = 0; edgeSegs.length = 0; peakSegs.length = 0;
    if (mode === "frame") {
      for (let j = 0; j < RAYS_N; j++) for (let i = 0; i < RAYS_N; i++) {
        const x = -A + ((i + 0.5) * 2 * A) / RAYS_N, y = -A + ((j + 0.5) * 2 * A) / RAYS_N;
        const hit = rayToGround(T, cam, mode, x, y);
        if (hit) raySegs.push(rayLine(pc3, hit));
      }
      for (const [x, y] of [[-A, -A], [A, -A], [A, A], [-A, A]]) {
        const hit = rayToGround(T, cam, mode, x, y);
        if (hit) edgeSegs.push(rayLine(pc3, hit));
      }
      for (const p of peaks) peakSegs.push(rayLine(pc3, p));
      globe.setLayer(PREFIX + "fan", false);
    } else {
      const sp = sensorAt(sweep), fan = [];
      let prev = null;
      const NF = 16;
      for (let i = 0; i <= NF; i++) {
        const x = -A + (i * 2 * A) / NF;
        const hit = rayToGround(T, cam, mode, x, (sweep * cam.f) / cam.H);
        if (!hit) { prev = null; continue; }
        const seg = rayLine(sp, hit);
        if (i % 4 === 0) (i === 0 || i === NF ? edgeSegs : raySegs).push(seg);
        if (prev) fan.push(...prev[0], ...prev[1], ...seg[1], ...seg[0], ...seg[1], ...prev[0]);
        prev = seg;
      }
      for (const p of peaks) peakSegs.push(rayLine(M3(cam.E, p.N, cam.Z), p));
      globe.setLayer(PREFIX + "fan", on && fan.length > 0);
      if (fan.length) globe.setTriangles(PREFIX + "fan", Float32Array.from(fan));
    }
    globe.setLayer(PREFIX + "rays", on && raySegs.length > 0);
    globe.setLayer(PREFIX + "edges", on && edgeSegs.length > 0);
    globe.setLayer(PREFIX + "peakRays", peakSegs.length > 0);
    if (raySegs.length) globe.setSegments3D(PREFIX + "rays", raySegs);
    if (edgeSegs.length) globe.setSegments3D(PREFIX + "edges", edgeSegs);
    if (peakSegs.length) globe.setSegments3D(PREFIX + "peakRays", peakSegs);
    globe.setLayer(PREFIX + "peakPts", peaks.length > 0);
    if (peaks.length) globe.setPoints3D(PREFIX + "peakPts", peaks.map((p) => hitModel(p, 0.006)));
  };

  const drawFootprints = () => {
    const segs = [];
    for (let i = 1; i < rawFoot.length; i++) {
      const a = rawFoot[i - 1], b = rawFoot[i];
      if (a && b) segs.push([hitModel(a, 0.006), hitModel(b, 0.006)]);
    }
    globe.setLayer(PREFIX + "footRaw", segs.length > 0);
    if (segs.length) globe.setSegments3D(PREFIX + "footRaw", segs, { opacity: 0.25 + 0.75 * (1 - m) });
    const os = [];
    for (let i = 1; i < orthoFoot.length; i++) os.push([hitModel(orthoFoot[i - 1], 0.006), hitModel(orthoFoot[i], 0.006)]);
    globe.setSegments3D(PREFIX + "footOrtho", os, { opacity: 0.35 + 0.65 * m });
  };

  const drawCamera = () => {
    const pc3 = camModel(), Lb = 0.09, a = (Lb * A) / FOCAL_MM;
    const segs = [];
    if (mode === "frame") {
      const film = [[-a, -a], [a, -a], [a, a], [-a, a]].map(([dx, dz]) => [pc3[0] + dx, pc3[1] + Lb, pc3[2] + dz]);
      for (let i = 0; i < 4; i++) { segs.push([pc3, film[i]]); segs.push([film[i], film[(i + 1) % 4]]); }
      globe.setLayer(PREFIX + "flight", false);
      globe.setLayer(PREFIX + "sensor", false);
    } else {
      const sp = sensorAt(sweep);
      segs.push([[sp[0] - a * 1.6, sp[1], sp[2]], [sp[0] + a * 1.6, sp[1], sp[2]]]);
      segs.push([[sp[0] - a * 1.6, sp[1] + Lb * 0.5, sp[2]], [sp[0] + a * 1.6, sp[1] + Lb * 0.5, sp[2]]]);
      segs.push([[sp[0] - a * 1.6, sp[1], sp[2]], [sp[0] - a * 1.6, sp[1] + Lb * 0.5, sp[2]]]);
      segs.push([[sp[0] + a * 1.6, sp[1], sp[2]], [sp[0] + a * 1.6, sp[1] + Lb * 0.5, sp[2]]]);
      globe.setLayer(PREFIX + "flight", true);
      globe.setSegments3D(PREFIX + "flight", [[sensorAt(-F * 1.15), sensorAt(F * 1.15)]]);
      globe.setLayer(PREFIX + "sensor", true);
      globe.setPoints3D(PREFIX + "sensor", [sp]);
    }
    globe.setSegments3D(PREFIX + "body", segs);
    globe.setPoints3D(PREFIX + "cam", [pc3]);
    label3D("cam", pc3, ctx.stage.width < 640 ? `H ${fmtInt(cam.H)} m` : `${mode === "pushbroom" ? "line sensor" : "camera"} · H ${fmtInt(cam.H)} m`, CAM, 14, -22);
  };

  const label3D = (name, p, text, color, dx = 12, dy = -18) => {
    const id = PREFIX + "label-" + name;
    if (!p) { if (globe.labels3d.has(id)) globe.setLabel3D(id, { visible: false }); return; }
    if (!globe.labels3d.has(id)) globe.addLabel3D(id, p, text, { color, dx, dy });
    else globe.setLabel3D(id, { point: p, text, color, dx, dy, visible: true });
  };

  const groundPoint = (E, N) => ({ E, N, Z: heightAtEN(T, E, N) });
  const seenFromSensor = (pt) => {
    const d = displacement(cam, mode, pt.E, pt.N, pt.Z);
    if (!d || Math.abs(d.raw[0]) > A || Math.abs(d.raw[1]) > A) return { d, seen: false, why: "out of the frame" };
    const hit = rayToGround(T, cam, mode, d.raw[0], d.raw[1]);
    const seen = !!hit && Math.hypot(hit.E - pt.E, hit.N - pt.N) < Math.max(2 * T.cell, 0.01 * cam.H);
    return { d, seen, why: seen ? "" : "hidden behind higher ground" };
  };

  const construction = (pt) => {
    if (!pt) { for (const id of HOVER_IDS) globe.setLayer(PREFIX + id, false); label3D("disp", null); return; }
    const d = pt.disp;
    const top = mode === "pushbroom" ? M3(cam.E, pt.N, cam.Z) : camModel();
    const P3 = M3(pt.E, pt.N, pt.Z, 0.003), P0 = M3(pt.E, pt.N, cam.datum);
    const k = cam.H / (cam.Z - pt.Z);
    const QE = cam.E + (pt.E - cam.E) * k, QN = mode === "pushbroom" ? pt.N : cam.N + (pt.N - cam.N) * k;
    const Q = M3(QE, QN, cam.datum);
    globe.setSegments3D(PREFIX + "hvRay", [[top, P3]]);
    globe.setLayer(PREFIX + "hvExt", d.h > 0);
    if (d.h > 0) globe.setSegments3D(PREFIX + "hvExt", [[P3, Q]]);
    globe.setSegments3D(PREFIX + "hvStick", [[P3, P0]]);
    globe.setSegments3D(PREFIX + "hvDisp", [[P0, Q]]);
    globe.setPoints3D(PREFIX + "hvPts", [P0, Q]);
    const y = yOf(cam.datum), h = F * S, cx = (cam.E - win.cE) * S, cz = -(cam.N - win.cN) * S;
    globe.setTriangles(PREFIX + "datum", Float32Array.from([cx - h, y, cz - h, cx + h, y, cz - h, cx + h, y, cz + h, cx - h, y, cz - h, cx + h, y, cz + h, cx - h, y, cz + h]));
    for (const id of HOVER_IDS) globe.setLayer(PREFIX + id, true);
    globe.setLayer(PREFIX + "hvExt", d.h > 0);
    label3D("disp", Q, ctx.stage.width < 640 ? `${fmtInt(d.ground)} m` : `${fmtInt(d.ground)} m on the datum`, BRASS, 12, 6);
  };

  const pointInfo = (E, N) => {
    const pt = groundPoint(E, N);
    const s = seenFromSensor(pt);
    if (!s.d) return null;
    return { ...pt, disp: s.d, seen: s.seen, why: s.why };
  };

  const chipLines = (pt) => {
    const d = pt.disp;
    const lines = [];
    if (mode === "pushbroom") lines.push(`across track ${d.across >= 0 ? "+" : "−"}${Math.abs(d.across).toFixed(2)} mm · along track 0.00 mm`);
    lines.push(`displacement ${d.d.toFixed(2)} mm on the image, ${fmtInt(d.ground)} m on the ground`);
    lines.push(`h ${fmtSigned(d.h)} m · ${mode === "pushbroom" ? "across-track distance" : "r"} ${d.r.toFixed(1)} mm · H ${fmtInt(cam.H)} m`);
    lines.push(`d = h · r / H = ${fmtSigned(d.h)} × ${d.r.toFixed(1)} / ${fmtInt(cam.H)} = ${((d.h * d.r) / cam.H).toFixed(2)} mm`);
    if (!pt.seen) lines.push(`not in the photo: ${pt.why}`);
    return lines;
  };

  const readouts = () => {
    const pt = probe;
    if (!pt) { ctx.readout.setMany({ disp: "–", r: "–", h: "–", H: cam.H }); return; }
    ctx.readout.setMany({ disp: pt.disp.ground, r: pt.disp.r, h: pt.disp.h, H: cam.H });
  };

  const autoProbe = () => {
    if (probe && !probe.auto) {
      const again = pointInfo(probe.E, probe.N);
      if (again && Math.abs(again.disp.ortho[0]) <= A && Math.abs(again.disp.ortho[1]) <= A) { probe = { ...again, auto: false }; return; }
    }
    const p = peaks[0];
    probe = p ? { ...pointInfo(p.E, p.N), auto: true } : null;
  };

  const fitPoints = () => {
    const pts = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) pts.push([x, yOf(win.zmax), z], [x, baseY(), z]);
    pts.push(camModel());
    if (mode === "pushbroom") pts.push(sensorAt(-F * 1.15), sensorAt(F * 1.15));
    return pts;
  };
  const frameAll = (duration = 0) => {
    if (ctx.side !== "A") return;
    const f = globe.camera.fit(fitPoints(), { padding: 30, insetTop: 34, insetBottom: ctx.stage.insetBottom, insetRight: L.pw + 2 * GAP, minDist: 1.6, apply: false });
    if (duration > 0 && !ctx.reducedMotion) globe.camera.glideTo(f, { duration });
    else { globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]); }
  };

  const draw3D = () => {
    drawCamera();
    drawRays();
    drawFootprints();
    construction(hoverPt || probe);
    globe.invalidate();
  };

  const refresh = () => {
    recompute();
    traceFootprints();
    autoProbe();
    shadeImage();
    drawPanel();
    draw3D();
    readouts();
    ctx.overlay.update();
  };

  const fanIn = () => {
    if (fanTw) fanTw.cancel();
    if (!booted || ctx.reducedMotion) { fanP = 1; drawRays(); return; }
    fanP = 0;
    fanTw = ctx.anim.tween({ from: 0, to: 1, duration: FAN_MS, ease: ctx.anim.ease.out, onUpdate: (v) => { fanP = v; drawRays(); globe.invalidate(); }, onDone: () => { fanTw = null; } });
  };

  const placeCamera = (E, N, { rebuild = false } = {}) => {
    F = footprintHalf(params.H);
    if (rebuild || !win) {
      const w0 = windowFor(E, N);
      setWindow(w0.cE, w0.cN, w0.half);
    }
    const c = clampCam(E, N);
    cam = makeCamera(T, c.E, c.N, params.H);
  };

  const recentre = () => {
    if (recentreTw) recentreTw.cancel();
    const target = windowFor(cam.E, cam.N);
    const from = { cE: win.cE, cN: win.cN };
    if (Math.hypot(target.cE - from.cE, target.cN - from.cN) < T.cell) return;
    const apply = (k) => {
      setWindow(from.cE + (target.cE - from.cE) * k, from.cN + (target.cN - from.cN) * k, target.half);
      refresh();
    };
    if (ctx.reducedMotion) { apply(1); return; }
    recentreTw = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.emph, onUpdate: apply, onDone: () => { recentreTw = null; frameAll(300); } });
  };

  const ownPick = (x, y) => {
    const { origin: o, dir: d } = globe.ray(x, y);
    let t0 = 0, t1 = 100;
    for (const [oo, dd, lo, hi] of [[o[0], d[0], -1, 1], [o[1], d[1], yOf(win.zmin) - 0.01, yOf(win.zmax) + 0.01], [o[2], d[2], -1, 1]]) {
      if (Math.abs(dd) < 1e-12) { if (oo < lo || oo > hi) return null; continue; }
      let a = (lo - oo) / dd, b = (hi - oo) / dd;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    }
    if (t1 <= t0) return null;
    const toEN = (p) => ({ E: win.cE + p[0] / S, N: win.cN - p[2] / S });
    const above = (t) => { const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]; const g = toEN(p); return p[1] - yOf(heightAtEN(T, g.E, g.N)); };
    const dt = 0.004;
    let prev = t0;
    if (above(t0) < 0) return null;
    for (let t = t0 + dt; t <= t1 + dt; t += dt) {
      const tt = Math.min(t, t1);
      if (above(tt) < 0) {
        let a = prev, b = tt;
        for (let k = 0; k < 18; k++) { const mid = (a + b) / 2; if (above(mid) < 0) b = mid; else a = mid; }
        const g = toEN([o[0] + d[0] * b, o[1] + d[1] * b, o[2] + d[2] * b]);
        const [lon, lat] = llOf(g.E, g.N);
        return { lon, lat, E: g.E, N: g.N };
      }
      prev = tt;
      if (tt >= t1) break;
    }
    return null;
  };
  const ownProject = (lon, lat) => {
    const p = enOf([lon, lat]);
    const inside = Math.abs(p.E - win.cE) <= win.half && Math.abs(p.N - win.cN) <= win.half;
    const s = globe.projectPoint(M3(p.E, p.N, heightAtEN(T, p.E, p.N), 0.004), false);
    return { x: s.x, y: s.y, visible: inside && s.visible };
  };
  globe.pick = ownPick;
  globe.project = ownProject;

  const offHover = globe.on("hover", (hv) => { if (!hv && hoverPt) { hoverPt = null; construction(probe); drawPanel(); } });

  const panelPos = (e) => { const r = panel.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pixelAt = (px, py) => {
    const fx = (px - L.pad) / L.img, fy = (py - L.head) / L.img;
    if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
    const n = raster.n, i = Math.floor(fy * n) * n + Math.floor(fx * n);
    if (!raster.fill[i]) return { empty: true };
    return pointInfo(cam.E + raster.e[i], cam.N + raster.nn[i]);
  };
  panel.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    const [px, py] = panelPos(e);
    const pt = pixelAt(px, py);
    if (!pt || pt.empty) {
      hoverPt = null; construction(probe); drawPanel();
      if (pt && pt.empty) ctx.overlay.chip(L.left + px, L.top + py, ["no ground data here"]); else ctx.overlay.hideChip();
      return;
    }
    hoverPt = pt;
    construction(pt);
    drawPanel();
    ctx.overlay.chip(L.left + px, L.top + py, chipLines(pt));
  }, { signal: ctx.signal });
  panel.addEventListener("pointerleave", () => { hoverPt = null; ctx.overlay.hideChip(); construction(probe); drawPanel(); }, { signal: ctx.signal });
  panel.addEventListener("click", (e) => {
    const [px, py] = panelPos(e);
    const pt = pixelAt(px, py);
    if (!pt || pt.empty) return;
    probe = { ...pt, auto: false };
    readouts(); construction(hoverPt || probe); drawPanel();
  }, { signal: ctx.signal });
  for (const ev of ["pointerdown", "wheel", "dblclick"]) panel.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onHandle = (x, y) => { const s = globe.projectPoint(camModel(), false); return isFinite(s.x) && Math.hypot(s.x - x, s.y - y) < 18; };
  const el = ctx.stage.el;
  if (ctx.side === "A") {
    el.addEventListener("dblclick", (e) => { if (!e.target.closest(".or-panel")) e.stopPropagation(); }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".or-panel") || e.target.closest(".transport")) return;
      const [x, y] = stagePos(e);
      if (!onHandle(x, y)) return;
      e.stopPropagation(); e.preventDefault();
      if (recentreTw) { recentreTw.cancel(); recentreTw = null; }
      const s = globe.projectPoint(M3(cam.E, cam.N, cam.datum), false), c = globe.projectPoint(camModel(), false);
      dragging = { id: e.pointerId, dx: s.x - c.x, dy: s.y - c.y };
      ctx.overlay.hideChip();
      hoverPt = null;
      globe.canvas.style.cursor = "grabbing";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      if (e.target.closest && e.target.closest(".or-panel")) return;
      const [x, y] = stagePos(e);
      if (!dragging) { if (onHandle(x, y)) globe.canvas.style.cursor = "grab"; return; }
      if (e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const p = ownPick(x + dragging.dx, y + dragging.dy);
      if (!p) return;
      const c = clampCam(p.E, p.N);
      const ll = llOf(c.E, c.N);
      ctx.controls.set("cam", [+ll[0].toFixed(4), +ll[1].toFixed(4)], { live: true });
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      dragging = null;
      globe.canvas.style.cursor = "grab";
      ctx.controls.set("cam", params.cam.slice());
      recentre();
      fanIn();
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
  }

  layout();
  {
    const p = enOf(params.cam);
    placeCamera(p.E, p.N, { rebuild: true });
  }
  refresh();
  frameAll(0);
  setTimeout(() => { if (!dragging) { layout(); frameAll(0); drawPanel(); } }, 600);
  setTimeout(() => { booted = true; fanIn(); }, 0);

  if (ctx.transport) ctx.transport.onScrub((v) => {
    m = clamp(v, 0, 1);
    shadeImage();
    drawPanel();
    drawRays();
    drawFootprints();
    globe.invalidate();
    if (m >= 0.999) ctx.done();
  });

  let lastSweepDraw = 0;
  return {
    update(p, keys) {
      params = { ...p };
      const all = keys.length === 0 || keys.length > 3;
      const modeChanged = mode !== params.camera;
      mode = params.camera;
      if (keys.includes("m")) m = clamp(+params.m || 0, 0, 1);
      if (all || keys.includes("H") || keys.includes("cam") || modeChanged) {
        const pp = enOf(params.cam);
        const hChanged = all || keys.includes("H");
        if (hChanged && !dragging) placeCamera(pp.E, pp.N, { rebuild: true });
        else { F = footprintHalf(params.H); const c = clampCam(pp.E, pp.N); cam = makeCamera(T, c.E, c.N, params.H); }
        if (!dragging && !hChanged && keys.includes("cam") && !all) recentre();
      }
      if (keys.includes("exag") && !all) buildTerrain3D();
      refresh();
      if (mode === "pushbroom") ctx.anim.loop.invalidate();
      if (booted && (modeChanged || keys.includes("H")) && !dragging) fanIn();
      if (all || keys.includes("H") || keys.includes("exag") || modeChanged) frameAll(booted && !all ? 380 : 0);
    },
    hover(lon, lat) {
      if (dragging) return [];
      const g = enOf([lon, lat]);
      if (Math.abs(g.E - win.cE) > win.half || Math.abs(g.N - win.cN) > win.half) return [];
      const pt = pointInfo(g.E, g.N);
      if (!pt) { hoverPt = null; construction(probe); drawPanel(); return ["above the camera: no image"]; }
      hoverPt = pt;
      construction(pt);
      drawPanel();
      return chipLines(pt);
    },
    probe(lon, lat) {
      const g = enOf([lon, lat]);
      if (Math.abs(g.E - win.cE) > win.half || Math.abs(g.N - win.cN) > win.half) return null;
      const pt = pointInfo(g.E, g.N);
      if (!pt) return null;
      probe = { ...pt, auto: false };
      construction(hoverPt || probe);
      drawPanel();
      return { disp: pt.disp.ground, r: pt.disp.r, h: pt.disp.h, H: cam.H };
    },
    unprobe() {
      probe = null;
      autoProbe();
      readouts();
      construction(hoverPt || probe);
      drawPanel();
    },
    frame(dt, t) {
      if (mode !== "pushbroom" || ctx.reducedMotion || dragging) return;
      const u = (t / SWEEP_S) % 1;
      sweep = F * (2 * u - 1);
      drawCamera();
      if (params.rays || peaks.length) drawRays();
      if (t - lastSweepDraw > 1 / 40) { drawPanel(); lastSweepDraw = t; }
      globe.invalidate();
      ctx.anim.loop.invalidate();
    },
    resize() { layout(); shadeImage(); drawPanel(); draw3D(); frameAll(0); },
    unmount() {
      for (const tw of [fanTw, recentreTw]) if (tw) tw.cancel();
      offHover();
      delete globe.pick;
      delete globe.project;
      globe.removePrefix(PREFIX);
      for (const k of Object.keys(savedLayers)) globe.setLayer(k, k === "labels" ? savedLayers[k] : true);
      globe.canvas.style.cursor = "grab";
      ctx.overlay.clear(PREFIX);
    },
  };
}
