import { grid as l3grid, binInfo, binToBounds, rowOfLat, binArea } from "@/core/l3bins.js";
import { DEG, clamp, smoothstep, lerp } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const R_KM = 6371.0088;
const EPS = 1e-4;

export const meta = {
  id: "l3-bins",
  title: "Equal-area rows for the ocean",
  track: 5,
  order: 8,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Ocean-colour products store data in bins of nearly equal area. Cut the globe into rows of equal height. Each row holds a whole number of bins, as many as fit around its middle. Near the poles a row has few bins. Each bin has a number from the south-west corner.",
  deeper: [
    "Bins per row = round(2·rows·cos φ).",
    "2,160 rows give 5,940,422 bins.",
    "The first row has 3 bins; the equator row has 4,320.",
    "A bin at 2,160 rows is about 9.3 km.",
  ],
  keywords: ["L3", "bins", "equal-area", "rows", "ocean colour", "SeaWiFS"],
  controls: [
    { key: "rows", type: "segment", label: "Rows", options: [{ value: "180", label: "180" }, { value: "540", label: "540" }, { value: "2160", label: "2160" }], default: "540" },
    { key: "point", type: "point", label: "Place", default: [-40, 30] },
    { key: "bin", type: "number", label: "Bin number", min: 0, max: 5940422, step: 1, default: 0 },
    { type: "legend", label: "Key", items: [
      { color: "rgba(26,25,23,.75)", line: true, label: "Outline of the rows" },
      { color: BRASS, line: true, label: "Bins near the place" },
      { color: SIGNAL, line: true, label: "The bin of the place" },
    ] },
  ],
  readouts: [
    { key: "row", label: "Row" },
    { key: "inRow", label: "Bins in row" },
    { key: "bin", label: "Bin number", hero: true },
    { key: "width", label: "Bin width", digits: 2, unit: "km" },
    { key: "total", label: "Total bins" },
  ],
  transport: { label: ["globe", "stored rows"], key: "m" },
  compare: null,
  view: { lon: -30, lat: 25, dist: 3.1 },
  data: [],
};

const PREFIX = meta.id + ":";
const FIT_PADDING = 28;
const grids = new Map();
export const gridOf = (rows) => { const n = +rows; if (!grids.has(n)) grids.set(n, l3grid(n)); return grids.get(n); };

export function binsPerRowFormula(rows, rowIndex) {
  const lat = -90 + ((rowIndex + 0.5) * 180) / rows;
  return Math.round(2 * rows * Math.cos(lat * DEG));
}

export function binWidthKm(g, row) {
  const lat = g.latOfRow(row);
  return (2 * Math.PI * R_KM * Math.cos(lat * DEG)) / g.binsPerRow[row];
}

export function makeMorph(g) {
  const N = g.numRows;
  const factor = (lat) => {
    const r = rowOfLat(g, lat);
    return g.binsPerRow[r] / (2 * N);
  };
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    const lam = clamp(lon, -180, 180) * DEG, phi = lat * DEG;
    if (t <= 1 / 3) {
      const a = smoothstep(0, 1, t * 3);
      const r = lerp(Math.cos(phi), 1, a), y = lerp(Math.sin(phi), phi, a);
      out[0] = r * Math.sin(lam); out[1] = y; out[2] = r * Math.cos(lam);
      return out;
    }
    const f = factor(lat);
    const b = smoothstep(0, 1, clamp((t - 1 / 3) * 3, 0, 1));
    const c = smoothstep(0, 1, clamp((t - 2 / 3) * 3, 0, 1));
    const s = lam * lerp(1, f, b);
    const kap = Math.max((1 - b) * (1 - b), 0.002);
    const R = 1 / kap;
    let x = R * Math.sin(s / R);
    const z = 1 - R + R * Math.cos(s / R) - b;
    if (c > 0) x = lerp(x, -Math.PI + (lam + Math.PI) * f, c);
    out[0] = x; out[1] = phi; out[2] = z;
    return out;
  };
  fn.phased = true; fn.seam = 180; fn.tear = Infinity;
  return fn;
}

