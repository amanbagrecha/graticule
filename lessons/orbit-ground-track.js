import { orbitPeriod, orbitsPerDay, groundSpeed, westShiftPerOrbit, nodalPrecession, groundTrack, maxGroundLatitude, meanMotion, OMEGA_EARTH, RE } from "@/core/astro.js";
import { getBasemap } from "@/core/basemap.js";
import { FONT_UI, FONT_MONO } from "@/core/map2d.js";
import { clamp, mod, DEG, RAD } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
export const START_LON = 10;
export const MS_PER_ORBIT = 6000;
export const PER_ORBIT = 240;

export const PRESETS = [
  { value: "landsat", label: "Landsat 8", alt: 705, inc: 98.2, swath: 185 },
  { value: "sentinel2", label: "Sentinel-2", alt: 786, inc: 98.6, swath: 290 },
  { value: "terra", label: "Terra MODIS", alt: 705, inc: 98.2, swath: 2330 },
  { value: "iss", label: "ISS ECOSTRESS", alt: 420, inc: 51.6, swath: 384 },
  { value: "custom", label: "Custom" },
];

export const meta = {
  id: "orbit-ground-track",
  title: "Where the satellite goes",
  track: 7,
  order: 3,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A satellite in a circular orbit crosses the equator at its inclination. Each orbit takes about 100 minutes. The Earth turns under it, so each pass lands west of the last. The sensor sees a swath on either side of the track. Play the orbit and watch the swaths tile the globe.",
  deeper: [
    "T = 2π √(a³/μ), μ = 398,600 km³/s².",
    "705 km → 98.9 min, 14.6 orbits per day.",
    "Each orbit shifts 24.8° west.",
    "A 185 km swath needs 16 days to cover the Earth from 705 km.",
  ],
  keywords: ["orbit", "ground track", "inclination", "period", "swath", "Landsat", "ISS"],
  controls: [
    { key: "preset", type: "select", label: "Satellite", options: PRESETS.map(({ value, label }) => ({ value, label })), default: "landsat" },
    { key: "altitude", type: "range", label: "Altitude", min: 300, max: 2000, step: 1, default: 705, unit: "km", ticks: [300, 705, 1000, 1500, 2000] },
    { key: "inclination", type: "range", label: "Inclination", min: 0, max: 180, step: 0.1, default: 98.2, unit: "°", ticks: [0, 45, 90, 135, 180] },
    { key: "swath", type: "range", label: "Swath", min: 10, max: 3000, step: 1, default: 185, unit: "km", ticks: [10, 1000, 2000, 3000] },
    { key: "orbits", type: "range", label: "Orbits", min: 1, max: 16, step: 1, default: 3, ticks: [1, 4, 8, 12, 16] },
    { key: "play", type: "button", label: "Play orbit", icon: "i-play" },
    { key: "earthRotates", type: "toggle", label: "Earth rotates", default: true, shortcut: "e" },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "Orbit" },
      { color: SIGNAL, line: true, label: "Ground track" },
      { color: "rgba(29,99,168,.4)", label: "Swath the sensor sees" },
      { color: BRASS, label: "Equator crossings, northbound" },
    ] },
  ],
  readouts: [
    { key: "period", label: "Period", digits: 1, unit: "min" },
    { key: "speed", label: "Ground speed", digits: 2, unit: "km/s" },
    { key: "shift", label: "West shift per orbit", digits: 2, unit: "°", hero: true },
    { key: "perDay", label: "Orbits per day", digits: 2 },
    { key: "maxLat", label: "Highest latitude", digits: 1, unit: "°" },
  ],
  transport: { label: ["start", "end"], key: "m" },
  compare: null,
  view: { lon: 62, lat: 16, dist: 3.4 },
  data: [],
};

const PREFIX = meta.id + ":";
const wrap = (l) => mod(l + 180, 360) - 180;
const GAP = 14;
const HEAD = 30;
const PADX = 12;
const PADB = 12;
const R_TRACK = 1.0028;
const R_SWATH = 1.0035;

export function driftRate(alt, inc) {
  return ((nodalPrecession(alt, inc) * DEG) / 86400 - OMEGA_EARTH) * RAD;
}

export function facts(alt, inc, rotates = true) {
  return {
    period: orbitPeriod(alt),
    speed: groundSpeed(alt),
    shift: rotates ? westShiftPerOrbit(alt, inc) : 0,
    perDay: orbitsPerDay(alt),
    maxLat: maxGroundLatitude(inc),
  };
}

export function subPoint(alt, inc, tMin, k = 1, lon0 = START_LON) {
  const [lon, lat] = groundTrack(alt, inc, tMin, tMin, 1, false, lon0)[0];
  return [wrap(lon + k * driftRate(alt, inc) * tMin * 60), lat];
}

export function track(alt, inc, orbits, k = 1, perOrbit = PER_ORBIT, lon0 = START_LON) {
  const T = orbitPeriod(alt);
  const total = orbits * T;
  const steps = Math.max(2, Math.round(orbits * perOrbit));
  const raw = groundTrack(alt, inc, 0, total, (total * 60) / steps, false, lon0);
  const n = raw.length;
  const lon = new Float64Array(n), lonU = new Float64Array(n), lat = new Float64Array(n), t = new Float64Array(n);
  const rate = driftRate(alt, inc);
  let acc = raw[0][0], prev = raw[0][0];
  for (let i = 0; i < n; i++) {
    const b = raw[i][0];
    if (i) { let d = b - prev; if (d > 180) d -= 360; if (d < -180) d += 360; acc += d; }
    prev = b;
    lonU[i] = acc + k * rate * raw[i][2] * 60;
    lon[i] = wrap(lonU[i]);
    lat[i] = raw[i][1];
    t[i] = raw[i][2];
  }
  return { n, lon, lonU, lat, t, T, total, orbits, perOrbit: steps / orbits };
}

