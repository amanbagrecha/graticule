import { resample, sample, weights, interp1, cubicWeight, clipRingToRect, signedArea } from "@/core/raster.js";
import { mixOklab, hexToRgb, css } from "@/core/palette.js";
import { clamp } from "@/core/math.js";
import { pixelStage, background, text, panel, formulaPanel, fmtNum, fmtPlain, trimNum, drawCaption, imageCanvas, decodeScene, INK, FONT_UI, FONT_MONO } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "resampling",
  title: "Nearest, bilinear, cubic",
  track: 6,
  order: 9,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "When a grid changes, each new pixel must get a value from the old ones. Nearest copies the closest pixel. Bilinear blends four. Cubic blends sixteen and can overshoot. For classes use nearest. For images use bilinear or cubic. When shrinking, average over the area instead.",
  deeper: [
    "Bilinear of 0 and 10 at the midpoint = 5.",
    "Cubic (Keys, a = −0.5) can give values below 0 or above 10 near a step.",
    "Nearest never invents a value.",
    "Area averaging is the right way to shrink.",
  ],
  keywords: ["resampling", "nearest", "bilinear", "cubic", "interpolation", "average", "overshoot", "warp"],
  controls: [
    { type: "group", label: "Methods" },
    { key: "nearest", type: "toggle", label: "Nearest", default: true },
    { key: "bilinear", type: "toggle", label: "Bilinear", default: true },
    { key: "cubic", type: "toggle", label: "Cubic", default: true },
    { key: "factor", type: "range", label: "Upsample factor", min: 2, max: 8, step: 1, default: 4, unit: " ×", ticks: [2, 4, 6, 8] },
    { key: "source", type: "segment", label: "Source", options: [{ value: "step", label: "Step" }, { value: "spike", label: "Spike" }, { value: "gradient", label: "Gradient" }, { value: "classes", label: "Classes" }], default: "step" },
    { key: "mode", type: "segment", label: "Mode", options: [{ value: "upsample", label: "Upsample" }, { value: "reproject", label: "Reproject" }], default: "upsample" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", line: true, label: "Nearest" }, { color: "#1d63a8", line: true, label: "Bilinear" }, { color: "#7046a6", line: true, label: "Cubic" }, { color: "#b42335", label: "Value outside the source range, or not a class" }] },
  ],
  readouts: [
    { key: "nearest", label: "Nearest", digits: 2 },
    { key: "bilinear", label: "Bilinear", digits: 2 },
    { key: "cubic", label: "Cubic", digits: 2, hero: true },
    { key: "area", label: "Area mean", digits: 2 },
    { key: "range", label: "Cubic min / max" },
    { key: "overshoot", label: "Overshoot" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["scene_synthetic.json"],
};

const PREFIX = meta.id + ":";
export const METHODS = ["nearest", "bilinear", "cubic"];
export const METHOD_COLOUR = { nearest: INK.brass, bilinear: INK.signal, cubic: INK.violet };
const METHOD_NAME = { nearest: "Nearest", bilinear: "Bilinear", cubic: "Cubic" };
export const N = 8;
export const RP = 48;
export const SCENE_CROP = { x0: 60, y0: 74 };

export const CLASSES = {
  1: { name: "water", color: "#2f7ea6" },
  2: { name: "vegetation", color: "#5f9a4b" },
  3: { name: "soil", color: "#b39a62" },
  4: { name: "urban", color: "#3f3c37" },
  5: { name: "burned", color: "#7a4a3a" },
  6: { name: "cloud", color: "#1a1917" },
  7: { name: "shadow", color: "#3a4160" },
};

const CLASS_MAP = [
  1, 1, 1, 2, 2, 2, 3, 3,
  1, 1, 2, 2, 2, 3, 3, 3,
  1, 1, 2, 2, 4, 4, 3, 3,
  1, 3, 2, 4, 4, 4, 3, 3,
  1, 3, 2, 4, 4, 3, 3, 3,
  1, 1, 2, 2, 3, 3, 3, 3,
  1, 1, 1, 2, 2, 3, 3, 2,
  1, 1, 1, 1, 2, 2, 2, 2,
];

export function makeSource(name) {
  const data = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (name === "step") data[i] = x >= 4 ? 10 : 0;
    else if (name === "spike") data[i] = x === 3 && y === 3 ? 10 : 0;
    else if (name === "gradient") data[i] = (10 * (x + y)) / 14;
    else data[i] = CLASS_MAP[i];
  }
  const classes = name === "classes";
  return { width: N, height: N, data, kind: classes ? "classes" : "value", lo: classes ? 1 : 0, hi: classes ? 4 : 10, synthetic: true };
}

let seed = 7;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

export function makeReprojectSource(name, scene) {
  const data = new Float64Array(RP * RP);
  if (name === "classes" && scene) {
    for (let y = 0; y < RP; y++) for (let x = 0; x < RP; x++) data[y * RP + x] = scene.classes[(SCENE_CROP.y0 + y) * scene.width + SCENE_CROP.x0 + x];
    return { width: RP, height: RP, data, kind: "classes", lo: 1, hi: 7, synthetic: true };
  }
  if (name === "step") {
    const a = (68 * Math.PI) / 180, nx = Math.cos(a), ny = Math.sin(a);
    for (let y = 0; y < RP; y++) for (let x = 0; x < RP; x++) data[y * RP + x] = (x + 0.5 - 24) * nx + (y + 0.5 - 24) * ny > 0 ? 10 : 0;
  } else if (name === "spike") {
    seed = 7;
    for (let k = 0; k < 46; k++) data[Math.floor(rand() * RP) * RP + Math.floor(rand() * RP)] = 10;
    const lines = [[2, 9, 45, 30], [6, 44, 40, 4], [30, 2, 34, 46]];
    for (const [x0, y0, x1, y1] of lines) {
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
      for (let s = 0; s <= steps; s++) data[Math.round(y0 + ((y1 - y0) * s) / steps) * RP + Math.round(x0 + ((x1 - x0) * s) / steps)] = 10;
    }
  } else {
    for (let y = 0; y < RP; y++) for (let x = 0; x < RP; x++) data[y * RP + x] = (10 * (x + y)) / (2 * (RP - 1));
  }
  return { width: RP, height: RP, data, kind: "value", lo: 0, hi: 10, synthetic: true };
}

export const srcPos = (o, f) => (o + 0.5) / f - 0.5;

export function upsample(src, f, method) {
  return resample(src, src.width * f, src.height * f, method);
}

export function taps1(method, x, n) {
  const at = (i) => clamp(i, 0, n - 1);
  if (method === "nearest") return [{ i: at(Math.floor(x + 0.5)), d: Math.floor(x + 0.5) - x, w: 1 }];
  const i0 = Math.floor(x), t = x - i0;
  const w = weights(method, t);
  const start = method === "bilinear" ? i0 : i0 - 1;
  return w.map((wk, k) => ({ i: at(start + k), d: start + k - x, w: wk }));
}

export function tapsFor(src, method, x, y) {
  const tx = taps1(method, x, src.width), ty = taps1(method, y, src.height);
  const merged = new Map();
  let value = 0;
  for (const b of ty) for (const a of tx) {
    const w = a.w * b.w;
    const k = b.i * src.width + a.i;
    merged.set(k, (merged.get(k) || 0) + w);
    value += w * src.data[k];
  }
  const cells = [...merged].map(([k, w]) => ({ i: k % src.width, j: Math.floor(k / src.width), w })).filter((c) => Math.abs(c.w) > 1e-12);
  return { x, y, tx, ty, cells, value };
}

export function profileValue(values, x, method) {
  return interp1(values, x, method);
}

export function rangeOf(arr) {
  let min = Infinity, max = -Infinity;
  for (const v of arr) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}

export function overshoot(src, out, eps = 1e-9) {
  const s = rangeOf(src.data), o = rangeOf(out.data);
  return { below: o.min < s.min - eps, above: o.max > s.max + eps, any: o.min < s.min - eps || o.max > s.max + eps, min: o.min, max: o.max };
}

export function inventedCount(src, out, eps = 1e-9) {
  const set = [...new Set(src.data)];
  let n = 0;
  for (const v of out.data) if (!set.some((s) => Math.abs(s - v) <= eps)) n++;
  return n;
}

export function targetGrid(f, thetaDeg, { n = Math.max(3, Math.floor(34 / f)), cx = RP / 2, cy = RP / 2 } = {}) {
  const th = (thetaDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  const toSrc = (p, q) => { const a = (p - n / 2) * f, b = (q - n / 2) * f; return [cx + a * c - b * s, cy + a * s + b * c]; };
  const toOut = (u, v) => { const a = u - cx, b = v - cy; return [(a * c + b * s) / f + n / 2, (-a * s + b * c) / f + n / 2]; };
  return { n, f, theta: thetaDeg, cx, cy, toSrc, toOut };
}

export function footprint(grid, i, j) {
  return [grid.toSrc(i, j), grid.toSrc(i + 1, j), grid.toSrc(i + 1, j + 1), grid.toSrc(i, j + 1)];
}

export function areaWeights(src, quad) {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [u, v] of quad) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const out = [];
  for (let j = Math.max(0, Math.floor(v0)); j < Math.min(src.height, Math.ceil(v1)); j++) {
    for (let i = Math.max(0, Math.floor(u0)); i < Math.min(src.width, Math.ceil(u1)); i++) {
      const a = Math.abs(signedArea(clipRingToRect(quad, i, j, i + 1, j + 1)));
      if (a > 1e-12) out.push({ i, j, w: a });
    }
  }
  return out;
}

export function pointPixel(src, grid, i, j) {
  const [u, v] = grid.toSrc(i + 0.5, j + 0.5);
  return { u, v, i: clamp(Math.floor(u), 0, src.width - 1), j: clamp(Math.floor(v), 0, src.height - 1) };
}

export function areaValue(src, cells, kind = src.kind) {
  if (kind === "classes") {
    const by = new Map();
    let tot = 0;
    for (const c of cells) { const k = src.data[c.j * src.width + c.i]; by.set(k, (by.get(k) || 0) + c.w); tot += c.w; }
    let best = NaN, bw = -1;
    for (const [k, w] of [...by].sort((a, b) => a[0] - b[0])) if (w > bw + 1e-12) { best = k; bw = w; }
    return { value: best, share: tot ? bw / tot : 0 };
  }
  let s = 0, ws = 0;
  for (const c of cells) { s += c.w * src.data[c.j * src.width + c.i]; ws += c.w; }
  return { value: ws ? s / ws : NaN, share: 1 };
}

export function mostDifferent(a, b, n) {
  let best = null, bd = -1, bc = Infinity;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[j * n + i] - b.data[j * n + i]);
    const c = Math.hypot(i + 0.5 - n / 2, j + 0.5 - n / 2);
    if (d > bd + 1e-9 || (Math.abs(d - bd) <= 1e-9 && c < bc)) { best = [i, j]; bd = d; bc = c; }
  }
  return best;
}

