import { chunkOf, runningSums, chunkCount } from "@/core/raster.js";
import { clamp, lerp } from "@/core/math.js";
import { pixelStage, background, text, pill, formulaPanel, spansWidth, hatch, fmtNum, drawCaption, VIRIDIS, rampRGB, INK } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "zarr-chunks",
  title: "Regular and rectilinear chunks",
  track: 6,
  order: 7,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "An array is stored in chunks. A regular axis has one chunk length. A rectilinear axis has a list of lengths. Cuts can fall anywhere, but every cut runs the whole way across. Finding a chunk is a division on a regular axis and a search of running sums on a rectilinear one.",
  deeper: [
    "zarr.json: {\"name\":\"rectilinear\",\"configuration\":{\"kind\":\"inline\",\"chunk_shapes\":[...]}}.",
    "Regular: chunk = floor(index / length).",
    "Rectilinear: chunk = first running sum greater than the index.",
    "Dask has used the same tuple-of-tuples for years.",
  ],
  keywords: ["Zarr", "chunks", "rectilinear", "array"],
  controls: [
    { type: "group", label: "Axes" },
    { key: "rows", type: "segment", label: "Rows", options: [{ value: "regular", label: "regular 25" }, { value: "rectilinear", label: "[10,20,30,40]" }, { value: "months", label: "days per month" }], default: "rectilinear" },
    { key: "year", type: "segment", label: "Year (days per month)", options: [{ value: "2023", label: "2023" }, { value: "2024", label: "2024 (leap)" }], default: "2023" },
    { key: "cols", type: "segment", label: "Columns", options: [{ value: "regular", label: "regular 20" }, { value: "rectilinear", label: "[5,15,40]" }], default: "regular" },
    { type: "group", label: "Index" },
    { key: "ri", type: "number", label: "Row index", min: 0, max: 365, step: 1, default: 37 },
    { key: "ci", type: "number", label: "Column index", min: 0, max: 59, step: 1, default: 12 },
    { type: "group", label: "Display" },
    { key: "showSums", type: "toggle", label: "Running sums", default: true, shortcut: "s" },
    { key: "rl", type: "hidden", default: "" },
    { key: "cl", type: "hidden", default: "" },
    { key: "w", type: "hidden", default: "25,45,8,30" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "The chunk that holds the index" }, { color: "#7046a6", label: "Chunks the read window touches" }, { color: "#b85217", label: "Cut handles (drag them)" }, { color: "rgba(107,102,94,.6)", label: "Padding of a partial last chunk" }] },
  ],
  readouts: [
    { key: "chunk", label: "Chunk (row, col)" },
    { key: "offset", label: "Offset in chunk" },
    { key: "count", label: "Chunk count" },
    { key: "grid", label: "chunk_grid JSON", mono: false },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
export const ROWS = 100, COLS = 60, ITEM = 4, MIN_REGULAR = 4;
export const PRESETS = { rows: { regular: 25, rectilinear: [10, 20, 30, 40] }, cols: { regular: 20, rectilinear: [5, 15, 40] } };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function monthDays(year) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}

export function dayOfYear(index, year) {
  const c = chunkOf(index, monthDays(year));
  return c ? `${c.offset + 1} ${MONTHS[c.chunk]}` : "";
}

export function edges(spec, extent) {
  return typeof spec === "number" ? Array(Math.ceil(extent / spec)).fill(spec) : spec.slice();
}

export function bounds(spec, extent) {
  return [0, ...runningSums(edges(spec, extent))];
}

export function locate(index, spec) {
  return chunkOf(index, spec);
}

export function searchSteps(index, spec) {
  if (typeof spec === "number") return { chunk: Math.floor(index / spec), looks: 1 };
  const sums = runningSums(spec);
  let lo = 0, hi = sums.length - 1, looks = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    looks++;
    if (sums[mid] > index) hi = mid; else lo = mid + 1;
  }
  return { chunk: lo, looks };
}

export function chunkSpan(a0, a1, spec) {
  return [chunkOf(a0, spec).chunk, chunkOf(a1 - 1, spec).chunk];
}

export function chunkKey(r, c) {
  return `c/${r}/${c}`;
}

export function chunkBytes(r, c, rowSpec, colSpec, rowExtent = ROWS, colExtent = COLS, item = ITEM) {
  return edges(rowSpec, rowExtent)[r] * edges(colSpec, colExtent)[c] * item;
}

export function readPlan(win, rowSpec, colSpec, rowExtent = ROWS, colExtent = COLS, item = ITEM) {
  const [rf, rl] = chunkSpan(win.r0, win.r1, rowSpec);
  const [cf, cl] = chunkSpan(win.c0, win.c1, colSpec);
  const keys = [];
  let bytes = 0;
  for (let r = rf; r <= rl; r++) for (let c = cf; c <= cl; c++) {
    keys.push(chunkKey(r, c));
    bytes += chunkBytes(r, c, rowSpec, colSpec, rowExtent, colExtent, item);
  }
  return { keys, bytes, wanted: (win.r1 - win.r0) * (win.c1 - win.c0) * item, rows: [rf, rl], cols: [cf, cl] };
}

export function lastChunk(spec, extent) {
  const e = edges(spec, extent);
  const before = e.slice(0, -1).reduce((a, v) => a + v, 0);
  return { stored: e[e.length - 1], data: extent - before };
}

export function compressRle(list) {
  const out = [];
  let cur = list[0], n = 1;
  for (let i = 1; i <= list.length; i++) {
    if (i < list.length && list[i] === cur) { n++; continue; }
    out.push(n > 1 ? [cur, n] : cur);
    cur = list[i]; n = 1;
  }
  return out.length < list.length ? out : list.slice();
}

export function chunkGrid(rowSpec, colSpec) {
  if (typeof rowSpec === "number" && typeof colSpec === "number") return { name: "regular", configuration: { chunk_shape: [rowSpec, colSpec] } };
  const dim = (s) => (typeof s === "number" ? s : compressRle(s));
  return { name: "rectilinear", configuration: { kind: "inline", chunk_shapes: [dim(rowSpec), dim(colSpec)] } };
}

