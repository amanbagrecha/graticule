import { morphs, lonLatToXYZ } from "@/core/globe.js";
import { get as getProjection, registry, interpolate, factors, pathFor, sphereArea, mergeTopology, topologyFeatures } from "@/core/projections.js";
import { loadJSON } from "@/core/data.js";

export const MAPS = ["mollweide", "hammer", "sinusoidal", "robinson", "winkel3", "equalEarth", "naturalEarth1"];
const OPTIONS = MAPS.map((id) => ({ value: id, label: registry.get(id).name, description: registry.get(id).property === "equal-area" ? "keeps area" : "shares the error" }));
const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const ARABIA = new Set(["Saudi Arabia", "Yemen", "Qatar", "Kuwait", "Iraq", "Jordan", "Israel", "Palestine", "Lebanon", "Syria", "Cyprus", "N. Cyprus", "United Arab Emirates", "Oman", "Iran"]);
export const PARALLELS = [-60, -30, 0, 30, 60];

export const meta = {
  id: "no-light",
  title: "World maps from formulas",
  track: 2,
  order: 7,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "mollweide",
  labels: false,
  paragraph: "A cylinder or a cone cannot show the whole world well. So some world maps come only from a formula. Each formula bends the parallels and meridians in its own way. One formula even fits the world in a square.",
  deeper: [
    "Mollweide: the central hemisphere is a circle.",
    "Equal Earth (2018) is equal-area with a 2.05 width-to-height ratio.",
    "Winkel tripel is the average of two maps.",
    "Robinson is a table of numbers, not a formula.",
  ],
  keywords: ["Mollweide", "Robinson", "pseudocylindrical", "morph"],
  controls: [
    { key: "from", type: "select", label: "From", options: OPTIONS, default: "hammer" },
    { key: "to", type: "select", label: "To", options: OPTIONS, default: "robinson" },
  ],
  readouts: [
    { key: "ratio", label: "Width ÷ height", digits: 2, hero: true },
    { key: "africa", label: "Africa size", digits: 0, unit: "% of true" },
  ],
  transport: { label: ["From", "To"], key: "m" },
  compare: null,
  view: { lon: 0, lat: 0, dist: 2.9 },
  data: ["land-110m.json", "countries-110m.json"],
};

const PREFIX = meta.id + ":";
const PAD = 28;
const ENTER_MS = 1400;
const PLAY_MS = 1400;
const SWAP_MS = 900;
const UNIT_BOX = [[0, 0], [2000, 1000]];

export const mapName = (id) => registry.get(id).name;

export function endLabels(from, to) {
  return [mapName(from), mapName(to)];
}

export function equalArea(id) {
  return registry.get(id).property === "equal-area";
}

export function aspectRatio(projection) {
  const b = pathFor(projection).bounds({ type: "Sphere" });
  return (b[1][0] - b[0][0]) / (b[1][1] - b[0][1]);
}

export function africaOf(topology) {
  const ids = new Set();
  for (const f of topologyFeatures(topology)) {
    if (ARABIA.has(f.properties.name)) continue;
    const c = pathFor(null).centroid(f), b = pathFor(null).bounds(f);
    if (c[0] > -20 && c[0] < 52 && c[1] > -36 && c[1] < 37.5 && b[0][0] > -30 && b[1][0] < 70) ids.add(f.properties.name);
  }
  const merged = mergeTopology(topology, "countries", (g) => ids.has(g.properties && g.properties.name));
  merged.properties.name = "Africa";
  return merged;
}

export function relativeArea(projection, feature) {
  const path = pathFor(projection);
  return (path.area(feature) / path.area({ type: "Sphere" })) / (sphereArea(feature) / (4 * Math.PI));
}

export function areaHere(projection, lon, lat) {
  const f = factors(projection, lon, lat);
  if (!f) return null;
  const k = projection.scale();
  return f.areaScale * 4 * Math.PI * k * k / pathFor(projection).area({ type: "Sphere" });
}

export function projectionAt(from, to, t, box) {
  const a = getProjection(from), b = getProjection(to);
  a.fitExtent(box, { type: "Sphere" }); b.fitExtent(box, { type: "Sphere" });
  if (t <= 0) return a;
  if (t >= 1) return b;
  return interpolate(a, b, t);
}

export function glideTarget(key, t) {
  if (key === "to") return t < 1 ? 1 : null;
  if (key === "from") return t > 0 ? 0 : null;
  return null;
}

