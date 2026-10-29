import { normalizedDifference } from "@/core/raster.js";
import { divergingRGB, css } from "@/core/palette.js";
import { clamp, lerp } from "@/core/math.js";
import { pixelStage, background, text, panel, pill, spans, spansWidth, fmtNum, fmtPlain, drawCaption, imageCanvas, decodeScene, sceneRGB, rampRGB, hatch, niceStep, INK, FONT_UI, FONT_MONO, VIRIDIS } from "@/lessons/_pixelkit.js";

export const BANDS = ["blue", "green", "red", "nir", "swir1", "swir2"];
export const BAND_LABEL = { blue: "blue", green: "green", red: "red", nir: "NIR", swir1: "SWIR1", swir2: "SWIR2" };
export const PRESETS = {
  ndvi: { name: "NDVI", a: "nir", b: "red" },
  ndwi: { name: "NDWI", a: "green", b: "nir" },
  nbr: { name: "NBR", a: "nir", b: "swir2" },
};
export const DEFAULT_EXPR = "(nir - swir1) / (nir + swir1)";
export const PINS = { lake: [34, 30], forest: [90, 8], crop: [49, 80], soil: [35, 80], town: [100, 45], burn: [69, 108], cloud: [28, 92], nodata: [5, 5] };
const PIN_OPTIONS = [
  { value: "none", label: "None" }, { value: "lake", label: "Lake" }, { value: "forest", label: "Forest" }, { value: "crop", label: "Crop field" },
  { value: "soil", label: "Bare field" }, { value: "town", label: "Town" }, { value: "burn", label: "Burn scar" }, { value: "cloud", label: "Cloud" },
  { value: "nodata", label: "No-data corner" }, { value: "pixel", label: "Clicked pixel" },
];
export { VIRIDIS };
const NODATA_RGB = [228, 223, 212];
const ROLE_A = INK.brass, ROLE_B = "#6f9cf0", PIN_C = INK.violet;