export function finalXY(g, lon, lat) {
  const r = rowOfLat(g, lat);
  const f = g.binsPerRow[r] / (2 * g.numRows);
  return [-Math.PI + (lon * DEG + Math.PI) * f, lat * DEG];
}

const rowLat = (g, r, edge) => -90 + ((r + edge) * 180) / g.numRows;

function outlineSegments(g) {
  const segs = [];
  const N = g.numRows;
  for (const e of [-180 + EPS, 180 - EPS]) {
    for (let r = 0; r < N; r++) {
      const a = rowLat(g, r, 0) + EPS, b = rowLat(g, r, 1) - EPS;
      const steps = Math.max(1, Math.round((b - a) / 2));
      for (let k = 0; k < steps; k++) segs.push([[e, a + ((b - a) * k) / steps], [e, a + ((b - a) * (k + 1)) / steps]]);
      if (r < N - 1) segs.push([[e, rowLat(g, r, 1) - EPS], [e, rowLat(g, r, 1) + EPS]]);
    }
  }
  for (const [lat, inner] of [[-90 + EPS, 1], [90 - EPS, -1]]) {
    void inner;
    for (let lo = -180 + EPS; lo < 180 - EPS; lo += 6) segs.push([[lo, lat], [Math.min(lo + 6, 180 - EPS), lat]]);
  }
  return segs;
}

function parallelSegments(g, every) {
  const segs = [];
  for (let r = every; r < g.numRows; r += every) {
    const lat = rowLat(g, r, 0);
    for (const s of [EPS, -EPS]) for (let lo = -180 + EPS; lo < 180 - EPS; lo += 4) segs.push([[lo, lat + s], [Math.min(lo + 4, 180 - EPS), lat + s]]);
  }
  return segs;
}

function neighbourhood(g, lon, lat, dr = 5, dc = 22) {
  const p = binInfo(g, lon, lat);
  const segs = [];
  for (let r = Math.max(0, p.row - dr); r <= Math.min(g.numRows - 1, p.row + dr); r++) {
    const n = g.binsPerRow[r];
    const s = rowLat(g, r, 0) + EPS, nn = rowLat(g, r, 1) - EPS;
    const col = clamp(Math.floor((((lon + 180) % 360 + 360) % 360) * n / 360), 0, n - 1);
    const c0 = Math.max(0, col - dc), c1 = Math.min(n, col + dc + 1);
    for (let c = c0; c <= c1; c++) {
      const lo = clamp(-180 + (c * 360) / n, -180 + EPS, 180 - EPS);
      segs.push([[lo, s], [lo, nn]]);
    }
    const w0 = -180 + (c0 * 360) / n, w1 = -180 + (c1 * 360) / n;
    const st = Math.max(0.05, (w1 - w0) / 24);
    for (let lo = w0; lo < w1 - 1e-9; lo += st) { segs.push([[lo, s], [Math.min(lo + st, w1), s]]); segs.push([[lo, nn], [Math.min(lo + st, w1), nn]]); }
  }
  return segs;
}

export const COMPACT_W = 640;

export function panelLayout(W, H) {
  if (W >= COMPACT_W) return { compact: false, x: 16, padX: 12, padY: 10, cw: 300, rows: H < 600 ? 3 : 5, rowH: 34, binPx: 60, across: 0, caption: true };
  const x = 8, padX = 10, padY = 8;
  return { compact: true, x, padX, padY, cw: Math.max(200, W - 2 * x - 2 * padX - 2), rows: 3, rowH: 22, binPx: 0, across: 3, caption: H >= 400 };
}