export function reproject(src, grid, how) {
  const { n } = grid;
  const data = new Float64Array(n * n);
  const read = new Set();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (how === "point") {
      const p = pointPixel(src, grid, i, j);
      data[j * n + i] = src.data[p.j * src.width + p.i];
      read.add(p.j * src.width + p.i);
    } else {
      const cells = areaWeights(src, footprint(grid, i, j));
      for (const c of cells) read.add(c.j * src.width + c.i);
      data[j * n + i] = areaValue(src, cells, how === "majority" ? "classes" : "value").value;
    }
  }
  return { width: n, height: n, data, read: read.size };
}

const RAMP = ["#16214a", "#2c5f94", "#4fa7c9", "#6fd3e6", "#f4eedb"].map(hexToRgb);
const ERR = hexToRgb(INK.err), ERR_LOW = hexToRgb("#c2392f");
const LUT = Array.from({ length: 256 }, (_, k) => {
  const t = (k / 255) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(t));
  return mixOklab(RAMP[i], RAMP[i + 1], t - i);
});
const CLASS_RGB = Object.fromEntries(Object.entries(CLASSES).map(([k, c]) => [k, hexToRgb(c.color)]));

export function colourOf(v, raster) {
  if (!Number.isFinite(v)) return [228, 223, 212];
  if (raster.kind === "classes") {
    const r = Math.round(v);
    if (Math.abs(v - r) < 1e-9 && CLASS_RGB[r]) return CLASS_RGB[r];
    const a = CLASS_RGB[clamp(Math.floor(v), 1, 7)], b = CLASS_RGB[clamp(Math.ceil(v), 1, 7)];
    const f = clamp(v - Math.floor(v), 0, 1);
    return mixOklab(a, b, f);
  }
  const t = (v - raster.lo) / (raster.hi - raster.lo);
  if (t < -1e-9) return mixOklab(LUT[0], ERR_LOW, clamp(0.45 + -t * 7, 0, 1));
  if (t > 1 + 1e-9) return mixOklab(LUT[255], ERR, clamp(0.45 + (t - 1) * 7, 0, 1));
  return LUT[clamp(Math.round(t * 255), 0, 255)];
}

const fmtV = (v, raster) => {
  if (!Number.isFinite(v)) return "–";
  if (raster && raster.kind === "classes") {
    const r = Math.round(v);
    return Math.abs(v - r) < 1e-9 && CLASSES[r] ? `${r} ${CLASSES[r].name}` : `${fmtNum(v, 2)} not a class`;
  }
  return fmtNum(Math.abs(v) < 0.005 ? 0 : v, 2);
};
const fmtW = (w) => {
  const s = Math.abs(w).toFixed(2).replace(/^0/, "");
  return (w < -0.0049 ? "−" : "") + (Math.abs(w) >= 0.995 ? "1" : s);
};

const parsePair = (s) => {
  if (!s) return null;
  const p = String(s).split(",").map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? p : null;
};

export const COMPACT_W = 640;

export function layout(W, H, { rp = false, kinds = ["source", ...METHODS], inset = 0, capH = 68, titleW = 80, switchW = 170 } = {}) {
  const compact = W < COMPACT_W;
  const top = compact ? 16 + capH + 12 : Math.max(104, 16 + capH + 12), bottom = H - inset - (compact ? 12 : 16), left = 16, right = W - 16;
  const Wav = right - left, Hav = bottom - top;
  const gapX = W < 760 ? 14 : 22;
  const panels = [];
  if (!rp && compact) {
    const head = 40, below = 20, foot = 16, fixed = head + below + foot;
    const colW = Math.floor((Wav - gapX) / 2);
    let S = Math.min(colW, 560, Math.floor((Hav - fixed) / 1.42));
    let P = Math.max(56, Math.round(S * 0.42));
    if (S + P + fixed > Hav) S = Math.max(48, Hav - fixed - P);
    P = clamp(Hav - fixed - S, P, Math.max(P, Math.round(S * 0.5)));
    const blockW = 2 * S + gapX, blockH = fixed + S + P;
    const x0 = Math.round(Math.min(left + (Wav - blockW) / 2, Math.max(left, right - switchW - titleW - 12))), y =Math.round(top + Math.max(0, (Hav - blockH) / 2)) + head;
    const py = y + S + below, x1 = x0 + S + gapX, m = kinds[1];
    panels.push({ kind: "source", x: x0, y, S, hy: y - 19, prof: m ? null : { x: x0, y: py, w: S, h: P }, kern: null });
    if (m) panels.push({ kind: m, x: x1, y, S, prof: { x: x1, y: py, w: S, h: P }, kern: null });
    const swL = x0 + titleW + 12, swW = Math.max(S, Math.min(switchW, right - swL));
    return { W, H, top, bottom, left, right, panels, compact, kern: m ? { x: x0, y: py, w: S, h: P } : null, sw: { x: Math.max(swL, x0 + blockW - swW), y: y - head, w: swW, h: 34 } };
  }
  if (!rp) {
    const cols = kinds.length;
    const prof = (S) => Math.max(64, Math.round(S * 0.42));
    const extra = 22 + 10 + 22;
    let best = null;
    for (const perRow of cols >= 3 ? [cols, 2] : [cols]) {
      const rows = Math.ceil(cols / perRow);
      let S = (Wav - (perRow - 1) * gapX) / perRow;
      const rowH = (s) => s + prof(s) + extra;
      while (S > 40 && rows * rowH(S) + (rows - 1) * 18 > Hav) S -= 2;
      S = Math.floor(Math.min(S, 560));
      if (!best || S > best.S + 24) best = { S, perRow, rows };
    }
    const { S, perRow, rows } = best;
    const P = clamp(Math.floor((Hav - (rows - 1) * 18) / rows - S - extra), prof(S), Math.round(S * 0.5)), rowH = S + P + extra;
    const blockW = perRow * S + (perRow - 1) * gapX;
    let blockH = rows * rowH + (rows - 1) * 18;
    const K = rows === 1 && Hav - blockH >= 96 ? clamp(Hav - blockH - 34, 70, Math.round(S * 0.5)) : 0;
    if (K) blockH += K + 34;
    const x0 = left + (Wav - blockW) / 2, y0 = top + Math.max(0, (Hav - blockH) / 2);
    kinds.forEach((k, idx) => {
      const r = Math.floor(idx / perRow), c = idx % perRow;
      const x = Math.round(x0 + c * (S + gapX)), y = Math.round(y0 + r * (rowH + 18));
      const py = y + 22 + S + 12;
      panels.push({ kind: k, x, y: y + 22, S, prof: { x, y: py, w: S, h: P }, kern: K ? { x, y: py + P + 34, w: S, h: K } : null });
    });
  } else {
    const S0 = Math.floor(Math.min((Wav - 2 * gapX) / 3, Hav - 22 - 64, 560));
    const blockW = 3 * S0 + 2 * gapX;
    const x0 = left + (Wav - blockW) / 2, y0 = top + Math.max(0, (Hav - (S0 + 22 + 64)) / 2) * 0.5;
    const D = Math.min(S0, Hav - (S0 + 22 + 72) - 16);
    const yy = D >= 120 ? top + Math.max(0, (Hav - (S0 + 22 + 72 + D)) / 2) : y0;
    ["source", "point", "area"].forEach((k, idx) => panels.push({ kind: k, x: Math.round(x0 + idx * (S0 + gapX)), y: Math.round(yy + 22), S: S0 }));
    if (D >= 120) panels[0].detail = { x: panels[0].x, y: panels[0].y + S0 + 72, w: S0, h: D };
  }
  return { W, H, top, bottom, left, right, panels, compact, kern: null, sw: null };
}