export const meta = {
  id: "band-math",
  title: "Numbers from two bands",
  track: 6,
  order: 11,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "A satellite image is several bands, one per wavelength. Plants reflect strongly in the near-infrared and weakly in red. Divide the difference by the sum and you get NDVI. It runs from −1 to 1. Water is negative, bare soil near zero, dense leaves above 0.6.",
  deeper: [
    "NDVI = (NIR − red)/(NIR + red).",
    "NIR 0.5, red 0.1 → 0.667.",
    "NDWI uses green and NIR.",
    "Reflectance is a fraction from 0 to 1, often stored as an integer × 10,000.",
  ],
  keywords: ["NDVI", "NDWI", "NBR", "bands", "index", "ratio", "reflectance", "band math", "spectral"],
  controls: [
    { key: "index", type: "segment", label: "Index", options: [{ value: "ndvi", label: "NDVI" }, { value: "ndwi", label: "NDWI" }, { value: "nbr", label: "NBR" }, { value: "custom", label: "Custom" }], default: "ndvi" },
    { key: "expr", type: "text", label: "Expression", default: DEFAULT_EXPR },
    { key: "ramp", type: "segment", label: "Colour ramp", options: [{ value: "diverging", label: "Diverging" }, { value: "viridis", label: "Viridis" }], default: "diverging" },
    { key: "point", type: "select", label: "Pinned pixel", options: PIN_OPTIONS, default: "forest" },
    { type: "legend", label: "Key", items: [{ color: ROLE_A, label: "Band that pushes the result up" }, { color: ROLE_B, label: "Band that pushes the result down" }, { color: PIN_C, line: true, label: "Pinned pixel: click the image" }, { color: "#b42335", label: "Hatched: no data, no result" }] },
  ],
  readouts: [
    { key: "blue", label: "Blue", digits: 4 },
    { key: "green", label: "Green", digits: 4 },
    { key: "red", label: "Red", digits: 4 },
    { key: "nir", label: "NIR", digits: 4 },
    { key: "swir1", label: "SWIR1", digits: 4 },
    { key: "swir2", label: "SWIR2", digits: 4 },
    { key: "result", label: "Result", digits: 3, hero: true },
    { key: "class", label: "Class (NDVI)" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";

export function toReflectance(dn, scale = 10000, addOffset = 0) {
  return (dn + addOffset) / scale;
}

export function uint16Wrap(v) {
  return ((v % 65536) + 65536) % 65536;
}

export function uint16Index(aDn, bDn) {
  const den = uint16Wrap(aDn + bDn);
  return den ? uint16Wrap(aDn - bDn) / den : NaN;
}

export function classByNdvi(v) {
  if (!Number.isFinite(v)) return "no data";
  if (v < 0) return "water";
  if (v < 0.2) return "soil";
  if (v < 0.6) return "vegetation";
  return "dense vegetation";
}

const NAMES = { blue: 0, b2: 0, green: 1, b3: 1, red: 2, b4: 2, nir: 3, b8: 3, swir1: 4, b11: 4, swir2: 5, b12: 5 };
const OPS = { "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", "·": "*", "/": "/", "÷": "/" };

export function tokenize(src) {
  const s = String(src ?? "");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const v = Number(s.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`"${s.slice(i, j)}" is not a number.`);
      out.push({ t: "num", v, s: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-z0-9_]/i.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (!Object.hasOwn(NAMES, name)) throw new Error(`"${s.slice(i, j)}" is not a band name.`);
      out.push({ t: "band", i: NAMES[name], s: name });
      i = j;
      continue;
    }
    if (OPS[c]) { out.push({ t: "op", v: OPS[c] }); i++; continue; }
    if (c === "(" || c === ")") { out.push({ t: c }); i++; continue; }
    throw new Error(`"${c}" is not allowed.`);
  }
  return out;
}

const compile = (n) => {
  if (n.t === "num") { const v = n.v; return () => v; }
  if (n.t === "band") { const i = n.i; return (r) => r[i]; }
  if (n.t === "neg") { const f = compile(n.a); return (r) => -f(r); }
  const fa = compile(n.a), fb = compile(n.b);
  if (n.op === "+") return (r) => fa(r) + fb(r);
  if (n.op === "-") return (r) => fa(r) - fb(r);
  if (n.op === "*") return (r) => fa(r) * fb(r);
  return (r) => fa(r) / fb(r);
};

export function parseExpr(src) {
  try {
    if (String(src ?? "").length > 160) throw new Error("The expression is too long.");
    const toks = tokenize(src);
    if (!toks.length) throw new Error("Type an expression.");
    let p = 0;
    const peek = () => toks[p];
    const isOp = (k, ...ops) => k && k.t === "op" && ops.includes(k.v);
    const show = (k) => (k.t === "op" ? k.v : k.s ?? k.t);
    const primary = () => {
      const k = toks[p++];
      if (!k) throw new Error("The expression stops too early.");
      if (k.t === "num") return { t: "num", v: k.v };
      if (k.t === "band") return { t: "band", i: k.i };
      if (k.t === "(") {
        const e = sum();
        if (!toks[p] || toks[p].t !== ")") throw new Error("A bracket is not closed.");
        p++;
        return e;
      }
      throw new Error(`"${show(k)}" is in the wrong place.`);
    };
    const unary = () => {
      if (isOp(peek(), "-", "+")) { const op = toks[p++].v; const a = unary(); return op === "-" ? { t: "neg", a } : a; }
      return primary();
    };
    const product = () => {
      let a = unary();
      while (isOp(peek(), "*", "/")) { const at = p; const op = toks[p++].v; a = { t: "bin", op, a, b: unary(), at }; }
      return a;
    };
    const sum = () => {
      let a = product();
      while (isOp(peek(), "+", "-")) { const at = p; const op = toks[p++].v; a = { t: "bin", op, a, b: product(), at }; }
      return a;
    };
    const ast = sum();
    if (p < toks.length) throw new Error(`"${show(toks[p])}" is in the wrong place.`);
    const used = [...new Set(toks.filter((t) => t.t === "band").map((t) => t.i))].sort((a, b) => a - b);
    return { ok: true, ast, tokens: toks, used, fn: compile(ast) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function stripParens(toks) {
  if (toks.length < 2 || toks[0].t !== "(" || toks[toks.length - 1].t !== ")") return toks;
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === "(") depth++;
    else if (toks[i].t === ")") depth--;
    if (depth === 0 && i < toks.length - 1) return toks;
  }
  return toks.slice(1, -1);
}

export function specFor(index, expr) {
  const p = PRESETS[index];
  if (p) {
    const a = BANDS.indexOf(p.a), b = BANDS.indexOf(p.b);
    return { kind: "nd", id: index, name: p.name, a, b, used: [a, b], fn: (r) => normalizedDifference(r[a], r[b]) };
  }
  const e = parseExpr(expr);
  if (!e.ok) return { ...specFor("custom", DEFAULT_EXPR), error: e.error };
  const root = e.ast;
  const frac = root.t === "bin" && root.op === "/" ? { num: stripParens(e.tokens.slice(0, root.at)), den: stripParens(e.tokens.slice(root.at + 1)), numFn: compile(root.a), denFn: compile(root.b) } : null;
  return { kind: "expr", id: "custom", name: "Custom", used: e.used, tokens: e.tokens, fn: e.fn, frac };
}

export const REASON = { ok: 0, nodata: 1, divzero: 2 };

export function computeIndex(scene, spec, addOffset = 0) {
  const n = scene.width * scene.height;
  const values = new Float64Array(n), reason = new Uint8Array(n);
  const check = spec.used.length ? spec.used : BANDS.map((_, i) => i);
  const r = new Float64Array(BANDS.length);
  let min = Infinity, max = -Infinity, valid = 0;
  for (let k = 0; k < n; k++) {
    let bad = false;
    for (const b of check) if (scene.bands[b][k] === scene.nodata) { bad = true; break; }
    if (bad) { values[k] = NaN; reason[k] = REASON.nodata; continue; }
    for (let b = 0; b < r.length; b++) r[b] = toReflectance(scene.bands[b][k], scene.scale, addOffset);
    const v = spec.fn(r);
    if (!Number.isFinite(v)) { values[k] = NaN; reason[k] = REASON.divzero; continue; }
    values[k] = v;
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { values, reason, min, max, valid };
}

export function rampDomain(res, spec) {
  if (spec.kind === "nd" || !res.valid || (res.min >= -1 && res.max <= 1)) return [-1, 1];
  const m = Math.max(Math.abs(res.min), Math.abs(res.max));
  const s = niceStep(m, 4);
  return [-Math.ceil(m / s) * s, Math.ceil(m / s) * s];
}

export function rampColour(ramp, v, dom = [-1, 1]) {
  if (ramp === "viridis") return rampRGB(VIRIDIS, (v - dom[0]) / (dom[1] - dom[0]));
  return divergingRGB((2 * (v - dom[0])) / (dom[1] - dom[0]) - 1);
}

const ZONES = {
  ndvi: [{ lo: -1, hi: 0, label: "water" }, { lo: 0, hi: 0.2, label: "soil" }, { lo: 0.6, hi: 1, label: "dense leaves" }],
  ndwi: [{ lo: -1, hi: -0.3, label: "plants" }, { lo: 0, hi: 1, label: "water" }],
  nbr: [{ lo: -1, hi: -0.1, label: "burned" }, { lo: 0.4, hi: 1, label: "healthy plants" }],
};
const TRAP_HINT = { ndvi: "water", ndwi: "plants", nbr: "the burn scar" };

const COMPACT_W = 640, TAB_H = 42, PANEL_C = 194;

export function layoutFor({ W, H, insetBottom = 0, dpr = 1, custom = false, size = 128, panelH = PANEL_C }) {
  if (W < COMPACT_W) return compactLayoutFor({ W, H, insetBottom, dpr, size, panelH });
  const m = 16, gap = 22;
  const bottom = H - insetBottom - m;
  const RW = clamp(Math.round(W * 0.34), 292, 372);
  const AW = Math.max(160, W - 2 * m - gap - RW), AH = Math.max(160, bottom - m);
  const tg = 8, lab = 20;
  const s1 = Math.min(AW, (AH - lab - 16 + (6 * tg) / 7) * 7 / 8, 896);
  const s2 = Math.min(AW, (AH - 2 * lab - 16 - tg + (3 * tg) / 2) / 1.5, 896);
  const rows = s2 >= 0.9 * s1 ? 2 : 1;
  let S = Math.floor(rows === 2 ? s2 : s1);
  const snapped = (Math.floor((S * dpr) / size) * size) / dpr;
  if (snapped >= 0.88 * S) S = snapped;
  const per = rows === 2 ? 4 : 7;
  const ts = (S - (per - 1) * tg) / per;
  const thumbsH = rows * (ts + lab) + (rows - 1) * tg;
  const LH = thumbsH + 16 + S;
  const total = S + gap + RW;
  const x0 = Math.round(m + Math.max(0, (W - 2 * m - total) / 2));
  const top = Math.round(m + Math.max(0, (bottom - m - Math.max(LH, custom ? 646 : 600)) / 2));
  const tiles = Array.from({ length: 7 }, (_, i) => {
    const row = rows === 2 ? (i < 4 ? 0 : 1) : 0, col = rows === 2 ? (i < 4 ? i : i - 4) : i;
    return { x: x0 + col * (ts + tg), y: top + row * (ts + lab + tg), s: ts };
  });
  const slot = rows === 2 ? { x: x0 + 3 * (ts + tg), y: top + ts + lab + tg, s: ts } : null;
  const iy = Math.round(top + thumbsH + 16);
  return { W, H, m, bottom, top, rows, S, z: S / size, ix: x0, iy, tiles, slot, rx: x0 + S + gap, rw: RW, leftBottom: iy + S, compact: false };
}

function compactLayoutFor({ W, H, insetBottom, dpr, size, panelH }) {
  const m = 12, gap = 10, tg = 4, lab = 15;
  const bottom = H - insetBottom - m, Wav = W - 2 * m;
  let S = Math.floor(clamp(bottom - m - gap - panelH, 120, Wav - gap - 132));
  const snapped = (Math.floor((S * dpr) / size) * size) / dpr;
  if (snapped >= 0.88 * S) S = snapped;
  const top = Math.round(m + Math.max(0, (bottom - m - S - gap - panelH) / 2));
  const rx = m + S + gap, rw = Wav - S - gap;
  let best = null;
  for (const cols of [2, 3, 4]) {
    const rows = Math.ceil(7 / cols);
    const ts = Math.floor(Math.min((rw - (cols - 1) * tg) / cols, (S - (rows - 1) * tg) / rows - lab));
    if (!best || ts > best.ts) best = { cols, rows, ts };
  }
  const { cols, rows, ts } = best;
  const tiles = Array.from({ length: 7 }, (_, i) => ({ x: rx + (i % cols) * (ts + tg), y: top + Math.floor(i / cols) * (ts + lab + tg), s: ts }));
  const last = 7 - (rows - 1) * cols, ny = top + (rows - 1) * (ts + lab + tg);
  const note = last < cols ? { x: rx + last * (ts + tg), y: ny, w: rw - last * (ts + tg), h: top + S - ny } : { x: rx, y: ny + ts + lab + tg, w: rw, h: top + S - (ny + ts + lab + tg) };
  const py = top + S + gap;
  return { W, H, m, bottom, top, rows, S, z: S / size, ix: m, iy: top, tiles, slot: null, rx, rw, leftBottom: top + S, compact: true, note, panel: { x: m, y: py, w: Wav, h: Math.min(panelH, bottom - py) } };
}

const SCENE_FILE = "scene_synthetic.json";
const sceneCache = new WeakMap();

function bandThumb(scene, bi, lo, hi) {
  const SW = scene.width, SH = scene.height, n = SW * SH, band = scene.bands[bi], nd = scene.nodata;
  const c = document.createElement("canvas");
  c.width = SW; c.height = SH;
  const cg = c.getContext("2d");
  const im = cg.createImageData(SW, SH), px = im.data;
  const lut = new Uint8ClampedArray(1024 * 3);
  for (let q = 0; q < 1024; q++) {
    const g = 18 + 222 * Math.pow(q / 1023, 0.9);
    lut[q * 3] = g * 0.96; lut[q * 3 + 1] = g * 0.98; lut[q * 3 + 2] = g;
  }
  const k = 1023 / Math.max(1, hi - lo);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const d = band[i];
    if (d === nd) { px[o] = 7; px[o + 1] = 11; px[o + 2] = 22; }
    else {
      const q = Math.min(1023, Math.max(0, Math.round((d - lo) * k))) * 3;
      px[o] = lut[q]; px[o + 1] = lut[q + 1]; px[o + 2] = lut[q + 2];
    }
    px[o + 3] = 255;
  }
  cg.putImageData(im, 0, 0);
  return c;
}

function prepareScene(json) {
  const hit = sceneCache.get(json);
  if (hit) return hit;
  const scene = decodeScene(json);
  const SW = scene.width, SH = scene.height;
  const stretch = scene.bands.map((arr) => {
    const v = arr.filter((x) => x !== scene.nodata).sort();
    return [v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)]];
  });
  const thumbs = [
    { kind: "rgb", label: "true colour", nm: "", img: imageCanvas(SW, SH, (i, j) => sceneRGB(scene, j * SW + i)) },
    ...BANDS.map((b, bi) => ({ kind: "band", band: bi, label: BAND_LABEL[b], nm: `${scene.wavelengths[bi]} nm`, img: bandThumb(scene, bi, stretch[bi][0], stretch[bi][1]) })),
  ];
  const out = { scene, thumbs, addOffset: Number(json && json.offset) || 0 };
  sceneCache.set(json, out);
  return out;
}

function drawLoading(g, W, H, insetBottom, dpr) {
  background(g, W, H);
  const L = layoutFor({ W, H, insetBottom, dpr, size: 128 });
  g.fillStyle = "rgba(255,255,255,.55)";
  g.strokeStyle = "rgba(205,198,183,.6)";
  g.lineWidth = 1;
  for (const t of L.tiles) { g.beginPath(); g.roundRect(t.x + 0.5, t.y + 0.5, t.s, t.s, 4); g.fill(); g.stroke(); }
  g.beginPath(); g.roundRect(L.ix + 0.5, L.iy + 0.5, L.S, L.S, 6); g.fill(); g.stroke();
  const p = L.compact ? L.panel : { x: L.rx, y: L.top, w: L.rw, h: Math.max(120, L.leftBottom - L.top) };
  g.beginPath(); g.roundRect(p.x + 0.5, p.y + 0.5, p.w, p.h, 10); g.fill(); g.stroke();
  text(g, L.ix + L.S / 2, L.iy + L.S / 2, "Loading the scene", { color: INK.ink3, size: 13, mono: false, align: "center", halo: false });
}

export async function mount(ctx) {
  let params = { ...ctx.params };
  let json = ctx.data.get(SCENE_FILE);
  if (!json) {
    const wait = pixelStage(ctx, { draw: (g, W, H) => drawLoading(g, W, H, ctx.stage.insetBottom, ctx.stage.dpr || 1) });
    wait.render();
    try { json = await ctx.data.load(SCENE_FILE); } finally { wait.dispose(); }
  }
  const { scene, thumbs, addOffset } = prepareScene(json);
  const SW = scene.width, SH = scene.height;
  let first = true;
  let L = null;
  let spec = null, res = null, dom = [-1, 1], hist = null;
  let img = null, prevImg = null, hatchNow = null, hatchPrev = null, fade = 1, fadeTween = null;
  let rolesNow = new Array(7).fill(1), rolesPrev = rolesNow.slice();
  let hover = null, pin = null;
  let pinReveal = 1, pinTween = null;
  let hoverShown = null, hoverTween = null;
  let exprError = null;
  let built = null;
  const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
  const point = touch ? "Tap" : "Point at";

  const roleOf = (bi) => {
    if (!spec) return null;
    if (spec.kind === "nd") return bi === spec.a ? "a" : bi === spec.b ? "b" : null;
    return spec.used.includes(bi) ? "a" : null;
  };
  const roleColour = (bi) => { const r = roleOf(bi); return r === "a" ? ROLE_A : r === "b" ? ROLE_B : null; };

  const rebuild = (animate) => {
    built = `${params.index}|${params.expr}|${params.ramp}`;
    const next = specFor(params.index, params.expr);
    exprError = next.error || null;
    spec = next;
    res = computeIndex(scene, spec, addOffset);
    dom = rampDomain(res, spec);
    const lut = Array.from({ length: 512 }, (_, i) => rampColour(params.ramp, dom[0] + ((dom[1] - dom[0]) * i) / 511, dom));
    const colourOf = (v) => lut[clamp(Math.round(((v - dom[0]) / (dom[1] - dom[0])) * 511), 0, 511)];
    const bins = 48, counts = new Array(bins).fill(0);
    for (const v of res.values) if (v === v) counts[clamp(Math.floor(((v - dom[0]) / (dom[1] - dom[0])) * bins), 0, bins - 1)]++;
    hist = { bins, counts, max: Math.max(1, ...counts), colourOf };
    const nodataPath = new Path2D(), divPath = new Path2D();
    for (let j = 0; j < SH; j++) {
      let run = -1, kind = 0;
      for (let i = 0; i <= SW; i++) {
        const r = i < SW ? res.reason[j * SW + i] : 0;
        if (r !== kind) {
          if (kind) (kind === REASON.nodata ? nodataPath : divPath).rect(run, j, i - run, 1);
          kind = r; run = i;
        }
      }
    }
    const nextImg = document.createElement("canvas");
    nextImg.width = SW; nextImg.height = SH;
    const ng = nextImg.getContext("2d"), nim = ng.createImageData(SW, SH), npx = nim.data, vals = res.values;
    for (let i = 0, o = 0; i < vals.length; i++, o += 4) {
      const v = vals[i], c = v === v ? colourOf(v) : NODATA_RGB;
      npx[o] = c[0]; npx[o + 1] = c[1]; npx[o + 2] = c[2]; npx[o + 3] = 255;
    }
    ng.putImageData(nim, 0, 0);
    const nextRoles = thumbs.map((t) => (t.kind === "rgb" ? 0.9 : roleOf(t.band) ? 1 : 0.38));
    if (fadeTween) fadeTween.cancel();
    fadeTween = null;
    if (animate && img && !ctx.reducedMotion) {
      prevImg = img; hatchPrev = hatchNow;
      rolesPrev = rolesNow.map((a, i) => lerp(rolesPrev[i], a, fade));
      fade = 0;
      fadeTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (v) => { fade = v; stage.request(); }, onDone: () => { fade = 1; prevImg = null; hatchPrev = null; fadeTween = null; stage.request(); } });
    } else {
      prevImg = null; hatchPrev = null; fade = 1;
      rolesPrev = nextRoles;
    }
    img = nextImg;
    hatchNow = { nodata: nodataPath, div: divPath };
    rolesNow = nextRoles;
  };

  const pixelInfo = (c, r) => {
    if (c === null || c === undefined || c < 0 || r < 0 || c >= SW || r >= SH) return null;
    const k = r * SW + c;
    const dn = scene.bands.map((b) => b[k]);
    const refl = dn.map((d) => toReflectance(d, scene.scale, addOffset));
    const nd = dn[3] === scene.nodata || dn[2] === scene.nodata;
    return {
      c, r, k, dn, refl,
      isNodata: dn.map((d) => d === scene.nodata),
      value: res.values[k], reason: res.reason[k],
      ndvi: nd ? NaN : normalizedDifference(refl[3], refl[2]),
      truth: scene.classNames[scene.classes[k]],
    };
  };
  const focus = () => (hover ? pixelInfo(hover[0], hover[1]) : pin ? pixelInfo(pin[0], pin[1]) : null);

  const r4 = (v) => fmtNum(v, 4);
  const r3 = (v) => fmtNum(v, 3);
  const tokenSpans = (tokens, info, colourFor) => {
    const out = [];
    tokens.forEach((t, i) => {
      const prev = tokens[i - 1];
      if (t.t === "op") {
        const unary = (t.v === "-" || t.v === "+") && (!prev || prev.t === "op" || prev.t === "(");
        const sym = { "+": "+", "-": "−", "*": "×", "/": "/" }[t.v];
        out.push([unary ? sym : ` ${sym} `, INK.ink3]);
      } else if (t.t === "band") out.push([info ? r4(info.refl[t.i]) : BAND_LABEL[BANDS[t.i]], colourFor(t.i)]);
      else if (t.t === "num") out.push([t.s, INK.ink2]);
      else out.push([t.t, INK.ink3]);
    });
    return out;
  };
  const wrapSpans = (g, parts, maxW, size) => {
    const lines = [[]];
    let w = 0;
    for (const p of parts) {
      const pw = spansWidth(g, [p], { size });
      if (w + pw > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; }
      lines[lines.length - 1].push(p);
      w += pw;
    }
    return lines;
  };

  const chipLines = (info) => {
    const head = `col ${info.c}, row ${info.r} · truth: ${info.truth}`;
    if (spec.kind === "nd") {
      const A = BAND_LABEL[BANDS[spec.a]], B = BAND_LABEL[BANDS[spec.b]];
      if (info.reason === REASON.nodata) return [head, `${A} DN ${info.dn[spec.a]} · ${B} DN ${info.dn[spec.b]}: 0 means no data`, `(0 − 0) / (0 + 0) has no answer`, `${spec.name}: no data, not 0`];
      const a = info.refl[spec.a], b = info.refl[spec.b];
      return [head, `${A} ${fmtNum(info.dn[spec.a])} → ${r4(a)} · ${B} ${fmtNum(info.dn[spec.b])} → ${r4(b)}`, `(${r4(a)} − ${r4(b)}) / (${r4(a)} + ${r4(b)})`, `= ${r4(a - b)} / ${r4(a + b)} = ${r3(info.value)}`, `class by NDVI: ${classByNdvi(info.ndvi)}`];
    }
    const used = spec.used.map((bi) => `${BAND_LABEL[BANDS[bi]]} ${info.isNodata[bi] ? "no data" : r4(info.refl[bi])}`).join(" · ");
    const filled = tokenSpans(spec.tokens, info.reason === REASON.nodata ? null : info, () => null).map((p) => p[0]).join("");
    const result = info.reason === REASON.nodata ? "no data" : info.reason === REASON.divzero ? "divide by zero: no result" : r3(info.value);
    return [head, used || "no bands used", filled, `= ${result}`, `class by NDVI: ${classByNdvi(info.ndvi)}`];
  };

  const layoutOf = (W, H, panelH) => layoutFor({ W, H, insetBottom: ctx.stage.insetBottom, dpr: ctx.stage.dpr || 1, custom: params.index === "custom", size: SW, panelH });

  const snapLine = (v) => { const d = stage.dpr; return (Math.round(v * d - 0.5) + 0.5) / d; };

  const drawImageFrame = (g, im, x, y, s, alpha = 1) => {
    if (!im || alpha <= 0) return;
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = false;
    g.drawImage(im, x, y, s, s);
    g.globalAlpha = 1;
  };
  const drawHatch = (g, paths, alpha) => {
    if (!paths || alpha <= 0) return;
    const { ix, iy, z, S } = L;
    for (const [path, colour] of [[paths.nodata, "rgba(180,35,53,.62)"], [paths.div, "rgba(183,121,31,.7)"]]) {
      g.save();
      g.translate(ix, iy); g.scale(z, z);
      g.clip(path);
      g.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
      g.globalAlpha = alpha;
      g.fillStyle = "#f1ede4"; g.fillRect(ix, iy, S, S);
      hatch(g, ix, iy, S, S, { color: colour, step: 6, width: 1 });
      g.restore();
    }
  };

  const drawThumbs = (g) => {
    const info = focus();
    thumbs.forEach((t, i) => {
      const r = L.tiles[i];
      const a = lerp(rolesPrev[i], rolesNow[i], fade);
      g.fillStyle = "#f1ede4"; g.fillRect(r.x, r.y, r.s, r.s);
      drawImageFrame(g, t.img, r.x, r.y, r.s, a);
      const rc = t.kind === "band" ? roleColour(t.band) : null;
      g.strokeStyle = rc || "rgba(205,198,183,.9)";
      g.lineWidth = rc ? 2 : 1;
      g.strokeRect(r.x + (rc ? 1 : 0.5), r.y + (rc ? 1 : 0.5), r.s - (rc ? 2 : 1), r.s - (rc ? 2 : 1));
      if (info) {
        const X = r.x + ((info.c + 0.5) / SW) * r.s, Y = r.y + ((info.r + 0.5) / SH) * r.s;
        g.strokeStyle = hover ? "#ffffff" : PIN_C; g.lineWidth = 1.5;
        g.beginPath(); g.arc(X, Y, 3.5, 0, 2 * Math.PI); g.stroke();
      }
      const ly = r.y + r.s + (L.compact ? 9 : 11);
      const name = t.kind === "rgb" ? "RGB" : t.label;
      const w = text(g, r.x, ly, name, { color: rc || (t.kind === "rgb" ? INK.ink2 : INK.ink3), size: 10.5, weight: rc ? 700 : 600, halo: false });
      if (t.nm && r.s > 54) text(g, r.x + w + 5, ly, t.nm, { color: INK.ink4, size: 10, halo: false });
      if (t.kind === "band" && info && hover && r.s > 70) {
        const v = info.isNodata[t.band] ? "no data" : r4(info.refl[t.band]);
        pill(g, r.x + r.s - 4, r.y + r.s - 12, v, { align: "right", size: 10, color: rc || INK.ink2 });
      }
    });
    if (L.slot) {
      const { x, y, s } = L.slot;
      const rows = [["SCENE", INK.ink3], [`${SW} × ${SH} px`, INK.ink2], ["6 bands", INK.ink2], ["uint16", INK.ink2], [`DN ÷ ${fmtNum(scene.scale)}`, INK.ink2], [`${scene.nodata} = no data`, INK.err], ["synthetic", INK.ink4]];
      const step = Math.min(15, (s + 14) / rows.length);
      const fs = s < 90 ? 9.5 : 10.5;
      rows.forEach(([str, c], i) => text(g, x + 2, y + 6 + i * step, str, { color: c, size: i ? fs : 9.5, weight: i ? 500 : 600, mono: i > 0, halo: false }));
    }
  };

  const drawResult = (g) => {
    const { ix, iy, S, z } = L;
    g.fillStyle = "#f1ede4"; g.fillRect(ix, iy, S, S);
    if (prevImg) { drawImageFrame(g, prevImg, ix, iy, S, 1); drawHatch(g, hatchPrev, 1 - fade); }
    drawImageFrame(g, img, ix, iy, S, fade);
    drawHatch(g, hatchNow, fade);
    g.strokeStyle = "rgba(205,198,183,.95)"; g.lineWidth = 1;
    g.strokeRect(snapLine(ix - 1), snapLine(iy - 1), S + 1, S + 1);
    const head = spec.kind === "nd" ? `${spec.name} = (${BAND_LABEL[BANDS[spec.a]]} − ${BAND_LABEL[BANDS[spec.b]]}) / (${BAND_LABEL[BANDS[spec.a]]} + ${BAND_LABEL[BANDS[spec.b]]})` : "Custom";
    const ps = L.S < 400 ? 10 : 11;
    g.font = `600 ${ps}px ${FONT_MONO}`;
    if (g.measureText(head).width + 12 <= S - 16) pill(g, ix + 8, iy + S - 14, head, { align: "left", size: ps, color: INK.ink, bg: "rgba(250,248,243,.84)" });
    const mark = (c, r, colour, w) => {
      const s = Math.max(z, 7);
      const X = ix + (c + 0.5) * z, Y = iy + (r + 0.5) * z;
      g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = w + 2.5;
      g.strokeRect(X - s / 2, Y - s / 2, s, s);
      g.strokeStyle = colour; g.lineWidth = w;
      g.strokeRect(X - s / 2, Y - s / 2, s, s);
      return [X, Y, s];
    };
    if (hover) {
      const X = ix + (hover[0] + 0.5) * z, Y = iy + (hover[1] + 0.5) * z;
      g.strokeStyle = "rgba(26,25,23,.22)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ix, snapLine(Y)); g.lineTo(ix + S, snapLine(Y)); g.moveTo(snapLine(X), iy); g.lineTo(snapLine(X), iy + S); g.stroke();
    }
    if (pin) {
      const [X, Y, s] = mark(pin[0], pin[1], PIN_C, 2);
      const label = `pinned · ${PIN_OPTIONS.find((o) => o.value === params.point)?.label.toLowerCase() || "pixel"}`;
      const above = Y - s / 2 - 14 > iy + 30;
      g.font = `600 10px ${FONT_MONO}`;
      const half = Math.max(60, (g.measureText(label).width + 12) / 2 + 4);
      pill(g, clamp(X, ix + half, ix + S - half), above ? Y - s / 2 - 13 : Y + s / 2 + 13, label, { size: 10, color: PIN_C, border: "rgba(112,70,166,.5)" });
    }
    if (hover) mark(hover[0], hover[1], "#ffffff", 1.5);
  };

  const fracParts = (g, x, yMid, num, den, size) => {
    const wn = spansWidth(g, num, { size }), wd = spansWidth(g, den, { size });
    const w = Math.max(wn, wd) + 6;
    spans(g, x + (w - wn) / 2, yMid - size * 0.82, num, { size });
    g.strokeStyle = INK.ink3; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, snapLine(yMid)); g.lineTo(x + w, snapLine(yMid)); g.stroke();
    spans(g, x + (w - wd) / 2, yMid + size * 0.9, den, { size });
    return w;
  };
  const fracW = (g, num, den, size) => Math.max(spansWidth(g, num, { size }), spansWidth(g, den, { size })) + 6;

  const formulaRows = (g, w, tight = false) => {
    const info = focus();
    const rows = [];
    const inner = w - 36;
    const size = 12;
    const FR = tight ? 36 : 40, G1 = tight ? 2 : 4, G2 = tight ? 4 : 6, LN = tight ? 16 : 17, SM = tight ? 15 : 16, WL = tight ? 16 : 18, RL = tight ? 20 : 22;
    const line = (parts, h = LN, sz = 11, opt = false) => rows.push({ h, opt, draw: (x, y) => spans(g, x, y + h / 2, parts, { size: sz }) });
    const gapRow = (h, opt = false) => rows.push({ h, opt, draw() {} });
    if (spec.kind === "nd") {
      const A = BAND_LABEL[BANDS[spec.a]], B = BAND_LABEL[BANDS[spec.b]];
      const num = [[A, ROLE_A, 700], [" − ", INK.ink3], [B, ROLE_B, 700]], den = [[A, ROLE_A, 700], [" + ", INK.ink3], [B, ROLE_B, 700]];
      rows.push({ h: FR, draw: (x, y) => { const w0 = spans(g, x, y + FR / 2, [[`${spec.name} = `, INK.ink, 700]], { size }); fracParts(g, x + w0, y + FR / 2, num, den, size); } });
      if (!info) { gapRow(G1); line([[`${point} a pixel to fill in the numbers.`, INK.ink3]], LN, 11); return rows; }
      gapRow(G1);
      for (const [bi, col] of [[spec.a, ROLE_A], [spec.b, ROLE_B]]) {
        const name = BAND_LABEL[BANDS[bi]].padEnd(6);
        if (info.isNodata[bi]) line([[name, col, 700], [`DN ${info.dn[bi]}`, INK.ink], ["  = no data", INK.err]]);
        else line([[name, col, 700], [`DN ${fmtNum(info.dn[bi])}`, INK.ink], [` ÷ ${fmtNum(scene.scale)} = `, INK.ink3], [r4(info.refl[bi]), col, 600]]);
      }
      gapRow(G2);
      if (info.reason === REASON.nodata) {
        line([["(0 − 0) / (0 + 0) has no answer.", INK.err]]);
        line([["The pixel gets no data, not 0.", INK.ink2]]);
        return rows;
      }
      const a = info.refl[spec.a], b = info.refl[spec.b];
      const n1 = [[r4(a), ROLE_A, 600], [" − ", INK.ink3], [r4(b), ROLE_B, 600]], d1 = [[r4(a), ROLE_A, 600], [" + ", INK.ink3], [r4(b), ROLE_B, 600]];
      const n2 = [[r4(a - b), INK.ink]], d2 = [[r4(a + b), INK.ink]];
      const resStr = r3(info.value);
      const wide = spansWidth(g, [["= "], ["  =  "], ["  =  "]], { size }) + fracW(g, n1, d1, size) + fracW(g, n2, d2, size) + spansWidth(g, [[resStr, INK.ink, 700]], { size: 15 }) + 18 <= inner;
      const yc = FR / 2;
      rows.push({
        h: FR,
        draw: (x, y) => {
          let cx = x + spans(g, x, y + yc, [["= ", INK.ink3]], { size });
          cx += fracParts(g, cx, y + yc, n1, d1, size);
          if (wide) { cx += spans(g, cx, y + yc, [["  =  ", INK.ink3]], { size }); cx += fracParts(g, cx, y + yc, n2, d2, size); }
          cx += spans(g, cx, y + yc, [["  =  ", INK.ink3]], { size });
          const col = css(rampColour(params.ramp, clamp(info.value, dom[0], dom[1]), dom));
          g.fillStyle = col; g.beginPath(); g.roundRect(cx, y + yc - 7, 14, 14, 3); g.fill();
          g.strokeStyle = "rgba(60,52,40,.45)"; g.lineWidth = 1; g.stroke();
          spans(g, cx + 20, y + yc, [[resStr, INK.ink, 700]], { size: 15 });
        },
      });
      gapRow(G2, true);
      const aDn = info.dn[spec.a], bDn = info.dn[spec.b];
      if (aDn < bDn) {
        line([["uint16: ", INK.warn, 700], [`${aDn} − ${bDn}`, INK.ink2], [" wraps to ", INK.ink3], [fmtPlain(uint16Wrap(aDn - bDn)), INK.warn, 700]], SM, 10.5, true);
        line([["result ", INK.ink3], [fmtNum(uint16Index(aDn, bDn), 2), INK.warn, 700], [", float ", INK.ink3], [resStr, INK.ok, 700], [". Use float.", INK.ink3]], SM, 10.5, true);
      } else {
        line([["uint16: ", INK.ink3, 700], [`${aDn} − ${bDn} = ${aDn - bDn}`, INK.ink3], [", no wrap here.", INK.ink4]], SM, 10.5, true);
        line([[`${point} ${TRAP_HINT[spec.id]}: there it wraps.`, INK.ink4]], SM, 10.5, true);
      }
      return rows;
    }
    const colourFor = () => ROLE_A;
    const fr = spec.frac;
    const symN = fr && tokenSpans(fr.num, null, colourFor), symD = fr && tokenSpans(fr.den, null, colourFor);
    if (fr && fracW(g, symN, symD, size) <= inner) {
      rows.push({ h: FR, draw: (x, y) => fracParts(g, x, y + FR / 2, symN, symD, size) });
    } else {
      for (const ln of wrapSpans(g, tokenSpans(spec.tokens, null, colourFor), inner, 11)) line(ln, WL, 11);
    }
    if (!info) { gapRow(G1); line([[`${point} a pixel to fill in the numbers.`, INK.ink3]]); return rows; }
    gapRow(G1);
    const used = spec.used;
    for (let i = 0; i < used.length; i += 2) {
      const parts = [];
      for (const bi of used.slice(i, i + 2)) parts.push([BAND_LABEL[BANDS[bi]].padEnd(6), ROLE_A, 700], [info.isNodata[bi] ? "no data   " : `${r4(info.refl[bi])}   `, info.isNodata[bi] ? INK.err : INK.ink]);
      line(parts);
    }
    gapRow(G2);
    if (info.reason === REASON.nodata) { line([["No data in a band: no result.", INK.err]]); return rows; }
    const resParts = info.reason === REASON.divzero ? [["no result", INK.warn, 700]] : [[r3(info.value), INK.ink, 700]];
    const filN = fr && tokenSpans(fr.num, info, colourFor), filD = fr && tokenSpans(fr.den, info, colourFor);
    if (fr && spansWidth(g, [["= "]], { size }) + fracW(g, filN, filD, size) <= inner) {
      const nv = fr.numFn(info.refl), dv = fr.denFn(info.refl);
      const valN = [[fmtNum(nv, 4), INK.ink]], valD = [[fmtNum(dv, 4), dv === 0 ? INK.warn : INK.ink]];
      const restW = spansWidth(g, [["  =  "], ["  =  "]], { size }) + fracW(g, valN, valD, size) + spansWidth(g, resParts, { size: 14 });
      const inline = spansWidth(g, [["= "]], { size }) + fracW(g, filN, filD, size) + restW <= inner;
      rows.push({
        h: FR,
        draw: (x, y) => {
          const yc = y + FR / 2;
          let cx = x + spans(g, x, yc, [["= ", INK.ink3]], { size });
          cx += fracParts(g, cx, yc, filN, filD, size);
          if (inline) { cx += spans(g, cx, yc, [["  =  ", INK.ink3]], { size }); cx += fracParts(g, cx, yc, valN, valD, size); spans(g, cx, yc, [["  =  ", INK.ink3], ...resParts], { size: 14 }); }
        },
      });
      if (!inline) line([["= ", INK.ink3], [fmtNum(nv, 4), INK.ink], [" / ", INK.ink3], [fmtNum(dv, 4), dv === 0 ? INK.warn : INK.ink], [" = ", INK.ink3], ...resParts], RL, size);
    } else {
      for (const ln of wrapSpans(g, [["= ", INK.ink3], ...tokenSpans(spec.tokens, info, colourFor)], inner, 11)) line(ln, WL, 11);
      line([["= ", INK.ink3], ...resParts], RL, 14);
    }
    if (info.reason === REASON.divzero) line([["The bottom is zero: no result.", INK.warn]], LN, 11);
    return rows;
  };

  const rowsH = (rows) => rows.reduce((s, r) => s + r.h, 0);
  const formulaHeight = (rows) => 34 + rowsH(rows) + 10;
  const fitRows = (rows, room) => (rowsH(rows) <= room ? rows : rows.filter((r) => !r.opt));

  const drawFormula = (g, x, y, w, rows, tab = 0) => {
    const h = formulaHeight(rows);
    if (!tab) panel(g, x, y, w, h, { accent: spec.kind === "nd" ? ROLE_A : INK.signal });
    const info = focus();
    if (!tab) title(g, x + 22, y + 17, spec.kind === "nd" ? `${spec.name} in float` : "Your expression");
    if (info) {
      const str = `col ${info.c}, row ${info.r}`;
      g.font = `500 10.5px ${FONT_MONO}`;
      if (!tab || x + w - 14 - g.measureText(str).width >= tab + 10) text(g, x + w - 14, tab ? y + 21 : y + 17, str, { color: hover ? INK.ink2 : PIN_C, size: 10.5, align: "right", halo: false });
    }
    let cy = tab ? y + TAB_H : y + 30;
    for (const r of rows) { r.draw(x + 22, cy); cy += r.h; }
    return h;
  };

  const title = (g, x, y, str) => {
    g.font = `600 10px ${FONT_UI}`;
    g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText(str.toUpperCase(), x, y);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
  };

  const drawSpectrum = (g, x, y, w, h, tab = 0) => {
    const hy = tab ? y + 21 : y + 17;
    if (!tab) {
      panel(g, x, y, w, h, { accent: PIN_C });
      title(g, x + 22, hy, "Spectrum");
    }
    let lx = x + w - 14;
    for (const [colour, str] of [[PIN_C, "pinned"], ["#ffffff", "pointer"]]) {
      g.font = `500 10px ${FONT_UI}`;
      const sw = g.measureText(str).width;
      if (tab && lx - sw - 18 < tab + 10) break;
      lx -= sw;
      text(g, lx, hy, str, { color: INK.ink3, size: 10, halo: false, mono: false });
      g.strokeStyle = colour; g.lineWidth = 2;
      g.beginPath(); g.moveTo(lx - 18, hy); g.lineTo(lx - 5, hy); g.stroke();
      lx -= 32;
    }
    const px0 = x + 50, px1 = x + w - 16, py0 = (tab ? y + TAB_H : y + 30) + 6, py1 = y + h - 36;
    const ymax = 0.7;
    const X = (i) => px0 + ((i + 0.5) * (px1 - px0)) / BANDS.length;
    const Y = (v) => py1 - (clamp(v, 0, ymax) / ymax) * (py1 - py0);
    const bw = (px1 - px0) / BANDS.length;
    for (let i = 0; i < BANDS.length; i++) {
      const rc = roleColour(i);
      if (!rc) continue;
      g.fillStyle = rc === ROLE_A ? "rgba(184,82,23,.10)" : "rgba(61,110,180,.12)";
      g.fillRect(X(i) - bw / 2 + 2, py0 - 6, bw - 4, py1 - py0 + 6);
    }
    g.lineWidth = 1;
    for (let v = 0; v <= ymax + 1e-9; v += 0.1) {
      const yy = snapLine(Y(v));
      g.strokeStyle = Math.abs(v) < 1e-9 ? "rgba(60,52,40,.35)" : "rgba(60,52,40,.10)";
      g.beginPath(); g.moveTo(px0, yy); g.lineTo(px1, yy); g.stroke();
      if (Math.round(v * 10) % 2 === 0) text(g, px0 - 8, yy, v.toFixed(1), { color: INK.ink4, size: 9.5, align: "right", halo: false });
    }
    g.save();
    g.translate(x + 16, (py0 + py1) / 2); g.rotate(-Math.PI / 2);
    text(g, 0, 0, "reflectance", { color: INK.ink4, size: 9.5, align: "center", halo: false, mono: false });
    g.restore();
    for (let i = 0; i < BANDS.length; i++) {
      const rc = roleColour(i);
      text(g, X(i), py1 + 12, BAND_LABEL[BANDS[i]], { color: rc || INK.ink3, size: 10, weight: rc ? 700 : 500, align: "center", halo: false });
      text(g, X(i), py1 + 25, String(scene.wavelengths[i]), { color: INK.ink4, size: 9, align: "center", halo: false });
    }
    const series = (vals, colour, reveal, width) => {
      const pts = vals.map((v, i) => [X(i), Y(v)]);
      const segs = pts.length - 1;
      const upto = reveal * segs;
      g.strokeStyle = colour; g.lineWidth = width; g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= segs; i++) {
        const f = clamp(upto - (i - 1), 0, 1);
        if (f <= 0) break;
        g.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f));
      }
      g.stroke();
      pts.forEach(([px, py], i) => {
        if (i > upto + 1e-6) return;
        g.beginPath(); g.arc(px, py, roleColour(i) ? 4 : 3, 0, 2 * Math.PI);
        g.fillStyle = roleColour(i) || colour; g.fill();
        g.strokeStyle = "#faf8f3"; g.lineWidth = 1.2; g.stroke();
      });
    };
    const pinInfo = pin ? pixelInfo(pin[0], pin[1]) : null;
    const usable = (info) => info && !info.isNodata.every(Boolean);
    if (usable(pinInfo)) series(pinInfo.refl, PIN_C, pinReveal, 2);
    if (hover && hoverShown) series(hoverShown, "#ffffff", 1, 1.6);
    const info = focus();
    if (info && spec.kind === "nd" && !info.isNodata[spec.a] && !info.isNodata[spec.b] && (hoverShown || !hover)) {
      const vals = hover ? hoverShown : info.refl;
      const ya = Y(vals[spec.a]), yb = Y(vals[spec.b]);
      const gx = Math.max(X(spec.a), X(spec.b)) + 12;
      if (gx < px1 - 4 && Math.abs(ya - yb) > 6) {
        g.strokeStyle = "rgba(26,25,23,.5)"; g.lineWidth = 1; g.setLineDash([2, 3]);
        g.beginPath(); g.moveTo(X(spec.a) + 6, ya); g.lineTo(gx, ya); g.moveTo(X(spec.b) + 6, yb); g.lineTo(gx, yb); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = ROLE_A; g.lineWidth = 2;
        g.beginPath(); g.moveTo(gx, ya); g.lineTo(gx, yb); g.stroke();
      }
    }
    if (!usable(pinInfo) && !hover) text(g, (px0 + px1) / 2, (py0 + py1) / 2, info ? "No data at this pixel." : "Point at a pixel.", { color: INK.ink3, size: 11, align: "center", mono: false });
  };

  const LEGEND_H = 118;
  const drawLegend = (g, x, y, w, tab = 0, h = LEGEND_H) => {
    const hy = tab ? y + 21 : y + 17, c0 = tab ? y + TAB_H : y + 30;
    if (!tab) {
      panel(g, x, y, w, h, { accent: INK.signal });
      title(g, x + 22, hy, `${spec.name} · ${params.ramp}`);
    }
    const ranges = res.valid ? [`scene ${r3(res.min)} to ${r3(res.max)}`, `${r3(res.min)} to ${r3(res.max)}`] : ["no valid pixels"];
    g.font = `500 10px ${FONT_MONO}`;
    const range = ranges.find((str) => !tab || x + w - 14 - g.measureText(str).width >= tab + 10);
    if (range) text(g, x + w - 14, hy, range, { color: INK.ink3, size: 10, align: "right", halo: false });
    const bx = x + 22, bw = w - 40, hy0 = c0, hh = tab ? clamp(y + h - c0 - 58, 30, 90) : 30, by = hy0 + hh + 2, bh = 9;
    const T = (v) => bx + ((v - dom[0]) / (dom[1] - dom[0])) * bw;
    const binW = bw / hist.bins;
    g.beginPath();
    g.moveTo(bx, hy0 + hh);
    for (let i = 0; i < hist.bins; i++) {
      const hgt = (Math.sqrt(hist.counts[i]) / Math.sqrt(hist.max)) * hh;
      const v = dom[0] + ((i + 0.5) / hist.bins) * (dom[1] - dom[0]);
      g.fillStyle = css(hist.colourOf(v));
      g.fillRect(bx + i * binW, hy0 + hh - hgt, binW + 0.5, hgt);
    }
    for (let i = 0; i < hist.bins; i++) {
      const hgt = (Math.sqrt(hist.counts[i]) / Math.sqrt(hist.max)) * hh;
      g.lineTo(bx + i * binW, hy0 + hh - hgt); g.lineTo(bx + (i + 1) * binW, hy0 + hh - hgt);
    }
    g.lineTo(bx + bw, hy0 + hh);
    g.strokeStyle = "rgba(60,52,40,.5)"; g.lineWidth = 1; g.stroke();
    for (let i = 0; i < bw; i++) { g.fillStyle = css(hist.colourOf(dom[0] + ((i + 0.5) / bw) * (dom[1] - dom[0]))); g.fillRect(bx + i, by, 1.5, bh); }
    g.strokeStyle = "rgba(60,52,40,.35)"; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    const span = dom[1] - dom[0];
    for (let k = 0; k <= 4; k++) {
      const v = dom[0] + (k * span) / 4;
      g.strokeStyle = "rgba(60,52,40,.45)"; g.beginPath(); g.moveTo(snapLine(T(v)), by + bh); g.lineTo(snapLine(T(v)), by + bh + 3); g.stroke();
      text(g, T(v), by + bh + 11, fmtNum(v, span > 4 ? 0 : v % 1 ? 1 : 0), { color: INK.ink3, size: 9.5, align: k === 0 ? "left" : k === 4 ? "right" : "center", halo: false });
    }
    const zones = spec.kind === "nd" ? ZONES[spec.id] : null;
    if (zones) {
      const zy = by + bh + 26;
      for (const z of zones) {
        const a = T(z.lo) + 2, b = T(z.hi) - 2;
        g.strokeStyle = "rgba(60,52,40,.45)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(a, zy - 6); g.lineTo(a, zy - 3); g.lineTo(b, zy - 3); g.lineTo(b, zy - 6); g.stroke();
        text(g, (a + b) / 2, zy + 5, z.label, { color: INK.ink2, size: 9.5, align: "center", halo: false, mono: false });
      }
    } else text(g, bx, by + bh + 30, "Colours stop at the ends of the bar.", { color: INK.ink4, size: 10, halo: false, mono: false });
    const marker = (v, colour) => {
      if (!Number.isFinite(v)) return;
      const mx = T(clamp(v, dom[0], dom[1]));
      g.fillStyle = colour; g.strokeStyle = "#faf8f3"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(mx, by - 1); g.lineTo(mx - 5, by - 8); g.lineTo(mx + 5, by - 8); g.closePath(); g.fill(); g.stroke();
      g.fillRect(mx - 0.75, by, 1.5, bh);
    };
    if (pin) marker(res.values[pin[1] * SW + pin[0]], PIN_C);
    if (hover) marker(res.values[hover[1] * SW + hover[0]], "#ffffff");
  };

  const caption = () => {
    if (spec.kind === "expr" || exprError) {
      if (exprError) return ["The expression has an error.", exprError];
      return ["Type an expression. Press Enter.", "Bands: blue green red nir swir1 swir2."];
    }
    const how = touch ? "Tap a pixel to pin it." : "Point at a pixel. Click to pin it.";
    if (spec.id === "ndwi") return ["Water: bright green, dark NIR.", how];
    if (spec.id === "nbr") return ["Burn scars: dark NIR, bright SWIR2.", how];
    return ["Leaves: bright NIR, dark red.", how];
  };
  const capAccent = () => (exprError ? INK.err : spec.kind === "nd" ? ROLE_A : INK.signal);

  const drawNote = (g, box, lines) => {
    if (!box || box.w < 64 || box.h < 18) return;
    const fonts = [`600 11.5px ${FONT_UI}`, `400 11px ${FONT_UI}`], lh = 14, tw = box.w - 12;
    const wrapLine = (str, f) => {
      g.font = f;
      const out = [];
      let cur = "";
      for (const word of str.split(" ")) {
        const next = cur ? cur + " " + word : word;
        if (cur && g.measureText(next).width > tw) { out.push(cur); cur = word; }
        else cur = next;
      }
      if (cur) out.push(cur);
      return out.map((l) => [l, f]);
    };
    const fits = (ls) => ls.length * lh <= box.h - 2 && ls.every(([l, f]) => { g.font = f; return g.measureText(l).width <= tw; });
    const pick = [lines, lines.slice(0, 1)].map((ls) => ls.flatMap((l, i) => wrapLine(l, fonts[i ? 1 : 0]))).find(fits);
    if (!pick) return;
    g.fillStyle = capAccent();
    g.fillRect(box.x + 2, box.y + 2, 2, pick.length * lh - 4);
    pick.forEach(([l, f], k) => {
      const head = f === fonts[0];
      text(g, box.x + 10, box.y + lh * (k + 0.5), l, { color: head ? INK.ink : INK.ink3, size: head ? 11.5 : 11, weight: head ? 600 : 400, mono: false, halo: false });
    });
  };

  const wrap = ctx.stage.element("div", "band-math-expr");
  wrap.style.cssText = "position:absolute;inset:auto;left:0;top:0;width:300px;height:36px;z-index:5;display:none;pointer-events:none;";
  const input = document.createElement("input");
  input.type = "text"; input.spellcheck = false; input.autocomplete = "off"; input.maxLength = 160;
  input.setAttribute("aria-label", "Expression");
  input.placeholder = "Type an expression, then Enter";
  input.style.cssText = `pointer-events:auto;width:100%;height:36px;box-sizing:border-box;padding:0 10px;border-radius:8px;border:1px solid #cdc6b7;background:#faf8f3;color:${INK.ink};font:500 13px ${FONT_MONO};outline:none;`;
  wrap.append(input);
  const setBorder = (ok) => { input.style.borderColor = ok ? "#cdc6b7" : "#b42335"; };
  input.addEventListener("input", () => setBorder(parseExpr(input.value).ok), { signal: ctx.signal });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { input.value = params.expr; setBorder(true); input.blur(); return; }
    if (e.key !== "Enter") return;
    const p = parseExpr(input.value);
    if (!p.ok) { setBorder(false); ctx.snack(p.error + " Use band names, numbers, + − × / and brackets."); return; }
    setBorder(true);
    input.blur();
    if (input.value.trim() !== params.expr) ctx.controls.set("expr", input.value.trim());
  }, { signal: ctx.signal });
  input.addEventListener("blur", () => { if (!parseExpr(input.value).ok) { input.value = params.expr; setBorder(true); } }, { signal: ctx.signal });

  const PANES = { formula: "Formula", spectrum: "Spectrum", ramp: "Ramp" };
  const PANE_ALL = Object.keys(PANES);
  let pane = Object.hasOwn(PANES, ctx.url.get("pane") || "") ? ctx.url.get("pane") : "formula";
  const sw = ctx.stage.element("div", "segment band-math-switch");
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "Panel to show");
  sw.style.cssText = "inset:auto;display:none;box-sizing:border-box;height:34px;padding:2px;gap:2px;z-index:5;pointer-events:auto;";
  sw.addEventListener("pointerdown", (e) => e.stopPropagation(), { signal: ctx.signal });
  const swBtns = Object.fromEntries(PANE_ALL.map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.textContent = PANES[k];
    b.style.cssText = "flex:0 0 auto;height:28px;padding:0 10px;";
    b.addEventListener("click", () => {
      if (pane === k) return;
      pane = k;
      if (ctx.side === "A") ctx.url.set("pane", k === "formula" ? null : k);
      stage.request();
    }, { signal: ctx.signal });
    sw.append(b);
    return [k, b];
  }));
  let swKey = "", swEdge = 0;
  const syncSwitch = (g, box, list, cur) => {
    const key = box ? [box.x, box.y, cur, ...list].join("|") : "off";
    if (key === swKey) return swEdge;
    swKey = key;
    sw.style.display = box ? "flex" : "none";
    if (!box) return (swEdge = 0);
    g.font = `500 12.5px ${FONT_UI}`;
    let width = 6 + 2 * (list.length - 1);
    for (const k of PANE_ALL) {
      const b = swBtns[k], on = k === cur, shown = list.includes(k);
      b.style.display = shown ? "" : "none";
      if (shown) { const bw = Math.ceil(g.measureText(PANES[k]).width) + 22; b.style.width = `${bw}px`; width += bw; }
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    const left = box.x + 18;
    Object.assign(sw.style, { left: `${left}px`, top: `${box.y + 4}px`, width: `${width}px` });
    return (swEdge = left + width);
  };

  const drawTabs = (g, box, list, rows) => {
    const cur = list.includes(pane) ? pane : list[0];
    panel(g, box.x, box.y, box.w, box.h, { accent: cur === "spectrum" ? PIN_C : cur === "ramp" ? INK.signal : capAccent() });
    const edge = syncSwitch(g, box, list, cur);
    if (cur === "formula") drawFormula(g, box.x, box.y, box.w, fitRows(rows, box.h - TAB_H - 8), edge);
    else if (cur === "spectrum") drawSpectrum(g, box.x, box.y, box.w, box.h, edge);
    else drawLegend(g, box.x, box.y, box.w, edge, box.h);
  };

  const draw = (g, W, H) => {
    let rows = W < COMPACT_W ? formulaRows(g, W - 24, true) : null;
    L = layoutOf(W, H, rows ? Math.max(PANEL_C, TAB_H + rowsH(rows) + 8) : PANEL_C);
    background(g, W, H);
    drawThumbs(g);
    drawResult(g);
    const custom = params.index === "custom";
    if (L.compact) {
      wrap.style.display = "none";
      drawNote(g, L.note, caption());
      drawTabs(g, L.panel, PANE_ALL, rows);
      return;
    }
    const x = L.rx, w = L.rw;
    rows = formulaRows(g, w);
    const capLines = caption();
    let y = L.top;
    const cap = drawCaption(g, x, y, capLines, { accent: capAccent(), maxWidth: w - 28 });
    y += cap.h + 10;
    wrap.style.display = custom ? "block" : "none";
    if (custom) {
      wrap.style.left = `${x}px`; wrap.style.top = `${y}px`; wrap.style.width = `${w}px`;
      if (document.activeElement !== input && input.value !== params.expr) input.value = params.expr;
      y += 46;
    }
    const fh = formulaHeight(rows);
    if (y + fh + 10 + 150 + 10 + LEGEND_H <= L.bottom) {
      syncSwitch(g, null);
      y += drawFormula(g, x, y, w, rows) + 10;
      const spH = clamp(L.leftBottom - y - LEGEND_H - 10, 150, 300);
      drawSpectrum(g, x, y, w, spH);
      y += spH + 10;
      drawLegend(g, x, y, w);
      return;
    }
    if (y + fh + 10 + 170 <= L.bottom) {
      y += drawFormula(g, x, y, w, rows) + 10;
      drawTabs(g, { x, y, w, h: Math.min(L.bottom - y, Math.max(L.leftBottom - y, 170)) }, ["spectrum", "ramp"]);
      return;
    }
    drawTabs(g, { x, y, w, h: L.bottom - y }, PANE_ALL, rows);
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    const info = focus();
    if (!info) {
      ctx.readout.setMany({ blue: "–", green: "–", red: "–", nir: "–", swir1: "–", swir2: "–", result: "–", class: "–" });
      return;
    }
    const out = {};
    BANDS.forEach((b, i) => { out[b] = info.isNodata[i] ? "no data" : info.refl[i]; });
    out.result = info.reason === REASON.nodata ? "no data" : info.reason === REASON.divzero ? "÷ 0" : info.value;
    out.class = classByNdvi(info.ndvi);
    ctx.readout.setMany(out);
  };

  const setHoverShown = (vals) => {
    if (hoverTween) hoverTween.cancel();
    hoverTween = null;
    if (!hoverShown || ctx.reducedMotion) { hoverShown = vals.slice(); return; }
    const from = hoverShown.slice();
    hoverTween = ctx.anim.tween({ from: 0, to: 1, duration: 140, ease: ctx.anim.ease.out, onUpdate: (t) => { hoverShown = from.map((v, i) => lerp(v, vals[i], t)); stage.request(); }, onDone: () => { hoverShown = vals.slice(); hoverTween = null; stage.request(); } });
  };

  const startPinReveal = () => {
    if (pinTween) pinTween.cancel();
    pinTween = null;
    if (ctx.reducedMotion || !pin) { pinReveal = 1; return; }
    pinReveal = 0;
    pinTween = ctx.anim.tween({ from: 0, to: 1, duration: 520, ease: ctx.anim.ease.out, onUpdate: (v) => { pinReveal = v; stage.request(); }, onDone: () => { pinReveal = 1; pinTween = null; stage.request(); } });
  };

  const parsePx = (s) => {
    const p = String(s || "").split(",").map(Number);
    return p.length === 2 && p.every((v) => Number.isInteger(v)) ? [clamp(p[0], 0, SW - 1), clamp(p[1], 0, SH - 1)] : null;
  };
  const resolvePin = () => {
    if (params.point === "none") return null;
    if (params.point === "pixel") return parsePx(ctx.url.get("px")) || [64, 64];
    return PINS[params.point] ? PINS[params.point].slice() : null;
  };

  const pixelAt = (X, Y) => {
    if (!L) return null;
    const hit = (x, y, s) => X >= x && Y >= y && X < x + s && Y < y + s ? [clamp(Math.floor(((X - x) / s) * SW), 0, SW - 1), clamp(Math.floor(((Y - y) / s) * SH), 0, SH - 1)] : null;
    const r = hit(L.ix, L.iy, L.S);
    if (r) return r;
    for (const t of L.tiles) { const q = hit(t.x, t.y, t.s); if (q) return q; }
    return null;
  };

  stage.on("move", (X, Y) => {
    const p = pixelAt(X, Y);
    stage.setCursor(p ? "crosshair" : "default");
    if (!p) {
      if (hover) { hover = null; hoverShown = null; stage.hideChip(); readouts(); stage.request(); }
      return;
    }
    const changed = !hover || hover[0] !== p[0] || hover[1] !== p[1];
    hover = p;
    const info = pixelInfo(p[0], p[1]);
    if (changed) {
      if (info.isNodata.every(Boolean)) { if (hoverTween) hoverTween.cancel(); hoverShown = null; }
      else setHoverShown(info.refl);
      readouts();
    }
    stage.chip(X, Y, chipLines(info));
    stage.request();
  });
  stage.on("leave", () => { hover = null; hoverShown = null; readouts(); stage.request(); });
  stage.on("click", (X, Y) => {
    if (ctx.side !== "A") return;
    const p = pixelAt(X, Y);
    if (!p) return;
    const named = Object.entries(PINS).find(([, q]) => q[0] === p[0] && q[1] === p[1]);
    if (named) { ctx.url.set("px", null); ctx.controls.set("point", named[0]); }
    else { ctx.url.set("px", `${p[0]},${p[1]}`); ctx.controls.set("point", "pixel"); }
    ctx.done();
  });
  stage.on("escape", () => { if (ctx.side === "A" && params.point !== "none") ctx.controls.set("point", "none"); });

  rebuild(false);
  pin = resolvePin();
  stage.render();

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (first) {
        first = false;
        if (built !== `${params.index}|${params.expr}|${params.ramp}`) rebuild(false);
        pin = resolvePin();
        startPinReveal();
        readouts();
        stage.request();
        return;
      }
      const reb = keys.length === 0 || ["index", "expr", "ramp"].some((k) => keys.includes(k) && prev[k] !== params[k]);
      if (reb) rebuild(true);
      if (keys.includes("expr") && exprError && params.index === "custom") ctx.snack(exprError);
      if (keys.includes("point") || keys.length === 0) {
        const np = resolvePin();
        const moved = !np || !pin || np[0] !== pin[0] || np[1] !== pin[1];
        pin = np;
        if (params.point !== "pixel") ctx.url.set("px", null);
        if (moved) startPinReveal();
      }
      if (hover) setHoverShown(pixelInfo(hover[0], hover[1]).refl);
      readouts();
      stage.request();
    },
    resize() { stage.render(); },
    unmount() {
      for (const t of [fadeTween, pinTween, hoverTween]) if (t) t.cancel();
      ctx.url.set("px", null);
      ctx.url.set("pane", null);
      stage.dispose();
      wrap.remove();
      sw.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
