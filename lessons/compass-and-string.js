import { lonLatToXYZ, xyzToLonLat, canvasPath, graticuleLines } from "@/core/globe.js";
import { azimuthalRho, make } from "@/core/projections.js";
import { R_MEAN } from "@/core/geodesy.js";
import { DEG, RAD, vec3, clamp } from "@/core/math.js";
import { tangentFrame, TANGENT } from "@/lessons/light-and-plane.js";

const BRASS = "#b85217";
const RING = "rgba(184,82,23,.6)";
const OCEAN = "#c2d6e1";
const OCEAN_RIM = "#7fa7c0";
const LAND = "#ddd3bb";
const COAST = "rgba(50,46,40,.8)";
const GRAT = "rgba(60,52,40,.22)";

export const RULES = [
  { value: "distance", label: "Distance" },
  { value: "area", label: "Area" },
];
export const PLACE = { name: "Cape Town", lonlat: [18.42, -33.92] };
export const EARTH_KM = R_MEAN / 1000;
export const RING_KM = 3000;
export const RINGS = Array.from({ length: Math.floor((EARTH_KM * Math.PI) / RING_KM) }, (_, i) => ((i + 1) * RING_KM) / EARTH_KM * RAD);

export const meta = {
  id: "compass-and-string",
  title: "Azimuthal maps by rule",
  track: 2,
  order: 2,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A light cannot keep true distance or true area, but a rule can. Pull a string flat from London: distances from London stay true. Swing a compass down: areas stay true. Next, the sheet becomes a cylinder.",
  deeper: [
    "The string rule gives the azimuthal equidistant map. The UN emblem uses it, centred on the North Pole.",
    "The compass rule gives the Lambert azimuthal equal-area map. The compass keeps the straight-line distance through the globe.",
    "Both rules keep the direction from London true.",
    "The point opposite London becomes the whole edge of the map.",
  ],
  keywords: ["equidistant", "equal-area", "azimuthal", "Lambert"],
  controls: [
    { key: "rule", type: "segment", label: "Keep true", options: RULES, default: "distance" },
  ],
  readouts: [
    { key: "dist", label: "Distance from London", digits: 0, unit: "% of true" },
    { key: "area", label: "Area at the place", digits: 0, unit: "% of true" },
  ],
  transport: null,
  compare: null,
  view: { lon: 60, lat: 25, dist: 5 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const CANVAS = 1024;
const PAD = 1.03;
const SWING_MS = 700;
const MORPH_MS = 600;
const FIT_PADDING = 28;
const VIEW_SIDE = -56;
const VIEW_UP = 9;
const LIFT = 1.004;

export function rhoOf(rule, cDeg) {
  return azimuthalRho(rule === "area" ? "equal-area" : "equidistant", cDeg);
}

export function sheetRadius(rule) {
  return rhoOf(rule, 180);
}

export function distanceKept(rule, cDeg) {
  if (cDeg < 1e-9) return 100;
  return (100 * rhoOf(rule, cDeg)) / (cDeg * DEG);
}

export function areaKept(rule, cDeg) {
  if (rule === "area" || cDeg < 1e-9) return 100;
  const c = cDeg * DEG, s = Math.sin(c);
  return s < 1e-9 ? Infinity : (100 * c) / s;
}

export function readoutsOf(rule, cDeg) {
  const area = areaKept(rule, cDeg);
  return { dist: distanceKept(rule, cDeg), area: area < 1e5 ? area : "∞" };
}

export function hoverLine(cDeg) {
  const km = Math.round((cDeg * DEG * EARTH_KM) / 10) * 10;
  return `${km.toLocaleString("en-US")} km from London`;
}

export function angularDistance(frame, P) {
  return Math.acos(clamp(vec3.dot(P, frame.T), -1, 1)) * RAD;
}

export function azimuthDir(frame, P) {
  const d = vec3.sub(P, vec3.scale(frame.T, vec3.dot(P, frame.T)));
  const l = vec3.length(d);
  return l < 1e-12 ? frame.E : vec3.scale(d, 1 / l);
}

export function compassArm(frame, P, u) {
  const c = angularDistance(frame, P) * DEG, dir = azimuthDir(frame, P);
  const k = 2 * Math.sin(c / 2), a = (1 - u) * (c / 2);
  return vec3.add(frame.T, vec3.add(vec3.scale(dir, k * Math.cos(a)), vec3.scale(frame.T, -k * Math.sin(a))));
}

export function stringPoint(frame, P, u, s = 1) {
  const c = angularDistance(frame, P) * DEG, dir = azimuthDir(frame, P);
  const l = c * s;
  if (u >= 1) return vec3.add(frame.T, vec3.scale(dir, l));
  const r = 1 / (1 - u), th = l / r;
  return vec3.add(frame.T, vec3.add(vec3.scale(dir, r * Math.sin(th)), vec3.scale(frame.T, -r * (1 - Math.cos(th)))));
}

export function swingEnd(rule, frame, P, u) {
  return rule === "area" ? compassArm(frame, P, u) : stringPoint(frame, P, u, 1);
}

function smallCircle(frame, cDeg, n = 120) {
  const c = cDeg * DEG, segs = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const v = vec3.add(vec3.scale(frame.T, Math.cos(c)), vec3.scale(vec3.add(vec3.scale(frame.E, Math.cos(a)), vec3.scale(frame.N, Math.sin(a))), Math.sin(c)));
    const ll = xyzToLonLat(v[0], v[1], v[2]);
    if (prev) segs.push([prev, ll]);
    prev = ll;
  }
  return segs;
}

function polyline(n, fn) {
  const segs = [];
  let prev = fn(0);
  for (let i = 1; i <= n; i++) { const q = fn(i / n); segs.push([prev, q]); prev = q; }
  return segs;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const signal = ctx.palette.ui.signal;
  const land = ctx.data.get("land-110m.json") || (await ctx.data.load("land-110m.json"));
  const grat = graticuleLines(15);
  const frame = tangentFrame(TANGENT[0], TANGENT[1]);
  let rule = ctx.params.rule === "area" ? "area" : "distance";
  let blend = rule === "area" ? 0 : 1;
  let target = PLACE.lonlat, placeName = PLACE.name;
  let swingU = 1;
  let blendTween = null, swingTween = null;
  const ids = { panel: PREFIX + "sheet", arm: PREFIX + "arm", trail: PREFIX + "trail", ghost: PREFIX + "ghost", ends: PREFIX + "ends", tan: PREFIX + "tangent", rings: PREFIX + "rings" };

  const radiusNow = () => 2 + (Math.PI - 2) * blend;
  const ringRadius = (c) => rhoOf("area", c) + (rhoOf("distance", c) - rhoOf("area", c)) * blend;

  const panel = globe.addPanel(ids.panel, { centre: vec3.scale(frame.T, 1.002), xAxis: frame.E, yAxis: frame.N, half: radiusNow() * PAD, size: CANVAS, opacity: 0.7 });

  const paint = (r) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = CANVAS;
    const g = canvas.getContext("2d"), size = CANVAS, cx = size / 2, k = size / (2 * sheetRadius(r) * PAD);
    const P = make(r === "area" ? "azimuthalEqualArea" : "azimuthalEquidistant", { rotate: [-TANGENT[0], -TANGENT[1], 0] }).scale(k).translate([cx, cx]);
    const path = canvasPath(P, g);
    g.save();
    g.beginPath(); g.arc(cx, cx, sheetRadius(r) * k, 0, Math.PI * 2);
    g.fillStyle = OCEAN; g.fill();
    g.clip();
    g.beginPath(); path(land); g.fillStyle = LAND; g.fill();
    g.lineWidth = size / 700; g.strokeStyle = COAST; g.stroke();
    g.beginPath(); path(grat); g.lineWidth = size / 1000; g.strokeStyle = GRAT; g.stroke();
    g.restore();
    g.beginPath(); g.arc(cx, cx, sheetRadius(r) * k, 0, Math.PI * 2);
    g.lineWidth = size / 400; g.strokeStyle = OCEAN_RIM; g.stroke();
    g.setLineDash([size / 110, size / 160]);
    g.lineWidth = size / 450; g.strokeStyle = RING;
    for (const c of RINGS) { g.beginPath(); g.arc(cx, cx, rhoOf(r, c) * k, 0, Math.PI * 2); g.stroke(); }
    return canvas;
  };
  const maps = { area: paint("area"), distance: paint("distance") };

  const drawSheet = () => {
    globe.setPanel(ids.panel, { half: radiusNow() * PAD });
    const g = panel.ctx;
    g.clearRect(0, 0, CANVAS, CANVAS);
    if (blend < 1) g.drawImage(maps.area, 0, 0);
    if (blend > 0) { g.globalAlpha = blend; g.drawImage(maps.distance, 0, 0); g.globalAlpha = 1; }
    globe.setPanel(ids.panel, { dirty: true });
  };

  globe.addLines(ids.rings, RINGS.flatMap((c) => smallCircle(frame, c)), { color: RING, width: 1, depth: true, dash: [6, 4] });
  globe.addSegments3D(ids.ghost, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(29,99,168,.35)", width: 1.25 });
  globe.addSegments3D(ids.trail, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(29,99,168,.7)", width: 1.5, dash: [5, 4], depth: false, order: 3 });
  globe.addSegments3D(ids.arm, [[[0, 0, 0], [0, 0, 0]]], { color: signal, width: 2.5, depth: false, order: 3 });
  globe.addPoints3D(ids.ends, [[0, 0, 0]], { color: signal, size: 9, depth: false, order: 4 });
  globe.addPoints3D(ids.tan, [vec3.scale(frame.T, LIFT)], { color: BRASS, size: 9, depth: false });
  globe.setLayer("atmosphere", false);

  const place = () => lonLatToXYZ(target[0], target[1], [0, 0, 0]);

  const drawGhost = () => {
    const P = place();
    const ghost = rule === "area" ? [[vec3.scale(P, 1.003), frame.T]] : polyline(64, (s) => vec3.scale(stringPoint(frame, P, 0, s), 1.003));
    globe.setSegments3D(ids.ghost, ghost);
  };

  const drawSwing = () => {
    const P = place(), u = swingU;
    const end = swingEnd(rule, frame, P, u);
    const lift = vec3.scale(frame.T, 0.004);
    const arm = rule === "area" ? [[frame.T, end]] : polyline(64, (s) => vec3.add(stringPoint(frame, P, u, s), lift));
    globe.setSegments3D(ids.arm, arm);
    globe.setPoints3D(ids.ends, [end, vec3.scale(P, LIFT)]);
    const trail = rule === "area" && u > 0;
    if (trail) globe.setSegments3D(ids.trail, polyline(40, (s) => compassArm(frame, P, s * u)));
    globe.setLayer(ids.trail, trail);
    globe.setLayer(ids.ghost, u > 0);
  };

  const label = (name, p, text, color, dx, dy) => {
    const id = PREFIX + "label-" + name;
    globe.labelInsetBottom = ctx.stage.insetBottom;
    if (!globe.labels3d.has(id)) globe.addLabel3D(id, p, text, { color, dx, dy });
    else globe.setLabel3D(id, { point: p, text });
  };

  const placeLabels = () => {
    label("centre", vec3.scale(frame.T, LIFT), "London", BRASS, 10, 6);
    label("ring", vec3.add(frame.T, vec3.scale(frame.N, ringRadius(RINGS[1]) * LIFT)), `a ring every ${RING_KM.toLocaleString("en-US")} km`, BRASS, 8, -18);
    label("place", swingEnd(rule, frame, place(), swingU), placeName, signal, 12, -20);
  };

  const readouts = () => ctx.readout.setMany(readoutsOf(rule, angularDistance(frame, place())));

  const swing = () => {
    if (swingTween) swingTween.cancel();
    swingTween = null;
    drawGhost();
    readouts();
    if (ctx.reducedMotion) { swingU = 1; drawSwing(); placeLabels(); return; }
    swingU = 0;
    swingTween = ctx.anim.tween({ from: 0, to: 1, duration: SWING_MS, ease: ctx.anim.ease.emph, onUpdate: (v) => { swingU = v; drawSwing(); placeLabels(); }, onDone: () => { swingTween = null; } });
  };

  const morph = () => {
    const to = rule === "area" ? 0 : 1;
    if (blendTween) blendTween.cancel();
    blendTween = null;
    if (ctx.reducedMotion) { blend = to; drawSheet(); placeLabels(); return; }
    blendTween = ctx.anim.tween({ from: blend, to, duration: MORPH_MS, ease: ctx.anim.ease.emph, onUpdate: (v) => { blend = v; drawSheet(); placeLabels(); }, onDone: () => { blendTween = null; } });
  };

  const fitPoints = () => {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 30) for (let lon = -180; lon < 180; lon += 30) pts.push(lonLatToXYZ(lon, lat, [0, 0, 0]));
    const r = Math.PI * PAD;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push(vec3.add(frame.T, vec3.add(vec3.scale(frame.E, r * Math.cos(a)), vec3.scale(frame.N, r * Math.sin(a)))));
    }
    return pts;
  };

  const viewDir = () => {
    const a = VIEW_SIDE * DEG, el = VIEW_UP * DEG;
    const side = vec3.add(vec3.scale(frame.T, Math.cos(a)), vec3.scale(frame.E, Math.sin(a)));
    const v = vec3.normalize(vec3.add(vec3.scale(side, Math.cos(el)), vec3.scale(frame.N, Math.sin(el))));
    const [lon, lat] = xyzToLonLat(v[0], v[1], v[2]);
    let east = vec3.cross([0, 1, 0], v);
    east = vec3.length(east) < 1e-6 ? [1, 0, 0] : vec3.normalize(east);
    const north = vec3.cross(v, east);
    const theta = Math.atan2(vec3.dot(frame.N, north), vec3.dot(frame.N, east)) * RAD;
    return { lon, lat, roll: ((90 - theta + 540) % 360) - 180 };
  };

  const frameCamera = () => {
    globe.camera.setState(viewDir());
    const f = globe.camera.fit(fitPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, minDist: 3, apply: false });
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  drawSheet();
  frameCamera();
  swing();
  placeLabels();

  const choose = (ll, name) => {
    target = ll;
    placeName = name;
    swing();
    placeLabels();
  };

  return {
    update(p) {
      const next = p.rule === "area" ? "area" : "distance";
      if (next === rule) return;
      rule = next;
      morph();
      swing();
      placeLabels();
    },
    hover(lon, lat) {
      return [hoverLine(angularDistance(frame, lonLatToXYZ(lon, lat, [0, 0, 0])))];
    },
    probe(lon, lat) {
      choose([lon, lat], "the place");
      return readoutsOf(rule, angularDistance(frame, place()));
    },
    unprobe() {
      choose(PLACE.lonlat, PLACE.name);
    },
    resize() {
      frameCamera();
      placeLabels();
    },
    unmount() {
      for (const tw of [blendTween, swingTween]) if (tw) tw.cancel();
      globe.removePrefix(PREFIX);
      globe.setLayer("atmosphere", true);
    },
  };
}