export function moveCut(spec, extent, k, pos) {
  if (typeof spec === "number") return clamp(Math.round(pos / (k + 1)), MIN_REGULAR, extent);
  const b = bounds(spec, extent);
  const p = clamp(Math.round(pos), b[k], b[k + 2]);
  const out = spec.slice();
  out[k] = p - b[k];
  out[k + 1] = b[k + 2] - p;
  return out;
}

export function dropEmpty(spec) {
  return typeof spec === "number" ? spec : spec.filter((v) => v > 0);
}

export function splitAt(spec, pos) {
  if (typeof spec === "number") return spec;
  const c = chunkOf(pos, spec);
  if (!c || c.offset === 0) return spec.slice();
  const out = spec.slice();
  out.splice(c.chunk, 1, c.offset, c.length - c.offset);
  return out;
}

export function axisSpec(axis, kind, custom, year) {
  const extent = axis === "rows" && kind === "months" ? monthDays(year).reduce((a, v) => a + v, 0) : axis === "rows" ? ROWS : COLS;
  const preset = kind === "months" ? monthDays(year) : PRESETS[axis][kind];
  const raw = String(custom || "").trim();
  if (raw) {
    const nums = raw.split(",").map(Number);
    if (nums.every((v) => Number.isInteger(v) && v > 0)) {
      if (kind === "regular" && nums.length === 1 && nums[0] >= MIN_REGULAR && nums[0] <= extent) return { spec: nums[0], extent };
      if (kind !== "regular" && nums.reduce((a, v) => a + v, 0) === extent) return { spec: nums, extent };
    }
  }
  return { spec: Array.isArray(preset) ? preset.slice() : preset, extent };
}

export function gridSnippet(grid) {
  return grid.name === "regular" ? `"chunk_shape":${JSON.stringify(grid.configuration.chunk_shape)}` : `"chunk_shapes":${JSON.stringify(grid.configuration.chunk_shapes)}`;
}

const encodeSpec = (spec) => (typeof spec === "number" ? String(spec) : spec.join(","));
const sameSpec = (a, b) => encodeSpec(a) === encodeSpec(b);
const fmtB = (b) => `${fmtNum(b)} B`;

