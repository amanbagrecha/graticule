import { registry, get as getProjection, factors } from "@/core/projections.js";
import { geo, dom, factorField, fieldImage, drawLegend, drawCaption, FONT_MONO, FONT_UI } from "@/core/map2d.js";
import { divergingRGB, sequentialRGB } from "@/core/palette.js";
import { africaShape } from "@/lessons/true-size.js";
import { clamp } from "@/core/math.js";

export const FIVE = ["robinson", "winkel3", "naturalEarth1", "equalEarth", "mollweide"];

export const meta = {
  id: "compromise-maps",
  title: "Sharing the error",
  track: 3,
  order: 8,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "winkel3",
  labels: false,
  paragraph: "A world map cannot keep area and angles both. Compromise maps share the error so nothing looks very wrong. Robinson and Winkel tripel do this. Equal Earth keeps area but looks similar. Compare them with the same field and the same numbers.",
  deeper: [
    "Winkel tripel standard parallel = acos(2/π) = 50.46°.",
    "Robinson width:height = 1.97.",
    "Equal Earth and Mollweide keep area. The other three do not.",
    "National Geographic used Robinson 1988–1998 and Winkel tripel after.",
  ],
  keywords: ["compromise", "Robinson", "Winkel tripel", "Natural Earth", "Equal Earth", "Mollweide"],
  controls: [
    { key: "hero", type: "select", label: "Hero map", options: FIVE.map((id) => ({ value: id, label: registry.get(id).name, description: registry.get(id).property === "equal-area" ? "keeps area" : "shares the error" })), default: "winkel3" },
    { key: "field", type: "segment", label: "Field", options: [{ value: "none", label: "None" }, { value: "omega", label: "ω" }, { value: "area", label: "Area" }], default: "area" },
    { type: "legend", label: "Key", items: [{ color: "#2b65ad", label: "Area shrinks" }, { color: "#b85217", label: "Area grows" }, { color: "#1d63a8", label: "ω: brighter means more angle error" }] },
  ],
  readouts: [
    { key: "maxOmega", label: "Max ω on land", digits: 1, unit: "°", hero: true },
    { key: "area60", label: "Area scale at 60 N", digits: 3 },
    { key: "ga", label: "Greenland ÷ Africa", digits: 3 },
    { key: "wh", label: "Width : height", digits: 3 },
  ],
  transport: null,
  compare: { key: "hero", value: "equalEarth" },
  view: null,
  data: ["countries-110m.json"],
};

const PREFIX = meta.id + ":";

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function landPoints(countries, step = 2) {
  const polys = [];
  for (const f of countries.features) {
    const list = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of list) {
      let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      polys.push({ poly, box: [x0, y0, x1, y1] });
    }
  }
  const pts = [];
  for (let lat = -89 + step / 2; lat < 89; lat += step) for (let lon = -180 + step / 2; lon < 180; lon += step) {
    for (const { poly, box } of polys) {
      if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
      if (pointInRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(lon, lat, h))) { pts.push([lon, lat]); break; }
    }
  }
  return pts;
}

export function metrics(projection, { land, greenland, africa }) {
  let maxOmega = 0;
  for (const [lon, lat] of land) {
    const f = factors(projection, lon, lat);
    if (f && isFinite(f.omega) && f.omega > maxOmega) maxOmega = f.omega;
  }
  const b = geo.pathBounds(projection, { type: "Sphere" });
  const f60 = factors(projection, 0, 60);
  return {
    maxOmega,
    area60: f60 ? f60.areaScale : NaN,
    ga: geo.pathArea(projection, greenland) / geo.pathArea(projection, africa),
    wh: (b[1][0] - b[0][0]) / (b[1][1] - b[0][1]),
  };
}

const colourFor = (field, v) => (field === "omega" ? sequentialRGB(clamp(v / 90, 0, 1)) : divergingRGB(clamp(Math.log2(v), -1, 1)));

