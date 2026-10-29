import { lonLatToXYZ, xyzToLonLat } from "@/core/globe.js";
import { WIDTH as TEX_W, HEIGHT as TEX_H } from "@/core/basemap.js";
import { clamp, lerp, mod, quat } from "@/core/math.js";
import { drawCaption, FONT_UI, FONT_MONO } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const ERR = "#b42335";
const WARN = "#b7791f";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const WCOL = [BRASS, SIGNAL, VIOLET];

export const SPAN = 60;
export const LAT_C = 40;
export const MID_LAT = 60;

export const meta = {
  id: "texture-uv",
  title: "What the GPU does with a map",
  track: 6,
  order: 13,
  mode: "3d",
  renderer: "webgl",
  labels: false,
  paragraph: "A renderer draws triangles. Each corner carries a texture coordinate, u and v, that says where it sits on the image. Inside a triangle the GPU blends the corners' u and v with three weights. The weights add to one. Inside one triangle that blend is flat, so a map on a sphere is many flat pieces.",
  deeper: [
    "Weights at the centroid are 1/3 each.",
    "A 256 × 128 sphere has 65,024 triangles.",
    "The seam at 180° needs duplicate vertices.",
    "Mipmaps are overviews for textures.",
  ],
  keywords: ["texture", "UV", "barycentric", "triangle", "mesh", "seam", "mipmap", "GPU"],
  controls: [
    { key: "mesh", type: "segment", label: "Mesh", options: [{ value: "patch4", label: "4 × 4 patch" }, { value: "patch16", label: "16 × 16" }, { value: "globe", label: "Full globe" }], default: "patch4" },
    { key: "res", type: "range", label: "Globe columns", min: 4, max: 256, step: 4, default: 32, ticks: [4, 64, 128, 192, 256] },
    { key: "lon0", type: "range", label: "Centre longitude", min: -180, max: 180, step: 15, default: 30, unit: "°", fillFrom: 0, ticks: [-180, -90, 0, 90, 180] },
    { key: "split", type: "toggle", label: "Duplicate seam vertices", default: true, shortcut: "s" },
    { type: "group", label: "Display" },
    { key: "wire", type: "toggle", label: "Wireframe", default: true, shortcut: "w" },
    { key: "showWeights", type: "toggle", label: "Weights", default: true, shortcut: "b" },
    { key: "reset", type: "button", label: "Reset UVs", icon: "i-refresh" },
    { type: "legend", label: "Key", items: [{ color: BRASS, label: "w1: piece across from corner 1" }, { color: SIGNAL, label: "w2: piece across from corner 2" }, { color: VIOLET, label: "w3: piece across from corner 3" }, { color: ERR, label: "Seam triangle" }, { color: WARN, label: "Pole triangle" }] },
  ],
  readouts: [
    { key: "uv", label: "u, v at pointer", mono: true },
    { key: "w", label: "Weights w1 w2 w3", mono: true },
    { key: "sampled", label: "Sampled lon/lat", mono: true },
    { key: "tris", label: "Triangles", digits: 0 },
    { key: "err", label: "Error at pointer", digits: 2, unit: "texels" },
    { key: "maxErr", label: "Max error", digits: 2, unit: "texels", hero: true },
  ],
  transport: null,
  compare: null,
  view: { lon: 30, lat: 40, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
const wrap180 = (d) => mod(d + 180, 360) - 180;

export function uvOf(lon, lat) {
  return [(lon + 180) / 360, (90 - lat) / 180];
}

export function lonLatOfUV(u, v) {
  return [mod(u * 360, 360) - 180, 90 - v * 180];
}

export function texelError(uA, vA, uB, vB, w = TEX_W, h = TEX_H) {
  let du = uA - uB;
  du -= Math.round(du);
  return Math.hypot(du * w, (vA - vB) * h);
}

export function globeTriangleCount(cols, rows = cols / 2) {
  return cols * (2 * rows - 2);
}

function patchMesh(n, lon0, split) {
  const N = (n + 1) * (n + 1);
  const lon = new Float64Array(N), lat = new Float64Array(N), pole = new Uint8Array(N);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    lon[j * (n + 1) + i] = lon0 - SPAN / 2 + (SPAN * i) / n;
    lat[j * (n + 1) + i] = LAT_C + SPAN / 2 - (SPAN * j) / n;
  }
  const tri = [], row = [], quad = [], col = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    tri.push(a, c, b, b, c, d);
    row.push(j, j); quad.push(0, 1); col.push(i, i);
  }
  return finish({ kind: "patch", n, cols: n, rows: n, lon, lat, pole, tri, row, quad, col, split, lon0 });
}

function globeMesh(cols, split) {
  const R = Math.max(2, Math.round(cols / 2));
  const N = cols * (R + 1);
  const lon = new Float64Array(N), lat = new Float64Array(N), pole = new Uint8Array(N);
  const np = (i) => i, mid = (j, i) => cols + (j - 1) * cols + mod(i, cols), sp = (i) => cols + (R - 1) * cols + i;
  for (let i = 0; i < cols; i++) {
    const lc = -180 + ((i + 0.5) * 360) / cols;
    lon[np(i)] = lc; lat[np(i)] = 90; pole[np(i)] = 1;
    lon[sp(i)] = lc; lat[sp(i)] = -90; pole[sp(i)] = 1;
    for (let j = 1; j < R; j++) { lon[mid(j, i)] = -180 + (i * 360) / cols; lat[mid(j, i)] = 90 - (180 * j) / R; }
  }
  const tri = [], row = [], quad = [], col = [];
  for (let j = 0; j < R; j++) for (let i = 0; i < cols; i++) {
    if (j === 0) { tri.push(np(i), mid(1, i), mid(1, i + 1)); row.push(j); quad.push(0); col.push(i); }
    else if (j === R - 1) { tri.push(mid(j, i), sp(i), mid(j, i + 1)); row.push(j); quad.push(1); col.push(i); }
    else {
      const a = mid(j, i), b = mid(j, i + 1), c = mid(j + 1, i), d = mid(j + 1, i + 1);
      tri.push(a, c, b, b, c, d); row.push(j, j); quad.push(0, 1); col.push(i, i);
    }
  }
  return finish({ kind: "globe", n: cols, cols, rows: R, lon, lat, pole, tri, row, quad, col, split, lon0: 0 });
}

function finish(m) {
  const N = m.lon.length;
  m.N = N;
  m.tri = Int32Array.from(m.tri);
  m.row = Int32Array.from(m.row); m.quad = Int8Array.from(m.quad); m.col = Int32Array.from(m.col);
  m.T = m.tri.length / 3;
  m.pos = new Float64Array(N * 3);
  const p = [0, 0, 0];
  for (let k = 0; k < N; k++) { lonLatToXYZ(m.lon[k], m.lat[k], p); m.pos[k * 3] = p[0]; m.pos[k * 3 + 1] = p[1]; m.pos[k * 3 + 2] = p[2]; }
  m.uv0 = new Float64Array(m.T * 6);
  for (let t = 0; t < m.T; t++) {
    let ref = null;
    for (let q = 0; q < 3; q++) if (!m.pole[m.tri[t * 3 + q]]) { ref = m.lon[m.tri[t * 3 + q]]; break; }
    if (ref === null) ref = m.lon[m.tri[t * 3]];
    const uRef = mod(ref + 180, 360) / 360;
    for (let q = 0; q < 3; q++) {
      const k = m.tri[t * 3 + q];
      m.uv0[t * 6 + q * 2] = m.split ? uRef + wrap180(m.lon[k] - ref) / 360 : mod(m.lon[k] + 180, 360) / 360;
      m.uv0[t * 6 + q * 2 + 1] = (90 - m.lat[k]) / 180;
    }
  }
  m.poleTri = new Uint8Array(m.T); m.midTri = new Uint8Array(m.T);
  for (let t = 0; t < m.T; t++) {
    let anyPole = 0, allMid = 1;
    for (let q = 0; q < 3; q++) { const k = m.tri[t * 3 + q]; if (m.pole[k]) anyPole = 1; if (Math.abs(m.lat[k]) > MID_LAT + 1e-9) allMid = 0; }
    m.poleTri[t] = anyPole; m.midTri[t] = allMid && !anyPole ? 1 : 0;
  }
  return m;
}

