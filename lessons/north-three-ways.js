import { magnetic } from "@/core/geodesy.js";
import { zone as utmZone, centralMeridian, forward as utmForward, inverse as utmInverse } from "@/core/utm.js";
import { make } from "@/core/projections.js";
import { clamp } from "@/core/math.js";
import { FONT_UI, smallCircle } from "@/core/map2d.js";

const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const HALO = "rgba(250,248,243,.9)";
const DEG = Math.PI / 180;

export const YEAR = 2026.0;
export const LAT_MIN = -80;
export const LAT_MAX = 84;

export const meta = {
  id: "north-three-ways",
  title: "True, grid and magnetic north",
  track: 1,
  order: 9,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "transverseMercator",
  labels: false,
  paragraph: "On a map, north has three meanings: the pole, the grid lines and the compass. Follow the wrong one and you walk off course.",
  deeper: [
    "The angle from true to grid north is about Δλ·sin φ.",
    "On the central meridian of the zone, grid north is true north.",
    "The magnetic pole moves about 40 km each year.",
    "This view uses the WMM2025 model for the year 2026.",
  ],
  keywords: ["declination", "convergence", "magnetic", "grid north", "WMM"],
  controls: [
    { key: "point", type: "point", label: "Place", default: [18, 60] },
  ],
  readouts: [
    { key: "gm", label: "Compass vs grid", digits: 2, unit: "°", hero: true },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["wmm.json"],
};

const PREFIX = meta.id + ":";

export function placeOf(point) {
  return [((point[0] + 540) % 360) - 180, clamp(point[1], LAT_MIN, LAT_MAX)];
}

export function convergence(lon, lat, zone) {
  return utmForward(lon, lat, zone, lat < 0).gamma;
}

export function declination(model, lon, lat, year = YEAR) {
  return magnetic(model, lon, lat, 0, year).D;
}

export function norths(model, lon, lat, year = YEAR) {
  const zone = utmZone(lon, lat);
  const gamma = convergence(lon, lat, zone);
  const D = declination(model, lon, lat, year);
  return { zone, cm: centralMeridian(zone), south: lat < 0, gamma, D, gm: D - gamma };
}

export function screenAngles(n) {
  return { grid: 0, true: -n.gamma, magnetic: n.D - n.gamma };
}

export function angleText(v) {
  const a = Math.abs(v);
  if (a < 0.05) return "0°";
  return `${a.toFixed(1)}° ${v > 0 ? "E" : "W"}`;
}

export function tipTexts(n) {
  return { true: "true N", grid: `grid N ${angleText(n.gamma)}`, magnetic: `magnetic N ${angleText(n.D)}` };
}

export function utmGridLines(zone, south, N0, { span = 1500e3, step = 100e3, sample = 50e3 } = {}) {
  const lines = [];
  const nLo = Math.ceil((N0 - span) / step) * step, nHi = Math.floor((N0 + span) / step) * step;
  const run = (pts) => {
    let cur = [];
    for (const [E, N] of pts) {
      const r = utmInverse(E, N, zone, south);
      if (!isFinite(r.lon) || !isFinite(r.lat) || Math.abs(r.lat) > 86) { if (cur.length > 1) lines.push(cur); cur = []; continue; }
      cur.push([r.lon, r.lat]);
    }
    if (cur.length > 1) lines.push(cur);
  };
  for (let E = -1000e3; E <= 2000e3; E += step) {
    const pts = [];
    for (let N = nLo; N <= nHi + 1; N += sample) pts.push([E, N]);
    run(pts);
  }
  for (let N = nLo; N <= nHi; N += step) {
    const pts = [];
    for (let E = -1000e3; E <= 2000e3 + 1; E += sample) pts.push([E, N]);
    run(pts);
  }
  return { type: "MultiLineString", coordinates: lines };
}

const boxAt = (q, r, deg, w, h) => {
  const s = Math.sin(deg * DEG), c = Math.cos(deg * DEG);
  const px = q[0] + s * r, py = q[1] - c * r;
  const cx = px + (s * w) / 2, cy = py - (c * h) / 2;
  return { px, py, cx, cy, box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] };
};

const hit = (a, b, pad = 0) => a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad;
const inside = (a, B) => a[0] >= B[0] && a[1] >= B[1] && a[2] <= B[2] && a[3] <= B[3];