export async function mount(ctx) {
  let params = { ...ctx.params };
  let first = true;
  let L = null;
  let hover = null;
  let reveal = 1, revealTween = null;
  let diag = null;
  let lastT = 0;
  let pinUp = parsePair(ctx.url.get("pin")) || [3.4, 3.1];
  let pinRp = null;
  let rot = Number(ctx.url.get("rot"));
  if (!Number.isFinite(rot)) rot = 20;
  let scene = null;
  try { scene = decodeScene(ctx.data.get("scene_synthetic.json")); } catch (e) { scene = null; }

  const cache = { key: "", src: null, outs: {}, imgs: {}, stats: {}, bad: {} };
  const badPath = (src, out) => {
    const codes = new Set(src.data);
    const path = new Path2D();
    for (let j = 0; j < out.height; j++) for (let i = 0; i < out.width; i++) {
      const v = out.data[j * out.width + i];
      if (!codes.has(v)) path.rect(i, j, 1, 1);
    }
    return path;
  };
  const enabled = () => METHODS.filter((m) => params[m]);
  const f = () => Number(params.factor);
  const isRp = () => params.mode === "reproject";
  let pick = METHODS.includes(ctx.url.get("show")) ? ctx.url.get("show") : null;
  const shown = () => { const en = enabled(); return en.includes(pick) ? pick : en[en.length - 1] || null; };

  const sw = ctx.stage.element("div", "segment resampling-switch");
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "Method to show");
  sw.style.cssText = "inset:auto;display:none;box-sizing:border-box;height:34px;padding:2px;gap:2px;z-index:5;pointer-events:auto;";
  sw.addEventListener("pointerdown", (e) => e.stopPropagation());
  const swBtns = Object.fromEntries(METHODS.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.textContent = METHOD_NAME[m];
    b.style.cssText = "height:28px;padding:0 6px;";
    b.addEventListener("click", () => {
      if (shown() === m) return;
      pick = m;
      if (ctx.side === "A") ctx.url.set("show", m === "cubic" ? null : m);
      hover = null; diag = null;
      stage.hideChip();
      startReveal();
      readouts();
      stage.request();
    });
    sw.append(b);
    return [m, b];
  }));
  let swKey = "";
  const syncSwitch = (box) => {
    const m = shown();
    const key = box ? [box.x, box.y, box.w, m, ...METHODS.map((k) => params[k])].join("|") : "off";
    if (key === swKey) return;
    swKey = key;
    sw.style.display = box ? "flex" : "none";
    if (!box) return;
    Object.assign(sw.style, { left: box.x + "px", top: box.y + "px", width: box.w + "px", height: box.h + "px" });
    for (const k of METHODS) {
      const b = swBtns[k], on = k === m;
      b.disabled = !params[k];
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      b.style.color = on ? METHOD_COLOUR[k] : "";
      b.style.fontWeight = on ? "600" : "";
    }
  };
  const swNeed = (g) => {
    g.font = `500 12.5px ${FONT_UI}`;
    return Math.ceil(METHODS.reduce((a, m) => a + g.measureText(METHOD_NAME[m]).width, 0) + 3 * 12 + 2 * 2 + 2 * 2 + 2 + 12);
  };

  const rebuild = () => {
    const key = [params.mode, params.source, params.factor, isRp() ? rot : ""].join("|");
    if (key === cache.key) return;
    cache.key = key;
    cache.outs = {}; cache.imgs = {}; cache.stats = {}; cache.bad = {};
    if (!isRp()) {
      const src = makeSource(params.source);
      cache.src = src;
      cache.imgs.source = imageCanvas(N, N, (i, j) => colourOf(src.data[j * N + i], src));
      for (const m of METHODS) {
        const out = upsample(src, f(), m);
        cache.outs[m] = out;
        cache.imgs[m] = imageCanvas(out.width, out.height, (i, j) => colourOf(out.data[j * out.width + i], src));
        cache.stats[m] = { ...overshoot(src, out), invented: inventedCount(src, out) };
        if (src.kind === "classes") cache.bad[m] = badPath(src, out);
      }
    } else {
      const src = makeReprojectSource(params.source, scene);
      cache.src = src;
      cache.imgs.source = imageCanvas(RP, RP, (i, j) => colourOf(src.data[j * RP + i], src));
      const grid = targetGrid(f(), rot);
      cache.grid = grid;
      const point = reproject(src, grid, "point");
      const area = reproject(src, grid, src.kind === "classes" ? "majority" : "area");
      cache.outs.point = point; cache.outs.area = area;
      cache.imgs.point = imageCanvas(grid.n, grid.n, (i, j) => colourOf(point.data[j * grid.n + i], src));
      cache.imgs.area = imageCanvas(grid.n, grid.n, (i, j) => colourOf(area.data[j * grid.n + i], src));
      cache.best = mostDifferent(point, area, grid.n);
    }
  };

  const layoutOf = (W, H, capH, titleW, switchW) => layout(W, H, { rp: isRp(), kinds: ["source", ...(W < COMPACT_W ? [shown()].filter(Boolean) : enabled())], inset: ctx.stage.insetBottom || 0, capH, titleW, switchW });

  const rasterOf = (p) => (p.kind === "source" ? cache.src : cache.outs[p.kind]);
  const pxOf = (p) => p.S / rasterOf(p).width;

  const hit = (X, Y) => {
    if (!L) return null;
    for (const p of L.panels) {
      if (X >= p.x && X < p.x + p.S && Y >= p.y && Y < p.y + p.S) {
        const r = rasterOf(p), s = pxOf(p);
        return { panel: p, i: clamp(Math.floor((X - p.x) / s), 0, r.width - 1), j: clamp(Math.floor((Y - p.y) / s), 0, r.height - 1), X, Y };
      }
    }
    return null;
  };

  const outFromPin = () => {
    const F = f(), n = N * F;
    return [clamp(Math.round((pinUp[0] + 0.5) * F - 0.5), 0, n - 1), clamp(Math.round((pinUp[1] + 0.5) * F - 0.5), 0, n - 1)];
  };

  const focusUp = () => {
    if (hover && hover.panel.kind !== "source") return { ox: hover.i, oy: hover.j, method: hover.panel.kind, live: true };
    if (hover && hover.panel.kind === "source") return { si: hover.i, sj: hover.j, live: true };
    const [ox, oy] = outFromPin();
    return { ox, oy, method: null, live: false };
  };

  const focusRp = () => {
    const grid = cache.grid;
    if (hover) {
      if (hover.panel.kind === "source") {
        const [p, q] = grid.toOut(hover.i + 0.5, hover.j + 0.5);
        const i = Math.floor(p), j = Math.floor(q);
        return { si: hover.i, sj: hover.j, i: i >= 0 && i < grid.n && j >= 0 && j < grid.n ? i : null, j, live: true };
      }
      return { i: hover.i, j: hover.j, live: true };
    }
    const pr = pinRp && pinRp[0] < grid.n && pinRp[1] < grid.n ? pinRp : (cache.best || [Math.floor(grid.n / 2), Math.floor(grid.n / 2)]);
    return { i: pr[0], j: pr[1], live: false };
  };

  const startReveal = () => {
    if (revealTween) revealTween.cancel();
    revealTween = null;
    if (ctx.reducedMotion) { reveal = 1; return; }
    reveal = 0;
    revealTween = ctx.anim.tween({ from: 0, to: 1, duration: 700, ease: ctx.anim.ease.out, onUpdate: (v) => { reveal = v; stage.request(); }, onDone: () => { revealTween = null; reveal = 1; stage.request(); } });
  };

  const snap = (v) => Math.round(v) + 0.5;

  const header = (g, p, titles, colour, sub, subColour) => {
    const hy = p.hy ?? p.y - 8;
    g.font = `600 12px ${FONT_UI}`;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = colour;
    const options = [].concat(titles);
    const title = options.find((t) => g.measureText(t).width <= p.S) || options[options.length - 1];
    g.fillText(title, p.x, hy);
    const tw = g.measureText(title).width;
    if (sub) {
      g.font = `500 10.5px ${FONT_UI}`;
      g.fillStyle = subColour || INK.ink3;
      const room = p.S - tw - 10;
      let s = sub;
      while (s.length > 4 && g.measureText(s).width > room) s = s.slice(0, -2);
      if (s !== sub) s = s.slice(0, -1) + "…";
      if (g.measureText(s).width > room || (s !== sub && s.length < 6)) return;
      g.textAlign = "right";
      g.fillText(s, p.x + p.S, hy);
    }
  };

  const drawImage = (g, p) => {
    const img = cache.imgs[p.kind];
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#f1ede4";
    g.fillRect(p.x - 1, p.y - 1, p.S + 2, p.S + 2);
    g.drawImage(img, p.x, p.y, p.S, p.S);
    const r = rasterOf(p), s = pxOf(p);
    if (cache.bad[p.kind]) {
      g.save();
      g.translate(p.x, p.y); g.scale(s, s);
      g.clip(cache.bad[p.kind]);
      g.scale(1 / s, 1 / s); g.translate(-p.x, -p.y);
      g.strokeStyle = "rgba(180,35,53,.9)"; g.lineWidth = 1.3;
      g.beginPath();
      for (let k = -p.S; k < p.S; k += 5) { g.moveTo(p.x + k, p.y + p.S); g.lineTo(p.x + k + p.S, p.y); }
      g.stroke();
      g.restore();
    }
    g.lineWidth = 1;
    if (p.kind === "source" || (isRp() && s >= 9)) {
      g.strokeStyle = p.kind === "source" && !isRp() ? "rgba(250,248,243,.55)" : "rgba(250,248,243,.35)";
      if (s >= 5) {
        g.beginPath();
        for (let k = 1; k < r.width; k++) { const X = snap(p.x + k * s); g.moveTo(X, p.y); g.lineTo(X, p.y + p.S); }
        for (let k = 1; k < r.height; k++) { const Y = snap(p.y + k * s); g.moveTo(p.x, Y); g.lineTo(p.x + p.S, Y); }
        g.stroke();
      }
    } else if (!isRp()) {
      const F = f();
      if (s >= 7) {
        g.strokeStyle = "rgba(250,248,243,.22)";
        g.beginPath();
        for (let k = 1; k < r.width; k++) { if (k % F === 0) continue; const X = snap(p.x + k * s); g.moveTo(X, p.y); g.lineTo(X, p.y + p.S); }
        for (let k = 1; k < r.height; k++) { if (k % F === 0) continue; const Y = snap(p.y + k * s); g.moveTo(p.x, Y); g.lineTo(p.x + p.S, Y); }
        g.stroke();
      }
      g.strokeStyle = "rgba(250,248,243,.5)";
      g.beginPath();
      for (let k = 1; k < N; k++) { const X = snap(p.x + k * F * s); g.moveTo(X, p.y); g.lineTo(X, p.y + p.S); const Y = snap(p.y + k * F * s); g.moveTo(p.x, Y); g.lineTo(p.x + p.S, Y); }
      g.stroke();
    }
    g.strokeStyle = "rgba(60,52,40,.35)";
    g.strokeRect(p.x - 0.5, p.y - 0.5, p.S + 1, p.S + 1);
  };

  const cellRect = (p, i, j, span = 1) => {
    const s = pxOf(p);
    return [p.x + i * s, p.y + j * s, s * span, s * span];
  };

  const drawTaps = (g, p, t, colour) => {
    const s = pxOf(p);
    const maxw = Math.max(...t.cells.map((c) => Math.abs(c.w)));
    for (const c of t.cells) {
      const [x, y, w, h] = cellRect(p, c.i, c.j);
      const neg = c.w < 0;
      g.fillStyle = neg ? `rgba(180,35,53,${0.25 + 0.5 * Math.abs(c.w) / maxw})` : css(hexToRgb(colour), 0.18 + 0.5 * Math.abs(c.w) / maxw);
      g.fillRect(x, y, w, h);
      g.strokeStyle = neg ? INK.err : colour;
      g.lineWidth = 1.5;
      g.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
      if (s >= 26) text(g, x + w / 2, y + h / 2, fmtW(c.w), { color: neg ? "#8f1c2b" : INK.ink, size: s >= 44 ? 12 : 10.5, weight: 700, align: "center" });
    }
    const X = p.x + (t.x + 0.5) * s, Y = p.y + (t.y + 0.5) * s;
    g.strokeStyle = "#faf8f3"; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X - 7, Y); g.lineTo(X + 7, Y); g.moveTo(X, Y - 7); g.lineTo(X, Y + 7); g.stroke();
    g.strokeStyle = "#ffffff"; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(X - 7, Y); g.lineTo(X + 7, Y); g.moveTo(X, Y - 7); g.lineTo(X, Y + 7); g.stroke();
  };

  const outline = (g, x, y, w, h, colour = "#ffffff", lw = 2) => {
    g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = lw + 2;
    g.strokeRect(x, y, w, h);
    g.strokeStyle = colour; g.lineWidth = lw;
    g.strokeRect(x, y, w, h);
  };

  const yRange = (src) => (src.kind === "classes" ? [0.4, 4.6] : [src.lo - 0.16 * (src.hi - src.lo), src.hi + 0.16 * (src.hi - src.lo)]);

  const drawProfile = (g, p, fo) => {
    const src = cache.src, b = p.prof, F = f();
    const [vmin, vmax] = yRange(src);
    const Xof = (x) => b.x + ((x + 0.5) / N) * b.w;
    const Yof = (v) => b.y + b.h - ((clamp(v, vmin, vmax) - vmin) / (vmax - vmin)) * b.h;
    const [, oyPin] = outFromPin();
    const yRow = srcPos(oyPin, F);
    g.fillStyle = "rgba(250,248,243,.85)";
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = "rgba(180,35,53,.07)";
    g.fillRect(b.x, b.y, b.w, Yof(src.hi) - b.y);
    g.fillRect(b.x, Yof(src.lo), b.w, b.y + b.h - Yof(src.lo));
    g.setLineDash([3, 3]);
    g.strokeStyle = "rgba(60,52,40,.28)"; g.lineWidth = 1;
    g.beginPath();
    for (const v of [src.lo, src.hi]) { const Y = snap(Yof(v)); g.moveTo(b.x, Y); g.lineTo(b.x + b.w, Y); }
    g.stroke(); g.setLineDash([]);
    text(g, b.x + 3, Yof(src.hi) - 7, src.kind === "classes" ? "class 4" : fmtPlain(src.hi), { color: INK.ink4, size: 9.5, halo: false });
    text(g, b.x + 3, Yof(src.lo) + 8, src.kind === "classes" ? "class 1" : fmtPlain(src.lo), { color: INK.ink4, size: 9.5, halo: false });
    g.strokeStyle = "rgba(60,52,40,.22)";
    g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);

    const rowSrc = Array.from({ length: N }, (_, i) => src.data[clamp(Math.round(yRow), 0, N - 1) * N + i]);
    g.save();
    g.beginPath(); g.rect(b.x, b.y - 2, b.w * reveal, b.h + 4); g.clip();
    if (p.kind === "source") {
      g.strokeStyle = INK.ink2; g.lineWidth = 1.6;
      g.beginPath();
      rowSrc.forEach((v, i) => { const X0 = Xof(i - 0.5), X1 = Xof(i + 0.5), Y = Yof(v); if (i) g.lineTo(X0, Y); else g.moveTo(X0, Y); g.lineTo(X1, Y); });
      g.stroke();
    } else {
      const m = p.kind, col = METHOD_COLOUR[m];
      const path = new Path2D();
      const steps = Math.max(32, Math.round(b.w));
      for (let k = 0; k <= steps; k++) {
        const x = -0.5 + (N * k) / steps;
        const v = sample(src, x, yRow, m);
        const X = Xof(x), Y = Yof(v);
        if (k) path.lineTo(X, Y); else path.moveTo(X, Y);
      }
      g.lineJoin = "round";
      g.strokeStyle = css(hexToRgb(col), 0.95); g.lineWidth = 1.8;
      g.stroke(path);
      g.save();
      g.beginPath();
      g.rect(b.x, b.y - 2, b.w, Yof(src.hi) - b.y + 2 - 0.5);
      g.rect(b.x, Yof(src.lo) + 0.5, b.w, b.y + b.h - Yof(src.lo) + 2);
      g.clip();
      g.strokeStyle = INK.err; g.lineWidth = 2.2;
      g.stroke(path);
      g.restore();
      const out = cache.outs[m];
      const dx = b.w / out.width;
      if (dx >= 4.5) {
        g.fillStyle = col;
        for (let ox = 0; ox < out.width; ox++) {
          const v = out.data[oyPin * out.width + ox];
          g.beginPath(); g.arc(Xof(srcPos(ox, F)), Yof(v), dx >= 9 ? 2.2 : 1.6, 0, 2 * Math.PI); g.fill();
        }
      }
    }
    g.restore();
    g.strokeStyle = "rgba(26,25,23,.55)"; g.lineWidth = 1.2;
    rowSrc.forEach((v, i) => { g.beginPath(); g.arc(Xof(i), Yof(v), 2.6, 0, 2 * Math.PI); g.stroke(); });

    let cx = null;
    if (fo.ox !== undefined) cx = srcPos(fo.ox, F);
    else if (fo.si !== undefined) cx = fo.si;
    if (cx !== null) {
      const X = snap(Xof(cx));
      g.strokeStyle = fo.live ? "rgba(255,255,255,.75)" : "rgba(184,82,23,.7)";
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(X, b.y); g.lineTo(X, b.y + b.h); g.stroke();
      if (p.kind !== "source" && fo.ox !== undefined) {
        const v = cache.outs[p.kind].data[oyPin * cache.outs[p.kind].width + fo.ox];
        g.fillStyle = "#ffffff";
        g.beginPath(); g.arc(X, Yof(v), 3.4, 0, 2 * Math.PI); g.fill();
        g.strokeStyle = "#faf8f3"; g.lineWidth = 1.2; g.stroke();
        const right = X < b.x + b.w * 0.62;
        text(g, X + (right ? 7 : -7), clamp(Yof(v) - 9, b.y + 8, b.y + b.h - 8), src.kind === "classes" ? fmtV(v, src).replace(" not a class", " ✕") : fmtV(v, src), { color: INK.ink, size: 10.5, weight: 600, align: right ? "left" : "right" });
      }
    }
    let room = b.w;
    if (p.sub) {
      g.font = `500 10.5px ${FONT_UI}`;
      room -= g.measureText(p.sub.text).width + 10;
      text(g, b.x, b.y + b.h + 10, p.sub.text, { color: p.sub.color, size: 10.5, weight: 500, halo: false, mono: false });
    }
    g.font = `500 9.5px ${FONT_UI}`;
    const labels = [`profile, row ${oyPin}${p.kind === "source" ? ` (source ${fmtPlain(yRow, 2)})` : ""}`, `profile, row ${oyPin}`, `row ${oyPin}`];
    const label = labels.find((l) => g.measureText(l).width <= room);
    if (label) text(g, b.x + b.w, b.y + b.h + 10, label, { color: INK.ink4, size: 9.5, align: "right", halo: false, mono: false });
  };

  const drawPinMarks = (g, p) => {
    const F = f();
    const [, oyPin] = outFromPin();
    const s = pxOf(p);
    const y = p.kind === "source" ? p.y + (srcPos(oyPin, F) + 0.5) * s : p.y + (oyPin + 0.5) * s;
    g.fillStyle = INK.brass;
    g.beginPath(); g.moveTo(p.x - 7, y - 4.5); g.lineTo(p.x - 1, y); g.lineTo(p.x - 7, y + 4.5); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(p.x + p.S + 7, y - 4.5); g.lineTo(p.x + p.S + 1, y); g.lineTo(p.x + p.S + 7, y + 4.5); g.closePath(); g.fill();
  };

  const drawUpsample = (g) => {
    const fo = focusUp();
    const src = cache.src, F = f();
    for (const p of L.panels) {
      if (p.kind === "source") {
        const r = rangeOf(src.data);
        header(g, p, `Source ${N} × ${N}`, INK.ink, L.compact ? null : src.kind === "classes" ? "4 classes" : `${trimNum(r.min, 2)} to ${trimNum(r.max, 2)}`);
      } else {
        const st = cache.stats[p.kind];
        const n = N * F;
        const sub = src.kind === "classes"
          ? (st.invented ? `${fmtNum(st.invented)} px no class` : "classes kept")
          : `${trimNum(st.min, 2)} to ${trimNum(st.max, 2)}`;
        const bad = src.kind === "classes" ? st.invented > 0 : st.any;
        const subColour = bad ? INK.err : src.kind === "classes" ? INK.ok : INK.ink3;
        if (L.compact) p.sub = { text: sub, color: subColour };
        else header(g, p, p.S >= 200 ? `${METHOD_NAME[p.kind]} ${n} × ${n}` : METHOD_NAME[p.kind], METHOD_COLOUR[p.kind], sub, subColour);
      }
      drawImage(g, p);
      drawPinMarks(g, p);
      if (p.prof) drawProfile(g, p, fo);
    }
    const methodPanels = L.panels.filter((p) => p.kind !== "source");
    const sp = L.panels.find((p) => p.kind === "source");
    if (fo.ox !== undefined) {
      for (const p of methodPanels) {
        const [x, y, w, h] = cellRect(p, fo.ox, fo.oy);
        outline(g, x, y, Math.max(w, 3), Math.max(h, 3), fo.live && p.kind === fo.method ? "#ffffff" : "rgba(255,255,255,.8)", fo.live && p.kind === fo.method ? 2 : 1.4);
      }
      const m = fo.method || (methodPanels.length ? methodPanels[methodPanels.length - 1].kind : null);
      if (m && fo.live) drawTaps(g, sp, tapsFor(src, m, srcPos(fo.ox, F), srcPos(fo.oy, F)), METHOD_COLOUR[m]);
      else {
        const X = sp.x + (srcPos(fo.ox, F) + 0.5) * pxOf(sp), Y = sp.y + (srcPos(fo.oy, F) + 0.5) * pxOf(sp);
        g.fillStyle = INK.brass; g.strokeStyle = "#faf8f3"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X, Y, 4, 0, 2 * Math.PI); g.fill(); g.stroke();
      }
    } else if (fo.si !== undefined) {
      const [x, y, w, h] = cellRect(sp, fo.si, fo.sj);
      outline(g, x, y, w, h);
      for (const p of methodPanels) {
        const [bx, by, bw, bh] = cellRect(p, fo.si * F, fo.sj * F, F);
        outline(g, bx, by, bw, bh, "rgba(255,255,255,.85)", 1.4);
      }
    }
  };

  const kernelOf = (m) => (d) => (m === "nearest" ? (Math.abs(d) < 0.5 ? 1 : 0) : m === "bilinear" ? Math.max(0, 1 - Math.abs(d)) : cubicWeight(d));

  const drawKernel = (g, b, m, x, big) => {
    const col = METHOD_COLOUR[m];
    const kern = kernelOf(m);
    const KX = (d) => b.x + ((d + 2) / 4) * b.w;
    const top = b.y + (big ? 16 : 2), bot = b.y + b.h - (big ? 16 : 12);
    const KY = (v) => bot - ((v + 0.2) / 1.25) * (bot - top);
    if (big) {
      g.fillStyle = "rgba(250,248,243,.85)";
      g.fillRect(b.x, b.y, b.w, b.h);
      g.strokeStyle = "rgba(60,52,40,.22)"; g.lineWidth = 1;
      g.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
      g.fillStyle = "rgba(180,35,53,.07)";
      g.fillRect(b.x, KY(0), b.w, b.y + b.h - KY(0));
    }
    g.strokeStyle = "rgba(60,52,40,.25)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(b.x, snap(KY(0))); g.lineTo(b.x + b.w, snap(KY(0)));
    for (const d of [-1, 0, 1]) { g.moveTo(snap(KX(d)), KY(0) - 3); g.lineTo(snap(KX(d)), KY(0) + 3); }
    g.stroke();
    g.strokeStyle = css(hexToRgb(col), 0.55); g.lineWidth = 1.4;
    g.beginPath();
    for (let k = 0; k <= 160; k++) { const d = -2 + k / 40; const X = KX(d), Y = KY(kern(d)); if (k) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
    for (const a of taps1(m, x, 1e9)) {
      const X = KX(a.d), Y = KY(a.w);
      const neg = a.w < -1e-9;
      g.strokeStyle = neg ? INK.err : col; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(X, KY(0)); g.lineTo(X, Y); g.stroke();
      g.fillStyle = neg ? INK.err : col;
      g.beginPath(); g.arc(X, Y, 3, 0, 2 * Math.PI); g.fill();
      if (big) text(g, X, neg ? Y + 11 : Y - 10, fmtW(a.w), { color: neg ? "#b42335" : INK.ink, size: 10, weight: 600, align: "center" });
    }
    const ay = big ? b.y + b.h + 9 : b.y + b.h - 4;
    text(g, KX(0), ay, "0", { color: INK.ink4, size: 9, align: "center", halo: false });
    text(g, b.x + 3, ay, "−2", { color: INK.ink4, size: 9, halo: false });
    text(g, b.x + b.w - 3, ay, b.w < 120 ? "+2" : "+2 px", { color: INK.ink4, size: 9, align: "right", halo: false });
  };

  let kx = null;
  const drawKernelRow = (g, fo, dt) => {
    const sp = L.panels[0];
    if (!sp.kern && !L.kern) return;
    const F = f();
    const target = fo.ox !== undefined ? srcPos(fo.ox, F) : fo.si;
    if (kx === null || ctx.reducedMotion) kx = target;
    else { kx += (target - kx) * (1 - Math.exp(-dt * 14)); if (Math.abs(kx - target) > 0.002) stage.request(); else kx = target; }
    if (L.kern) {
      const b = L.kern, m = L.panels[1].kind;
      drawKernel(g, b, m, kx, true);
      const taps = taps1(m, kx, 1e9);
      const sum = taps.reduce((a, t) => a + t.w, 0);
      const n = taps.length === 1 ? "1 tap" : taps.length + " taps";
      const lf = `600 10px ${FONT_UI}`, tf = `500 9.5px ${FONT_MONO}`;
      const wOf = (s, font, sp = 0) => { g.font = font; return g.measureText(s).width + s.length * sp; };
      const pairs = [["WEIGHTS IN X", `${n} · Σ ${fmtPlain(sum, 2)}`], ["WEIGHTS", `${n} · Σ ${fmtPlain(sum, 2)}`], ["WEIGHTS", n], ["WEIGHTS", ""]];
      const [lab, tap] = pairs.find(([a, c]) => wOf(a, lf, 0.6) + 10 + wOf(c, tf) <= b.w) || pairs[pairs.length - 1];
      g.font = lf; g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
      if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
      g.fillText(lab, b.x, b.y - 8);
      if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
      if (tap) text(g, b.x + b.w, b.y - 8, tap, { color: INK.ink4, size: 9.5, align: "right", halo: false });
      return;
    }
    const b = sp.kern;
    g.font = `600 10px ${FONT_UI}`; g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText("WEIGHTS IN X", b.x, b.y + 8);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
    const lines = ["Weight against distance", "from the new pixel centre,", "in source pixels.", `New column x = ${fmtPlain(kx, 3)}`];
    lines.forEach((l, k) => text(g, b.x, b.y + 28 + k * 16, l, { color: k === 3 ? INK.ink2 : INK.ink3, size: 11, mono: k === 3, halo: false }));
    for (const p of L.panels) {
      if (p.kind === "source" || !p.kern) continue;
      drawKernel(g, p.kern, p.kind, kx, true);
      const sum = taps1(p.kind, kx, 1e9).reduce((a, t) => a + t.w, 0);
      text(g, p.kern.x + p.kern.w, p.kern.y - 8, `${taps1(p.kind, kx, 1e9).length === 1 ? "1 tap" : taps1(p.kind, kx, 1e9).length + " taps"} · Σ ${fmtPlain(sum, 2)}`, { color: INK.ink4, size: 9.5, align: "right", halo: false });
    }
  };

  const drawDiagram = (g, dt) => {
    const fo = isRp() ? null : focusUp();
    if (!fo || !fo.live || fo.ox === undefined || !fo.method) { diag = null; return; }
    const src = cache.src, F = f(), m = fo.method, col = METHOD_COLOUR[m];
    const t = tapsFor(src, m, srcPos(fo.ox, F), srcPos(fo.oy, F));
    const k = t.tx.length;
    const showK = !L.panels[0].kern && !L.kern;
    const cellW = 38, w = Math.max(250, k * cellW + 36), kh = showK ? 58 : 0;
    const h = 16 + 16 + kh + 16 + k * 18 + 30;
    const tx = clamp(hover.X + 22 + w > L.W - 8 ? hover.X - 22 - w : hover.X + 22, 8, Math.max(8, L.W - 8 - w));
    const ty = clamp(hover.Y + 18, 8, L.bottom - h);
    if (!diag || ctx.reducedMotion) diag = { x: tx, y: ty, a: diag ? diag.a : 0 };
    else {
      const kf = 1 - Math.exp(-dt * 16);
      diag.x += (tx - diag.x) * kf; diag.y += (ty - diag.y) * kf;
    }
    diag.a = ctx.reducedMotion ? 1 : Math.min(1, diag.a + dt * 6);
    if (Math.abs(diag.x - tx) > 0.5 || Math.abs(diag.y - ty) > 0.5 || diag.a < 1) stage.request();
    const x = Math.round(diag.x), y = Math.round(diag.y);
    g.save();
    g.globalAlpha = diag.a;
    panel(g, x, y, w, h, { accent: col });
    const L0 = x + 22, R0 = x + w - 14;
    g.font = `600 10px ${FONT_UI}`; g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText(`${METHOD_NAME[m].toUpperCase()} WEIGHTS · ${k * k} SOURCE ${k * k === 1 ? "PIXEL" : "PIXELS"}`, L0, y + 16);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
    text(g, L0, y + 32, `new (${fo.ox}, ${fo.oy}) ← x ${fmtPlain(t.x, 3)}, y ${fmtPlain(t.y, 3)}`, { color: INK.ink2, size: 10, halo: false });
    if (showK) drawKernel(g, { x: L0, y: y + 44, w: R0 - L0, h: kh }, m, t.x, false);
    const gy = y + 44 + kh + 8;
    const gx = L0 + (R0 - L0 - k * cellW) / 2;
    for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) {
      const wv = t.tx[c].w * t.ty[r].w;
      const X = gx + c * cellW, Y = gy + r * 18;
      g.fillStyle = wv < 0 ? `rgba(180,35,53,${0.18 + 0.5 * Math.min(1, Math.abs(wv) * 3)})` : css(hexToRgb(col), 0.1 + 0.55 * Math.min(1, wv * 1.6));
      g.fillRect(X + 1, Y + 1, cellW - 2, 16);
      text(g, X + cellW / 2, Y + 9.5, fmtW(wv), { color: wv < 0 ? "#8f1c2b" : INK.ink, size: 10, weight: 600, align: "center", halo: false });
    }
    const vy = gy + k * 18 + 15;
    text(g, L0, vy, "Σ weight × value =", { color: INK.ink3, size: 10.5, halo: false });
    const outside = src.kind === "classes" ? inventedCount(src, { data: [t.value] }) > 0 : t.value < src.lo - 1e-9 || t.value > src.hi + 1e-9;
    text(g, R0, vy, src.kind === "classes" ? fmtV(t.value, src).replace(" not a class", " ✕") : fmtV(t.value, src), { color: outside ? INK.err : INK.ink, size: 11.5, weight: 700, align: "right", halo: false });
    g.restore();
  };

  const drawDetail = (g, b, fo, pp) => {
    const src = cache.src, grid = cache.grid;
    const quad = footprint(grid, fo.i, fo.j);
    const cells = areaWeights(src, quad);
    const pt = pointPixel(src, grid, fo.i, fo.j);
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const c of cells) { i0 = Math.min(i0, c.i); i1 = Math.max(i1, c.i); j0 = Math.min(j0, c.j); j1 = Math.max(j1, c.j); }
    const nc = Math.max(i1 - i0 + 1, j1 - j0 + 1);
    const cs = Math.floor(b.h / nc);
    const ox = b.x + (b.w - nc * cs) / 2, oy = b.y;
    const area = grid.f * grid.f;
    const toD = ([u, v]) => [ox + (u - i0) * cs, oy + (v - j0) * cs];
    g.save();
    g.beginPath(); g.rect(ox, oy, nc * cs, nc * cs); g.clip();
    for (let j = j0; j < j0 + nc; j++) for (let i = i0; i < i0 + nc; i++) {
      if (i < 0 || j < 0 || i >= src.width || j >= src.height) continue;
      g.fillStyle = css(colourOf(src.data[j * src.width + i], src));
      g.fillRect(ox + (i - i0) * cs, oy + (j - j0) * cs, cs, cs);
    }
    g.fillStyle = "rgba(250,248,243,.45)";
    g.fillRect(ox, oy, nc * cs, nc * cs);
    for (const c of cells) {
      g.fillStyle = css(colourOf(src.data[c.j * src.width + c.i], src));
      g.fillRect(ox + (c.i - i0) * cs, oy + (c.j - j0) * cs, cs, cs);
    }
    g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= nc; k++) { g.moveTo(snap(ox + k * cs), oy); g.lineTo(snap(ox + k * cs), oy + nc * cs); g.moveTo(ox, snap(oy + k * cs)); g.lineTo(ox + nc * cs, snap(oy + k * cs)); }
    g.stroke();
    g.beginPath();
    quad.forEach((q, k) => { const [X, Y] = toD(q); if (k) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.closePath();
    g.strokeStyle = "#faf8f3"; g.lineWidth = 4; g.stroke();
    g.strokeStyle = INK.signal; g.lineWidth = 2; g.stroke();
    outline(g, ox + (pt.i - i0) * cs + 1, oy + (pt.j - j0) * cs + 1, cs - 2, cs - 2, INK.brass, 2);
    if (cs >= 26) {
      for (const c of cells) {
        const sh = (100 * c.w) / area;
        const lab = sh >= 99.5 ? "100" : sh < 1 ? "<1" : fmtPlain(sh, 0);
        text(g, ox + (c.i - i0 + 0.5) * cs, oy + (c.j - j0 + 0.5) * cs, lab + "%", { color: INK.ink, size: cs >= 40 ? 11 : 9.5, weight: 700, align: "center" });
      }
    }
    const [X, Y] = toD([pt.u, pt.v]);
    g.fillStyle = "#ffffff"; g.strokeStyle = "#faf8f3"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X, Y, 4, 0, 2 * Math.PI); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1;
    g.strokeRect(ox - 0.5, oy - 0.5, nc * cs + 1, nc * cs + 1);
    const pv = src.data[pt.j * src.width + pt.i];
    const av = areaValue(src, cells);
    const rows = [
      [["new pixel  ", INK.ink3], [`(${fo.i}, ${fo.j})`, INK.ink]],
      [["point      ", INK.brass], [`pixel (${pt.i}, ${pt.j}) = `, INK.ink2], [fmtV(pv, src), INK.ink]],
    ];
    if (src.kind === "classes") {
      const by = new Map();
      for (const c of cells) { const k = src.data[c.j * src.width + c.i]; by.set(k, (by.get(k) || 0) + c.w); }
      const tot = [...by.values()].reduce((a, v) => a + v, 0);
      rows.push([["majority   ", INK.signal], [fmtV(av.value, src), INK.ink], [`, ${fmtPlain(100 * av.share, 0)} % of the area`, INK.ink2]]);
      [...by].sort((a, c) => c[1] - a[1]).slice(0, 4).forEach(([k, w]) => rows.push([["           ", INK.ink3], [`${CLASSES[k] ? CLASSES[k].name : k}`.padEnd(11), INK.ink2], [`${fmtPlain((100 * w) / tot, 0).padStart(3)} %`, INK.ink3]]));
    } else {
      rows.push([["area       ", INK.signal], ["Σ share × value = ", INK.ink2], [fmtV(av.value, src), INK.ink]]);
      rows.push([["           ", INK.ink3], [`${cells.length} pixels, shares add to ${fmtPlain((100 * cells.reduce((a, c) => a + c.w, 0)) / area, 0)} %`, INK.ink3]]);
      rows.push([["difference ", INK.ink3], [fmtV(av.value - pv, src), Math.abs(av.value - pv) > 0.5 ? INK.warn : INK.ink2]]);
    }
    formulaPanel(g, pp.x, b.y, "One new pixel, two answers", rows, { accent: INK.signal, size: 11.5, gap: 19 });
    text(g, pp.x, b.y + b.h - 4, "Left: the source pixels under the new pixel, with the share of its area.", { color: INK.ink4, size: 10.5, mono: false, halo: false });
  };

  const drawReproject = (g) => {
    const src = cache.src, grid = cache.grid;
    const fo = focusRp();
    const [sp, pp, ap] = L.panels;
    const total = RP * RP;
    const gn = `${grid.n} × ${grid.n}`, an = src.kind === "classes" ? "Area majority" : "Area weighted";
    header(g, sp, [`Source ${RP} × ${RP}`, "Source"], INK.ink, "synthetic", INK.ink3);
    header(g, pp, [`Point (nearest) ${gn}`, "Point (nearest)", `Point ${gn}`, "Point"], INK.brass, null);
    header(g, ap, [`${an} ${gn}`, an, src.kind === "classes" ? "Majority" : "Area"], INK.signal, null);
    for (const p of L.panels) drawImage(g, p);
    const s = pxOf(sp);
    const toX = ([u, v]) => [sp.x + u * s, sp.y + v * s];
    g.save();
    g.beginPath(); g.rect(sp.x, sp.y, sp.S, sp.S); g.clip();
    g.strokeStyle = "rgba(184,82,23,.55)"; g.lineWidth = 1;
    g.beginPath();
    for (let k = 0; k <= grid.n; k++) {
      let [x0, y0] = toX(grid.toSrc(k, 0)), [x1, y1] = toX(grid.toSrc(k, grid.n));
      g.moveTo(x0, y0); g.lineTo(x1, y1);
      [x0, y0] = toX(grid.toSrc(0, k)); [x1, y1] = toX(grid.toSrc(grid.n, k));
      g.moveTo(x0, y0); g.lineTo(x1, y1);
    }
    g.stroke();
    if (s >= 3.5) {
      g.fillStyle = "rgba(184,82,23,.9)";
      for (let j = 0; j < grid.n; j++) for (let i = 0; i < grid.n; i++) {
        const [X, Y] = toX(grid.toSrc(i + 0.5, j + 0.5));
        g.fillRect(X - 1, Y - 1, 2, 2);
      }
    }
    if (fo.i !== null && fo.i !== undefined) {
      const quad = footprint(grid, fo.i, fo.j);
      const cells = areaWeights(src, quad);
      for (const c of cells) {
        g.fillStyle = `rgba(29,99,168,${0.15 + 0.5 * (c.w)})`;
        g.fillRect(sp.x + c.i * s, sp.y + c.j * s, s, s);
      }
      const pt = pointPixel(src, grid, fo.i, fo.j);
      outline(g, sp.x + pt.i * s, sp.y + pt.j * s, s, s, INK.brass, 1.6);
      g.beginPath();
      quad.forEach((q, k) => { const [X, Y] = toX(q); if (k) g.lineTo(X, Y); else g.moveTo(X, Y); });
      g.closePath();
      g.strokeStyle = "#faf8f3"; g.lineWidth = 4; g.stroke();
      g.strokeStyle = INK.signal; g.lineWidth = 2; g.stroke();
      const [X, Y] = toX([pt.u, pt.v]);
      g.fillStyle = "#ffffff"; g.strokeStyle = "#faf8f3"; g.lineWidth = 1.5;
      g.beginPath(); g.arc(X, Y, 3.5, 0, 2 * Math.PI); g.fill(); g.stroke();
      for (const p of [pp, ap]) {
        const [x, y, w, h] = cellRect(p, fo.i, fo.j);
        outline(g, x, y, w, h, "#ffffff", fo.live ? 2 : 1.4);
      }
    }
    if (fo.si !== undefined) {
      const [x, y, w, h] = cellRect(sp, fo.si, fo.sj);
      outline(g, x, y, w, h, "#ffffff", 1.4);
    }
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1;
    g.strokeRect(sp.x - 0.5, sp.y - 0.5, sp.S + 1, sp.S + 1);
    const pr = cache.outs.point.read, ar = cache.outs.area.read;
    const foot = (p, lines) => {
      g.font = `400 11px ${FONT_UI}`;
      let k = 0;
      for (const [str, col] of lines) {
        const words = str.split(" ");
        let line = "";
        for (const w of words) {
          const t = line ? line + " " + w : w;
          if (line && g.measureText(t).width > p.S) { text(g, p.x, p.y + p.S + 16 + k++ * 15, line, { color: col, size: 11, mono: false, halo: false }); line = w; }
          else line = t;
        }
        if (line) text(g, p.x, p.y + p.S + 16 + k++ * 15, line, { color: col, size: 11, mono: false, halo: false });
      }
    };
    foot(sp, [[`New grid: ${grid.n} × ${grid.n}, pixel ${grid.f} × ${grid.f}, turned ${fmtPlain(grid.theta)}°`, INK.ink2], ["Drag here to turn the new grid.", INK.ink4]]);
    foot(pp, [[`Reads ${fmtNum(pr)} of ${fmtNum(total)} px (${fmtPlain((100 * pr) / total, 0)} %)`, INK.warn], ["One pixel at each new centre. The rest is skipped.", INK.ink4]]);
    if (sp.detail && fo.i !== null && fo.i !== undefined) drawDetail(g, sp.detail, fo, pp);
    foot(ap, [[`Reads ${fmtNum(ar)} of ${fmtNum(total)} px (${fmtPlain((100 * ar) / total, 0)} %)`, INK.ok], [src.kind === "classes" ? "The class that covers most of each new pixel." : "Each pixel under a new pixel, by covered area.", INK.ink4]]);
  };

  const drawRamp = (g) => {
    if (L.W < 640) return;
    const src = cache.src;
    const w = 228, h = 58, x = L.W - 16 - w, y = 16;
    panel(g, x, y, w, h, { accent: INK.err });
    g.font = `600 10px ${FONT_UI}`; g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText(src.kind === "classes" ? "CLASSES" : "VALUE", x + 22, y + 15);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
    const bx = x + 22, bw = w - 40, by = y + 25, bh = 12;
    if (src.kind === "classes") {
      const codes = [...new Set(src.data)].sort((a, b) => a - b);
      const cw = bw / (codes.length + 1);
      codes.forEach((c, k) => { g.fillStyle = CLASSES[c].color; g.fillRect(bx + k * cw, by, cw - 2, bh); });
      g.fillStyle = css(colourOf(1.5, src)); g.fillRect(bx + codes.length * cw, by, cw - 2, bh);
      g.save(); g.beginPath(); g.rect(bx + codes.length * cw, by, cw - 2, bh); g.clip();
      g.strokeStyle = "rgba(180,35,53,.9)"; g.lineWidth = 1.3; g.beginPath();
      for (let k = -bh; k < cw; k += 5) { g.moveTo(bx + codes.length * cw + k, by + bh); g.lineTo(bx + codes.length * cw + k + bh, by); }
      g.stroke(); g.restore();
      const label = `${codes.length} classes · hatched: not a class`;
      text(g, bx, by + bh + 10, label, { color: INK.ink3, size: 9.5, halo: false, mono: false });
    } else {
      const ext = 0.12;
      for (let i = 0; i < bw; i++) {
        const v = src.lo - ext * (src.hi - src.lo) + ((1 + 2 * ext) * (src.hi - src.lo) * i) / (bw - 1);
        g.fillStyle = css(colourOf(v, src)); g.fillRect(bx + i, by, 1, bh);
      }
      const X = (v) => bx + ((v - (src.lo - ext * (src.hi - src.lo))) / ((1 + 2 * ext) * (src.hi - src.lo))) * bw;
      text(g, X(src.lo), by + bh + 10, fmtPlain(src.lo), { color: INK.ink2, size: 10, align: "center", halo: false });
      text(g, X(src.hi), by + bh + 10, fmtPlain(src.hi), { color: INK.ink2, size: 10, align: "center", halo: false });
      text(g, bx, by + bh + 10, "<", { color: INK.err, size: 10, halo: false });
      text(g, bx + bw, by + bh + 10, ">", { color: INK.err, size: 10, align: "right", halo: false });
    }
  };

  const caption = () => {
    const src = cache.src;
    if (isRp()) {
      if (src.kind === "classes") return ["Shrink a class map onto a turned grid.", "Point sampling keeps classes but skips most pixels.", "Area majority looks at every pixel under the new one."];
      if (params.source === "spike") return ["Shrink thin lines and spikes onto a turned grid.", "Point sampling misses most of them.", "The area average keeps a part of each one."];
      return ["Shrink and turn the grid. Point or area?", "Point sampling reads one source pixel.", "Area weighting reads all pixels under the new pixel."];
    }
    const en = enabled();
    if (!en.length) return ["Turn on a method.", "Each method fills the new grid in a different way."];
    const fo = focusUp();
    if (fo.live && fo.method) {
      const m = fo.method;
      if (m === "nearest") return ["Nearest copies the closest pixel.", "It never makes a new value."];
      if (m === "bilinear") return ["Bilinear blends the four nearest pixels.", "The weights fall off in a straight line."];
      return ["Cubic blends sixteen pixels.", "Some weights are negative (red), so it can overshoot."];
    }
    if (src.kind === "classes") return ["Classes are codes, not amounts.", "Bilinear and cubic make codes that are not classes.", "For classes use nearest."];
    return ["Each new pixel takes its value from old pixels.", "Point at a new pixel to see its source pixels and weights.", "Click to pin the profile row."];
  };

  const draw = (g, W, H) => {
    const now = performance.now();
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016;
    lastT = now;
    rebuild();
    background(g, W, H);
    const compact = W < COMPACT_W, hs = H - (ctx.stage.insetBottom || 0);
    const cap = drawCaption(g, 16, 16, caption().slice(0, !compact ? undefined : hs < 330 ? 1 : hs < 400 ? 2 : undefined), { accent: isRp() ? INK.signal : INK.brass, maxWidth: compact ? W - 32 : Math.max(260, W - 300) });
    g.font = `600 12px ${FONT_UI}`;
    L = layoutOf(W, H, cap.h, g.measureText(`Source ${N} × ${N}`).width, swNeed(g));
    L.W = W;
    syncSwitch(L.sw);
    if (isRp()) drawReproject(g); else { drawUpsample(g); drawKernelRow(g, focusUp(), dt); }
    drawRamp(g);
    drawDiagram(g, dt);
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    rebuild();
    const src = cache.src;
    if (!isRp()) {
      const fo = focusUp();
      const F = f();
      const vals = {};
      if (fo.ox !== undefined) {
        for (const m of METHODS) vals[m] = params[m] ? cache.outs[m].data[fo.oy * N * F + fo.ox] : "off";
      } else {
        const v = src.data[fo.sj * N + fo.si];
        for (const m of METHODS) vals[m] = params[m] ? v : "off";
      }
      const st = cache.stats.cubic;
      const show = (v) => (typeof v !== "number" ? v : src.kind === "classes" ? (Math.abs(v - Math.round(v)) > 1e-9 ? fmtNum(v, 2) + " ✕" : fmtV(v, src)) : Math.abs(v) < 0.005 ? 0 : v);
      ctx.readout.setMany({
        nearest: show(vals.nearest), bilinear: show(vals.bilinear), cubic: show(vals.cubic),
        area: "–",
        range: `${fmtV(st.min)} / ${fmtV(st.max)}`,
        overshoot: enabled().some((m) => cache.stats[m].any) ? "yes" : "no",
      });
      return;
    }
    const fo = focusRp();
    const grid = cache.grid;
    if (fo.i === null || fo.i === undefined) {
      ctx.readout.setMany({ nearest: "–", bilinear: "–", cubic: "–", area: "–", range: "–", overshoot: "–" });
      return;
    }
    const pt = pointPixel(src, grid, fo.i, fo.j);
    const cls = src.kind === "classes";
    const near = src.data[pt.j * RP + pt.i];
    const bil = sample(src, pt.u - 0.5, pt.v - 0.5, "bilinear"), cub = sample(src, pt.u - 0.5, pt.v - 0.5, "cubic");
    const area = cache.outs.area.data[fo.j * grid.n + fo.i];
    const num = (v) => (cls ? (Math.abs(v - Math.round(v)) > 1e-9 ? fmtNum(v, 2) + " ✕" : fmtV(v, src)) : Math.abs(v) < 0.005 ? 0 : v);
    ctx.readout.setMany({ nearest: num(near), bilinear: num(bil), cubic: num(cub), area: num(area), range: "–", overshoot: "–" });
  };

  const chipFor = (h) => {
    const src = cache.src;
    if (!isRp()) {
      if (h.panel.kind === "source") {
        const v = src.data[h.j * N + h.i];
        const F = f();
        return [`source pixel (${h.i}, ${h.j})`, `value ${fmtV(v, src)}`, `feeds new pixels ${h.i * F}–${h.i * F + F - 1} with nearest`];
      }
      return null;
    }
    const grid = cache.grid;
    const fo = focusRp();
    if (h.panel.kind === "source") {
      const v = src.data[h.j * RP + h.i];
      return [`source pixel (${h.i}, ${h.j})`, `value ${fmtV(v, src)}`, fo.i === null ? "outside the new grid" : `inside new pixel (${fo.i}, ${fo.j})`];
    }
    const pt = pointPixel(src, grid, h.i, h.j);
    const cells = areaWeights(src, footprint(grid, h.i, h.j));
    const a = areaValue(src, cells);
    return [
      `new pixel (${h.i}, ${h.j})`,
      `point: ${fmtV(src.data[pt.j * RP + pt.i], src)} from 1 pixel`,
      src.kind === "classes" ? `area majority: ${fmtV(a.value, src)} (${fmtPlain(a.share * 100, 0)} % of the area)` : `area: ${fmtV(a.value, src)} from ${cells.length} pixels`,
    ];
  };

  stage.on("move", (X, Y) => {
    const h = hit(X, Y);
    const prev = hover;
    hover = h;
    if (h) {
      const lines = chipFor(h);
      if (lines) stage.chip(X, Y, lines); else stage.hideChip();
      stage.setCursor(isRp() && h.panel.kind === "source" ? "grab" : "crosshair");
    } else { stage.hideChip(); stage.setCursor("default"); }
    if (!h && !prev) return;
    readouts();
    stage.request();
  });
  stage.on("leave", () => { hover = null; diag = null; readouts(); stage.request(); });

  stage.on("down", (X, Y) => {
    if (ctx.side !== "A" || !isRp()) return null;
    const h = hit(X, Y);
    if (!h || h.panel.kind !== "source") return null;
    const sp = h.panel, s = pxOf(sp);
    const cx = sp.x + cache.grid.cx * s, cy = sp.y + cache.grid.cy * s;
    return { kind: "rotate", cx, cy, a0: Math.atan2(Y - cy, X - cx), r0: rot };
  });
  stage.on("drag", (claim, X, Y) => {
    if (claim.kind !== "rotate") return;
    const a = Math.atan2(Y - claim.cy, X - claim.cx);
    let r = claim.r0 + ((a - claim.a0) * 180) / Math.PI;
    r = ((Math.round(r) % 90) + 90) % 90;
    stage.setCursor("grabbing");
    stage.hideChip();
    if (r === rot) return;
    rot = r;
    hover = null;
    readouts();
    stage.request();
  });
  stage.on("dragEnd", (claim, X, Y, moved) => {
    if (claim.kind === "rotate" && moved) ctx.url.set("rot", rot === 20 ? null : String(rot));
  });
  stage.on("click", (X, Y) => {
    const h = hit(X, Y);
    if (!h) return;
    if (isRp()) {
      if (h.panel.kind !== "source") pinRp = [h.i, h.j];
    } else {
      const F = f();
      pinUp = h.panel.kind === "source" ? [h.i, h.j] : [srcPos(h.i, F), srcPos(h.j, F)];
      if (ctx.side === "A") ctx.url.set("pin", `${+pinUp[0].toFixed(3)},${+pinUp[1].toFixed(3)}`);
      startReveal();
    }
    readouts();
    stage.request();
  });

  const syncControls = () => {
    const rp = isRp();
    for (const m of METHODS) ctx.controls.disable(m, rp);
    ctx.controls.setLabel("factor", rp ? "Shrink factor" : "Upsample factor");
  };

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      syncControls();
      if (first) {
        first = false;
        stage.render();
        readouts();
        startReveal();
        stage.request();
        return;
      }
      if (keys.includes("mode") && prev.mode !== params.mode) { hover = null; diag = null; stage.hideChip(); }
      if (["source", "factor", "mode", ...METHODS].some((k) => keys.includes(k))) startReveal();
      readouts();
      stage.request();
    },
    resize() { stage.render(); readouts(); },
    unmount() {
      if (revealTween) revealTween.cancel();
      ctx.url.set("pin", null);
      ctx.url.set("rot", null);
      ctx.url.set("show", null);
      sw.remove();
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}