export function buildMesh({ mesh = "patch4", cols = 32, lon0 = 30, split = true } = {}) {
  if (mesh === "globe") return globeMesh(cols, split);
  return patchMesh(mesh === "patch16" ? 16 : 4, lon0, split);
}

export function uvWithEdits(m, edits = null) {
  const uv = Float64Array.from(m.uv0);
  if (!edits) return uv;
  for (let t = 0; t < m.T; t++) for (let q = 0; q < 3; q++) {
    const k = m.tri[t * 3 + q], e = edits.get(k);
    if (e) { uv[t * 6 + q * 2] += e[0]; uv[t * 6 + q * 2 + 1] += e[1]; }
  }
  return uv;
}

export function isSeamTri(uv, t) {
  const a = uv[t * 6], b = uv[t * 6 + 2], c = uv[t * 6 + 4];
  return Math.max(a, b, c) - Math.min(a, b, c) > 0.5;
}

export function pointAt(m, t, w, out = [0, 0, 0]) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (let q = 0; q < 3; q++) { const k = m.tri[t * 3 + q]; for (let c = 0; c < 3; c++) out[c] += w[q] * m.pos[k * 3 + c]; }
  return out;
}

export function interpUV(uv, t, w) {
  return [w[0] * uv[t * 6] + w[1] * uv[t * 6 + 2] + w[2] * uv[t * 6 + 4], w[0] * uv[t * 6 + 1] + w[1] * uv[t * 6 + 3] + w[2] * uv[t * 6 + 5]];
}

export function exactUV(P) {
  const ll = xyzToLonLat(P[0], P[1], P[2]);
  return uvOf(ll[0], ll[1]);
}

export function errorAt(m, uv, t, w) {
  const P = pointAt(m, t, w);
  const r = Math.hypot(P[0], P[1], P[2]);
  if (Math.hypot(P[0], P[2]) < 1e-9 * r) return 0;
  const e = exactUV(P), i = interpUV(uv, t, w);
  return texelError(i[0], i[1], e[0], e[1]);
}

export const SAMPLES = (() => {
  const s = [], n = 6, d = 1e-3;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) s.push([i / n, j / n, (n - i - j) / n]);
  for (let c = 0; c < 3; c++) {
    const a = (c + 1) % 3, b = (c + 2) % 3;
    for (const [x, y] of [[d, 0], [0, d], [d / 2, d / 2]]) { const w = [0, 0, 0]; w[c] = 1 - d; w[a] = x; w[b] = y; s.push(w); }
  }
  return s;
})();

export function triangleError(m, uv, t) {
  let mx = 0;
  for (const w of SAMPLES) { const e = errorAt(m, uv, t, w); if (e > mx) mx = e; }
  return mx;
}

export function meshErrors(m, uv, { symmetric = false } = {}) {
  const errs = new Float64Array(m.T);
  const cache = new Map();
  for (let t = 0; t < m.T; t++) {
    if (symmetric && m.kind === "globe" && !isSeamTri(uv, t)) {
      const key = m.row[t] * 2 + m.quad[t];
      let e = cache.get(key);
      if (e === undefined) { e = triangleError(m, uv, t); cache.set(key, e); }
      errs[t] = e;
    } else errs[t] = triangleError(m, uv, t);
  }
  return errs;
}

export function summarize(m, uv, errs) {
  const out = { max: 0, mid: 0, pole: 0, seam: 0, seamCount: 0 };
  for (let t = 0; t < m.T; t++) {
    const e = errs[t];
    if (e > out.max) out.max = e;
    if (isSeamTri(uv, t)) { out.seamCount++; if (e > out.seam) out.seam = e; }
    else if (m.poleTri[t]) { if (e > out.pole) out.pole = e; }
    else if (m.midTri[t] && e > out.mid) out.mid = e;
  }
  return out;
}

export function rayHit(m, o, d) {
  let best = null;
  const P = m.pos, Tr = m.tri;
  for (let t = 0; t < m.T; t++) {
    const a = Tr[t * 3] * 3, b = Tr[t * 3 + 1] * 3, c = Tr[t * 3 + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det;
    const sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2];
    const b1 = (sx * px + sy * py + sz * pz) * inv;
    if (b1 < -1e-9 || b1 > 1 + 1e-9) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const b2 = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (b2 < -1e-9 || b1 + b2 > 1 + 1e-9) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist <= 1e-9 || (best && dist >= best.dist)) continue;
    best = { t, w: [1 - b1 - b2, b1, b2], dist };
  }
  return best;
}

export function radialHit(m, lon, lat) {
  return rayHit(m, [0, 0, 0], lonLatToXYZ(lon, lat));
}

export function uvHit(m, uv, u, v) {
  let best = null;
  for (let t = 0; t < m.T; t++) {
    const ax = uv[t * 6], ay = uv[t * 6 + 1], bx = uv[t * 6 + 2], by = uv[t * 6 + 3], cx = uv[t * 6 + 4], cy = uv[t * 6 + 5];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-14) continue;
    const area = Math.abs(den);
    if (best && area >= best.area) continue;
    for (let k = -1; k <= 1; k++) {
      const x = u + k;
      const w0 = ((by - cy) * (x - cx) + (cx - bx) * (v - cy)) / den;
      const w1 = ((cy - ay) * (x - cx) + (ax - cx) * (v - cy)) / den;
      const w2 = 1 - w0 - w1;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) { best = { t, w: [w0, w1, w2], area }; break; }
    }
  }
  return best;
}

export function sampledLonLat(uv, t, w) {
  const i = interpUV(uv, t, w);
  return lonLatOfUV(i[0], i[1]);
}

export function nodeUV(m, uv, k) {
  const out = [];
  for (let t = 0; t < m.T; t++) for (let q = 0; q < 3; q++) if (m.tri[t * 3 + q] === k) {
    const u = uv[t * 6 + q * 2], v = uv[t * 6 + q * 2 + 1];
    if (!out.some((p) => Math.abs(p[0] - u) < 1e-9 && Math.abs(p[1] - v) < 1e-9)) out.push([u, v]);
  }
  return out;
}

let CURVE = null;
export function errorCurve() {
  if (CURVE) return CURVE;
  const pts = [];
  for (let cols = 4; cols <= 256; cols += 4) {
    const m = globeMesh(cols, true);
    const uv = m.uv0;
    const s = summarize(m, uv, meshErrors(m, uv, { symmetric: true }));
    pts.push({ cols, tris: m.T, mid: s.mid, pole: s.pole });
  }
  CURVE = pts;
  return pts;
}

