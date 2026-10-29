import { make } from "@/core/projections.js";
import { geo, drawCaption, FONT_MONO } from "@/core/map2d.js";
import { clamp, mod } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const ERR = "#b42335";
const WARN = "#b7791f";
const INK = "#1a1917";

export const FEATURES = [
  { value: "Fiji", label: "Fiji" },
  { value: "Russia", label: "Russia" },
  { value: "Antarctica", label: "Antarctica" },
  { value: "ring", label: "A drawn ring" },
];

export const PROJECTIONS = [
  { value: "equirectangular", label: "Plate carrée" },
  { value: "mercator", label: "Mercator" },
  { value: "equalEarth", label: "Equal Earth" },
];

export const DRAWN_RING = [[150, 60], [-150, 60], [-150, 40], [150, 40], [150, 60]];

export const meta = {
  id: "catastrophes",
  title: "The seam, the poles, the winding",
  track: 4,
  order: 4,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  labels: false,
  paragraph: "A flat map is cut along one meridian and has two lines where the poles were. Polygons that cross the seam or hold a pole go wrong on a naive map. Drawing on the sphere fixes this. The ring's direction decides which side is inside. Reverse it and the ring holds the whole world.",
  deeper: [
    "A ring reversed on the sphere has area 4π minus the original.",
    "Fiji and Russia cross 180°.",
    "The Antarctica polygon in many files has a fake edge at the south pole.",
    "d3 wants clockwise outer rings; GeoJSON wants counter-clockwise.",
  ],
  keywords: ["antimeridian", "seam", "pole", "winding", "densify"],
  controls: [
    { key: "lon0", type: "range", label: "Central meridian", min: -180, max: 180, step: 1, default: 0, unit: "°", fillFrom: 0, ticks: [-180, -90, 0, 90, 180] },
    { key: "mode", type: "segment", label: "Mode", options: [{ value: "vertex", label: "Vertex by vertex" }, { value: "sphere", label: "On the sphere" }], default: "vertex" },
    { key: "feature", type: "select", label: "Feature", options: FEATURES, default: "Fiji" },
    { key: "reverse", type: "toggle", label: "Reverse the ring", default: false, shortcut: "w" },
    { key: "densify", type: "toggle", label: "Densify (1°)", default: false, shortcut: "e" },
    { key: "projection", type: "segment", label: "Map", options: PROJECTIONS, default: "equirectangular" },
    { type: "legend", label: "Key", items: [{ color: BRASS, label: "The polygon as drawn" }, { color: ERR, line: true, label: "Seam: the cut meridian" }, { color: WARN, line: true, label: "Poles: lines on a flat map" }] },
  ],
  readouts: [
    { key: "area", label: "Area as drawn", digits: 3, unit: "% of sphere", hero: true },
    { key: "vertices", label: "Vertices", digits: 0 },
    { key: "crossings", label: "Seam crossings", digits: 0 },
    { key: "poles", label: "Poles inside", digits: 0 },
  ],
  transport: null,
  compare: { key: "mode", value: "sphere" },
  view: null,
  data: ["countries-110m.json"],
};

const PREFIX = meta.id + ":";
const wrap = (l) => mod(l + 180, 360) - 180;

export function rings(geometry) {
  const g = geometry.geometry || geometry;
  return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
}

export function makeRing() {
  const f = { type: "Feature", properties: { name: "ring" }, geometry: { type: "Polygon", coordinates: [DRAWN_RING.map((p) => p.slice())] } };
  if (geo.area(f) > 2 * Math.PI) f.geometry.coordinates[0].reverse();
  return f;
}

export function largestPolygon(f) {
  let best = null, ba = -1;
  for (const poly of rings(f)) {
    const a = geo.area({ type: "Polygon", coordinates: poly });
    if (a > ba) { ba = a; best = poly; }
  }
  return { ...f, geometry: { type: "MultiPolygon", coordinates: [best] } };
}

export function reverseFeature(f) {
  const one = largestPolygon(f);
  return { ...one, geometry: { type: "MultiPolygon", coordinates: [[rings(one)[0][0].slice().reverse()]] } };
}

export function densifyFeature(f, step = 1) {
  const dens = (ring) => {
    const out = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      const dl = wrap(b[0] - a[0]), dp = b[1] - a[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dl), Math.abs(dp)) / step));
      for (let k = 1; k <= n; k++) out.push(k === n ? b : [wrap(a[0] + (dl * k) / n), a[1] + (dp * k) / n]);
    }
    return out;
  };
  return { ...f, geometry: { type: "MultiPolygon", coordinates: rings(f).map((poly) => poly.map(dens)) } };
}