export function parseWindow(s, rowExtent, colExtent) {
  const p = String(s || "").split(",").map(Number);
  const ok = p.length === 4 && p.every(Number.isInteger);
  let [r0, r1, c0, c1] = ok ? p : [25, 45, 8, 30];
  r0 = clamp(r0, 0, rowExtent - 1); r1 = clamp(r1, r0 + 1, rowExtent);
  c0 = clamp(c0, 0, colExtent - 1); c1 = clamp(c1, c0 + 1, colExtent);
  return { r0, r1, c0, c1 };
}

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export async function mount(ctx) {
  let params = { ...ctx.params };
  let R = axisSpec("rows", params.rows, params.rl, Number(params.year));
  let C = axisSpec("cols", params.cols, params.cl, 0);
  let win = parseWindow(params.w, R.extent, C.extent);
  let L = null;
  let hoverCell = null;
  let hoverBand = null;
  let hoverCut = null;
  let dragCut = null;
  let fillT = 1, fillKey = "", fillTween = null;
  let morph = { rows: null, cols: null, t: 1 }, morphTween = null;
  let image = null, imageKey = "";
  let first = true;
  let frozen = null;

  const pinned = () => ({ r: clamp(Math.round(params.ri), 0, R.extent - 1), c: clamp(Math.round(params.ci), 0, C.extent - 1) });
  const target = () => hoverCell || pinned();

  const valueAt = (r, c) => {
    const months = params.rows === "months";
    const u = months ? r / R.extent : r / ROWS, v = c / COLS;
    const season = months ? 0.5 - 0.38 * Math.cos(2 * Math.PI * (u - 0.04)) : 0.5 + 0.3 * Math.sin(2 * Math.PI * (u * 0.9 + 0.1));
    return clamp(season + 0.16 * Math.cos(2 * Math.PI * (v * 1.4 + u * 0.6)) + 0.1 * (hash(r, c) - 0.5), 0, 1);
  };

  const buildImage = () => {
    const key = `${params.rows}:${R.extent}`;
    if (key === imageKey && image) return;
    imageKey = key;
    const c = document.createElement("canvas");
    c.width = C.extent; c.height = R.extent;
    const cg = c.getContext("2d");
    const img = cg.createImageData(C.extent, R.extent);
    for (let r = 0; r < R.extent; r++) for (let k = 0; k < C.extent; k++) {
      const col = rampRGB(VIRIDIS, 0.08 + 0.8 * valueAt(r, k));
      const i = (r * C.extent + k) * 4;
      img.data[i] = col[0] * 0.62; img.data[i + 1] = col[1] * 0.62; img.data[i + 2] = col[2] * 0.62; img.data[i + 3] = 255;
    }
    cg.putImageData(img, 0, 0);
    image = c;
  };

  const layoutOf = (W, H, panelW) => {
    const dpr = stage.dpr;
    const narrow = W < 640;
    const RW = narrow ? 0 : panelW;
    const sums = !!params.showSums;
    const capH = 16 + 68 + 14;
    const TB = sums ? 46 : 28;
    const LBand = params.rows === "months" ? 50 : 34;
    const LB = LBand + (sums ? 40 : 8) + 6;
    const top = capH + TB;
    const left = 16 + LB;
    const right = W - (RW ? RW + 32 : 16);
    const bottom = H - ctx.stage.insetBottom - 22;
    const NR = bounds(R.spec, R.extent).at(-1), NC = bounds(C.spec, C.extent).at(-1);
    const cwd = Math.floor(((right - left) * dpr) / NC), chd = Math.floor(((bottom - top) * dpr) / NR);
    let sw = Math.min(cwd, chd), sh = sw;
    const cap = Math.round(22 * dpr);
    if (params.rows === "months") { sh = Math.max(1, Math.min(chd, cap)); sw = Math.max(1, Math.min(cwd, Math.max(sh, Math.round(8 * dpr)))); }
    else if (sw >= 3) { sw = sh = Math.min(sw, cap); } else { sh = Math.max(1, chd); sw = Math.max(1, Math.min(cwd, Math.round(7 * dpr))); }
    const cw = sw / dpr, ch = sh / dpr;
    const gridW = NC * cw;
    const x0 = Math.round((left + Math.max(0, (right - left - gridW) / 2)) * dpr) / dpr;
    const y0 = Math.round(top * dpr) / dpr;
    return { W, H, dpr, narrow, RW, sums, TB, LB, LBand, x0, y0, cw, ch, NR, NC, top, bottom, right, capH };
  };

  const X = (c) => L.x0 + c * L.cw;
  const Y = (r) => L.y0 + r * L.ch;
  const px = (v) => Math.round(v * L.dpr) / L.dpr;
  const hair = () => 1 / L.dpr * Math.max(1, Math.round(L.dpr * 0.75));

  const cutsOf = (axis) => {
    const A = axis === "rows" ? R : C;
    return bounds(A.spec, A.extent);
  };

  const shownCuts = (axis) => {
    const now = cutsOf(axis);
    const old = morph[axis];
    if (!old || morph.t >= 1) return { now, old: null };
    if (old.length === now.length) return { now: now.map((v, i) => lerp(old[i], v, morph.t)), old: null };
    return { now, old };
  };

  const drawArray = (g) => {
    const ext = { r: R.extent, c: C.extent };
    g.save();
    g.imageSmoothingEnabled = false;
    if (image) g.drawImage(image, X(0), Y(0), ext.c * L.cw, ext.r * L.ch);
    g.restore();
    const lw = 1 / L.dpr;
    if (L.cw * L.dpr >= 4 && L.ch * L.dpr >= 4) {
      g.fillStyle = "rgba(250,248,243,.42)";
      for (let c = 1; c < ext.c; c++) g.fillRect(X(c), Y(0), lw, ext.r * L.ch);
      for (let r = 1; r < ext.r; r++) g.fillRect(X(0), Y(r), ext.c * L.cw, lw);
    }
    const padR = L.NR - ext.r, padC = L.NC - ext.c;
    if (padR > 0) {
      hatch(g, X(0), Y(ext.r), L.NC * L.cw, padR * L.ch, { color: "rgba(107,102,94,.45)", step: 6 });
      g.fillStyle = "rgba(107,102,94,.08)"; g.fillRect(X(0), Y(ext.r), L.NC * L.cw, padR * L.ch);
    }
    if (padC > 0) {
      hatch(g, X(ext.c), Y(0), padC * L.cw, ext.r * L.ch, { color: "rgba(107,102,94,.45)", step: 6 });
      g.fillStyle = "rgba(107,102,94,.08)"; g.fillRect(X(ext.c), Y(0), padC * L.cw, ext.r * L.ch);
    }
  };

  const drawChunkLines = (g) => {
    const w = hair();
    const rc = shownCuts("rows"), cc = shownCuts("cols");
    const H0 = Y(0), H1 = Y(L.NR), W0 = X(0), W1 = X(L.NC);
    const line = (cuts, axis, alpha) => {
      g.globalAlpha = alpha;
      for (let i = 1; i < cuts.length - 1; i++) {
        const k = i - 1;
        const hot = (hoverCut && hoverCut.axis === axis && hoverCut.k === k) || (dragCut && dragCut.axis === axis && dragCut.k === k);
        g.fillStyle = hot ? INK.brass : "rgba(26,25,23,.88)";
        const t = hot ? 2 * w : w;
        if (axis === "cols") g.fillRect(px(X(cuts[i]) - t / 2), H0, t, H1 - H0);
        else g.fillRect(W0, px(Y(cuts[i]) - t / 2), W1 - W0, t);
      }
      g.globalAlpha = 1;
    };
    if (rc.old) line(rc.old, "rows", 1 - morph.t);
    if (cc.old) line(cc.old, "cols", 1 - morph.t);
    line(rc.now, "rows", rc.old ? morph.t : 1);
    line(cc.now, "cols", cc.old ? morph.t : 1);
    g.strokeStyle = "rgba(26,25,23,.9)"; g.lineWidth = w;
    g.strokeRect(X(0) - w / 2, Y(0) - w / 2, R.extent && C.extent ? C.extent * L.cw + w : 0, R.extent * L.ch + w);
    if (L.NR > R.extent || L.NC > C.extent) {
      g.setLineDash([4, 3]); g.strokeStyle = "rgba(107,102,94,.8)";
      g.strokeRect(X(0) - w / 2, Y(0) - w / 2, L.NC * L.cw + w, L.NR * L.ch + w);
      g.setLineDash([]);
    }
  };

  const chunkRect = (r, c) => {
    const rb = bounds(R.spec, R.extent), cb = bounds(C.spec, C.extent);
    return { x: X(cb[c]), y: Y(rb[r]), w: (cb[c + 1] - cb[c]) * L.cw, h: (rb[r + 1] - rb[r]) * L.ch };
  };

  const drawWindow = (g, plan) => {
    for (let r = plan.rows[0]; r <= plan.rows[1]; r++) for (let c = plan.cols[0]; c <= plan.cols[1]; c++) {
      const q = chunkRect(r, c);
      g.fillStyle = "rgba(112,70,166,.17)"; g.fillRect(q.x, q.y, q.w, q.h);
    }
    const a = chunkRect(plan.rows[0], plan.cols[0]), b = chunkRect(plan.rows[1], plan.cols[1]);
    g.strokeStyle = "rgba(112,70,166,.85)"; g.lineWidth = 1.5;
    g.strokeRect(a.x, a.y, b.x + b.w - a.x, b.y + b.h - a.y);
    const x = X(win.c0), y = Y(win.r0), w = (win.c1 - win.c0) * L.cw, h = (win.r1 - win.r0) * L.ch;
    g.fillStyle = "rgba(112,70,166,.14)"; g.fillRect(x, y, w, h);
    g.strokeStyle = INK.violet; g.lineWidth = 2; g.setLineDash([6, 3]);
    g.strokeRect(x, y, w, h); g.setLineDash([]);
    g.fillStyle = INK.violet; g.fillRect(x + w - 4, y + h - 4, 8, 8);
  };

  const drawFound = (g, t) => {
    const fr = locate(t.r, R.spec), fc = locate(t.c, C.spec);
    const q = chunkRect(fr.chunk, fc.chunk);
    g.fillStyle = `rgba(29,99,168,${(0.3 * fillT).toFixed(3)})`;
    g.fillRect(q.x, q.y, q.w, q.h);
    g.strokeStyle = INK.signal; g.lineWidth = 2;
    g.strokeRect(q.x, q.y, q.w, q.h);
    const cx = X(t.c), cy = Y(t.r);
    const s = Math.max(L.cw, 3), sh = Math.max(L.ch, 3);
    g.strokeStyle = "#ffffff"; g.lineWidth = 1.5;
    g.strokeRect(cx - (s - L.cw) / 2 - 1, cy - (sh - L.ch) / 2 - 1, s + 2, sh + 2);
    g.fillStyle = "rgba(29,99,168,.55)";
    g.fillRect(X(0) - L.LBand - 6, cy + L.ch / 2 - 0.5, L.LBand + 6 - 2, 1);
    g.fillRect(cx + L.cw / 2 - 0.5, Y(0) - 24, 1, 22);
    return { fr, fc };
  };

  const drawBands = (g, found) => {
    const bandTop = Y(0) - 24, bandH = 18;
    const bandL = X(0) - L.LBand - 6, bandW = L.LBand;
    const segs = (axis) => {
      const b = cutsOf(axis);
      const sh = shownCuts(axis).now;
      const A = axis === "rows" ? R : C;
      const f = axis === "rows" ? found.fr.chunk : found.fc.chunk;
      for (let i = 0; i + 1 < b.length; i++) {
        const a0 = sh[i] ?? b[i], a1 = sh[i + 1] ?? b[i + 1];
        const len = b[i + 1] - b[i];
        const pad = Math.max(0, b[i + 1] - A.extent);
        const hot = hoverBand && hoverBand.axis === axis && hoverBand.chunk === i;
        const fill = i === f ? "rgba(29,99,168,.30)" : i % 2 ? "rgba(60,52,40,.16)" : "rgba(60,52,40,.08)";
        let label = String(len);
        if (axis === "rows" && params.rows === "months" && sameSpec(R.spec, monthDays(Number(params.year)))) label = `${MONTHS[i]} ${len}`;
        if (axis === "cols") {
          const x = X(a0), w = (a1 - a0) * L.cw;
          g.fillStyle = fill; g.fillRect(x, bandTop, w, bandH);
          if (pad) hatch(g, X(A.extent), bandTop, pad * L.cw, bandH, { color: "rgba(107,102,94,.55)", step: 5 });
          if (hot) { g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(x + 0.5, bandTop + 0.5, w - 1, bandH - 1); }
          g.font = "500 10.5px ui-monospace, monospace";
          if (g.measureText(label).width + 4 < w) text(g, x + w / 2, bandTop + bandH / 2 + 0.5, label, { color: i === f ? INK.signal : INK.ink2, size: 10.5, align: "center", halo: false });
        } else {
          const y = Y(a0), h = (a1 - a0) * L.ch;
          g.fillStyle = fill; g.fillRect(bandL, y, bandW, h);
          if (pad) hatch(g, bandL, Y(A.extent), bandW, pad * L.ch, { color: "rgba(107,102,94,.55)", step: 5 });
          if (hot) { g.strokeStyle = "#fff"; g.lineWidth = 1; g.strokeRect(bandL + 0.5, y + 0.5, bandW - 1, h - 1); }
          if (h >= 11) text(g, bandL + bandW / 2, y + h / 2 + 0.5, label, { color: i === f ? INK.signal : INK.ink2, size: 10.5, align: "center", halo: false });
        }
      }
      for (let i = 1; i < b.length - 1; i++) {
        const k = i - 1;
        const hot = (hoverCut && hoverCut.axis === axis && hoverCut.k === k) || (dragCut && dragCut.axis === axis && dragCut.k === k);
        g.fillStyle = hot ? "#d99a0a" : INK.brass;
        const p = sh[i] ?? b[i];
        g.beginPath();
        if (axis === "cols") { const x = X(p); g.moveTo(x - (hot ? 6 : 4.5), bandTop + bandH + 1); g.lineTo(x + (hot ? 6 : 4.5), bandTop + bandH + 1); g.lineTo(x, bandTop + bandH - (hot ? 7 : 5)); }
        else { const y = Y(p); g.moveTo(bandL + bandW + 1, y - (hot ? 6 : 4.5)); g.lineTo(bandL + bandW + 1, y + (hot ? 6 : 4.5)); g.lineTo(bandL + bandW - (hot ? 7 : 5), y); }
        g.closePath(); g.fill();
      }
      if (L.sums) {
        let lastEdge = -Infinity;
        for (let i = 0; i < b.length; i++) {
          const v = sh[i] ?? b[i];
          const lbl = String(Math.round(v));
          const isF = i === f || i === f + 1;
          const col = isF ? INK.signal : INK.ink3;
          if (axis === "cols") {
            const x = X(v);
            if (x - lastEdge < 22 && i !== b.length - 1) continue;
            lastEdge = x;
            text(g, x, bandTop - 9, lbl, { color: col, size: 10, align: "center" });
            g.fillStyle = col; g.fillRect(px(x) - 0.5 / L.dpr, bandTop - 3, 1, 3);
          } else {
            const y = Y(v);
            if (y - lastEdge < 11 && i !== b.length - 1) continue;
            lastEdge = y;
            text(g, bandL - 8, y, lbl, { color: col, size: 10, align: "right" });
            g.fillStyle = col; g.fillRect(bandL - 5, px(y) - 0.5 / L.dpr, 4, 1);
          }
        }
      }
    };
    segs("cols");
    segs("rows");
    const ct = L.sums ? "sums" : "";
    text(g, bandL + bandW, bandTop - (L.sums ? 26 : 10), `cols → ${C.extent}`, { color: INK.ink3, size: 10, align: "right" });
    if (ct) text(g, bandL - 8, bandTop - 9, ct, { color: INK.ink4, size: 10, align: "right" });
    text(g, bandL + bandW / 2, Y(L.NR) + 12, `rows ${R.extent}`, { color: INK.ink3, size: 10, align: "center" });
  };

  const sumsTokens = (spec, extent, found, index) => {
    const b = bounds(spec, extent);
    const lo = Math.max(0, found - 2), hi = Math.min(b.length - 1, found + 3);
    const out = [];
    if (lo > 0) out.push(["… ", INK.ink4]);
    for (let i = lo; i <= hi; i++) {
      const isLo = i === found, isHi = i === found + 1;
      out.push([String(b[i]), isHi ? INK.signal : isLo ? INK.ink : INK.ink3, isHi || isLo ? 700 : 500]);
      if (i < hi) out.push([i === found ? " ≤ " : "  ", i === found ? INK.ink3 : INK.ink3]);
      if (i === found) { out.push([String(index), INK.brass, 700]); out.push([" < ", INK.ink3]); }
    }
    if (hi < b.length - 1) out.push([" …", INK.ink4]);
    return out;
  };

  const axisRows = (name, kind, spec, extent, index) => {
    const f = locate(index, spec);
    const s = searchSteps(index, spec);
    const rows = [];
    if (typeof spec === "number") {
      rows.push([[`${name} `, INK.ink3], ["regular, length ", INK.ink3], [String(spec), INK.ink]]);
      rows.push([["  ", INK.ink3], [String(index), INK.brass, 700], [` ÷ ${spec} = ${(index / spec).toFixed(2)} → `, INK.ink2], [`chunk ${f.chunk}`, INK.signal, 700]]);
      rows.push([["  offset ", INK.ink3], [`${index} − ${f.chunk} × ${spec} = `, INK.ink2], [String(f.offset), INK.ink, 700]]);
    } else {
      rows.push([[`${name} `, INK.ink3], [kind === "months" ? "rectilinear, days per month" : "rectilinear, running sums", INK.ink3]]);
      rows.push([["  ", INK.ink3], ...sumsTokens(spec, extent, f.chunk, index)]);
      rows.push([["  first sum > ", INK.ink3], [String(index), INK.brass, 700], [` is ${f.start + f.length} → `, INK.ink2], [`chunk ${f.chunk}`, INK.signal, 700], [`  (${s.looks} looks)`, INK.ink4]]);
      rows.push([["  offset ", INK.ink3], [`${index} − ${f.start} = `, INK.ink2], [String(f.offset), INK.ink, 700]]);
    }
    return { rows, f };
  };

  const panelSpecs = (plan, t, small, big) => {
    const size = small ? 10.5 : big ? 12.5 : 11, gap = small ? 16 : big ? 19 : 17;
    const rA = axisRows("rows", params.rows, R.spec, R.extent, t.r);
    const cA = axisRows("cols", params.cols, C.spec, C.extent, t.c);
    const key = chunkKey(rA.f.chunk, cA.f.chunk);
    const cb = chunkBytes(rA.f.chunk, cA.f.chunk, R.spec, C.spec, R.extent, C.extent);
    const rows = [...rA.rows, ...cA.rows, [["key ", INK.ink3], [key, INK.signal, 700], ["  ", INK.ink3], [`${edges(R.spec, R.extent)[rA.f.chunk]} × ${edges(C.spec, C.extent)[cA.f.chunk]} × 4 B = ${fmtB(cb)}`, INK.ink2]]];
    if (params.rows === "months") rows.push([["day ", INK.ink3], [dayOfYear(t.r, Number(params.year)), INK.ink], [` ${params.year}`, INK.ink3]]);
    const per = 4;
    const keyLines = [];
    for (let i = 0; i < plan.keys.length && keyLines.length < 3; i += per) keyLines.push([["  ", INK.ink3], [plan.keys.slice(i, i + per).join("  "), INK.violet]]);
    if (plan.keys.length > per * 3) keyLines[2].push([` +${plan.keys.length - per * 3}`, INK.ink3]);
    const rows2 = [
      [["touches ", INK.ink3], [`${plan.keys.length} chunk${plan.keys.length === 1 ? "" : "s"}`, INK.violet, 700], [`  (${plan.rows[1] - plan.rows[0] + 1} × ${plan.cols[1] - plan.cols[0] + 1})`, INK.ink3]],
      ...keyLines,
      [["fetched ", INK.ink3], [fmtB(plan.bytes), INK.ink, 700], ["  wanted ", INK.ink3], [fmtB(plan.wanted), INK.ink2]],
      [["read is ", INK.ink3], [`${(plan.bytes / plan.wanted).toFixed(1)} ×`, INK.brass, 700], [" the window", INK.ink3]],
    ];
    const grid = chunkGrid(R.spec, C.spec);
    const json = [[["{\"name\": ", INK.ink3], [`"${grid.name}"`, INK.brass], [",", INK.ink3]]];
    json.push([[grid.name === "rectilinear" ? " \"configuration\": {\"kind\": \"inline\"," : " \"configuration\": {", INK.ink3]]);
    if (grid.name === "regular") json.push([[`  "chunk_shape": ${JSON.stringify(grid.configuration.chunk_shape)}}}`, INK.ink]]);
    else {
      const dims = grid.configuration.chunk_shapes;
      json.push([["  \"chunk_shapes\": [", INK.ink]]);
      dims.forEach((d, i) => json.push([[`    ${JSON.stringify(d)}${i < dims.length - 1 ? "," : "]}}"}`, INK.ink]]));
    }
    const lr = lastChunk(R.spec, R.extent), lc = lastChunk(C.spec, C.extent);
    const lastLine = (name, l) => l.data === l.stored ? [[`last ${name} chunk `, INK.ink3], [`${l.data} of ${l.stored}`, INK.ink2], [" full", INK.ink3]] : [[`last ${name} chunk `, INK.ink3], [`${l.data} of ${l.stored}`, INK.warn, 700], [", padded to full size", INK.ink3]];
    json.push(lastLine("row", lr), lastLine("col", lc));
    const nr = chunkCount(R.extent, R.spec), nc = chunkCount(C.extent, C.spec);
    json.push([["chunks ", INK.ink3], [`${nr} × ${nc} = ${nr * nc}`, INK.ink, 700], [`  float32, ${fmtB(R.extent * C.extent * ITEM)}`, INK.ink3]]);
    return [
      { title: `Find index (${t.r}, ${t.c})${hoverCell ? "" : " · pinned"}`, rows, accent: INK.signal, size, gap },
      { title: `Read rows ${win.r0}–${win.r1 - 1}, cols ${win.c0}–${win.c1 - 1}`, rows: rows2, accent: INK.violet, size, gap },
      { title: "zarr.json · chunk_grid", rows: json, accent: INK.brass, size: size - 0.5, gap: gap - 2, optional: true },
    ];
  };

  const panelWidth = (g, specs) => {
    let w = 0;
    for (const p of specs) for (const r of p.rows) w = Math.max(w, spansWidth(g, r, { size: p.size }));
    return Math.ceil(w + 36);
  };

  const drawPanels = (g, specs) => {
    if (L.narrow) return;
    let y = 16;
    for (const p of specs) {
      const h = 14 + 14 + p.rows.length * p.gap + 10;
      if (p.optional && y + h > L.H - ctx.stage.insetBottom - 12) continue;
      const box = formulaPanel(g, L.W - 16, y, p.title, p.rows, { accent: p.accent, align: "right", size: p.size, gap: p.gap, minW: L.RW - 36 });
      y = box.y + box.h + 10;
    }
  };

  const caption = () => {
    if (dragCut) return dragCut.regular ? ["One length for the whole axis.", "Every cut moves together. The count changes."] : ["Only this cut moves.", "Its two neighbours change length. Drop it on the next cut to merge."];
    if (params.rows === "months") return [isLeap(Number(params.year)) ? `${params.year} is a leap year: February has 29 days.` : `${params.year} is not a leap year: February has 28 days.`, "One chunk per month. Each cut falls on a month end.", "Point at a day to find its chunk."];
    return ["Point at a cell to find its chunk.", "Drag a brass cut. Click a rectilinear band to add a cut.", "Drag on the array to draw a read window."];
  };

  const draw = (g, W, H) => {
    const plan = readPlan(win, R.spec, C.spec, R.extent, C.extent);
    const t = target();
    const specs = panelSpecs(plan, t, W < 900, W > 1500);
    L = layoutOf(W, H, panelWidth(g, specs));
    if (dragCut && frozen) L = { ...L, x0: frozen.x0, y0: frozen.y0, cw: frozen.cw, ch: frozen.ch };
    background(g, W, H);
    drawCaption(g, 16, 16, caption(), { accent: dragCut ? INK.brass : INK.signal, maxWidth: Math.max(240, W - L.RW - 64) });
    drawArray(g);
    drawWindow(g, plan);
    const found = drawFound(g, t);
    drawChunkLines(g);
    if (hoverBand) {
      const q = hoverBand.axis === "rows" ? { x: X(0), y: Y(cutsOf("rows")[hoverBand.chunk]), w: L.NC * L.cw, h: (cutsOf("rows")[hoverBand.chunk + 1] - cutsOf("rows")[hoverBand.chunk]) * L.ch } : { x: X(cutsOf("cols")[hoverBand.chunk]), y: Y(0), w: (cutsOf("cols")[hoverBand.chunk + 1] - cutsOf("cols")[hoverBand.chunk]) * L.cw, h: L.NR * L.ch };
      g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(q.x, q.y, q.w, q.h);
    }
    drawBands(g, found);
    if (dragCut) {
      const cuts = cutsOf(dragCut.axis);
      const p = cuts[dragCut.k + 1];
      const lbl = dragCut.regular ? `length ${dragCut.axis === "rows" ? R.spec : C.spec} · ${chunkCount(dragCut.axis === "rows" ? R.extent : C.extent, dragCut.axis === "rows" ? R.spec : C.spec)} chunks` : `cut at ${p}`;
      if (dragCut.axis === "cols") pill(g, X(p), Y(L.NR) + 16, lbl, { color: INK.brass });
      else pill(g, X(L.NC / 2), Y(p) - 14, lbl, { color: INK.brass });
    }
    drawPanels(g, specs);
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    const t = pinned();
    const fr = locate(t.r, R.spec), fc = locate(t.c, C.spec);
    const nr = chunkCount(R.extent, R.spec), nc = chunkCount(C.extent, C.spec);
    ctx.readout.setMany({
      chunk: `(${fr.chunk}, ${fc.chunk})  ${chunkKey(fr.chunk, fc.chunk)}`,
      offset: `(${fr.offset}, ${fc.offset})`,
      count: `${nr} × ${nc} = ${nr * nc}`,
      grid: gridSnippet(chunkGrid(R.spec, C.spec)),
    });
  };

  const flashFound = () => {
    const t = target();
    const k = chunkKey(locate(t.r, R.spec).chunk, locate(t.c, C.spec).chunk);
    if (k === fillKey) return;
    fillKey = k;
    if (fillTween) fillTween.cancel();
    if (ctx.reducedMotion) { fillT = 1; return; }
    fillTween = ctx.anim.tween({ from: 0, to: 1, duration: 200, ease: ctx.anim.ease.out, onUpdate: (v) => { fillT = v; stage.request(); }, onDone: () => { fillTween = null; } });
  };

  const setSpecs = (animate) => {
    const oldR = cutsOf("rows"), oldC = cutsOf("cols");
    const nR = axisSpec("rows", params.rows, params.rl, Number(params.year));
    const nC = axisSpec("cols", params.cols, params.cl, 0);
    const changed = !sameSpec(nR.spec, R.spec) || nR.extent !== R.extent || !sameSpec(nC.spec, C.spec);
    const extentChanged = nR.extent !== R.extent;
    R = nR; C = nC;
    win = parseWindow(params.w, R.extent, C.extent);
    buildImage();
    if (!changed) return;
    if (morphTween) morphTween.cancel();
    if (!animate || ctx.reducedMotion || extentChanged) { morph = { rows: null, cols: null, t: 1 }; return; }
    morph = { rows: oldR, cols: oldC, t: 0 };
    morphTween = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.emph, onUpdate: (v) => { morph.t = v; stage.request(); }, onDone: () => { morphTween = null; morph = { rows: null, cols: null, t: 1 }; stage.request(); } });
  };

  const hitCut = (x, y) => {
    if (!L) return null;
    const bandTop = Y(0) - 24, bandL = X(0) - L.LBand - 6;
    const inCols = y >= bandTop - 4 && y <= Y(L.NR) && x >= X(0) - 2 && x <= X(L.NC) + 2;
    const inRows = x >= bandL - 4 && x <= X(L.NC) && y >= Y(0) - 2 && y <= Y(L.NR) + 2;
    let best = null;
    if (inCols) {
      const b = cutsOf("cols");
      for (let i = 1; i < b.length - 1; i++) { const d = Math.abs(X(b[i]) - x); if (d <= 5 && (!best || d < best.d)) best = { axis: "cols", k: i - 1, d }; }
    }
    if (inRows) {
      const b = cutsOf("rows");
      for (let i = 1; i < b.length - 1; i++) { const d = Math.abs(Y(b[i]) - y); if (d <= 5 && (!best || d < best.d)) best = { axis: "rows", k: i - 1, d }; }
    }
    return best;
  };

  const hitBand = (x, y) => {
    if (!L) return null;
    const bandTop = Y(0) - 24, bandL = X(0) - L.LBand - 6;
    if (y >= bandTop && y <= bandTop + 18 && x >= X(0) && x < X(L.NC)) {
      const pos = (x - X(0)) / L.cw;
      const b = cutsOf("cols");
      for (let i = 0; i + 1 < b.length; i++) if (pos >= b[i] && pos < b[i + 1]) return { axis: "cols", chunk: i, pos };
    }
    if (x >= bandL && x <= bandL + L.LBand && y >= Y(0) && y < Y(L.NR)) {
      const pos = (y - Y(0)) / L.ch;
      const b = cutsOf("rows");
      for (let i = 0; i + 1 < b.length; i++) if (pos >= b[i] && pos < b[i + 1]) return { axis: "rows", chunk: i, pos };
    }
    return null;
  };

  const cellAt = (x, y, clampIt = false) => {
    if (!L) return null;
    let c = Math.floor((x - X(0)) / L.cw), r = Math.floor((y - Y(0)) / L.ch);
    if (clampIt) return { r: clamp(r, 0, R.extent - 1), c: clamp(c, 0, C.extent - 1) };
    if (r < 0 || c < 0 || r >= R.extent || c >= C.extent) return null;
    return { r, c };
  };

  const hoverChip = (x, y, cell) => {
    const fr = locate(cell.r, R.spec), fc = locate(cell.c, C.spec);
    const key = chunkKey(fr.chunk, fc.chunk);
    const er = edges(R.spec, R.extent)[fr.chunk], ec = edges(C.spec, C.extent)[fc.chunk];
    const plan = readPlan(win, R.spec, C.spec, R.extent, C.extent);
    const inWin = plan.keys.includes(key);
    const lines = [
      `index (${cell.r}, ${cell.c})${params.rows === "months" ? ` · ${dayOfYear(cell.r, Number(params.year))}` : ""}`,
      `chunk ${key} · offset (${fr.offset}, ${fc.offset})`,
      `chunk object ${er} × ${ec} × 4 B = ${fmtB(er * ec * ITEM)}`,
      `the read touches ${plan.keys.length} chunk${plan.keys.length === 1 ? "" : "s"}, ${fmtB(plan.bytes)}${inWin ? " (this one too)" : ""}`,
    ];
    stage.chip(x, y, lines);
  };

  stage.on("move", (x, y) => {
    if (!L) return;
    const cut = hitCut(x, y);
    const band = cut ? null : hitBand(x, y);
    const cell = cut || band ? null : cellAt(x, y);
    const changed = JSON.stringify([cut && [cut.axis, cut.k], band && [band.axis, band.chunk], cell]) !== JSON.stringify([hoverCut && [hoverCut.axis, hoverCut.k], hoverBand && [hoverBand.axis, hoverBand.chunk], hoverCell]);
    hoverCut = cut; hoverBand = band; hoverCell = cell;
    const nearCorner = Math.abs(x - X(win.c1)) < 8 && Math.abs(y - Y(win.r1)) < 8;
    stage.setCursor(cut ? (cut.axis === "cols" ? "col-resize" : "row-resize") : band ? (Array.isArray(band.axis === "rows" ? R.spec : C.spec) ? "copy" : "default") : nearCorner ? "nwse-resize" : cell ? (cell.r >= win.r0 && cell.r < win.r1 && cell.c >= win.c0 && cell.c < win.c1 ? "move" : "crosshair") : "default");
    if (cell) hoverChip(x, y, cell);
    else if (band) {
      const A = band.axis === "rows" ? R : C;
      const b = bounds(A.spec, A.extent);
      const lines = [`${band.axis} chunk ${band.chunk}: ${band.axis === "rows" ? "rows" : "cols"} ${b[band.chunk]}–${Math.min(b[band.chunk + 1], A.extent) - 1}`, `length ${b[band.chunk + 1] - b[band.chunk]}, running sum ${b[band.chunk + 1]}`];
      if (b[band.chunk + 1] > A.extent) lines.push(`holds ${A.extent - b[band.chunk]}, stored as ${b[band.chunk + 1] - b[band.chunk]}`);
      if (Array.isArray(A.spec)) lines.push("click to add a cut here");
      stage.chip(x, y, lines);
    } else if (cut) stage.chip(x, y, [`${cut.axis} cut ${cut.k + 1} at ${cutsOf(cut.axis)[cut.k + 1]}`, Array.isArray(cut.axis === "rows" ? R.spec : C.spec) ? "drag to move this cut" : "drag to change the one length"]);
    else stage.hideChip();
    if (changed) { flashFound(); stage.request(); }
  });
  stage.on("leave", () => { hoverCell = null; hoverBand = null; hoverCut = null; flashFound(); stage.request(); });

  stage.on("down", (x, y) => {
    if (ctx.side !== "A" || !L) return null;
    const cut = hitCut(x, y);
    if (cut) {
      const A = cut.axis === "rows" ? R : C;
      return { kind: "cut", axis: cut.axis, k: cut.k, regular: typeof A.spec === "number", spec0: Array.isArray(A.spec) ? A.spec.slice() : A.spec };
    }
    const band = hitBand(x, y);
    if (band) return { kind: "band", band };
    if (Math.abs(x - X(win.c1)) < 8 && Math.abs(y - Y(win.r1)) < 8) return { kind: "resize" };
    const cell = cellAt(x, y);
    if (!cell) return null;
    if (cell.r >= win.r0 && cell.r < win.r1 && cell.c >= win.c0 && cell.c < win.c1) return { kind: "move", start: cell, win0: { ...win } };
    return { kind: "new", start: cell };
  });

  stage.on("drag", (claim, x, y) => {
    if (claim.kind === "cut") {
      const A = claim.axis === "rows" ? R : C;
      const pos = claim.axis === "rows" ? (y - Y(0)) / L.ch : (x - X(0)) / L.cw;
      const next = moveCut(claim.spec0, A.extent, claim.k, pos);
      if (!dragCut) { dragCut = claim; frozen = L; hoverCut = null; stage.hideChip(); }
      if (claim.regular && next !== A.spec) {
        const before = chunkCount(A.extent, A.spec), after = chunkCount(A.extent, next);
        A.spec = next;
        if (before !== after) dragCut = { ...claim, k: Math.min(claim.k, after - 2) };
      } else if (!claim.regular) A.spec = next;
      win = parseWindow(`${win.r0},${win.r1},${win.c0},${win.c1}`, R.extent, C.extent);
      readouts();
      stage.request();
      return;
    }
    if (claim.kind === "band") return;
    const cell = cellAt(x, y, true);
    if (claim.kind === "move") {
      const h = claim.win0.r1 - claim.win0.r0, w = claim.win0.c1 - claim.win0.c0;
      const r0 = clamp(claim.win0.r0 + cell.r - claim.start.r, 0, R.extent - h), c0 = clamp(claim.win0.c0 + cell.c - claim.start.c, 0, C.extent - w);
      win = { r0, r1: r0 + h, c0, c1: c0 + w };
    } else if (claim.kind === "resize") {
      win = { ...win, r1: Math.max(win.r0 + 1, cell.r + 1), c1: Math.max(win.c0 + 1, cell.c + 1) };
    } else if (claim.kind === "new") {
      win = { r0: Math.min(claim.start.r, cell.r), r1: Math.max(claim.start.r, cell.r) + 1, c0: Math.min(claim.start.c, cell.c), c1: Math.max(claim.start.c, cell.c) + 1 };
    }
    stage.hideChip();
    readouts();
    stage.request();
  });

  stage.on("dragEnd", (claim, x, y, moved) => {
    if (claim.kind === "cut") {
      dragCut = null;
      frozen = null;
      if (!moved) { stage.request(); return; }
      const A = claim.axis === "rows" ? R : C;
      A.spec = dropEmpty(A.spec);
      const key = claim.axis === "rows" ? "rl" : "cl";
      params[key] = encodeSpec(A.spec);
      ctx.controls.set(key, params[key]);
      readouts();
      stage.request();
      return;
    }
    if (claim.kind === "band") {
      if (moved) return;
      const A = claim.band.axis === "rows" ? R : C;
      if (!Array.isArray(A.spec)) return;
      const next = splitAt(A.spec, Math.round(claim.band.pos));
      if (sameSpec(next, A.spec)) return;
      const key = claim.band.axis === "rows" ? "rl" : "cl";
      ctx.controls.set(key, encodeSpec(next));
      ctx.overlay.ripple(x, y);
      return;
    }
    if (moved) ctx.controls.set("w", `${win.r0},${win.r1},${win.c0},${win.c1}`);
  });

  stage.on("click", (x, y) => {
    if (ctx.side !== "A") return;
    const cell = cellAt(x, y);
    if (!cell || hitCut(x, y)) return;
    ctx.controls.set("ri", cell.r);
    ctx.controls.set("ci", cell.c);
    ctx.overlay.ripple(x, y);
  });

  buildImage();
  ctx.controls.disable("year", params.rows !== "months");
  readouts();
  stage.render();

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      const bulk = first || keys.length > 4;
      if (!bulk && ((keys.includes("rows") && prev.rows !== params.rows) || (keys.includes("year") && prev.year !== params.year)) && params.rl) {
        params.rl = "";
        ctx.controls.set("rl", "", { silent: true });
        ctx.url.set("rl", null);
      }
      if (!bulk && keys.includes("cols") && prev.cols !== params.cols && params.cl) {
        params.cl = "";
        ctx.controls.set("cl", "", { silent: true });
        ctx.url.set("cl", null);
      }
      setSpecs(!bulk);
      ctx.controls.disable("year", params.rows !== "months");
      first = false;
      flashFound();
      readouts();
      stage.request();
    },
    resize() { stage.request(); },
    unmount() {
      if (fillTween) fillTween.cancel();
      if (morphTween) morphTween.cancel();
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}
