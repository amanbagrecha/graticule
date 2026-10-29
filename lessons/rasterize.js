import { rasterizeCentre, rasterizeExact, polygonArea } from "@/core/raster.js";
import { mixOklab, hexToRgb, css } from "@/core/palette.js";
import { clamp } from "@/core/math.js";
import { pixelStage, background, text, panel, formulaPanel, fmtNum, fmtPlain, drawCaption, INK, FONT_UI } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "rasterize",
  title: "Centre in, or exact fraction",
  track: 6,
  order: 8,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "A polygon becomes a raster cell by cell. Centre-in asks only whether the cell's centre is inside. It is fast, but the count jumps when the grid shifts and thin pieces can vanish. Exact fraction asks how much of each cell is covered. Only boundary cells need any geometry.",
  deeper: [
    "Centre-in is what gdal_rasterize and rasterio do.",
    "Exact fraction is what exactextract does.",
    "A thin strip narrower than a cell can get zero cells.",
    "Rasterize once, then summarise every day from the same cell list.",
  ],
  keywords: ["rasterize", "coverage", "all touched", "fraction"],
  controls: [
    { key: "mode", type: "segment", label: "Mode", options: [{ value: "centre", label: "Centre in" }, { value: "exact", label: "Exact fraction" }], default: "centre" },
    { key: "shift", type: "range", label: "Grid shift", min: 0, max: 1, step: 0.05, default: 0, unit: " cell", ticks: [0, 0.5, 1] },
    { key: "shape", type: "select", label: "Shape", options: [{ value: "square", label: "Square 2.4" }, { value: "strip", label: "Thin strip" }, { value: "circle", label: "Circle" }, { value: "drawn", label: "Drawn" }], default: "square" },
    { key: "cell", type: "range", label: "Cell size", min: 10, max: 40, step: 1, default: 24, unit: " px", ticks: [10, 20, 30, 40] },
    { type: "legend", label: "Key", items: [{ color: "#b85217", line: true, label: "Polygon: drag it or its corners" }, { color: "#b85217", label: "Cell centre inside" }, { color: "#1d63a8", label: "Cell counted, fraction 1" }] },
  ],
  readouts: [
    { key: "counted", label: "Cells counted", hero: true },
    { key: "exact", label: "Exact area (cells)", digits: 2 },
    { key: "error", label: "Error", digits: 1, unit: " %" },
    { key: "boundary", label: "Boundary cells", digits: 0 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
export const BASE_CELL = 24;
const CENTRE = 1.2 * BASE_CELL;

export function shapePolygon(shape) {
  const u = BASE_CELL;
  if (shape === "square") return [[0, 0], [2.4 * u, 0], [2.4 * u, 2.4 * u], [0, 2.4 * u]];
  if (shape === "strip") return [[0.55 * u, -0.3 * u], [0.95 * u, -0.3 * u], [0.95 * u, 2.7 * u], [0.55 * u, 2.7 * u]];
  if (shape === "circle") {
    const n = 64, r = 1.5 * u;
    return Array.from({ length: n }, (_, i) => [CENTRE + r * Math.cos((2 * Math.PI * i) / n), CENTRE + r * Math.sin((2 * Math.PI * i) / n)]);
  }
  return null;
}

export function coverGrid(poly, cell, shift = 0) {
  const g0 = -shift * cell;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const [x, y] of poly) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  const c0 = Math.floor((xmin - g0) / cell) - 1, c1 = Math.ceil((xmax - g0) / cell) + 1;
  const r0 = Math.floor((ymin - g0) / cell) - 1, r1 = Math.ceil((ymax - g0) / cell) + 1;
  return { x0: g0 + c0 * cell, y0: g0 + r0 * cell, dx: cell, dy: cell, width: c1 - c0, height: r1 - r0 };
}

const closed = (poly) => [...poly, poly[0]];

export function rasterStats(poly, grid) {
  const n = grid.width * grid.height;
  if (!poly || poly.length < 3) return { centre: new Float32Array(n), cover: new Float64Array(n), counted: 0, sumFraction: 0, exactCells: 0, area: 0, boundary: 0, touched: 0 };
  const ring = closed(poly);
  const centre = rasterizeCentre(ring, grid);
  const cover = rasterizeExact(ring, grid, { ArrayType: Float64Array });
  let counted = 0, sumFraction = 0, boundary = 0, touched = 0;
  for (let i = 0; i < n; i++) {
    counted += centre[i];
    sumFraction += cover[i];
    if (cover[i] > 1e-12) touched++;
    if (cover[i] > 1e-12 && cover[i] < 1 - 1e-12) boundary++;
  }
  const area = polygonArea(ring);
  return { centre, cover, counted, sumFraction, exactCells: area / (grid.dx * grid.dy), area, boundary, touched };
}

export function errorPercent(counted, exactCells) {
  return exactCells > 1e-12 ? (100 * (counted - exactCells)) / exactCells : NaN;
}

export function insidePolygon(poly, x, y) {
  if (!poly || poly.length < 3) return false;
  return rasterizeCentre(closed(poly), { x0: x - 0.5, y0: y - 0.5, dx: 1, dy: 1, width: 1, height: 1 })[0] === 1;
}

const RAMP = [hexToRgb("#22305e"), hexToRgb("#3a78a8"), hexToRgb("#1d63a8")];
const rampRgb = (f) => (f <= 0.5 ? mixOklab(RAMP[0], RAMP[1], f / 0.5) : mixOklab(RAMP[1], RAMP[2], (f - 0.5) / 0.5));
const LUT = Array.from({ length: 101 }, (_, i) => rampRgb(i / 100));
export const fractionColour = (f, a = 1) => css(LUT[clamp(Math.round(f * 100), 0, 100)], a);

const parsePoly = (s) => {
  if (!s) return null;
  const pts = String(s).split(";").map((p) => p.split(",").map(Number));
  return pts.length >= 3 && pts.every((p) => p.length === 2 && p.every(Number.isFinite)) ? pts : null;
};
const encodePoly = (poly) => poly.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(";");

export async function mount(ctx) {
  let params = { ...ctx.params };
  let poly = null;
  let drawing = null;
  let edited = false;
  let first = true;
  let hoverCell = null;
  let hoverVertex = -1;
  let pointer = null;
  let scan = null, scanTween = null;
  let fade = 1, fadeTween = null;
  let L = null;

  const layoutOf = (W, H) => {
    const bottom = H - ctx.stage.insetBottom - 16;
    const top = 84, left = 16, right = W - 16;
    const frameBottom = bottom - 64;
    const cw = right - left, ch = frameBottom - top;
    const Z = clamp(Math.min(cw, ch) / (5.2 * BASE_CELL), 1.2, 190 / BASE_CELL);
    return { W, H, top, left, right, bottom, Z, cx: (left + right) / 2, cy: (top + frameBottom) / 2 };
  };
  const toScreen = (x, y) => [L.cx + (x - CENTRE) * L.Z, L.cy + (y - CENTRE) * L.Z];
  const toWorld = (X, Y) => [CENTRE + (X - L.cx) / L.Z, CENTRE + (Y - L.cy) / L.Z];
  const cell = () => Number(params.cell);
  const shift = () => Number(params.shift);

  const viewGrid = () => {
    const c = cell(), g0 = -shift() * c;
    const [wx0, wy0] = toWorld(0, 0), [wx1, wy1] = toWorld(L.W, L.H);
    const c0 = Math.floor((wx0 - g0) / c), c1 = Math.ceil((wx1 - g0) / c);
    const r0 = Math.floor((wy0 - g0) / c), r1 = Math.ceil((wy1 - g0) / c);
    return { x0: g0 + c0 * c, y0: g0 + r0 * c, dx: c, dy: c, width: c1 - c0, height: r1 - r0, c0, r0 };
  };

  const bounds = () => {
    const [x0, y0] = toWorld(L.left + 8, L.top + 8), [x1, y1] = toWorld(L.right - 8, L.bottom - 8);
    return { x0, y0, x1, y1 };
  };
  const clampPoly = (p) => {
    if (!p || !L) return p;
    const b = bounds();
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of p) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    const dx = xmin < b.x0 ? b.x0 - xmin : xmax > b.x1 ? b.x1 - xmax : 0;
    const dy = ymin < b.y0 ? b.y0 - ymin : ymax > b.y1 ? b.y1 - ymax : 0;
    return dx || dy ? p.map(([x, y]) => [x + dx, y + dy]) : p;
  };

  const snap = (v) => { const d = stage.dpr; return (Math.round(v * d - 0.5 * d) + 0.5 * d) / d; };

  let stats = null, grid = null;
  const compute = () => {
    grid = viewGrid();
    stats = rasterStats(poly, grid);
    return stats;
  };

  const startScan = () => {
    if (scanTween) scanTween.cancel();
    scanTween = null;
    scan = null;
    if (ctx.reducedMotion || params.mode !== "centre" || !L) return;
    const g = viewGrid();
    scan = -1;
    scanTween = ctx.anim.tween({ from: -1, to: g.height + 1, duration: (g.height + 2) * 20, ease: ctx.anim.ease.linear, onUpdate: (v) => { scan = v; stage.request(); }, onDone: () => { scan = null; scanTween = null; stage.request(); } });
  };
  const startFade = () => {
    if (fadeTween) fadeTween.cancel();
    fadeTween = null;
    fade = 1;
    if (ctx.reducedMotion || params.mode !== "exact") return;
    fade = 0;
    fadeTween = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.out, onUpdate: (v) => { fade = v; stage.request(); }, onDone: () => { fadeTween = null; fade = 1; stage.request(); } });
  };
  const animate = () => { if (params.mode === "centre") startScan(); else startFade(); };

  const drawCells = (g) => {
    const s = stats, gr = grid;
    const exact = params.mode === "exact";
    const colX = (c) => snap(toScreen(gr.x0 + c * gr.dx, 0)[0]);
    const rowY = (r) => snap(toScreen(0, gr.y0 + r * gr.dy)[1]);
    for (let r = 0; r < gr.height; r++) {
      const rowA = scan === null ? 1 : clamp(scan - r, 0, 1);
      if (rowA <= 0) continue;
      for (let c = 0; c < gr.width; c++) {
        const i = r * gr.width + c;
        const f = exact ? s.cover[i] : s.centre[i];
        if (f <= 1e-12) continue;
        const X0 = colX(c), X1 = colX(c + 1), Y0 = rowY(r), Y1 = rowY(r + 1);
        g.fillStyle = fractionColour(f, (exact ? fade : rowA) * 0.88);
        g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
      }
    }
    if (!exact) return;
    const cs = gr.dx * L.Z;
    if (cs < 56) return;
    g.globalAlpha = fade;
    for (let r = 0; r < gr.height; r++) for (let c = 0; c < gr.width; c++) {
      const f = s.cover[r * gr.width + c];
      const full = f >= 1 - 1e-9;
      if (f <= 1e-12 || (full && cs < 80)) continue;
      const [X, Y] = toScreen(gr.x0 + c * gr.dx, gr.y0 + r * gr.dy);
      const label = full ? "1" : f < 0.01 ? "<0.01" : (Math.floor(f * 100) / 100).toFixed(2);
      const dark = f > 0.62;
      text(g, X + 7, Y + 11, label, { color: dark ? "#faf8f3" : INK.ink, size: cs > 70 ? 11.5 : 10, weight: 600, halo: !dark });
    }
    g.globalAlpha = 1;
  };

  const drawGrid = (g) => {
    const gr = grid;
    g.lineWidth = 1;
    g.strokeStyle = "rgba(60,52,40,.26)";
    g.beginPath();
    for (let c = 0; c <= gr.width; c++) { const X = snap(toScreen(gr.x0 + c * gr.dx, 0)[0]); g.moveTo(X, 0); g.lineTo(X, L.H); }
    for (let r = 0; r <= gr.height; r++) { const Y = snap(toScreen(0, gr.y0 + r * gr.dy)[1]); g.moveTo(0, Y); g.lineTo(L.W, Y); }
    g.stroke();
  };

  const drawCentres = (g) => {
    if (params.mode !== "centre") return;
    const gr = grid, s = stats;
    const cs = gr.dx * L.Z;
    for (let r = 0; r < gr.height; r++) {
      const live = scan !== null && Math.abs(scan - (r + 0.5)) < 0.75;
      for (let c = 0; c < gr.width; c++) {
        const [X, Y] = toScreen(gr.x0 + (c + 0.5) * gr.dx, gr.y0 + (r + 0.5) * gr.dy);
        const inside = s.centre[r * gr.width + c] === 1 && (scan === null || scan > r + 0.5);
        g.beginPath();
        if (inside) {
          g.arc(X, Y, Math.min(4, cs * 0.09), 0, 2 * Math.PI);
          g.fillStyle = INK.brass; g.fill();
          g.strokeStyle = "#faf8f3"; g.lineWidth = 1.2; g.stroke();
        } else {
          g.arc(X, Y, Math.min(2.4, cs * 0.06), 0, 2 * Math.PI);
          g.fillStyle = live ? "rgba(26,25,23,.9)" : "rgba(107,102,94,.55)"; g.fill();
        }
      }
    }
    if (scan !== null) {
      const Y = toScreen(0, gr.y0 + clamp(scan, 0, gr.height) * gr.dy)[1];
      const grad = g.createLinearGradient(0, Y - 18, 0, Y);
      grad.addColorStop(0, "rgba(29,99,168,0)");
      grad.addColorStop(1, "rgba(29,99,168,.22)");
      g.fillStyle = grad; g.fillRect(0, Y - 18, L.W, 18);
      g.strokeStyle = INK.signal; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, Y); g.lineTo(L.W, Y); g.stroke();
    }
  };

  const drawPolygon = (g) => {
    if (poly) {
      g.beginPath();
      poly.forEach(([x, y], i) => { const [X, Y] = toScreen(x, y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.closePath();
      if (params.mode === "centre") { g.fillStyle = "rgba(184,82,23,.14)"; g.fill(); }
      g.lineJoin = "round";
      g.strokeStyle = "rgba(250,248,243,.85)"; g.lineWidth = 4.5; g.stroke();
      g.strokeStyle = INK.brass; g.lineWidth = 2; g.stroke();
      if (poly.length <= 12 || hoverVertex >= 0) {
        poly.forEach(([x, y], i) => {
          if (poly.length > 12 && i !== hoverVertex) return;
          const [X, Y] = toScreen(x, y);
          g.beginPath(); g.arc(X, Y, i === hoverVertex ? 7 : 5, 0, 2 * Math.PI);
          g.fillStyle = i === hoverVertex ? INK.brass : "#faf8f3"; g.fill();
          g.strokeStyle = INK.brass; g.lineWidth = 2; g.stroke();
        });
      }
    }
    if (drawing) {
      g.strokeStyle = INK.brass; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath();
      drawing.forEach(([x, y], i) => { const [X, Y] = toScreen(x, y); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
      if (pointer && drawing.length) g.lineTo(pointer[0], pointer[1]);
      g.stroke(); g.setLineDash([]);
      drawing.forEach(([x, y], i) => {
        const [X, Y] = toScreen(x, y);
        const closeHot = i === 0 && drawing.length >= 3 && pointer && Math.hypot(pointer[0] - X, pointer[1] - Y) < 10;
        g.beginPath(); g.arc(X, Y, closeHot ? 8 : 5, 0, 2 * Math.PI);
        g.fillStyle = i === 0 ? INK.brass : "#faf8f3"; g.fill();
        g.strokeStyle = INK.brass; g.lineWidth = 2; g.stroke();
      });
    }
  };

  const drawHover = (g) => {
    if (!hoverCell || drawing) return;
    const gr = grid;
    const X0 = snap(toScreen(gr.x0 + hoverCell.c * gr.dx, 0)[0]), X1 = snap(toScreen(gr.x0 + (hoverCell.c + 1) * gr.dx, 0)[0]);
    const Y0 = snap(toScreen(0, gr.y0 + hoverCell.r * gr.dy)[1]), Y1 = snap(toScreen(0, gr.y0 + (hoverCell.r + 1) * gr.dy)[1]);
    g.strokeStyle = "#ffffff"; g.lineWidth = 2;
    g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
  };

  const drawLegend = (g) => {
    const x = 16, w = 236, h = 64, y = L.bottom - h;
    panel(g, x, y, w, h, { accent: INK.signal });
    g.font = `600 10px ${FONT_UI}`;
    g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText(params.mode === "exact" ? "COVERED FRACTION" : "CENTRE IN: 0 OR 1 ONLY", x + 22, y + 15);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
    const bx = x + 22, bw = w - 44, by = y + 26, bh = 12;
    const exact = params.mode === "exact";
    for (let i = 0; i < bw; i++) {
      const f = i / (bw - 1);
      g.fillStyle = exact || f < 0.04 || f > 0.96 ? fractionColour(f) : fractionColour(f, 0.18);
      g.fillRect(bx + i, by, 1, bh);
    }
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1;
    g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const X = bx + t * (bw - 1);
      const dim = !exact && t > 0 && t < 1;
      text(g, X, by + bh + 10, t === 0 ? "0" : t === 1 ? "1" : t.toFixed(2).replace(/^0/, ""), { color: dim ? INK.ink4 : INK.ink2, size: 10, align: "center", halo: false });
    }
  };

  const drawPanel = (g) => {
    if (L.W < 640) return;
    const s = stats;
    const eC = errorPercent(s.counted, s.exactCells), eX = errorPercent(s.sumFraction, s.exactCells);
    const errStr = (e) => (Number.isFinite(e) ? `${e >= 0.05 ? "+" : ""}${fmtNum(e, 1)} %` : "–");
    const errCol = (e) => (!Number.isFinite(e) ? INK.ink3 : Math.abs(e) < 0.05 ? INK.ok : Math.abs(e) < 10 ? INK.warn : INK.err);
    const active = (m) => (params.mode === m ? INK.brass : INK.ink3);
    const rows = [
      [["centre in       ", active("centre")], [`${String(s.counted).padStart(5)} cells`, INK.ink], ["  ", INK.ink], [errStr(eC).padStart(9), errCol(eC)]],
      [["exact fraction  ", active("exact")], [`${s.sumFraction.toFixed(2).padStart(5)} cells`, INK.ink], ["  ", INK.ink], [errStr(eX).padStart(9), errCol(eX)]],
      [["boundary cells  ", INK.ink3], [`${String(s.boundary).padStart(5)}`, INK.ink], [` of ${s.touched} touched`, INK.ink2]],
      [["polygon area    ", INK.ink3], [`${s.exactCells.toFixed(2).padStart(5)} cells`, INK.ink2], [` = ${fmtPlain(s.area, 0)} px²`, INK.ink3]],
    ];
    formulaPanel(g, L.W - 16, 16, "Same polygon, two counts", rows, { accent: INK.brass, align: "right", size: 11.5, gap: 18 });
  };

  const caption = () => {
    if (drawing) return ["Click to place points.", drawing.length >= 3 ? "Click the first point or press Enter to close." : "Press Esc to stop."];
    if (!poly) return ["Draw a polygon.", "Click on the grid to place the first point."];
    const s = stats;
    if (params.mode === "centre") {
      if (params.shape === "strip" && s.counted === 0) return ["The strip falls between the centres.", "Centre in gives it zero cells. Try exact fraction."];
      return ["Centre in: a cell counts when its centre is inside.", "Move the grid shift. The count jumps.", params.shape === "drawn" ? "Click outside the shape to draw a new one." : "Drag the shape, a corner or the empty grid."];
    }
    return ["Exact fraction: each cell gets the part it covers.", "Only boundary cells need any geometry.", "Point at a cell for its fraction."];
  };

  const draw = (g, W, H) => {
    L = layoutOf(W, H);
    background(g, W, H);
    compute();
    drawCells(g);
    drawGrid(g);
    drawCentres(g);
    drawPolygon(g);
    drawHover(g);
    drawCaption(g, 16, 16, caption(), { accent: params.mode === "exact" ? INK.signal : INK.brass });
    drawPanel(g);
    drawLegend(g);
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    if (!L) return;
    const s = compute();
    const exact = params.mode === "exact";
    const counted = exact ? s.sumFraction : s.counted;
    const e = errorPercent(counted, s.exactCells);
    ctx.readout.setMany({
      counted: exact ? s.sumFraction.toFixed(2) : String(s.counted),
      exact: s.exactCells,
      error: Number.isFinite(e) ? (Math.abs(e) < 0.05 ? 0 : e) : "–",
      boundary: s.boundary,
    });
  };

  const writeUrl = () => ctx.url.set("poly", edited && poly ? encodePoly(poly) : null);

  const setShape = (fromUrl) => {
    const urlPoly = fromUrl ? parsePoly(ctx.url.get("poly")) : null;
    edited = !!urlPoly;
    poly = urlPoly || shapePolygon(params.shape);
    drawing = !poly && params.shape === "drawn" ? [] : null;
    if (!fromUrl) writeUrl();
  };

  const closeDrawing = () => {
    if (!drawing || drawing.length < 3) return;
    poly = clampPoly(drawing);
    drawing = null;
    edited = true;
    writeUrl();
    readouts();
    animate();
    stage.request();
  };

  const vertexAt = (X, Y) => {
    if (!poly) return -1;
    let best = -1, bd = 10;
    poly.forEach(([x, y], i) => { const [px, py] = toScreen(x, y); const d = Math.hypot(px - X, py - Y); if (d < bd) { bd = d; best = i; } });
    return best;
  };

  const cellAt = (X, Y) => {
    const [x, y] = toWorld(X, Y);
    const gr = grid || viewGrid();
    const c = Math.floor((x - gr.x0) / gr.dx), r = Math.floor((y - gr.y0) / gr.dy);
    return c >= 0 && r >= 0 && c < gr.width && r < gr.height ? { c, r } : null;
  };

  const snapCorner = (x, y) => {
    const c = cell(), g0 = -shift() * c;
    const sx = g0 + Math.round((x - g0) / c) * c, sy = g0 + Math.round((y - g0) / c) * c;
    return Math.hypot(sx - x, sy - y) * L.Z < 7 ? [sx, sy] : [x, y];
  };

  stage.on("move", (X, Y) => {
    if (!L) return;
    pointer = [X, Y];
    if (drawing) { stage.setCursor("crosshair"); hoverCell = null; stage.hideChip(); stage.request(); return; }
    hoverVertex = vertexAt(X, Y);
    const [x, y] = toWorld(X, Y);
    const inPoly = insidePolygon(poly, x, y);
    stage.setCursor(hoverVertex >= 0 ? "grab" : inPoly ? "move" : params.shape === "drawn" ? "crosshair" : "default");
    hoverCell = cellAt(X, Y);
    if (hoverCell && stats) {
      const gr = grid;
      const i = hoverCell.r * gr.width + hoverCell.c;
      const f = stats.cover[i];
      const col = gr.c0 + hoverCell.c, row = gr.r0 + hoverCell.r;
      stage.chip(X, Y, [
        `cell col ${col}, row ${row}`,
        `covered fraction ${f >= 1 - 1e-9 ? "1" : f.toFixed(3)}`,
        `centre inside: ${stats.centre[i] === 1 ? "yes, counts 1" : "no, counts 0"}`,
      ]);
    } else stage.hideChip();
    stage.request();
  });
  stage.on("leave", () => { hoverCell = null; hoverVertex = -1; pointer = null; stage.request(); });

  stage.on("down", (X, Y) => {
    if (ctx.side !== "A" || drawing) return null;
    const v = vertexAt(X, Y);
    if (v >= 0) return { kind: "vertex", i: v };
    const [x, y] = toWorld(X, Y);
    if (insidePolygon(poly, x, y)) return { kind: "move", w0: [x, y], p0: poly.map((p) => p.slice()) };
    return { kind: "grid", X0: X, Y0: Y, s0: shift() };
  });
  stage.on("drag", (claim, X, Y) => {
    const [x, y] = toWorld(X, Y);
    if (claim.kind === "vertex") {
      const b = bounds();
      const p = snapCorner(clamp(x, b.x0, b.x1), clamp(y, b.y0, b.y1));
      poly = poly.map((q, i) => (i === claim.i ? p : q));
      hoverVertex = claim.i;
      stage.setCursor("grabbing");
    } else if (claim.kind === "move") {
      poly = clampPoly(claim.p0.map(([px, py]) => [px + x - claim.w0[0], py + y - claim.w0[1]]));
      stage.setCursor("move");
    } else if (claim.kind === "grid") {
      const cs = cell() * L.Z;
      const d = ((X - claim.X0) + (Y - claim.Y0)) / (2 * cs);
      const s = Math.round(clamp(claim.s0 - d, 0, 1) * 20) / 20;
      if (s !== shift()) ctx.controls.set("shift", s, { live: true });
      stage.setCursor("grabbing");
      return;
    }
    edited = true;
    hoverCell = null;
    stage.hideChip();
    readouts();
    stage.request();
  });
  stage.on("dragEnd", (claim, X, Y, moved) => {
    if (!moved) return;
    if (claim.kind === "grid") { ctx.controls.set("shift", shift()); return; }
    writeUrl();
  });
  stage.on("click", (X, Y) => {
    if (ctx.side !== "A") return;
    if (drawing) {
      if (drawing.length >= 3) {
        const [fx, fy] = toScreen(...drawing[0]);
        if (Math.hypot(fx - X, fy - Y) < 10) { closeDrawing(); return; }
      }
      const b = bounds();
      const [x, y] = toWorld(X, Y);
      const p = snapCorner(clamp(x, b.x0, b.x1), clamp(y, b.y0, b.y1));
      const last = drawing[drawing.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) * L.Z < 4) return;
      drawing.push(p);
      stage.request();
      return;
    }
    if (params.shape !== "drawn") return;
    const [x, y] = toWorld(X, Y);
    if (vertexAt(X, Y) >= 0 || insidePolygon(poly, x, y)) return;
    const b = bounds();
    drawing = [snapCorner(clamp(x, b.x0, b.x1), clamp(y, b.y0, b.y1))];
    poly = null;
    edited = false;
    writeUrl();
    readouts();
    stage.request();
  });
  stage.on("escape", () => {
    if (!drawing) return;
    drawing = [];
    stage.request();
  });
  stage.canvas.addEventListener("dblclick", () => closeDrawing(), { signal: ctx.signal });
  window.addEventListener("keydown", (e) => { if (e.key === "Enter" && drawing && drawing.length >= 3) { e.preventDefault(); closeDrawing(); } }, { signal: ctx.signal });

  setShape(true);
  stage.render();
  poly = clampPoly(poly);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (first) {
        first = false;
        readouts();
        animate();
        stage.request();
        return;
      }
      if (keys.includes("shape") && (prev.shape !== params.shape || keys.length > 3)) {
        setShape(false);
        poly = clampPoly(poly);
      }
      if (keys.includes("cell") || keys.includes("shape") || (keys.includes("mode") && prev.mode !== params.mode)) animate();
      readouts();
      stage.request();
    },
    resize() { stage.render(); poly = clampPoly(poly); readouts(); stage.request(); },
    unmount() {
      if (scanTween) scanTween.cancel();
      if (fadeTween) fadeTween.cancel();
      ctx.url.set("poly", null);
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}