export function panelModel(g, picked, L, measure) {
  const half = (L.rows - 1) / 2;
  const centre = clamp(picked.row, half, g.numRows - 1 - half);
  const rows = [];
  for (let k = 0; k < L.rows; k++) {
    const r = centre + half - k;
    if (r >= 0 && r < g.numRows) rows.push({ r, y: k * L.rowH, text: `row ${r + 1}` });
  }
  const ax0 = Math.ceil(Math.max(...rows.map((o) => measure(o.text)))) + 8, ax1 = L.cw, mid = (ax0 + ax1) / 2;
  const ref = binToBounds(g, picked.bin);
  const binPx = L.across ? (ax1 - ax0) / L.across : L.binPx;
  const pxPerDeg = binPx / (ref.east - ref.west), cx = (ref.west + ref.east) / 2;
  const lo0 = cx - (mid - ax0) / pxPerDeg, lo1 = cx + (ax1 - mid) / pxPerDeg;
  const cells = [];
  for (const o of rows) {
    const n = g.binsPerRow[o.r];
    const c0 = Math.max(0, Math.floor(((lo0 + 180) * n) / 360)), c1 = Math.min(n - 1, Math.floor(((lo1 + 180) * n) / 360));
    for (let col = c0; col <= c1; col++) {
      const x0 = mid + (-180 + (col * 360) / n - cx) * pxPerDeg, x1 = mid + (-180 + ((col + 1) * 360) / n - cx) * pxPerDeg;
      const bin = g.basebin[o.r] + col;
      const text = bin.toLocaleString("en-US"), tw = measure(text), tx = (x0 + x1) / 2;
      const fits = tw + 6 <= x1 - x0 && tx - tw / 2 >= ax0 + 3 && tx + tw / 2 <= ax1 - 3;
      cells.push({ x0, x1, y: o.y, bin, on: bin === picked.bin, text: fits ? text : null, tx, tw });
    }
  }
  return { ax0, ax1, h: L.rows * L.rowH, rowH: L.rowH, rows, cells };
}

export const captionTexts = (row, n) => [
  `Row ${row} holds ${n} bins. The rows above and below hold a different number.`,
  `Row ${row} holds ${n} bins. Other rows hold a different number.`,
  `Row ${row} holds ${n} bins.`,
];

