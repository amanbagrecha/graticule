import { morphs } from "@/core/globe.js";
import { cylinderY } from "@/core/projections.js";
import { smoothstep } from "@/core/math.js";

const RULES = [
  { value: "equidistant", label: "Equal steps" },
  { value: "conformal", label: "Mercator" },
  { value: "equal-area", label: "Equal area" },
];

export const meta = {
  id: "cylinder-unroll",
  title: "Cylindrical maps",
  track: 2,
  order: 3,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A cylinder can wrap the whole globe and unroll flat. Cut it along one meridian: that line becomes the edge of the map. The rule that spaces the parallels makes the map. Next, the sheet becomes a cone.",
  deeper: [
    "R is the radius of the globe. The map is as wide as the equator is long: 2π R.",
    "Equal steps keep true distances along the meridians. This map is the plate carrée.",
    "Mercator puts the parallels farther apart toward the poles, so angles stay true. The pole is at infinity, so the sheet stops at 85°.",
    "Equal area puts the parallels closer together toward the poles, so areas stay true.",
  ],
  keywords: ["cylinder", "Mercator", "unroll", "seam"],
  controls: [
    { key: "rule", type: "segment", label: "Parallel spacing", options: RULES, default: "conformal" },
    { key: "seam", type: "range", label: "Cut along", min: -180, max: 180, step: 1, default: 180, unit: "°", fillFrom: 0, ticks: [-180, -90, 0, 90, 180] },
  ],
  readouts: [
    { key: "height", label: "Map height", digits: 3, unit: "R", hero: true },
    { key: "y60", label: "Equator to 60° N", digits: 3, unit: "R" },
  ],
  transport: { label: ["globe", "flat"], key: "m" },
  compare: null,
  view: { lon: 150, lat: 20, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
const FIT_PADDING = 24;
const PLAY_MS = 1400;
const PARALLEL = 60;
const SEAM_LABEL_LAT = 10;
const PARALLEL_LABEL_DLON = -70;
export const GLOBE_VIEW = { dlon: -30, lat: 20 };
export const CUT_LAT = 85;
export const LABELS = { seam: "Cut line", parallel: "60° N" };

export function mapHeight(rule) {
  if (rule === "conformal") return Infinity;
  return 2 * cylinderY(rule, 90);
}

export function readoutValues(rule) {
  return { height: mapHeight(rule), y60: cylinderY(rule, PARALLEL) };
}

export function hoverLine(rule, lat) {
  const y = Math.abs(lat) >= 90 ? mapHeight(rule) / 2 : Math.abs(cylinderY(rule, lat));
  return `On the map: ${Number.isFinite(y) ? y.toFixed(3) : "∞"} R from the equator`;
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
  const brass = ctx.palette.ui.brass, signal = ctx.palette.ui.signal;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let framedLon = null;
  let booted = false;
  let glide = null;
  let ownTick = null;

  const ids = { seam: PREFIX + "seam", parallel: PREFIX + "lat60", seamLabel: PREFIX + "seam-label", parallelLabel: PREFIX + "lat60-label" };
  const wrap = (lon) => ((lon + 540) % 360) - 180;
  const lon0 = () => wrap(params.seam - 180);

  const setMorph = () => {
    globe.morph(morphs.toCylinder({ seam: params.seam, rule: params.rule, latMax: CUT_LAT }), t);
  };

  const drawSeam = () => {
    const s = params.seam;
    globe.addLines(ids.seam, [...meridianSegments(s - 0.05), ...meridianSegments(s + 0.05)], { color: brass, width: 1.5, depth: true });
  };

  const at = (lon, lat) => [...globe.morphFn(lon, lat, t, [0, 0, 0])];

  const placeLabels = () => {
    globe.setLabel3D(ids.parallelLabel, { point: at(params.seam + PARALLEL_LABEL_DLON, PARALLEL) });
    globe.setLabel3D(ids.seamLabel, { point: at(params.seam + 0.05, SEAM_LABEL_LAT) });
  };

  const readouts = () => ctx.readout.setMany(readoutValues(params.rule));

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    const flat = t > 0;
    const lon = flat ? lon0() : wrap(params.seam + GLOBE_VIEW.dlon);
    if (framedLon !== lon) {
      if (flat || booted) globe.camera.lookAt(lon, flat ? 0 : GLOBE_VIEW.lat, null, { duration: booted && !ctx.reducedMotion ? 500 : 0 });
      framedLon = lon;
    }
    const w = smoothstep(0, 0.15, t);
    const f = globe.camera.fit(null, { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0] * w, f.pan[1] * w);
  };

  const stopGlide = () => { if (glide) { glide.cancel(); glide = null; } ownTick = null; };
  const glideFlat = () => {
    stopGlide();
    if (ctx.reducedMotion) { ctx.transport.set(1); return; }
    const tw = ctx.anim.tween({
      from: t, to: 1, duration: PLAY_MS * (1 - t), ease: ctx.anim.ease.emph,
      onUpdate: (v) => { if (glide !== tw) return; ownTick = v; ctx.transport.set(v, { live: true }); },
      onDone: () => { if (glide !== tw) return; glide = null; ownTick = 1; ctx.transport.set(1); ownTick = null; },
    });
    glide = tw;
  };

  globe.labelInsetBottom = ctx.stage.insetBottom;
  setMorph();
  drawSeam();
  globe.addLines(ids.parallel, parallelSegments(PARALLEL), { color: signal, width: 1.5, depth: true });
  globe.addLabel3D(ids.seamLabel, null, LABELS.seam, { color: brass, occlude: true, dx: -10, dy: -8 });
  globe.addLabel3D(ids.parallelLabel, null, LABELS.parallel, { color: signal, occlude: true, dx: 8, dy: 6 });
  placeLabels();
  readouts();

  if (ctx.transport) ctx.transport.onScrub((value) => {
    if (glide && value !== ownTick) stopGlide();
    t = value;
    globe.setMorphT(t);
    frameCamera();
    placeLabels();
    booted = true;
  });

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (keys.includes("rule") || keys.includes("seam")) setMorph();
      if (keys.includes("seam")) drawSeam();
      frameCamera();
      readouts();
      placeLabels();
      if (booted && ctx.transport && t < 1 && keys.length === 1 && keys[0] === "rule") glideFlat();
    },
    hover(lon, lat) {
      return [hoverLine(params.rule, lat)];
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
      stopGlide();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
    },
  };
}
