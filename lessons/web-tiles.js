import { tile as tileAt, bounds as tileBounds, tileCount, EARTH_RADIUS, MAX_LAT } from "@/core/tiles.js";
import { clamp } from "@/core/math.js";
import { FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const INK = "#1a1917";
const HALO = "#faf8f3";
const SERIF = '"Newsreader", "Iowan Old Style", Charter, Georgia, serif';

export const meta = {
  id: "web-tiles",
  title: "Web map tiles",
  track: 5,
  order: 7,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "webMercator",
  labels: false,
  paragraph: "A web map does not load the whole world at once. It loads only the square tiles that you see. Each zoom step cuts every tile into four. Three numbers, z/x/y, name one tile.",
  deeper: [
    "x counts the columns from the west edge. y counts the rows down from the top.",
    "Tiles use Web Mercator, so the map stops at 85.051° N and S.",
    "A tile is an image of 256 × 256 pixels. At zoom 0, one pixel is about 157 km at the equator.",
    "A quadkey writes the same tile as one digit, 0 to 3, for each zoom step.",
  ],
  keywords: ["tiles", "zoom", "z/x/y", "Web Mercator", "quadkey", "XYZ"],
  controls: [
    { key: "z", type: "range", label: "Zoom", min: 0, max: 8, step: 1, default: 2, ticks: [0, 2, 4, 6, 8] },
    { key: "point", type: "point", label: "Place", default: [2.3522, 48.8566] },
  ],
  readouts: [
    { key: "count", label: "Tiles at this zoom", digits: 0 },
    { key: "width", label: "Tile width at the equator", digits: 0, unit: "km" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
const CUT_MS = 360;
const LABEL_H = 44;

export const zoomFor = (z) => clamp(2 ** (z - 3), 1, 24);

export const tileWidthKm = (z) => (2 * Math.PI * EARTH_RADIUS) / 2 ** z / 1000;

export const tileId = (t) => `${t.z}/${t.x}/${t.y}`;

export function tileInfo(lon, lat, z) {
  const t = tileAt(lon, lat, z);
  return { ...t, id: tileId(t), bounds: tileBounds(t.z, t.x, t.y), count: tileCount(z), width: tileWidthKm(z) };
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  let params = { ...ctx.params };
  let shownZ = params.z, cutFrom = params.z, cutU = 1, tween = null;
  let booted = false;
  let wheelAcc = 0, wheelTimer = 0;

  const info = (z = params.z) => tileInfo(params.point[0], params.point[1], z);

  const layout = () => map.setInsets({ top: 12, bottom: ctx.stage.insetBottom + 12, left: 12, right: 12 });

  const focus = (animate, force = false) => {
    const t = info();
    const k = zoomFor(params.z);
    const lon = k <= 1 ? 0 : (t.bounds.west + t.bounds.east) / 2, lat = k <= 1 ? 0 : (t.bounds.south + t.bounds.north) / 2;
    const q = map.projection && map.projection([lon, lat]), c = map.viewCenter();
    if (!force && q && Math.abs(map.zoom() - k) < 1e-3 && Math.hypot(q[0] - c[0], q[1] - c[1]) < 1) return;
    const duration = animate && !ctx.reducedMotion ? 480 : 0;
    if (duration) map.touch(duration + 60);
    map.lookAt(lon, lat, k, { duration });
  };

  const inView = () => {
    if (Math.abs(map.zoom() - zoomFor(params.z)) > 1e-3 || !map.projection) return false;
    const r = rect(map.projection, info().bounds);
    return !!r && r.x >= 24 && r.y >= 24 && r.x + r.w <= map.width - 24 && r.y + r.h <= map.height - ctx.stage.insetBottom - 24;
  };

  const square = (P) => {
    const a = P([-180, MAX_LAT]), c = P([180, -MAX_LAT]);
    return a && c ? { x0: a[0], y0: a[1], x1: c[0], y1: c[1] } : null;
  };

  const rect = (P, b) => {
    const a = P([b.west, b.north]), c = P([b.east, b.south]);
    return a && c ? { x: a[0], y: a[1], w: c[0] - a[0], h: c[1] - a[1] } : null;
  };

  const span = (sq, z) => {
    const n = 2 ** z, w = (sq.x1 - sq.x0) / n, h = (sq.y1 - sq.y0) / n;
    return {
      n, w, h,
      x0: clamp(Math.floor((0 - sq.x0) / w), 0, n - 1), x1: clamp(Math.floor((map.width - sq.x0) / w), 0, n - 1),
      y0: clamp(Math.floor((0 - sq.y0) / h), 0, n - 1), y1: clamp(Math.floor((map.height - sq.y0) / h), 0, n - 1),
    };
  };

  const gridLines = (g, sq, z) => {
    const s = span(sq, z);
    g.beginPath();
    for (let k = s.x0; k <= s.x1 + 1; k++) { const x = sq.x0 + k * s.w; g.moveTo(x, sq.y0); g.lineTo(x, sq.y1); }
    for (let k = s.y0; k <= s.y1 + 1; k++) { const y = sq.y0 + k * s.h; g.moveTo(sq.x0, y); g.lineTo(sq.x1, y); }
    g.stroke();
  };

  const cuts = (g, sq, z, u) => {
    const s = span(sq, z);
    g.beginPath();
    for (let x = s.x0; x <= s.x1; x++) for (let y = s.y0; y <= s.y1; y++) {
      const cx = sq.x0 + (x + 0.5) * s.w, cy = sq.y0 + (y + 0.5) * s.h, hw = (s.w / 2) * u, hh = (s.h / 2) * u;
      g.moveTo(cx - hw, cy); g.lineTo(cx + hw, cy); g.moveTo(cx, cy - hh); g.lineTo(cx, cy + hh);
    }
    g.stroke();
  };

  const gridLayer = (g, path, P) => {
    const sq = square(P);
    if (!sq) return;
    g.lineCap = "butt";
    const cutting = cutU < 1 && cutFrom !== shownZ;
    const lo = cutting ? Math.min(cutFrom, shownZ) : shownZ;
    g.strokeStyle = "rgba(26,25,23,.5)"; g.lineWidth = 1;
    gridLines(g, sq, lo);
    const t = info(lo);
    const r = rect(P, t.bounds);
    if (r && lo > 0) {
      g.fillStyle = "rgba(184,82,23,.18)"; g.fillRect(r.x, r.y, r.w, r.h);
    }
    if (cutting) {
      const u = cutFrom < shownZ ? ctx.anim.ease.out(cutU) : 1 - ctx.anim.ease.out(cutU);
      g.strokeStyle = "rgba(26,25,23,.5)"; g.lineWidth = 1;
      cuts(g, sq, lo, u);
      if (r) {
        g.strokeStyle = BRASS; g.lineWidth = 2;
        g.beginPath();
        g.moveTo(r.x + r.w / 2 - (r.w / 2) * u, r.y + r.h / 2); g.lineTo(r.x + r.w / 2 + (r.w / 2) * u, r.y + r.h / 2);
        g.moveTo(r.x + r.w / 2, r.y + r.h / 2 - (r.h / 2) * u); g.lineTo(r.x + r.w / 2, r.y + r.h / 2 + (r.h / 2) * u);
        g.stroke();
      }
    }
    g.strokeStyle = INK; g.lineWidth = 1.5;
    g.strokeRect(sq.x0, sq.y0, sq.x1 - sq.x0, sq.y1 - sq.y0);
    if (r) { g.strokeStyle = BRASS; g.lineWidth = lo > 0 ? 2.5 : 3; g.strokeRect(r.x, r.y, r.w, r.h); }
  };

  const labelBox = (g, small, big) => {
    g.font = `600 13px ${FONT_UI}`; const w1 = g.measureText(small).width;
    g.font = `500 22px ${SERIF}`; const w2 = g.measureText(big).width;
    return { w: Math.max(w1, w2), h: LABEL_H };
  };

  const placeLabel = (r, box, dot) => {
    const W = map.width, H = map.height - ctx.stage.insetBottom;
    const cx = r.x + r.w / 2 - box.w / 2;
    const opts = [
      { x: cx, y: r.y - box.h - 6 },
      { x: cx, y: r.y + r.h + 6 },
      { x: r.x + r.w + 10, y: r.y + r.h / 2 - box.h / 2 },
      { x: r.x - box.w - 10, y: r.y + r.h / 2 - box.h / 2 },
      { x: cx, y: r.y + 10 },
    ];
    const fits = (p) => p.x >= 8 && p.x + box.w <= W - 8 && p.y >= 6 && p.y + box.h <= H - 6;
    const clear = (p) => !dot || dot[0] < p.x - 8 || dot[0] > p.x + box.w + 8 || dot[1] < p.y - 8 || dot[1] > p.y + box.h + 8;
    const pick = opts.find((p) => fits(p) && clear(p)) || opts.find(fits) || opts[0];
    return { x: clamp(pick.x, 8, W - 8 - box.w), y: clamp(pick.y, 6, H - 6 - box.h) };
  };

  const labelLayer = (g, path, P) => {
    const t = info();
    const dot = P([params.point[0], clamp(params.point[1], -MAX_LAT, MAX_LAT)]);
    if (dot) {
      g.fillStyle = INK; g.strokeStyle = HALO; g.lineWidth = 2;
      g.beginPath(); g.arc(dot[0], dot[1], 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (cutU < 1 && cutFrom !== shownZ) return;
    const r = rect(P, t.bounds);
    if (!r) return;
    const small = "Tile z/x/y", big = t.id;
    const box = labelBox(g, small, big);
    const at = placeLabel(r, box, dot);
    const tx = at.x + box.w / 2;
    g.textAlign = "center"; g.textBaseline = "alphabetic"; g.lineJoin = "round"; g.strokeStyle = HALO; g.lineWidth = 4;
    g.font = `600 13px ${FONT_UI}`; g.strokeText(small, tx, at.y + 13); g.fillStyle = BRASS; g.fillText(small, tx, at.y + 13);
    g.font = `500 22px ${SERIF}`; g.strokeText(big, tx, at.y + 39); g.fillStyle = INK; g.fillText(big, tx, at.y + 39);
  };

  const readouts = () => {
    const t = info();
    ctx.readout.setMany({ count: t.count, width: t.width });
  };

  const setZ = (z) => {
    if (tween) tween.cancel();
    tween = null;
    const from = shownZ;
    shownZ = z;
    if (!booted || ctx.reducedMotion || Math.abs(from - z) !== 1) { cutU = 1; cutFrom = z; map.invalidate(); return; }
    cutFrom = from; cutU = 0;
    tween = ctx.anim.tween({ from: 0, to: 1, duration: CUT_MS, ease: ctx.anim.ease.linear, onUpdate: (u) => { cutU = u; map.invalidate(); }, onDone: () => { cutU = 1; cutFrom = shownZ; tween = null; map.invalidate(); } });
  };

  ctx.stage.el.addEventListener("wheel", (e) => {
    if (ctx.side !== "A") return;
    e.preventDefault();
    e.stopPropagation();
    wheelAcc += e.deltaY;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelAcc = 0; }, 260);
    if (Math.abs(wheelAcc) < 60) return;
    const z = clamp(params.z + (wheelAcc < 0 ? 1 : -1), 0, 8);
    wheelAcc = 0;
    if (z !== params.z) ctx.controls.set("z", z);
  }, { capture: true, passive: false, signal: ctx.signal });

  await map.ready;
  map.setFitTarget(null);
  await map.setProjection("webMercator", { duration: 0 });
  map.setLayer("graticule", false);
  layout();
  map.addLayer(PREFIX + "grid", gridLayer, { order: 50 });
  map.addLayer(PREFIX + "label", labelLayer, { order: 60, clip: false });
  if (document.fonts && document.fonts.load) document.fonts.load(`500 22px "Newsreader"`).then(() => map.invalidate()).catch(() => {});
  focus(false, true);
  readouts();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("z")) setZ(params.z);
      if (keys.includes("z") || (keys.includes("point") && !inView())) focus(booted);
      readouts();
      map.invalidate();
    },
    hover(lon, lat) {
      const t = tileAt(lon, clamp(lat, -MAX_LAT, MAX_LAT), params.z);
      return [`Tile ${tileId(t)}`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(4), +clamp(lat, -85, 85).toFixed(4)]);
      return null;
    },
    unprobe() {},
    resize() { layout(); focus(false, true); map.invalidate(); },
    unmount() {
      if (tween) tween.cancel();
      clearTimeout(wheelTimer);
      map.setLayer("graticule", true);
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
