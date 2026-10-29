import { make, obliqueRotation, graticuleGeo } from "@/core/projections.js";
import { inverse, rhumb, rhumbPoints, greatCirclePoints, sphereBearing, SPHERE } from "@/core/geodesy.js";
import { canvasPath } from "@/core/globe.js";
import { drawCaption, smallCircle, FONT_UI, FONT_MONO } from "@/core/map2d.js";
import { clamp, lonLatToXYZ, xyzToLonLat, slerp } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
export const LONDON = [-0.1278, 51.5074];
export const TOKYO = [139.6503, 35.6762];

export const KINDS = [
  { value: "mercator", label: "Mercator", name: "Mercator", straight: "The rhumb line is straight." },
  { value: "gnomonic", label: "Gnomonic", name: "Gnomonic", straight: "The great circle is straight." },
  { value: "aeqd", label: "Aeqd", name: "Azimuthal equidistant on A", short: ["Equidistant on A", "Equidistant"], straight: "Great circles through A are straight." },
  { value: "polar", label: "Polar", name: "Polar stereographic", short: ["Polar stereo", "Polar"], straight: "Conformal: the rhumb crosses each meridian at one angle." },
];

export const meta = {
  id: "great-circle-vs-rhumb",
  title: "Straight depends on the map",
  track: 4,
  order: 1,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "mercator",
  labels: false,
  paragraph: "A ship that holds one compass course sails a rhumb line. The shortest path is a great circle. On Mercator the rhumb line is straight. On the gnomonic map the great circle is straight. Navigators drew the great circle on one map and moved it to the other.",
  deeper: [
    "London → Tokyo: 9,560 km by great circle, 11,300 km by rhumb.",
    "The great circle starts at 032°, the rhumb holds 099°.",
    "Near the pole a rhumb line spirals.",
    "On a conformal map the rhumb crosses each meridian at one angle.",
  ],
  keywords: ["great circle", "rhumb", "loxodrome", "gnomonic"],
  controls: [
    { key: "A", type: "point", label: "Point A", default: LONDON },
    { key: "B", type: "point", label: "Point B", default: TOKYO },
    { type: "legend", label: "Show", items: [{ color: BRASS, line: true, label: "Great circle" }, { color: VIOLET, line: true, label: "Rhumb line" }, { color: SIGNAL, dash: true, label: "Waypoint legs (rhumb)" }] },
    { key: "gc", type: "toggle", label: "Great circle", default: true },
    { key: "rhumb", type: "toggle", label: "Rhumb line", default: true },
    { key: "hero", type: "segment", label: "Large map", options: KINDS.map(({ value, label }) => ({ value, label })), default: "mercator" },
    { key: "waypoints", type: "range", label: "Waypoints", min: 0, max: 12, step: 1, default: 6, ticks: [0, 6, 12] },
  ],
  readouts: [
    { key: "gcKm", label: "Great circle", digits: 0, unit: "km", hero: true },
    { key: "rhumbKm", label: "Rhumb", digits: 0, unit: "km" },
    { key: "extra", label: "Extra", digits: 1, unit: "%" },
    { key: "gcBearing", label: "GC start bearing", digits: 1, unit: "°" },
    { key: "rhumbBearing", label: "Rhumb bearing", digits: 1, unit: "°" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const R_KM = SPHERE.a / 1000;
const N_LINE = 180;
const PAD = 16;
const GAP = 10;
const CAPTION_H = 64;

const SHELL = (() => {
  const out = [], n = 400, g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * r * 1.05, y * 1.05, Math.sin(g * i) * r * 1.05]);
  }
  return out;
})();

const norm360 = (b) => ((b % 360) + 360) % 360;
const wrap = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

export function measures(A, B) {
  const g = inverse(A[0], A[1], B[0], B[1], SPHERE);
  const r = rhumb(A[0], A[1], B[0], B[1]);
  const gcKm = g.s12 / 1000, rhumbKm = r.distance / 1000;
  return { gcKm, rhumbKm, extra: gcKm > 0 ? (rhumbKm / gcKm - 1) * 100 : 0, gcBearing: norm360(g.azi1), rhumbBearing: r.bearing, gcFinal: norm360(g.azi2) };
}

