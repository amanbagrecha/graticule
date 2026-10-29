import { morphs, lonLatToXYZ, xyzToLonLat } from "@/core/globe.js";
import { aspectFrame, aspectRotation, rotatedLonLat, unrotatedLonLat } from "@/core/projections.js";
import { DEG, vec3, clamp, slerp } from "@/core/math.js";

const BRASS = "#b85217";
const LABEL = "#8a3a0c";
const INK = "rgba(63,60,55,.55)";

export const EARTH_KM = 6371;

export function aspectName(tilt) {
  return tilt <= 0 ? "Normal" : tilt >= 90 ? "Transverse" : "Oblique";
}

export const meta = {
  id: "turn-the-cylinder",
  title: "Transverse and oblique maps",
  track: 2,
  order: 6,
  mode: "3d",
  renderer: "webgl",
  paragraph: "The map is true only on the line where the cylinder touches the globe. Turn the cylinder so that this line goes through your area. Drag the axis end to turn it. Next, you see world maps from formulas.",
  deeper: [
    "UTM uses 60 transverse cylinders, one for each 6° of longitude. Centre longitude 15° gives UTM zone 33.",
    "The Swiss national grid uses an oblique cylinder centred on Bern.",
    "1,000 km from the touching line, lengths on the map are 1.2 % too long.",
    "Twice as far, the error is about four times as big.",
  ],
  keywords: ["transverse", "oblique", "cylinder", "aspect"],
  controls: [
    { key: "tilt", type: "range", label: "Tilt", min: 0, max: 90, step: 1, default: 90, unit: "°", format: (v) => `${aspectName(v)} ${v}`, ticks: [0, 45, 90], tickFormat: String },
    { key: "lon0", type: "range", label: "Centre longitude", min: -180, max: 180, step: 1, default: 15, unit: "°", fillFrom: 0, ticks: [-180, -90, 0, 90, 180] },
  ],
  readouts: [],
  transport: { label: ["globe", "flat"], key: "m" },
  compare: null,
  view: { lon: 20, lat: 18, dist: 3.4 },
  data: [],
};

const PREFIX = meta.id + ":";
const TURN_MS = 650;
const TWEEN_MIN = 8 * DEG;
const FIT_PADDING = 28;
const CYL_H = 1.25;
const TIP = CYL_H + 0.45;
const GENERATORS = 24;
const GRAB_PX = 18;
const LABEL_TEXT = "Touching line: map is true here";

const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;

export function frameOf({ lon0 = 15, tilt = 90 } = {}) {
  return aspectFrame({ aspect: "oblique", lon0, tilt, azimuth: 90 });
}

export function axisOf(p) {
  return lonLatToXYZ(...frameOf(p).pole);
}

export function paramsFromAxis(v) {
  let [lon, lat] = xyzToLonLat(v[0], v[1], v[2]);
  if (lat < 0) { lat = -lat; lon += 180; }
  const lon0 = wrapLon(Math.round(lon - 90));
  return { lon0: lon0 === 180 ? -180 : lon0, tilt: clamp(Math.round(90 - lat), 0, 90) };
}

export function tipFromRay(origin, dir, radius, near) {
  const d = vec3.normalize(dir);
  const b = vec3.dot(origin, d), c = vec3.dot(origin, origin) - radius * radius, disc = b * b - c;
  if (disc < 0) return vec3.normalize(vec3.sub(origin, vec3.scale(d, b)));
  const s = Math.sqrt(disc);
  const p1 = vec3.normalize(vec3.add(origin, vec3.scale(d, -b - s)));
  const p2 = vec3.normalize(vec3.add(origin, vec3.scale(d, -b + s)));
  return vec3.dot(p1, near) >= vec3.dot(p2, near) ? p1 : p2;
}

