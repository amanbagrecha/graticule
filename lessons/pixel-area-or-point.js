import { pixelStage, background, text, pill, panel, spans, formulaPanel, fmtPlain, fmtNum, drawCaption, urlPoint, INK, FONT_UI, FONT_MONO } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "pixel-area-or-point",
  title: "Half a pixel matters",
  track: 6,
  order: 2,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "A raster's coordinates name either the pixel corner or the pixel centre. The two differ by half a pixel. At 30 m that is 15 m. Mix them and every pixel is off by half a cell. Files carry a flag for this. Check it before you align two images.",
  deeper: [
    "GeoTIFF: RasterPixelIsArea = 1, RasterPixelIsPoint = 2.",
    "30 m pixels → 15 m shift.",
    "Many \"misaligned by half a pixel\" bugs come from this.",
    "Zarr and NetCDF usually give centre coordinates.",
  ],
  keywords: ["pixel is area", "pixel is point", "half pixel", "registration"],
  controls: [
    { key: "mode", type: "segment", label: "The tie point names the", options: [{ value: "area", label: "Corner (area)" }, { value: "point", label: "Centre (point)" }], default: "area" },
    { key: "pixel", type: "range", label: "Pixel size", min: 10, max: 1000, step: 5, default: 30, unit: " m", ticks: [10, 250, 500, 750, 1000] },
    { type: "group", label: "Sample point" },
    { key: "pick", type: "button", label: "Pick a point", icon: "i-pin" },
    { key: "snap", type: "button", label: "Put it on a corner", icon: "i-grid" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "Grid of the chosen flag" }, { color: "#7046a6", line: true, dash: true, label: "Grid of the other flag" }, { color: "#b85217", label: "Tie point (x0, y0) and the true field edge", line: true }] },
  ],
  readouts: [
    { key: "shift", label: "Shift", digits: 1, unit: "m", hero: true },
    { key: "cellArea", label: "Sample cell, area" },
    { key: "cellPoint", label: "Sample cell, point" },
    { key: "flag", label: "GeoTIFF flag" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
export const X0 = 300000, Y0 = 5000000;
export const DEFAULT_POINT = [2.72, 1.81];
const N = 7, M = 5;

export const FLAGS = { area: { code: 1, name: "RasterPixelIsArea" }, point: { code: 2, name: "RasterPixelIsPoint" } };

export function halfShift(pixel) {
  return pixel / 2;
}

export function cellOf(mode, x, y, pixel, x0 = X0, y0 = Y0) {
  const off = mode === "point" ? 0.5 : 0;
  return [Math.floor((x - x0) / pixel + off), Math.floor((y0 - y) / pixel + off)];
}

export function cellBounds(mode, col, row, pixel, x0 = X0, y0 = Y0) {
  const off = mode === "point" ? 0.5 : 0;
  const xa = x0 + (col - off) * pixel, ya = y0 - (row - off) * pixel;
  return { xmin: xa, xmax: xa + pixel, ymax: ya, ymin: ya - pixel };
}

export function geoTransformFor(mode, pixel, x0 = X0, y0 = Y0) {
  const off = mode === "point" ? pixel / 2 : 0;
  return [x0 - off, pixel, 0, y0 + off, 0, -pixel];
}

export function worldFile(mode, pixel, x0 = X0, y0 = Y0) {
  const gt = geoTransformFor(mode, pixel, x0, y0);
  return [gt[1], gt[4], gt[2], gt[5], gt[0] + gt[1] / 2 + gt[2] / 2, gt[3] + gt[4] / 2 + gt[5] / 2];
}

export function snapCorner(mode, uv) {
  const off = mode === "point" ? 0.5 : 0;
  const c = (v, n) => Math.max(1, Math.min(n - 1, Math.round(v + off))) - off;
  return [c(uv[0], N), c(uv[1], M)];
}

const FIELD = [[1, 1], [5, 1], [5, 2], [6, 2], [6, 4], [2, 4], [2, 3], [1, 3]];
const inField = (c, r) => {
  const x = c + 0.5, y = r + 0.5;
  let inside = false;
  for (let i = 0, j = FIELD.length - 1; i < FIELD.length; j = i++) {
    const [xi, yi] = FIELD[i], [xj, yj] = FIELD[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const VALUES = [];
for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) VALUES.push(inField(c, r) ? 0.62 + 0.08 * Math.sin(c * 1.7 + r) : 0.12 + 0.05 * Math.cos(c * 2.3 + r * 1.3));

export async function mount(ctx) {
  let params = { ...ctx.params };
  let shown = params.mode === "point" ? 0.5 : 0;
  let shiftTween = null;
  let sample = urlPoint(ctx, "point") || DEFAULT_POINT.slice();
  let armed = false;
  let hover = null;
  let L = null;

  const layout = (g, W, H, capH) => {
    if (W >= 740) {
      const top = 150, bottom = H - ctx.stage.insetBottom - 160;
      const left = 70, right = W - 40;
      const cs = Math.max(36, Math.min((right - left) / (N + 1.4), (bottom - top) / (M + 1.4)));
      const gw = (N + 1) * cs, gh = (M + 1) * cs;
      const ox = left + (right - left - gw) / 2 + cs * 0.7, oy = top + (bottom - top - gh) / 2 + cs * 0.7;
      return { cs, ox, oy, stack: false };
    }
    g.font = `500 10px ${FONT_MONO}`;
    const lw = g.measureText(fmtPlain(Y0)).width + 4;
    const top = 16 + capH + 10, bottom = H - ctx.stage.insetBottom - 12 - (38 + 3 * 16) - 10;
    const cs = Math.max(16, Math.min(56, (bottom - top - 55) / 6.15, (W - 32 - lw) / 8.15));
    const ox = (W - 8.15 * cs - lw) / 2 + 1.15 * cs + lw;
    const oy = top + 1.15 * cs + 16 + (bottom - top - 6.15 * cs - 55) / 2;
    return { cs, ox, oy, stack: true };
  };

  const P = (u, v) => [L.ox + u * L.cs, L.oy + v * L.cs];
  const toUV = (X, Y) => [(X - L.ox) / L.cs, (Y - L.oy) / L.cs];
  const xyOfUV = (u, v) => [X0 + u * params.pixel, Y0 - v * params.pixel];

  const cellColour = (v) => {
    const a = [92, 74, 52], b = [72, 128, 64];
    const t = Math.max(0, Math.min(1, (v - 0.1) / 0.6));
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  };

  const drawTicks = (g, W, avoid) => {
    g.save();
    g.font = `500 10px ${FONT_MONO}`;
    const free = (x0, y0, x1, y1) => !avoid.some((b) => b && x1 > b.x && x0 < b.x + b.w && y1 > b.y && y0 < b.y + b.h);
    for (let k = -1; k <= N + 1; k++) {
      const [X] = P(k, 0);
      const s = fmtPlain(X0 + k * params.pixel), w = g.measureText(s).width, y = L.oy - L.cs * 1.15 - 10;
      if (X < 40 || X > W - 30 || (L.cs < 66 && k % 2 !== 0) || !free(X - w / 2, y - 6, X + w / 2, y + 6)) continue;
      g.strokeStyle = INK.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(X, L.oy - L.cs * 1.15); g.lineTo(X, L.oy - L.cs * 1.0); g.stroke();
      text(g, X, y, s, { color: k === 0 ? INK.brass : INK.ink3, size: 10, align: "center" });
    }
    for (let k = -1; k <= M + 1; k++) {
      const [, Y] = P(0, k);
      const s = fmtPlain(Y0 - k * params.pixel), x = L.ox - L.cs * 1.15 - 4;
      if (!free(x - g.measureText(s).width, Y - 6, x, Y + 6)) continue;
      g.strokeStyle = INK.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(L.ox - L.cs * 1.15, Y); g.lineTo(L.ox - L.cs * 1.0, Y); g.stroke();
      text(g, x, Y, s, { color: k === 0 ? INK.brass : INK.ink3, size: 10, align: "right" });
    }
    g.restore();
  };

  const drawGrid = (g, off, colour, { dash = null, width = 1 } = {}) => {
    g.strokeStyle = colour; g.lineWidth = width;
    if (dash) g.setLineDash(dash);
    g.beginPath();
    for (let c = 0; c <= N; c++) { const a = P(c - off, -off), b = P(c - off, M - off); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    for (let r = 0; r <= M; r++) { const a = P(-off, r - off), b = P(N - off, r - off); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
    g.stroke();
    g.setLineDash([]);
  };

  const outlineCell = (g, mode, c, r, colour, fill, dash) => {
    const off = mode === "point" ? (mode === params.mode ? shown : 0.5) : (mode === params.mode ? shown : 0);
    const a = P(c - off, r - off);
    g.fillStyle = fill;
    g.fillRect(a[0], a[1], L.cs, L.cs);
    g.strokeStyle = colour; g.lineWidth = 2.5;
    if (dash) g.setLineDash(dash);
    g.strokeRect(a[0] + 1, a[1] + 1, L.cs - 2, L.cs - 2);
    g.setLineDash([]);
  };

  const draw = (g, W, H) => {
    background(g, W, H);
    const onCorner = Math.abs(sample[0] - snapCorner(params.mode, sample)[0]) < 1e-9 && Math.abs(sample[1] - snapCorner(params.mode, sample)[1]) < 1e-9;
    const capLines = armed ? ["Click the grid to put the sample point.", "Esc cancels."] : onCorner ? ["The sample is on a pixel corner.", "It touches four cells. The flag decides which one it gets.", "Switch the flag and watch the cell change."] : [params.mode === "area" ? "The tie point names the pixel corner." : "The tie point names the pixel centre.", params.mode === "area" ? "The raster sits on the true field edge (brass)." : "Same numbers, other flag: every pixel moves half a cell.", "Drag the white sample point."];
    const cap = drawCaption(g, 16, 16, capLines, { accent: params.mode === "area" ? INK.signal : INK.warn });
    L = layout(g, W, H, cap.h);
    const other = params.mode === "area" ? "point" : "area";
    const otherOff = other === "point" ? 0.5 : 0;
    for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
      const a = P(c - shown, r - shown);
      g.fillStyle = cellColour(VALUES[r * N + c]);
      g.fillRect(Math.round(a[0]), Math.round(a[1]), Math.ceil(L.cs), Math.ceil(L.cs));
    }
    drawGrid(g, shown, "rgba(250,248,243,.6)", { width: 1 });
    const sa = cellOf("area", ...xyOfUV(...sample), params.pixel), sp = cellOf("point", ...xyOfUV(...sample), params.pixel);
    const cellA = params.mode === "area" ? sa : sp, cellB = params.mode === "area" ? sp : sa;
    outlineCell(g, other, cellB[0], cellB[1], INK.violet, "rgba(112,70,166,.10)", [5, 4]);
    outlineCell(g, params.mode, cellA[0], cellA[1], INK.signal, "rgba(29,99,168,.16)", null);
    drawGrid(g, otherOff, "rgba(112,70,166,.75)", { dash: [5, 5], width: 1.25 });
    g.strokeStyle = "rgba(29,99,168,.55)"; g.lineWidth = 1;
    drawGrid(g, shown, "rgba(29,99,168,.45)", { width: 1 });
    g.strokeStyle = INK.brass; g.lineWidth = 2.25; g.lineJoin = "round";
    g.beginPath(); FIELD.forEach(([u, v], i) => { const p = P(u, v); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.closePath(); g.stroke();
    if (params.mode === "area") {
      for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
        const p = P(c + 0.5, r + 0.5);
        g.fillStyle = "rgba(26,25,23,.35)";
        g.beginPath(); g.arc(p[0], p[1], 1.5, 0, Math.PI * 2); g.fill();
      }
    } else {
      for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) {
        const p = P(c + 0.5 - shown, r + 0.5 - shown);
        g.fillStyle = "rgba(26,25,23,.35)";
        g.beginPath(); g.arc(p[0], p[1], 1.5, 0, Math.PI * 2); g.fill();
      }
    }
    const t = P(0, 0);
    g.strokeStyle = INK.brass; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(t[0] - 12, t[1]); g.lineTo(t[0] + 12, t[1]); g.moveTo(t[0], t[1] - 12); g.lineTo(t[0], t[1] + 12); g.stroke();
    g.fillStyle = INK.brass; g.beginPath(); g.arc(t[0], t[1], 4, 0, Math.PI * 2); g.fill();
    const tie = pill(g, t[0] - 10, t[1] - 16, "x0, y0", { color: INK.brass, align: "right" });
    const half = P(shown, 0);
    if (shown > 0.02) {
      g.strokeStyle = INK.warn; g.lineWidth = 1.5;
      const y = L.oy + (M - shown) * L.cs + 18;
      const a = P(0, 0)[0], b = P(-shown, 0)[0];
      g.beginPath(); g.moveTo(a, y); g.lineTo(b, y); g.moveTo(a, y - 5); g.lineTo(a, y + 5); g.moveTo(b, y - 5); g.lineTo(b, y + 5); g.stroke();
      text(g, (a + b) / 2, y + 14, `${fmtNum(halfShift(params.pixel) * (shown / 0.5), 1)} m`, { color: INK.warn, size: 11, weight: 600, align: "center" });
    }
    void half;
    const s = P(sample[0], sample[1]);
    g.fillStyle = "rgba(250,248,243,.9)"; g.beginPath(); g.arc(s[0], s[1], 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = INK.ink; g.lineWidth = 2; g.beginPath(); g.arc(s[0], s[1], 7, 0, Math.PI * 2); g.stroke();
    g.fillStyle = INK.ink; g.beginPath(); g.arc(s[0], s[1], 2.5, 0, Math.PI * 2); g.fill();
    if (hover) {
      g.strokeStyle = "rgba(26,25,23,.35)"; g.setLineDash([3, 4]); g.lineWidth = 1;
      const h = P(hover[0], hover[1]);
      g.beginPath(); g.moveTo(h[0], L.oy - L.cs); g.lineTo(h[0], h[1]); g.moveTo(L.ox - L.cs, h[1]); g.lineTo(h[0], h[1]); g.stroke();
      g.setLineDash([]);
    }
    const formula = drawFormula(g, W, H);
    const file = drawFilePanel(g, W, H);
    drawTicks(g, W, [{ x: 16, y: 16, ...cap }, tie, formula, file]);
  };

  const drawFormula = (g, W, H) => {
    if (L.stack) return null;
    const [x, y] = xyOfUV(...sample);
    const p = params.pixel;
    const fa = (x - X0) / p, fb = (Y0 - y) / p;
    const rows = [
      [["area   ", INK.ink3], ["col = ⌊(x − x0) / dx⌋", INK.ink2], ["        = ⌊", INK.ink3], [fa.toFixed(2), INK.ink], ["⌋ = ", INK.ink3], [String(Math.floor(fa)), params.mode === "area" ? INK.signal : INK.violet, 700]],
      [["point  ", INK.ink3], ["col = ⌊(x − x0) / dx + 0.5⌋", INK.ink2], ["  = ⌊", INK.ink3], [(fa + 0.5).toFixed(2), INK.ink], ["⌋ = ", INK.ink3], [String(Math.floor(fa + 0.5)), params.mode === "point" ? INK.signal : INK.violet, 700]],
      [["area   ", INK.ink3], ["row = ⌊(y0 − y) / |dy|⌋", INK.ink2], ["        = ⌊", INK.ink3], [fb.toFixed(2), INK.ink], ["⌋ = ", INK.ink3], [String(Math.floor(fb)), params.mode === "area" ? INK.signal : INK.violet, 700]],
      [["point  ", INK.ink3], ["row = ⌊(y0 − y) / |dy| + 0.5⌋", INK.ink2], ["  = ⌊", INK.ink3], [(fb + 0.5).toFixed(2), INK.ink], ["⌋ = ", INK.ink3], [String(Math.floor(fb + 0.5)), params.mode === "point" ? INK.signal : INK.violet, 700]],
    ];
    return formulaPanel(g, 16, H - ctx.stage.insetBottom - 16, `Sample at x ${fmtPlain(x, 1)}, y ${fmtPlain(y, 1)}`, rows, { accent: INK.signal, valign: "bottom", size: 11.5, gap: 18 });
  };

  const drawFilePanel = (g, W, H) => {
    const f = FLAGS[params.mode];
    const gt = geoTransformFor(params.mode, params.pixel);
    const wf = worldFile(params.mode, params.pixel);
    const n1 = (v) => fmtPlain(v, Number.isInteger(v) ? 0 : 1);
    const rows = [
      [["GTRasterTypeGeoKey = ", INK.ink2], [String(f.code), INK.brass, 700], [`  ${f.name}`, INK.ink]],
      [["GDAL origin  ", INK.ink3], [`${n1(gt[0])}, ${n1(gt[3])}`, INK.ink]],
      [["world file C, F  ", INK.ink3], [`${n1(wf[4])}, ${n1(wf[5])}`, INK.ink]],
    ];
    if (L.stack) return formulaPanel(g, 16, H - ctx.stage.insetBottom - 12, "What the file says", rows, { accent: INK.brass, valign: "bottom", size: 11, gap: 16 });
    return formulaPanel(g, W - 16, 16, "What the file says", rows, { accent: INK.brass, align: "right", size: 11.5, gap: 18 });
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    const [x, y] = xyOfUV(...sample);
    const a = cellOf("area", x, y, params.pixel), p = cellOf("point", x, y, params.pixel);
    ctx.readout.setMany({
      shift: halfShift(params.pixel),
      cellArea: `(${a[0]}, ${a[1]})`,
      cellPoint: `(${p[0]}, ${p[1]})`,
      flag: `${FLAGS[params.mode].name} = ${FLAGS[params.mode].code}`,
    });
  };

  const animateMode = () => {
    const to = params.mode === "point" ? 0.5 : 0;
    if (shiftTween) shiftTween.cancel();
    const from = shown;
    shiftTween = ctx.anim.tween({ from, to, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => { shown = v; stage.request(); }, onDone: () => { shiftTween = null; shown = to; stage.request(); } });
  };

  const setSample = (uv, commit) => {
    sample = [Math.round(uv[0] * 1000) / 1000, Math.round(uv[1] * 1000) / 1000];
    if (commit) ctx.url.set("point", Math.abs(sample[0] - DEFAULT_POINT[0]) < 1e-9 && Math.abs(sample[1] - DEFAULT_POINT[1]) < 1e-9 ? null : sample.join(","));
    readouts();
    stage.request();
  };

  const nearSample = (X, Y) => { const s = P(sample[0], sample[1]); return Math.hypot(s[0] - X, s[1] - Y) < 14; };
  const clampUV = (uv) => [Math.max(-0.9, Math.min(N - 0.1, uv[0])), Math.max(-0.9, Math.min(M - 0.1, uv[1]))];

  stage.on("move", (X, Y) => {
    if (!L) return;
    const uv = toUV(X, Y);
    const inside = uv[0] > -1 && uv[0] < N + 0.5 && uv[1] > -1 && uv[1] < M + 0.5;
    hover = inside ? uv : null;
    stage.setCursor(armed ? "crosshair" : nearSample(X, Y) ? "grab" : "default");
    if (inside) {
      const [x, y] = xyOfUV(...uv);
      const a = cellOf("area", x, y, params.pixel), p = cellOf("point", x, y, params.pixel);
      stage.chip(X, Y, [`x ${fmtPlain(x, 1)}  y ${fmtPlain(y, 1)}`, `area cell (${a[0]}, ${a[1]})`, `point cell (${p[0]}, ${p[1]})`]);
    } else stage.hideChip();
    stage.request();
  });
  stage.on("leave", () => { hover = null; stage.request(); });
  stage.on("down", (X, Y) => (nearSample(X, Y) && !armed ? { kind: "sample" } : null));
  stage.on("drag", (claim, X, Y) => { stage.setCursor("grabbing"); setSample(clampUV(toUV(X, Y)), false); });
  stage.on("dragEnd", (claim, X, Y, moved) => { if (moved) setSample(sample, true); });
  stage.on("click", (X, Y) => {
    if (!armed) return;
    armed = false;
    ctx.overlay.ripple(X, Y);
    setSample(clampUV(toUV(X, Y)), true);
  });
  stage.on("escape", () => { if (armed) { armed = false; stage.setCursor("default"); stage.request(); } });

  readouts();
  stage.render();

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("mode")) animateMode();
      if (keys.includes("pick") && ctx.side === "A") { armed = true; stage.setCursor("crosshair"); }
      if (keys.includes("snap")) {
        setSample(snapCorner(params.mode, sample), true);
      }
      readouts();
      stage.request();
    },
    resize() { stage.request(); },
    unmount() {
      if (shiftTween) shiftTween.cancel();
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}