export function blendedSheet(from, to, getT) {
  const fa = morphs.toProjection(getProjection(from), { width: 2.8 });
  const fb = morphs.toProjection(getProjection(to), { width: 2.8 });
  const cache = new Map();
  const a = [0, 0, 0], b = [0, 0, 0], sph = [0, 0, 0];
  const fn = (lon, lat, tg, out = [0, 0, 0]) => {
    let row = cache.get(lon);
    if (!row) cache.set(lon, (row = new Map()));
    let v = row.get(lat);
    if (!v) {
      fa(lon, lat, 1, a); fb(lon, lat, 1, b);
      v = [a[0], a[1], b[0], b[1]];
      row.set(lat, v);
    }
    if (!isFinite(v[0]) || !isFinite(v[2])) { out[0] = NaN; out[1] = NaN; out[2] = NaN; return out; }
    const s = getT();
    const x = v[0] + (v[2] - v[0]) * s, y = v[1] + (v[3] - v[1]) * s;
    lonLatToXYZ(lon, lat, sph);
    out[0] = sph[0] + (x - sph[0]) * tg; out[1] = sph[1] + (y - sph[1]) * tg; out[2] = sph[2] * (1 - tg);
    return out;
  };
  fn.phased = true;
  fn.seam = fa.seam;
  return fn;
}

const PARALLEL_LINES = ({ type: "MultiLineString", coordinates: PARALLELS.map((la) => { const out = []; for (let lo = -180; lo <= 180; lo += 2) out.push([lo, la]); return out; }) });