export function cylinderMorph(rotation) {
  const core = morphs.toAspectCylinder({ rotate: rotation, rule: "conformal", latMax: 85 });
  const cart = (ll) => [Math.cos(ll[1] * DEG) * Math.cos(ll[0] * DEG), Math.cos(ll[1] * DEG) * Math.sin(ll[0] * DEG), Math.sin(ll[1] * DEG)];
  const a = cart(rotatedLonLat(rotation, 0, 0)), b = cart(rotatedLonLat(rotation, 90, 0)), c = cart(rotatedLonLat(rotation, 0, 90));
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    const p = lat * DEG, l = lon * DEG, cp = Math.cos(p);
    const x = cp * Math.cos(l), y = cp * Math.sin(l), z = Math.sin(p);
    const Z = a[2] * x + b[2] * y + c[2] * z;
    return core.rotated(Math.atan2(a[1] * x + b[1] * y + c[1] * z, a[0] * x + b[0] * y + c[0] * z) / DEG, Math.asin(Z > 1 ? 1 : Z < -1 ? -1 : Z) / DEG, t, out);
  };
  return Object.assign(fn, core);
}

export function kAt(rotation, lon, lat) {
  return 1 / Math.cos(rotatedLonLat(rotation, lon, lat)[1] * DEG);
}

export function errorPct(rotation, lon, lat) {
  return (kAt(rotation, lon, lat) - 1) * 100;
}

export function kmFromLine(rotation, lon, lat) {
  return Math.abs(rotatedLonLat(rotation, lon, lat)[1]) * DEG * EARTH_KM;
}