function binOutline(g, bin) {
  const b = binToBounds(g, bin);
  if (!b) return [];
  const s = b.south + EPS, n = b.north - EPS, w = Math.max(b.west, -180 + EPS), e = Math.min(b.east, 180 - EPS);
  const segs = [];
  const st = Math.max(0.02, (e - w) / 16);
  for (let lo = w; lo < e - 1e-12; lo += st) { segs.push([[lo, s], [Math.min(lo + st, e), s]]); segs.push([[lo, n], [Math.min(lo + st, e), n]]); }
  segs.push([[w, s], [w, n]], [[e, s], [e, n]]);
  return segs;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let g = gridOf(params.rows);
  let morph = makeMorph(g);
  let booted = false;
  let oriented = false;
  let picked = null;
  let pulse = null;
  let syncing = false;

  globe.morph(morph, t);
  globe.labelInsetBottom = ctx.stage.insetBottom;
  globe.addLabel3D(PREFIX + "bin-label", null, "", { color: SIGNAL, dx: 12, dy: -22, occlude: true });

  const panel = ctx.stage.element("div", "l3-panel");
  panel.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:auto;height:auto;padding:10px 12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;";
  const pTitle = document.createElement("div");
  pTitle.style.cssText = `font:600 12px/16px ${FONT_UI};color:${INK};margin-bottom:6px;`;
  const pCanvas = document.createElement("canvas");
  const pCap = document.createElement("div");
  pCap.style.cssText = `font:500 11px/15px ${FONT_MONO};color:${INK2};margin-top:6px;max-width:300px;`;
  panel.append(pTitle, pCanvas, pCap);
  const meter = document.createElement("canvas").getContext("2d");
  let L = null;
  const applyLayout = () => {
    L = panelLayout(ctx.stage.width, ctx.stage.height);
    panel.style.left = panel.style.top = L.x + "px";
    panel.style.padding = `${L.padY}px ${L.padX}px`;
    panel.style.borderRadius = L.compact ? "12px" : "14px";
    pTitle.style.marginBottom = L.compact ? "4px" : "6px";
    pCap.style.display = L.caption ? "" : "none";
    pCap.style.marginTop = L.compact ? "4px" : "6px";
    pCap.style.maxWidth = L.cw + "px";
    pCap.style.whiteSpace = L.compact ? "nowrap" : "";
  };
  applyLayout();
  globe.labelLayer.avoid = () => [[panel.offsetLeft - 4, panel.offsetTop - 4, panel.offsetLeft + panel.offsetWidth + 4, panel.offsetTop + panel.offsetHeight + 4]];

  const drawStatic = () => {
    globe.addLines(PREFIX + "outline", outlineSegments(g), { color: "rgba(26,25,23,.75)", width: 1.25 });
    globe.addLines(PREFIX + "rows", parallelSegments(g, Math.max(1, Math.round(g.numRows / 36))), { color: "rgba(26,25,23,.28)", width: 1 });
  };

  const drawLocal = () => {
    const [lon, lat] = params.point;
    picked = binInfo(g, lon, lat);
    globe.addLines(PREFIX + "near", neighbourhood(g, lon, lat), { color: "rgba(184,82,23,.75)", width: 1 });
    globe.addLines(PREFIX + "bin", binOutline(g, picked.bin), { color: SIGNAL, width: 2.5 });
    const b = binToBounds(g, picked.bin);
    globe.setLabel3D(PREFIX + "bin-label", { point: [...morph((b.west + b.east) / 2, b.north, t, [0, 0, 0])], text: `bin ${picked.bin.toLocaleString("en-US")}` });
  };

  const drawPanel = () => {
    if (!picked) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = pCanvas.getContext("2d");
    c.font = `500 9.5px ${FONT_MONO}`;
    const M = panelModel(g, picked, L, (s) => c.measureText(s).width);
    const W = L.cw, H = M.h, rowH = M.rowH;
    pCanvas.width = W * dpr; pCanvas.height = H * dpr;
    pCanvas.style.width = W + "px"; pCanvas.style.height = H + "px";
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.rect(M.ax0, 0, M.ax1 - M.ax0, H); c.clip();
    for (const cell of M.cells) {
      const { x0, x1, y, on } = cell;
      c.fillStyle = on ? "rgba(29,99,168,.32)" : "rgba(250,248,243,1)";
      c.fillRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, rowH - 1);
      c.strokeStyle = on ? SIGNAL : "rgba(184,82,23,.45)"; c.lineWidth = on ? 1.5 : 1;
      c.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, rowH - 1);
    }
    c.restore();
    c.font = `500 9.5px ${FONT_MONO}`; c.textAlign = "center"; c.textBaseline = "middle";
    for (const cell of M.cells) if (cell.text) { c.fillStyle = cell.on ? INK : INK3; c.fillText(cell.text, cell.tx, cell.y + rowH / 2); }
    c.fillStyle = INK2; c.textAlign = "left";
    for (const o of M.rows) c.fillText(o.text, 0, o.y + rowH / 2);
    pTitle.textContent = "Bins near the place, rows stacked";
    const caps = captionTexts(picked.row + 1, picked.binsInRow.toLocaleString("en-US"));
    meter.font = `500 11px ${FONT_MONO}`;
    pCap.textContent = L.compact ? caps.find((s) => meter.measureText(s).width <= W) || caps[caps.length - 1] : caps[0];
  };

  const readouts = () => {
    if (!picked) return;
    ctx.readout.setMany({ row: `${picked.row + 1} of ${g.numRows.toLocaleString("en-US")}`, inRow: picked.binsInRow.toLocaleString("en-US"), bin: picked.bin.toLocaleString("en-US"), width: binWidthKm(g, picked.row), total: g.total.toLocaleString("en-US") });
  };

  const sheetPoints = () => {
    const pts = [];
    for (const lat of [-89.9, -60, -30, 0, 30, 60, 89.9]) for (const lon of [-179.99, -90, 0, 90, 179.99]) pts.push([...morph(lon, lat, t, [0, 0, 0])]);
    return pts;
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) { oriented = false; return; }
    if (!oriented) { oriented = true; globe.camera.lookAt(0, 0, null, { duration: booted && !ctx.reducedMotion ? 500 : 0 }); }
    const f = globe.camera.fit(sheetPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, insetTop: (panel.offsetTop + panel.offsetHeight) * smoothstep(0.3, 0.7, t), minDist: meta.view.dist, apply: false });
    const w = smoothstep(0, 0.15, t);
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0] * w, f.pan[1] * w);
  };

  const startPulse = () => {
    if (pulse) pulse.cancel();
    if (!booted || ctx.reducedMotion || !picked) return;
    const segs = binOutline(g, picked.bin);
    pulse = ctx.anim.tween({ from: 0, to: 1, duration: 700, ease: ctx.anim.ease.out, onUpdate: (u) => {
      globe.addLines(PREFIX + "pulse", segs, { color: `rgba(29,99,168,${(1 - u).toFixed(3)})`, width: 2.5 + 7 * u });
    }, onDone: () => { pulse = null; globe.remove(PREFIX + "pulse"); } });
  };

  const syncBinControl = () => {
    if (!picked || ctx.side !== "A") return;
    syncing = true;
    ctx.controls.set("bin", picked.bin, { silent: true });
    syncing = false;
  };

  drawStatic();
  drawLocal();
  drawPanel();
  readouts();
  if (params.bin > 0 && params.bin <= g.total) {
    const b = binToBounds(g, params.bin);
    params.point = [(b.west + b.east) / 2, (b.south + b.north) / 2];
    drawLocal(); drawPanel(); readouts();
  } else syncBinControl();
  if (L.compact && t === 0 && ctx.side === "A") globe.camera.lookAt(params.point[0], params.point[1], null, { duration: 0 });

  if (ctx.transport) ctx.transport.onScrub((v) => {
    t = v;
    globe.setMorphT(t);
    if (picked) { const b = binToBounds(g, picked.bin); globe.setLabel3D(PREFIX + "bin-label", { point: [...morph((b.west + b.east) / 2, b.north, t, [0, 0, 0])] }); }
    frameCamera();
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (syncing) return;
      if (keys.includes("rows")) {
        g = gridOf(params.rows);
        morph = makeMorph(g);
        globe.morph(morph, t);
        drawStatic();
      }
      if (keys.length === 1 && keys[0] === "bin") {
        const bin = Math.round(params.bin);
        if (bin < 1 || bin > g.total) { ctx.snack(`Type a bin from 1 to ${g.total.toLocaleString("en-US")}.`); return; }
        const b = binToBounds(g, bin);
        Promise.resolve().then(() => ctx.controls.set("point", [+((b.west + b.east) / 2).toFixed(5), +((b.south + b.north) / 2).toFixed(5)]));
        return;
      }
      drawLocal();
      drawPanel();
      readouts();
      if (keys.includes("point") || keys.includes("rows")) { syncBinControl(); startPulse(); }
      if (keys.includes("point") && t === 0 && booted && ctx.side === "A") globe.camera.lookAt(params.point[0], params.point[1], null, { duration: ctx.reducedMotion ? 0 : 650 });
      if (keys.length > 2 && t > 0) frameCamera();
    },
    hover(lon, lat) {
      const i = binInfo(g, lon, lat);
      return [`bin ${i.bin.toLocaleString("en-US")}`, `row ${i.row + 1}, ${i.binsInRow.toLocaleString("en-US")} bins`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      applyLayout();
      drawPanel();
      if (t > 0) frameCamera();
    },
    unmount() {
      if (pulse) pulse.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      globe.labelLayer.avoid = null;
      panel.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}

export { binArea };