export async function mount(ctx) {
  const is3d = ctx.stage.mode !== "2d" && !!ctx.stage.globe;
  const map = is3d ? null : ctx.stage.map;
  const globe = is3d ? ctx.stage.globe : null;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  const topology = await loadJSON("countries-110m.json");
  const africa = africaOf(topology);
  let glide = null;
  let ownTick = null;

  const paint = () => {
    const P = projectionAt(params.from, params.to, t, UNIT_BOX);
    ctx.readout.setMany({ ratio: aspectRatio(P), africa: 100 * relativeArea(P, africa) });
  };
  const nameEnds = () => { if (ctx.transport) ctx.transport.setLabels(endLabels(params.from, params.to)); };
  const stopGlide = () => { if (glide) { glide.cancel(); glide = null; } ownTick = null; };
  const glideTo = (end) => {
    stopGlide();
    const tw = ctx.anim.tween({
      from: t, to: end, duration: PLAY_MS * Math.abs(end - t), ease: ctx.anim.ease.emph,
      onUpdate: (v) => { if (glide !== tw) return; ownTick = v; ctx.transport.set(v, { live: true }); },
      onDone: () => { if (glide !== tw) return; glide = null; ownTick = end; ctx.transport.set(end); ownTick = null; },
    });
    glide = tw;
  };
  const ownScrub = (v) => { if (glide && v !== ownTick) stopGlide(); };
  const labels = () => {
    ctx.overlay.label(PREFIX + "africa", { lon: 4, lat: 14 }, "Africa", { color: ORANGE, mono: false });
    ctx.overlay.label(PREFIX + "parallels", { lon: -150, lat: 30 }, "Parallels", { color: BLUE, mono: false, dy: -14 });
  };
  const hover = (P, lon, lat) => {
    const a = areaHere(P, lon, lat);
    return a == null ? [] : [`Area here: ${Math.round(100 * a)} % of true`];
  };

  const onChange = (keys, prev, rebuild, morphTo) => {
    if (prev.from === params.from && prev.to === params.to) return;
    nameEnds();
    const key = keys.length === 1 && (keys[0] === "from" || keys[0] === "to") ? keys[0] : null;
    const end = key && ctx.transport && !ctx.reducedMotion ? glideTarget(key, t) : null;
    if (end !== null) { rebuild(); glideTo(end); }
    else if (key && !ctx.reducedMotion) morphTo();
    else rebuild();
  };

  if (is3d) {
    let enter = { value: ctx.reducedMotion ? 1 : 0, tw: null };
    const morphT = () => (enter ? enter.value : 1);
    const build = () => globe.morph(blendedSheet(params.from, params.to, () => t), morphT());
    const frame3d = () => {
      if (ctx.side !== "A") return;
      const f = globe.camera.fit(null, { padding: PAD, insetBottom: ctx.stage.insetBottom, minDist: 2.9, apply: false });
      globe.camera.setDist(f.dist);
      globe.camera.setPan(f.pan[0], f.pan[1]);
    };
    globe.camera.lookAt(0, 0, null, { duration: 0 });
    build();
    globe.addLines(PREFIX + "parallels", segmentsOf(PARALLEL_LINES.coordinates), { color: BLUE, width: 1.25, depth: true });
    globe.addLines(PREFIX + "africa", outlineSegments(africa), { color: ORANGE, width: 1.75, depth: true });
    labels();
    frame3d();
    if (!ctx.reducedMotion) {
      enter.tw = ctx.anim.tween({ from: 0, to: 1, duration: ENTER_MS, ease: ctx.anim.ease.emph, onUpdate: (v) => { enter.value = v; globe.setMorphT(v); frame3d(); ctx.overlay.update(); }, onDone: () => { enter = null; globe.setMorphT(1); frame3d(); ctx.overlay.update(); } });
    } else enter = null;
    nameEnds();
    paint();
    if (ctx.transport) ctx.transport.onScrub((v) => {
      ownScrub(v);
      t = v;
      globe.setMorphT(morphT());
      frame3d();
      ctx.overlay.update();
      paint();
    });
    return {
      update(p, keys) {
        const prev = params;
        params = { ...p };
        t = params.m ?? t;
        const rebuild = () => { build(); frame3d(); ctx.overlay.update(); };
        onChange(keys, prev, rebuild, rebuild);
        paint();
      },
      hover: (lon, lat) => hover(projectionAt(params.from, params.to, t, UNIT_BOX), lon, lat),
      probe: () => ({}),
      unprobe() {},
      resize() { frame3d(); },
      unmount() {
        stopGlide();
        if (enter && enter.tw) enter.tw.cancel();
        ctx.overlay.clear(PREFIX);
        globe.removePrefix(PREFIX);
        globe.morph(null, 0);
      },
    };
  }

  let current = null;
  let scrubbed = false;
  let swap = null;
  let swaps = 0;
  const box = () => [[PAD, PAD], [ctx.stage.width - PAD, ctx.stage.height - ctx.stage.insetBottom - PAD]];
  const show = (P, tag) => { current = P; map.setProjection(P, { duration: 0, opts: { fit: false }, tag: [tag, ctx.stage.width, ctx.stage.height].join("|") }); };
  const apply = () => show(projectionAt(params.from, params.to, t, box()), t <= 0 ? params.from : t >= 1 ? params.to : `${params.from}>${params.to}@${t.toFixed(4)}`);
  const stopSwap = () => { if (swap) { swap.cancel(); swap = null; } };
  const startSwap = () => {
    const a = swap ? swap.end : current, b = projectionAt(params.from, params.to, t, box()), n = ++swaps;
    stopSwap();
    const tw = ctx.anim.tween({
      from: 0, to: 1, duration: SWAP_MS, ease: ctx.anim.ease.emph,
      onUpdate: (u) => { if (swap !== tw) return; show(interpolate(a, b, u), `swap${n}@${u.toFixed(4)}`); map.touch(200); ctx.overlay.update(); },
      onDone: () => { if (swap !== tw) return; swap = null; apply(); ctx.overlay.update(); },
    });
    tw.end = b;
    swap = tw;
  };

  map.addLayer(PREFIX + "parallels", (g, path) => {
    g.beginPath(); path(PARALLEL_LINES);
    g.lineWidth = 1.25; g.strokeStyle = BLUE; g.stroke();
  }, { order: 56 });
  map.addLayer(PREFIX + "africa", (g, path) => {
    g.beginPath(); path(africa);
    g.lineWidth = 1.75; g.strokeStyle = ORANGE; g.lineJoin = "round"; g.stroke();
  }, { order: 57 });

  apply();
  labels();
  nameEnds();
  paint();

  if (ctx.transport) ctx.transport.onScrub((v) => {
    ownScrub(v);
    stopSwap();
    const moved = v !== t;
    t = v;
    if (scrubbed && moved) map.touch(200);
    scrubbed = true;
    apply();
    ctx.overlay.update();
    paint();
  });

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      t = params.m ?? t;
      onChange(keys, prev, () => { stopSwap(); apply(); }, startSwap);
      paint();
    },
    hover: (lon, lat) => hover(current || projectionAt(params.from, params.to, t, UNIT_BOX), lon, lat),
    probe: () => ({}),
    unprobe() {},
    resize() { stopSwap(); apply(); },
    unmount() {
      stopGlide();
      stopSwap();
      ctx.overlay.clear(PREFIX);
      map.removePrefix(PREFIX);
    },
  };
}

function segmentsOf(lines) {
  const segs = [];
  for (const line of lines) for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i]]);
  return segs;
}

function outlineSegments(feature) {
  return segmentsOf(feature.geometry.coordinates.flat());
}