export function hoverLines(rotation, lon, lat) {
  const e = errorPct(rotation, lon, lat);
  const km = Math.round(kmFromLine(rotation, lon, lat) / 10) * 10;
  const first = e < 0.005 ? "Lengths true here" : `Lengths ${e.toFixed(e < 1 ? 2 : e < 10 ? 1 : 0)} % too long here`;
  return [first, `${km.toLocaleString("en-US")} km from the touching line`];
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let frame = frameOf(params);
  let rotation = aspectRotation(frame);
  let shown = { pole: lonLatToXYZ(...frame.pole), centre: lonLatToXYZ(...frame.centre) };
  let turnTween = null;
  let settled = false;
  let oriented = false;
  let dragging = null;
  let committing = false;
  let inertiaRaf = 0;

  const ids = { gens: PREFIX + "generators", rims: PREFIX + "rims", axis: PREFIX + "axis", tips: PREFIX + "tips", line: PREFIX + "contact", label: PREFIX + "line-label" };
  globe.addSegments3D(ids.gens, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(63,60,55,.28)", width: 1 });
  globe.addSegments3D(ids.rims, [[[0, 0, 0], [0, 0, 0]]], { color: INK, width: 1.5 });
  globe.addSegments3D(ids.axis, [[[0, 0, 0], [0, 0, 0]]], { color: "rgba(63,60,55,.6)", width: 1.25, dash: [6, 4] });
  globe.addPoints3D(ids.tips, [[0, 0, 0]], { color: BRASS, size: 13 });
  globe.labelInsetBottom = ctx.stage.insetBottom;
  globe.addLabel3D(ids.label, null, LABEL_TEXT, { color: LABEL, away: [0, 0, 0], gap: 14, occlude: true });

  const setMorph = () => {
    globe.morph(cylinderMorph(rotation), t);
  };

  const drawLine = () => {
    const segs = [];
    let prev = null;
    for (let lon = -180; lon <= 180; lon += 2) {
      const ll = unrotatedLonLat(rotation, lon, 0);
      if (prev) segs.push([prev, ll]);
      prev = ll;
    }
    globe.addLines(ids.line, segs, { color: BRASS, width: 3, depth: true });
  };

  const placeLabel = () => {
    const toCam = vec3.scale(globe.ray(ctx.stage.width / 2, (ctx.stage.height - ctx.stage.insetBottom) / 2).dir, -1);
    let best = null, bestY = Infinity;
    for (let lon = -180; lon < 180; lon += 4) {
      const ll = unrotatedLonLat(rotation, lon, 0), p = lonLatToXYZ(ll[0], ll[1]);
      if (vec3.dot(p, toCam) < 0.25) continue;
      const s = globe.projectPoint(p, false);
      if (s.y < bestY) { bestY = s.y; best = ll; }
    }
    const fn = globe.morphFn;
    const point = best ? (fn && t > 0 ? [...fn(best[0], best[1], t, [0, 0, 0])] : lonLatToXYZ(best[0], best[1])) : null;
    globe.setLabel3D(ids.label, { point, away: t > 0.5 ? null : [0, 0, 0], dx: 12, dy: -26 });
  };

  const drawCylinder = () => {
    const Q = shown.pole, C = shown.centre, E = vec3.cross(Q, C);
    const fade = clamp(1 - (t - 0.3) / 0.15, 0, 1);
    const ring = (h) => {
      const segs = [];
      let prev = null;
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        const p = vec3.add(vec3.scale(Q, h), vec3.add(vec3.scale(C, Math.cos(a)), vec3.scale(E, Math.sin(a))));
        if (prev) segs.push([prev, p]);
        prev = p;
      }
      return segs;
    };
    const gens = [];
    for (let i = 0; i < GENERATORS; i++) {
      const a = (i / GENERATORS) * Math.PI * 2;
      const r = vec3.add(vec3.scale(C, Math.cos(a)), vec3.scale(E, Math.sin(a)));
      gens.push([vec3.add(r, vec3.scale(Q, -CYL_H)), vec3.add(r, vec3.scale(Q, CYL_H))]);
    }
    globe.setSegments3D(ids.gens, gens, { opacity: 0.28 * fade });
    globe.setSegments3D(ids.rims, [...ring(CYL_H), ...ring(-CYL_H)], { opacity: 0.55 * fade });
    globe.setSegments3D(ids.axis, [[vec3.scale(Q, -TIP), vec3.scale(Q, TIP)]], { opacity: 0.6 * fade });
    globe.setPoints3D(ids.tips, [vec3.scale(Q, TIP), vec3.scale(Q, -TIP)]);
    for (const id of [ids.gens, ids.rims, ids.axis, ids.tips]) globe.setLayer(id, fade > 0);
  };

  const viewUp = () => {
    if (params.tilt <= 45) return shown.pole;
    const E = vec3.cross(shown.pole, shown.centre);
    return E[1] < 0 ? vec3.scale(E, -1) : E;
  };

  const fitPoints = () => {
    const pts = [];
    const out = [0, 0, 0];
    const fn = globe.morphFn;
    for (let lat = -90; lat <= 90; lat += 10) for (let lon = -180; lon <= 180; lon += 15) { fn.rotated(clamp(lon, -179.99, 179.99), lat, t, out); pts.push([out[0], out[1], out[2]]); }
    if (t < 0.45) {
      const Q = shown.pole, C = shown.centre, E = vec3.cross(Q, C);
      pts.push(vec3.scale(Q, TIP), vec3.scale(Q, -TIP));
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const r = vec3.add(vec3.scale(C, Math.cos(a)), vec3.scale(E, Math.sin(a))); pts.push(vec3.add(r, vec3.scale(Q, CYL_H)), vec3.add(r, vec3.scale(Q, -CYL_H))); }
    }
    return pts;
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t > 0 && !oriented) {
      oriented = true;
      globe.camera.orient(shown.centre, viewUp(), { duration: settled && !ctx.reducedMotion ? 500 : 0 });
    }
    if (t <= 0) oriented = false;
    const f = globe.camera.fit(fitPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  const turnTo = () => {
    const toFrame = frameOf(params);
    const toRot = aspectRotation(toFrame);
    const Q1 = lonLatToXYZ(...toFrame.pole), C1 = lonLatToXYZ(...toFrame.centre);
    const Q0 = shown.pole, C0 = shown.centre;
    frame = toFrame;
    if (turnTween) { turnTween.cancel(); turnTween = null; }
    const finish = () => {
      shown = { pole: Q1, centre: C1 };
      rotation = toRot;
      setMorph(); drawLine(); drawCylinder(); placeLabel();
      if (t > 0) oriented = false;
      if (!dragging) frameCamera();
      ctx.overlay.update();
    };
    const step = Math.max(Math.acos(clamp(Math.abs(vec3.dot(Q0, Q1)), -1, 1)), Math.acos(clamp(vec3.dot(C0, C1), -1, 1)));
    if (!settled || ctx.reducedMotion || dragging || step < TWEEN_MIN) { finish(); return; }
    const flip = vec3.dot(Q0, Q1) < 0 ? -1 : 1;
    turnTween = ctx.anim.tween({ from: 0, to: 1, duration: TURN_MS, ease: ctx.anim.ease.emph, onUpdate: (u) => {
      const Q = vec3.normalize(slerp(Q0, vec3.scale(Q1, flip), u));
      let C = slerp(C0, C1, u);
      C = vec3.normalize(vec3.sub(C, vec3.scale(Q, vec3.dot(C, Q))));
      shown = { pole: Q, centre: C };
      rotation = aspectRotation({ pole: xyzToLonLat(...Q), centre: xyzToLonLat(...C) });
      if (t > 0) setMorph();
      drawLine(); drawCylinder();
      if (t > 0) globe.camera.orient(shown.centre, viewUp(), { duration: 0 });
      ctx.overlay.update();
    }, onDone: () => { turnTween = null; finish(); } });
  };

  const followInertia = () => {
    cancelAnimationFrame(inertiaRaf);
    const step = () => { placeLabel(); inertiaRaf = globe.inertia ? requestAnimationFrame(step) : 0; };
    inertiaRaf = requestAnimationFrame(step);
  };
  const offs = [globe.on("drag", placeLabel), globe.on("wheel", placeLabel), globe.on("dragend", followInertia)];

  if (ctx.side === "A") {
    const el = ctx.stage.el;
    const stagePos = (e) => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const grabbedTip = (x, y) => {
      if (t >= 0.3) return 0;
      let best = 0, bestD = GRAB_PX;
      for (const sign of [1, -1]) {
        const s = globe.projectPoint(vec3.scale(shown.pole, sign * TIP), false);
        const d = Math.hypot(s.x - x, s.y - y);
        if (isFinite(d) && d < bestD) { bestD = d; best = sign; }
      }
      return best;
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const [x, y] = stagePos(e);
      const sign = grabbedTip(x, y);
      if (!sign) return;
      e.stopPropagation(); e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragging = { id: e.pointerId, sign, dir: null, start: { lon0: params.lon0, tilt: params.tilt } };
      if (turnTween) turnTo();
      dragging.dir = vec3.scale(shown.pole, sign);
      ctx.overlay.hideChip();
      globe.canvas.style.cursor = "grabbing";
    }, { capture: true, signal: ctx.signal });
    el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const [x, y] = stagePos(e);
      const ray = globe.ray(x, y);
      dragging.dir = tipFromRay(ray.origin, ray.dir, TIP, dragging.dir);
      const next = paramsFromAxis(vec3.scale(dragging.dir, dragging.sign));
      if (next.lon0 === params.lon0 && next.tilt === params.tilt) return;
      ctx.controls.set("lon0", next.lon0, { silent: true });
      ctx.controls.set("tilt", next.tilt, { silent: true });
      params.lon0 = next.lon0; params.tilt = next.tilt;
      turnTo();
    }, { capture: true, signal: ctx.signal });
    const end = (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      e.stopPropagation();
      const { start } = dragging;
      dragging = null;
      globe.canvas.style.cursor = "grab";
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (start.lon0 !== params.lon0 || start.tilt !== params.tilt) {
        committing = true;
        ctx.controls.set("tilt", params.tilt);
        committing = false;
      }
      frameCamera();
    };
    el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
    el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });
  }

  setMorph();
  drawLine();
  drawCylinder();

  if (ctx.transport) ctx.transport.onScrub((value) => {
    t = value;
    globe.setMorphT(t);
    drawCylinder();
    frameCamera();
    placeLabel();
    ctx.overlay.update();
    settled = true;
  });

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (committing || !settled) return;
      if (keys.length === 0 || keys.includes("lon0") || keys.includes("tilt")) turnTo();
    },
    hover(lon, lat) {
      return hoverLines(rotation, lon, lat);
    },
    probe() {
      return null;
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      frameCamera();
      placeLabel();
    },
    unmount() {
      if (turnTween) turnTween.cancel();
      cancelAnimationFrame(inertiaRaf);
      for (const off of offs) off();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      ctx.overlay.clear(PREFIX);
    },
  };
}