export function ascendingNodes(alt, inc, orbits, k = 1, lon0 = START_LON) {
  const T = orbitPeriod(alt), rate = driftRate(alt, inc);
  const out = [];
  for (let j = 0; j <= orbits; j++) out.push({ pass: j + 1, t: j * T, lon: wrap(lon0 + k * rate * j * T * 60) });
  return out;
}

export function crossingAngle(alt, inc, k = 1) {
  const n = meanMotion(alt), i = inc * DEG;
  return Math.atan2(n * Math.sin(i), n * Math.cos(i) + k * driftRate(alt, inc) * DEG) * RAD;
}

export function coverageDays(alt, swathKm) {
  return (2 * Math.PI * RE) / (swathKm * orbitsPerDay(alt));
}

export function ringLonLat(inc, driftDeg, n = 192, lon0 = START_LON) {
  const i = inc * DEG, out = [];
  for (let j = 0; j <= n; j++) {
    const u = (2 * Math.PI * j) / n;
    out.push([wrap(lon0 + Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)) * RAD + driftDeg), Math.asin(Math.sin(i) * Math.sin(u)) * RAD]);
  }
  return out;
}

export function xyz(lon, lat, r = 1, out = [0, 0, 0]) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la) * r;
  out[0] = c * Math.sin(lo); out[1] = Math.sin(la) * r; out[2] = c * Math.cos(lo);
  return out;
}

const toLL = (v) => [Math.atan2(v[0], v[2]) * RAD, Math.asin(clamp(v[1] / Math.hypot(v[0], v[1], v[2]), -1, 1)) * RAD];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function across(p, q, halfKm, K = 1) {
  const P = xyz(p[0], p[1]), Q = xyz(q[0], q[1]);
  const nrm = norm(cross(P, [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]]));
  const d = halfKm / RE, out = [];
  for (let j = 0; j <= K; j++) {
    const s = -d + (2 * d * j) / K, c = Math.cos(s), sn = Math.sin(s);
    out.push([P[0] * c + nrm[0] * sn, P[1] * c + nrm[1] * sn, P[2] * c + nrm[2] * sn]);
  }
  return out;
}

export function swathEdges(p, q, halfKm) {
  const e = across(p, q, halfKm, 1);
  return [toLL(e[0]), toLL(e[1])];
}

