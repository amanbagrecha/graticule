import { lonLatToXYZ, xyzToLonLat, canvasPath, graticuleLines } from "@/core/globe.js";
import { perspective, perspectiveRho, perspectiveHorizon } from "@/core/projections.js";
import { DEG, RAD, vec3, clamp } from "@/core/math.js";

const BRASS = "#b85217";
const RAY = "rgba(201,130,20,.62)";
const INK = "rgba(63,60,55,.7)";
const LAMP = "#f2b632";
const OCEAN = "#c2d6e1";
const OCEAN_RIM = "#7fa7c0";
const LAND = "#ddd3bb";
const COAST = "rgba(50,46,40,.8)";
const GRAT = "rgba(60,52,40,.32)";

export const STOPS = [
  { label: "centre", D: 0 },
  { label: "back", D: 1 },
  { label: "far", D: Infinity },
];

export const TANGENT = [-0.1, 51.5];
export const HALF = 2;
export const RAYS = 120;

const LOG_BASE = 11;
const U_LOG = 99;

export function lightDistance(u) {
  if (u >= 100) return Infinity;
  if (u <= U_LOG) return Math.pow(LOG_BASE, u / U_LOG) - 1;
  return 10 / (100 - u);
}

export function sliderOf(D) {
  if (!isFinite(D)) return 100;
  if (D <= 10) return (U_LOG * Math.log(D + 1)) / Math.log(LOG_BASE);
  return 100 - 10 / D;
}

export function snapLight(u) {
  for (const p of STOPS) if (Math.abs(u - sliderOf(p.D)) < 0.8) return p.D;
  return lightDistance(u);
}

export function tangentFrame(lon, lat) {
  const T = lonLatToXYZ(lon, lat, [0, 0, 0]);
  const E = [Math.cos(lon * DEG), 0, -Math.sin(lon * DEG)];
  const N = vec3.cross(T, E);
  return { T, E, N };
}

export function lightPoint(frame, D) {
  return vec3.scale(frame.T, -D);
}

export function rayHit(frame, D, P) {
  const cosc = vec3.dot(P, frame.T);
  if (!isFinite(D)) return vec3.add(P, vec3.scale(frame.T, 1 - cosc));
  const den = D + cosc;
  if (den <= 1e-9) return null;
  const L = lightPoint(frame, D);
  return vec3.add(L, vec3.scale(vec3.sub(P, L), (1 + D) / den));
}

export function planeXY(frame, H) {
  const d = vec3.sub(H, frame.T);
  return [vec3.dot(d, frame.E), vec3.dot(d, frame.N)];
}

export function mapName(D) {
  if (D === 0) return "Gnomonic";
  if (D === 1) return "Stereographic";
  if (!isFinite(D)) return "Orthographic";
  return "Perspective";
}

export function halfGlobeEdge(D) {
  return D === 0 ? Infinity : perspectiveRho(D, 90);
}

export function radii(x) {
  return isFinite(x) ? `${x.toFixed(2)} × globe radius` : "infinitely far";
}

export function readoutsOf(D) {
  return { name: mapName(D), edge: radii(halfGlobeEdge(D)) };
}

export function hoverLine(frame, D, lon, lat) {
  const P = lonLatToXYZ(lon, lat, [0, 0, 0]);
  const c = Math.acos(clamp(vec3.dot(P, frame.T), -1, 1)) * RAD;
  if (c >= perspectiveHorizon(D) || !rayHit(frame, D, P)) return "its ray misses the sheet";
  return `lands ${radii(perspectiveRho(D, c))} from the centre`;
}

