import { lonLatToXYZ } from "@/core/globe.js";
import { inverse, sphereDistance, geodesicPoints, WGS84, R_MEAN } from "@/core/geodesy.js";
import { vec3 } from "@/core/math.js";

const ORANGE = "#b85217";
const INK = "#1a1917";
const SERIF = "var(--font-serif)";
const HALO = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => `${x}px ${y}px 1px #faf8f3`).concat("0 0 4px #faf8f3").join(", ");
export const LONDON = [-0.1278, 51.5074];
export const TOKYO = [139.6503, 35.6762];

export const meta = {
  id: "geodesic-distance",
  title: "Measuring distance",
  track: 1,
  order: 6,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Many tools measure distance on a sphere. The Earth is an ellipsoid, so the result is a little wrong. The true shortest path is the geodesic.",
  deeper: [
    "On a sphere, the shortest path is a great circle.",
    "The sphere is wrong by up to about 0.6 %.",
    "The solver (GeographicLib) is accurate to 15 nanometres.",
  ],
  keywords: ["geodesic", "great circle", "distance", "ellipsoid", "sphere"],
  controls: [
    { key: "A", type: "point", label: "Point A", default: LONDON },
    { key: "B", type: "point", label: "Point B", default: TOKYO },
  ],
  readouts: [
    { key: "sphere", label: "On a sphere", digits: 1, unit: "km" },
    { key: "diff", label: "Sphere error", digits: 1, unit: "km", hero: true },
  ],
  transport: null,
  compare: null,
  view: { lon: 89.6, lat: 69, dist: 2.3 },
  data: [],
};

const PREFIX = meta.id + ":";
const N_SEG = 128;
const LINE_R = 1.004;
const GLIDE = 650;
const MAX_DIST = 6;
const DEG = Math.PI / 180;

export function solve(A, B) {
  const ellipsoid = inverse(A[0], A[1], B[0], B[1], WGS84).s12 / 1000;
  const sphere = sphereDistance(A[0], A[1], B[0], B[1], R_MEAN) / 1000;
  return { ellipsoid, sphere, diff: sphere - ellipsoid };
}

const same = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;

export function pinNames(A, B) {
  return same(A, LONDON) && same(B, TOKYO) ? ["London", "Tokyo"] : ["A", "B"];
}

export const kmLabel = (km) => `${Math.round(km).toLocaleString("en-US")} km`;

export function labelSpot(pts) {
  const xyz = pts.map((p) => lonLatToXYZ(p[0], p[1], [0, 0, 0], LINE_R));
  const m = Math.floor(xyz.length / 2);
  const mid = xyz[m];
  const t = vec3.sub(xyz[Math.min(m + 1, xyz.length - 1)], xyz[Math.max(m - 1, 0)]);
  let side = vec3.cross(mid, t);
  const len = vec3.length(side);
  side = len > 1e-12 ? vec3.scale(side, 1 / len) : [0, 1, 0];
  const chord = vec3.normalize(vec3.add(xyz[0], xyz[xyz.length - 1]));
  if (vec3.dot(side, vec3.sub(mid, chord)) < 0) side = vec3.scale(side, -1);
  return { point: mid, away: vec3.sub(mid, vec3.scale(side, 0.05)) };
}

export function horizonDist(pts) {
  const mid = pts[Math.floor(pts.length / 2)];
  const c = lonLatToXYZ(mid[0], mid[1], [0, 0, 0], 1);
  let h = 0;
  for (const p of [pts[0], pts[pts.length - 1]]) h = Math.max(h, vec3.angle(c, lonLatToXYZ(p[0], p[1], [0, 0, 0], 1)));
  return 1 / Math.cos(Math.min(h + 6 * DEG, 84 * DEG));
}