export function fanLabels(q, r, items, bounds, { step = 2, pad = 4 } = {}) {
  const order = items.map((it, i) => ({ ...it, i, a: ((it.deg + 540) % 360) - 180 })).sort((u, v) => u.a - v.a);
  const mid = Math.floor((order.length - 1) / 2);
  const seq = [mid];
  for (let k = 1; k < order.length; k++) { if (mid - k >= 0) seq.push(mid - k); if (mid + k < order.length) seq.push(mid + k); }
  const placed = [];
  const out = new Array(items.length);
  for (const j of seq) {
    const it = order[j];
    const dir = j < mid ? -1 : j > mid ? 1 : 0;
    let pick = null, firstFree = null;
    for (let k = 0; k <= 180 / step && !pick; k++) {
      const tries = dir === 0 ? (k === 0 ? [0] : [-k * step, k * step]) : [dir * k * step];
      for (const d of tries) {
        const b = boxAt(q, r, it.a + d, it.w, it.h);
        if (placed.some((p) => hit(b.box, p, pad))) continue;
        if (!firstFree) firstFree = { ...b, deg: it.a + d };
        if (inside(b.box, bounds)) { pick = { ...b, deg: it.a + d }; break; }
      }
    }
    pick = pick || firstFree || { ...boxAt(q, r, it.a, it.w, it.h), deg: it.a };
    placed.push(pick.box);
    out[it.i] = pick;
  }
  return out;
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  const model = ctx.data.get("wmm.json") || (await ctx.data.load("wmm.json"));
  let params = { ...ctx.params };
  let n = null, ang = { grid: 0, true: 0, magnetic: 0 }, angTw = null;
  let gridKey = null, shownZone = null;
  const FONT = `600 13px ${FONT_UI}`;
  let texts = null, sizes = null;

  const place = () => placeOf(params.point);
  const stageH = () => map.height - ctx.stage.insetBottom;
  const radius = () => clamp(Math.min(map.width, stageH()) * 0.14, 52, 118);

  const measure = (g) => {
    g.font = FONT;
    sizes = {};
    for (const k of Object.keys(texts)) sizes[k] = { w: Math.ceil(g.measureText(texts[k]).width) + 4, h: 16 };
  };

  const recompute = () => {
    const [lon, lat] = place();
    n = norths(model, lon, lat);
    texts = tipTexts(n);
    sizes = null;
  };

  const setGrid = () => {
    const [lon, lat] = place();
    const N0 = utmForward(lon, lat, n.zone, n.south).N;
    const key = `${n.zone}|${n.south}|${Math.round(N0 / 1e6)}`;
    if (key === gridKey) return;
    gridKey = key;
    map.addFeatures(PREFIX + "grid", utmGridLines(n.zone, n.south, Math.round(N0 / 1e6) * 1e6, { span: 2000e3 }), { stroke: "rgba(184,82,23,.5)", width: 1, order: 46 });
  };

  const frameView = (refit) => {
    const [lon, lat] = place();
    map.setFitTarget({ type: "MultiPoint", coordinates: smallCircle(lon, lat, 4, 24) });
    if (refit || n.zone !== shownZone) {
      shownZone = n.zone;
      const p = make("transverseMercator", { lon0: n.cm });
      p.precision(0.3);
      return map.setProjection(p, { duration: 0, tag: "ntw" + n.zone });
    }
    const q = map.project(lon, lat), m = radius() + 40;
    if (!q.visible || q.x < m || q.x > map.width - m || q.y < m || q.y > stageH() - m) map.setState({ lon, lat });
    return Promise.resolve();
  };

  const tweenAngles = (animate) => {
    const target = screenAngles(n);
    if (angTw) angTw.cancel();
    angTw = null;
    if (!animate || ctx.reducedMotion) { ang = target; map.invalidate(); return; }
    const from = { ...ang };
    for (const k of Object.keys(target)) if (Math.abs(target[k] - from[k]) > 180) from[k] += target[k] > from[k] ? 360 : -360;
    angTw = ctx.anim.tween({ from: 0, to: 1, duration: 350, ease: ctx.anim.ease.standard, onUpdate: (v) => {
      for (const k of Object.keys(target)) ang[k] = from[k] + (target[k] - from[k]) * v;
      map.invalidate();
    }, onDone: () => { angTw = null; } });
  };

  const meridianLayer = (g, path) => {
    const [lon, lat] = place();
    const coords = [];
    for (let la = Math.max(-86, lat - 20); la <= Math.min(86, lat + 20); la += 0.5) coords.push([lon, la]);
    g.setLineDash([3, 4]);
    g.strokeStyle = "rgba(26,25,23,.55)"; g.lineWidth = 1;
    g.beginPath(); path({ type: "LineString", coordinates: coords }); g.stroke();
    g.setLineDash([]);
  };

  const arrow = (g, q, deg, len, color, width) => {
    const s = Math.sin(deg * DEG), c = -Math.cos(deg * DEG);
    const tip = [q[0] + s * len, q[1] + c * len];
    const px = -c, py = s;
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = HALO; g.lineWidth = width + 3;
    g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(tip[0] - s * 8, tip[1] - c * 8); g.stroke();
    g.strokeStyle = color; g.lineWidth = width;
    g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(tip[0] - s * 8, tip[1] - c * 8); g.stroke();
    g.fillStyle = color; g.strokeStyle = HALO; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(tip[0], tip[1]); g.lineTo(tip[0] - s * 14 + px * 5.5, tip[1] - c * 14 + py * 5.5); g.lineTo(tip[0] - s * 14 - px * 5.5, tip[1] - c * 14 - py * 5.5); g.closePath(); g.stroke(); g.fill();
    return tip;
  };

  const compassLayer = (g, path, projection) => {
    if (!n) return;
    const [lon, lat] = place();
    const q = projection([lon, lat]);
    if (!q || !isFinite(q[0])) return;
    const R = radius();
    g.fillStyle = "rgba(250,248,243,.72)";
    g.beginPath(); g.arc(q[0], q[1], R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(60,52,40,.45)"; g.lineWidth = 1;
    g.beginPath(); g.arc(q[0], q[1], R, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let d = 0; d < 360; d += 10) {
      const a = (d + ang.true) * DEG, major = d % 90 === 0, r0 = R - (major ? 9 : 4);
      g.moveTo(q[0] + Math.sin(a) * r0, q[1] - Math.cos(a) * r0); g.lineTo(q[0] + Math.sin(a) * R, q[1] - Math.cos(a) * R);
    }
    g.strokeStyle = "rgba(60,52,40,.5)"; g.stroke();
    const len = R + 22;
    const list = [
      { k: "grid", color: ORANGE },
      { k: "true", color: INK },
      { k: "magnetic", color: BLUE },
    ];
    const tips = {};
    for (const it of list) tips[it.k] = arrow(g, q, ang[it.k], len, it.color, 2.4);
    g.fillStyle = HALO; g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fill();
    if (!sizes) measure(g);
    const bounds = [6, 6, map.width - 6, stageH() - 6];
    const spots = fanLabels(q, len + 8, list.map((it) => ({ deg: ang[it.k], w: sizes[it.k].w, h: sizes[it.k].h })), bounds);
    g.font = FONT; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    list.forEach((it, i) => {
      const s = spots[i], tip = tips[it.k];
      const bx = clamp(tip[0], s.box[0], s.box[2]), by = clamp(tip[1], s.box[1], s.box[3]);
      if (Math.hypot(bx - tip[0], by - tip[1]) > 12) {
        g.strokeStyle = it.color; g.globalAlpha = 0.7; g.lineWidth = 1;
        g.beginPath(); g.moveTo(tip[0], tip[1]); g.lineTo(bx, by); g.stroke();
        g.globalAlpha = 1;
      }
      g.strokeStyle = HALO; g.lineWidth = 4; g.strokeText(texts[it.k], s.cx, s.cy);
      g.fillStyle = it.color; g.fillText(texts[it.k], s.cx, s.cy);
    });
  };

  const readouts = () => ctx.readout.set("gm", n.gm);

  recompute();
  setGrid();
  map.addLayer(PREFIX + "meridian", meridianLayer, { order: 47 });
  map.addLayer(PREFIX + "compass", compassLayer, { order: 60 });
  map.setLayer("graticule", false);
  await frameView(true);
  tweenAngles(false);
  readouts();
  let first = true;

  return {
    update(p, keys) {
      params = { ...p };
      if (first) { first = false; readouts(); return; }
      const moved = keys.includes("point");
      recompute();
      if (moved) { setGrid(); frameView(false); }
      tweenAngles(true);
      readouts();
      map.invalidate();
    },
    hover(lon, lat) {
      const h = norths(model, lon, lat);
      return [`grid N ${angleText(h.gamma)}`, `magnetic N ${angleText(h.D)}`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(4), +clamp(lat, LAT_MIN, LAT_MAX).toFixed(4)]);
      return null;
    },
    unprobe() {},
    resize() { map.invalidate(); },
    unmount() {
      if (angTw) angTw.cancel();
      map.removePrefix(PREFIX);
      map.setLayer("graticule", true);
      map.setFitTarget(null);
    },
  };
}