export const meta = {
  id: "light-and-plane",
  title: "Azimuthal maps",
  track: 2,
  order: 1,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A flat map must put each place of the globe on paper. One way: shine a light through the globe onto a flat sheet. Move the light: its position decides the map. Next, a rule replaces the light.",
  deeper: [
    "A light at the centre gives the gnomonic map. Every great circle becomes a straight line.",
    "A light at the back gives the stereographic map. It keeps angles, so small circles stay circles.",
    "A far light sends parallel rays. That gives the orthographic map: the globe as seen from space.",
    "A light at the centre maps less than half the globe. A light at the back maps all of it except one point.",
  ],
  keywords: ["gnomonic", "stereographic", "orthographic", "azimuthal"],
  controls: [
    { key: "light", type: "range", label: "Light from centre", min: 0, max: 100, step: 0.1, default: +sliderOf(1).toFixed(1), format: (u) => { const D = snapLight(u); return isFinite(D) ? radii(D) : "very far"; }, ticks: STOPS.map((p) => +sliderOf(p.D).toFixed(1)), tickFormat: (u) => STOPS.find((p) => +sliderOf(p.D).toFixed(1) === u).label },
  ],
  readouts: [
    { key: "name", label: "Map", hero: true },
    { key: "edge", label: "Edge of half the globe" },
  ],
  transport: null,
  compare: null,
  view: { lon: 60, lat: 25, dist: 4.4 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const CANVAS = 1024;
const CANDIDATES = 2400;
const SWEEP_MS = 600;
const FIT_PADDING = 28;
const LIGHT_FIT = 3.2;
const VIEW_SIDE = -30;
const VIEW_UP = 24;

function coastVertices(land) {
  const pts = [];
  const add = (ring) => { for (const c of ring) pts.push(c); };
  for (const f of land.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") g.coordinates.forEach(add);
    else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(add));
  }
  const stride = Math.max(1, Math.floor(pts.length / CANDIDATES));
  const out = [];
  for (let i = 0; i < pts.length; i += stride) out.push(pts[i]);
  return out;
}

export async function mount(ctx) {
  const params = { ...ctx.params };
  const globe = ctx.stage.globe;
  const land = ctx.data.get("land-110m.json") || (await ctx.data.load("land-110m.json"));
  const candidates = coastVertices(land);
  const grat = graticuleLines(15);
  const frame = tangentFrame(TANGENT[0], TANGENT[1]);
  const at = (a, b) => vec3.add(vec3.scale(frame.T, 1.004), vec3.add(vec3.scale(frame.E, a * HALF), vec3.scale(frame.N, b * HALF)));
  let D = snapLight(params.light);
  let rays = [];
  let sweep = 1;
  let sweepTween = null;
  let hoverLL = null;
  let dragging = null;

  const ids = { panel: PREFIX + "sheet", edge: PREFIX + "edge", rays: PREFIX + "rays", light: PREFIX + "light", hover: PREFIX + "hover" };
  const panel = globe.addPanel(ids.panel, { centre: vec3.scale(frame.T, 1.002), xAxis: frame.E, yAxis: frame.N, half: HALF, size: CANVAS, opacity: 0.55 });
  const k = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  globe.addSegments3D(ids.edge, [[k[0], k[1]], [k[1], k[2]], [k[2], k[3]], [k[3], k[0]]], { color: INK, width: 1.5, depth: true });
  globe.addSegments3D(ids.rays, [[[0, 0, 0], [0, 0, 0]]], { color: RAY, width: 1, depth: true });
  globe.addSegments3D(ids.hover, [[[0, 0, 0], [0, 0, 0]]], { color: ctx.palette.ui.signal, width: 2, depth: true });
  globe.addPoints3D(ids.light, [[0, 0, 0]], { color: LAMP, size: 14, depth: false });
  globe.setLayer(ids.hover, false);
  const offHover = globe.on("hover", (h) => { if (!h) { hoverLL = null; globe.setLayer(ids.hover, false); } });

  const paintMap = () => {
    const g = panel.ctx, size = CANVAS, s = size / (2 * HALF), cx = size / 2;
    const P = perspective(D).rotate([-TANGENT[0], -TANGENT[1], 0]).scale(s).translate([cx, cx]).precision(0.2);
    const path = canvasPath(P, g);
    g.clearRect(0, 0, size, size);
    g.fillStyle = "rgba(250,248,243,.92)";
    g.fillRect(0, 0, size, size);
    g.beginPath(); path({ type: "Sphere" });
    g.fillStyle = OCEAN; g.fill();
    g.lineWidth = size / 400; g.strokeStyle = OCEAN_RIM; g.stroke();
    g.beginPath(); path(land);
    g.fillStyle = LAND; g.fill();
    g.lineWidth = size / 700; g.strokeStyle = COAST; g.stroke();
    g.beginPath(); path(grat);
    g.lineWidth = size / 900; g.strokeStyle = GRAT; g.stroke();
    const r = halfGlobeEdge(D) * s;
    if (r <= cx) {
      g.setLineDash([size / 90, size / 140]);
      g.lineWidth = size / 330;
      g.strokeStyle = BRASS;
      g.beginPath(); g.arc(cx, cx, r - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    globe.setPanel(ids.panel, { dirty: true });
  };

  const raySegment = (P) => {
    const H = rayHit(frame, D, P);
    if (!H) return null;
    const start = isFinite(D) ? lightPoint(frame, D) : vec3.add(P, vec3.scale(frame.T, -1.7 - vec3.dot(P, frame.T)));
    return [start, H];
  };

  const buildRays = () => {
    const hz = perspectiveHorizon(D);
    const list = [];
    for (const [lon, lat] of candidates) {
      const P = lonLatToXYZ(lon, lat, [0, 0, 0]);
      const c = Math.acos(clamp(vec3.dot(P, frame.T), -1, 1)) * RAD;
      if (c >= hz - 0.5) continue;
      const H = rayHit(frame, D, P);
      if (!H) continue;
      const [x, y] = planeXY(frame, H);
      if (Math.abs(x) > HALF || Math.abs(y) > HALF) continue;
      list.push({ P, az: Math.atan2(x, y) });
    }
    list.sort((a, b) => a.az - b.az);
    const n = Math.min(RAYS, list.length);
    rays = [];
    for (let i = 0; i < n; i++) rays.push(list[Math.floor((i * list.length) / n)].P);
  };

  const drawRays = () => {
    const shown = Math.ceil(rays.length * sweep);
    const segs = [];
    for (let i = 0; i < shown; i++) { const s = raySegment(rays[i]); if (s) segs.push(s); }
    globe.setSegments3D(ids.rays, segs.length ? segs : [[[0, 0, 0], [0, 0, 0]]]);
    globe.setLayer(ids.rays, segs.length > 0);
  };

  const drawHover = () => {
    const s = hoverLL ? raySegment(lonLatToXYZ(hoverLL[0], hoverLL[1], [0, 0, 0])) : null;
    const c = hoverLL ? Math.acos(clamp(vec3.dot(lonLatToXYZ(hoverLL[0], hoverLL[1], [0, 0, 0]), frame.T), -1, 1)) * RAD : 180;
    if (!s || c >= perspectiveHorizon(D)) { globe.setLayer(ids.hover, false); return; }
    globe.setSegments3D(ids.hover, [s]);
    globe.setLayer(ids.hover, true);
  };

  const near = () => isFinite(D) && D <= LIGHT_FIT;

  const label = (name, p, text, color, dx, dy, visible = true) => {
    const id = PREFIX + "label-" + name;
    globe.labelInsetBottom = ctx.stage.insetBottom;
    if (!globe.labels3d.has(id)) globe.addLabel3D(id, p, text, { color, dx, dy });
    globe.setLabel3D(id, { point: p, text, visible });
  };

  const placeLabels = () => {
    const lightAt = near() ? lightPoint(frame, D) : vec3.add(vec3.scale(frame.T, -LIGHT_FIT), vec3.scale(frame.N, 0.6));
    label("light", lightAt, near() ? "light" : "light far away", BRASS, 12, -20);
    let ray = null, far = -1;
    for (const P of rays) { const H = rayHit(frame, D, P); if (!H) continue; const [x, y] = planeXY(frame, H); if (y > 0 && Math.hypot(x, y) > far) { far = Math.hypot(x, y); ray = raySegment(P); } }
    label("rays", ray ? vec3.add(ray[0], vec3.scale(vec3.sub(ray[1], ray[0]), 0.75)) : null, "light rays", BRASS, 10, -18, !!ray);
    const r = halfGlobeEdge(D);
    label("edge", vec3.add(vec3.scale(frame.T, 1.004), vec3.add(vec3.scale(frame.E, 0.64 * r), vec3.scale(frame.N, -0.77 * r))), "edge of half the globe", BRASS, 10, 4, r <= HALF + 1e-9);
  };

  const refresh = () => {
    buildRays();
    drawRays();
    globe.setPoints3D(ids.light, [lightPoint(frame, near() ? D : LIGHT_FIT)]);
    globe.setLayer(ids.light, near());
    paintMap();
    if (hoverLL) drawHover();
    placeLabels();
    ctx.readout.setMany(readoutsOf(D));
  };

  const fitPoints = () => {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 30) for (let lon = -180; lon < 180; lon += 30) pts.push(lonLatToXYZ(lon, lat, [0, 0, 0]));
    pts.push(...k, lightPoint(frame, LIGHT_FIT));
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

  if (ctx.side === "A") {
    const el = ctx.stage.el;
    const stagePos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const onLight = (x, y) => { if (!near()) return false; const s = globe.projectPoint(lightPoint(frame, D), false); return isFinite(s.x) && Math.hypot(s.x - x, s.y - y) < 16; };
    const lightAlong = (x, y) => {
      let best = null, bd = Infinity;
      for (let i = 0; i <= 400; i++) {
        const u = (i / 400) * U_LOG, d = lightDistance(u);
        if (d > LIGHT_FIT) break;
        const s = globe.projectPoint(lightPoint(frame, d), false);
        const dd = Math.hypot(s.x - x, s.y - y);
        if (dd < bd) { bd = dd; best = u; }
      }
      return best;
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const [x, y] = stagePos(e);
      if (!onLight(x, y)) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = e.pointerId;
      ctx.overlay.hideChip();
      globe.canvas.style.cursor = "grabbing";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      if (dragging === null) {
        const [x, y] = stagePos(e);
        if (onLight(x, y)) globe.canvas.style.cursor = "grab";
        return;
      }
      if (e.pointerId !== dragging) return;
      e.stopPropagation();
      const u = lightAlong(...stagePos(e));
      if (u !== null) ctx.controls.set("light", +u.toFixed(1), { live: true });
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (dragging === null || e.pointerId !== dragging) return;
      e.stopPropagation();
      dragging = null;
      globe.canvas.style.cursor = "grab";
      ctx.controls.set("light", Math.round(params.light * 10) / 10);
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
  }

  globe.setLayer("graticule", true);
  globe.setLayer("atmosphere", false);
  frameCamera();
  if (!ctx.reducedMotion) {
    sweep = 0;
    sweepTween = ctx.anim.tween({ from: 0, to: 1, duration: SWEEP_MS, ease: ctx.anim.ease.out, onUpdate: (v) => { sweep = v; drawRays(); }, onDone: () => { sweepTween = null; } });
  }
  refresh();

  return {
    update(p) {
      Object.assign(params, p);
      D = snapLight(params.light);
      refresh();
    },
    hover(lon, lat) {
      hoverLL = [lon, lat];
      drawHover();
      return [hoverLine(frame, D, lon, lat)];
    },
    resize() {
      frameCamera();
      placeLabels();
    },
    unmount() {
      offHover();
      if (sweepTween) sweepTween.cancel();
      globe.removePrefix(PREFIX);
      globe.setLayer("atmosphere", true);
      globe.canvas.style.cursor = "grab";
    },
  };
}