export function slerpQ(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  d = Math.abs(d);
  let wa, wb;
  if (d > 0.9995) { wa = 1 - t; wb = t; }
  else { const th = Math.acos(d), sn = Math.sin(th); wa = Math.sin((1 - t) * th) / sn; wb = Math.sin(t * th) / sn; }
  const q = [0, 1, 2, 3].map((i) => wa * a[i] + wb * s * b[i]);
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let pts = geodesicPoints(params.A, params.B, N_SEG, WGS84);
  let drawTw = null, camTw = null, dragging = null, booted = false, fromDrag = false;
  const ids = { line: PREFIX + "line", A: PREFIX + "A", B: PREFIX + "B", dist: PREFIX + "dist" };

  const segments = () => {
    const xyz = pts.map((p) => lonLatToXYZ(p[0], p[1], [0, 0, 0], LINE_R));
    const out = [];
    for (let i = 1; i < xyz.length; i++) out.push([xyz[i - 1], xyz[i]]);
    return out;
  };
  const line = globe.addSegments3D(ids.line, segments(), { color: ORANGE, width: 3, depth: true, order: 3 });
  const setDrawn = (f) => { line.geometry.instanceCount = Math.max(1, Math.round(N_SEG * f)); globe.invalidate(); };

  const distLabel = globe.addLabel3D(ids.dist, null, "", { color: ORANGE, gap: 10, occlude: true });
  distLabel.el.classList.remove("mono");
  distLabel.el.style.font = `600 20px/1.2 ${SERIF}`;
  distLabel.el.style.textShadow = HALO;

  const styleName = (it) => {
    const lab = it && it.el && it.el.querySelector(".pin-label");
    if (!lab) return;
    lab.classList.remove("mono");
    lab.style.font = `600 17px/22px ${SERIF}`;
    lab.style.color = INK;
    lab.style.textShadow = HALO;
    it.w = 0;
  };
  const names = () => pinNames(params.A, params.B);
  const placePins = () => {
    const n = names();
    for (const [k, i] of [["A", 0], ["B", 1]]) {
      const it = ctx.overlay.items.get(ids[k]);
      const lab = it && it.el.querySelector(".pin-label");
      if (lab && lab.textContent === n[i]) ctx.overlay.move(ids[k], { lon: params[k][0], lat: params[k][1] });
      else styleName(ctx.overlay.pin(ids[k], { lon: params[k][0], lat: params[k][1] }, { color: INK, label: n[i], size: 12 }));
    }
  };

  const readouts = () => {
    const r = solve(params.A, params.B);
    ctx.readout.setMany({ sphere: r.sphere, diff: r.diff });
    globe.setLabel3D(ids.dist, { ...labelSpot(pts), text: kmLabel(r.ellipsoid) });
  };

  const redraw = () => {
    pts = geodesicPoints(params.A, params.B, N_SEG, WGS84);
    globe.setSegments3D(ids.line, segments());
    placePins();
    readouts();
  };

  const drawOn = () => {
    if (drawTw) drawTw.cancel();
    if (ctx.reducedMotion || !booted) { setDrawn(1); return; }
    setDrawn(0);
    drawTw = ctx.anim.tween({ from: 0, to: 1, duration: 300, ease: ctx.anim.ease.out, onUpdate: setDrawn, onDone: () => { drawTw = null; } });
  };

  const stopCam = () => { if (camTw) { globe.animations.delete(camTw); camTw = null; } };

  const frame = (duration) => {
    if (ctx.side !== "A") return;
    stopCam();
    const m = pts[Math.floor(pts.length / 2)];
    const s0 = globe.camera.state();
    globe.camera.setState({ lon: ((m[0] + 540) % 360) - 180, lat: m[1], roll: 0 });
    const q1 = globe.camera.state().q;
    const xyz = pts.map((p) => lonLatToXYZ(p[0], p[1], [0, 0, 0], 1));
    const f = globe.camera.fit(xyz, { padding: 90, insetTop: 24, insetBottom: ctx.stage.insetBottom, minDist: 1.6, apply: false });
    const d1 = Math.min(Math.max(f.dist, horizonDist(pts)), MAX_DIST);
    const p1 = d1 === f.dist ? f.pan : [0, 0];
    if (ctx.reducedMotion || duration <= 0) { globe.camera.setState({ q: q1, pan: p1, dist: d1 }); ctx.overlay.update(); return; }
    globe.camera.setState({ q: s0.q });
    const q0 = s0.q, d0 = s0.dist, p0 = s0.pan, t0 = performance.now();
    const ease = ctx.anim.ease.emph;
    camTw = (now) => {
      const u = Math.min(1, (now - t0) / duration), e = ease(u);
      const q = slerpQ(q0, q1, e);
      globe.group.quaternion.set(q[0], q[1], q[2], q[3]);
      globe.camera.setPan(p0[0] + (p1[0] - p0[0]) * e, p0[1] + (p1[1] - p0[1]) * e);
      globe.camera.setDist(d0 + (d1 - d0) * e);
      if (u >= 1) { globe.animations.delete(camTw); camTw = null; }
    };
    globe.animations.add(camTw);
    globe.invalidate();
  };

  const offDrag = globe.on("drag", stopCam);
  const offWheel = globe.on("wheel", stopCam);

  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pinAt = (x, y) => {
    for (const k of ["A", "B"]) { const s = globe.project(params[k][0], params[k][1]); if (s.visible && Math.hypot(s.x - x, s.y - y) < 14) return k; }
    return null;
  };
  const el = ctx.stage.el;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || ctx.side !== "A") return;
    const [x, y] = stagePos(e);
    const k = pinAt(x, y);
    if (!k) return;
    e.stopPropagation(); e.preventDefault();
    stopCam();
    dragging = { id: e.pointerId, k };
    ctx.overlay.hideChip();
    globe.canvas.style.cursor = "grabbing";
  }, { capture: true, signal: ctx.signal });
  el.addEventListener("pointermove", (e) => {
    const [x, y] = stagePos(e);
    if (!dragging) { if (pinAt(x, y)) globe.canvas.style.cursor = "grab"; return; }
    if (e.pointerId !== dragging.id) return;
    e.stopPropagation();
    const p = globe.pick(x, y);
    if (p) ctx.controls.set(dragging.k, [+p.lon.toFixed(4), +p.lat.toFixed(4)], { live: true });
  }, { capture: true, signal: ctx.signal });
  const end = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    e.stopPropagation();
    const k = dragging.k;
    dragging = null;
    globe.canvas.style.cursor = "grab";
    fromDrag = true;
    ctx.controls.set(k, params[k].slice());
    fromDrag = false;
  };
  el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
  el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });

  placePins();
  readouts();
  setDrawn(1);
  const v = meta.view, s = globe.camera.state();
  const atRest = Math.abs(s.lon - v.lon) < 0.05 && Math.abs(s.lat - v.lat) < 0.05 && Math.abs(s.dist - v.dist) < 0.01;
  frame(atRest ? 0 : GLIDE);
  if (document.fonts && document.fonts.load) document.fonts.load(`600 20px "Newsreader"`).then(() => {
    if (!ctx.signal.aborted) { distLabel.w = 0; placePins(); globe.invalidate(); }
  }).catch(() => {});
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (!keys.some((k) => k === "A" || k === "B")) return;
      redraw();
      if (dragging || !booted) return;
      if (!fromDrag) drawOn();
      frame(GLIDE);
    },
    resize() { frame(0); },
    unmount() {
      if (drawTw) drawTw.cancel();
      stopCam();
      offDrag(); offWheel();
      globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
    },
  };
}
