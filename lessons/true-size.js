import { factors } from "@/core/projections.js";
import { geo, moveFeature, drawCaption, FONT_UI, FONT_MONO } from "@/core/map2d.js";
import { lonLatToXYZ, xyzToLonLat, slerp, clamp } from "@/core/math.js";

export const AFRICA = ["Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cameroon", "Central African Rep.", "Chad", "Congo", "Côte d'Ivoire", "Dem. Rep. Congo", "Djibouti", "Egypt", "Eq. Guinea", "Eritrea", "eSwatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Morocco", "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "S. Sudan", "Senegal", "Sierra Leone", "Somalia", "Somaliland", "South Africa", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "W. Sahara", "Zambia", "Zimbabwe"];

export const COUNTRIES = [
  { value: "Greenland", label: "Greenland" },
  { value: "Russia", label: "Russia" },
  { value: "Canada", label: "Canada" },
  { value: "United States of America", label: "United States" },
  { value: "Antarctica", label: "Antarctica" },
  { value: "China", label: "China" },
  { value: "Brazil", label: "Brazil" },
  { value: "Australia", label: "Australia" },
  { value: "India", label: "India" },
  { value: "Dem. Rep. Congo", label: "DR Congo" },
  { value: "Mexico", label: "Mexico" },
  { value: "Indonesia", label: "Indonesia" },
  { value: "Norway", label: "Norway" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Japan", label: "Japan" },
  { value: "Iceland", label: "Iceland" },
];

export const meta = {
  id: "true-size",
  title: "Drag a country across the map",
  track: 3,
  order: 3,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "mercator",
  labels: false,
  paragraph: "On a Mercator map Greenland looks as large as Africa. It is not. Drag a country to the equator and watch it shrink. The shape stays true on the sphere. Only the map changes its size. True area is shown for each shape.",
  deeper: [
    "Greenland is 2.17 M km²; Africa is 30.4 M km².",
    "On Mercator the area scale at 72 N is 10.5.",
    "Equal Earth keeps every ratio true.",
    "Fourteen Greenlands fit in Africa.",
  ],
  keywords: ["true size", "Greenland", "Africa", "Mercator", "area"],
  controls: [
    { key: "projection", type: "segment", label: "Projection", options: [{ value: "mercator", label: "Mercator" }, { value: "equalEarth", label: "Equal Earth" }, { value: "robinson", label: "Robinson" }], default: "mercator" },
    { key: "country", type: "select", label: "Country", options: COUNTRIES, default: "Greenland" },
    { key: "ghost", type: "toggle", label: "Ghost at home", default: true, shortcut: "g" },
    { key: "showArea", type: "toggle", label: "Show areas", default: true, shortcut: "a" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", label: "The country you drag" }, { color: "#b85217", dash: true, label: "Its home position" }, { color: "#1d63a8", label: "Africa, for scale" }] },
  ],
  readouts: [
    { key: "trueArea", label: "True area", digits: 2, unit: "M km²", hero: true },
    { key: "vsAfrica", label: "Map area ÷ Africa", digits: 3 },
    { key: "lat", label: "Centroid latitude", digits: 1, unit: "°" },
    { key: "scale", label: "Area scale there", digits: 2 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["countries-110m.json"],
};

const PREFIX = meta.id + ":";
const INSET_TOP = 60;

export function africaShape(countries) {
  const parts = countries.features.filter((f) => AFRICA.includes(f.properties.name));
  return { type: "Feature", properties: { name: "Africa" }, geometry: { type: "MultiPolygon", coordinates: parts.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)) } };
}

export function trueAreaMkm2(feature) {
  return geo.areaKm2(feature) / 1e6;
}

export function placed(feature, at) {
  const home = geo.centroid(feature);
  if (!at || (Math.abs(at[0] - home[0]) < 1e-9 && Math.abs(at[1] - home[1]) < 1e-9)) return feature;
  return moveFeature(feature, home, at);
}

export function mapAreaRatio(projection, feature, at, africa) {
  return geo.pathArea(projection, placed(feature, at)) / geo.pathArea(projection, africa);
}

const parseAt = (s) => {
  if (!s) return null;
  const p = String(s).split(",").map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? [clamp(p[0], -180, 180), clamp(p[1], -85, 85)] : null;
};

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  const countries = ctx.data.get("countries-110m.json") || (await ctx.data.load("countries-110m.json"));
  const africa = africaShape(countries);
  const africaArea = trueAreaMkm2(africa);
  let params = { ...ctx.params };
  let feature = null;
  let home = [0, 0];
  let at = null;
  let shape = null;
  let shapePath = null;
  let glide = null;
  let dragging = false;
  let grabOffset = null;
  let pop = 1;
  let popTween = null;

  const pick = (name) => countries.features.find((f) => f.properties.name === name) || countries.features.find((f) => f.properties.name === "Greenland");
  const label = (name) => (COUNTRIES.find((c) => c.value === name) || { label: name }).label;

  const setCountry = (name, keepAt) => {
    feature = pick(name);
    home = geo.centroid(feature);
    at = keepAt || null;
    shape = placed(feature, at);
    shapePath = null;
  };

  const current = () => at || home;

  const moveTo = (p) => {
    at = [p[0], clamp(p[1], -84, 84)];
    shape = placed(feature, at);
    shapePath = null;
    map.invalidate();
  };

  const readouts = () => {
    const c = current();
    const f = factors(map.projection, c[0], c[1]);
    ctx.readout.setMany({
      trueArea: trueAreaMkm2(feature),
      vsAfrica: geo.pathArea(map.projection, shape) / geo.pathArea(map.projection, africa),
      lat: c[1],
      scale: f ? f.areaScale : NaN,
    });
  };

  const writeUrl = () => ctx.url.set("at", at ? `${at[0].toFixed(2)},${at[1].toFixed(2)}` : null);

  const runPop = () => {
    if (popTween) popTween.cancel();
    if (ctx.reducedMotion) { pop = 1; return; }
    pop = 0;
    popTween = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.out, onUpdate: (v) => { pop = v; map.invalidate(); } });
  };

  const glideHome = () => {
    if (!at) return;
    if (glide) glide.cancel();
    const a = lonLatToXYZ(at[0], at[1]), b = lonLatToXYZ(home[0], home[1]);
    if (ctx.reducedMotion) { at = null; shape = feature; shapePath = null; map.invalidate(); readouts(); writeUrl(); return; }
    glide = ctx.anim.tween({
      from: 0, to: 1, duration: 480, ease: ctx.anim.ease.standard,
      onUpdate: (u) => { moveTo(xyzToLonLat(slerp(a, b, u))); readouts(); },
      onDone: () => { glide = null; at = null; shape = feature; shapePath = null; map.invalidate(); readouts(); writeUrl(); },
    });
  };

  const tag = (g, x, y, lines, colour) => {
    g.font = `600 12px ${FONT_UI}`;
    const w0 = g.measureText(lines[0]).width;
    g.font = `500 11px ${FONT_MONO}`;
    const w = Math.max(w0, ...lines.slice(1).map((l) => g.measureText(l).width)) + 16;
    const h = 8 + lines.length * 15;
    const bx = clamp(x - w / 2, 8, map.width - w - 8), by = clamp(y - h / 2, 8, map.height - h - 8);
    g.fillStyle = "rgba(250,248,243,.84)";
    g.beginPath(); g.roundRect(bx, by, w, h, 6); g.fill();
    g.strokeStyle = colour; g.globalAlpha = 0.5; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1;
    g.textAlign = "center"; g.textBaseline = "middle";
    lines.forEach((l, i) => {
      g.font = i === 0 ? `600 12px ${FONT_UI}` : `500 11px ${FONT_MONO}`;
      g.fillStyle = i === 0 ? colour : palette.ui.ink2;
      g.fillText(l, bx + w / 2, by + 11 + i * 15);
    });
  };

  const drawLayer = (g, path, projection) => {
    g.lineJoin = "round";
    g.fillStyle = "rgba(250,248,243,.22)";
    g.fillRect(0, 0, map.width, map.height);
    g.beginPath(); path(africa);
    g.fillStyle = "rgba(29,99,168,.26)"; g.fill();
    g.strokeStyle = signal; g.lineWidth = 1.4; g.stroke();
    if (params.ghost && at) {
      g.beginPath(); path(feature);
      g.fillStyle = "rgba(184,82,23,.12)"; g.fill();
      g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3; g.stroke();
      g.setLineDash([6, 4]); g.strokeStyle = brass; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
    }
    shapePath = geo.path2D(projection, shape);
    const c = projection(current());
    g.save();
    if (pop < 1 && c) { const s = 0.6 + 0.4 * ctx.anim.ease.out(pop); g.translate(c[0], c[1]); g.scale(s, s); g.translate(-c[0], -c[1]); g.globalAlpha = pop; }
    g.fillStyle = dragging ? "rgba(184,82,23,.5)" : "rgba(184,82,23,.38)";
    g.fill(shapePath);
    g.strokeStyle = "rgba(250,248,243,.7)"; g.lineWidth = 3.4; g.stroke(shapePath);
    g.strokeStyle = brass; g.lineWidth = dragging ? 2.2 : 1.8; g.stroke(shapePath);
    g.restore();
  };

  const drawTags = (g) => {
    if (!params.showArea || map.morph) return;
    const projection = map.projection;
    const ac = geo.pathCentroid(projection, africa);
    const ab = geo.pathBounds(projection, africa);
    if (ac && isFinite(ac[0])) tag(g, ab[1][0] + 52, ac[1] + 40, ["Africa", `${africaArea.toFixed(1)} M km²`], signal);
    const b = geo.pathBounds(projection, shape);
    const below = b && b[1][1] + 66 < map.height - ctx.stage.insetBottom;
    const sc = b && isFinite(b[0][0]) ? [(b[0][0] + b[1][0]) / 2, below ? b[1][1] + 34 : b[0][1] - 34] : null;
    if (sc) {
      const r = geo.pathArea(projection, shape) / geo.pathArea(projection, africa);
      const t = trueAreaMkm2(feature) / africaArea;
      tag(g, sc[0], sc[1], [label(feature.properties.name), `${trueAreaMkm2(feature).toFixed(2)} M km²`, `map ${(r * 100).toFixed(0)}% · true ${(t * 100).toFixed(1)}% of Africa`], brass);
    }
  };

  const caption = () => {
    const name = label(feature.properties.name);
    const r = geo.pathArea(map.projection, shape) / geo.pathArea(map.projection, africa);
    const t = trueAreaMkm2(feature) / africaArea;
    const k = r / t;
    const line = Math.abs(k - 1) < 0.03 ? `${name} shows at its true size next to Africa.` : k > 1 ? `${name} shows ${k.toFixed(1)}× too large next to Africa.` : `${name} shows at ${k.toFixed(2)}× its true size next to Africa.`;
    return [`Drag ${name}. Double-click it to send it home.`, map.morph ? "The map changes its projection." : line];
  };

  const dragFilter = (x, y) => {
    if (glide || map.morph) return null;
    if (shapePath && map.hitPath(shapePath, x, y)) return "shape";
    const c = map.projection(current());
    if (c && Math.hypot(c[0] - x, c[1] - y) < 14) return "shape";
    return null;
  };

  map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom });
  setCountry(params.country, parseAt(ctx.url.get("at")));
  await map.setProjection(params.projection, { duration: map.projectionId === params.projection ? 0 : 700 });
  map.addFeatures(PREFIX + "borders", countries, { stroke: "rgba(255,255,255,.16)", width: 0.5, order: 41 });
  map.addLayer(PREFIX + "shapes", drawLayer, { order: 50 });
  map.addLayer(PREFIX + "tags", drawTags, { order: 60 });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 20, 16, caption(), { accent: brass }), { order: 90, clip: false });
  map.setDragFilter(dragFilter);
  runPop();
  readouts();

  const offCustom = map.on("customdrag", (e) => {
    if (e.phase === "start") {
      if (glide) { glide.cancel(); glide = null; }
      dragging = true;
      const ll = map.pick(e.x, e.y);
      const c = current();
      grabOffset = ll ? [c[0] - ll.lon, c[1] - ll.lat] : [0, 0];
      map.canvas.style.cursor = "grabbing";
      map.invalidate();
      return;
    }
    if (e.phase === "move") {
      const ll = map.pick(e.x, e.y);
      if (!ll) return;
      moveTo([ll.lon + grabOffset[0], ll.lat + grabOffset[1]]);
      readouts();
      return;
    }
    dragging = false;
    map.canvas.style.cursor = "grab";
    map.invalidate();
    if (e.phase === "end") writeUrl();
  });
  const offDbl = map.on("customdblclick", () => glideHome());
  const onHoverCursor = (ev) => {
    if (dragging) return;
    const r = map.canvas.getBoundingClientRect();
    map.canvas.style.cursor = dragFilter(ev.clientX - r.left, ev.clientY - r.top) ? "move" : "grab";
  };
  map.canvas.addEventListener("pointermove", onHoverCursor, { signal: ctx.signal });

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("country") && feature && params.country !== feature.properties.name) {
        if (glide) { glide.cancel(); glide = null; }
        setCountry(params.country, null);
        writeUrl();
        runPop();
      }
      if (keys.includes("projection") && params.projection !== map.projectionId) {
        map.setProjection(params.projection, { duration: 900 }).then(() => { readouts(); map.invalidate(); });
      }
      map.invalidate();
      if (keys.length) readouts();
    },
    hover(lon, lat) {
      const f = factors(map.projection, lon, lat);
      return f ? [`area scale ${f.areaScale.toFixed(2)}`] : [];
    },
    probe(lon, lat) {
      const q = map.project(lon, lat);
      if (q.visible && dragFilter(q.x, q.y)) return null;
      const hit = countries.features.find((f) => COUNTRIES.some((c) => c.value === f.properties.name) && geo.contains(f, [lon, lat]));
      if (hit && hit.properties.name !== feature.properties.name) ctx.controls.set("country", hit.properties.name);
      return null;
    },
    unprobe() {},
    resize() { map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom }); shapePath = null; map.invalidate(); },
    unmount() {
      offCustom(); offDbl();
      if (glide) glide.cancel();
      if (popTween) popTween.cancel();
      map.setDragFilter(null);
      map.canvas.style.cursor = "grab";
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0 });
    },
  };
}