export function waypointsOf(A, B, n) {
  const a = lonLatToXYZ(A[0], A[1]), b = lonLatToXYZ(B[0], B[1]);
  const pts = [A];
  for (let i = 1; i <= n; i++) pts.push(xyzToLonLat(slerp(a, b, i / (n + 1))));
  pts.push(B);
  return pts;
}

export function legs(A, B, n, per = 24) {
  const w = waypointsOf(A, B, n);
  const out = [];
  let km = 0;
  for (let i = 1; i < w.length; i++) {
    out.push(rhumbPoints(w[i - 1], w[i], per));
    km += rhumb(w[i - 1][0], w[i - 1][1], w[i][0], w[i][1]).distance / 1000;
  }
  return { points: w, legs: out, km };
}

export function midpoint(A, B) {
  return xyzToLonLat(slerp(lonLatToXYZ(A[0], A[1]), lonLatToXYZ(B[0], B[1]), 0.5));
}

function midLon(A, B) {
  let d = B[0] - A[0];
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return wrap(A[0] + d / 2);
}

export function poleOf(A, B) {
  return A[1] + B[1] >= 0 ? 1 : -1;
}

function latSpan(A, B) {
  const pts = [...greatCirclePoints(A, B, 48), ...rhumbPoints(A, B, 48)];
  let lo = 90, hi = -90;
  for (const q of pts) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }
  return [lo, hi];
}

export function panelProjection(kind, A, B, box, { tight = false } = {}) {
  const [[x0, y0], [x1, y1]] = box;
  let p;
  if (kind === "mercator") {
    const lc = midLon(A, B);
    const [lo, hi] = latSpan(A, B);
    p = make("mercator", { lon0: lc });
    p.fitExtent(box, { type: "MultiPoint", coordinates: [[lc - 179.999, clamp(lo - 14, -80, -56)], [lc + 179.999, clamp(hi + 10, 72, 82)]] });
  } else if (kind === "gnomonic") {
    const d = (inverse(A[0], A[1], B[0], B[1], SPHERE).a12) / 2;
    const r = clamp(d + 14, 30, 82);
    p = make("gnomonic", { rotate: obliqueRotation(A, B), clipAngle: Math.min(84, r + 30) });
    p.fitExtent(box, { type: "Polygon", coordinates: [smallCircle(...midpoint(A, B), r, 96)] });
  } else if (kind === "aeqd") {
    p = make("azimuthalEquidistant", { lon0: A[0], lat0: A[1] });
    const d = inverse(A[0], A[1], B[0], B[1], SPHERE).a12;
    p.fitExtent(box, tight ? { type: "Polygon", coordinates: [smallCircle(A[0], A[1], clamp(d * 1.2 + 10, 30, 179), 96)] } : { type: "Sphere" });
  } else {
    const s = poleOf(A, B);
    p = make("stereographic", { rotate: [-midLon(A, B), -90 * s, 0], clipAngle: 112 });
    const [lo, hi] = latSpan(A, B);
    const reach = s > 0 ? 90 - lo : 90 + hi;
    p.fitExtent(box, tight ? { type: "Polygon", coordinates: [smallCircle(0, 90 * s, clamp(reach + 10, 25, 112), 96)] } : { type: "Sphere" });
  }
  p.clipExtent([[x0, y0], [x1, y1]]).precision(0.2);
  return p;
}

export function straightness(projection, pts) {
  const xy = pts.map((q) => projection(q)).filter((q) => q && isFinite(q[0]));
  const a = xy[0], b = xy[xy.length - 1];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  let m = 0;
  for (const q of xy) m = Math.max(m, Math.abs((b[0] - a[0]) * (a[1] - q[1]) - (a[0] - q[0]) * (b[1] - a[1])) / L);
  return m;
}

export function bearingOnGreatCircle(P, B) {
  return sphereBearing(P[0], P[1], B[0], B[1]);
}

