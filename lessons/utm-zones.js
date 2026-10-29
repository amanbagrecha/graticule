import { morphs } from "@/core/globe.js";
import { aspectFrame, aspectRotation, make } from "@/core/projections.js";
import { centralMeridian, zone as utmZone, band as utmBand, forward as utmForward, tmForward, tmInverse, gridZones, K0, FALSE_EASTING, FALSE_NORTHING_SOUTH } from "@/core/utm.js";
import { DEG, clamp, smoothstep, lerp } from "@/core/math.js";
import { divergingRGB } from "@/core/palette.js";
import { sampleField, drawField, FONT_MONO, FONT_UI, drawCaption } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const EDGE = "rgba(26,25,23,.78)";
const GRID = "rgba(184,82,23,.30)";
const ALL = "rgba(26,25,23,.42)";
const HALO = "rgba(250,248,243,.85)";

export const meta = {
  id: "utm-zones",
  title: "Sixty cylinders",
  track: 5,
  order: 1,
  mode: "both",
  defaultMode: "3d",
  renderer: "webgl",
  projectionId: "transverseMercator",
  paragraph: "UTM is one transverse Mercator cylinder used sixty times. The cylinder is a little smaller than the globe. It cuts the surface along two lines where the scale is exactly true. Only a strip 3° either side of the central meridian is used. Turn the cylinder 6° and start again.",
  deeper: [
    "Zone n has central meridian −183 + 6n.",
    "k = 0.9996 on the central meridian and 1.0010 at the zone edge on the equator.",
    "The true-scale lines are 180 km either side of the centre.",
    "False easting 500,000 m; southern false northing 10,000,000 m.",
  ],
  keywords: ["UTM", "zone", "transverse Mercator", "k0", "secant"],
  controls: [
    { key: "zone", type: "number", label: "Zone", min: 1, max: 60, step: 1, default: 33 },
    { key: "hemisphere", type: "segment", label: "Hemisphere", options: [{ value: "N", label: "North" }, { value: "S", label: "South" }], default: "N" },
    { key: "field", type: "toggle", label: "Scale field", default: true, shortcut: "f" },
    { key: "showAll", type: "toggle", label: "All 60 zones", default: false, shortcut: "a" },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "k = 1, where the cylinder cuts the globe" },
      { color: EDGE, line: true, label: "Zone edge, 3° from the centre" },
      { color: "rgba(184,82,23,.55)", line: true, label: "100 km grid lines" },
      { color: "rgb(43,101,173)", label: "k below 1 (0.9996 on the centre)" },
      { color: BRASS, label: "k above 1 (1.001 at the edge)" },
    ] },
  ],
  readouts: [
    { key: "cm", label: "Central meridian", hero: true },
    { key: "k0", label: "k0", digits: 4 },
    { key: "kprobe", label: "k at probe", digits: 5 },
    { key: "en", label: "E, N at probe" },
    { key: "pzone", label: "Zone of probe" },
  ],
  transport: { label: ["globe", "flat"], key: "m" },
  compare: null,
  view: { lon: 15, lat: 22, dist: 3.5 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const LAT_S = -80, LAT_N = 84;
const CYL_R = K0;
const CYL_H = 0.95;
const TURN_MS = 480;
const FIT_PADDING = 28;

export const cmOf = (z) => centralMeridian(z);
export const zoneOf = (lon, lat = 0) => utmZone(lon, lat);

export function lonOffset(lon, cm) {
  return ((lon - cm + 540) % 360) - 180;
}

export function kAt(lon, lat, z) {
  return tmForward(lon, lat, cmOf(z), K0).k;
}

export function enAt(lon, lat, z, south = lat < 0) {
  const r = utmForward(lon, lat, z, south);
  return { E: r.E, N: r.N, k: r.k };
}

export function trueScaleOffset(lat) {
  let lo = 0, hi = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (tmForward(mid, lat, 0, K0).k < 1) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function trueScaleDistanceKm(lat = 0) {
  return tmForward(trueScaleOffset(lat), lat, 0, K0).x / 1000;
}

export function kSphere(dlon, lat) {
  const B = Math.cos(lat * DEG) * Math.sin(dlon * DEG);
  return K0 / Math.sqrt(1 - B * B);
}

export function kColour(k) {
  const t = k < 1 ? (k - 1) / (1 - K0) : (k - 1) / 0.001;
  return divergingRGB(clamp(t, -1, 1));
}

const fmtLonDeg = (lon) => `${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`;
const fmtM = (v) => Math.round(v).toLocaleString("en-US");

export function zoneLabel(lon, lat) {
  const z = zoneOf(lon, lat);
  const b = utmBand(lat);
  return b ? `${z}${b}` : `${z}`;
}

function relativeGeometry() {
  const edges = [], ktrue = [], gridE = [], gridN = [];
  for (const s of [-3, 3]) for (let lat = LAT_S; lat < LAT_N; lat += 1) edges.push([[s, lat], [s, Math.min(lat + 1, LAT_N)]]);
  for (const s of [-1, 1]) {
    let prev = null;
    for (let lat = LAT_S; lat <= LAT_N; lat += 1) {
      const p = [s * trueScaleOffset(lat), lat];
      if (prev) ktrue.push([prev, p]);
      prev = p;
    }
  }
  const inside = (ll) => Math.abs(ll.lon) <= 3.0001 && ll.lat >= LAT_S && ll.lat <= LAT_N;
  for (let x = -300000; x <= 300000; x += 100000) {
    let prev = null;
    for (let y = -9000000; y <= 9400000; y += 100000) {
      const ll = tmInverse(x, y, 0, K0);
      const ok = inside(ll);
      const p = [ll.lon, ll.lat];
      if (prev && ok) gridE.push([prev, p]);
      prev = ok ? p : null;
    }
  }
  for (let y = -8500000; y <= 9300000; y += 500000) {
    let prev = null;
    for (let x = -700000; x <= 700000; x += 20000) {
      const ll = tmInverse(x, y, 0, K0);
      const ok = inside(ll);
      const p = [ll.lon, ll.lat];
      if (prev && ok) gridN.push([prev, p]);
      prev = ok ? p : null;
    }
  }
  return { edges, ktrue, gridE, gridN };
}

const shift = (segs, cm) => segs.map(([a, b]) => [[a[0] + cm, a[1]], [b[0] + cm, b[1]]]);

function allZoneSegments() {
  const segs = [];
  for (const g of gridZones()) {
    const { west: w, east: e, south: s, north: n } = g;
    for (let lat = s; lat < n; lat += 2) segs.push([[w, lat], [w, Math.min(lat + 2, n)]]);
    for (let lon = w; lon < e; lon += 2) segs.push([[lon, n], [Math.min(lon + 2, e), n]]);
  }
  return segs;
}

function fieldStrip(width, height) {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const g = c.getContext("2d");
  const img = g.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    const lat = LAT_N - ((j + 0.5) / height) * (LAT_N - LAT_S);
    for (let i = 0; i < width; i++) {
      const dl = -3 + ((i + 0.5) / width) * 6;
      const [r, gg, b] = kColour(kSphere(dl, lat));
      const q = (j * width + i) * 4;
      img.data[q] = r; img.data[q + 1] = gg; img.data[q + 2] = b; img.data[q + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function mount(ctx) {
  return ctx.stage.globe ? mount3D(ctx) : mount2D(ctx);
}

export const isCompact = (W, H) => W < 640 || H < 420;

export function kPanelLayout(W, H) {
  if (!isCompact(W, H)) return { compact: false, margin: 16, pad: 12, w: 252, h: 132, axis: 44, font: 10 };
  return { compact: true, margin: 8, pad: 8, w: clamp(Math.round(W / 2 - 64), 104, 140), h: 86, axis: 38, font: 9 };
}

export const kPanelRight = (lay) => lay.margin + lay.w + 2 * lay.pad + 2;

const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const hits = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function kPanel(ctx) {
  const el = ctx.stage.element("div", "utm-kpanel");
  el.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:auto;height:auto;padding:10px 12px 8px;background:rgba(255,255,255,.92);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;";
  const title = document.createElement("div");
  const TITLE_CSS = "font:600 12px/16px var(--font-ui, sans-serif);color:#1a1917;margin-bottom:6px;";
  const TITLE_CSS_C = "font:600 11px/14px var(--font-ui, sans-serif);color:#1a1917;margin-bottom:4px;";
  const canvas = document.createElement("canvas");
  const cap = document.createElement("div");
  const CAP_CSS = "font:500 11px/14px var(--font-mono, monospace);color:#3f3c37;margin-top:4px;";
  const CAP_CSS_C = "font:500 10px/13px var(--font-mono, monospace);color:#3f3c37;margin-top:3px;white-space:nowrap;";
  el.append(title, canvas, cap);
  const meter = document.createElement("canvas").getContext("2d");
  const fit = (texts, font, room) => { meter.font = font; return texts.find((s) => meter.measureText(s).width <= room) || texts[texts.length - 1]; };
  let lay = kPanelLayout(ctx.stage.width, ctx.stage.height);
  let last = [0, null];
  const draw = (lat, probeX) => {
    last = [lat, probeX];
    const W = lay.w, H = lay.h, c = lay.compact;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const L = lay.axis, R = W - (c ? 4 : 8), T = c ? 6 : 8, B = H - (c ? 16 : 22);
    const xMax = 360;
    const X = (x) => L + ((x + xMax) / (2 * xMax)) * (R - L);
    const kLo = 0.9994, kHi = 1.0014;
    const Y = (k) => B - ((k - kLo) / (kHi - kLo)) * (B - T);
    const edge = tmForward(3, lat, 0, K0).x / 1000;
    const y0 = tmForward(0, lat, 0, K0).y;
    g.fillStyle = "rgba(26,25,23,.05)";
    g.fillRect(X(-edge), T, X(edge) - X(-edge), B - T);
    g.font = `500 ${lay.font}px ${FONT_MONO}`;
    g.strokeStyle = "rgba(60,52,40,.18)"; g.lineWidth = 1;
    for (const k of [0.9996, 1, 1.0008]) { g.beginPath(); g.moveTo(L, Y(k)); g.lineTo(R, Y(k)); g.stroke(); }
    g.fillStyle = "#6b665e"; g.textAlign = "right";
    for (const k of [0.9996, 1, 1.0008]) g.fillText(k.toFixed(4), L - 4, Y(k) + 3);
    g.textAlign = "center";
    for (const x of [-300, 0, 300]) g.fillText(`${(500 + x)}`, X(x), H - (c ? 5 : 8));
    g.strokeStyle = BRASS; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(L, Y(1)); g.lineTo(R, Y(1)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = "rgba(26,25,23,.7)"; g.lineWidth = 1;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(X(s * edge), T); g.lineTo(X(s * edge), B); g.stroke(); }
    g.beginPath();
    for (let x = -xMax; x <= xMax; x += 4) {
      const ll = tmInverse(x * 1000, y0, 0, K0);
      const k = tmForward(ll.lon, ll.lat, 0, K0).k;
      const q = [X(x), Y(Math.min(kHi, k))];
      if (x === -xMax) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]);
    }
    g.strokeStyle = SIGNAL; g.lineWidth = 1.75; g.stroke();
    const kt = trueScaleDistanceKm(lat);
    g.fillStyle = BRASS;
    for (const s of [-1, 1]) { g.beginPath(); g.arc(X(s * kt), Y(1), c ? 2.5 : 3, 0, Math.PI * 2); g.fill(); }
    if (probeX !== null && probeX !== undefined && Math.abs(probeX) <= xMax) {
      const ll = tmInverse(probeX * 1000, y0, 0, K0);
      const k = tmForward(ll.lon, ll.lat, 0, K0).k;
      g.fillStyle = "#1a1917"; g.beginPath(); g.arc(X(probeX), Y(Math.min(kHi, k)), c ? 3 : 3.5, 0, Math.PI * 2); g.fill();
    }
    const titleFull = "Scale k across the zone, E in km";
    const latTxt = `${Math.abs(Math.round(lat))}°${lat < 0 ? "S" : "N"}`;
    const capFull = `at ${latTxt} · k = 1 at ${kt.toFixed(0)} km from the centre`;
    title.textContent = c ? fit([titleFull, "Scale k, E in km"], `600 11px ${FONT_UI}`, W) : titleFull;
    cap.textContent = c ? fit([capFull, `${latTxt} · k = 1 at ${kt.toFixed(0)} km`, `k = 1 at ${kt.toFixed(0)} km`], `500 10px ${FONT_MONO}`, W) : capFull;
  };
  const setLayout = () => {
    lay = kPanelLayout(ctx.stage.width, ctx.stage.height);
    const c = lay.compact;
    el.style.left = el.style.top = lay.margin + "px";
    el.style.padding = c ? `6px ${lay.pad}px 5px` : `10px ${lay.pad}px 8px`;
    el.style.borderRadius = c ? "12px" : "14px";
    title.style.cssText = c ? TITLE_CSS_C : TITLE_CSS;
    cap.style.cssText = c ? CAP_CSS_C : CAP_CSS;
    draw(...last);
  };
  const rect = () => [el.offsetLeft, el.offsetTop, el.offsetLeft + el.offsetWidth, el.offsetTop + el.offsetHeight];
  setLayout();
  return { el, draw, setLayout, rect, layout: () => lay };
}

function shared(ctx) {
  const rel = relativeGeometry();
  const readoutsFor = (params, probed) => {
    const z = params.zone;
    const out = { cm: fmtLonDeg(cmOf(z)), k0: K0 };
    if (probed) {
      const south = params.hemisphere === "S";
      const r = enAt(probed.lon, probed.lat, z, south);
      out.kprobe = r.k;
      out.en = `${fmtM(r.E)} E · ${fmtM(r.N)} N`;
      out.pzone = zoneLabel(probed.lon, probed.lat);
    } else {
      out.kprobe = null; out.en = "–"; out.pzone = "–";
    }
    return out;
  };
  const hoverLines = (params, lon, lat) => {
    const z = params.zone;
    const south = params.hemisphere === "S";
    const r = enAt(lon, lat, z, south);
    const inside = Math.abs(lonOffset(lon, cmOf(z))) <= 3 && lat >= LAT_S && lat <= LAT_N;
    return [`zone ${zoneLabel(lon, lat)}${inside ? "" : `, outside zone ${z}`}`, `k = ${r.k.toFixed(5)}`, `E ${fmtM(r.E)}  N ${fmtM(r.N)}`];
  };
  const panel = kPanel(ctx);
  const drawPanel = (params, probed) => {
    if (!probed) { panel.draw(0, null); return; }
    const r = tmForward(probed.lon, probed.lat, cmOf(params.zone), K0);
    panel.draw(probed.lat, r.x / 1000);
  };
  return { rel, readoutsFor, hoverLines, panel, drawPanel };
}

async function mount3D(ctx) {
  const globe = ctx.stage.globe;
  const { rel, readoutsFor, hoverLines, panel, drawPanel } = shared(ctx);
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let cmShown = cmOf(params.zone);
  let turn = null;
  let booted = false;
  let oriented = false;
  let probed = null;
  let allBuilt = false;

  const ids = { gens: PREFIX + "gens", rims: PREFIX + "rims", axis: PREFIX + "axis", tips: PREFIX + "tips" };
  globe.addSegments3D(ids.gens, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(63,60,55,.3)", width: 1 });
  globe.addSegments3D(ids.rims, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(63,60,55,.6)", width: 1.5 });
  globe.addSegments3D(ids.axis, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(63,60,55,.6)", width: 1.25, dash: [6, 4] });
  globe.addPoints3D(ids.tips, [[0, 0, 0]], { color: BRASS, size: 9 });
  globe.labelInsetBottom = ctx.stage.insetBottom;
  if (globe.labelLayer) globe.labelLayer.avoid = () => [grow(panel.rect(), 6)];
  globe.addLabel3D(PREFIX + "zone-label", null, "", { color: BRASS, dx: 12, dy: -6 });
  globe.addLabel3D(PREFIX + "k-label", null, "", { color: BRASS, dx: 10, dy: -8, occlude: true });
  globe.addLabel3D(PREFIX + "axis-label", null, "", { color: INK2, dx: 12, dy: -18 });

  const W = 4096, H = 2048;
  const stripW = Math.round((6 * W) / 360), stripH = Math.round(((LAT_N - LAT_S) * H) / 180);
  const strip = fieldStrip(stripW, stripH);
  const px = (lon) => ((lon + 180) / 360) * W, py = (lat) => ((90 - lat) / 180) * H;

  globe.addCanvasOverlay(PREFIX + "veil", (g) => {
    const x0 = px(cmShown - 3), x1 = px(cmShown + 3), yN = py(LAT_N), yS = py(LAT_S), yEq = py(0);
    g.fillStyle = "rgba(250,248,243,.68)";
    g.fillRect(0, 0, x0, H); g.fillRect(x1, 0, W - x1, H);
    g.fillRect(x0, 0, x1 - x0, yN); g.fillRect(x0, yS, x1 - x0, H - yS);
    const north = params.hemisphere !== "S";
    if (params.field && strip) {
      g.globalAlpha = 0.62;
      const sy = north ? 0 : ((LAT_N - 0) / (LAT_N - LAT_S)) * stripH;
      const sh = north ? (LAT_N / (LAT_N - LAT_S)) * stripH : stripH - sy;
      g.drawImage(strip, 0, sy, stripW, sh, x0, north ? yN : yEq, x1 - x0, north ? yEq - yN : yS - yEq);
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(250,248,243,.22)";
    if (north) g.fillRect(x0, yEq, x1 - x0, yS - yEq); else g.fillRect(x0, yN, x1 - x0, yEq - yN);
  });

  const rotationFor = (cm) => aspectRotation(aspectFrame({ aspect: "transverse", lon0: cm }));

  const setMorph = () => {
    globe.morph(morphs.toAspectCylinder({ rotate: rotationFor(cmShown), rule: "conformal", latMax: 85 }), t);
  };

  const drawLines = () => {
    globe.addLines(PREFIX + "grid", shift([...rel.gridE, ...rel.gridN], cmShown), { color: GRID, width: 1 });
    globe.addLines(PREFIX + "edges", shift(rel.edges, cmShown), { color: EDGE, width: 1.5 });
    globe.addLines(PREFIX + "ktrue", shift(rel.ktrue, cmShown), { color: BRASS, width: 2 });
  };

  const drawAll = () => {
    if (params.showAll && !allBuilt) { globe.addLines(PREFIX + "all", allZoneSegments(), { color: ALL, width: 1 }); allBuilt = true; }
    if (allBuilt) globe.setLayer(PREFIX + "all", !!params.showAll);
    globe.setLayer("graticule", !params.showAll);
  };

  const axisDir = () => [Math.cos(cmShown * DEG), 0, -Math.sin(cmShown * DEG)];
  const centreDir = () => [Math.sin(cmShown * DEG), 0, Math.cos(cmShown * DEG)];

  const drawCylinder = () => {
    const A = axisDir(), C = centreDir(), N = [0, 1, 0];
    const fade = clamp(1 - (t - 0.3) / 0.15, 0, 1);
    const at = (h, a) => [A[0] * h + CYL_R * (C[0] * Math.cos(a) + N[0] * Math.sin(a)), A[1] * h + CYL_R * (C[1] * Math.cos(a) + N[1] * Math.sin(a)), A[2] * h + CYL_R * (C[2] * Math.cos(a) + N[2] * Math.sin(a))];
    const ring = (h) => { const s = []; for (let i = 0; i < 96; i++) s.push([at(h, (i / 96) * Math.PI * 2), at(h, ((i + 1) / 96) * Math.PI * 2)]); return s; };
    const gens = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; gens.push([at(-CYL_H, a), at(CYL_H, a)]); }
    const tip = (s) => [A[0] * s * (CYL_H + 0.4), 0, A[2] * s * (CYL_H + 0.4)];
    globe.setSegments3D(ids.gens, gens, { opacity: 0.3 * fade });
    globe.setSegments3D(ids.rims, [...ring(CYL_H), ...ring(-CYL_H)], { opacity: 0.6 * fade });
    globe.setSegments3D(ids.axis, [[tip(-1), tip(1)]], { opacity: 0.6 * fade });
    globe.setPoints3D(ids.tips, [tip(1), tip(-1)]);
    for (const id of Object.values(ids)) globe.setLayer(id, fade > 0);
    const c = panel.layout().compact;
    globe.setLabel3D(PREFIX + "axis-label", { point: tip(1), dx: c ? 6 : 12, text: fade > 0.5 ? (c ? "axis" : "cylinder axis") : "" });
  };

  const morphPoint = (lon, lat) => {
    const fn = globe.morphFn;
    return fn ? [...fn(lon, lat, t, [0, 0, 0])] : [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];
  };

  const drawLabels = () => {
    const south = params.hemisphere === "S", kLat = south ? -12 : 12;
    globe.setLabel3D(PREFIX + "zone-label", { point: morphPoint(cmShown, t > 0.5 ? (south ? LAT_S : LAT_N) : LAT_N + 1.5), text: `zone ${params.zone}` });
    globe.setLabel3D(PREFIX + "k-label", { point: morphPoint(cmShown + trueScaleOffset(kLat), kLat), text: "k = 1" });
  };

  const stripPoints = () => {
    const pts = [];
    const [s0, n0] = params.hemisphere === "S" ? [LAT_S, 2] : [-2, LAT_N];
    for (let lat = s0; lat <= n0; lat += 2) for (const d of [-4.5, 4.5]) pts.push(morphPoint(cmShown + d, lat));
    return pts;
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) { oriented = false; globe.camera.setPan(0, 0); globe.camera.setDist(Math.max(globe.camera.dist, meta.view.dist)); return; }
    if (!oriented) {
      oriented = true;
      globe.camera.lookAt(cmShown, 0, null, { duration: booted && !ctx.reducedMotion ? 500 : 0 });
    }
    const opts = { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, insetTop: 8, apply: false };
    const a = globe.camera.fit(null, { ...opts, minDist: meta.view.dist });
    const b = globe.camera.fit(stripPoints(), { ...opts, minDist: 1.3 });
    const w = smoothstep(0.35, 0.9, t);
    const p0 = smoothstep(0, 0.15, t);
    globe.camera.setDist(lerp(a.dist, b.dist, w));
    globe.camera.setPan(lerp(a.pan[0] * p0, b.pan[0], w), lerp(a.pan[1] * p0, b.pan[1], w));
  };

  const readouts = () => { ctx.readout.setMany(readoutsFor(params, probed)); drawPanel(params, probed); };

  const turnTo = () => {
    const target = cmOf(params.zone);
    if (turn) turn.cancel();
    const finish = () => {
      cmShown = target;
      setMorph(); drawLines(); drawCylinder(); drawLabels();
      globe.refreshOverlay();
      if (t > 0) { oriented = false; frameCamera(); }
      ctx.overlay.update();
    };
    let from = cmShown;
    if (!booted || ctx.reducedMotion || from === target) { finish(); return; }
    let d = target - from;
    if (d > 180) from += 360; else if (d < -180) from -= 360;
    if (t <= 0 && ctx.side === "A") globe.camera.lookAt(target, globe.camera.state().lat, null, { duration: TURN_MS });
    turn = ctx.anim.tween({ from, to: target, duration: TURN_MS, ease: ctx.anim.ease.emph, onUpdate: (v) => {
      cmShown = ((v + 540) % 360) - 180;
      if (t > 0) { setMorph(); if (ctx.side === "A") globe.camera.lookAt(cmShown, 0, null, { duration: 0 }); }
      drawLines(); drawCylinder(); drawLabels();
      globe.refreshOverlay();
      ctx.overlay.update();
    }, onDone: () => { turn = null; finish(); } });
  };

  setMorph();
  drawLines();
  drawAll();
  drawCylinder();
  drawLabels();
  readouts();

  if (ctx.transport) ctx.transport.onScrub((value) => {
    t = value;
    globe.setMorphT(t);
    drawCylinder();
    drawLabels();
    frameCamera();
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (keys.includes("zone")) turnTo();
      if (keys.includes("field") || keys.includes("hemisphere")) globe.refreshOverlay();
      if (keys.includes("hemisphere") && t > 0) frameCamera();
      if (keys.includes("showAll")) drawAll();
      if (keys.includes("zone") || keys.includes("hemisphere")) drawLabels();
      if (keys.length > 3 && t > 0) frameCamera();
      readouts();
    },
    hover(lon, lat) {
      return hoverLines(params, lon, lat);
    },
    probe(lon, lat) {
      probed = { lon, lat };
      const z = zoneOf(lon, lat);
      const hemi = lat < 0 ? "S" : "N";
      if (hemi !== params.hemisphere) ctx.controls.set("hemisphere", hemi);
      if (z !== params.zone) ctx.controls.set("zone", z);
      params = { ...params, zone: z, hemisphere: hemi };
      drawPanel(params, probed);
      return readoutsFor(params, probed);
    },
    unprobe() {
      probed = null;
      readouts();
    },
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      panel.setLayout();
      drawCylinder();
      if (t > 0) frameCamera();
    },
    unmount() {
      if (turn) turn.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      globe.setLayer("graticule", true);
      if (globe.labelLayer) globe.labelLayer.avoid = null;
      panel.el.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}

async function mount2D(ctx) {
  const map = ctx.stage.map;
  const { rel, readoutsFor, hoverLines, panel, drawPanel } = shared(ctx);
  let params = { ...ctx.params };
  let probed = null;
  let field = null, fieldKey = "";
  let booted = false;
  const allSegs = allZoneSegments();

  const band = () => {
    if (probed && probed.lat >= LAT_S && probed.lat <= LAT_N) { const c = clamp(probed.lat, LAT_S + 12, LAT_N - 12); return [c - 12, c + 12]; }
    return params.hemisphere === "S" ? [-60, -36] : [36, 60];
  };
  const fitGeo = (cm) => {
    const [s0, n0] = band();
    const pts = [];
    for (let lat = s0; lat <= n0; lat += 2) pts.push([cm - 6, lat], [cm + 6, lat]);
    return { type: "MultiPoint", coordinates: pts };
  };

  const layout = () => map.setInsets({ top: 8, bottom: ctx.stage.insetBottom + 8, left: 8, right: 8 });

  const setView = async (animate) => {
    const cm = cmOf(params.zone);
    map.setFitTarget(fitGeo(cm));
    await map.setProjection(make("transverseMercator", { lon0: cm }), { duration: animate ? 650 : 0, tag: "utm" + cm });
    map.invalidate();
  };

  const zoneRing = (cm) => {
    const ring = [];
    for (let lat = LAT_S; lat <= LAT_N; lat += 2) ring.push([cm + 3, lat]);
    for (let lat = LAT_N; lat >= LAT_S; lat -= 2) ring.push([cm - 3, lat]);
    return ring;
  };

  const segGeo = (segs) => ({ type: "MultiLineString", coordinates: segs });

  const stripRight = (P, cm, yMax) => {
    let x = -Infinity;
    for (let lat = LAT_S; lat <= LAT_N; lat += 1) {
      const q = P([cm + 3, lat]);
      if (q && q[1] <= yMax) x = Math.max(x, q[0]);
    }
    return x;
  };

  const captionFit = (g, options, room) => {
    const width = (lines) => {
      g.font = `600 13px ${FONT_UI}`;
      let w = g.measureText(lines[0]).width;
      g.font = `400 12px ${FONT_UI}`;
      for (const l of lines.slice(1)) w = Math.max(w, g.measureText(l).width);
      return w + 28;
    };
    return options.find((lines) => width(lines) <= room) || null;
  };

  let taken = [];
  map.labelLayer.avoid = () => taken;

  map.addLayer(PREFIX + "field", (g, path, P) => {
    const cm = cmOf(params.zone);
    const key = map.stateKey() + "|" + cm;
    if (!field || fieldKey !== key) {
      field = sampleField(P, map.width, map.height, map.morph ? 8 : 3, (lon, lat) => kSphere(lonOffset(lon, cm), lat));
      fieldKey = key;
    }
    const outside = new Path2D();
    outside.rect(0, 0, map.width, map.height);
    const zp = new Path2D();
    zoneRing(cm).forEach((ll, i) => { const q = P(ll); if (q) (i ? zp.lineTo(q[0], q[1]) : zp.moveTo(q[0], q[1])); });
    zp.closePath();
    outside.addPath(zp);
    g.fillStyle = "rgba(250,248,243,.5)";
    g.fill(outside, "evenodd");
    if (params.field) {
      g.save();
      g.clip(zp);
      drawField(g, field, (k) => kColour(k), { alpha: 0.6 });
      g.restore();
    }
  }, { order: 46 });

  map.addLayer(PREFIX + "lines", (g, path, P) => {
    const cm = cmOf(params.zone);
    const stroke = (geo, color, width, dash) => { g.beginPath(); path(geo); g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
    if (params.showAll) stroke(segGeo(allSegs), ALL, 1);
    stroke(segGeo(shift([...rel.gridE, ...rel.gridN], cm)), "rgba(184,82,23,.38)", 1);
    stroke(segGeo(shift(rel.edges, cm)), EDGE, 1.5);
    stroke(segGeo(shift(rel.ktrue, cm)), BRASS, 2);
    taken = [grow(panel.rect(), 4), [0, map.height - ctx.stage.insetBottom, map.width, map.height]];
    const capFull = [`Zone ${params.zone} · central meridian ${fmtLonDeg(cm)}`, "Transverse Mercator, k0 = 0.9996.", "The field shows the scale factor k."];
    const lay = panel.layout();
    if (!lay.compact) {
      const r = drawCaption(g, map.width - 18, 14, capFull, { accent: BRASS, align: "right" });
      taken.push([map.width - 18 - r.w, 14, map.width - 18, 14 + r.h]);
    } else {
      const xR = map.width - 8;
      const room = xR - Math.max(kPanelRight(lay) + 8, stripRight(P, cm, 90) + 8);
      const lines = captionFit(g, [capFull, capFull.slice(0, 2), [`Zone ${params.zone}`, `Central meridian ${fmtLonDeg(cm)}`], [`Zone ${params.zone} · ${fmtLonDeg(cm)}`]], room);
      if (lines) {
        const r = drawCaption(g, xR, 8, lines, { accent: BRASS, align: "right" });
        taken.push([xR - r.w, 8, xR, 8 + r.h]);
      }
    }
    g.font = `500 11px ${FONT_MONO}`;
    g.lineJoin = "round";
    const label = (ll, text, color, align = "left", dx = 6, dy = -6) => {
      const q = P(ll);
      if (!q || q[0] < 0 || q[0] > map.width || q[1] < 0 || q[1] > map.height) return;
      const x = q[0] + dx, y = q[1] + dy;
      const m = g.measureText(text);
      const x0 = align === "left" ? x : align === "right" ? x - m.width : x - m.width / 2;
      const box = [x0 - 2, y - m.actualBoundingBoxAscent - 2, x0 + m.width + 2, y + m.actualBoundingBoxDescent + 2];
      if (box[0] < 0 || box[2] > map.width || box[1] < 0 || taken.some((b) => hits(box, b))) return;
      taken.push(box);
      g.textAlign = align;
      g.lineWidth = 3; g.strokeStyle = HALO; g.strokeText(text, x, y);
      g.fillStyle = color; g.fillText(text, x, y);
    };
    const lb = (band()[0] + band()[1]) / 2;
    label([cm + trueScaleOffset(lb), lb], "k = 1", BRASS);
    label([cm - trueScaleOffset(lb), lb], "k = 1", BRASS, "right", -6);
    label([cm, lb + 4], "0.9996", INK, "center", 0, -6);
    const yLab = tmForward(cm, band()[0] + 0.6, cm, K0).y;
    for (const x of [0, -200000, 200000]) {
      const ll = tmInverse(x, yLab, cm, K0);
      label([ll.lon, ll.lat], x ? `${(FALSE_EASTING + x) / 1000}` : "500 km E", "rgba(184,82,23,.85)", "center", 0, -6);
    }
    label([cm + 3, lb - 4], "zone edge", INK2, "left", 6, -4);
    const south = params.hemisphere === "S";
    for (let y = 0; y <= 10000000; y += 500000) {
      const ll = tmInverse(-320000, south ? y - FALSE_NORTHING_SOUTH : y, cm, K0);
      if ((south && ll.lat > 0.01) || (!south && ll.lat < -0.01)) continue;
      label([ll.lon, ll.lat], `${fmtM(y / 1000)} km N`, "rgba(184,82,23,.85)", "right", -6, 4);
    }
  }, { order: 55, clip: false });

  const readouts = () => { ctx.readout.setMany(readoutsFor(params, probed)); drawPanel(params, probed); };

  layout();
  await setView(false);
  readouts();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("zone") || keys.includes("hemisphere")) setView(booted && !ctx.reducedMotion);
      map.invalidate();
      readouts();
    },
    hover(lon, lat) {
      return hoverLines(params, lon, lat);
    },
    probe(lon, lat) {
      probed = { lon, lat };
      const z = zoneOf(lon, lat);
      const hemi = lat < 0 ? "S" : "N";
      if (hemi !== params.hemisphere) ctx.controls.set("hemisphere", hemi);
      if (z !== params.zone) ctx.controls.set("zone", z);
      params = { ...params, zone: z, hemisphere: hemi };
      drawPanel(params, probed);
      setView(booted && !ctx.reducedMotion);
      return readoutsFor(params, probed);
    },
    unprobe() {
      probed = null;
      readouts();
    },
    resize() {
      panel.setLayout();
      layout();
      map.invalidate();
    },
    unmount() {
      map.removePrefix(PREFIX);
      map.setFitTarget(null);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
      map.labelLayer.avoid = null;
      panel.el.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
