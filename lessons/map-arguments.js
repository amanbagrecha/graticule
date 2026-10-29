import { registry, get as getProjection, factors } from "@/core/projections.js";
import { geo, dom, factorField, fieldImage, drawLegend, drawCaption, FONT_MONO } from "@/core/map2d.js";
import { divergingRGB, sequentialRGB } from "@/core/palette.js";
import { africaShape } from "@/lessons/true-size.js";
import { landPoints } from "@/lessons/compromise-maps.js";
import { clamp } from "@/core/math.js";

export const PANELS = [
  { id: "mercator", label: "Mercator" },
  { id: "gallPeters", label: "Gall–Peters" },
  { id: "equalEarth", label: "Equal Earth" },
  { id: "airocean", label: "Dymaxion-style" },
];

export const PAIRS = {
  "greenland-africa": { label: "Greenland & Africa", a: "Greenland", b: "Africa" },
  "russia-brazil": { label: "Russia & Brazil", a: "Russia", b: "Brazil" },
  "alaska-mexico": { label: "Alaska & Mexico", a: "Alaska", b: "Mexico" },
};

export const meta = {
  id: "map-arguments",
  title: "Why people argue about maps",
  track: 3,
  order: 10,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "mercator",
  labels: false,
  paragraph: "Mercator makes the north look large. The Gall–Peters map keeps area but stretches shapes. Equal Earth keeps area and looks natural. The Dymaxion net has almost no distortion but is hard to read. None is wrong. Each answers a different question. Compare the numbers.",
  deeper: [
    "Gall–Peters frame is π/2 = 1.571 wide to high.",
    "Mercator is from 1569; Peters promoted his map in 1973.",
    "Gall–Peters standard parallels are 45° N and S.",
    "Equal Earth was published in 2018.",
  ],
  keywords: ["Mercator", "Gall–Peters", "Equal Earth", "Dymaxion", "debate"],
  controls: [
    { key: "highlight", type: "select", label: "Highlight", options: Object.entries(PAIRS).map(([value, p]) => ({ value, label: p.label })), default: "greenland-africa" },
    { key: "field", type: "segment", label: "Field", options: [{ value: "none", label: "None" }, { value: "area", label: "Area" }, { value: "omega", label: "ω" }], default: "none" },
    { key: "showRatios", type: "toggle", label: "Show ratios", default: true, shortcut: "o" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", label: "First shape of the pair" }, { color: "#1d63a8", label: "Second shape of the pair" }] },
  ],
  readouts: [
    ...PANELS.map((p) => ({ key: p.id, label: p.label, multi: [{ key: "ratio", label: "ratio", digits: 3 }, { key: "omega", label: "ω ≤", digits: 0, unit: "°" }] })),
    { key: "trueRatio", label: "True ratio", digits: 3, hero: true },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["countries-110m.json"],
};

const PREFIX = meta.id + ":";
const COMPACT_W = 640;
const PAD = 12;
const MAP_PAD = 28;
const STRIP_H = 34;

export function pairShapes(countries, key) {
  const pick = (name) => {
    if (name === "Africa") return africaShape(countries);
    if (name === "Alaska") {
      const us = countries.features.find((f) => f.properties.name === "United States of America");
      const parts = us.geometry.coordinates.filter((poly) => { const c = geo.centroid({ type: "Polygon", coordinates: poly }); return c[0] < -129 && c[1] > 50; });
      return { type: "Feature", properties: { name: "Alaska" }, geometry: { type: "MultiPolygon", coordinates: parts } };
    }
    return countries.features.find((f) => f.properties.name === name);
  };
  const p = PAIRS[key] || PAIRS["greenland-africa"];
  return { a: pick(p.a), b: pick(p.b), names: [p.a, p.b] };
}

export function pairRatio(projection, pair) {
  return geo.pathArea(projection, pair.a) / geo.pathArea(projection, pair.b);
}

export function pairOmega(projection, points) {
  let m = 0;
  for (const [lon, lat] of points) {
    let w = Infinity;
    for (const d of [0, 0.07, -0.07]) { const f = factors(projection, lon + d, lat + d); if (f && isFinite(f.omega)) w = Math.min(w, f.omega); }
    if (w < Infinity && w > m) m = w;
  }
  return m;
}

const colourFor = (field, v) => (field === "omega" ? sequentialRGB(clamp(v / 90, 0, 1)) : divergingRGB(clamp(Math.log2(v) / 2, -1, 1)));

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  const countries = ctx.data.get("countries-110m.json") || (await ctx.data.load("countries-110m.json"));
  let params = { ...ctx.params };
  let hero = PANELS[0].id;
  let pair = pairShapes(countries, params.highlight);
  let pairPts = null;
  let stats = {};
  let field = null, fieldKey = "", image = null, imageKey = "";

  const computeStats = () => {
    pairPts = landPoints({ type: "FeatureCollection", features: [pair.a, pair.b] }, 1.5);
    stats = {};
    for (const p of PANELS) {
      const proj = getProjection(p.id, { width: 800, height: 500 });
      stats[p.id] = { ratio: pairRatio(proj, pair), omega: pairOmega(proj, pairPts) };
    }
    stats.trueRatio = geo.area(pair.a) / geo.area(pair.b);
  };

  const panelW = () => clamp(Math.round(map.width * 0.27), 180, 320);
  const compact = () => map.width < COMPACT_W;
  const cardW = () => (compact() ? Math.floor((map.width - 2 * PAD - 16) / 3) : panelW());
  const thumbW = () => cardW() - (compact() ? 14 : 18);
  const layer = ctx.stage.element("div", "arguments-panels");
  layer.style.pointerEvents = "none";
  const col = dom("div", { style: { position: "absolute", top: "14px", right: "16px", display: "flex", flexDirection: "column", gap: "8px", pointerEvents: "auto" } });
  layer.append(col);
  for (const t of ["pointerdown", "pointerup", "pointermove", "dblclick", "wheel"]) col.addEventListener(t, (e) => e.stopPropagation(), { signal: ctx.signal });
  const cards = new Map();
  for (const p of PANELS) {
    const canvas = dom("canvas", { style: { width: "100%", display: "block", borderRadius: "6px" } });
    const nums = dom("div", { style: { font: `500 11px/14px ${FONT_MONO}`, color: "var(--ink-2)", display: "flex", justifyContent: "space-between", gap: "8px" } });
    const title = dom("div", { style: { font: "600 12px/15px var(--font-ui)", color: "var(--ink)" } }, p.label);
    const card = dom("button", { type: "button", style: { display: "flex", flexDirection: "column", gap: "5px", padding: "8px", borderRadius: "10px", background: "rgba(250,248,243,.88)", border: "1px solid var(--line)", cursor: "pointer", textAlign: "left", transition: "border-color 240ms, background 240ms, opacity 240ms" }, onclick: () => setHero(p.id) },
      title, canvas, nums);
    cards.set(p.id, { card, canvas, nums, title });
    col.append(card);
  }

  const sizeCards = () => {
    const c = compact(), w = cardW(), h = Math.round(thumbW() * 0.5);
    Object.assign(col.style, c
      ? { top: "auto", left: PAD + "px", right: PAD + "px", bottom: ctx.stage.insetBottom + PAD + "px", flexDirection: "row", justifyContent: "center" }
      : { top: "14px", left: "auto", right: "16px", bottom: "auto", flexDirection: "column", justifyContent: "flex-start" });
    for (const p of PANELS) {
      const k = cards.get(p.id);
      k.card.style.display = p.id === hero ? "none" : "flex";
      k.card.style.width = w + "px";
      Object.assign(k.card.style, c ? { padding: "6px", gap: "4px" } : { padding: "8px", gap: "5px" });
      k.title.style.font = c ? "600 11px/14px var(--font-ui)" : "600 12px/15px var(--font-ui)";
      Object.assign(k.nums.style, c ? { flexDirection: "column", gap: "0px" } : { flexDirection: "row", gap: "8px" });
      k.canvas.style.height = h + "px";
      const s = stats[p.id];
      k.nums.replaceChildren(dom("span", { style: { color: params.showRatios ? "var(--ink)" : "var(--ink-3)" } }, params.showRatios ? `ratio ${s.ratio.toFixed(3)}` : ""), dom("span", {}, `ω ≤ ${s.omega.toFixed(0)}°`));
    }
  };

  const drawPanel = (id) => {
    const { canvas } = cards.get(id);
    const w = thumbW(), h = Math.round(w * 0.5);
    const dpr = ctx.stage.dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = getProjection(id, { width: w, height: h, padding: 4 });
    const sphere = geo.path2D(p, { type: "Sphere" });
    g.fillStyle = "#d5e4eb"; g.fill(sphere);
    g.save(); g.clip(sphere);
    if (params.field !== "none") {
      const f = factorField(p, { width: w, height: h, step: 3 });
      const img = fieldImage(f[params.field], f.gw, f.gh, (v) => colourFor(params.field, v));
      g.globalAlpha = 0.75; g.imageSmoothingEnabled = true; g.drawImage(img, 0, 0, f.gw * f.step, f.gh * f.step); g.globalAlpha = 1;
    }
    g.fillStyle = params.field === "none" ? "rgba(221,211,187,.8)" : "rgba(50,46,40,.12)";
    g.fill(geo.path2D(p, countries));
    for (const [f, c] of [[pair.a, brass], [pair.b, signal]]) {
      const pa = geo.path2D(p, f);
      g.fillStyle = c; g.globalAlpha = params.field === "none" ? 1 : 0.55; g.fill(pa); g.globalAlpha = 1;
      g.strokeStyle = "rgba(250,248,243,.8)"; g.lineWidth = 2; g.stroke(pa);
      g.strokeStyle = c; g.lineWidth = 1; g.stroke(pa);
    }
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.45)"; g.lineWidth = 1; g.stroke(sphere);
  };

  const paintPanels = () => {
    sizeCards();
    for (const p of PANELS) if (p.id !== hero) drawPanel(p.id);
  };

  const readouts = () => {
    const out = { trueRatio: stats.trueRatio };
    for (const p of PANELS) out[p.id] = { ratio: stats[p.id].ratio, omega: stats[p.id].omega };
    ctx.readout.setMany(out);
    ctx.readout.highlight(hero);
  };

  const measure = document.createElement("canvas").getContext("2d");
  const captionOpts = () => ({ accent: brass, maxWidth: compact() ? map.width - 2 * PAD - 28 : Math.max(240, map.width - panelW() - 90) });
  const captionH = () => {
    measure.canvas.width = Math.max(1, map.width); measure.canvas.height = 1;
    return drawCaption(measure, PAD, PAD, caption(), captionOpts()).h;
  };
  const stripTop = () => map.height - ctx.stage.insetBottom - PAD - col.offsetHeight - 8 - STRIP_H;

  const legendRoom = () => {
    if (params.field === "none") return 0;
    const base = map.height - ctx.stage.insetBottom;
    const p = getProjection(hero, {});
    p.fitExtent([[MAP_PAD, MAP_PAD + 76], [map.width - MAP_PAD - panelW() - 24, base - MAP_PAD]], { type: "Sphere" });
    const b = geo.pathBounds(p, { type: "Sphere" });
    return b[0][0] < 212 && b[1][1] > base - 74 ? 52 : 0;
  };

  const insets = () => {
    if (!compact()) return map.setInsets({ top: 76, bottom: ctx.stage.insetBottom + legendRoom(), left: 0, right: panelW() + 24 });
    const room = params.field === "none" ? 0 : STRIP_H + 8;
    map.setInsets({ top: PAD + captionH() + 8 - MAP_PAD, bottom: ctx.stage.insetBottom + PAD + col.offsetHeight + 8 + room - MAP_PAD, left: PAD - MAP_PAD, right: PAD - MAP_PAD });
  };

  const setHero = (id) => {
    if (id === hero) return;
    hero = id;
    paintPanels();
    insets();
    readouts();
    map.setProjection(id, { duration: 900 }).then(() => map.invalidate());
  };

  const fieldLayer = (g) => {
    if (params.field === "none" || map.morph) { if (map.morph) field = null; return; }
    const key = map.stateKey();
    if (!field || fieldKey !== key) { field = factorField(map.projection, { width: map.width, height: map.height, step: 5, inside: (x, y) => map.insideOutline(x, y) }); fieldKey = key; imageKey = ""; }
    if (imageKey !== params.field + fieldKey) { image = fieldImage(field[params.field], field.gw, field.gh, (v) => colourFor(params.field, v)); imageKey = params.field + fieldKey; }
    g.globalAlpha = 0.78; g.imageSmoothingEnabled = true;
    g.drawImage(image, 0, 0, field.gw * field.step, field.gh * field.step);
    g.globalAlpha = 1;
  };

  const shapesLayer = (g, path) => {
    g.lineJoin = "round";
    for (const [f, c, fill] of [[pair.b, signal, "rgba(29,99,168,.35)"], [pair.a, brass, "rgba(184,82,23,.42)"]]) {
      g.beginPath(); path(f);
      g.fillStyle = fill; g.fill();
      g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3; g.stroke();
      g.strokeStyle = c; g.lineWidth = 1.6; g.stroke();
    }
  };

  const legendStrip = (g, x, y, w, { colourAt, ticks, title }) => {
    g.save();
    g.fillStyle = "rgba(250,248,243,.72)";
    g.beginPath(); g.roundRect(x, y, w, STRIP_H, 8); g.fill();
    g.strokeStyle = "rgba(227,222,211,.9)"; g.lineWidth = 1; g.stroke();
    g.font = `500 10px ${FONT_MONO}`; g.textBaseline = "middle"; g.textAlign = "left";
    g.fillStyle = "#6b665e";
    const label = title.toUpperCase();
    g.fillText(label, x + 12, y + STRIP_H / 2);
    const rx = Math.round(x + 12 + g.measureText(label).width + 14), rw = Math.round(x + w - 16 - rx), ry = y + 7;
    for (let i = 0; i < rw; i++) { const c = colourAt(i / (rw - 1)); g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.fillRect(rx + i, ry, 1.5, 7); }
    g.strokeStyle = "rgba(60,52,40,.3)"; g.strokeRect(rx + 0.5, ry + 0.5, rw - 1, 6);
    g.textBaseline = "alphabetic";
    for (const tk of ticks) {
      const tx = rx + tk.t * rw;
      g.fillStyle = "rgba(60,52,40,.6)"; g.fillRect(Math.round(tx), ry + 7, 1, 3);
      g.fillStyle = "#3f3c37"; g.textAlign = tk.t <= 0.02 ? "left" : tk.t >= 0.98 ? "right" : "center";
      g.fillText(tk.label, tx, y + STRIP_H - 6);
    }
    g.restore();
  };

  const legendLayer = (g) => {
    if (params.field === "none") return;
    const omega = params.field === "omega";
    const spec = { colourAt: omega ? (t) => sequentialRGB(t) : (t) => divergingRGB(2 * t - 1), ticks: omega ? [{ t: 0, label: "0°" }, { t: 0.5, label: "45°" }, { t: 1, label: "90°" }] : [{ t: 0, label: "0.25" }, { t: 0.5, label: "1" }, { t: 1, label: "4" }], title: omega ? "ω, angle error" : "Area scale" };
    if (compact()) return legendStrip(g, PAD, stripTop(), map.width - 2 * PAD, spec);
    drawLegend(g, { x: 20, y: map.height - ctx.stage.insetBottom - 72, w: 160, ...spec });
  };

  const caption = () => {
    const s = stats[hero];
    const [a, b] = pair.names;
    const name = registry.get(hero).name === "Icosahedral net" ? "Dymaxion-style net" : (PANELS.find((p) => p.id === hero) || {}).label;
    return [name, params.showRatios ? `${a} ÷ ${b} on this map: ${s.ratio.toFixed(3)}. True: ${stats.trueRatio.toFixed(3)}. Max ω on the pair: ${s.omega.toFixed(0)}°.` : `Max ω on the pair: ${s.omega.toFixed(0)}°.`];
  };

  computeStats();
  sizeCards();
  insets();
  await map.setProjection(hero, { duration: map.projectionId === hero ? 0 : 700 });
  map.addLayer(PREFIX + "field", fieldLayer, { order: 30 });
  map.addLayer(PREFIX + "shapes", shapesLayer, { order: 50 });
  map.addLayer(PREFIX + "legend", legendLayer, { order: 90, clip: false });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, compact() ? PAD : 20, compact() ? PAD : 16, caption(), captionOpts()), { order: 91, clip: false });
  requestAnimationFrame(() => { paintPanels(); readouts(); });

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("highlight")) { pair = pairShapes(countries, params.highlight); computeStats(); }
      if (keys.includes("field")) imageKey = "";
      paintPanels();
      insets();
      readouts();
      map.invalidate();
    },
    hover(lon, lat) {
      const f = factors(map.projection, lon, lat);
      return f ? [`ω = ${f.omega.toFixed(1)}°   area = ${f.areaScale.toFixed(3)}`] : [];
    },
    probe() { return null; },
    unprobe() {},
    resize() { paintPanels(); insets(); map.invalidate(); },
    unmount() {
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
      layer.remove();
    },
  };
}
