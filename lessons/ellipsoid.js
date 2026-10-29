import { lonLatToXYZ } from "@/core/globe.js";
import { WGS84, latitudes } from "@/core/geodesy.js";
import { DEG } from "@/core/math.js";

const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const SERIF = "var(--font-serif)";
const HALO = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => `${x}px ${y}px 1px #faf8f3`).concat("0 0 4px #faf8f3").join(", ");

export const meta = {
  id: "ellipsoid",
  title: "The shape of the Earth",
  track: 1,
  order: 2,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Those angles need a shape to sit on. The Earth spins, so it bulges at the equator and flattens at the poles. Maps use this shape: the ellipsoid.",
  deeper: [
    "The WGS84 flattening is 1/298.257.",
    "At 1× the bulge is about one pixel on this screen.",
    "Map latitude is the angle of the line straight up from the ground. On an ellipsoid that line misses the centre.",
    "GPS uses the WGS84 ellipsoid.",
  ],
  keywords: ["flattening", "ellipsoid", "WGS84", "radius"],
  controls: [
    { key: "exaggerate", type: "range", label: "Exaggerate the flattening", min: 1, max: 60, step: 1, default: 20, unit: "×", ticks: [1, 20, 40, 60] },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: { lon: 15, lat: 0, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
export const X_MAX = 60;
const FIT_PAD = 40;
const CIRCLE_STEPS = 96;

export function radiiKm(e = WGS84) {
  return { a: e.a / 1000, b: e.b / 1000, diff: (e.a - e.b) / 1000 };
}

export function trueValues(phiDeg) {
  const l = latitudes(phiDeg, WGS84);
  return { phi: l.geodetic, psi: l.geocentric, beta: l.parametric };
}

export function radiusKm(latDeg, e = WGS84) {
  const a = e.a, b = e.b, p = latDeg * DEG;
  const c = Math.cos(p), s = Math.sin(p);
  return Math.sqrt(((a * a * c) ** 2 + (b * b * s) ** 2) / ((a * c) ** 2 + (b * s) ** 2)) / 1000;
}

export function squash(bMax) {
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    lonLatToXYZ(lon, lat, out, 1);
    out[1] *= bMax;
    return out;
  };
  fn.phased = false;
  return fn;
}

export function shownB(x, f = WGS84.f) {
  return 1 - f * x;
}

export function silhouette({ width, height, dist, pan = [0, 0], fovDeg = 50, b = 1 }) {
  const F = (height / 2) / Math.tan((fovDeg / 2) * DEG);
  const C = [pan[0], pan[1], dist];
  const L2 = C[0] * C[0] + C[1] * C[1] + C[2] * C[2], L = Math.sqrt(L2);
  const n = C.map((v) => v / L);
  const c = C.map((v) => v / L2);
  const r = Math.sqrt(Math.max(0, 1 - 1 / L2));
  let u = [n[2], 0, -n[0]];
  const ul = Math.hypot(u[0], u[2]) || 1;
  u = u.map((v) => v / ul);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const proj = (p) => {
    const k = F / (dist - p[2]);
    return { x: width / 2 + (p[0] - pan[0]) * k, y: height / 2 - (p[1] - pan[1]) * k };
  };
  const at = (cs, sn) => [c[0] + r * (cs * u[0] + sn * v[0]), c[1] + r * (cs * u[1] + sn * v[1]), c[2] + r * (cs * u[2] + sn * v[2])];
  const circle = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) { const a = (i / CIRCLE_STEPS) * 2 * Math.PI; circle.push(proj(at(Math.cos(a), Math.sin(a)))); }
  const top = at(0, 1);
  return {
    centre: proj(c),
    equator: proj(at(1, 0)),
    pole: proj([top[0], top[1] * b, top[2]]),
    top: proj(top),
    rho: F / Math.sqrt(Math.max(1e-9, L2 - 1)),
    circle,
  };
}

export function poleGapPx(exaggerate, { dist = 2.9, fovDeg = 50, heightPx = 760 } = {}) {
  const s = silhouette({ width: heightPx, height: heightPx, dist, fovDeg, b: shownB(exaggerate) });
  return s.pole.y - s.top.y;
}

export function fitDist({ width, height, fovDeg = 50, pad = FIT_PAD, minDist = meta.view.dist }) {
  const F = (height / 2) / Math.tan((fovDeg / 2) * DEG);
  const rho = Math.max(20, Math.min(width, height) / 2 - pad);
  return Math.max(minDist, Math.sqrt((F / rho) ** 2 + 1));
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const ov = ctx.overlay;
  let params = { ...ctx.params };
  let shownX = ctx.reducedMotion ? params.exaggerate : 0;
  let xTw = null, booted = false;
  const ids = {
    circle: PREFIX + "circle", eq: PREFIX + "eq", pole: PREFIX + "pole", gap: PREFIX + "gap",
    eqLabel: PREFIX + "label-eq", poleLabel: PREFIX + "label-pole", gapLabel: PREFIX + "label-gap",
  };

  let memo = null, memoKey = "";
  const geom = () => {
    const key = [globe.dist, globe.pan[0], globe.pan[1], globe.width, globe.height, shownX].join(",");
    if (key !== memoKey) {
      memoKey = key;
      memo = silhouette({ width: globe.width, height: globe.height, dist: globe.dist, pan: globe.pan, fovDeg: globe.camera.fov, b: shownB(shownX) });
    }
    return memo;
  };
  const live = (fn) => ({ get x() { return fn(geom()).x; }, get y() { return fn(geom()).y; } });
  const mix = (p, q, k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });

  const circlePts = Array.from({ length: CIRCLE_STEPS + 1 }, (_, i) => live((g) => g.circle[i]));
  ov.line(ids.circle, circlePts, { color: INK, width: 1.5, dash: "6 5", opacity: 0.7 });
  ov.line(ids.eq, [live((g) => g.centre), live((g) => g.equator)], { color: BLUE, width: 2.5 });
  ov.line(ids.pole, [live((g) => g.centre), live((g) => g.pole)], { color: BLUE, width: 2.5 });
  ov.line(ids.gap, [live((g) => g.pole), live((g) => g.top)], { color: ORANGE, width: 5 });

  const r = radiiKm();
  const km = (v) => `${Math.round(v).toLocaleString("en-US")} km`;
  const items = [];
  const label = (id, at, text, color, size, dx, dy) => {
    const it = ov.label(id, at, text, { color, dx, dy, mono: false });
    it.el.style.font = `600 ${size}px/1.2 ${SERIF}`;
    it.el.style.textShadow = HALO;
    items.push(it);
  };
  label(ids.eqLabel, live((g) => mix(g.centre, g.equator, 0.3)), km(r.a), BLUE, 16, 6, -26);
  label(ids.poleLabel, live((g) => mix(g.centre, g.pole, 0.5)), km(r.b), BLUE, 16, 10, -10);
  label(ids.gapLabel, live((g) => g.top), km(r.diff), ORANGE, 20, 10, -27);
  if (document.fonts && document.fonts.load) document.fonts.load(`600 20px "Newsreader"`).then(() => {
    for (const it of items) it.w = 0;
    ov.update();
  }).catch(() => {});

  const setX = (x) => {
    shownX = x;
    globe.setMorphT(x / X_MAX);
  };

  const tweenX = (target, duration) => {
    if (xTw) { xTw.cancel(); xTw = null; }
    if (ctx.reducedMotion || duration <= 0) { setX(target); return; }
    xTw = ctx.anim.tween({ from: shownX, to: target, duration, ease: ctx.anim.ease.emph, onUpdate: setX, onDone: () => { xTw = null; } });
  };

  const distNow = () => fitDist({ width: globe.width, height: globe.height, fovDeg: globe.camera.fov });

  const level = () => {
    if (globe.animations && globe.animations.size) return;
    const s = globe.camera.state();
    if (Math.abs(s.lat) > 1e-3 || Math.abs(s.roll) > 1e-3) globe.camera.lookAt(s.lon, 0, null, { duration: 0 });
  };

  globe.setLayer("atmosphere", false);
  globe.camera.lock("yaw");
  globe.morph(squash(shownB(X_MAX)), shownX / X_MAX);

  if (!ctx.url.get("v")) {
    const s = globe.camera.state();
    const lon = globe.animations && globe.animations.size ? meta.view.lon : s.lon;
    globe.camera.lookAt(lon, 0, distNow(), { duration: globe.animations && globe.animations.size && !ctx.reducedMotion ? 650 : 0 });
  }

  ctx.stage.el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const rc = ctx.stage.el.getBoundingClientRect();
    const p = globe.pick(e.clientX - rc.left, e.clientY - rc.top);
    if (p) globe.camera.lookAt(p.lon, 0, null, { duration: 650 });
  }, { capture: true, signal: ctx.signal });

  setTimeout(() => {
    if (ctx.signal.aborted) return;
    booted = true;
    level();
    tweenX(params.exaggerate, 1100);
  }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (booted && keys.includes("exaggerate")) tweenX(params.exaggerate, 480);
    },
    hover(lon, lat) {
      return [`${radiusKm(lat).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km from the centre`];
    },
    probe() {
      return null;
    },
    unprobe() {},
    resize() {
      const s = globe.camera.state();
      globe.camera.lookAt(s.lon, 0, distNow(), { duration: 0 });
    },
    unmount() {
      if (xTw) xTw.cancel();
      ov.clear(PREFIX);
      globe.removePrefix(PREFIX);
      globe.camera.lock(null);
      globe.morph(null, 0);
      globe.setLayer("atmosphere", true);
    },
  };
}
