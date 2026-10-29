import { affine as affineFn, invertGeoTransform, pixelCentre } from "@/core/raster.js";
import { pixelStage, background, text, pill, panel, spans, spansWidth, formulaPanel, imageCanvas, arrow, niceStep, fmtPlain, fmtNum, drawCaption, INK, FONT_UI, FONT_MONO } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "affine",
  title: "Six numbers place every pixel",
  track: 6,
  order: 1,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "An image is columns and rows counted from the top-left corner. Six numbers put each pixel on the map. Two give the corner. Two give the pixel size. Two give the rotation. The pixel height is negative because rows go down and y goes up. Change a number and watch the grid move.",
  deeper: [
    "x = x0 + col·dx + row·rx.",
    "Pixel (0,0) spans col 0 to 1, centre at 0.5.",
    "A north-up image has rx = ry = 0.",
    "The inverse matrix turns map coordinates back into column and row.",
  ],
  keywords: ["affine", "geotransform", "pixel", "origin"],
  controls: [
    { type: "group", label: "Corner" },
    { key: "x0", type: "number", label: "x0", min: 0, max: 1000000, step: 10, default: 300000, unit: "m" },
    { key: "y0", type: "number", label: "y0", min: 0, max: 10000000, step: 10, default: 5000000, unit: "m" },
    { type: "group", label: "Pixel size" },
    { key: "dx", type: "range", label: "dx", min: -60, max: 60, step: 0.5, default: 30, unit: " m", fillFrom: 0, ticks: [-60, -30, 0, 30, 60] },
    { key: "dy", type: "range", label: "dy", min: -60, max: 60, step: 0.5, default: -30, unit: " m", fillFrom: 0, ticks: [-60, -30, 0, 30, 60] },
    { type: "group", label: "Rotation" },
    { key: "rx", type: "range", label: "rx", min: -60, max: 60, step: 0.5, default: 0, unit: " m", fillFrom: 0, ticks: [-60, -30, 0, 30, 60] },
    { key: "ry", type: "range", label: "ry", min: -60, max: 60, step: 0.5, default: 0, unit: " m", fillFrom: 0, ticks: [-60, -30, 0, 30, 60] },
    { type: "group", label: "Display" },
    { key: "showCentres", type: "toggle", label: "Pixel centres", default: false, shortcut: "p" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", label: "x0, y0: the corner (drag the image)" }, { color: "#1d63a8", label: "dx, dy: pixel size (drag the corner)" }, { color: "#7046a6", label: "rx, ry: rotation (shift-drag)" }] },
  ],
  readouts: [
    { key: "pixel", label: "Pixel (col, row) → corner (x, y)" },
    { key: "centre", label: "Pixel centre (x, y)" },
    { key: "matrix", label: "Geotransform (GDAL order)" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

export const COLS = 16, ROWS = 12;
const PREFIX = meta.id + ":";

const ART = [
  "llwwwlffffgggyyy",
  "lwwwwlffffgggyyy",
  "llwwllfffrrrrrrr",
  "lllllffffrgggyyy",
  "ffllfffffrgggyyy",
  "fffllffbbrbbbhth",
  "ffffllfbbrbbbtht",
  "gggfflllrrrrrrrr",
  "gggffffllrhthyyy",
  "yyygggfflrtthyyy",
  "yyygggffllrgggbb",
  "yyygggfffllgggbb",
];
const ART_COLOURS = {
  w: [31, 95, 138], l: [47, 126, 166], f: [63, 106, 60], g: [111, 141, 78], y: [184, 163, 95],
  b: [160, 138, 106], r: [201, 192, 174], h: [196, 112, 90], t: [150, 150, 158],
};

export function geoTransform(p) {
  return [p.x0, p.dx, p.rx, p.y0, p.ry, p.dy];
}

export function pixelCorner(gt, col, row) {
  return affineFn(gt)(col, row);
}

export function pixelCentreXY(gt, col, row) {
  return pixelCentre(gt, col, row);
}

export function toPixel(gt, x, y) {
  const inv = invertGeoTransform(gt);
  if (!inv) return null;
  return affineFn(inv)(x, y);
}

export function gdalString(gt) {
  return gt.map((v) => fmtPlain(v, Number.isInteger(v) ? 0 : 1)).join(", ");
}

const lerp = (a, b, t) => a + (b - a) * t;

const CAPTION = ["Drag the image to move x0, y0.", "Drag the cyan corner to change dx, dy.", "Shift-drag to rotate. Point at a pixel to read it."];
const CAP_FONTS = [`600 13px ${FONT_UI}`, `400 12px ${FONT_UI}`];
const ROOM = 56;
export const panelHeight = (rows, gap, pad) => pad + 14 + rows * gap + pad - 4;

export function layout(W, H, { insetBottom = 0, measure = (s) => s.length * 6.6 } = {}) {
  const Hs = H - insetBottom;
  if (W < 720 || Hs < 460) return compactLayout(W, Hs, measure);
  const pad = 16, formula = { size: 12, gap: 19, pad: 14 };
  const formulaTop = Hs - pad - panelHeight(6, formula.gap, formula.pad);
  const base = { compact: false, short: false, Hs, pad, caption: CAPTION, capWidth: 420, formula, coords: true, labelOff: 22, grab: W >= 836 ? 12 : 16 };
  if (formulaTop - ROOM - (144 + ROOM) >= 220) {
    const top = 168, bottom = Math.max(top + 120, Hs - 196);
    return { ...base, left: 96, right: W - 96, top, bottom, fill: 0.82, clearTop: 144 + ROOM, clearBottom: formulaTop - ROOM, topBlock: 144, matrix: "top", axes: { x: W - 118, y: Hs - 22, len: 46 }, tickY: W >= 836 ? bottom + 26 : null };
  }
  const clearTop = 84 + ROOM, clearBottom = formulaTop - ROOM;
  return { ...base, left: 120, right: W - 120, top: clearTop, bottom: clearBottom, fill: 1, clearTop, clearBottom, topBlock: 84, matrix: "bottom", axes: { x: W - 118, y: pad + 62, len: 46 }, tickY: null };
}

function compactLayout(W, Hs, measure) {
  const short = Hs < 400, pad = 12, axW = 92;
  const formula = short ? { size: 10, gap: 13, pad: 8 } : { size: 11, gap: 15, pad: 10 };
  const tail = Hs >= 460 ? ["Tap a pixel to read it."] : [];
  const widest = (lines) => Math.max(...lines.map((s, i) => measure(s, CAP_FONTS[i ? 1 : 0])));
  const narrow = W - 2 * pad - axW - 8 - 28;
  let caption = short ? [CAPTION[0]] : null, axes = null;
  if (!short) {
    for (const body of ["Drag the cyan corner to change dx, dy.", "Drag the corner to change dx, dy."]) {
      if (!caption && widest([CAPTION[0], body, ...tail]) <= narrow) caption = [CAPTION[0], body, ...tail];
    }
    if (caption) axes = { x: W - pad - axW, y: pad + 48, len: 34 };
    else caption = [CAPTION[0], CAPTION[1], ...tail];
  }
  const capH = 18 + 16 + 17 * (caption.length - 1);
  const topBlock = pad + Math.max(capH, axes ? 53 : 0) + 6;
  const room = short ? 34 : 48;
  const formulaTop = Hs - pad - panelHeight(short ? 5 : 6, formula.gap, formula.pad);
  const clearTop = topBlock + room, clearBottom = formulaTop - room;
  return { compact: true, short, Hs, pad, caption, capWidth: axes ? narrow : 420, formula, coords: !short, labelOff: 14, grab: 16, left: 84, right: W - 84, top: clearTop, bottom: clearBottom, fill: 1, clearTop, clearBottom, topBlock, matrix: null, axes, tickY: null };
}

export async function mount(ctx) {
  const pal = ctx.palette.ui;
  let params = { ...ctx.params };
  let shown = geoTransform(params);
  let gtTween = null;
  let view = null, viewTween = null;
  let hover = null;
  let pointerXY = null;
  let lastPixel = [0, 0];
  let dragging = null;

  const art = imageCanvas(COLS, ROWS, (i, j) => {
    const c = ART_COLOURS[ART[j][i]];
    return i === 0 && j === 0 ? [184, 82, 23] : c;
  });

  const measure = (s, font) => { stage.g.font = font; return stage.g.measureText(s).width; };
  const plan = (W, H) => layout(W, H, { insetBottom: ctx.stage.insetBottom, measure });
  let curL = null;
  const grab = () => (curL ? curL.grab : 12);

  const cornersOf = (gt) => [[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]].map(([c, r]) => pixelCorner(gt, c, r));

  const fitView = (gt, W, H) => {
    const pts = cornersOf(gt);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of pts) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    const L = plan(W, H);
    const spanX = Math.max(xmax - xmin, 1), spanY = Math.max(ymax - ymin, 1);
    let k = Math.min((L.right - L.left) / spanX, (L.bottom - L.top) / spanY) * L.fill;
    const room = L.clearBottom - L.clearTop;
    if (spanY * k > room && room > 40) k = room / spanY;
    const half = (spanY * k) / 2;
    const oy = Math.min(Math.max((L.top + L.bottom) / 2, L.clearTop + half), L.clearBottom - half);
    return { cx: (xmin + xmax) / 2, cy: (ymin + ymax) / 2, k: Math.max(k, 1e-4), ox: (L.left + L.right) / 2, oy };
  };

  const toScreen = (x, y) => [view.ox + (x - view.cx) * view.k, view.oy - (y - view.cy) * view.k];
  const toWorld = (X, Y) => [view.cx + (X - view.ox) / view.k, view.cy - (Y - view.oy) / view.k];

  const needsRefit = (gt, W, H) => {
    if (!view) return true;
    const L = plan(W, H);
    const pts = cornersOf(gt).map(([x, y]) => toScreen(x, y));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const outside = Math.min(...xs) < L.left - 20 || Math.max(...xs) > L.right + 20 || Math.min(...ys) < L.top - 20 || Math.max(...ys) > L.bottom + 20;
    const small = w < (L.right - L.left) * 0.3 && h < (L.bottom - L.top) * 0.3;
    return outside || small;
  };

  const refit = (animate) => {
    const target = fitView(geoTransform(params), stage.W, stage.H);
    if (viewTween) viewTween.cancel();
    if (!view || !animate || ctx.reducedMotion) { view = target; stage.request(); return; }
    const from = { ...view };
    viewTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (u) => {
      view = { cx: lerp(from.cx, target.cx, u), cy: lerp(from.cy, target.cy, u), k: from.k * Math.pow(target.k / from.k, u), ox: target.ox, oy: target.oy };
      stage.request();
    }, onDone: () => { viewTween = null; } });
  };

  const animateGT = () => {
    const target = geoTransform(params);
    if (gtTween) gtTween.cancel();
    if (dragging || ctx.reducedMotion) { shown = target; stage.request(); return; }
    const from = shown.slice();
    gtTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (u) => {
      shown = from.map((v, i) => lerp(v, target[i], u));
      stage.request();
    }, onDone: () => { gtTween = null; shown = target; stage.request(); } });
  };

  const gridSteps = (W, H) => {
    const step = niceStep(W / view.k, 7);
    const [xa, yb] = toWorld(0, H), [xb, ya] = toWorld(W, 0);
    const xs = [], ys = [];
    for (let x = Math.ceil(xa / step) * step; x <= xb; x += step) xs.push([x, toScreen(x, 0)[0], Math.round(x / step) % 5 === 0]);
    for (let y = Math.ceil(yb / step) * step; y <= ya; y += step) ys.push([y, toScreen(0, y)[1], Math.round(y / step) % 5 === 0]);
    return { xs, ys };
  };

  const drawGridLines = (g, W, H) => {
    const { xs, ys } = gridSteps(W, H);
    g.lineWidth = 1;
    for (const [, X, major] of xs) {
      g.strokeStyle = major ? INK.gridMajor : INK.grid;
      g.beginPath(); g.moveTo(Math.round(X) + 0.5, 0); g.lineTo(Math.round(X) + 0.5, H); g.stroke();
    }
    for (const [, Y, major] of ys) {
      g.strokeStyle = major ? INK.gridMajor : INK.grid;
      g.beginPath(); g.moveTo(0, Math.round(Y) + 0.5); g.lineTo(W, Math.round(Y) + 0.5); g.stroke();
    }
  };

  const hits = (b, boxes) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

  const drawTicks = (g, W, H, L, boxes, panelTop) => {
    const { xs, ys } = gridSteps(W, H);
    const label = (x, y, s, align) => {
      g.font = `500 10px ${FONT_MONO}`;
      const w = g.measureText(s).width;
      const left = align === "center" ? x - w / 2 : x;
      const gap = align === "center" ? 6 : 2, b = [left - gap, y - 7, left + w + gap, y + 7];
      if (hits(b, boxes)) return;
      boxes.push(b);
      text(g, x, y, s, { color: INK.ink3, size: 10, align });
    };
    const tickY = L.tickY ?? panelTop - 12;
    for (const [x, X] of xs) if (X > 40 && X < W - 40) label(X, tickY, fmtPlain(x), "center");
    const [lo, hi] = L.tickY != null ? [L.top - 6, L.bottom + 10] : [L.topBlock + 8, panelTop - 22];
    for (const [y, Y] of ys) if (Y > lo && Y < hi) label(10, Y, fmtPlain(y), "left");
  };

  const drawAxes = (g, L, boxes) => {
    if (!L.axes) return;
    const { x: ax, y: ay, len } = L.axes;
    arrow(g, ax, ay, ax + len, ay, { color: INK.ink2, width: 1.25, head: 6 });
    arrow(g, ax, ay, ax, ay - len, { color: INK.ink2, width: 1.25, head: 6 });
    const w1 = text(g, ax + len + 6, ay, "x (east)", { color: INK.ink2, size: 10 });
    const w2 = text(g, ax + 6, ay - len - 8, "y (north)", { color: INK.ink2, size: 10 });
    boxes.push([ax - 6, ay - len - 14, Math.max(ax + len + 6 + w1, ax + 6 + w2) + 2, ay + 6]);
  };

  const drawRaster = (g, boxes) => {
    const gt = shown;
    const [x0, dx, rx, y0, ry, dy] = gt;
    const [ex, ey] = toScreen(x0, y0);
    const k = view.k, d = stage.dpr;
    const det = dx * dy - rx * ry;
    g.save();
    if (Math.abs(det) > 1e-6) {
      g.setTransform(k * dx * d, -k * ry * d, k * rx * d, -k * dy * d, ex * d, ey * d);
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 0.95;
      g.drawImage(art, 0, 0);
    }
    g.restore();
    const S = (c, r) => { const p = pixelCorner(gt, c, r); return toScreen(p[0], p[1]); };
    g.lineWidth = 1;
    g.strokeStyle = "rgba(250,248,243,.55)";
    g.beginPath();
    for (let c = 0; c <= COLS; c++) { const a = S(c, 0), b = S(c, ROWS); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    for (let r = 0; r <= ROWS; r++) { const a = S(0, r), b = S(COLS, r); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
    g.strokeStyle = "rgba(26,25,23,.75)";
    g.lineWidth = 1.25;
    const c4 = [S(0, 0), S(COLS, 0), S(COLS, ROWS), S(0, ROWS)];
    g.beginPath(); c4.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
    if (params.showCentres) {
      g.fillStyle = "rgba(26,25,23,.85)";
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const p = S(c + 0.5, r + 0.5);
        g.beginPath(); g.arc(p[0], p[1], 1.6, 0, Math.PI * 2); g.fill();
      }
    }
    const colDir = [S(1, 0)[0] - c4[0][0], S(1, 0)[1] - c4[0][1]];
    const rowDir = [S(0, 1)[0] - c4[0][0], S(0, 1)[1] - c4[0][1]];
    const nrm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const cu = nrm(colDir), ru = nrm(rowDir);
    const off = 16;
    const edge = (p) => Math.hypot(p[0] - c4[0][0], p[1] - c4[0][1]);
    const colLen = Math.min(64, edge(c4[1]) * 0.45), rowLen = Math.min(64, edge(c4[3]) * 0.45);
    const seg = (p, q) => boxes.push([Math.min(p[0], q[0]) - 5, Math.min(p[1], q[1]) - 5, Math.max(p[0], q[0]) + 5, Math.max(p[1], q[1]) + 5]);
    const a0 = [c4[0][0] - ru[0] * off, c4[0][1] - ru[1] * off], a1 = [a0[0] + cu[0] * colLen, a0[1] + cu[1] * colLen];
    arrow(g, a0[0], a0[1], a1[0], a1[1], { color: INK.ink, width: 1.5, head: 7 });
    const ct = [a1[0] + cu[0] * 8 - ru[0] * 2, a1[1] + cu[1] * 8 - ru[1] * 2];
    const cw = text(g, ct[0], ct[1], "col", { color: INK.ink, size: 11, weight: 600, align: "left" });
    const b0 = [c4[0][0] - cu[0] * off, c4[0][1] - cu[1] * off], b1 = [b0[0] + ru[0] * rowLen, b0[1] + ru[1] * rowLen];
    arrow(g, b0[0], b0[1], b1[0], b1[1], { color: INK.ink, width: 1.5, head: 7 });
    const rt = [b1[0] + ru[0] * 14, b1[1] + ru[1] * 14];
    const rw = text(g, rt[0], rt[1], "row", { color: INK.ink, size: 11, weight: 600, align: "center" });
    const xs = c4.map((p) => p[0]), ys = c4.map((p) => p[1]);
    boxes.push([Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10]);
    seg(a0, a1);
    seg(b0, b1);
    boxes.push([ct[0], ct[1] - 7, ct[0] + cw, ct[1] + 7], [rt[0] - rw / 2, rt[1] - 7, rt[0] + rw / 2, rt[1] + 7]);
    return { c4, cu, ru };
  };

  const drawHover = (g, gt) => {
    if (!hover) return;
    const [c, r] = hover;
    const S = (cc, rr) => { const p = pixelCorner(gt, cc, rr); return toScreen(p[0], p[1]); };
    const q = [S(c, r), S(c + 1, r), S(c + 1, r + 1), S(c, r + 1)];
    g.fillStyle = "rgba(29,99,168,.22)";
    g.strokeStyle = INK.signal;
    g.lineWidth = 2;
    g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.stroke();
    const ce = S(c + 0.5, r + 0.5);
    g.fillStyle = INK.signal;
    g.beginPath(); g.arc(ce[0], ce[1], 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK.brass;
    g.beginPath(); g.arc(q[0][0], q[0][1], 3.5, 0, Math.PI * 2); g.fill();
  };

  const handles = (gt) => {
    const o = pixelCorner(gt, 0, 0), e = pixelCorner(gt, COLS, ROWS);
    return { origin: toScreen(o[0], o[1]), corner: toScreen(e[0], e[1]) };
  };

  const drawHandles = (g, gt, info, L, W, boxes) => {
    const h = handles(gt);
    const ring = (p, colour, r = 7) => {
      g.fillStyle = "rgba(250,248,243,.9)";
      g.beginPath(); g.arc(p[0], p[1], r + 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = colour; g.lineWidth = 2.25;
      g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = colour;
      g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill();
    };
    ring(h.corner, INK.signal);
    ring(h.origin, INK.brass);
    const [cu, ru] = [info.cu, info.ru];
    const out = (p, a, b, dist) => [p[0] + (a[0] + b[0]) * dist, p[1] + (a[1] + b[1]) * dist];
    const inside = (x, w, align) => {
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      return left < 4 ? 4 - left : left + w > W - 4 ? W - 4 - left - w : 0;
    };
    const labelAt = (p, dirA, dirB, lines, colour) => {
      const q = out(p, dirA, dirB, L.labelOff);
      const align = q[0] < p[0] - 4 ? "right" : q[0] > p[0] + 4 ? "left" : "center";
      const up = q[1] < p[1];
      const y0 = q[1] + (up ? -8 : 8);
      g.font = `600 11px ${FONT_MONO}`;
      const pb = pill(g, q[0] + inside(q[0], g.measureText(lines[0]).width + 12, align), y0, lines[0], { color: colour, align, bg: "rgba(250,248,243,.9)" });
      boxes.push([pb.x, pb.y, pb.x + pb.w, pb.y + pb.h]);
      if (!L.coords) return;
      const tx = align === "left" ? q[0] + 6 : align === "right" ? q[0] - 6 : q[0], ty = y0 + (up ? -17 : 17);
      g.font = `500 10px ${FONT_MONO}`;
      const tw = g.measureText(lines[1]).width, sx = tx + inside(tx, tw, align);
      text(g, sx, ty, lines[1], { color: INK.ink2, size: 10, align });
      const left = align === "center" ? sx - tw / 2 : align === "right" ? sx - tw : sx;
      boxes.push([left, ty - 6, left + tw, ty + 6]);
    };
    const xy = (c, r) => { const p = pixelCorner(gt, c, r); return `${fmtPlain(p[0])}, ${fmtPlain(p[1])}`; };
    labelAt(h.origin, [-cu[0], -cu[1]], [-ru[0], -ru[1]], ["(0, 0)", xy(0, 0)], INK.brass);
    labelAt(h.corner, cu, ru, [`(${COLS}, ${ROWS})`, xy(COLS, ROWS)], INK.signal);
    const tr = toScreen(...pixelCorner(gt, COLS, 0)), bl = toScreen(...pixelCorner(gt, 0, ROWS));
    labelAt(tr, cu, [-ru[0], -ru[1]], [`(${COLS}, 0)`, xy(COLS, 0)], INK.ink2);
    labelAt(bl, [-cu[0], -cu[1]], ru, [`(0, ${ROWS})`, xy(0, ROWS)], INK.ink2);
  };

  const n = (v) => fmtPlain(v, Number.isInteger(Math.round(v * 10) / 10) && Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 1);
  const paren = (v) => (v < 0 ? `(${n(v)})` : n(v));

  const drawMatrix = (g, W, L) => {
    if (!L.matrix) return null;
    const gt = geoTransform(params);
    const [x0, dx, rx, y0, ry, dy] = gt;
    const cells = [[[n(dx), INK.signal], [n(rx), INK.violet], [n(x0), INK.brass]], [[n(ry), INK.violet], [n(dy), INK.signal], [n(y0), INK.brass]], [["0", INK.ink3], ["0", INK.ink3], ["1", INK.ink3]]];
    g.font = `500 12px "JetBrains Mono", monospace`;
    const colW = [0, 1, 2].map((j) => Math.max(...cells.map((r) => g.measureText(r[j][0]).width)) + 14);
    const vecW = g.measureText("row").width + 14;
    const w = 28 + vecW + 26 + colW.reduce((a, b) => a + b, 0) + 14 + vecW + 18;
    const h = 128, x = W - L.pad - w, y = L.matrix === "top" ? L.pad : L.Hs - L.pad - h;
    panel(g, x, y, w, h, { accent: INK.brass });
    g.font = `600 10px ${FONT_UI}`; g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText("THE SIX NUMBERS AS A MATRIX", x + 22, y + 18);
    const rowsY = [y + 44, y + 64, y + 84];
    const bracket = (bx, open) => {
      g.strokeStyle = INK.ink3; g.lineWidth = 1.25;
      g.beginPath();
      const s = open ? 1 : -1;
      g.moveTo(bx + 5 * s, rowsY[0] - 10); g.lineTo(bx, rowsY[0] - 10); g.lineTo(bx, rowsY[2] + 10); g.lineTo(bx + 5 * s, rowsY[2] + 10);
      g.stroke();
    };
    let cx = x + 24;
    bracket(cx, true);
    ["x", "y", "1"].forEach((s, i) => spans(g, cx + 7, rowsY[i], [[s, INK.ink]]));
    bracket(cx + vecW, false);
    cx += vecW + 8;
    spans(g, cx, rowsY[1], [["=", INK.ink2]]);
    cx += 16;
    bracket(cx, true);
    let mx = cx + 7;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        g.textAlign = "right";
        g.font = `500 12px "JetBrains Mono", monospace`;
        g.fillStyle = cells[i][j][1];
        g.fillText(cells[i][j][0], mx + colW[j] - 10, rowsY[i]);
      }
      mx += colW[j];
    }
    bracket(mx - 2, false);
    cx = mx + 8;
    bracket(cx, true);
    ["col", "row", "1"].forEach((s, i) => spans(g, cx + 7, rowsY[i], [[s, INK.ink]]));
    bracket(cx + vecW, false);
    spans(g, x + 22, y + 112, [["GDAL ", INK.ink3], [`(${gdalString(gt)})`, INK.ink2]], { size: 11 });
    return { x, y, w, h };
  };

  const gdalRow = (gt) => {
    const roles = [INK.brass, INK.signal, INK.violet, INK.brass, INK.violet, INK.signal];
    const parts = [["GDAL ", INK.ink3], ["(", INK.ink2]];
    gt.forEach((v, i) => parts.push([fmtPlain(v, Number.isInteger(v) ? 0 : 1), roles[i]], [i < 5 ? ", " : ")", INK.ink2]));
    return parts;
  };

  const drawFormula = (g, L, maxW) => {
    const gt = geoTransform(params);
    const [x0, dx, rx, y0, ry, dy] = gt;
    const [c, r] = hover || lastPixel;
    const cc = c + 0.5, rr = r + 0.5;
    const [xc, yc] = pixelCentreXY(gt, c, r);
    const eq = [
      [["x = ", INK.ink], ["x0", INK.brass], [" + col·", INK.ink2], ["dx", INK.signal], [" + row·", INK.ink2], ["rx", INK.violet]],
      [["  = ", INK.ink2], [n(x0), INK.brass], [` + ${cc}·`, INK.ink2], [paren(dx), INK.signal], [` + ${rr}·`, INK.ink2], [paren(rx), INK.violet], [" = ", INK.ink2], [fmtPlain(xc, Number.isInteger(xc) ? 0 : 1), INK.ink, 700]],
      [["y = ", INK.ink], ["y0", INK.brass], [" + col·", INK.ink2], ["ry", INK.violet], [" + row·", INK.ink2], ["dy", INK.signal]],
      [["  = ", INK.ink2], [n(y0), INK.brass], [` + ${cc}·`, INK.ink2], [paren(ry), INK.violet], [` + ${rr}·`, INK.ink2], [paren(dy), INK.signal], [" = ", INK.ink2], [fmtPlain(yc, Number.isInteger(yc) ? 0 : 1), INK.ink, 700]],
    ];
    let inverse = null, warn = null;
    if (pointerXY) {
      const inv = toPixel(gt, pointerXY[0], pointerXY[1]);
      inverse = inv
        ? [[["inverse: ", INK.ink3], [`(${fmtPlain(pointerXY[0])}, ${fmtPlain(pointerXY[1])})`, INK.ink2], [" → col ", INK.ink3], [inv[0].toFixed(2), INK.signal], [", row ", INK.ink3], [inv[1].toFixed(2), INK.signal]],
          [["inverse → col ", INK.ink3], [inv[0].toFixed(2), INK.signal], [", row ", INK.ink3], [inv[1].toFixed(2), INK.signal]]]
        : [[["no inverse: the matrix is singular", INK.err]], [["no inverse", INK.err]]];
    } else if (!L.compact) inverse = [[["Point at the map to run the inverse.", INK.ink3]]];
    if (Math.abs(dx * dy - rx * ry) < 1e-9) warn = [[["dx·dy − rx·ry = 0: no area, no inverse.", INK.err]], [["dx·dy − rx·ry = 0: no inverse.", INK.err]]];
    else if (dy > 0 && rx === 0 && ry === 0) warn = [[["dy > 0: row 0 is at the bottom. The image is upside down.", INK.warn]], [["dy > 0: the image is upside down.", INK.warn]]];
    const fixed = L.compact && !(L.short && warn) ? [...eq, gdalRow(gt)] : eq;
    const extra = (L.compact ? [warn || (L.short ? null : inverse)] : [inverse, warn]).filter(Boolean);
    const f = L.formula, inner = maxW - 2 * f.pad - 8;
    const sizes = [f.size, f.size - 0.5, f.size - 1, f.size - 1.5];
    const size = sizes.find((s) => fixed.every((row) => spansWidth(g, row, { size: s }) <= inner)) ?? sizes[sizes.length - 1];
    const pick = (variants) => variants.find((row) => spansWidth(g, row, { size }) <= inner) ?? variants[variants.length - 1];
    const title = `Centre of pixel (${c}, ${r}) at col ${cc}, row ${rr}`;
    g.font = `600 10px ${FONT_UI}`;
    const minW = g.measureText(title.toUpperCase()).width + title.length * 0.6;
    return formulaPanel(g, L.pad, L.Hs - L.pad, title, [...fixed, ...extra.map(pick)], { accent: INK.signal, valign: "bottom", size, gap: f.gap, pad: f.pad, minW });
  };

  const draw = (g, W, H) => {
    const L = (curL = plan(W, H));
    if (!view) view = fitView(geoTransform(params), W, H);
    background(g, W, H);
    drawGridLines(g, W, H);
    const boxes = [];
    drawAxes(g, L, boxes);
    const info = drawRaster(g, boxes);
    drawHover(g, shown);
    drawHandles(g, shown, info, L, W, boxes);
    const m = drawMatrix(g, W, L);
    const f = drawFormula(g, L, L.matrix === "bottom" ? W - 3 * L.pad - m.w : W - 2 * L.pad);
    const cap = drawCaption(g, L.pad, L.pad, L.caption, { accent: INK.brass, maxWidth: L.capWidth });
    for (const b of [m, f, { x: L.pad, y: L.pad, ...cap }]) if (b) boxes.push([b.x, b.y, b.x + b.w, b.y + b.h]);
    drawTicks(g, W, H, L, boxes, L.matrix === "bottom" ? Math.min(f.y, m.y) : f.y);
  };

  const stage = pixelStage(ctx, { draw, cursor: "default" });

  const readouts = () => {
    const gt = geoTransform(params);
    const [c, r] = hover || lastPixel;
    const ul = pixelCorner(gt, c, r), ce = pixelCentreXY(gt, c, r);
    const f = (v) => fmtPlain(v, Number.isInteger(v) ? 0 : 1);
    ctx.readout.setMany({
      pixel: `(${c}, ${r}) → ${f(ul[0])}, ${f(ul[1])}`,
      centre: `${f(ce[0])}, ${f(ce[1])}`,
      matrix: gdalString(gt),
    });
  };

  const hitPixel = (X, Y) => {
    const [x, y] = toWorld(X, Y);
    const p = toPixel(shown, x, y);
    if (!p) return null;
    const c = Math.floor(p[0]), r = Math.floor(p[1]);
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return [c, r];
  };

  stage.on("move", (X, Y) => {
    if (!view) return;
    pointerXY = toWorld(X, Y);
    const h = handles(shown);
    const near = (p) => Math.hypot(p[0] - X, p[1] - Y) < grab();
    const px = hitPixel(X, Y);
    stage.setCursor(near(h.corner) ? "nwse-resize" : px ? "move" : "default");
    const changed = (px ? px.join() : "") !== (hover ? hover.join() : "");
    hover = px;
    if (px) lastPixel = px;
    if (changed) readouts();
    if (px) {
      const gt = geoTransform(params);
      const ul = pixelCorner(gt, px[0], px[1]), ce = pixelCentreXY(gt, px[0], px[1]);
      stage.chip(X, Y, [`pixel col ${px[0]}, row ${px[1]}`, `corner ${fmtPlain(ul[0])}, ${fmtPlain(ul[1])}`, `centre ${fmtPlain(ce[0], Number.isInteger(ce[0]) ? 0 : 1)}, ${fmtPlain(ce[1], Number.isInteger(ce[1]) ? 0 : 1)}`]);
    } else stage.chip(X, Y, [`x ${fmtPlain(pointerXY[0])}  y ${fmtPlain(pointerXY[1])}`, "outside the image"]);
    stage.request();
  });
  stage.on("leave", () => { hover = null; pointerXY = null; readouts(); stage.request(); });

  stage.on("down", (X, Y, e) => {
    if (ctx.side !== "A") return null;
    const h = handles(shown);
    const [x, y] = toWorld(X, Y);
    if (e.shiftKey) {
      const o = pixelCorner(shown, 0, 0);
      return { kind: "rotate", a0: Math.atan2(y - o[1], x - o[0]), gt0: geoTransform(params) };
    }
    if (Math.hypot(h.corner[0] - X, h.corner[1] - Y) < grab()) return { kind: "corner" };
    if (hitPixel(X, Y)) return { kind: "move", w0: [x, y], gt0: geoTransform(params) };
    return null;
  });
  const setLive = (obj) => {
    const keys = Object.keys(obj);
    keys.forEach((k, i) => ctx.controls.set(k, obj[k], { live: true, silent: i < keys.length - 1 }));
  };
  const clampR = (v) => Math.max(-60, Math.min(60, Math.round(v * 2) / 2));
  stage.on("drag", (claim, X, Y) => {
    dragging = claim;
    const [x, y] = toWorld(X, Y);
    if (claim.kind === "move") {
      setLive({ x0: Math.round(claim.gt0[0] + x - claim.w0[0]), y0: Math.round(claim.gt0[3] + y - claim.w0[1]) });
    } else if (claim.kind === "corner") {
      const p = params;
      let dx = clampR((x - p.x0 - ROWS * p.rx) / COLS), dy = clampR((y - p.y0 - COLS * p.ry) / ROWS);
      if (Math.abs(dx) < 0.5) dx = dx < 0 ? -0.5 : 0.5;
      if (Math.abs(dy) < 0.5) dy = dy < 0 ? -0.5 : 0.5;
      setLive({ dx, dy });
    } else if (claim.kind === "rotate") {
      const [x0, dx, rx, y0, ry, dy] = claim.gt0;
      const a = Math.atan2(y - y0, x - x0) - claim.a0;
      const cs = Math.cos(a), sn = Math.sin(a);
      setLive({ dx: clampR(cs * dx - sn * ry), ry: clampR(sn * dx + cs * ry), rx: clampR(cs * rx - sn * dy), dy: clampR(sn * rx + cs * dy) });
    }
    stage.setCursor(claim.kind === "rotate" ? "grabbing" : claim.kind === "corner" ? "nwse-resize" : "move");
  });
  stage.on("dragEnd", (claim, X, Y, moved) => {
    dragging = null;
    if (!moved) return;
    const keys = claim.kind === "move" ? ["x0", "y0"] : claim.kind === "corner" ? ["dx", "dy"] : ["dx", "dy", "rx", "ry"];
    const vals = keys.map((k) => params[k]);
    keys.forEach((k, i) => ctx.controls.set(k, vals[i]));
    if (needsRefit(geoTransform(params), stage.W, stage.H)) refit(true);
  });

  readouts();
  stage.render();

  return {
    update(p, keys) {
      params = { ...p };
      const gtKeys = ["x0", "y0", "dx", "dy", "rx", "ry"];
      if (keys.some((k) => gtKeys.includes(k))) {
        animateGT();
        if (!dragging && needsRefit(geoTransform(params), stage.W, stage.H)) refit(true);
      }
      readouts();
      stage.request();
    },
    resize() { view = null; stage.request(); },
    unmount() {
      if (gtTween) gtTween.cancel();
      if (viewTween) viewTween.cancel();
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}
