import { registry, tissot, factors } from "@/core/projections.js";
import { ellipsePath, smallCircle, onVisibleSide, drawCaption, projectionOptions } from "@/core/map2d.js";
import { DEG, clamp } from "@/core/math.js";

export const meta = {
  id: "tissot",
  title: "Circles that tell the truth",
  track: 3,
  order: 1,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "mercator",
  labels: false,
  paragraph: "Draw equal small circles over the globe. Project them. Each becomes an ellipse. The ellipse tells the whole story at that point. Its long and short axes are the largest and smallest scale. Round means conformal. Equal area means equal-area. No map can be both.",
  deeper: [
    "a·b = 1 everywhere on an equal-area map.",
    "a = b everywhere on a conformal map.",
    "ω = 2·asin(|a − b|/(a + b)).",
    "The ellipse is the image of a circle under the local linear map.",
  ],
  keywords: ["Tissot", "indicatrix", "distortion", "ellipse"],
  controls: [
    { key: "projection", type: "select", label: "Projection", options: projectionOptions(), default: "mercator" },
    { key: "mode", type: "segment", label: "Mode", options: [{ value: "indicatrix", label: "Indicatrix" }, { value: "circle", label: "Projected circle" }], default: "indicatrix" },
    { key: "radius", type: "range", label: "Radius", min: 1, max: 5, step: 0.5, default: 2.5, unit: "°", ticks: [1, 2.5, 5] },
    { key: "spacing", type: "segment", label: "Spacing", options: [{ value: "10", label: "10°" }, { value: "15", label: "15°" }, { value: "30", label: "30°" }], default: "15" },
    { key: "fill", type: "toggle", label: "Fill", default: true, shortcut: "f" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "Ellipse, filled when not conformal" }, { color: "#1d63a8", line: true, label: "Round: stroke only (conformal)" }, { color: "#b85217", label: "Readout point with a and b axes" }] },
  ],
  readouts: [
    { key: "a", label: "a (max scale)", digits: 3, hero: true },
    { key: "b", label: "b (min scale)", digits: 3 },
    { key: "ab", label: "a·b (area)", digits: 3 },
    { key: "omega", label: "ω", digits: 2, unit: "°" },
  ],
  transport: null,
  compare: { key: "projection", value: "cylindricalEqualArea" },
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const LAT_MAX = { 10: 80, 15: 75, 30: 60 };
export const HOME = [0, 60];
const INSET_TOP = 44;

export function omegaOf(a, b) {
  return 2 * Math.asin(clamp(Math.abs(a - b) / (a + b), 0, 1)) / DEG;
}

export function isConformal(f, tol = 0.25) {
  return f.omega < tol;
}

export function gridPoints(spacing) {
  const s = Number(spacing);
  const latMax = LAT_MAX[s] ?? 75;
  const pts = [];
  for (let lat = -latMax; lat <= latMax + 1e-9; lat += s) for (let lon = -180 + s; lon < 180 - 1e-9; lon += s) pts.push([lon, lat]);
  return pts;
}

export function distortionAt(projection, lon, lat) {
  const f = factors(projection, lon, lat);
  if (!f || !isFinite(f.a) || !isFinite(f.b)) return null;
  return { a: f.a, b: f.b, ab: f.areaScale, omega: f.omega, h: f.h, k: f.k };
}