function cut(pts, f) {
  if (f >= 1) return pts;
  const k = Math.max(1, Math.floor((pts.length - 1) * f));
  const out = pts.slice(0, k + 1);
  const u = (pts.length - 1) * f - k;
  if (k + 1 < pts.length && u > 0) {
    const a = lonLatToXYZ(pts[k][0], pts[k][1]), b = lonLatToXYZ(pts[k + 1][0], pts[k + 1][1]);
    out.push(xyzToLonLat(slerp(a, b, u)));
  }
  return out;
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const map = stage.map;
  const globe = stage.globe;
  const land = ctx.data.get("land-110m.json") || (await ctx.data.load("land-110m.json"));
  const grat = graticuleGeo(15);
  let params = { ...ctx.params };
  let P = null;
  let drawn = 1;
  let legShown = 0;
  let drawTween = null, legTween = null;
  let dragging = null;
  let heroProj = null;
  let booted = false;
  let layout = null;
  let hoverHit = null;
  const thumbs = new Map();

  const compute = () => {
    const A = params.A, B = params.B;
    const L = legs(A, B, params.waypoints);
    P = { A, B, gc: greatCirclePoints(A, B, N_LINE), rh: rhumbPoints(A, B, N_LINE), m: measures(A, B), legs: L };
  };

  const readouts = () => {
    const m = P.m;
    ctx.readout.setMany({ gcKm: m.gcKm, rhumbKm: m.rhumbKm, extra: m.extra, gcBearing: m.gcBearing, rhumbBearing: m.rhumbBearing });
  };

  const strip = stage.element("div", "gcr-strip");
  strip.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:4;";

  const thumbKinds = () => (map ? KINDS.filter((k) => k.value !== params.hero) : KINDS);

  const computeLayout = () => {
    const W = stage.width, H = stage.height - stage.insetBottom;
    const kinds = thumbKinds();
    const n = kinds.length;
    const tw = Math.floor((W - 2 * PAD - (n - 1) * GAP) / n);
    const th = Math.round(clamp(Math.min(tw * 0.62, H * 0.27), 110, 230));
    const top = H - PAD - th;
    layout = { W, H, tw, th, top, kinds, hero: [[PAD, PAD + CAPTION_H], [W - PAD, top - GAP - 4]] };
  };

  const buildThumbs = () => {
    for (const t of thumbs.values()) t.el.remove();
    thumbs.clear();
    const dpr = stage.dpr;
    layout.kinds.forEach((k, i) => {
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${PAD + i * (layout.tw + GAP)}px;top:${layout.top}px;width:${layout.tw}px;height:${layout.th}px;border:1px solid #cdc6b7;border-radius:10px;background:#faf8f3;overflow:hidden;pointer-events:auto;cursor:pointer;transition:border-color 140ms, box-shadow 140ms;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);`;
      const c = document.createElement("canvas");
      c.width = Math.round(layout.tw * dpr); c.height = Math.round(layout.th * dpr);
      c.style.cssText = "width:100%;height:100%;display:block;";
      el.append(c);
      strip.append(el);
      const t = { kind: k.value, el, c, proj: null, w: layout.tw, h: layout.th };
      thumbs.set(k.value, t);
      bindThumb(t);
    });
  };

  const thumbProjection = (t) => panelProjection(t.kind, P.A, P.B, [[8, 24], [t.w - 8, t.h - 8]], { tight: true });

  const drawLines = (g, path, proj, scale = 1) => {
    g.lineJoin = "round"; g.lineCap = "round";
    const line = (pts, color, width, dash) => {
      g.beginPath(); path({ type: "LineString", coordinates: pts });
      g.setLineDash([]); g.strokeStyle = "rgba(250,248,243,.65)"; g.lineWidth = width + 2.5 * scale; g.stroke();
      g.setLineDash(dash || []); g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.setLineDash([]);
    };
    if (params.rhumb) line(cut(P.rh, drawn), VIOLET, 2.2 * scale);
    if (params.gc) line(cut(P.gc, drawn), BRASS, 2.4 * scale);
    const nl = P.legs.legs.length;
    if (params.waypoints > 0) {
      for (let i = 0; i < nl; i++) {
        const f = clamp(legShown - i, 0, 1);
        if (f <= 0) break;
        line(cut(P.legs.legs[i], f), SIGNAL, 1.6 * scale, [5 * scale, 4 * scale]);
      }
      g.fillStyle = SIGNAL;
      for (let i = 1; i < P.legs.points.length - 1; i++) {
        if (legShown < i - 0.5) break;
        const q = proj(P.legs.points[i]);
        if (!q) continue;
        g.beginPath(); g.arc(q[0], q[1], 2.8 * scale, 0, Math.PI * 2); g.fill();
      }
    }
    for (const [k, pt] of [["A", P.A], ["B", P.B]]) {
      const q = proj(pt);
      if (!q || !isFinite(q[0])) continue;
      g.beginPath(); g.arc(q[0], q[1], 5.5 * scale, 0, Math.PI * 2);
      g.fillStyle = INK; g.fill(); g.lineWidth = 2; g.strokeStyle = "#f1ede4"; g.stroke();
      g.font = `600 ${Math.round(12 * scale)}px ${FONT_MONO}`; g.textAlign = "left"; g.textBaseline = "middle";
      g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.85)"; g.strokeText(k, q[0] + 8 * scale, q[1] - 9 * scale);
      g.fillStyle = INK; g.fillText(k, q[0] + 8 * scale, q[1] - 9 * scale);
    }
  };

  const drawThumb = (t) => {
    const g = t.c.getContext("2d");
    const k = stage.dpr;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, t.w, t.h);
    t.proj = thumbProjection(t);
    const path = canvasPath(t.proj, g);
    g.save();
    g.beginPath(); path({ type: "Sphere" }); g.fillStyle = "#c7dae4"; g.fill();
    g.beginPath(); path(land); g.fillStyle = "#ddd3bb"; g.fill();
    g.beginPath(); path(grat); g.lineWidth = 0.5; g.strokeStyle = "rgba(60,52,40,.2)"; g.stroke();
    g.beginPath(); path({ type: "Sphere" }); g.lineWidth = 1; g.strokeStyle = "rgba(60,52,40,.4)"; g.stroke();
    drawLines(g, path, t.proj, 0.75);
    g.restore();
    const info = KINDS.find((x) => x.value === t.kind);
    g.fillStyle = "rgba(250,248,243,.82)"; g.fillRect(0, 0, t.w, 20);
    g.font = `500 10px ${FONT_UI}`; g.fillStyle = INK3; g.textAlign = "left"; g.textBaseline = "middle";
    const titles = [info.name, ...(info.short || [])].map((s) => s.toUpperCase());
    g.fillText(titles.find((s) => g.measureText(s).width <= t.w - 16) || titles[titles.length - 1], 8, 10.5);
    const sel = map ? false : params.hero === t.kind;
    t.el.style.borderColor = sel ? BRASS : "#cdc6b7";
    t.el.style.boxShadow = sel ? "0 0 0 1px #b85217, 0 0 14px rgba(184,82,23,.25)" : "0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8)";
    t.el.title = info.straight;
  };

  const drawThumbs = () => { for (const t of thumbs.values()) drawThumb(t); };

  const nearPin = (proj, x, y, r = 13) => {
    for (const k of ["A", "B"]) {
      const q = proj(params[k]);
      if (q && Math.hypot(q[0] - x, q[1] - y) < r) return k;
    }
    return null;
  };

  const setPin = (k, ll, live) => {
    ctx.controls.set(k, [+ll[0].toFixed(4), +clamp(ll[1], -89, 89).toFixed(4)], live ? { live: true } : undefined);
  };

  function bindThumb(t) {
    let st = null;
    t.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || ctx.side !== "A") return;
      const r = t.el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const k = t.proj ? nearPin(t.proj, x, y) : null;
      st = { k, x, y, moved: 0, id: e.pointerId };
      t.el.setPointerCapture(e.pointerId);
      e.stopPropagation();
      if (k) { dragging = k; t.el.style.cursor = "grabbing"; }
    }, { signal: ctx.signal });
    t.el.addEventListener("pointermove", (e) => {
      e.stopPropagation();
      const r = t.el.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (!st) {
        t.el.style.cursor = t.proj && nearPin(t.proj, x, y) ? "grab" : "pointer";
        const sr = stage.el.getBoundingClientRect();
        ctx.overlay.chip(e.clientX - sr.left, e.clientY - sr.top, [KINDS.find((q) => q.value === t.kind).name, KINDS.find((q) => q.value === t.kind).straight]);
        return;
      }
      st.moved += Math.abs(x - st.x) + Math.abs(y - st.y);
      st.x = x; st.y = y;
      if (!st.k || !t.proj.invert) return;
      ctx.overlay.hideChip();
      const ll = t.proj.invert([x, y]);
      if (ll && isFinite(ll[0])) setPin(st.k, ll, true);
    }, { signal: ctx.signal });
    const end = (e) => {
      e.stopPropagation();
      if (!st) return;
      const s = st;
      st = null;
      t.el.style.cursor = "pointer";
      if (s.k) { dragging = null; setPin(s.k, params[s.k], false); return; }
      if (s.moved < 5 && params.hero !== t.kind) ctx.controls.set("hero", t.kind);
    };
    t.el.addEventListener("pointerup", end, { signal: ctx.signal });
    t.el.addEventListener("pointercancel", end, { signal: ctx.signal });
    t.el.addEventListener("pointerleave", () => ctx.overlay.hideChip(), { signal: ctx.signal });
  }

  const heroCaption = () => {
    const info = KINDS.find((k) => k.value === params.hero);
    const m = P.m;
    const lines = [info.name, info.straight];
    if (params.waypoints > 0) lines.push(`${params.waypoints} waypoints: ${params.waypoints + 1} rhumb legs, ${Math.round(P.legs.km).toLocaleString("en-US")} km (+${((P.legs.km / m.gcKm - 1) * 100).toFixed(1)} %).`);
    else lines.push(`Rhumb ${Math.round(m.rhumbKm).toLocaleString("en-US")} km, great circle ${Math.round(m.gcKm).toLocaleString("en-US")} km.`);
    return lines;
  };

  const setHero = (duration) => {
    heroProj = panelProjection(params.hero, P.A, P.B, layout.hero, { tight: params.hero === "polar" });
    const tag = [params.hero, P.A.join(","), P.B.join(","), layout.hero.flat().join(",")].join("|");
    return map.setProjection(heroProj, { duration: booted && !ctx.reducedMotion ? duration : 0, opts: { fit: false }, tag });
  };

  const heroLayer = (g, path, projection) => {
    drawLines(g, path, projection, 1);
    if (hoverHit) {
      const q = projection(hoverHit.at);
      if (q) { g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = hoverHit.color; g.stroke(); }
    }
  };

  const draw3D = () => {
    if (!globe) return;
    const segs = (pts) => { const s = []; for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]); return s; };
    if (params.rhumb) globe.addLines(PREFIX + "rhumb", segs(cut(P.rh, drawn)), { color: VIOLET, width: 2.2, depth: true }); else globe.remove(PREFIX + "rhumb");
    if (params.gc) globe.addLines(PREFIX + "gc", segs(cut(P.gc, drawn)), { color: BRASS, width: 2.6, depth: true }); else globe.remove(PREFIX + "gc");
    const legSegs = [];
    if (params.waypoints > 0) for (let i = 0; i < P.legs.legs.length; i++) { const f = clamp(legShown - i, 0, 1); if (f <= 0) break; legSegs.push(...segs(cut(P.legs.legs[i], f))); }
    if (legSegs.length) globe.addLines(PREFIX + "legs", legSegs, { color: SIGNAL, width: 1.6, depth: true, dash: [5, 4] }); else globe.remove(PREFIX + "legs");
    const wp = params.waypoints > 0 ? P.legs.points.slice(1, -1).filter((_, i) => legShown >= i + 0.5) : [];
    if (wp.length) globe.addPoints(PREFIX + "wp", wp, { color: SIGNAL, size: 6 }); else globe.remove(PREFIX + "wp");
    globe.addPoints(PREFIX + "pins", [P.A, P.B], { color: INK, size: 12 });
    ctx.overlay.label(PREFIX + "A", { lon: P.A[0], lat: P.A[1] }, "A", { color: INK, leader: true, dx: -18, dy: -20, mono: true });
    ctx.overlay.label(PREFIX + "B", { lon: P.B[0], lat: P.B[1] }, "B", { color: INK, leader: true, dx: 14, dy: -20, mono: true });
  };

  const redraw = () => {
    if (map) map.invalidate();
    draw3D();
    drawThumbs();
  };

  const animateLines = () => {
    if (drawTween) drawTween.cancel();
    if (legTween) legTween.cancel();
    const nl = P.legs.legs.length;
    if (ctx.reducedMotion || !booted) { drawn = 1; legShown = nl; redraw(); return; }
    drawn = 0; legShown = 0;
    drawTween = ctx.anim.tween({ from: 0, to: 1, duration: 400, ease: ctx.anim.ease.out, onUpdate: (v) => { drawn = v; redraw(); }, onDone: () => { drawTween = null; animateLegs(); } });
  };

  const animateLegs = () => {
    if (legTween) legTween.cancel();
    const nl = params.waypoints > 0 ? P.legs.legs.length : 0;
    if (ctx.reducedMotion || !booted || !nl) { legShown = nl; redraw(); return; }
    legShown = 0;
    legTween = ctx.anim.tween({ from: 0, to: nl, duration: 60 * nl + 140, ease: ctx.anim.ease.linear, onUpdate: (v) => { legShown = v; redraw(); }, onDone: () => { legTween = null; legShown = nl; redraw(); } });
  };

  const aimGlobe = (duration) => {
    if (!globe || ctx.side !== "A") return;
    const mid = midpoint(P.A, P.B);
    const H = stage.height, inset = layout ? H - layout.top + GAP : 0;
    globe.camera.lookAt(mid[0], clamp(mid[1] * 0.85, -60, 60), null, { duration: ctx.reducedMotion ? 0 : duration });
    const f = globe.camera.fit(SHELL, { padding: 16, insetBottom: inset, insetTop: 8, minDist: 2.2, apply: false });
    globe.camera.glideTo(f, { duration: ctx.reducedMotion || !booted ? 0 : duration });
  };

  const placeAll = (duration = 0) => {
    computeLayout();
    buildThumbs();
    if (map) { map.setInsets({ top: 0, bottom: stage.insetBottom }); setHero(duration); }
    redraw();
  };

  compute();
  placeAll(0);
  readouts();

  let offDrag = null, offDbl = null;
  if (map) {
    map.addLayer(PREFIX + "lines", heroLayer, { order: 55 });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, PAD + 4, PAD, heroCaption(), { accent: params.hero === "gnomonic" ? BRASS : params.hero === "mercator" ? VIOLET : SIGNAL }), { order: 90, clip: false });
    map.setDragFilter((x, y) => (map.morph ? null : nearPin(map.projection, x, y)));
    offDrag = map.on("customdrag", (e) => {
      if (e.phase === "start") { dragging = e.claim; map.canvas.style.cursor = "grabbing"; ctx.overlay.hideChip(); return; }
      if (e.phase === "move") {
        const ll = map.projection.invert ? map.projection.invert([e.x, e.y]) : null;
        if (ll && isFinite(ll[0])) setPin(e.claim, ll, true);
        return;
      }
      dragging = null;
      map.canvas.style.cursor = "grab";
      setPin(e.claim, params[e.claim], false);
    });
    offDbl = map.on("customdblclick", () => {});
    map.canvas.addEventListener("pointermove", (ev) => {
      if (dragging) return;
      const r = map.canvas.getBoundingClientRect();
      map.canvas.style.cursor = nearPin(map.projection, ev.clientX - r.left, ev.clientY - r.top) ? "grab" : "default";
    }, { signal: ctx.signal });
  }

  let gDrag = null;
  if (globe) {
    const el = stage.el;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pinAt = (x, y) => {
      for (const k of ["A", "B"]) { const s = globe.project(params[k][0], params[k][1]); if (s.visible && Math.hypot(s.x - x, s.y - y) < 14) return k; }
      return null;
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || ctx.side !== "A") return;
      const [x, y] = pos(e);
      const k = pinAt(x, y);
      if (!k) return;
      e.stopPropagation(); e.preventDefault();
      gDrag = { id: e.pointerId, k };
      dragging = k;
      ctx.overlay.hideChip();
      globe.canvas.style.cursor = "grabbing";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      if (!gDrag) { if (pinAt(x, y)) globe.canvas.style.cursor = "grab"; return; }
      if (e.pointerId !== gDrag.id) return;
      e.stopPropagation();
      const p = globe.pick(x, y);
      if (p) setPin(gDrag.k, [p.lon, p.lat], true);
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (!gDrag || e.pointerId !== gDrag.id) return;
      e.stopPropagation();
      const k = gDrag.k;
      gDrag = null; dragging = null;
      globe.canvas.style.cursor = "grab";
      setPin(k, params[k], false);
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
    aimGlobe(0);
  }

  setTimeout(() => { booted = true; animateLines(); }, 0);

  const hitLine = (lon, lat) => {
    const q = stage.project(lon, lat);
    if (!q || !q.visible) return null;
    let best = null;
    const test = (pts, kind, color) => {
      for (const p of pts) {
        const s = stage.project(p[0], p[1]);
        if (!s || !s.visible) continue;
        const d = Math.hypot(s.x - q.x, s.y - q.y);
        if (d < 10 && (!best || d < best.d)) best = { d, kind, at: p, color };
      }
    };
    if (params.gc) test(P.gc, "gc", BRASS);
    if (params.rhumb) test(P.rh, "rhumb", VIOLET);
    return best;
  };

  return {
    update(p, keys) {
      const moved = keys.some((k) => k === "A" || k === "B");
      const heroChanged = keys.includes("hero");
      params = { ...p };
      if (moved || keys.includes("waypoints")) compute();
      if (heroChanged || keys.length > 3) {
        computeLayout();
        buildThumbs();
        if (map) setHero(keys.length > 3 ? 0 : 700);
      } else if (moved && !dragging && map) setHero(320);
      if (moved && !dragging && booted) { animateLines(); if (keys.length <= 2) aimGlobe(650); }
      else if (keys.includes("waypoints") && booted) { drawn = 1; animateLegs(); }
      else redraw();
      readouts();
      ctx.overlay.update();
    },
    hover(lon, lat) {
      const h = hitLine(lon, lat);
      if (hoverHit !== h && map) map.invalidate();
      hoverHit = h;
      if (!h) return [`to A ${Math.round(inverse(params.A[0], params.A[1], lon, lat, SPHERE).s12 / 1000).toLocaleString("en-US")} km`];
      if (h.kind === "gc") return [`Great circle: bearing ${bearingOnGreatCircle(h.at, params.B).toFixed(1).padStart(5, "0")}°`, "The bearing changes along the way."];
      return [`Rhumb line: bearing ${P.m.rhumbBearing.toFixed(1).padStart(5, "0")}°`, "The bearing stays the same."];
    },
    probe(lon, lat) {
      if (!map && !globe) return null;
      const dA = inverse(lon, lat, params.A[0], params.A[1], SPHERE).s12, dB = inverse(lon, lat, params.B[0], params.B[1], SPHERE).s12;
      ctx.controls.set(dA <= dB ? "A" : "B", [+lon.toFixed(4), +lat.toFixed(4)]);
      return null;
    },
    unprobe() {},
    resize() { placeAll(0); if (globe) aimGlobe(0); },
    unmount() {
      if (drawTween) drawTween.cancel();
      if (legTween) legTween.cancel();
      if (offDrag) offDrag();
      if (offDbl) offDbl();
      if (map) { map.setDragFilter(null); map.canvas.style.cursor = "grab"; map.removePrefix(PREFIX); map.setInsets({ top: 0, bottom: 0 }); }
      if (globe) globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
      strip.remove();
    },
  };
}