let IMG = null;
function textureImage(bm) {
  if (IMG && IMG.src === bm.color) return IMG.canvas;
  const c = document.createElement("canvas");
  c.width = bm.width; c.height = bm.height;
  const data = new Uint8ClampedArray(bm.color.buffer, bm.color.byteOffset, bm.width * bm.height * 4);
  c.getContext("2d").putImageData(new ImageData(data, bm.width, bm.height), 0, 0);
  IMG = { src: bm.color, canvas: c };
  return c;
}

export const COMPACT_W = 640;

function compactLayout(W, usableH, insetBottom) {
  const pad = 12, ip = 10, swH = 34, gap = 6, axisH = 16, foot = 6, colGap = 10, colMin = 96;
  const capLines = usableH < 400 ? 2 : 3;
  const top = 14 + 18 + 17 * capLines + 6;
  const bottom = usableH - pad;
  const chrome = ip + swH + gap + axisH + foot;
  const pw = W - 2 * pad;
  const th = Math.round(clamp((bottom - top) * 0.56 - chrome, 48, (pw - 2 * ip - colGap - colMin) / 2));
  const tw = 2 * th, ph = chrome + th;
  const panel = { x: pad, y: bottom - ph, w: pw, h: ph };
  const bodyY = ip + swH + gap;
  return {
    side: false, compact: true, capLines, top, panel,
    tex: { x: ip, y: bodyY, w: tw, h: th },
    col: { x: ip + tw + colGap, y: bodyY, w: pw - 2 * ip - tw - colGap, h: th },
    chart: { x: ip, y: bodyY, w: pw - 2 * ip, h: th + axisH },
    sw: { x: panel.x + ip, y: panel.y + ip, w: pw - 2 * ip, h: swH },
    insetRight: 0, insetBottom: insetBottom + pad + ph + 4,
  };
}

export function layoutFor(W, H, insetBottom = 0) {
  const pad = 16, head = 22;
  const usableH = H - insetBottom;
  if (W < COMPACT_W) return compactLayout(W, usableH, insetBottom);
  if (W >= 1.25 * usableH) {
    const pw = Math.round(Math.min(W * 0.5, (usableH - 2 * pad) * 1.25));
    const tw = pw - 2 * pad, th = Math.round(tw / 2);
    const ch = Math.round(clamp(th * 0.42, 140, 240));
    const ph = head + th + 40 + head + ch + 2 * pad - 4;
    const panel = { x: W - pw - pad, y: Math.max(pad, Math.round((usableH - ph) / 2)), w: pw, h: ph };
    return { side: true, panel, tex: { x: pad, y: pad + head, w: tw, h: th }, chart: { x: pad, y: pad + head + th + 40 + head, w: tw, h: ch }, insetRight: pw + 2 * pad, insetBottom: insetBottom };
  }
  const pw = W - 2 * pad;
  const tw = Math.round((pw - 3 * pad) * 0.64), th = Math.round(tw / 2);
  const cw = pw - 3 * pad - tw;
  const ph = head + th + 2 * pad + 30;
  const panel = { x: pad, y: usableH - ph - pad, w: pw, h: ph };
  return { side: false, panel, tex: { x: pad, y: pad + head, w: tw, h: th }, chart: { x: 2 * pad + tw, y: pad + head, w: cw, h: th }, insetRight: 0, insetBottom: insetBottom + ph + pad };
}