export const COMPACT_W = 640;
const MAP_PAD = 28;
const SHORT = { robinson: "Robinson", winkel3: "Winkel", naturalEarth1: "Nat. Earth", equalEarth: "Eq. Earth", mollweide: "Mollweide" };
const live = new Map();

export function layout(W, H, { inset = 0, side = "A", compare = false } = {}) {
  const right = side === "B", align = right ? "right" : "left";
  if (W >= COMPACT_W) {
    const pad = 20;
    return {
      compact: false,
      strip: { x: pad, top: 14, gap: 8 },
      cap: { x: right ? W - pad : pad, y: 130, align, maxWidth: compare ? W / 2 - pad - 34 : 420, lines: compare ? 1 : 2 },
      legend: { x: right ? W - pad - 184 : pad, y: H - inset - 72, w: 160 },
      insets: { top: 194, bottom: inset, left: 0, right: 0 },
    };
  }
  const pad = 12, chipH = 54, lines = H - inset >= 340 ? 2 : 1;
  const capY = 10 + chipH + 8, legend = { x: pad, y: H - 64, w: 140 };
  const top = capY + 34 + 17 * lines + 8, bottom = Math.min(H - inset, legend.y) - 6;
  return {
    compact: true,
    strip: { x: pad, top: 10, gap: 4, h: chipH },
    cap: { x: right ? W - pad : pad, y: capY, align, maxWidth: compare ? W / 2 - pad - 34 : 420, lines },
    legend,
    insets: { top: top - MAP_PAD, bottom: H - bottom - MAP_PAD, left: pad - MAP_PAD, right: pad - MAP_PAD },
  };
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  const accent = ctx.side === "B" ? palette.ui.violet : signal;
  const countries = ctx.data.get("countries-110m.json") || (await ctx.data.load("countries-110m.json"));
  const greenland = countries.features.find((f) => f.properties.name === "Greenland");
  const africa = africaShape(countries);
  const shapes = { land: landPoints(countries, 2), greenland, africa };
  let params = { ...ctx.params };
  let field = null, fieldKey = "", image = null, imageKey = "";
  let fade = 1, fadeTween = null;
  let L = null, insetKey = "";
  const cache = new Map();

  const metricsFor = (id) => {
    if (!cache.has(id)) cache.set(id, metrics(getProjection(id, { width: 800, height: 400 }), shapes));
    return cache.get(id);
  };

  const strip = ctx.side === "A" ? ctx.stage.element("div", "compromise-strip") : null;
  const cards = new Map();
  let row = null;
  if (strip) {
    strip.style.pointerEvents = "none";
    row = dom("div", { style: { position: "absolute", left: "20px", right: "20px", top: "14px", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "8px", pointerEvents: "auto" } });
    for (const id of FIVE) {
      const m = metricsFor(id);
      const canvas = dom("canvas", { style: { width: "100%", height: "64px", display: "block" } });
      const name = dom("div", { style: { font: "600 12px/15px var(--font-ui)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, registry.get(id).name);
      const ga = dom("span", { style: { color: Math.abs(m.ga - 0.0729) < 0.002 ? "var(--ok)" : "var(--ink-3)" } }, `G/A ${m.ga.toFixed(3)}`);
      const vals = dom("div", { style: { font: `500 10.5px/13px ${FONT_MONO}`, color: "var(--ink-3)", display: "flex", justifyContent: "space-between", gap: "6px", whiteSpace: "nowrap", overflow: "hidden" } }, dom("span", {}, `ω ${m.maxOmega.toFixed(0)}°`), ga);
      const card = dom("button", { type: "button", style: { display: "flex", flexDirection: "column", gap: "4px", padding: "8px 8px 7px", borderRadius: "10px", cursor: "pointer", textAlign: "left", background: "rgba(250,248,243,.86)", border: "1px solid var(--line)", color: "var(--ink-2)", transition: "border-color 240ms, background 240ms", minWidth: "0" }, onclick: () => ctx.controls.set("hero", id) }, canvas, name, vals);
      cards.set(id, { card, canvas, name, vals, ga, m });
      row.append(card);
    }
    strip.append(row);
    for (const t of ["pointerdown", "pointerup", "pointermove", "dblclick", "wheel"]) row.addEventListener(t, (e) => e.stopPropagation(), { signal: ctx.signal });
  }

  const drawThumbs = () => {
    for (const [id, { canvas }] of cards) {
      const r = canvas.getBoundingClientRect();
      const dpr = ctx.stage.dpr;
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const p = getProjection(id, { width: r.width, height: r.height, padding: 3 });
      const sphere = geo.path2D(p, { type: "Sphere" });
      g.fillStyle = "#d5e4eb"; g.fill(sphere);
      g.save(); g.clip(sphere);
      g.fillStyle = "rgba(221,211,187,.85)"; g.fill(geo.path2D(p, countries));
      g.fillStyle = signal; g.globalAlpha = 0.85; g.fill(geo.path2D(p, africa));
      g.fillStyle = brass; g.globalAlpha = 1; g.fill(geo.path2D(p, greenland));
      g.restore();
      g.strokeStyle = "rgba(60,52,40,.45)"; g.lineWidth = 1; g.stroke(sphere);
    }
  };

  const fitText = (el, options, box = el) => {
    for (const t of options) { el.textContent = t; if (box.scrollWidth <= box.clientWidth) return; }
  };

  const styleStrip = () => {
    if (!row) return;
    const k = L.compact, s = L.strip;
    Object.assign(row.style, { left: s.x + "px", right: s.x + "px", top: s.top + "px", gap: s.gap + "px" });
    for (const [id, c] of cards) {
      Object.assign(c.card.style, { padding: k ? "5px 4px" : "8px 8px 7px", gap: k ? "2px" : "4px", borderRadius: k ? "8px" : "10px", height: k ? s.h + "px" : "", justifyContent: k ? "center" : "" });
      c.canvas.style.display = k ? "none" : "block";
      c.name.style.font = k ? "600 11.5px/14px var(--font-ui)" : "600 12px/15px var(--font-ui)";
      Object.assign(c.vals.style, { flexDirection: k ? "column" : "row", gap: k ? "0" : "6px", font: `500 ${k ? "10px/12px" : "10.5px/13px"} ${FONT_MONO}` });
      const full = registry.get(id).name, ga = c.m.ga.toFixed(3);
      fitText(c.name, k ? [full, SHORT[id]] : [full]);
      fitText(c.ga, k ? [`G/A ${ga}`, ga] : [`G/A ${ga}`], c.vals);
    }
    if (!k) drawThumbs();
  };

  const paintCards = () => {
    for (const [id, { card }] of cards) {
      const on = id === params.hero;
      card.style.borderColor = on ? brass : "var(--line)";
      card.style.background = on ? "rgba(184,82,23,.1)" : "rgba(250,248,243,.86)";
    }
  };

  const relayout = () => {
    L = layout(map.width, map.height, { inset: ctx.stage.insetBottom, side: ctx.side, compare: ctx.side === "B" || live.has("B") });
    const key = JSON.stringify(L.insets);
    if (key !== insetKey) { insetKey = key; map.setInsets(L.insets); }
    map.invalidate();
  };

  const readouts = () => ctx.readout.setMany(metricsFor(params.hero));

  const runFade = () => {
    if (fadeTween) fadeTween.cancel();
    if (ctx.reducedMotion) { fade = 1; return; }
    fade = 0;
    fadeTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => { fade = v; map.invalidate(); } });
  };

  const fieldLayer = (g) => {
    if (params.field === "none") return;
    if (map.morph) { field = null; return; }
    const key = map.stateKey();
    if (!field || fieldKey !== key) {
      const had = !!field;
      field = factorField(map.projection, { width: map.width, height: map.height, step: 5, inside: (x, y) => map.insideOutline(x, y) });
      fieldKey = key;
      imageKey = "";
      if (!had) runFade();
    }
    if (imageKey !== params.field + fieldKey) {
      image = fieldImage(field[params.field], field.gw, field.gh, (v) => colourFor(params.field, v));
      imageKey = params.field + fieldKey;
    }
    g.globalAlpha = 0.78 * fade;
    g.imageSmoothingEnabled = true;
    g.drawImage(image, 0, 0, field.gw * field.step, field.gh * field.step);
    g.globalAlpha = 1;
  };

  const shapesLayer = (g, path) => {
    g.lineJoin = "round";
    g.beginPath(); path(africa); g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3; g.stroke(); g.strokeStyle = signal; g.lineWidth = 1.4; g.stroke();
    g.beginPath(); path(greenland); g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3; g.stroke(); g.strokeStyle = brass; g.lineWidth = 1.6; g.stroke();
  };

  const legendLayer = (g) => {
    if (params.field === "none") return;
    const omega = params.field === "omega";
    const { x, y, w } = L.legend;
    drawLegend(g, { x, y, w, colourAt: omega ? (t) => sequentialRGB(t) : (t) => divergingRGB(2 * t - 1), ticks: omega ? [{ t: 0, label: "0°" }, { t: 0.5, label: "45°" }, { t: 1, label: "90°" }] : [{ t: 0, label: "0.5" }, { t: 0.5, label: "1" }, { t: 1, label: "2" }], title: omega ? "ω, angle error" : "Area scale" });
  };

  const lineCount = (g, text, limit) => {
    g.font = `400 12px ${FONT_UI}`;
    let n = 1, cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && g.measureText(next).width > limit) { n++; cur = word; } else cur = next;
    }
    return n;
  };

  const caption = (g) => {
    const e = registry.get(params.hero);
    const ga = metricsFor(params.hero).ga.toFixed(3);
    const keeps = e.property === "equal-area", head = keeps ? "Keeps area." : "Shares the error.";
    const bodies = [keeps ? `${head} Greenland ÷ Africa =\u00a0${ga}, the true ratio.` : `${head} Greenland ÷ Africa =\u00a0${ga}; the true ratio is\u00a00.073.`, `${head} Greenland ÷ Africa =\u00a0${ga}.`, `${head} G/A\u00a0${ga}.`];
    const c = L.cap, room = (c.align === "right" ? c.x : map.width - c.x) - 36, limit = Math.max(120, Math.min(c.maxWidth, room));
    return [e.name, bodies.find((b) => lineCount(g, b, limit) <= c.lines) || head];
  };

  relayout();
  await map.setProjection(params.hero, { duration: map.projectionId === params.hero || (ctx.side === "B" && L.compact) ? 0 : 700 });
  map.addLayer(PREFIX + "field", fieldLayer, { order: 30 });
  map.addLayer(PREFIX + "shapes", shapesLayer, { order: 50 });
  map.addLayer(PREFIX + "legend", legendLayer, { order: 90, clip: false });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, L.cap.x, L.cap.y, caption(g), { accent, align: L.cap.align, maxWidth: L.cap.maxWidth }), { order: 91, clip: false });
  if (row) requestAnimationFrame(styleStrip);
  paintCards();
  readouts();
  live.set(ctx.side, relayout);
  if (ctx.side === "B" && live.has("A")) live.get("A")();

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("hero") && params.hero !== map.projectionId) map.setProjection(params.hero, { duration: 900 }).then(() => map.invalidate());
      if (keys.includes("field")) { imageKey = ""; runFade(); }
      paintCards();
      readouts();
      relayout();
    },
    hover(lon, lat) {
      const f = factors(map.projection, lon, lat);
      return f ? [`ω = ${f.omega.toFixed(1)}°   area = ${f.areaScale.toFixed(3)}`] : [];
    },
    probe() { return null; },
    unprobe() {},
    resize() {
      relayout();
      styleStrip();
    },
    unmount() {
      if (fadeTween) fadeTween.cancel();
      if (live.get(ctx.side) === relayout) live.delete(ctx.side);
      if (ctx.side === "B" && live.has("A")) live.get("A")();
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
      if (strip) strip.remove();
    },
  };
}
