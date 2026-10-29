import { lonLatToXYZ } from "@/core/globe.js";
import { clamp } from "@/core/math.js";

const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const SERIF = "var(--font-serif)";
const HALO = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => `${x}px ${y}px 1px #faf8f3`).concat("0 0 4px #faf8f3").join(", ");

export const DELHI = [77.21, 28.61];

export const meta = {
  id: "graticule",
  title: "Latitude and longitude",
  track: 1,
  order: 1,
  mode: "3d",
  renderer: "webgl",
  paragraph: "To map a place, you first need its address: two angles. Longitude is how far east or west of Greenwich. Latitude is how far north or south of the equator. Drag the dot.",
  deeper: [
    "Lines of equal longitude are meridians, and lines of equal latitude are parallels. Together they make the graticule.",
    "Latitude runs from 90° S to 90° N, and longitude from 180° W to 180° E.",
    "One degree of latitude is about 111 km.",
    "The Earth is about 40,000 km around.",
  ],
  keywords: ["graticule", "longitude", "latitude", "meridian"],
  controls: [
    { key: "point", type: "point", label: "Point", default: DELHI, hidden: true },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: { lon: 38.6, lat: 14.3, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
export const STEP = 15;
export const ARC_R = 1.002;
const LON_SEGS = 90;
const LAT_SEGS = 45;
const FIT_PAD = 56;
const EDGE_PAD = 28;
const GLIDE = 650;
export const FAR = 40;
const DRAW_MS = 300;

export function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function normalise(p) {
  return [+wrapLon(p[0]).toFixed(2), +clamp(p[1], -90, 90).toFixed(2)];
}

export function formatLon(lon) {
  return `${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
}

export function formatLat(lat) {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}`;
}

export function lonArc(lon, f = 1, n = LON_SEGS) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([(lon * f * i) / n, 0]);
  return pts;
}

export function latArc(lon, lat, f = 1, n = LAT_SEGS) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push([lon, (lat * f * i) / n]);
  return pts;
}

export function toXYZ(pts, r = ARC_R) {
  return pts.map(([lon, lat]) => lonLatToXYZ(lon, lat, [0, 0, 0], r));
}

export function viewFor(lon, lat) {
  const s = lon < 0 ? -1 : 1;
  return { lon: s * Math.max(Math.abs(lon) / 2, Math.abs(lon) - FAR), lat: clamp(lat / 2, -45, 45) };
}

function segs(xyz) {
  const out = [];
  for (let i = 1; i < xyz.length; i++) out.push([xyz[i - 1], xyz[i]]);
  return out;
}

function gridSegments() {
  const out = [];
  const d = 2;
  for (let lon = -180 + STEP; lon < 180; lon += STEP) {
    if (lon === 0) continue;
    for (let lat = -90; lat < 90; lat += d) out.push([[lon, lat], [lon, lat + d]]);
  }
  for (let lon = -180; lon < 180; lon += d) {
    for (let lat = -90 + STEP; lat < 90; lat += STEP) if (lat !== 0) out.push([[lon, lat], [lon + d, lat]]);
  }
  for (let lat = -90; lat < 90; lat += d) out.push([[-180, lat], [-180, lat + d]]);
  return out;
}

function axisSegments() {
  const out = [];
  const d = 2;
  for (let lon = -180; lon < 180; lon += d) out.push([[lon, 0], [lon + d, 0]]);
  for (let lat = -90; lat < 90; lat += d) out.push([[0, lat], [0, lat + d]]);
  return out;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let P = normalise(params.point);
  let drawn = 1, drawTw = null, camTw = null, dragging = null, settling = false, booted = false;
  const ids = {
    grid: PREFIX + "grid", axes: PREFIX + "axes", lon: PREFIX + "lon-arc", lat: PREFIX + "lat-arc",
    dot: PREFIX + "point", zero: PREFIX + "label-zero", lonLabel: PREFIX + "label-lon", latLabel: PREFIX + "label-lat",
  };

  globe.setLayer("graticule", false);
  globe.labelInsetBottom = ctx.stage.insetBottom;
  globe.addLines(ids.grid, gridSegments(), { color: "rgba(60,52,40,.22)", width: 1, depth: true });
  globe.addLines(ids.axes, axisSegments(), { color: "rgba(26,25,23,.78)", width: 2, depth: true });
  globe.addSegments3D(ids.lon, segs(toXYZ(lonArc(P[0]))), { color: BLUE, width: 4, depth: true, order: 3 });
  globe.addSegments3D(ids.lat, segs(toXYZ(latArc(P[0], P[1]))), { color: ORANGE, width: 4, depth: true, order: 3 });
  for (const id of [ids.lon, ids.lat]) {
    const m = globe.extra.get(id)?.material;
    if (m) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1000 });
  }
  ctx.overlay.pin(ids.dot, { lon: P[0], lat: P[1] }, { color: INK, size: 12 });

  const makeLabel = (id, color, size, gap = 10) => {
    const lab = globe.addLabel3D(id, null, "", { color, gap, occlude: true });
    lab.el.classList.remove("mono");
    lab.el.style.font = `600 ${size}px/1.2 ${SERIF}`;
    lab.el.style.textShadow = HALO;
    return lab;
  };
  makeLabel(ids.zero, INK, 15);
  makeLabel(ids.lonLabel, BLUE, 17);
  makeLabel(ids.latLabel, ORANGE, 17, 14);
  if (document.fonts && document.fonts.load) document.fonts.load(`600 17px "Newsreader"`).then(() => {
    for (const id of [ids.zero, ids.lonLabel, ids.latLabel]) { const l = globe.labels3d.get(id); if (l) l.w = 0; }
    globe.invalidate();
  }).catch(() => {});

  const at = (lon, lat) => lonLatToXYZ(lon, lat, [0, 0, 0], ARC_R);

  const placeLabels = () => {
    const [lon, lat] = P;
    const sLon = lon < 0 ? -1 : 1, sLat = lat < 0 ? -1 : 1;
    globe.setLabel3D(ids.zero, { point: at(0, 0), away: at(sLon * 3, -sLat * 3), text: "0°" });
    globe.setLabel3D(ids.lonLabel, { point: at(lon / 2, 0), away: at(lon / 2, sLat * 3), text: formatLon(lon) });
    globe.setLabel3D(ids.latLabel, { point: at(lon, lat / 2), away: at(lon + sLon * 3, lat / 2), text: formatLat(lat) });
  };

  const drawArcs = () => {
    globe.setSegments3D(ids.lon, segs(toXYZ(lonArc(P[0], drawn))));
    globe.setSegments3D(ids.lat, segs(toXYZ(latArc(P[0], P[1], drawn))));
  };

  const drawPoint = () => ctx.overlay.move(ids.dot, { lon: P[0], lat: P[1] });

  const drawOn = () => {
    if (drawTw) { drawTw.cancel(); drawTw = null; }
    if (ctx.reducedMotion) { drawn = 1; drawArcs(); return; }
    drawn = 0;
    drawArcs();
    drawTw = ctx.anim.tween({ from: 0, to: 1, duration: DRAW_MS, ease: ctx.anim.ease.out, onUpdate: (v) => { drawn = v; drawArcs(); }, onDone: () => { drawTw = null; } });
  };

  const fitPoints = () => [...toXYZ(lonArc(P[0], 1, 12)), ...toXYZ(latArc(P[0], P[1], 1, 8))];
  const fitNow = () => globe.camera.fit(fitPoints(), { padding: FIT_PAD, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });

  const frame = (duration) => {
    if (ctx.side !== "A") return;
    if (camTw) { camTw.cancel(); camTw = null; }
    const v = viewFor(P[0], P[1]);
    if (!duration || ctx.reducedMotion) {
      globe.camera.setState({ lon: v.lon, lat: v.lat, roll: 0 });
      const f = fitNow();
      globe.camera.setDist(f.dist);
      globe.camera.setPan(f.pan[0], f.pan[1]);
      ctx.overlay.update();
      return;
    }
    const from = globe.camera.state();
    const turn = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
    camTw = ctx.anim.tween({ from: 0, to: 1, duration, ease: ctx.anim.ease.emph, onUpdate: (k) => {
      globe.camera.setState({ lon: turn(from.lon, v.lon, k), lat: from.lat + (v.lat - from.lat) * k, roll: turn(from.roll || 0, 0, k) });
      const f = fitNow();
      globe.camera.setDist(from.dist + (f.dist - from.dist) * k);
      globe.camera.setPan(from.pan[0] + (f.pan[0] - from.pan[0]) * k, from.pan[1] + (f.pan[1] - from.pan[1]) * k);
    }, onDone: () => { camTw = null; ctx.overlay.update(); } });
  };

  const inView = ([lon, lat]) => {
    const s = globe.project(lon, lat);
    const W = ctx.stage.width, H = ctx.stage.height - ctx.stage.insetBottom;
    return s.visible && s.x > EDGE_PAD && s.x < W - EDGE_PAD && s.y > EDGE_PAD && s.y < H - EDGE_PAD;
  };

  const follow = () => {
    const keys = [[0, 0], [P[0] / 2, 0], [P[0], 0], [P[0], P[1] / 2], P];
    if (keys.every(inView)) return;
    const v = viewFor(P[0], P[1]), s = globe.camera.state();
    const d = Math.hypot(wrapLon(v.lon - s.lon) * Math.cos(v.lat * Math.PI / 180), v.lat - s.lat);
    if (d < 2) return;
    frame(GLIDE);
  };

  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onPoint = (x, y) => { const s = globe.project(P[0], P[1]); return s.visible && Math.hypot(s.x - x, s.y - y) < 16; };
  const el = ctx.stage.el;
  el.addEventListener("pointerdown", (e) => {
    if (camTw) { camTw.cancel(); camTw = null; }
    if (e.button !== 0 || ctx.side !== "A") return;
    const [x, y] = stagePos(e);
    if (!onPoint(x, y)) return;
    e.stopPropagation(); e.preventDefault();
    dragging = { id: e.pointerId };
    ctx.overlay.hideChip();
    globe.canvas.style.cursor = "grabbing";
  }, { capture: true, signal: ctx.signal });
  el.addEventListener("pointermove", (e) => {
    const [x, y] = stagePos(e);
    if (!dragging) { if (onPoint(x, y)) globe.canvas.style.cursor = "grab"; return; }
    if (e.pointerId !== dragging.id) return;
    e.stopPropagation();
    const p = globe.pick(x, y);
    if (p) ctx.controls.set("point", normalise([p.lon, p.lat]), { live: true });
  }, { capture: true, signal: ctx.signal });
  const end = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    e.stopPropagation();
    dragging = null;
    globe.canvas.style.cursor = "grab";
    ctx.overlay.hideChip();
    settling = true;
    ctx.controls.set("point", P.slice());
    settling = false;
  };
  el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
  el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });

  placeLabels();
  if (!ctx.url.get("v")) frame(globe.animations && globe.animations.size ? GLIDE : 0);
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (!keys.includes("point")) return;
      const next = normalise(params.point);
      if (next[0] === P[0] && next[1] === P[1] && !settling) return;
      P = next;
      drawPoint();
      placeLabels();
      if (dragging || settling || !booted) { if (drawTw) { drawTw.cancel(); drawTw = null; } drawn = 1; drawArcs(); }
      else drawOn();
      if (!dragging && booted) follow();
      ctx.overlay.update();
    },
    hover() {
      return [];
    },
    probe(lon, lat) {
      ctx.controls.set("point", normalise([lon, lat]));
      return null;
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      if (!camTw && ctx.side === "A") { const f = fitNow(); globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]); }
    },
    unmount() {
      for (const t of [drawTw, camTw]) if (t) t.cancel();
      globe.removePrefix(PREFIX);
      globe.setLayer("graticule", true);
      globe.canvas.style.cursor = "grab";
      ctx.overlay.clear(PREFIX);
    },
  };
}