export function featureFor(countries, name, { reverse = false, densify = false } = {}) {
  let f = name === "ring" ? makeRing() : countries.features.find((x) => x.properties.name === name);
  f = { ...f, geometry: { type: "MultiPolygon", coordinates: rings(f) } };
  if (densify) f = densifyFeature(f);
  if (reverse) f = reverseFeature(f);
  return f;
}

export function countVertices(f) {
  let n = 0;
  for (const poly of rings(f)) for (const ring of poly) n += ring.length - 1;
  return n;
}

export function seamCrossings(f, lon0) {
  let n = 0;
  for (const poly of rings(f)) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
    const a = wrap(ring[i - 1][0] - lon0), b = wrap(ring[i][0] - lon0);
    if (Math.abs(b - a) > 180) n++;
  }
  return n;
}

export function polesInside(f) {
  return (geo.contains(f, [0, 90]) ? 1 : 0) + (geo.contains(f, [0, -90]) ? 1 : 0);
}

export function naiveProjector(projectionId, lon0, projection) {
  const flat = make(projectionId, { lon0: 0 }).scale(projection.scale()).translate(projection.translate());
  return (p) => {
    const q = flat([wrap(p[0] - lon0), clamp(p[1], -89.9, 89.9)]);
    return q;
  };
}

export function naiveRings(f, toXY) {
  return rings(f).map((poly) => poly.map((ring) => ring.map(toXY)));
}

export function shoelace(ring) {
  let s = 0;
  for (let i = 1; i < ring.length; i++) s += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return s / 2;
}

export function naiveAreaFraction(f, toXY, outlineArea) {
  let a = 0;
  for (const poly of naiveRings(f, toXY)) {
    let p = Math.abs(shoelace(poly[0]));
    for (let k = 1; k < poly.length; k++) p -= Math.abs(shoelace(poly[k]));
    a += Math.max(0, p);
  }
  return a / outlineArea;
}

export function sphereAreaFraction(f) {
  return geo.area(f) / (4 * Math.PI);
}

