import { registry, factors } from "@/core/projections.js";
import { projectionOptions, factorField, fieldImage, contourSegments, contourLabelSpots, drawLegend, drawCaption, FONT_MONO } from "@/core/map2d.js";
import { divergingRGB, sequentialRGB } from "@/core/palette.js";
import { clamp } from "@/core/math.js";

const FIELDS = [
  { value: "h", label: "h" },
  { value: "k", label: "k" },
  { value: "area", label: "Area" },
  { value: "omega", label: "ω" },
];
const RANGES = [
  { value: "0.5-2", label: "0.5–2" },
  { value: "0.25-4", label: "0.25–4" },
  { value: "auto", label: "Auto" },
];
const OMEGA_RANGES = [
  { value: "0.5-2", label: "0–40°" },
  { value: "0.25-4", label: "0–90°" },
  { value: "auto", label: "Auto" },
];

export const meta = {
  id: "scale-factor-field",
  title: "Scale is a number at every point",
  track: 3,
  order: 2,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "mercator",
  labels: false,
  paragraph: "Scale is not one number for a map. It is a field. At each point the map stretches by one amount along the meridian and another along the parallel. Pick what to show. The contours show where the map is true and where it is far off.",
  deeper: [
    "Mercator: h = k = 1/cos φ.",
    "Sinusoidal: k = 1 along every parallel; h = 1 only on the central meridian.",
    "Web Mercator at 85.05° has k = 11.59.",
    "Contours of ω are the \"distortion isolines\" used to pick a projection.",
  ],
  keywords: ["scale factor", "distortion", "contour", "field", "h", "k"],
  controls: [
    { key: "projection", type: "select", label: "Projection", options: projectionOptions(), default: "mercator" },
    { key: "field", type: "segment", label: "Field", options: FIELDS, default: "k" },
    { key: "contours", type: "toggle", label: "Contours", default: true, shortcut: "c" },
    { key: "range", type: "segment", label: "Colour range", options: RANGES, default: "auto" },
    { type: "legend", label: "Key", items: [{ color: "#2b65ad", label: "Map shrinks (below 1)" }, { color: "#b85217", label: "Map stretches (above 1)" }, { color: "#b85217", line: true, label: "Contour 1: true scale" }, { color: "#1d63a8", label: "ω: brighter means more angle error" }] },
  ],
  readouts: [
    { key: "h", label: "h (meridian)", digits: 3, hero: true },
    { key: "k", label: "k (parallel)", digits: 3 },
    { key: "area", label: "Area scale", digits: 3 },
    { key: "omega", label: "ω", digits: 2, unit: "°" },
    { key: "min", label: "Field min", digits: 3 },
    { key: "max", label: "Field max", digits: 3 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
export const HOME = [0, 60];
const SCALE_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 10];
const OMEGA_LEVELS = [5, 10, 20, 30, 45, 60, 90, 120];
const MIN_SPAN = 0.1;
const INSET_TOP = 60;

export function valuesAt(projection, lon, lat) {
  const f = factors(projection, lon, lat);
  if (!f || !isFinite(f.h) || !isFinite(f.k)) return null;
  return { h: f.h, k: f.k, area: f.areaScale, omega: f.omega };
}

export function colourDomain(field, range, fieldMin, fieldMax) {
  if (field === "omega") {
    if (range === "0.5-2") return { kind: "sequential", max: 40 };
    if (range === "0.25-4") return { kind: "sequential", max: 90 };
    return { kind: "sequential", max: Math.max(1, Math.ceil(fieldMax || 1)) };
  }
  if (range === "0.5-2") return { kind: "diverging", down: 1, up: 1 };
  if (range === "0.25-4") return { kind: "diverging", down: 2, up: 2 };
  const down = fieldMin > 0 && fieldMin < 1 ? -Math.log2(fieldMin) : 0;
  const up = fieldMax > 1 ? Math.log2(fieldMax) : 0;
  if (down < MIN_SPAN && up < MIN_SPAN) return { kind: "diverging", down: MIN_SPAN, up: MIN_SPAN, auto: true };
  return { kind: "diverging", down: Math.max(down, 1e-3), up: Math.max(up, 1e-3), auto: true };
}

export function robustRange(values, lo = 0.02, hi = 0.98) {
  const v = [];
  for (const x of values) if (Number.isFinite(x)) v.push(x);
  if (!v.length) return [NaN, NaN];
  v.sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
  return [at(lo), at(hi)];
}

export function colourOf(domain, v) {
  if (domain.kind === "sequential") return sequentialRGB(clamp(v / domain.max, 0, 1));
  const l = Math.log2(v);
  return divergingRGB(clamp(l >= 0 ? l / domain.up : l / domain.down, -1, 1));
}

const fmtLevel = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? String(+v.toFixed(2)) : String(+v.toFixed(2)));

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  let params = { ...ctx.params };
  let probed = null;
  let field = null;
  let fieldKey = "";
  let lastChange = 0;
  let fineTimer = 0;
  let images = { cur: null, prev: null, mix: 1 };
  let imageKey = "";
  let mixTween = null;
  let wipe = 1;
  let wipeTween = null;
  let contours = null;
  let contourKey = "";
  let wasMorph = false;

  const entry = () => registry.get(params.projection) || registry.get("mercator");
  const point = () => probed || { lon: HOME[0], lat: HOME[1] };
  const domain = () => {
    if (!field) return colourDomain(params.field, params.range, 1, 1);
    let r = field.range[params.field];
    if (params.range === "auto") {
      field.robust = field.robust || {};
      r = field.robust[params.field] = field.robust[params.field] || robustRange(field[params.field]);
    }
    return colourDomain(params.field, params.range, r[0], r[1]);
  };

  const startWipe = () => {
    if (wipeTween) wipeTween.cancel();
    if (ctx.reducedMotion) { wipe = 1; return; }
    wipe = 0;
    wipeTween = ctx.anim.tween({ from: 0, to: 1, duration: 700, ease: ctx.anim.ease.out, onUpdate: (v) => { wipe = v; map.invalidate(); } });
  };

  const crossfade = () => {
    if (mixTween) mixTween.cancel();
    if (ctx.reducedMotion || !images.prev) { images.mix = 1; images.prev = null; return; }
    images.mix = 0;
    mixTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => { images.mix = v; map.invalidate(); }, onDone: () => { images.prev = null; } });
  };

  const rebuildImage = (fade) => {
    if (!field) return;
    const d = domain();
    const vals = field[params.field];
    const canvas = fieldImage(vals, field.gw, field.gh, (v) => colourOf(d, v));
    if (fade && images.cur) { images.prev = images.cur; images.cur = canvas; crossfade(); }
    else { images.cur = canvas; images.prev = null; images.mix = 1; }
    imageKey = params.field + "|" + params.range + "|" + fieldKey;
  };

  const rebuildContours = () => {
    contours = null;
    if (!field || !params.contours) return;
    const vals = field[params.field];
    const [lo, hi] = field.range[params.field];
    const levels = (params.field === "omega" ? OMEGA_LEVELS : SCALE_LEVELS).filter((l) => l > lo + 1e-4 && l < hi - 1e-4);
    const taken = [];
    const inside = (x, y) => [[0, 0], [-24, 0], [24, 0], [0, -14], [0, 14]].every(([dx, dy]) => map.insideOutline(x + dx, y + dy));
    contours = levels.map((level) => {
      const segs = contourSegments(vals, field.gw, field.gh, field.step, level);
      const path = new Path2D();
      for (const [p, q] of segs) { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); }
      const isOne = params.field !== "omega" && level === 1;
      return { level, path, isOne, spots: contourLabelSpots(segs, { taken, minGap: 170, max: isOne ? 4 : 2, inside }) };
    });
    contourKey = params.field + "|" + params.contours + "|" + fieldKey;
  };

  const recompute = (step) => {
    const t0 = performance.now();
    field = factorField(map.projection, { width: map.width, height: map.height, step, inside: (x, y) => map.insideOutline(x, y) });
    field.ms = performance.now() - t0;
    fieldKey = map.stateKey() + "|" + step;
  };

  const ensureField = () => {
    const key = map.stateKey();
    const now = performance.now();
    const busy = map.interacting || map.inertia || now - lastChange < 140;
    const base = field && fieldKey.slice(0, fieldKey.lastIndexOf("|"));
    if (base !== key) {
      lastChange = now;
      recompute(busy || map.inertia ? 10 : 4);
      rebuildImage(false);
      rebuildContours();
      clearTimeout(fineTimer);
      fineTimer = setTimeout(() => map.invalidate(), 170);
      return;
    }
    if (!busy && field.step !== 4) {
      recompute(4);
      rebuildImage(false);
      rebuildContours();
    }
  };

  const readouts = () => {
    const p = point();
    const v = valuesAt(map.projection, p.lon, p.lat);
    const r = field ? field.range[params.field] : null;
    const out = v ? { ...v } : {};
    if (r && isFinite(r[0])) { out.min = r[0]; out.max = r[1]; }
    ctx.readout.setMany(out);
  };

  const drawFieldLayer = (g) => {
    if (map.morph) {
      wasMorph = true;
      field = null;
      fieldKey = "";
      return;
    }
    if (wasMorph) { wasMorph = false; field = null; fieldKey = ""; }
    const had = !!field;
    ensureField();
    if (!had) { images.prev = null; startWipe(); readouts(); }
    if (imageKey !== params.field + "|" + params.range + "|" + fieldKey) rebuildImage(false);
    if (params.contours && contourKey !== params.field + "|" + params.contours + "|" + fieldKey) rebuildContours();
    const draw = (c, a) => {
      if (!c || a <= 0) return;
      g.globalAlpha = a * 0.8;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(c, 0, 0, field.gw * field.step, field.gh * field.step);
    };
    if (images.prev) draw(images.prev, 1 - images.mix);
    draw(images.cur, images.prev ? images.mix : 1);
    g.globalAlpha = 1;
  };

  const drawContourLayer = (g) => {
    if (map.morph || !contours || !params.contours) return;
    g.save();
    if (wipe < 1) {
      const cx = map.width / 2, cy = map.height / 2;
      g.beginPath();
      g.arc(cx, cy, Math.hypot(cx, cy) * wipe, 0, Math.PI * 2);
      g.clip();
    }
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const c of contours) {
      g.strokeStyle = "rgba(250,248,243,.55)";
      g.lineWidth = c.isOne ? 4 : 3;
      g.stroke(c.path);
      g.strokeStyle = c.isOne ? brass : "rgba(26,25,23,.78)";
      g.lineWidth = c.isOne ? 2 : 1;
      g.stroke(c.path);
    }
    g.font = `600 10.5px ${FONT_MONO}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const c of contours) {
      const text = params.field === "omega" ? c.level + "°" : fmtLevel(c.level);
      for (const [x, y, ang] of c.spots) {
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        const w = g.measureText(text).width + 8;
        g.fillStyle = "rgba(250,248,243,.86)";
        g.beginPath();
        g.roundRect(-w / 2, -8, w, 16, 4);
        g.fill();
        g.fillStyle = c.isOne ? brass : palette.ui.ink;
        g.fillText(text, 0, 0.5);
        g.restore();
      }
    }
    g.restore();
  };

  const drawPoint = (g, path, projection) => {
    if (map.morph) return;
    const p = point();
    const q = projection([p.lon, p.lat]);
    if (!q || !isFinite(q[0])) return;
    if (!probed) {
      g.strokeStyle = "rgba(250,248,243,.8)";
      g.lineWidth = 4;
      g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = signal;
      g.lineWidth = 2;
      g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2); g.stroke();
      g.font = `600 11px ${FONT_MONO}`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      const w = g.measureText("readout point").width + 10;
      g.fillStyle = "rgba(250,248,243,.86)";
      g.beginPath(); g.roundRect(q[0] + 11, q[1] - 9, w, 18, 4); g.fill();
      g.fillStyle = signal;
      g.fillText("readout point", q[0] + 16, q[1] + 0.5);
    }
  };

  const narrow = () => map.width < 640;
  const insets = () => ({ top: INSET_TOP, bottom: ctx.stage.insetBottom + (narrow() ? 50 : 0) });

  const drawLegendLayer = (g) => {
    const d = domain();
    const name = { h: "h, scale along the meridian", k: "k, scale along the parallel", area: "Area scale", omega: "ω, max angle error" }[params.field];
    let colourAt, ticks;
    if (d.kind === "sequential") {
      colourAt = (t) => sequentialRGB(t);
      ticks = [{ t: 0, label: "0°" }, { t: 0.5, label: (d.max / 2).toFixed(0) + "°" }, { t: 1, label: d.max.toFixed(0) + "°" }];
    } else {
      const lo = Math.pow(2, -d.down), hi = Math.pow(2, d.up);
      const tl = d.auto ? (d.down < 0.01 ? 0 : d.up < 0.01 ? 1 : d.down / (d.down + d.up)) : 0.5;
      colourAt = (t) => divergingRGB(t < tl ? (t - tl) / tl : tl >= 1 ? 0 : (t - tl) / (1 - tl));
      ticks = [{ t: 0, label: fmtLevel(+lo.toPrecision(3)) }, { t: tl, label: "1" }, { t: 1, label: fmtLevel(+hi.toPrecision(3)) }];
      if (tl <= 0.02) ticks.shift();
      else if (tl >= 0.98) ticks.pop();
    }
    const low = narrow();
    drawLegend(g, { x: low ? 20 : map.width - 20 - 184, y: low ? map.height - ctx.stage.insetBottom - 70 : 16, w: 160, colourAt, ticks, title: name });
  };

  const caption = () => {
    const e = entry();
    const r = field ? field.range[params.field] : null;
    const f = params.field === "omega" ? (v) => v.toFixed(1) + "°" : (v) => v.toFixed(3);
    return [e.name, r && isFinite(r[0]) ? `${{ h: "h", k: "k", area: "area", omega: "ω" }[params.field]} from ${f(r[0])} to ${f(r[1])} on this map` : "The map changes its projection."];
  };

  const syncRangeLabels = () => ctx.controls.setOptions("range", params.field === "omega" ? OMEGA_RANGES : RANGES);

  map.setInsets(insets());
  map.rasterOn(false);
  await map.setProjection(params.projection, { duration: map.projectionId === params.projection ? 0 : 700 });
  map.addLayer(PREFIX + "field", drawFieldLayer, { order: 30 });
  map.addLayer(PREFIX + "contours", drawContourLayer, { order: 50 });
  map.addLayer(PREFIX + "point", drawPoint, { order: 55 });
  map.addLayer(PREFIX + "legend", drawLegendLayer, { order: 90, clip: false });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 20, 16, caption(), { accent: signal }), { order: 91, clip: false });
  syncRangeLabels();

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("projection") && params.projection !== map.projectionId) {
        if (field) { images.prev = null; }
        map.setProjection(params.projection, { duration: 900 }).then(() => { map.invalidate(); });
      }
      if (keys.includes("field")) syncRangeLabels();
      if (field && keys.some((k) => k === "field" || k === "range")) { rebuildImage(true); }
      if (field && keys.some((k) => k === "field" || k === "contours")) { rebuildContours(); startWipe(); }
      map.invalidate();
      if (keys.length) readouts();
    },
    hover(lon, lat) {
      const v = valuesAt(map.projection, lon, lat);
      if (!v) return [];
      return [`h = ${v.h.toFixed(3)}   k = ${v.k.toFixed(3)}`, `area = ${v.area.toFixed(3)}   ω = ${v.omega.toFixed(2)}°`];
    },
    probe(lon, lat) {
      const v = valuesAt(map.projection, lon, lat);
      if (!v) return null;
      probed = { lon, lat };
      map.invalidate();
      return v;
    },
    unprobe() {
      probed = null;
      map.invalidate();
      readouts();
    },
    resize() { map.setInsets(insets()); map.invalidate(); },
    unmount() {
      clearTimeout(fineTimer);
      if (mixTween) mixTween.cancel();
      if (wipeTween) wipeTween.cancel();
      map.removePrefix(PREFIX);
      map.rasterOn(true);
      map.setInsets({ top: 0, bottom: 0 });
    },
  };
}