export async function mount(ctx) {
  const palette = ctx.palette;
  const brass = palette.ui.brass;
  const accent = ctx.side === "B" ? palette.ui.violet : palette.ui.signal;
  const accentSoft = ctx.side === "B" ? "rgba(112,70,166,.18)" : "rgba(29,99,168,.2)";
  const map = ctx.stage.map;
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let probed = null;
  let hovered = null;
  let enter = 1;
  let enterTween = null;
  let fade = 1;

  const spacing = () => Number(params.spacing) || 15;
  const point = () => probed || { lon: HOME[0], lat: HOME[1] };
  const entry = () => registry.get(params.projection) || registry.get("mercator");

  const runEnter = () => {
    if (enterTween) enterTween.cancel();
    if (ctx.reducedMotion) { enter = 1; return; }
    enter = 0;
    enterTween = ctx.anim.tween({ from: 0, to: 1, duration: 560, ease: ctx.anim.ease.linear, onUpdate: (v) => { enter = v; if (map) map.invalidate(); } });
  };

  const scaleFor = (lat) => {
    if (enter >= 1) return 1;
    const delay = (Math.abs(lat) / 80) * 0.46;
    return ctx.anim.ease.out(clamp((enter - delay) / 0.54, 0, 1));
  };

  const visible = (projection, lon, lat) => onVisibleSide(projection, lon, lat, params.radius);

  const drawGrid = (g, path, projection) => {
    const conformalMap = entry().property === "conformal";
    g.lineJoin = "round";
    for (const [lon, lat] of gridPoints(spacing())) {
      const s = scaleFor(lat);
      if (s <= 0.001 || !visible(projection, lon, lat)) continue;
      const f = factors(projection, lon, lat);
      if (!f) continue;
      const conf = conformalMap || isConformal(f);
      if (params.mode === "indicatrix") {
        const e = tissot(projection, lon, lat, params.radius);
        if (!e || !isFinite(e.rx) || e.rx > 4000) continue;
        ellipsePath(g, e, s);
      } else {
        g.beginPath();
        path({ type: "Polygon", coordinates: [smallCircle(lon, lat, params.radius * s, 48)] });
      }
      if (params.fill && !conf) { g.globalAlpha = fade; g.fillStyle = accentSoft; g.fill(); }
      g.globalAlpha = fade * (conf ? 1 : 0.9);
      g.strokeStyle = "rgba(250,248,243,.55)";
      g.lineWidth = 2.6;
      g.stroke();
      g.strokeStyle = accent;
      g.lineWidth = conf ? 1.4 : 1.1;
      g.stroke();
      if (hovered && hovered[0] === lon && hovered[1] === lat) {
        g.globalAlpha = 1;
        g.strokeStyle = palette.ui.ink;
        g.lineWidth = 1.8;
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  };

  const drawAxes = (g, e, f) => {
    const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
    const ends = [[e.x - e.rx * ca, e.y - e.rx * sa, e.x + e.rx * ca, e.y + e.rx * sa], [e.x + e.ry * sa, e.y - e.ry * ca, e.x - e.ry * sa, e.y + e.ry * ca]];
    g.setLineDash([4, 3]);
    g.lineWidth = 1.2;
    g.strokeStyle = brass;
    for (const [x0, y0, x1, y1] of ends) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.setLineDash([]);
    g.font = "600 11px JetBrains Mono, ui-monospace, monospace";
    g.textBaseline = "middle";
    const tag = (x, y, dx, dy, text) => {
      const n = Math.hypot(dx, dy) || 1;
      const tx = x + (dx / n) * 14, ty = y + (dy / n) * 14;
      g.textAlign = dx > 0.3 ? "left" : dx < -0.3 ? "right" : "center";
      g.lineWidth = 3;
      g.strokeStyle = "rgba(250,248,243,.85)";
      g.strokeText(text, tx, ty);
      g.fillStyle = brass;
      g.fillText(text, tx, ty);
    };
    tag(ends[0][2], ends[0][3], ca, sa, "a " + f.a.toFixed(3));
    tag(ends[1][0], ends[1][1], sa, -ca, "b " + f.b.toFixed(3));
  };

  const drawPoint = (g, path, projection) => {
    const p = point();
    if (!visible(projection, p.lon, p.lat)) return;
    const e = tissot(projection, p.lon, p.lat, params.radius);
    const f = factors(projection, p.lon, p.lat);
    if (!e || !f || e.rx > 4000) return;
    if (params.mode === "indicatrix") ellipsePath(g, e, scaleFor(p.lat));
    else { g.beginPath(); path({ type: "Polygon", coordinates: [smallCircle(p.lon, p.lat, params.radius * scaleFor(p.lat), 64)] }); }
    g.fillStyle = "rgba(184,82,23,.22)";
    g.fill();
    g.strokeStyle = "rgba(250,248,243,.6)";
    g.lineWidth = 3.2;
    g.stroke();
    g.strokeStyle = brass;
    g.lineWidth = 1.8;
    g.stroke();
    if (enter >= 1) drawAxes(g, e, f);
  };

  const caption = () => {
    const e = entry();
    const what = { conformal: "Conformal: every ellipse is round.", "equal-area": "Equal-area: every ellipse has the same area.", equidistant: "Equidistant: true scale along some lines.", compromise: "Compromise: no property is kept exactly.", perspective: "Perspective: no property is kept exactly." }[e.property] || "";
    return [e.name, what];
  };

  const build2d = () => {
    map.addLayer(PREFIX + "veil", (g) => { g.fillStyle = "rgba(250,248,243,.28)"; g.fillRect(0, 0, map.width, map.height); }, { order: 46 });
    map.addLayer(PREFIX + "ellipses", (g, path, projection) => {
      drawGrid(g, path, projection);
      drawPoint(g, path, projection);
    }, { order: 50 });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, ctx.side === "B" ? map.width - 20 : 20, 16, caption(), { accent, align: ctx.side === "B" ? "right" : "left" }), { order: 90, clip: false });
  };

  const build3d = () => {
    const segs = [];
    for (const [lon, lat] of gridPoints(spacing())) {
      const ring = smallCircle(lon, lat, params.radius, 36);
      for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    }
    globe.addLines(PREFIX + "circles", segs, { color: accent, width: 1.2, depth: true });
    buildPoint3d();
  };

  const buildPoint3d = () => {
    const p = point();
    const segs = [];
    for (const r of [params.radius * 1.12, params.radius * 1.2]) {
      const ring = smallCircle(p.lon, p.lat, r, 64);
      for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    }
    globe.addLines(PREFIX + "point", segs, { color: brass, width: 2, depth: true });
  };

  const readAt = (lon, lat) => {
    if (!map) return { a: 1, b: 1, ab: 1, omega: 0 };
    const r = distortionAt(map.projection, lon, lat);
    return r ? { a: r.a, b: r.b, ab: r.ab, omega: r.omega } : null;
  };

  const readouts = () => {
    const p = point();
    const r = readAt(p.lon, p.lat);
    if (r) ctx.readout.setMany(r);
  };

  const hitEllipse = (x, y) => {
    if (!map) return null;
    const projection = map.projection;
    let best = null, bd = Infinity;
    for (const [lon, lat] of gridPoints(spacing())) {
      if (!visible(projection, lon, lat)) continue;
      const e = tissot(projection, lon, lat, params.radius);
      if (!e) continue;
      const dx = x - e.x, dy = y - e.y;
      const ca = Math.cos(e.angle), sa = Math.sin(e.angle);
      const u = (dx * ca + dy * sa) / Math.max(e.rx, 6), v = (-dx * sa + dy * ca) / Math.max(e.ry, 6);
      const d = u * u + v * v;
      if (d <= 1 && d < bd) { bd = d; best = [lon, lat]; }
    }
    return best;
  };

  if (map) {
    map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom });
    await map.setProjection(params.projection, { duration: map.projectionId === params.projection ? 0 : 700 });
    build2d();
  } else if (globe) build3d();
  runEnter();
  readouts();

  return {
    update(p, keys) {
      params = { ...p };
      if (map && keys.includes("projection") && params.projection !== map.projectionId) {
        map.setProjection(params.projection, { duration: 900 }).then(() => { readouts(); ctx.overlay.update(); });
      }
      if (map && keys.some((k) => k === "spacing" || k === "mode")) { hovered = null; runEnter(); }
      if (globe && keys.some((k) => k === "spacing" || k === "radius")) build3d();
      if (map) map.invalidate();
      if (keys.length) readouts();
    },
    hover(lon, lat) {
      let at = { lon, lat }, head = null;
      if (map) {
        const q = map.project(lon, lat);
        const hit = q.visible ? hitEllipse(q.x, q.y) : null;
        const same = hit && hovered && hit[0] === hovered[0] && hit[1] === hovered[1];
        if (!same && (hit || hovered)) { hovered = hit; map.invalidate(); }
        if (hit) { at = { lon: hit[0], lat: hit[1] }; head = `ellipse at ${ctx.fmt.lon(hit[0])} ${ctx.fmt.lat(hit[1])}`; }
      }
      const r = readAt(at.lon, at.lat);
      if (!r) return [];
      const lines = [`a = ${r.a.toFixed(3)}   b = ${r.b.toFixed(3)}`, `a·b = ${r.ab.toFixed(3)}   ω = ${r.omega.toFixed(2)}°`];
      return head ? [head, ...lines] : lines;
    },
    probe(lon, lat) {
      let at = { lon, lat };
      if (map) {
        const q = map.project(lon, lat);
        const hit = q.visible ? hitEllipse(q.x, q.y) : null;
        if (hit) at = { lon: hit[0], lat: hit[1] };
      }
      const r = readAt(at.lon, at.lat);
      if (!r) return null;
      probed = at;
      if (map) map.invalidate();
      if (globe) buildPoint3d();
      return r;
    },
    unprobe() {
      probed = null;
      if (map) map.invalidate();
      if (globe) buildPoint3d();
      readouts();
    },
    resize() { if (map) { map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom }); map.invalidate(); } },
    unmount() {
      if (enterTween) enterTween.cancel();
      if (map) { map.removePrefix(PREFIX); map.setInsets({ top: 0, bottom: 0 }); }
      if (globe) globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
    },
  };
}
