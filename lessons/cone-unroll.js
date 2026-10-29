import { morphs } from "@/core/globe.js";
import { DEG, vec3, clamp } from "@/core/math.js";

const INK = "rgba(63,60,55,.62)";
const INK_FAINT = "rgba(63,60,55,.34)";
const CUT = "#b42335";
const BRASS = "#b85217";
const BAND = "rgba(184,82,23,.6)";
const LABEL = "#8a3a0c";

export const EARTH_KM = 6371;
export const TOLERANCE = 0.01;
export const SEAM = 180;
export const LABELS = { lat0: "Touching parallel", band: "Lengths 1 % too long here", cut: "Cut" };
export const NARROW_LABELS = { lat0: "Touching line", band: "1 % too long", cut: "Cut" };
export const NARROW_PX = 480;

export const meta = {
  id: "cone-unroll",
  title: "Conic maps",
  track: 2,
  order: 4,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A cylinder touches the equator, but most countries are far from it. A cone touches the globe along one parallel, and the map is best near that line. Drag that parallel through your country. Next, choose what the map keeps.",
  deeper: [
    "Lengths within 1 % means that 100 km on the globe is at most 101 km on the map.",
    "Maps of the USA and of Europe often use a cone. Both are wide from west to east and far from the equator.",
    "Most real conic maps cut through the globe along two parallels. The map is then true on both lines, and the error between them is smaller.",
    "Put the parallel near the equator and the cone is almost a cylinder. Put it near the pole and the cone is almost a flat sheet.",
  ],
  keywords: ["conic", "standard parallel", "Lambert", "cone"],
  controls: [
    { key: "lat0", type: "range", label: "Touching parallel", min: 1, max: 89, step: 1, default: 40, unit: "°N", ticks: [1, 30, 60, 89] },
  ],
  readouts: [
    { key: "band", label: "Lengths within 1 %", mono: false, hero: true },
  ],
  transport: { label: ["globe", "flat"], key: "m" },
  compare: null,
  view: { lon: -28, lat: 20, dist: 3.4 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const FIT_PADDING = 28;
const GEN_STEP = 30;
const RIM_STEPS = 144;
const LIFT = 0.006;
const CAM_LAT = 20;
const APEX_REACH = 3.2;
const CAP = 1.2;
export const SPAN = 3;

export function lengthScale(lat, lat0) {
  const phi = clamp(lat, -89.999, 89.999) * DEG, phi0 = lat0 * DEG, n = Math.sin(phi0);
  const rho = Math.pow(Math.tan(Math.PI / 4 - phi / 2) / Math.tan(Math.PI / 4 - phi0 / 2), n) / Math.tan(phi0);
  return (n * rho) / Math.cos(phi);
}

export function goodBand(lat0, tol = TOLERANCE) {
  const edge = (lo, hi, rising) => {
    if (lengthScale(rising ? hi : lo, lat0) <= 1 + tol) return rising ? hi : lo;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if ((lengthScale(mid, lat0) > 1 + tol) === rising) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
  return [edge(-90, lat0, false), edge(lat0, 90, true)];
}

export function latText(lat) {
  const r = Math.round(lat);
  return r === 0 ? "0°" : `${Math.abs(r)}°${r < 0 ? "S" : "N"}`;
}

export function bandText(lat0) {
  const [s, n] = goodBand(lat0);
  return `${latText(s)} to ${latText(n)}`;
}

export function hoverLines(lat, lat0) {
  const e = (lengthScale(lat, lat0) - 1) * 100;
  const km = Math.round((Math.abs(lat - lat0) * DEG * EARTH_KM) / 10) * 10;
  const first = e < 0.005 ? "Lengths true here" : `Lengths ${e.toFixed(e < 1 ? 2 : e < 10 ? 1 : 0)} % too long here`;
  return [first, `${km.toLocaleString("en-US")} km from the touching parallel`];
}

export function sectorPoint(frame, lon, D, lift = 0) {
  const g = frame.generator(lon);
  const p = vec3.add(frame.apex, vec3.scale(g, D));
  return lift ? vec3.add(p, vec3.scale(frame.normal(lon), lift)) : p;
}

export function outline(fn, t, seam = SEAM) {
  const f = fn.frame(t);
  const rho0 = fn.rho0;
  const top = Math.max(0, fn.rho(90, t)), bottom = fn.rho(-90, t);
  const apexOn = rho0 <= APEX_REACH;
  const genTop = apexOn ? 0 : Math.min(top, rho0 - CAP);
  const lon0 = fn.lon0;
  const gens = [];
  for (let k = GEN_STEP; k < 180; k += GEN_STEP) for (const s of [-1, 1]) {
    const lon = lon0 + s * k;
    gens.push([sectorPoint(f, lon, genTop, LIFT), sectorPoint(f, lon, bottom, LIFT)]);
  }
  gens.push([sectorPoint(f, lon0, genTop, LIFT), sectorPoint(f, lon0, bottom, LIFT)]);
  const edges = [];
  for (const s of [-1, 1]) edges.push([sectorPoint(f, seam + s * 0.01, genTop, LIFT), sectorPoint(f, seam + s * 0.01, bottom, LIFT)]);
  const rim = [];
  const arc = (D) => {
    let prev = null;
    for (let i = 0; i <= RIM_STEPS; i++) {
      const lon = seam + 0.01 + (359.98 * i) / RIM_STEPS;
      const p = sectorPoint(f, lon, D, LIFT);
      if (prev) rim.push([prev, p]);
      prev = p;
    }
  };
  arc(bottom);
  if (t >= 0.4 && top > 0.02) arc(top);
  return { frame: f, gens, edges, rim, apexOn, genTop, top, bottom };
}

function parallelSegments(lat, step = 2) {
  const segs = [];
  for (let lon = -180; lon < 180; lon += step) segs.push([[lon, lat], [lon + step, lat]]);
  return segs;
}

function meridianSegments(lon, step = 2) {
  const segs = [];
  for (let lat = -88; lat < 88; lat += step) segs.push([[lon, lat], [lon, lat + step]]);
  return segs;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let fn = null;
  let shape = null;
  let band = goodBand(params.lat0);
  let framedLon = null;
  let follow = false;
  let glideToken = 0;
  let booted = false;
  let dragging = null;

  const lon0 = SEAM - 180;
  const ids = { gens: PREFIX + "generators", edges: PREFIX + "edges", rim: PREFIX + "rim" };
  const lid = (name) => PREFIX + "label-" + name;

  const setMorph = () => {
    fn = morphs.toCone({ lat0: params.lat0, seam: SEAM, rule: "conformal", span: SPAN });
    globe.morph(fn, t);
  };

  const drawGuides = () => {
    band = goodBand(params.lat0);
    globe.addLines(PREFIX + "lat0", parallelSegments(params.lat0), { color: BRASS, width: 2, depth: true, dash: [6, 3] });
    globe.addLines(PREFIX + "band", [...parallelSegments(band[0]), ...parallelSegments(band[1])], { color: BAND, width: 1.25, depth: true });
  };

  globe.addLines(PREFIX + "seam", [...meridianSegments(SEAM - 0.05), ...meridianSegments(SEAM + 0.05)], { color: CUT, width: 1.75, depth: true });
  globe.addSegments3D(ids.gens, [[[0, 0, 0], [0, 0, 0]]], { color: INK_FAINT, width: 1, depth: true });
  globe.addSegments3D(ids.rim, [[[0, 0, 0], [0, 0, 0]]], { color: INK, width: 1.5, depth: true });
  globe.addSegments3D(ids.edges, [[[0, 0, 0], [0, 0, 0]]], { color: CUT, width: 2, depth: true });

  globe.addLabel3D(lid("lat0"), null, LABELS.lat0, { color: LABEL, dx: 14, dy: -7, occlude: true });
  globe.addLabel3D(lid("band"), null, LABELS.band, { color: LABEL, dx: -14, dy: -7, occlude: true });
  globe.addLabel3D(lid("cut"), null, LABELS.cut, { color: CUT });

  const placeLabels = () => {
    if (!shape) return;
    globe.labelInsetBottom = ctx.stage.insetBottom;
    const f = shape.frame;
    const text = ctx.stage.width < NARROW_PX ? NARROW_LABELS : LABELS;
    globe.setLabel3D(lid("lat0"), { point: fn(lon0 + 52, params.lat0, t, [0, 0, 0]), text: text.lat0 });
    globe.setLabel3D(lid("band"), { point: fn(lon0 - 108, band[0], t, [0, 0, 0]), text: text.band });
    const near = shape.genTop + 0.45 * (fn.rho0 - shape.genTop), far = shape.top + 0.6 * (shape.bottom - shape.top);
    const D = near + (far - near) * f.u;
    globe.setLabel3D(lid("cut"), { point: sectorPoint(f, SEAM - 0.01, D, LIFT), away: sectorPoint(f, SEAM - 12, D, LIFT) });
  };

  const updateOutline = () => {
    shape = outline(fn, t);
    const fade = 1 - shape.frame.u;
    globe.setSegments3D(ids.gens, shape.gens, { opacity: 0.34 * (0.25 + 0.75 * fade) });
    globe.setSegments3D(ids.rim, shape.rim);
    globe.setSegments3D(ids.edges, shape.edges);
    placeLabels();
  };

  const readouts = () => {
    ctx.readout.setMany({ band: bandText(params.lat0) });
  };

  const fitPoints = () => {
    const pts = [];
    const out = [0, 0, 0];
    for (let lat = -90; lat <= 90; lat += 15) for (let lon = -180; lon < 180; lon += 20) {
      fn(lon, lat, t, out);
      if (isFinite(out[0])) pts.push([out[0], out[1], out[2]]);
    }
    for (const seg of [...shape.gens, ...shape.edges]) pts.push(seg[0], seg[1]);
    for (let i = 0; i < shape.rim.length; i += 6) pts.push(shape.rim[i][0]);
    if (shape.apexOn) pts.push(shape.frame.apex);
    return pts;
  };

  const camLat = () => CAM_LAT * (1 - fn.frame(t).u);

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) { framedLon = null; follow = false; }
    else if (framedLon !== lon0) {
      framedLon = lon0;
      follow = false;
      const token = ++glideToken;
      const duration = booted && !ctx.reducedMotion ? 500 : 0;
      const done = globe.camera.lookAt(lon0, camLat(), null, { duration });
      if (duration && done && done.then) done.then(() => { if (token === glideToken) follow = true; });
      else follow = true;
    } else if (follow) globe.camera.lookAt(lon0, camLat(), null, { duration: 0 });
    const f = globe.camera.fit(fitPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  const nearParallel = (x, y) => {
    const p = globe.pick(x, y);
    if (!p) return false;
    const s = globe.project(p.lon, params.lat0);
    return s.visible && Math.hypot(s.x - x, s.y - y) < 10;
  };

  const offDrag = globe.on("drag", () => { follow = false; });
  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  if (ctx.side === "A") {
    const el = ctx.stage.el;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || t > 0.4) return;
      const [x, y] = stagePos(e);
      if (!nearParallel(x, y)) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = { id: e.pointerId, last: params.lat0 };
      ctx.overlay.hideChip();
      globe.canvas.style.cursor = "ns-resize";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const [x, y] = stagePos(e);
      const p = globe.pick(x, y);
      if (!p) return;
      const v = clamp(Math.round(p.lat), 1, 89);
      if (v !== dragging.last) { dragging.last = v; ctx.controls.set("lat0", v, { live: true }); }
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const v = dragging.last;
      dragging = null;
      globe.canvas.style.cursor = "grab";
      ctx.controls.set("lat0", v);
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
  }

  let alive = true;
  if (ctx.side === "A" && t <= 0) {
    const arrived = globe.camera.lookAt(meta.view.lon, meta.view.lat, null, { duration: ctx.reducedMotion ? 0 : 650 });
    if (arrived && arrived.then) arrived.then(() => { if (alive && t <= 0) frameCamera(); });
  }
  globe.labelInsetBottom = ctx.stage.insetBottom;
  setMorph();
  drawGuides();
  updateOutline();
  readouts();

  if (ctx.transport) ctx.transport.onScrub((value) => {
    t = value;
    globe.setMorphT(t);
    updateOutline();
    frameCamera();
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      const moved = keys.includes("lat0");
      if (moved) { setMorph(); drawGuides(); readouts(); }
      updateOutline();
      if (moved) frameCamera();
      ctx.overlay.update();
    },
    hover(lon, lat) {
      if (ctx.side === "A" && t <= 0.4 && !dragging) {
        const s = globe.project(lon, params.lat0);
        const q = globe.project(lon, lat);
        globe.canvas.style.cursor = s.visible && Math.hypot(s.x - q.x, s.y - q.y) < 10 ? "ns-resize" : "grab";
      }
      return hoverLines(lat, params.lat0);
    },
    probe() {
      return null;
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      frameCamera();
      placeLabels();
    },
    unmount() {
      alive = false;
      offDrag();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      globe.canvas.style.cursor = "grab";
    },
  };
}