export function edgeBendPx(projection, a, b) {
  const gcMid = geo.interpolate(a, b)(0.5);
  const flatMid = [gcMid[0], (a[1] + b[1]) / 2];
  const p = projection(gcMid), q = projection(flatMid);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const map = stage.map;
  const globe = stage.globe;
  const countries = ctx.data.get("countries-110m.json") || (await ctx.data.load("countries-110m.json"));
  let params = { ...ctx.params };
  let F = null;
  let mix = params.mode === "sphere" ? 1 : 0;
  let mixTw = null;
  let naivePath = null;
  let booted = false;

  const build = () => { F = featureFor(countries, params.feature, { reverse: params.reverse, densify: params.densify }); };

  const projection = () => make(params.projection, { lon0: params.lon0 });

  const readouts = () => {
    let area;
    if (params.mode === "sphere") area = sphereAreaFraction(F) * 100;
    else if (map) area = naiveAreaFraction(F, naiveProjector(params.projection, params.lon0, map.projection), geo.pathArea(map.projection, { type: "Sphere" })) * 100;
    else area = naiveAreaFraction(F, (p) => [wrap(p[0] - params.lon0), p[1]], 360 * 180) * 100;
    ctx.readout.setMany({ area, vertices: countVertices(F), crossings: seamCrossings(F, params.lon0), poles: polesInside(F) });
  };

  const drawNaive = (g, P, alpha) => {
    const toXY = naiveProjector(params.projection, params.lon0, P);
    const p2 = new Path2D();
    for (const poly of naiveRings(F, toXY)) for (const ring of poly) {
      ring.forEach((q, i) => (i ? p2.lineTo(q[0], q[1]) : p2.moveTo(q[0], q[1])));
      p2.closePath();
    }
    naivePath = p2;
    g.globalAlpha = alpha;
    g.fillStyle = "rgba(184,82,23,.42)"; g.fill(p2, "evenodd");
    g.lineJoin = "round"; g.strokeStyle = BRASS; g.lineWidth = 1.6; g.stroke(p2);
    g.fillStyle = BRASS;
    if (countVertices(F) < 400) for (const poly of naiveRings(F, toXY)) for (const ring of poly) for (const q of ring) { g.beginPath(); g.arc(q[0], q[1], 1.8, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  };

  const drawSphere = (g, path, alpha) => {
    g.globalAlpha = alpha;
    g.beginPath(); path(F);
    g.fillStyle = "rgba(184,82,23,.42)"; g.fill();
    g.lineJoin = "round"; g.strokeStyle = BRASS; g.lineWidth = 1.6; g.stroke();
    g.globalAlpha = 1;
  };

  const drawGuides = (g, path, P) => {
    const s = wrap(params.lon0 + 180);
    g.beginPath(); path({ type: "MultiLineString", coordinates: [[[s - 1e-6, -90], [s - 1e-6, 0], [s - 1e-6, 90]], [[s + 1e-6, -90], [s + 1e-6, 0], [s + 1e-6, 90]]] });
    g.strokeStyle = ERR; g.lineWidth = 2.5; g.stroke();
    if (params.projection !== "mercator") {
      g.beginPath(); path({ type: "MultiLineString", coordinates: [90, -90].map((la) => Array.from({ length: 73 }, (_, k) => [params.lon0 - 180 + k * 5 * (1 - 1e-9), la * (1 - 1e-9)])) });
      g.strokeStyle = WARN; g.lineWidth = 2.5; g.stroke();
    }
    g.font = `500 11px ${FONT_MONO}`; g.textBaseline = "middle"; g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.9)";
    const lab = (text, x, y, color, align) => { g.textAlign = align; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y); };
    const e = P([s - 1e-6, 0]), w = P([s + 1e-6, 0]);
    const sl = Math.abs(s) > 179.5 ? "seam 180°" : `seam ${Math.abs(s).toFixed(0)}°${s < 0 ? "W" : "E"}`;
    if (e) lab(sl, e[0] - 8, e[1] - 14, ERR, "right");
    if (w) lab(sl, w[0] + 8, w[1] - 14, ERR, "left");
    if (params.projection !== "mercator") {
      const n = P([params.lon0, 89.999]), so = P([params.lon0, -89.999]);
      if (n) lab("north pole (a line)", n[0], n[1] - 12, WARN, "center");
      if (so) lab("south pole (a line)", so[0], so[1] + 13, WARN, "center");
    }
  };

  const caption = () => {
    const name = FEATURES.find((x) => x.value === params.feature).label;
    const c = seamCrossings(F, params.lon0), pi = polesInside(F);
    const lines = [params.mode === "vertex" ? `${name}, vertex by vertex` : `${name}, on the sphere`];
    if (params.mode === "vertex") {
      if (c) lines.push(`${c} ${c === 1 ? "edge jumps" : "edges jump"} across the seam. The fill smears across the map.`);
      if (pi) lines.push(`The ring holds ${pi === 2 ? "both poles" : "a pole"}. A flat ring cannot close around it.`);
      if (!c && !pi) lines.push("No edge crosses the seam here. Drag the map to move the seam.");
    } else {
      lines.push(c ? "Edges are great circles. The seam cuts the ring cleanly." : "Edges are great circles. Nothing crosses the seam.");
      if (params.reverse) lines.push("One ring reversed: the inside is now the rest of the world.");
      else if (pi) lines.push("The pole is inside, so the fill reaches the pole line.");
    }
    if (params.densify) lines.push("Densified: a point every 1°, so edges follow the lon/lat lines.");
    return lines;
  };

  const runMix = () => {
    if (mixTw) mixTw.cancel();
    const to = params.mode === "sphere" ? 1 : 0;
    if (ctx.reducedMotion || !booted) { mix = to; refresh(); return; }
    mixTw = ctx.anim.tween({ from: mix, to, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => { mix = v; refresh(); }, onDone: () => { mixTw = null; } });
  };

  const setMapProjection = (duration = 0) => {
    if (!map) return Promise.resolve();
    return map.setProjection(projection(), { duration, tag: params.projection + "|" + params.lon0 });
  };

  const draw3D = () => {
    if (!globe) return;
    const s = wrap(params.lon0 + 180);
    const seg = [];
    for (let la = -89; la < 89; la += 2) seg.push([[s, la], [s, la + 2]]);
    globe.addLines(PREFIX + "seam", seg, { color: ERR, width: 2.5, depth: true });
    globe.addPoints(PREFIX + "poles", [[0, 90], [0, -90]], { color: WARN, size: 12 });
    globe.addCanvasOverlay(PREFIX + "poly", (g, P) => {
      const W = 4096, Hh = 2048;
      if (mix < 1) {
        g.globalAlpha = 1 - mix;
        for (const off of [-W, 0, W]) {
          g.beginPath();
          for (const poly of rings(F)) for (const ring of poly) {
            ring.forEach((p, i) => {
              const x = ((wrap(p[0] - params.lon0) + params.lon0 + 180) / 360) * W + off, y = ((90 - p[1]) / 180) * Hh;
              if (i) g.lineTo(x, y); else g.moveTo(x, y);
            });
            g.closePath();
          }
          g.fillStyle = "rgba(184,82,23,.55)"; g.fill("evenodd");
          g.strokeStyle = BRASS; g.lineWidth = 5; g.stroke();
        }
      }
      if (mix > 0) {
        g.globalAlpha = mix;
        const p2 = geo.path2D(P, F);
        g.fillStyle = "rgba(184,82,23,.55)"; g.fill(p2);
        g.strokeStyle = BRASS; g.lineWidth = 5; g.stroke(p2);
      }
      g.globalAlpha = 1;
    });
  };

  const refresh = () => {
    if (map) map.invalidate();
    if (globe) { draw3D(); globe.refreshOverlay(); }
  };

  build();
  if (map) {
    map.addLayer(PREFIX + "poly", (g, path, P) => {
      if (mix < 1) drawNaive(g, P, 1 - mix);
      if (mix > 0) drawSphere(g, path, mix);
    }, { order: 55, clip: false });
    map.addLayer(PREFIX + "guides", (g, path, P) => drawGuides(g, path, P), { order: 56, clip: false });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 18, 14, caption(), { accent: params.mode === "vertex" ? ERR : BRASS }), { order: 90, clip: false });
    map.setDragFilter(() => "seam");
    await setMapProjection(0);
  }
  const offs = [];
  if (map) offs.push(map.on("customdrag", (e) => {
    if (e.phase === "start") { map.canvas.style.cursor = "ew-resize"; return; }
    if (e.phase === "move") {
      const k = map.projection.scale() * Math.PI / 180;
      ctx.controls.set("lon0", Math.round(wrap(params.lon0 - e.dx / k)), { live: true });
      return;
    }
    map.canvas.style.cursor = "grab";
    ctx.controls.set("lon0", params.lon0);
  }));
  if (globe) {
    globe.camera.lookAt(wrap(params.lon0 + 180) - 10, -10, null, { duration: 0 });
  }
  draw3D();
  readouts();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (keys.some((k) => k === "feature" || k === "reverse" || k === "densify")) build();
      if (keys.includes("mode") && prev.mode !== params.mode) runMix();
      else if (keys.length > 3) { mix = params.mode === "sphere" ? 1 : 0; }
      if (keys.some((k) => k === "lon0" || k === "projection")) {
        setMapProjection(keys.includes("projection") && keys.length === 1 && booted ? 600 : 0).then(() => { readouts(); refresh(); });
      }
      refresh();
      readouts();
    },
    hover(lon, lat) {
      const out = [];
      const q = stage.project(lon, lat);
      if (map && q && q.visible && naivePath && params.mode === "vertex") {
        const inNaive = map.ctx.isPointInPath(naivePath, q.x * stage.dpr, q.y * stage.dpr, "evenodd");
        const inTrue = geo.contains(F, [lon, lat]);
        if (inNaive && !inTrue) out.push(seamCrossings(F, params.lon0) ? "Wrong fill: the ring crosses the seam." : "Wrong fill: the ring holds a pole.");
        if (!inNaive && inTrue) out.push(polesInside(F) ? "Missing fill: the ring holds a pole." : "Missing fill: the ring crosses the seam.");
      }
      const s = wrap(params.lon0 + 180);
      if (Math.abs(wrap(lon - s)) < 3 && seamCrossings(F, params.lon0)) out.push("Crosses the seam.");
      if (Math.abs(lat) > 80 && polesInside(F)) out.push("Holds a pole.");
      return out;
    },
    probe() { return null; },
    unprobe() {},
    resize() { setMapProjection(0); refresh(); },
    unmount() {
      if (mixTw) mixTw.cancel();
      for (const off of offs) off();
      if (map) { map.setDragFilter(null); map.canvas.style.cursor = "grab"; map.removePrefix(PREFIX); }
      if (globe) globe.removePrefix(PREFIX);
    },
  };
}
