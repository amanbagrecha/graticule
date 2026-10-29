import { make, factors } from "@/core/projections.js";
import { drawIndicatrices, indicatrixGrid, drawCaption, FONT_MONO } from "@/core/map2d.js";
import { DEG, clamp } from "@/core/math.js";

export const meta = {
  id: "equirectangular-parallel",
  title: "Plate carrée is a choice",
  track: 3,
  order: 7,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  labels: false,
  paragraph: "The simplest map plots longitude as x and latitude as y. That is plate carrée. It is true in scale only at the equator. Move the standard parallel north and the map gets narrower. It is now true along two parallels instead. The grid stays rectangular.",
  deeper: [
    "Width = 2π R cos φ1.",
    "At φ1 = 60° the map is square.",
    "EPSG:4087 is this map on a sphere.",
    "Many \"unprojected\" datasets are in fact plate carrée.",
  ],
  keywords: ["plate carrée", "equirectangular", "standard parallel", "EPSG:4087"],
  controls: [
    { key: "lat1", type: "range", label: "Standard parallel", min: 0, max: 80, step: 0.5, default: 0, unit: "°", fillFrom: 0, ticks: [0, 30, 60, 80] },
    { key: "tissot", type: "toggle", label: "Tissot", default: true, shortcut: "t" },
    { key: "frame", type: "toggle", label: "Frame", default: true, shortcut: "f" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", line: true, label: "Standard parallel, k = 1 (drag it)" }, { color: "#1d63a8", label: "Tissot ellipse" }] },
  ],
  readouts: [
    { key: "ratio", label: "Width : height", digits: 3, hero: true },
    { key: "kEq", label: "k at the equator", digits: 3 },
    { key: "k60", label: "k at 60 N", digits: 3 },
    { key: "trueAt", label: "True-scale parallels" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const INSET_TOP = 60;

export function aspect(lat1) {
  return 2 * Math.cos(lat1 * DEG);
}

export function widthR(lat1) {
  return 2 * Math.PI * Math.cos(lat1 * DEG);
}

export function kAlongParallel(lat, lat1) {
  return Math.cos(lat1 * DEG) / Math.cos(lat * DEG);
}

export function projectionFor(lat1) {
  return make("equirectangular", { lat1 }).precision(0.3);
}

const fmtDeg = (v) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal, ink2 = palette.ui.ink2;
  let params = { ...ctx.params };
  let shown = params.lat1;
  let tween = null;
  let dragging = false;
  let base = null;

  const fitBase = () => {
    const p0 = projectionFor(0);
    p0.fitExtent(map.extent(), { type: "Sphere" });
    base = { scale: p0.scale(), translate: p0.translate() };
  };

  const apply = (lat1) => {
    shown = lat1;
    const p = projectionFor(lat1).scale(base.scale).translate(base.translate);
    const done = map.setProjection(p, { duration: 0, opts: { fit: false }, tag: "lat1=" + lat1.toFixed(3) });
    map.projectionId = "equirectangular";
    return done;
  };

  const readouts = () => {
    const l = params.lat1;
    ctx.readout.setMany({ ratio: aspect(l), kEq: kAlongParallel(0, l), k60: kAlongParallel(60, l), trueAt: l < 0.25 ? "equator" : `${fmtDeg(l)}° N and S` });
  };

  const animateTo = (lat1) => {
    if (tween) tween.cancel();
    if (ctx.reducedMotion || dragging) { apply(lat1); return; }
    const from = shown;
    map.interacting = true;
    tween = ctx.anim.tween({ from, to: lat1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => apply(v), onDone: () => { tween = null; map.interacting = false; apply(lat1); } });
  };

  const tag = (g, x, y, text, colour, align = "left") => {
    g.font = `600 11px ${FONT_MONO}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(250,248,243,.92)";
    g.strokeText(text, x, y);
    g.fillStyle = colour;
    g.fillText(text, x, y);
  };

  const pill = (g, x, y, text, colour) => {
    g.font = `600 11px ${FONT_MONO}`;
    const w = g.measureText(text).width + 12;
    g.fillStyle = "rgba(250,248,243,.95)";
    g.beginPath(); g.roundRect(x - w / 2, y - 9, w, 18, 4); g.fill();
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = colour;
    g.fillText(text, x, y + 0.5);
  };

  const parallels = (g, path, projection) => {
    const lats = shown < 0.25 ? [0] : [shown, -shown];
    for (const lat of lats) {
      const a = projection([-180, lat]), b = projection([180, lat]);
      if (!a || !b) continue;
      g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = dragging ? 6 : 5;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.strokeStyle = brass; g.lineWidth = dragging ? 3 : 2.2;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
  };

  const tissotLayer = (g, path, projection) => {
    if (!params.tissot) return;
    drawIndicatrices(g, projection, { points: indicatrixGrid(30, 60), radius: 4, color: signal });
  };

  const frameLayer = (g) => {
    const projection = map.projection;
    const tl = projection([-180, 90]), br = projection([180, -90]);
    if (!tl || !br) return;
    const lats = shown < 0.25 ? [0] : [shown];
    for (const lat of lats) {
      const b = projection([180, lat]);
      tag(g, b[0] + 10, b[1], lat === 0 ? "equator, k = 1" : `${fmtDeg(lat)}° N, k = 1`, brass);
    }
    if (shown >= 0.25) { const b = projection([180, -shown]); tag(g, b[0] + 10, b[1], `${fmtDeg(shown)}° S, k = 1`, brass); }
    if (!params.frame) return;
    const y = tl[1] - 14, x = tl[0] - 14;
    g.strokeStyle = ink2; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(tl[0], y); g.lineTo(br[0], y);
    g.moveTo(tl[0], y - 5); g.lineTo(tl[0], y + 5); g.moveTo(br[0], y - 5); g.lineTo(br[0], y + 5);
    g.moveTo(x, tl[1]); g.lineTo(x, br[1]);
    g.moveTo(x - 5, tl[1]); g.lineTo(x + 5, tl[1]); g.moveTo(x - 5, br[1]); g.lineTo(x + 5, br[1]);
    g.stroke();
    const w = widthR(shown);
    pill(g, (tl[0] + br[0]) / 2, y, `2π R cos φ1 = ${w.toFixed(3)} R`, ink2);
    g.save();
    g.translate(x - 1, (tl[1] + br[1]) / 2);
    g.rotate(-Math.PI / 2);
    pill(g, 0, 0, `π R = ${Math.PI.toFixed(3)} R`, ink2);
    g.restore();
    tag(g, br[0] - 6, br[1] + 16, `width : height = ${aspect(shown).toFixed(3)}`, palette.ui.ink, "right");
  };

  const caption = () => ["Drag the brass line to move the standard parallel.", shown < 0.25 ? "Plate carrée: true scale only on the equator." : `True scale on ${fmtDeg(shown)}° N and S. The map is ${aspect(shown).toFixed(2)} times as wide as it is tall.`];

  const dragFilter = (x, y) => {
    if (tween) return null;
    const p = map.projection;
    for (const lat of shown < 0.25 ? [0] : [shown, -shown]) {
      const a = p([0, lat]);
      const left = p([-180, lat]), right = p([180, lat]);
      if (a && Math.abs(a[1] - y) < 8 && x >= left[0] - 4 && x <= right[0] + 4) return "parallel";
    }
    return null;
  };

  map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom, left: 24, right: 96 });
  fitBase();
  await apply(params.lat1);
  map.addLayer(PREFIX + "tissot", tissotLayer, { order: 50 });
  map.addLayer(PREFIX + "parallels", parallels, { order: 52 });
  map.addLayer(PREFIX + "frame", frameLayer, { order: 60, clip: false });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 20, 16, caption(), { accent: brass }), { order: 90, clip: false });
  map.setDragFilter(dragFilter);
  const off = map.on("customdrag", (e) => {
    if (e.phase === "start") { dragging = true; map.canvas.style.cursor = "ns-resize"; return; }
    if (e.phase === "move") {
      const ll = map.pick(e.x, e.y);
      const lat = ll ? ll.lat : null;
      if (lat === null) return;
      ctx.controls.set("lat1", clamp(Math.round(Math.abs(lat) * 2) / 2, 0, 80), { live: true });
      return;
    }
    dragging = false;
    map.canvas.style.cursor = "grab";
    if (e.phase === "end") ctx.controls.set("lat1", params.lat1);
    map.invalidate();
  });
  map.canvas.addEventListener("pointermove", (ev) => {
    if (dragging) return;
    const r = map.canvas.getBoundingClientRect();
    map.canvas.style.cursor = dragFilter(ev.clientX - r.left, ev.clientY - r.top) ? "ns-resize" : "grab";
  }, { signal: ctx.signal });
  ctx.signal.addEventListener("abort", off);
  readouts();

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("lat1") && Math.abs(params.lat1 - shown) > 1e-9) animateTo(params.lat1);
      map.invalidate();
      readouts();
    },
    hover(lon, lat) {
      const f = factors(map.projection, lon, lat);
      return f ? [`h = ${f.h.toFixed(3)}   k = ${f.k.toFixed(3)}`, `a = ${f.a.toFixed(3)}   b = ${f.b.toFixed(3)}`] : [];
    },
    probe() { return null; },
    unprobe() {},
    resize() {
      map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom, left: 24, right: 96 });
      fitBase();
      apply(shown);
    },
    unmount() {
      if (tween) tween.cancel();
      map.interacting = false;
      map.setDragFilter(null);
      map.canvas.style.cursor = "grab";
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