const f3 = (x) => x.toFixed(3);
const fmtDeg = (x, pos, neg) => `${Math.abs(x).toFixed(1)}°${x < 0 ? neg : pos}`;

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const stage = ctx.stage;
  let params = { ...ctx.params };
  let M = null, UV = null, ERRS = null, SUM = null;
  const edits = new Map();
  let pinned = null, hovered = null;
  let pulse = 0, pulseTw = null, camTw = null;
  let booted = false;
  let L = layoutFor(stage.width, stage.height, stage.insetBottom);
  let baseCanvas = null;
  let drag = null;

  if (globe.ready) await globe.ready;
  const prevLayers = { surface: globe.layers.surface, atmosphere: globe.layers.atmosphere, coast: globe.layers.coast, graticule: globe.layers.graticule };
  for (const k of Object.keys(prevLayers)) globe.setLayer(k, false);
  const ownPick = (x, y) => {
    if (!M) return null;
    const r = globe.ray(x, y);
    const hit = rayHit(M, r.origin, r.dir);
    if (!hit) return null;
    const P = pointAt(M, hit.t, hit.w);
    const ll = xyzToLonLat(P[0], P[1], P[2]);
    return { lon: ll[0], lat: ll[1] };
  };
  globe.pick = ownPick;

  const capCanvas = stage.canvas("texture-uv-cap");
  capCanvas.style.pointerEvents = "none";
  const panelEl = stage.element("div", "texture-uv-panel");
  panelEl.style.cssText = "position:absolute;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:3;touch-action:none;";
  const panelCanvas = document.createElement("canvas");
  panelCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  panelEl.append(panelCanvas);

  const PANES = { texture: "Texture", error: "Max error" };
  let pane = ctx.url && ctx.url.get("pane") === "error" ? "error" : "texture";
  const sw = stage.element("div", "segment texture-uv-switch");
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "Panel to show");
  sw.style.cssText = "inset:auto;display:none;box-sizing:border-box;height:34px;padding:2px;gap:2px;z-index:5;pointer-events:auto;";
  sw.addEventListener("pointerdown", (e) => e.stopPropagation(), { signal: ctx.signal });
  const swBtns = Object.fromEntries(Object.keys(PANES).map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.textContent = PANES[k];
    b.style.cssText = "flex:1 1 0;height:28px;padding:0 10px;";
    b.addEventListener("click", () => {
      if (pane === k) return;
      pane = k;
      if (ctx.side === "A" && ctx.url) ctx.url.set("pane", k === "texture" ? null : k);
      hovered = null;
      ctx.overlay.hideChip();
      baseCanvas = null;
      syncSwitch();
      redraw();
    }, { signal: ctx.signal });
    sw.append(b);
    return [k, b];
  }));
  let swW = 0;
  const syncSwitch = () => {
    sw.style.display = L.compact ? "flex" : "none";
    if (!L.compact) return;
    const g = capCanvas.getContext("2d");
    g.font = `500 12.5px ${FONT_UI}`;
    const bw = Math.ceil(Math.max(...Object.values(PANES).map((t) => g.measureText(t).width))) + 22;
    swW = Math.min(L.sw.w, 2 * bw + 8);
    Object.assign(sw.style, { left: L.sw.x + "px", top: L.sw.y + "px", width: swW + "px", height: L.sw.h + "px" });
    for (const [k, b] of Object.entries(swBtns)) {
      b.classList.toggle("on", k === pane);
      b.setAttribute("aria-pressed", String(k === pane));
    }
  };
  const texOn = () => !L.compact || pane === "texture";
  const chartOn = () => !L.compact || pane === "error";
  const fitText = (g, options, maxW) => options.find((o) => g.measureText(o).width <= maxW) ?? options[options.length - 1];
  const wrapText = (g, text, maxW) => {
    const out = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && g.measureText(next).width > maxW) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };

  const imgCanvas = globe.basemap ? textureImage(globe.basemap) : null;

  const handleR = () => {
    if (!L.compact) return 2.6;
    const gap = L.tex.w * (M.kind === "patch" ? SPAN / 360 / M.n : 1 / M.cols);
    return gap < 4 ? 0 : clamp(gap * 0.3, 1.2, 2.6);
  };
  const handlesOn = () => M.N <= 700 && handleR() > 0;

  const rebuild = () => {
    M = buildMesh({ mesh: params.mesh, cols: params.res, lon0: params.lon0, split: params.split });
    edits.clear();
    pinned = defaultFocus();
    hovered = null;
    refreshUV(true);
    draw3DMesh();
    drawWire3D();
  };

  const defaultFocus = () => {
    const h = radialHit(M, params.lon0 + 0.37 * (SPAN / M.cols), LAT_C + 0.21 * (SPAN / M.cols));
    if (!h) return { t: 0, w: [1 / 3, 1 / 3, 1 / 3] };
    return { t: h.t, w: [1 / 3, 1 / 3, 1 / 3] };
  };

  const refreshUV = (all = false, touched = null) => {
    UV = uvWithEdits(M, edits.size ? edits : null);
    if (all || !ERRS) ERRS = meshErrors(M, UV, { symmetric: !edits.size });
    else if (touched) {
      for (let t = 0; t < M.T; t++) for (let q = 0; q < 3; q++) if (touched.has(M.tri[t * 3 + q])) { ERRS[t] = triangleError(M, UV, t); break; }
    }
    SUM = summarize(M, UV, ERRS);
    baseCanvas = null;
  };

  const meshMesh = () => globe.extra.get(PREFIX + "mesh");

  const draw3DMesh = () => {
    const pos = new Float32Array(M.T * 9);
    for (let t = 0; t < M.T; t++) for (let q = 0; q < 3; q++) { const k = M.tri[t * 3 + q]; for (let c = 0; c < 3; c++) pos[t * 9 + q * 3 + c] = M.pos[k * 3 + c]; }
    const mesh = globe.addTriangles(PREFIX + "mesh", pos, { color: "#ffffff", lit: true, flat: true, order: 0 });
    const attr = mesh.geometry.attributes.position;
    mesh.geometry.setAttribute("uv", new attr.constructor(Float32Array.from(UV), 2));
    mesh.material.map = globe.textures ? globe.textures.color : null;
    mesh.material.roughness = 0.92;
    mesh.material.emissiveMap = mesh.material.map;
    mesh.material.emissive.set(0xffffff);
    mesh.material.emissiveIntensity = 0.32;
    mesh.material.needsUpdate = true;
    globe.invalidate();
  };

  const pushUV3D = () => {
    const mesh = meshMesh();
    if (!mesh) return;
    const a = mesh.geometry.attributes.uv;
    a.array.set(UV);
    a.needsUpdate = true;
    globe.invalidate();
  };

  const lift = (k, s = 1.0025) => [M.pos[k * 3] * s, M.pos[k * 3 + 1] * s, M.pos[k * 3 + 2] * s];

  const drawWire3D = () => {
    if (!params.wire) { globe.remove(PREFIX + "wire"); }
    else {
      const seen = new Set(), segs = [];
      for (let t = 0; t < M.T; t++) for (let q = 0; q < 3; q++) {
        const a = M.tri[t * 3 + q], b = M.tri[t * 3 + ((q + 1) % 3)];
        if (M.pole[a] && M.pole[b]) continue;
        const key = Math.min(a, b) * M.N + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push([lift(a), lift(b)]);
      }
      const op = clamp(0.55 * Math.sqrt(32 / Math.max(M.cols, 4)), 0.14, 0.6);
      globe.addSegments3D(PREFIX + "wire", segs, { color: `rgba(26,25,23,${op.toFixed(2)})`, width: 1, depth: true, order: 2 });
    }
    const seamSegs = [];
    for (let t = 0; t < M.T; t++) if (isSeamTri(UV, t)) for (let q = 0; q < 3; q++) seamSegs.push([lift(M.tri[t * 3 + q], 1.004), lift(M.tri[t * 3 + ((q + 1) % 3)], 1.004)]);
    if (seamSegs.length) globe.addSegments3D(PREFIX + "seam", seamSegs, { color: "rgba(180,35,53,.75)", width: 1.25, depth: true, order: 2.2 });
    else globe.remove(PREFIX + "seam");
  };

  const focus = () => hovered || pinned;

  const focusInfo = (f) => {
    const P = pointAt(M, f.t, f.w);
    const iuv = interpUV(UV, f.t, f.w);
    const P0 = Math.hypot(P[0], P[2]) < 1e-12 ? null : P;
    const euv = P0 ? exactUV(P) : iuv;
    const err = errorAt(M, UV, f.t, f.w);
    return { P, iuv, euv, err, sampled: lonLatOfUV(iuv[0], iuv[1]), exact: xyzToLonLat(P[0], P[1], P[2]) };
  };

  const readouts = () => {
    const f = focus();
    const I = focusInfo(f);
    ctx.readout.setMany({
      uv: `${f3(mod(I.iuv[0], 1) === 0 && I.iuv[0] >= 1 ? 1 : I.iuv[0])}, ${f3(I.iuv[1])}`,
      w: f.w.map(f3).join(" "),
      sampled: `${fmtDeg(I.sampled[0], "E", "W")} ${fmtDeg(I.sampled[1], "N", "S")}`,
      tris: M.T,
      err: I.err,
      maxErr: SUM.max,
    });
    return I;
  };

  const drawFocus3D = () => {
    const f = focus();
    const I = focusInfo(f);
    const c = [0, 1, 2].map((q) => lift(M.tri[f.t * 3 + q], 1.003));
    const Pl = [I.P[0] * 1.003, I.P[1] * 1.003, I.P[2] * 1.003];
    const w = 2.2 + 2.6 * Math.sin(Math.PI * pulse);
    globe.addSegments3D(PREFIX + "focus", [[c[0], c[1]], [c[1], c[2]], [c[2], c[0]]], { color: BRASS, width: w, depth: false, order: 3 });
    globe.addPoints3D(PREFIX + "pt", [Pl], { color: INK, size: 9, depth: false, order: 4 });
    for (let q = 0; q < 3; q++) {
      const id = PREFIX + "wt" + q;
      if (!params.showWeights) { globe.remove(id); continue; }
      const tri = [Pl, c[(q + 1) % 3], c[(q + 2) % 3]].flat();
      if (!globe.setTriangles(id, tri)) globe.addTriangles(id, tri, { color: WCOL[q], opacity: 0.42, lit: false, depthWrite: false, order: 2.6 });
    }
    const cen = [0, 1, 2].reduce((s, q) => s.map((v, i) => v + c[q][i] / 3), [0, 0, 0]);
    const cs = globe.projectPoint ? globe.projectPoint(cen, false) : null;
    for (let q = 0; q < 3; q++) {
      const k = M.tri[f.t * 3 + q];
      const at = { lon: M.lon[k], lat: M.lat[k] };
      let dx = 0, dy = -14;
      const ps = globe.projectPoint ? globe.projectPoint(c[q], false) : null;
      if (cs && ps && isFinite(ps.x) && isFinite(cs.x)) {
        const vx = ps.x - cs.x, vy = ps.y - cs.y, l = Math.hypot(vx, vy) || 1;
        dx = Math.round((vx / l) * 14); dy = Math.round((vy / l) * 14);
      }
      if (ctx.overlay.has && ctx.overlay.has(PREFIX + "c" + q)) ctx.overlay.remove(PREFIX + "c" + q);
      ctx.overlay.label(PREFIX + "c" + q, at, String(q + 1), { color: WCOL[q], dx, dy, mono: true });
    }
    ctx.overlay.update();
    return I;
  };

  const uvX = (u) => L.tex.x + u * L.tex.w;
  const uvY = (v) => L.tex.y + v * L.tex.h;

  const triPath = (g, t, k = 0) => {
    g.moveTo(uvX(UV[t * 6] + k), uvY(UV[t * 6 + 1]));
    g.lineTo(uvX(UV[t * 6 + 2] + k), uvY(UV[t * 6 + 3]));
    g.lineTo(uvX(UV[t * 6 + 4] + k), uvY(UV[t * 6 + 5]));
    g.closePath();
  };
  const shifts = (t) => {
    const a = UV[t * 6], b = UV[t * 6 + 2], c = UV[t * 6 + 4];
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), out = [];
    for (let k = -2; k <= 2; k++) if (hi + k > 0 && lo + k < 1) out.push(k);
    return out;
  };

  const buildBase = () => {
    const dpr = stage.dpr;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(L.panel.w * dpr)); c.height = Math.max(1, Math.round(L.panel.h * dpr));
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (texOn()) drawTexture(g);
    if (chartOn()) drawChart(g);
    baseCanvas = c;
  };

  const drawTexture = (g) => {
    const T = L.tex;
    g.save();
    g.beginPath(); g.rect(T.x, T.y, T.w, T.h); g.clip();
    g.imageSmoothingQuality = "high";
    if (imgCanvas) g.drawImage(imgCanvas, T.x, T.y, T.w, T.h); else { g.fillStyle = "#bcd1dd"; g.fillRect(T.x, T.y, T.w, T.h); }
    if (M.kind === "patch") {
      g.fillStyle = "rgba(250,248,243,.62)"; g.fillRect(T.x, T.y, T.w, T.h);
      g.save();
      g.beginPath();
      for (let t = 0; t < M.T; t++) if (!isSeamTri(UV, t)) for (const k of shifts(t)) triPath(g, t, k);
      g.clip();
      if (imgCanvas) g.drawImage(imgCanvas, T.x, T.y, T.w, T.h);
      g.restore();
    }
    if (params.wire) {
      g.beginPath();
      for (let t = 0; t < M.T; t++) if (!isSeamTri(UV, t)) for (const k of shifts(t)) triPath(g, t, k);
      const op = clamp(0.7 * Math.sqrt(32 / Math.max(M.cols, 4)), 0.16, 0.7);
      g.strokeStyle = `rgba(26,25,23,${op.toFixed(2)})`; g.lineWidth = M.T > 4000 ? 0.5 : 1; g.lineJoin = "round"; g.stroke();
    }
    if (M.kind === "globe" && M.T <= 20000) {
      g.beginPath();
      for (let t = 0; t < M.T; t++) if (M.poleTri[t] && !isSeamTri(UV, t)) for (const k of shifts(t)) triPath(g, t, k);
      g.fillStyle = "rgba(183,121,31,.16)"; g.fill();
    }
    let any = false;
    g.beginPath();
    for (let t = 0; t < M.T; t++) if (isSeamTri(UV, t)) { triPath(g, t, 0); any = true; }
    if (any) { g.fillStyle = "rgba(180,35,53,.06)"; g.fill(); g.strokeStyle = "rgba(180,35,53,.6)"; g.lineWidth = 1; g.stroke(); }
    if (handlesOn()) {
      g.fillStyle = INK;
      for (let k = 0; k < M.N; k++) {
        if (M.pole[k] && M.kind === "globe") continue;
        for (const [u, v] of nodeUV(M, UV, k)) for (const s of [-1, 0, 1]) {
          const uu = u + s;
          if (uu < -1e-9 || uu > 1 + 1e-9) continue;
          g.beginPath(); g.arc(uvX(uu), uvY(v), edits.has(k) ? 4 : handleR(), 0, Math.PI * 2);
          g.fillStyle = edits.has(k) ? BRASS : INK; g.fill();
        }
      }
    }
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1; g.strokeRect(T.x + 0.5, T.y + 0.5, T.w - 1, T.h - 1);
    let arrows = true;
    if (!L.compact) {
      g.font = `600 12px ${FONT_UI}`; g.fillStyle = INK; g.textBaseline = "alphabetic"; g.textAlign = "left";
      g.fillText("The texture image", T.x, T.y - 8);
      g.font = `500 10.5px ${FONT_MONO}`; g.fillStyle = INK3; g.textAlign = "right";
      g.fillText(`${TEX_W} × ${TEX_H} texels · u →  v ↓`, T.x + T.w, T.y - 8);
    } else {
      g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textAlign = "right"; g.textBaseline = "middle";
      const head = fitText(g, [`${TEX_W} × ${TEX_H} texels · u →  v ↓`, `${TEX_W} × ${TEX_H} texels`, `${TEX_W} × ${TEX_H}`, ""], L.sw.w - swW - 12);
      arrows = head.includes("u →");
      g.fillText(head, L.sw.x - L.panel.x + L.sw.w, L.sw.y - L.panel.y + L.sw.h / 2);
    }
    g.font = `500 10.5px ${FONT_MONO}`; g.fillStyle = INK3;
    const tw = (s) => (s ? g.measureText(s).width : 0);
    const fits = ([l, c, r]) => tw(l) + tw(r) + 12 <= T.w && (!c || (T.w / 2 - tw(c) / 2 >= tw(l) + 10 && T.w / 2 + tw(c) / 2 <= T.w - tw(r) - 10));
    const axis = [["u 0 · 180°W", "0.5 · 0°", "1 · 180°E"], ["u 0 · 180°W", "", "1 · 180°E"], ["u 0", "0.5", "1"]].find(fits) || ["u 0", "", "1"];
    g.textAlign = "left"; g.textBaseline = "top";
    g.fillText(axis[0], T.x, T.y + T.h + 4);
    g.textAlign = "right"; g.fillText(axis[2], T.x + T.w, T.y + T.h + 4);
    if (axis[1]) { g.textAlign = "center"; g.fillText(axis[1], T.x + T.w / 2, T.y + T.h + 4); }
    if (L.compact) drawKeyColumn(g, arrows);
  };

  const drawKeyColumn = (g, arrows) => {
    const K = L.col, lh = 13;
    let y = K.y + 1;
    g.font = `500 10.5px ${FONT_UI}`; g.textAlign = "left"; g.textBaseline = "top";
    const item = (ring, options) => {
      const lines = options.find((o) => o.every((l) => g.measureText(l).width <= K.w - 14)) || wrapText(g, options[0].join(" "), K.w - 14);
      g.beginPath(); g.arc(K.x + 5, y + 6, ring ? 5 : 3.4, 0, Math.PI * 2);
      if (ring) { g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = INK; g.fill(); }
      g.fillStyle = INK2;
      lines.forEach((l, i) => g.fillText(l, K.x + 14, y + i * lh));
      y += lines.length * lh + 7;
    };
    item(false, [["GPU blend of u, v"], ["GPU blend", "of u, v"]]);
    item(true, [["exact u, v of the point"], ["exact u, v", "of the point"]]);
    if (!arrows && K.y + K.h - 12 >= y) {
      g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textBaseline = "bottom";
      g.fillText("u →  v ↓", K.x, K.y + K.h);
    }
  };

  const segHit = (a, b, r) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a[0] - r[0]], [dx, r[2] - a[0]], [-dy, a[1] - r[1]], [dy, r[3] - a[1]]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  };

  const drawChart = (g) => {
    const C = L.chart;
    const curve = errorCurve();
    const x0 = Math.log10(4), x1 = 5, y0 = -2, y1 = Math.log10(4096);
    const padL = 34, padB = 22;
    const px = (n) => C.x + padL + ((Math.log10(n) - x0) / (x1 - x0)) * (C.w - padL - 6);
    const py = (e) => C.y + (C.h - padB) - ((Math.log10(clamp(e, 10 ** y0, 10 ** y1)) - y0) / (y1 - y0)) * (C.h - padB - 4);
    if (!L.compact) {
      g.font = `600 12px ${FONT_UI}`; g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillText("Max error against triangles", C.x, C.y - 8);
    }
    g.strokeStyle = "rgba(60,52,40,.14)"; g.lineWidth = 1;
    g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3;
    const decade = py(1) - py(10);
    for (const e of decade >= 11 ? [0.01, 0.1, 1, 10, 100, 1000] : [0.01, 1, 100]) {
      const y = Math.round(py(e)) + 0.5;
      g.beginPath(); g.moveTo(C.x + padL, y); g.lineTo(C.x + C.w - 6, y); g.stroke();
      g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(e >= 1 ? String(e) : String(e), C.x + padL - 4, y);
    }
    for (const n of [10, 100, 1000, 10000, 100000]) {
      const x = Math.round(px(n)) + 0.5;
      g.beginPath(); g.moveTo(x, C.y + 2); g.lineTo(x, C.y + C.h - padB); g.stroke();
      g.textAlign = "center"; g.textBaseline = "top"; g.fillText(n >= 1000 ? n / 1000 + "k" : String(n), x, C.y + C.h - padB + 4);
    }
    const line = (key, color) => {
      const pts = curve.filter((p) => p[key] > 0).map((p) => [px(p.tris), py(p[key])]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
      return pts;
    };
    const paths = [line("pole", WARN), line("mid", SIGNAL)];
    const halo = (text, x, y, color) => { g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.95)"; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y); };
    const seamY = py(TEX_W / 2);
    if (!params.split) {
      g.setLineDash([5, 4]); g.strokeStyle = ERR; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(C.x + padL, seamY); g.lineTo(C.x + C.w - 6, seamY); g.stroke(); g.setLineDash([]);
      paths.push([[C.x + padL, seamY], [C.x + C.w - 6, seamY]]);
    }
    const dx = px(M.T), dy = py(Math.max(SUM.max, 0.01));
    g.beginPath(); g.arc(dx, dy, 5, 0, Math.PI * 2); g.fillStyle = BRASS; g.fill();
    g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 1.5; g.stroke();
    const placed = [[dx - 4, dy - 4, dx + 4, dy + 4]];
    const cost = (r) => {
      let n = 0;
      if (r[0] < C.x + padL - 2 || r[2] > C.x + C.w + 2 || r[1] < C.y - 2 || r[3] > C.y + C.h - padB) n += 50;
      for (const q of placed) if (r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]) n += 20;
      for (const pts of paths) for (let i = 1; i < pts.length; i++) if (segHit(pts[i - 1], pts[i], r)) n++;
      return n;
    };
    const place = (text, font, color, cands) => {
      g.font = font;
      let best = null;
      for (const [x, y, align, base, label = text] of cands) {
        g.textAlign = align; g.textBaseline = base;
        const m = g.measureText(label);
        const r = [x - m.actualBoundingBoxLeft - 1, y - m.actualBoundingBoxAscent - 1, x + m.actualBoundingBoxRight + 1, y + m.actualBoundingBoxDescent + 1];
        const c = cost(r);
        if (!best || c < best.c) best = { c, x, y, align, base, label, r };
        if (!c) break;
      }
      if (best.c >= 20) return;
      placed.push(best.r);
      g.textAlign = best.align; g.textBaseline = best.base;
      halo(best.label, best.x, best.y, color);
    };
    const below = M.kind === "globe" && SUM.max === SUM.pole;
    const right = dx < C.x + C.w * 0.6;
    const meshC = [];
    for (const d of [6, 20]) {
      for (const r of [right, !right]) for (const b of [below, !below]) meshC.push([dx + (r ? 7 : -7), dy + (b ? d : -d), r ? "left" : "right", b ? "top" : "bottom"]);
      if (d === 6) for (const r of [right, !right]) meshC.push([dx + (r ? 9 : -9), dy, r ? "left" : "right", "middle"]);
    }
    place("this mesh", `600 10.5px ${FONT_UI}`, BRASS, meshC);
    if (!params.split) {
      const seamC = [];
      for (const t of ["seam, shared vertices", "seam"]) seamC.push([C.x + padL + 4, seamY + 3, "left", "top", t], [C.x + C.w - 10, seamY + 3, "right", "top", t]);
      place("seam, shared vertices", `500 10px ${FONT_MONO}`, ERR, seamC);
    }
    const at = (key, cols) => { const p = curve.find((q) => q.cols === cols); return [px(p.tris), py(p[key])]; };
    const aboveR = (key, cols) => { const [x, y] = at(key, cols); return [x + 4, y - 6, "left", "bottom"]; };
    const belowL = (key, cols) => { const [x, y] = at(key, cols); return [x - 4, y + 6, "right", "top"]; };
    const ui = `500 10.5px ${FONT_UI}`;
    place("pole triangles", ui, WARN, [...[64, 96, 128, 48, 32, 160].map((c) => aboveR("pole", c)), ...[64, 96, 128, 160, 192, 256].map((c) => belowL("pole", c))]);
    const [mx, my] = at("mid", 16);
    place(`|lat| ≤ ${MID_LAT}°`, ui, SIGNAL, [[mx - 10, my + 6, "left", "top"], ...[64, 32, 96, 128, 192].map((c) => belowL("mid", c)), ...[128, 96, 64, 160].map((c) => aboveR("mid", c))]);
    g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3;
    if (L.compact) {
      g.textAlign = "right"; g.textBaseline = "middle";
      g.fillText(fitText(g, ["error in texels against triangles", "texels against triangles", "texels"], L.sw.w - swW - 12), C.x + C.w, L.sw.y - L.panel.y + L.sw.h / 2);
    } else if (py(1000) - 7 < C.y + 11) {
      g.textAlign = "right"; g.textBaseline = "alphabetic";
      g.fillText("texels", C.x + C.w, C.y - 8);
    } else {
      g.textAlign = "left"; g.textBaseline = "bottom";
      g.fillText("texels", C.x, C.y + 10);
    }
  };

  const sizePanel = () => {
    const P = L.panel, dpr = stage.dpr;
    panelEl.style.left = P.x + "px"; panelEl.style.top = P.y + "px"; panelEl.style.width = P.w + "px"; panelEl.style.height = P.h + "px";
    panelEl.style.right = "auto"; panelEl.style.bottom = "auto";
    panelCanvas.width = Math.round(P.w * dpr); panelCanvas.height = Math.round(P.h * dpr);
    capCanvas.width = Math.round(stage.width * dpr); capCanvas.height = Math.round(stage.height * dpr);
    baseCanvas = null;
  };

  const drawPanel = () => {
    if (!baseCanvas) buildBase();
    const g = panelCanvas.getContext("2d");
    const dpr = stage.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, panelCanvas.width, panelCanvas.height);
    g.drawImage(baseCanvas, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!texOn()) return;
    const f = focus();
    const I = focusInfo(f);
    const T = L.tex;
    g.save();
    g.beginPath(); g.rect(T.x, T.y, T.w, T.h); g.clip();
    const seam = isSeamTri(UV, f.t);
    const ks = seam ? [0] : shifts(f.t);
    const ip = interpUV(UV, f.t, f.w);
    for (const k of ks) {
      const C = [0, 1, 2].map((q) => [uvX(UV[f.t * 6 + q * 2] + k), uvY(UV[f.t * 6 + q * 2 + 1])]);
      const Pp = [uvX(ip[0] + k), uvY(ip[1])];
      if (params.showWeights) {
        for (let q = 0; q < 3; q++) {
          g.beginPath(); g.moveTo(Pp[0], Pp[1]); g.lineTo(C[(q + 1) % 3][0], C[(q + 1) % 3][1]); g.lineTo(C[(q + 2) % 3][0], C[(q + 2) % 3][1]); g.closePath();
          g.fillStyle = WCOL[q] + "66"; g.fill();
        }
      }
      g.beginPath(); g.moveTo(C[0][0], C[0][1]); g.lineTo(C[1][0], C[1][1]); g.lineTo(C[2][0], C[2][1]); g.closePath();
      g.strokeStyle = BRASS; g.lineWidth = 2 + 3 * Math.sin(Math.PI * pulse); g.lineJoin = "round"; g.stroke();
      g.font = `700 11px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
      const cx = (C[0][0] + C[1][0] + C[2][0]) / 3, cy = (C[0][1] + C[1][1] + C[2][1]) / 3;
      for (let q = 0; q < 3; q++) {
        const vx = C[q][0] - cx, vy = C[q][1] - cy, l = Math.hypot(vx, vy) || 1;
        const lx = C[q][0] + (vx / l) * 10, ly = C[q][1] + (vy / l) * 10;
        g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.9)"; g.strokeText(String(q + 1), lx, ly);
        g.fillStyle = WCOL[q]; g.fillText(String(q + 1), lx, ly);
      }
    }
    const ex = uvX(mod(I.euv[0], 1)), ey = uvY(I.euv[1]);
    let ix = uvX(mod(ip[0], 1)), iy = uvY(ip[1]);
    if (I.err > 0.5) {
      g.beginPath(); g.moveTo(ix, iy); g.lineTo(ex, ey);
      g.strokeStyle = I.err > 50 ? ERR : INK2; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
    }
    g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.arc(ix, iy, 3.6, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 1.2; g.stroke();
    g.restore();
    if (L.compact) return;
    g.font = `500 10.5px ${FONT_UI}`; g.textAlign = "left"; g.textBaseline = "top"; g.fillStyle = INK2;
    const ly = T.y + T.h + 18;
    g.beginPath(); g.arc(T.x + 5, ly + 6, 3.4, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
    g.fillStyle = INK2; g.fillText("GPU blend of u, v", T.x + 13, ly);
    g.beginPath(); g.arc(T.x + 140, ly + 6, 5, 0, Math.PI * 2); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    g.fillText("exact u, v of the point", T.x + 150, ly);
  };

  const drawCap = () => {
    const g = capCanvas.getContext("2d");
    const dpr = stage.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, capCanvas.width, capCanvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = SUM.seamCount, cross = `${n} ${n === 1 ? "triangle crosses" : "triangles cross"} 180°`;
    const title = M.kind === "patch" ? `Patch of ${M.n} × ${M.n} quads: ${M.T} flat triangles` : `Globe of ${M.cols} × ${M.rows} quads: ${M.T.toLocaleString("en-US")} flat triangles`;
    const body = n ? [`${cross}. One corner has u near 1 and one has u 0.`, "The blend runs back across the whole image."]
      : M.kind === "globe" ? ["Each pole corner holds one u for a full column.", "Near the poles the blend is wrong by up to half a column."]
      : ["Drag a corner on the image. The picture slides on the mesh."];
    const edit = edits.size ? `${edits.size} ${edits.size === 1 ? "corner" : "corners"} moved. Use Reset UVs to undo.` : null;
    const accent = SUM.seamCount ? ERR : BRASS;
    if (!L.compact) {
      const maxW = L.side ? Math.min(420, stage.width - L.panel.w - 64) : Math.min(420, stage.width - 48);
      drawCaption(g, 16, 14, [title, ...body, edit], { accent, maxWidth: maxW });
      return;
    }
    const limit = stage.width - 52;
    const tShort = M.kind === "patch" ? `${M.n} × ${M.n} patch: ${M.T} flat triangles` : `${M.cols} × ${M.rows} globe: ${M.T.toLocaleString("en-US")} triangles`;
    const short = n ? [`${cross}: u jumps from near 1 to 0.`, "The blend runs back across the image."]
      : M.kind === "globe" ? ["Each pole corner holds one u for a full column.", "Near a pole the blend is off by up to half a column."]
      : ["Drag a corner. The picture slides on the mesh."];
    const one = n ? `${cross}. The blend smears the image.` : M.kind === "globe" ? short[1] : short[0];
    const sets = [[title, ...body, edit], [title, ...short, edit], [tShort, ...short, edit], [title, edit ? short[0] : one, edit], [tShort, edit || one], [tShort]];
    const count = (set) => set.filter(Boolean).reduce((a, l, i) => { g.font = i ? `400 12px ${FONT_UI}` : `600 13px ${FONT_UI}`; return a + wrapText(g, l, limit).length; }, 0);
    const flat = (set) => count(set) === set.filter(Boolean).length;
    drawCaption(g, 16, 14, sets.find((set) => flat(set) && count(set) <= L.capLines) || sets.find((set) => count(set) <= L.capLines) || sets[sets.length - 1], { accent, maxWidth: limit });
  };

  const insetTopFor = () => (L.compact ? L.top : 18 + 16 + 3 * 17 + 18);

  const fitPoints = () => {
    if (M.kind === "globe") return null;
    const pts = [];
    for (let k = 0; k < M.N; k++) pts.push([M.pos[k * 3], M.pos[k * 3 + 1], M.pos[k * 3 + 2]]);
    return pts;
  };

  const frame = (duration = 0, rotate = true) => {
    if (camTw) { camTw.cancel(); camTw = null; }
    const cam = globe.camera;
    const s0 = cam.state();
    if (rotate) cam.setState({ lon: params.lon0, lat: LAT_C, roll: 0, pan: s0.pan, dist: s0.dist });
    const f = cam.fit(fitPoints(), { padding: L.compact ? 10 : 26, insetTop: insetTopFor(), insetBottom: L.insetBottom, insetRight: L.insetRight, minDist: 1.3, apply: false });
    const q1 = cam.state().q;
    if (!duration || ctx.reducedMotion || !booted) { cam.setState({ q: q1, dist: f.dist, pan: f.pan }); ctx.overlay.update(); return; }
    cam.setState(s0);
    camTw = ctx.anim.tween({ from: 0, to: 1, duration, ease: ctx.anim.ease.emph, onUpdate: (u) => {
      cam.setState({ q: quat.slerp(s0.q, q1, u), dist: lerp(s0.dist, f.dist, u), pan: [lerp(s0.pan[0], f.pan[0], u), lerp(s0.pan[1], f.pan[1], u)] });
      ctx.overlay.update();
    }, onDone: () => { camTw = null; } });
  };

  const redraw = () => {
    drawFocus3D();
    drawPanel();
    drawCap();
    readouts();
  };

  const runPulse = () => {
    if (pulseTw) pulseTw.cancel();
    if (ctx.reducedMotion) { pulse = 0; redraw(); return; }
    pulseTw = ctx.anim.tween({ from: 0, to: 1, duration: 720, ease: ctx.anim.ease.out, onUpdate: (v) => { pulse = v; drawFocus3D(); drawPanel(); }, onDone: () => { pulse = 0; pulseTw = null; drawFocus3D(); drawPanel(); } });
  };

  const localPos = (e) => { const r = panelEl.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toUV = (x, y) => [(x - L.tex.x) / L.tex.w, (y - L.tex.y) / L.tex.h];
  const inTex = (x, y) => texOn() && x >= L.tex.x && x <= L.tex.x + L.tex.w && y >= L.tex.y && y <= L.tex.y + L.tex.h;

  const nearestHandle = (x, y) => {
    if (!handlesOn() || !texOn()) return null;
    let best = null;
    for (let k = 0; k < M.N; k++) {
      if (M.pole[k] && M.kind === "globe") continue;
      for (const [u, v] of nodeUV(M, UV, k)) for (const s of [-1, 0, 1]) {
        const d = Math.hypot(uvX(u + s) - x, uvY(v) - y);
        if (d < 11 && (!best || d < best.d)) best = { k, d, u: u + s, v };
      }
    }
    return best;
  };

  const chipLines = (f) => {
    const I = focusInfo(f);
    const out = [`w ${f.w.map((x) => x.toFixed(2)).join(" · ")}`, `u, v ${f3(I.iuv[0])}, ${f3(I.iuv[1])}`, `sampled ${ctx.fmt.lon(I.sampled[0])} ${ctx.fmt.lat(I.sampled[1])}`];
    out.push(`error ${I.err < 0.01 ? "< 0.01" : I.err.toFixed(2)} texels`);
    return out;
  };

  const stop = (e) => e.stopPropagation();
  panelEl.addEventListener("pointerdown", (e) => {
    stop(e);
    if (e.button !== 0) return;
    const [x, y] = localPos(e);
    const h = nearestHandle(x, y);
    drag = { id: e.pointerId, x, y, moved: false, handle: h, start: h ? (edits.get(h.k) || [0, 0]).slice() : null };
    panelEl.setPointerCapture(e.pointerId);
    if (h) { panelEl.style.cursor = "grabbing"; ctx.overlay.hideChip(); }
  }, { signal: ctx.signal });
  panelEl.addEventListener("pointermove", (e) => {
    stop(e);
    const [x, y] = localPos(e);
    if (drag && e.pointerId === drag.id) {
      if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
      if (drag.handle && drag.moved) {
        const du = (x - drag.x) / L.tex.w, dv = (y - drag.y) / L.tex.h;
        const e2 = [drag.start[0] + du, drag.start[1] + dv];
        if (Math.hypot(e2[0], e2[1]) < 1e-9) edits.delete(drag.handle.k); else edits.set(drag.handle.k, e2);
        refreshUV(false, new Set([drag.handle.k]));
        pushUV3D();
        drawWire3D();
        redraw();
      }
      return;
    }
    if (!inTex(x, y)) {
      panelEl.style.cursor = "default";
      if (hovered) { hovered = null; redraw(); }
      ctx.overlay.hideChip();
      return;
    }
    panelEl.style.cursor = nearestHandle(x, y) ? "grab" : "crosshair";
    const [u, v] = toUV(x, y);
    const hit = uvHit(M, UV, u, v);
    if (!hit) { if (hovered) { hovered = null; redraw(); } ctx.overlay.hideChip(); return; }
    hovered = { t: hit.t, w: hit.w };
    redraw();
    ctx.overlay.chip(L.panel.x + x, L.panel.y + y, chipLines(hovered));
  }, { signal: ctx.signal });
  const endDrag = (e) => {
    stop(e);
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    panelEl.style.cursor = "default";
    if (d.handle && d.moved) { drawCap(); return; }
    const [x, y] = localPos(e);
    if (!inTex(x, y)) return;
    const [u, v] = toUV(x, y);
    const hit = uvHit(M, UV, u, v);
    if (!hit) return;
    pinned = { t: hit.t, w: hit.w };
    hovered = null;
    redraw();
    runPulse();
  };
  panelEl.addEventListener("pointerup", endDrag, { signal: ctx.signal });
  panelEl.addEventListener("pointercancel", endDrag, { signal: ctx.signal });
  panelEl.addEventListener("pointerleave", (e) => {
    stop(e);
    if (drag) return;
    ctx.overlay.hideChip();
    if (hovered) { hovered = null; redraw(); }
  }, { signal: ctx.signal });
  panelEl.addEventListener("wheel", (e) => { e.stopPropagation(); }, { signal: ctx.signal, passive: true });

  const offHover = globe.on("hover", (p) => { if (!p && hovered) { hovered = null; redraw(); } });

  sizePanel();
  syncSwitch();
  rebuild();
  frame(0, !ctx.url || !ctx.url.get("v"));
  redraw();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (keys.includes("res") && keys.length === 1 && params.mesh !== "globe" && booted) { ctx.controls.set("mesh", "globe"); return; }
      const meshKeys = keys.some((k) => k === "mesh" || k === "split" || (k === "res" && params.mesh === "globe") || (k === "lon0" && params.mesh !== "globe"));
      if (keys.includes("reset") && keys.length === 1) {
        edits.clear();
        refreshUV(true);
        pushUV3D();
        drawWire3D();
        redraw();
        return;
      }
      if (meshKeys && (keys.length > 1 || prev.mesh !== params.mesh || prev.split !== params.split || prev.res !== params.res || prev.lon0 !== params.lon0)) {
        rebuild();
        const reframe = keys.includes("mesh") && prev.mesh !== params.mesh || keys.includes("lon0") && prev.lon0 !== params.lon0 || keys.length > 3;
        if (reframe) frame(booted ? 650 : 0, true);
      } else if (keys.includes("lon0") && prev.lon0 !== params.lon0) {
        pinned = defaultFocus();
        frame(booted ? 650 : 0, true);
      }
      if (keys.includes("wire")) { drawWire3D(); baseCanvas = null; }
      if (keys.includes("showWeights") || keys.includes("split")) baseCanvas = null;
      redraw();
    },
    hover(lon, lat) {
      const hit = radialHit(M, lon, lat);
      if (!hit) return [];
      hovered = { t: hit.t, w: hit.w };
      redraw();
      return chipLines(hovered).slice(0, 1).concat(chipLines(hovered).slice(1));
    },
    probe(lon, lat) {
      const hit = radialHit(M, lon, lat);
      if (!hit) return null;
      pinned = { t: hit.t, w: hit.w };
      hovered = null;
      redraw();
      runPulse();
      return {};
    },
    unprobe() {
      pinned = defaultFocus();
      hovered = null;
      redraw();
    },
    resize() {
      L = layoutFor(stage.width, stage.height, stage.insetBottom);
      sizePanel();
      syncSwitch();
      frame(0, false);
      redraw();
    },
    unmount() {
      if (pulseTw) pulseTw.cancel();
      if (camTw) camTw.cancel();
      offHover();
      if (globe.pick === ownPick) delete globe.pick;
      globe.removePrefix(PREFIX);
      for (const [k, v] of Object.entries(prevLayers)) globe.setLayer(k, v);
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
      panelEl.remove();
      sw.remove();
      capCanvas.remove();
    },
  };
}