export function fmtTime(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export function matchPreset(alt, inc, swath) {
  const p = PRESETS.find((q) => q.alt === alt && Math.abs(q.inc - inc) < 1e-6 && q.swath === swath);
  return p ? p.value : "custom";
}

function shellPoints(r, n = 260) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, s = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * s * r, y * r, Math.sin(g * i) * s * r]);
  }
  return out;
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const globe = stage.globe;
  const ui = await import("@/core/ui.js");
  let params = { ...ctx.params };
  let rotK = params.earthRotates ? 1 : 0;
  let TR = null, K = 1, edges = null, cols = null;
  let m = params.m ?? 0, t = 0;
  let spinApplied = 0;
  let playing = false, playTw = null, jumpTw = null, rotTw = null, presetTw = null, holdTimer = 0, autoTimer = 0;
  let applying = false, booted = false, L = null, baseImg = null;
  let drag2d = null, hover2d = null;
  let zeroNormals = new Float32Array(0);
  const spinQ = globe ? globe.group.quaternion.clone() : null;
  if (globe && ctx.url.get("v")) spinApplied = NaN;

  const panel = stage.element("div", "ogt-panel");
  const pc = document.createElement("canvas");
  pc.style.cssText = "display:block;width:100%;height:100%;";
  panel.append(pc);
  const cap = stage.element("div", "ogt-cap");
  cap.style.cssText = "position:absolute;left:16px;top:14px;right:auto;bottom:auto;width:auto;height:auto;width:262px;box-sizing:border-box;padding:10px 14px 10px 18px;border-radius:8px;background:rgba(250,248,243,.78);border:1px solid rgba(227,222,211,.95);pointer-events:none;z-index:3;font:400 12px/17px " + FONT_UI + ";color:" + INK2 + ";";
  const capTitle = document.createElement("div");
  capTitle.style.cssText = `font:600 13px/18px ${FONT_UI};color:${INK};margin-bottom:2px;`;
  const capText = document.createElement("div");
  const capBar = document.createElement("i");
  capBar.style.cssText = "position:absolute;left:9px;top:12px;bottom:12px;width:2px;border-radius:1px;";
  cap.append(capBar, capTitle, capText);

  const preset = () => PRESETS.find((p) => p.value === params.preset && p.alt) || null;
  const rO = () => 1 + params.altitude / RE;

  const layout = () => {
    const W = stage.width, H = stage.height, ib = stage.insetBottom;
    const avail = H - ib;
    let mw = Math.min(W - 2 * GAP - 2 * PADX, 2 * (avail * 0.41 - HEAD - PADB));
    mw = Math.max(240, Math.floor(mw / 2) * 2);
    const mh = mw / 2;
    const pw = mw + 2 * PADX, ph = mh + HEAD + PADB;
    const left = Math.round((W - pw) / 2), top = Math.round(avail - GAP - ph);
    panel.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${pw}px;height:${ph}px;right:auto;bottom:auto;border-radius:12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;box-shadow:0 10px 30px -18px rgba(0,0,0,.9);pointer-events:auto;z-index:3;overflow:hidden;cursor:default;`;
    const dpr = stage.dpr;
    pc.width = Math.round(pw * dpr); pc.height = Math.round(ph * dpr);
    L = { W, H, pw, ph, mw, mh, mx: PADX, my: HEAD, top, left, inset: H - top + 6 };
    if (globe) globe.labelInsetBottom = L.inset;
  };

  const fitCamera = (duration = 0) => {
    if (!globe || ctx.side !== "A") return;
    const R = rO() * 1.05, drift = rotK * driftRate(params.altitude, params.inclination) * t * 60;
    const pts = shellPoints(1.02).concat(ringLonLat(params.inclination, drift, 96).map(([lo, la]) => xyz(lo, la, R)));
    const f = globe.camera.fit(pts, { padding: 12, insetTop: 6, insetLeft: 16 + 262, insetBottom: L.inset, apply: false });
    if (duration > 0 && !ctx.reducedMotion) globe.camera.glideTo(f, { duration });
    else { globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]); }
  };

  const rebuild = () => {
    const alt = params.altitude, inc = params.inclination;
    TR = track(alt, inc, params.orbits, rotK);
    const half = params.swath / 2;
    K = clamp(Math.ceil((params.swath / RE) * RAD / 2.5), 1, 10);
    const n = TR.n;
    cols = new Float32Array(n * (K + 1) * 3);
    edges = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const p = [TR.lon[i], TR.lat[i]];
      const P = xyz(p[0], p[1]), A = xyz(TR.lon[a], TR.lat[a]), B = xyz(TR.lon[b], TR.lat[b]);
      const nrm = norm(cross(P, [B[0] - A[0], B[1] - A[1], B[2] - A[2]]));
      const d = half / RE;
      for (let j = 0; j <= K; j++) {
        const s = -d + (2 * d * j) / K, c = Math.cos(s), sn = Math.sin(s);
        const o = (i * (K + 1) + j) * 3;
        cols[o] = P[0] * c + nrm[0] * sn; cols[o + 1] = P[1] * c + nrm[1] * sn; cols[o + 2] = P[2] * c + nrm[2] * sn;
      }
      const l0 = toLL([cols[(i * (K + 1)) * 3], cols[(i * (K + 1)) * 3 + 1], cols[(i * (K + 1)) * 3 + 2]]);
      const o1 = (i * (K + 1) + K) * 3;
      const l1 = toLL([cols[o1], cols[o1 + 1], cols[o1 + 2]]);
      edges[i * 4] = l0[0]; edges[i * 4 + 1] = l0[1]; edges[i * 4 + 2] = l1[0]; edges[i * 4 + 3] = l1[1];
    }
    if (globe) build3D();
  };

  const build3D = () => {
    const n = TR.n;
    const seg = new Float32Array((n - 1) * 6), p = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < n - 1; i++) {
      xyz(TR.lon[i], TR.lat[i], R_TRACK, p); xyz(TR.lon[i + 1], TR.lat[i + 1], R_TRACK, q);
      seg.set(p, i * 6); seg.set(q, i * 6 + 3);
    }
    globe.addSegments3D(PREFIX + "ghost", seg, { color: "rgba(29,99,168,.42)", width: 1.1, dash: [3, 3], order: 2 });
    globe.addSegments3D(PREFIX + "trail", seg.slice(), { color: SIGNAL, width: 2.2, order: 3 });
    const tri = new Float32Array((n - 1) * K * 18);
    let o = 0;
    const put = (i, j) => { const c = (i * (K + 1) + j) * 3; tri[o++] = cols[c] * R_SWATH; tri[o++] = cols[c + 1] * R_SWATH; tri[o++] = cols[c + 2] * R_SWATH; };
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < K; j++) { put(i, j); put(i + 1, j); put(i, j + 1); put(i, j + 1); put(i + 1, j); put(i + 1, j + 1); }
    if (zeroNormals.length !== tri.length) zeroNormals = new Float32Array(tri.length);
    globe.addTriangles(PREFIX + "swath", tri, { color: SIGNAL, opacity: 0.22, lit: false, depthWrite: false, order: 1.6, normals: zeroNormals });
    globe.addSegments3D(PREFIX + "head", new Float32Array(6), { color: SIGNAL, width: 2.2, order: 3 });
    const headTri = new Float32Array(K * 18);
    globe.addTriangles(PREFIX + "swathHead", headTri, { color: SIGNAL, opacity: 0.22, lit: false, depthWrite: false, order: 1.6, normals: new Float32Array(headTri.length) });
    globe.addTriangles(PREFIX + "fan", new Float32Array(K * 9), { color: SIGNAL, opacity: 0.16, lit: false, depthWrite: false, order: 1.7, normals: new Float32Array(K * 9) });
    globe.addSegments3D(PREFIX + "fanEdge", new Float32Array(12), { color: "rgba(29,99,168,.75)", width: 1, order: 3 });
    globe.addSegments3D(PREFIX + "nadir", new Float32Array(6), { color: "rgba(26,25,23,.7)", width: 1, dash: [2, 3], order: 3 });
    globe.addSegments3D(PREFIX + "ring", new Float32Array(192 * 6), { color: "rgba(184,82,23,.8)", width: 1.6, order: 2 });
    globe.addTriangles(PREFIX + "body", new Float32Array(36 * 3), { color: BRASS, opacity: 1, lit: true, order: 4 });
    globe.addTriangles(PREFIX + "panels", new Float32Array(12 * 3), { color: VIOLET, opacity: 0.95, lit: false, order: 4 });
  };

  const satFrame = () => {
    const alt = params.altitude, inc = params.inclination * DEG;
    const u = meanMotion(alt) * t * 60;
    const drift = rotK * driftRate(alt, params.inclination) * t * 60;
    const at = (uu) => {
      const lat = Math.asin(Math.sin(inc) * Math.sin(uu)) * RAD;
      const lon = START_LON + Math.atan2(Math.cos(inc) * Math.sin(uu), Math.cos(uu)) * RAD + drift;
      return xyz(lon, lat, 1);
    };
    const r = at(u), f = at(u + 0.01);
    const v = norm([f[0] - r[0], f[1] - r[1], f[2] - r[2]]);
    const c = norm(cross(r, v));
    return { r, v, c, drift };
  };

  const head = () => {
    const f = clamp((t / TR.total) * (TR.n - 1), 0, TR.n - 1);
    return { f, ll: subPoint(params.altitude, params.inclination, t, rotK) };
  };

  const update3D = () => {
    if (!globe) return;
    const H = head();
    const drawn = Math.floor(H.f);
    const trail = globe.extra.get(PREFIX + "trail");
    if (trail) trail.geometry.instanceCount = drawn;
    const sw = globe.extra.get(PREFIX + "swath");
    if (sw) sw.geometry.setDrawRange(0, drawn * K * 6);
    const p = xyz(TR.lon[drawn], TR.lat[drawn], R_TRACK), q = xyz(H.ll[0], H.ll[1], R_TRACK);
    globe.setSegments3D(PREFIX + "head", [[p, q]]);
    const nxt = subPoint(params.altitude, params.inclination, t + 0.05, rotK);
    const cur = across(H.ll, nxt, params.swath / 2, K);
    const prevCols = [];
    for (let j = 0; j <= K; j++) { const o = (drawn * (K + 1) + j) * 3; prevCols.push([cols[o], cols[o + 1], cols[o + 2]]); }
    const ht = new Float32Array(K * 18);
    let o = 0;
    const put = (v) => { ht[o++] = v[0] * R_SWATH; ht[o++] = v[1] * R_SWATH; ht[o++] = v[2] * R_SWATH; };
    for (let j = 0; j < K; j++) { put(prevCols[j]); put(cur[j]); put(prevCols[j + 1]); put(prevCols[j + 1]); put(cur[j]); put(cur[j + 1]); }
    globe.setTriangles(PREFIX + "swathHead", ht, { normals: new Float32Array(ht.length) });

    const S = satFrame(), R = rO();
    const P = [S.r[0] * R, S.r[1] * R, S.r[2] * R];
    const fan = new Float32Array(K * 9);
    o = 0;
    for (let j = 0; j < K; j++) {
      fan.set(P, o); o += 3;
      fan.set([cur[j][0] * R_SWATH, cur[j][1] * R_SWATH, cur[j][2] * R_SWATH], o); o += 3;
      fan.set([cur[j + 1][0] * R_SWATH, cur[j + 1][1] * R_SWATH, cur[j + 1][2] * R_SWATH], o); o += 3;
    }
    globe.setTriangles(PREFIX + "fan", fan, { normals: new Float32Array(fan.length) });
    const e0 = cur[0].map((x) => x * R_SWATH), e1 = cur[K].map((x) => x * R_SWATH);
    globe.setSegments3D(PREFIX + "fanEdge", [[P, e0], [P, e1]]);
    globe.setSegments3D(PREFIX + "nadir", [[P, xyz(H.ll[0], H.ll[1], 1.001)]]);

    const ring = ringLonLat(params.inclination, S.drift, 192);
    const rs = new Float32Array(192 * 6);
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let j = 0; j < 192; j++) { xyz(ring[j][0], ring[j][1], R, a); xyz(ring[j + 1][0], ring[j + 1][1], R, b); rs.set(a, j * 6); rs.set(b, j * 6 + 3); }
    globe.setSegments3D(PREFIX + "ring", rs);

    const s = 0.03 * clamp(globe.dist / 3.4, 0.5, 1.6), pv = s * 0.8;
    const pt = (x, y, z) => [P[0] + S.r[0] * x + S.v[0] * y + S.c[0] * z, P[1] + S.r[1] * x + S.v[1] * y + S.c[1] * z, P[2] + S.r[2] * x + S.v[2] * y + S.c[2] * z];
    const box = [];
    const C = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => pt(x * s, y * s * 1.3, z * s));
    for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [1, 5, 6, 2], [0, 3, 7, 4]]) box.push(C[f[0]], C[f[1]], C[f[2]], C[f[0]], C[f[2]], C[f[3]]);
    globe.setTriangles(PREFIX + "body", box.flat());
    const pan = [];
    for (const sg of [1, -1]) {
      const a0 = pt(0, -pv, sg * s * 1.3), a1 = pt(0, pv, sg * s * 1.3), a2 = pt(0, pv, sg * s * 5.2), a3 = pt(0, -pv, sg * s * 5.2);
      pan.push(a0, a1, a2, a0, a2, a3);
    }
    globe.setTriangles(PREFIX + "panels", pan.flat());

    const nodes = ascendingNodes(params.altitude, params.inclination, params.orbits, rotK).filter((nd) => nd.t <= t + 1e-6);
    if (nodes.length) globe.addPoints(PREFIX + "nodes", nodes.map((nd) => [nd.lon, 0]), { color: BRASS, size: 9 }); else globe.remove(PREFIX + "nodes");
    const pr = preset();
    const name = pr ? pr.label : "Satellite";
    const lab = PREFIX + "satLabel";
    const text = `${name} · ${params.altitude} km`;
    if (!globe.labels3d.has(lab)) globe.addLabel3D(lab, P, text, { color: INK, away: [0, 0, 0], gap: 16, occlude: true });
    globe.setLabel3D(lab, { point: P, text, visible: L.W >= 640 });
    const shift = facts(params.altitude, params.inclination, true).shift * rotK;
    if (nodes.length >= 2 && shift > 0.5) {
      const l0 = nodes[0].lon, l1 = nodes[1].lon;
      const span = mod(l0 - l1, 360);
      const arc = [];
      const steps = Math.max(2, Math.ceil(span / 1.5));
      for (let k = 0; k < steps; k++) arc.push([xyz(l0 - (span * k) / steps, 0, 1.004), xyz(l0 - (span * (k + 1)) / steps, 0, 1.004)]);
      globe.addSegments3D(PREFIX + "shiftArc", arc, { color: BRASS, width: 3.2, order: 3 });
      const mid = xyz(l0 - span / 2, 0, 1.004);
      const sid = PREFIX + "shiftLabel", st = `${shift.toFixed(2)}° west per pass`;
      if (!globe.labels3d.has(sid)) globe.addLabel3D(sid, mid, st, { color: BRASS, away: [0, 0, 0], gap: 10, occlude: true });
      else globe.setLabel3D(sid, { point: mid, text: st, visible: true });
    } else {
      globe.remove(PREFIX + "shiftArc");
      if (globe.labels3d.has(PREFIX + "shiftLabel")) globe.setLabel3D(PREFIX + "shiftLabel", { visible: false });
    }
  };

  const applySpin = () => {
    if (!globe || ctx.side !== "A") return;
    const target = -rotK * driftRate(params.altitude, params.inclination) * t * 60;
    if (Number.isNaN(spinApplied)) { spinApplied = target; return; }
    const d = target - spinApplied;
    if (Math.abs(d) < 1e-9) return;
    spinQ.setFromAxisAngle({ x: 0, y: 1, z: 0 }, d * DEG);
    globe.group.quaternion.multiply(spinQ);
    spinApplied = target;
    globe.invalidate();
  };

  const X = (lon) => L.mx + ((lon + 180) / 360) * L.mw;
  const Y = (lat) => L.my + ((90 - lat) / 180) * L.mh;

  const edgeRel = (i, side) => {
    const elon = edges[i * 4 + side * 2], elat = edges[i * 4 + side * 2 + 1];
    let rel = wrap(elon - TR.lon[i]);
    if (Math.abs(rel) > 90) return [0, elat >= 0 ? 90 : -90];
    return [rel, elat];
  };

  const quad = (g, pts) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[0] < lo) lo = p[0]; if (p[0] > hi) hi = p[0]; }
    for (const off of [0, -360, 360]) {
      if (off === -360 && hi <= 180) continue;
      if (off === 360 && lo >= -180) continue;
      g.moveTo(X(pts[0][0] + off), Y(pts[0][1]));
      for (let k = 1; k < pts.length; k++) g.lineTo(X(pts[k][0] + off), Y(pts[k][1]));
      g.closePath();
    }
  };

  const polyline = (g, lons, lats, from, to, tail) => {
    let prevX = 0, lastY = 0;
    const to2 = (x, y) => {
      const dx = x - prevX;
      if (Math.abs(dx) > L.mw / 2) {
        const sh = dx > 0 ? -L.mw : L.mw;
        g.lineTo(x + sh, y);
        g.moveTo(prevX - sh, lastY);
      }
      g.lineTo(x, y);
      prevX = x; lastY = y;
    };
    for (let i = from; i <= to; i++) {
      const x = X(lons[i]), y = Y(lats[i]);
      if (i === from) { g.moveTo(x, y); prevX = x; lastY = y; } else to2(x, y);
    }
    if (tail) to2(X(tail[0]), Y(tail[1]));
  };

  const draw2D = () => {
    if (!L || !TR) return;
    const g = pc.getContext("2d");
    const dpr = stage.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, L.pw, L.ph);
    const H = head();
    const drawn = Math.floor(H.f);
    const pass = Math.min(params.orbits, Math.floor(t / TR.T + 1e-9) + 1);

    const passText = `pass ${pass} of ${params.orbits} · ${fmtTime(t)}`;
    g.textBaseline = "middle";
    g.font = `500 11px ${FONT_MONO}`;
    const room = L.mw - g.measureText(`pass ${params.orbits} of ${params.orbits} · ${fmtTime(TR.total)}`).width - 12;
    g.font = `500 10px ${FONT_UI}`;
    const titles = L.mw > 520 ? ["FLAT MAP · EQUIRECTANGULAR · SAME TIME AS THE GLOBE"] : [];
    titles.push("FLAT MAP · EQUIRECTANGULAR", "FLAT MAP");
    const title = titles.find((s) => g.measureText(s).width <= room) || titles[titles.length - 1];
    g.textAlign = "left"; g.fillStyle = INK3;
    g.fillText(title, L.mx, HEAD / 2 + 1);
    g.font = `500 11px ${FONT_MONO}`; g.textAlign = "right"; g.fillStyle = INK2;
    g.fillText(passText, L.mx + L.mw, HEAD / 2 + 1);

    g.save();
    g.beginPath(); g.roundRect(L.mx, L.my, L.mw, L.mh, 6); g.clip();
    if (baseImg) { g.imageSmoothingEnabled = true; g.drawImage(baseImg, L.mx, L.my, L.mw, L.mh); }
    else { g.fillStyle = "#bcd1dd"; g.fillRect(L.mx, L.my, L.mw, L.mh); }
    g.fillStyle = "rgba(250,248,243,.3)"; g.fillRect(L.mx, L.my, L.mw, L.mh);
    g.lineWidth = 1; g.strokeStyle = "rgba(60,52,40,.18)";
    g.beginPath();
    for (let lon = -150; lon < 180; lon += 30) { g.moveTo(Math.round(X(lon)) + 0.5, L.my); g.lineTo(Math.round(X(lon)) + 0.5, L.my + L.mh); }
    for (let lat = -60; lat <= 60; lat += 30) if (lat) { g.moveTo(L.mx, Math.round(Y(lat)) + 0.5); g.lineTo(L.mx + L.mw, Math.round(Y(lat)) + 0.5); }
    g.stroke();
    g.strokeStyle = "rgba(184,82,23,.55)"; g.lineWidth = 1.25;
    g.beginPath(); g.moveTo(L.mx, Y(0)); g.lineTo(L.mx + L.mw, Y(0)); g.stroke();

    const per = Math.round(TR.perOrbit);
    for (let ob = 0; ob < params.orbits; ob++) {
      const i0 = ob * per, i1 = Math.min(drawn, (ob + 1) * per);
      if (i1 <= i0) break;
      g.beginPath();
      for (let i = i0; i < i1; i++) {
        const base = TR.lon[i], a0 = edgeRel(i, 0), a1 = edgeRel(i, 1), b0 = edgeRel(i + 1, 0), b1 = edgeRel(i + 1, 1);
        const dn = wrap(TR.lon[i + 1] - base);
        quad(g, [[base + a0[0], a0[1]], [base + dn + b0[0], b0[1]], [base + dn + b1[0], b1[1]], [base + a1[0], a1[1]]]);
      }
      if (i1 === drawn && drawn < TR.n - 1) {
        const nxt = subPoint(params.altitude, params.inclination, t + 0.05, rotK);
        const e = swathEdges(H.ll, nxt, params.swath / 2);
        const base = TR.lon[drawn], a0 = edgeRel(drawn, 0), a1 = edgeRel(drawn, 1);
        const r0 = wrap(e[0][0] - base), r1 = wrap(e[1][0] - base);
        if (Math.abs(r0) < 90 && Math.abs(r1) < 90) quad(g, [[base + a0[0], a0[1]], [base + r0, e[0][1]], [base + r1, e[1][1]], [base + a1[0], a1[1]]]);
      }
      g.fillStyle = "rgba(29,99,168,.26)"; g.fill("nonzero");
    }

    g.lineJoin = "round"; g.lineCap = "round";
    if (drawn < TR.n - 1) {
      g.beginPath(); polyline(g, TR.lon, TR.lat, drawn, TR.n - 1);
      g.setLineDash([3, 4]); g.strokeStyle = "rgba(29,99,168,.5)"; g.lineWidth = 1; g.stroke(); g.setLineDash([]);
    }
    g.beginPath(); polyline(g, TR.lon, TR.lat, 0, drawn, H.ll);
    g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3.6; g.stroke();
    g.strokeStyle = SIGNAL; g.lineWidth = 1.8; g.stroke();

    const nodes = ascendingNodes(params.altitude, params.inclination, params.orbits, rotK).filter((nd) => nd.t <= t + 1e-6);
    const ang = crossingAngle(params.altitude, params.inclination, rotK);
    if (nodes.length) {
      const x0 = X(nodes[0].lon), y0 = Y(0);
      g.strokeStyle = BRASS; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + 22, y0); g.stroke();
      g.beginPath(); g.arc(x0, y0, 15, 0, -ang * DEG, true); g.stroke();
      const mid = -ang * DEG / 2;
      g.font = `600 11px ${FONT_MONO}`; g.textAlign = "left"; g.textBaseline = "middle";
      const lt = `${ang.toFixed(1)}°`;
      const lx = x0 + Math.cos(mid) * 22 + (Math.cos(mid) < 0 ? -g.measureText(lt).width : 2), ly = y0 + Math.sin(mid) * 22 - 4;
      g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.85)"; g.strokeText(lt, lx, ly);
      g.fillStyle = BRASS; g.fillText(lt, lx, ly);
    }
    g.font = `600 10px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "top";
    nodes.forEach((nd, k) => {
      const x = X(nd.lon), y = Y(0);
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath();
      g.fillStyle = BRASS; g.fill(); g.lineWidth = 1.5; g.strokeStyle = "#f1ede4"; g.stroke();
      if (k < 8 || k === nodes.length - 1) {
        g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.85)"; g.strokeText(String(nd.pass), x, y + 7);
        g.fillStyle = BRASS; g.fillText(String(nd.pass), x, y + 7);
      }
    });
    const shift = facts(params.altitude, params.inclination, true).shift * rotK;
    if (nodes.length >= 2 && shift > 0.5) {
      const x0 = X(nodes[0].lon), x1 = X(nodes[1].lon), y = Y(0) + 26;
      if (x1 < x0) {
        g.strokeStyle = BRASS; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1 + 2, y); g.stroke();
        g.beginPath(); g.moveTo(x1, y); g.lineTo(x1 + 7, y - 4); g.lineTo(x1 + 7, y + 4); g.closePath(); g.fillStyle = BRASS; g.fill();
        const tx = `${shift.toFixed(2)}° W`;
        g.font = `600 11px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "top";
        g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.85)"; g.strokeText(tx, (x0 + x1) / 2, y + 5);
        g.fillStyle = BRASS; g.fillText(tx, (x0 + x1) / 2, y + 5);
      }
    }

    if (hover2d) {
      const x = X(TR.lon[hover2d.i]), y = Y(TR.lat[hover2d.i]);
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
    }
    const nxt = subPoint(params.altitude, params.inclination, t + 0.05, rotK);
    const e = swathEdges(H.ll, nxt, params.swath / 2);
    const sx = X(H.ll[0]), sy = Y(H.ll[1]);
    const r0 = wrap(e[0][0] - H.ll[0]), r1 = wrap(e[1][0] - H.ll[0]);
    if (Math.abs(r0) < 90 && Math.abs(r1) < 90) {
      g.beginPath(); g.moveTo(X(H.ll[0] + r0), Y(e[0][1])); g.lineTo(X(H.ll[0] + r1), Y(e[1][1]));
      g.strokeStyle = "rgba(250,248,243,.7)"; g.lineWidth = 4; g.stroke();
      g.strokeStyle = SIGNAL; g.lineWidth = 2; g.stroke();
    }
    g.beginPath(); g.arc(sx, sy, 5.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.lineWidth = 2; g.strokeStyle = BRASS; g.stroke();
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.4)"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(L.mx + 0.5, L.my + 0.5, L.mw - 1, L.mh - 1, 6); g.stroke();
  };

  const caption = () => {
    const f = facts(params.altitude, params.inclination, true);
    const pass = Math.min(params.orbits, Math.floor(t / TR.T + 1e-9) + 1);
    capTitle.textContent = `Pass ${pass} of ${params.orbits} · ${fmtTime(t)}`;
    capBar.style.background = rotK > 0.5 ? BRASS : VIOLET;
    if (rotK > 0.5) capText.textContent = `The Earth turns ${(f.shift * rotK).toFixed(1)}° under the orbit in ${f.period.toFixed(1)} min. The next pass lands west.`;
    else capText.textContent = "The Earth does not turn. Every pass follows one circle.";
  };

  const readouts = () => {
    const f = facts(params.altitude, params.inclination, params.earthRotates);
    ctx.readout.setMany({ period: f.period, speed: f.speed, shift: f.shift, perDay: f.perDay, maxLat: f.maxLat });
  };

  const render = () => {
    applySpin();
    update3D();
    draw2D();
    caption();
  };

  const setM = (v) => {
    m = clamp(v, 0, 1);
    t = m * TR.total;
    render();
  };

  const bar = stage.el.parentElement ? stage.el.parentElement.querySelector(".transport") : null;
  const playBtn = bar ? bar.querySelector(".tp-play") : null;
  const range = bar ? bar.querySelector(".tp-range") : null;
  const paintPlay = (on) => {
    ctx.controls.setLabel("play", on ? "Pause" : "Play orbit");
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
    const from = m;
    playTw = ctx.anim.tween({
      from, to: 1, duration: Math.max(1, (1 - from) * params.orbits * MS_PER_ORBIT), ease: ctx.anim.ease.linear,
      onUpdate: (v) => { setM(v); paintRange(); },
      onDone: () => {
        playTw = null;
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          if (!playing) return;
          playTw = ctx.anim.tween({ from: 1, to: 0, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
        }, 1200);
      },
    });
  };
  const startPlay = () => {
    if (playing) return;
    if (jumpTw) { jumpTw.cancel(); jumpTw = null; }
    playing = true;
    paintPlay(true);
    if (m >= 0.999) {
      playTw = ctx.anim.tween({ from: m, to: 0, duration: 700, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
    } else run();
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

  const jumpTo = (tMin) => {
    stopPlay(false);
    if (jumpTw) jumpTw.cancel();
    const target = clamp(tMin / TR.total, 0, 1);
    if (ctx.reducedMotion) { setM(target); paintRange(); if (ctx.transport) ctx.transport.set(m); return; }
    jumpTw = ctx.anim.tween({ from: m, to: target, duration: 450, ease: ctx.anim.ease.standard, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { jumpTw = null; if (ctx.transport) ctx.transport.set(m); } });
  };

  if (ctx.transport) ctx.transport.onScrub((v) => {
    if (playing) stopPlay(false);
    if (jumpTw) { jumpTw.cancel(); jumpTw = null; }
    if (TR) setM(v); else m = v;
  });

  const nearestOnGlobe = (lon, lat) => {
    if (!TR) return null;
    const p = xyz(lon, lat);
    let best = -1, bd = -2;
    for (let i = 0; i < TR.n; i++) {
      const la = TR.lat[i] * DEG, lo = TR.lon[i] * DEG, c = Math.cos(la);
      const d = p[0] * c * Math.sin(lo) + p[1] * Math.sin(la) + p[2] * c * Math.cos(lo);
      if (d > bd) { bd = d; best = i; }
    }
    const thr = clamp(1.6 * (globe ? globe.dist / 3 : 1), 0.6, 4);
    return Math.acos(clamp(bd, -1, 1)) * RAD < thr ? best : null;
  };

  const nearest2D = (x, y, maxPx = 14) => {
    let best = null, bd = maxPx;
    for (let i = 0; i < TR.n; i++) {
      const d = Math.hypot(X(TR.lon[i]) - x, Y(TR.lat[i]) - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const hoverLines = (i) => {
    const pass = Math.min(params.orbits, Math.floor(TR.t[i] / TR.T + 1e-9) + 1);
    const dir = i < TR.n - 1 ? (TR.lat[i + 1] >= TR.lat[i] ? "northbound" : "southbound") : "";
    return [`${fmtTime(TR.t[i])} after start`, `pass ${pass}, ${dir}${TR.t[i] > t + 1e-6 ? ", ahead" : ""}`];
  };

  const panelXY = (e) => { const r = panel.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const stageXY = (e) => { const r = stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const inMap = (x, y) => x >= L.mx && x <= L.mx + L.mw && y >= L.my && y <= L.my + L.mh;
  panel.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const [x, y] = panelXY(e);
    if (!inMap(x, y)) return;
    const i = nearest2D(x, y, 18);
    if (i === null) return;
    panel.setPointerCapture(e.pointerId);
    drag2d = { id: e.pointerId };
    stopPlay(false);
    if (jumpTw) { jumpTw.cancel(); jumpTw = null; }
    ctx.overlay.hideChip();
    panel.style.cursor = "grabbing";
    setM(TR.t[i] / TR.total); paintRange();
  }, { signal: ctx.signal });
  panel.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    const [x, y] = panelXY(e);
    if (drag2d) {
      const i = nearest2D(x, y, 60);
      if (i !== null) { setM(TR.t[i] / TR.total); paintRange(); }
      return;
    }
    const i = inMap(x, y) ? nearest2D(x, y, 12) : null;
    const was = hover2d ? hover2d.i : null;
    hover2d = i === null ? null : { i };
    if (was !== i) draw2D();
    panel.style.cursor = i === null ? "default" : "pointer";
    if (i === null) { ctx.overlay.hideChip(); return; }
    const [sx, sy] = stageXY(e);
    const lon = TR.lon[i], lat = TR.lat[i];
    ctx.overlay.chip(sx, sy, [`${ctx.fmt.lon(lon)} ${ctx.fmt.lat(lat)}`, ...hoverLines(i)]);
  }, { signal: ctx.signal });
  const end2d = (e) => {
    e.stopPropagation();
    if (!drag2d) return;
    drag2d = null;
    panel.style.cursor = "pointer";
    if (ctx.transport) ctx.transport.set(m);
  };
  panel.addEventListener("pointerup", end2d, { signal: ctx.signal });
  panel.addEventListener("pointercancel", end2d, { signal: ctx.signal });
  panel.addEventListener("pointerleave", () => { ctx.overlay.hideChip(); if (hover2d) { hover2d = null; draw2D(); } }, { signal: ctx.signal });
  panel.addEventListener("wheel", (e) => e.stopPropagation(), { signal: ctx.signal });
  panel.addEventListener("dblclick", (e) => e.stopPropagation(), { signal: ctx.signal });

  getBasemap({ colour: "ramp" }).then(async (bm) => {
    if (ctx.signal.aborted || !bm || !bm.color) return;
    const px = bm.color instanceof Uint8ClampedArray ? bm.color : new Uint8ClampedArray(bm.color.buffer, bm.color.byteOffset, bm.color.length);
    const img = await createImageBitmap(new ImageData(px, bm.width, bm.height), { resizeWidth: 2048, resizeHeight: 1024, resizeQuality: "high" });
    if (ctx.signal.aborted) { img.close(); return; }
    baseImg = img;
    draw2D();
  }).catch(() => {});

  const userSet = new Set();
  const animatePreset = (p) => {
    if (presetTw) presetTw.cancel();
    userSet.clear();
    const a0 = params.altitude, i0 = params.inclination, s0 = params.swath;
    const put = (k, v, o) => { if (!userSet.has(k)) ctx.controls.set(k, v, o); };
    const finish = () => {
      applying = true;
      put("altitude", p.alt, { silent: true });
      put("inclination", p.inc, { silent: true });
      put("swath", p.swath);
      put("altitude", p.alt);
      put("inclination", p.inc);
      applying = false;
      if (!userSet.size) return;
      userSet.clear();
      const want = matchPreset(params.altitude, params.inclination, params.swath);
      if (want !== params.preset) ctx.controls.set("preset", want);
    };
    if (ctx.reducedMotion || !booted) { finish(); return; }
    presetTw = ctx.anim.tween({
      from: 0, to: 1, duration: 750, ease: ctx.anim.ease.emph,
      onUpdate: (u) => {
        const v = { altitude: Math.round(a0 + (p.alt - a0) * u), inclination: Math.round((i0 + (p.inc - i0) * u) * 10) / 10, swath: Math.round(s0 + (p.swath - s0) * u) };
        const live = ["swath", "altitude", "inclination"].find((k) => !userSet.has(k));
        applying = true;
        for (const k of ["altitude", "inclination"]) if (k !== live) put(k, v[k], { silent: true });
        if (live) ctx.controls.set(live, v[live], { live: true });
        applying = false;
      },
      onDone: () => { presetTw = null; finish(); },
    });
  };

  const animateRotation = () => {
    if (rotTw) rotTw.cancel();
    const to = params.earthRotates ? 1 : 0;
    if (ctx.reducedMotion || !booted) { rotK = to; rebuild(); render(); return; }
    rotTw = ctx.anim.tween({ from: rotK, to, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (v) => { rotK = v; rebuild(); render(); }, onDone: () => { rotTw = null; } });
  };

  layout();
  fitCamera(0);

  setTimeout(() => {
    booted = true;
    if (ctx.side === "A" && !ctx.reducedMotion && ctx.url.get("m") === undefined && !ctx.signal.aborted) autoTimer = setTimeout(() => { autoTimer = 0; if (!ctx.signal.aborted && m < 0.001) startPlay(); }, 700);
  }, 0);

  const GEOM = ["altitude", "inclination", "orbits", "swath"];
  return {
    update(p, keys) {
      const prevOrbits = params.orbits, prevAlt = params.altitude;
      params = { ...p };
      if (keys.includes("play")) { togglePlay(); return; }
      if (presetTw && !applying) for (const k of keys) if (k === "altitude" || k === "inclination" || k === "swath") userSet.add(k);
      if (keys.length === 1 && keys[0] === "preset") {
        const pr = preset();
        if (pr) animatePreset(pr);
        return;
      }
      if (!applying && !presetTw && keys.length === 1 && ["altitude", "inclination", "swath"].includes(keys[0])) {
        const want = matchPreset(params.altitude, params.inclination, params.swath);
        if (want !== params.preset) ctx.controls.set("preset", want);
      }
      if (keys.length === 1 && keys[0] === "earthRotates") { animateRotation(); readouts(); return; }
      if (keys.length > 1) {
        rotK = params.earthRotates ? 1 : 0;
        const want = matchPreset(params.altitude, params.inclination, params.swath);
        if (want !== params.preset) { ctx.controls.set("preset", want, { silent: true }); params.preset = want; }
      }
      if (keys.some((k) => GEOM.includes(k) || k === "earthRotates") || !TR) {
        const tKeep = t;
        rebuild();
        if (keys.includes("orbits") && keys.length === 1 && prevOrbits !== params.orbits) {
          m = clamp(tKeep / TR.total, 0, 1);
          if (!playing && ctx.transport) { ctx.transport.set(m); return; }
        }
        if ((keys.includes("altitude") && prevAlt !== params.altitude) || keys.includes("inclination")) fitCamera(0);
      }
      if (keys.includes("m") && !playing && !jumpTw && !drag2d) m = params.m ?? m;
      t = m * TR.total;
      render();
      paintRange();
      readouts();
    },
    hover(lon, lat) {
      const i = nearestOnGlobe(lon, lat);
      return i === null ? [] : hoverLines(i);
    },
    probe(lon, lat) {
      const i = nearestOnGlobe(lon, lat);
      if (i !== null) jumpTo(TR.t[i]);
      return null;
    },
    unprobe() {},
    resize() { layout(); fitCamera(0); render(); },
    unmount() {
      stopPlay(false);
      clearTimers();
      if (autoTimer) clearTimeout(autoTimer);
      if (jumpTw) jumpTw.cancel();
      if (rotTw) rotTw.cancel();
      if (presetTw) presetTw.cancel();
      if (unkey) unkey();
      paintPlay(false);
      if (globe) { globe.removePrefix(PREFIX); globe.labelInsetBottom = 0; }
      if (baseImg) baseImg.close();
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
      panel.remove();
      cap.remove();
    },
  };
}
