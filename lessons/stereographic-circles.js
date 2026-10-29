import { make } from "@/core/projections.js";
import { geo, smallCircle, fitCircle, drawCaption, FONT_MONO } from "@/core/map2d.js";
import { DEG, clamp } from "@/core/math.js";

export const meta = {
  id: "stereographic-circles",
  title: "Circles stay circles",
  track: 3,
  order: 5,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "stereographic",
  labels: false,
  paragraph: "The stereographic map keeps every circle a circle. A range ring around a city projects as a true circle. But the circle's centre on the map is not the image of the real centre. It slides outward. Draw circles and see both points.",
  deeper: [
    "k = 2/(1 + cos c).",
    "At c = 90° from the centre k = 2.",
    "Because every circle stays a circle, the map is conformal.",
    "UPS uses k0 = 0.994 at the pole.",
  ],
  keywords: ["stereographic", "circle", "conformal", "range ring"],
  controls: [
    { key: "centre", type: "point", label: "Map centre", default: [0, 90] },
    { key: "circle", type: "point", label: "Circle centre", default: [10, 45] },
    { key: "radius", type: "range", label: "Radius", min: 5, max: 80, step: 0.5, default: 30, unit: "°", ticks: [5, 30, 55, 80] },
    { key: "showOffset", type: "toggle", label: "Show offset", default: true, shortcut: "o" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "Image of the true centre" }, { color: "#b85217", label: "Centre of the circle on the map" }, { color: "#b85217", dash: true, label: "Best-fit circle" }] },
  ],
  readouts: [
    { key: "radiusR", label: "Projected radius", digits: 3, unit: "R", hero: true },
    { key: "offset", label: "Centre offset", digits: 3, unit: "R" },
    { key: "k", label: "k at circle centre", digits: 4 },
    { key: "circ", label: "Circularity", digits: 4 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
export const CLIP = 110;
const MAX_EXTRA = 5;
const INSET_TOP = 60;

export function unitProjection(centre) {
  return make("stereographic", { lon0: centre[0], lat0: centre[1], clipAngle: CLIP }).scale(1).translate([0, 0]);
}

export function scaleAt(cDeg) {
  return 2 / (1 + Math.cos(cDeg * DEG));
}

export function analytic(cDeg, radiusDeg) {
  const r1 = 2 * Math.tan(((cDeg - radiusDeg) * DEG) / 2), r2 = 2 * Math.tan(((cDeg + radiusDeg) * DEG) / 2);
  return { centre: (r1 + r2) / 2, radius: (r2 - r1) / 2, image: 2 * Math.tan((cDeg * DEG) / 2), offset: (r1 + r2) / 2 - 2 * Math.tan((cDeg * DEG) / 2) };
}

export function measure(centre, circle, radius, n = 360) {
  const p = unitProjection(centre);
  const c = geo.distance(centre, circle) / DEG;
  if (c + radius >= 179.5) return { radiusR: Infinity, offset: Infinity, k: scaleAt(c), circ: NaN, c };
  const pts = smallCircle(circle[0], circle[1], radius, n).slice(0, -1).map((q) => p(q));
  const fit = fitCircle(pts);
  const tc = p(circle);
  return { radiusR: fit.r, offset: Math.hypot(fit.cx - tc[0], fit.cy - tc[1]), k: scaleAt(c), circ: 1 - fit.residual / fit.r, c, fit, image: tc };
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  const globe = ctx.stage.globe;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal, ink = palette.ui.ink;
  let params = { ...ctx.params };
  let extras = [];
  let grow = 1, growTween = null;
  let dragging = null;

  const runGrow = () => {
    if (growTween) growTween.cancel();
    if (ctx.reducedMotion || dragging) { grow = 1; return; }
    grow = 0;
    growTween = ctx.anim.tween({ from: 0, to: 1, duration: 300, ease: ctx.anim.ease.out, onUpdate: (v) => { grow = v; if (map) map.invalidate(); } });
  };

  const readouts = () => {
    const m = measure(params.centre, params.circle, params.radius);
    ctx.readout.setMany({ radiusR: Number.isFinite(m.radiusR) ? m.radiusR : "∞", offset: Number.isFinite(m.offset) ? m.offset : "∞", k: m.k, circ: Number.isFinite(m.circ) ? m.circ : "–" });
  };

  const screenFit = (projection, circle, radius) => {
    const pts = smallCircle(circle[0], circle[1], radius, 180).slice(0, -1).map((q) => projection(q));
    if (pts.some((q) => !q || !isFinite(q[0]) || Math.abs(q[0]) > 1e6 || Math.abs(q[1]) > 1e6)) return null;
    return fitCircle(pts);
  };

  const tagText = (g, x, y, text, colour, align = "left") => {
    g.font = `600 11px ${FONT_MONO}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(250,248,243,.9)";
    g.strokeText(text, x, y);
    g.fillStyle = colour;
    g.fillText(text, x, y);
  };

  const drawCircle = (g, path, projection, circle, radius, main) => {
    const r = Math.max(0.01, radius * (main ? grow : 1));
    g.beginPath();
    path({ type: "Polygon", coordinates: [smallCircle(circle[0], circle[1], r, 180)] });
    g.fillStyle = main ? "rgba(29,99,168,.18)" : "rgba(29,99,168,.1)";
    g.fill();
    g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 3.4; g.stroke();
    g.strokeStyle = signal; g.lineWidth = main ? 2 : 1.4; g.stroke();
    if (!params.showOffset || (main && grow < 1)) return;
    const fit = screenFit(projection, circle, radius);
    const tc = projection(circle);
    if (!fit || !tc) return;
    g.setLineDash([5, 4]);
    g.strokeStyle = brass; g.lineWidth = 1.2;
    g.beginPath(); g.arc(fit.cx, fit.cy, fit.r, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    const mc = projection(params.centre);
    if (main && mc) {
      const dx = fit.cx - mc[0], dy = fit.cy - mc[1], d = Math.hypot(dx, dy) || 1;
      g.strokeStyle = "rgba(184,82,23,.45)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(mc[0], mc[1]); g.lineTo(fit.cx + (dx / d) * fit.r * 1.15, fit.cy + (dy / d) * fit.r * 1.15); g.stroke();
    }
    g.strokeStyle = brass; g.lineWidth = 2;
    g.beginPath(); g.moveTo(fit.cx - 6, fit.cy); g.lineTo(fit.cx + 6, fit.cy); g.moveTo(fit.cx, fit.cy - 6); g.lineTo(fit.cx, fit.cy + 6); g.stroke();
    g.fillStyle = signal; g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 2;
    g.beginPath(); g.arc(tc[0], tc[1], main ? 5 : 4, 0, Math.PI * 2); g.fill(); g.stroke();
    if (main) {
      const ox = fit.cx - tc[0], oy = fit.cy - tc[1], od = Math.hypot(ox, oy);
      if (od > 3) {
        g.strokeStyle = brass; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(tc[0], tc[1]); g.lineTo(fit.cx, fit.cy); g.stroke();
      }
      const ux = od > 1e-6 ? ox / od : 1, uy = od > 1e-6 ? oy / od : 0;
      tagText(g, tc[0] - ux * 12 - uy * 10, tc[1] - uy * 12 + ux * 10, "true centre", signal, ux > 0 ? "right" : "left");
      tagText(g, fit.cx + ux * 12 + uy * 10, fit.cy + uy * 12 - ux * 10, "circle centre", brass, ux > 0 ? "left" : "right");
      g.fillStyle = ink; g.strokeStyle = brass; g.lineWidth = 2;
      g.beginPath(); g.arc(fit.cx + fit.r, fit.cy, 5.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  };

  const layer = (g, path, projection) => {
    if (map.morph) {
      drawCircleSimple(g, path);
      return;
    }
    for (const e of extras) drawCircle(g, path, projection, e.at, e.radius, false);
    drawCircle(g, path, projection, params.circle, params.radius, true);
    const mc = projection(params.centre);
    if (mc) {
      g.fillStyle = ink; g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 2;
      g.beginPath(); g.arc(mc[0], mc[1], 4, 0, Math.PI * 2); g.fill(); g.stroke();
      tagText(g, mc[0] + 9, mc[1] - 10, "map centre", ink);
    }
  };

  const drawCircleSimple = (g, path) => {
    for (const e of [...extras.map((x) => [x.at, x.radius]), [params.circle, params.radius]]) {
      g.beginPath(); path({ type: "Polygon", coordinates: [smallCircle(e[0][0], e[0][1], e[1], 120)] });
      g.fillStyle = "rgba(29,99,168,.14)"; g.fill(); g.strokeStyle = signal; g.lineWidth = 1.6; g.stroke();
    }
  };

  const caption = () => {
    const m = measure(params.centre, params.circle, params.radius);
    if (!Number.isFinite(m.offset)) return ["The circle passes through the antipode.", "Its image is a straight line, a circle of infinite radius."];
    return ["Drag the circle centre or its rim. Click to add a circle.", `The circle stays round to ${(m.circ * 100).toFixed(3)}%. Its centre moves ${m.offset.toFixed(3)} R outward.`];
  };

  const dragFilter = (x, y) => {
    if (map.morph) return null;
    const projection = map.projection;
    const tc = projection(params.circle);
    if (tc && Math.hypot(tc[0] - x, tc[1] - y) < 13) return "move";
    const fit = screenFit(projection, params.circle, params.radius);
    if (fit && Math.abs(Math.hypot(fit.cx - x, fit.cy - y) - fit.r) < 8) return "rim";
    return null;
  };

  const build3d = () => {
    const segs = (c, r) => { const ring = smallCircle(c[0], c[1], r, 120); return ring.slice(1).map((q, i) => [ring[i], q]); };
    globe.addLines(PREFIX + "circle", [...segs(params.circle, params.radius), ...extras.flatMap((e) => segs(e.at, e.radius))], { color: signal, width: 2, depth: true });
    const m = measure(params.centre, params.circle, params.radius);
    const pts = [params.circle];
    globe.addPoints(PREFIX + "true", pts, { color: signal, size: 14 });
    if (m.fit && params.showOffset) {
      const back = unitProjection(params.centre).invert([m.fit.cx, m.fit.cy]);
      if (back) globe.addPoints(PREFIX + "fitc", [back], { color: brass, size: 14 });
      else globe.remove(PREFIX + "fitc");
    } else globe.remove(PREFIX + "fitc");
    globe.addPoints(PREFIX + "pole", [params.centre], { color: palette.ui.ink, size: 10 });
  };

  const setMap = (duration) => map.setProjection("stereographic", { duration, opts: { lon0: params.centre[0], lat0: params.centre[1], clipAngle: CLIP }, tag: params.centre.join(",") });

  if (map) {
    map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom });
    await setMap(map.projectionId === "stereographic" ? 0 : 700);
    map.addLayer(PREFIX + "circles", layer, { order: 55 });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 20, 16, caption(), { accent: signal }), { order: 90, clip: false });
    map.setDragFilter(dragFilter);
    const off = map.on("customdrag", (e) => {
      if (e.phase === "start") { dragging = e.claim; map.canvas.style.cursor = "grabbing"; return; }
      if (e.phase === "move") {
        const ll = map.pick(e.x, e.y);
        if (!ll) return;
        if (dragging === "move") ctx.controls.set("circle", [+ll.lon.toFixed(4), +ll.lat.toFixed(4)], { live: true });
        else if (dragging === "rim") ctx.controls.set("radius", clamp(Math.round(geo.distance(params.circle, [ll.lon, ll.lat]) / DEG * 2) / 2, 5, 80), { live: true });
        return;
      }
      const key = dragging === "move" ? "circle" : "radius";
      dragging = null;
      map.canvas.style.cursor = "grab";
      if (e.phase === "end") ctx.controls.set(key, params[key]);
    });
    map.canvas.addEventListener("pointermove", (ev) => {
      if (dragging) return;
      const r = map.canvas.getBoundingClientRect();
      const c = dragFilter(ev.clientX - r.left, ev.clientY - r.top);
      map.canvas.style.cursor = c === "move" ? "move" : c === "rim" ? "ew-resize" : "grab";
    }, { signal: ctx.signal });
    ctx.signal.addEventListener("abort", off);
  } else if (globe) {
    build3d();
    if (ctx.side === "A") globe.camera.lookAt(params.circle[0], Math.min(60, params.circle[1]), null, { duration: 0 });
  }
  runGrow();
  readouts();

  return {
    update(p, keys) {
      params = { ...p };
      if (map && keys.includes("centre")) setMap(900).then(() => map.invalidate());
      if (keys.some((k) => k === "circle" || k === "radius") && !dragging) runGrow();
      if (globe) build3d();
      if (map) map.invalidate();
      if (keys.length) readouts();
    },
    hover(lon, lat) {
      const c = geo.distance(params.centre, [lon, lat]) / DEG;
      return [`c = ${c.toFixed(1)}° from the map centre`, `k = ${scaleAt(c).toFixed(4)}`];
    },
    probe(lon, lat) {
      if (map) {
        const q = map.project(lon, lat);
        if (q.visible && dragFilter(q.x, q.y)) return null;
      }
      extras.push({ at: [lon, lat], radius: params.radius });
      if (extras.length > MAX_EXTRA) extras.shift();
      if (globe) build3d();
      if (map) map.invalidate();
      const m = measure(params.centre, [lon, lat], params.radius);
      return { radiusR: Number.isFinite(m.radiusR) ? m.radiusR : "∞", offset: Number.isFinite(m.offset) ? m.offset : "∞", k: m.k, circ: Number.isFinite(m.circ) ? m.circ : "–" };
    },
    unprobe() {
      extras = [];
      if (globe) build3d();
      if (map) map.invalidate();
      readouts();
    },
    resize() { if (map) { map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom }); map.invalidate(); } },
    unmount() {
      if (growTween) growTween.cancel();
      if (map) { map.setDragFilter(null); map.canvas.style.cursor = "grab"; map.removePrefix(PREFIX); map.setInsets({ top: 0, bottom: 0 }); }
      if (globe) globe.removePrefix(PREFIX);
    },
  };
}
