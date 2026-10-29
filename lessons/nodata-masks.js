import { stats } from "@/core/raster.js";
import { mixOklab, hexToRgb, divergingRGB, css } from "@/core/palette.js";
import { clamp } from "@/core/math.js";
import { pixelStage, background, text, panel, spans, fmtNum, drawCaption, decodeScene, INK, FONT_UI, FONT_MONO } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "nodata-masks",
  title: "Holes in the data",
  track: 6,
  order: 10,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "Some pixels hold no data. A nodata value marks them, or a mask band does. If you ignore the mark, the sentinel number poisons every statistic. Honour it and the mean is right. Masks also mark clouds and shadows. Hatched pixels here are outside the count.",
  deeper: [
    "Mean of 1, 2 and −9999 with nodata honoured = 1.5.",
    "NaN is nodata for float rasters.",
    "A quality band packs several flags into bits.",
    "Masks are data: store them with the image.",
  ],
  keywords: ["nodata", "mask", "NaN", "cloud mask", "quality band", "sentinel value"],
  controls: [
    { key: "band", type: "segment", label: "Band", options: [{ value: "nir", label: "NIR" }, { value: "red", label: "Red" }, { value: "ndvi", label: "NDVI" }], default: "nir" },
    { type: "group", label: "Nodata" },
    { key: "nodata", type: "number", label: "Nodata value", min: -99999, max: 99999, step: 1, default: -9999 },
    { key: "nan", type: "toggle", label: "Float file: holes are NaN", default: false, shortcut: "f" },
    { key: "honour", type: "toggle", label: "Honour the mask", default: true, shortcut: "h" },
    { type: "group", label: "Mask" },
    { key: "mNodata", type: "toggle", label: "Nodata", default: true, shortcut: "n" },
    { key: "mCloud", type: "toggle", label: "Cloud", default: false, shortcut: "c" },
    { key: "mShadow", type: "toggle", label: "Shadow", default: false, shortcut: "s" },
    { type: "group", label: "Region" },
    { key: "tool", type: "segment", label: "Drag on the image to", options: [{ value: "region", label: "Move the region" }, { value: "paint", label: "Paint a mask" }], default: "region" },
    { key: "region", type: "button", label: "Draw a region", icon: "i-plus" },
    { key: "clear", type: "button", label: "Clear the paint", icon: "i-refresh" },
    { type: "legend", label: "Key", items: [{ color: "#b42335", label: "Nodata (hatched)" }, { color: "#1d63a8", label: "Cloud (hatched)" }, { color: "#7046a6", label: "Shadow (hatched)" }, { color: "#b85217", label: "Your paint (hatched)" }, { color: "#b85217", line: true, label: "Region for the statistics" }] },
  ],
  readouts: [
    { key: "meanH", label: "Mean (honoured)", hero: true },
    { key: "meanI", label: "Mean (ignored)" },
    { key: "valid", label: "Valid pixels", digits: 0 },
    { key: "masked", label: "Masked pixels", digits: 0 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["scene_synthetic.json"],
};

const PREFIX = meta.id + ":";
export const QA = { nodata: 1, cloud: 2, shadow: 4, hand: 8 };
export const NIR_LOST_ROWS = [36, 37, 38];
export const DEFAULT_REGION = [2, 2, 72, 42];
export const BAND_MAX = { red: 2400, nir: 5600 };
const BAND_INDEX = { red: 2, nir: 3 };

export function isHole(v, nodata, nan) {
  return v !== v || (!nan && v === nodata);
}

export function storedBand(scene, name, { nodata = -9999, nan = false } = {}) {
  const src = scene.bands[BAND_INDEX[name]];
  const n = scene.width * scene.height;
  const out = new Float64Array(n);
  const fill = nan ? NaN : nodata;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / scene.width);
    const lost = scene.nodataMask[i] || (name === "nir" && NIR_LOST_ROWS.includes(row));
    out[i] = lost ? fill : src[i];
  }
  return out;
}

export function ndviBand(red, nir, { nodata = -9999, nan = false, propagate = true } = {}) {
  const out = new Float64Array(red.length);
  const fill = nan ? NaN : nodata;
  for (let i = 0; i < red.length; i++) {
    const r = red[i], n = nir[i];
    out[i] = propagate && (isHole(r, nodata, nan) || isHole(n, nodata, nan)) ? fill : (n - r) / (n + r);
  }
  return out;
}

export function qaBand(scene, hand) {
  const n = scene.width * scene.height;
  const qa = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    qa[i] = (scene.nodataMask[i] ? QA.nodata : 0) | (scene.cloud[i] ? QA.cloud : 0) | (scene.shadow[i] ? QA.shadow : 0) | (hand && hand[i] ? QA.hand : 0);
  }
  return qa;
}

export function selectedBits(params) {
  return (params.mNodata ? QA.nodata : 0) | (params.mCloud ? QA.cloud : 0) | (params.mShadow ? QA.shadow : 0) | QA.hand;
}

export function buildLayer(scene, params, hand = null) {
  const nodata = Number(params.nodata), nan = !!params.nan;
  let values, raw;
  if (params.band === "ndvi") {
    const red = storedBand(scene, "red", { nodata, nan }), nir = storedBand(scene, "nir", { nodata, nan });
    values = ndviBand(red, nir, { nodata, nan, propagate: !!params.mNodata });
    raw = ndviBand(red, nir, { nodata, nan, propagate: false });
  } else {
    values = storedBand(scene, params.band, { nodata, nan });
    raw = values;
  }
  const qa = qaBand(scene, hand);
  const bits = selectedBits(params);
  const n = values.length;
  const mask = new Uint8Array(n), skip = new Uint8Array(n), hole = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    hole[i] = v !== v || (params.mNodata && !nan && v === nodata) ? 1 : 0;
    mask[i] = qa[i] & bits ? 1 : 0;
    skip[i] = mask[i] || hole[i] ? 1 : 0;
  }
  return { width: scene.width, height: scene.height, band: params.band, nodata, nan, mNodata: !!params.mNodata, values, raw, qa, bits, mask, hole, skip };
}

export function normRect(rect, width, height) {
  const [a, b, c, d] = rect;
  const c0 = clamp(Math.min(a, c), 0, width - 1), c1 = clamp(Math.max(a, c), c0 + 1, width);
  const r0 = clamp(Math.min(b, d), 0, height - 1), r1 = clamp(Math.max(b, d), r0 + 1, height);
  return [c0, r0, c1, r1];
}

export function regionIndices(rect, width) {
  const [c0, r0, c1, r1] = rect;
  const out = new Int32Array((c1 - c0) * (r1 - r0));
  let k = 0;
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) out[k++] = r * width + c;
  return out;
}

export function regionStats(layer, rect) {
  const idx = regionIndices(rect, layer.width);
  const vals = new Float64Array(idx.length), raw = new Float64Array(idx.length), mask = new Uint8Array(idx.length);
  idx.forEach((i, k) => { vals[k] = layer.values[i]; raw[k] = layer.raw[i]; mask[k] = layer.mask[i]; });
  const h = stats(vals, { nodata: layer.mNodata && !layer.nan ? layer.nodata : undefined, mask, honour: true });
  const ig = stats(raw, { honour: false });
  const poisoned = raw.some((v) => v !== v);
  return { count: idx.length, valid: h.valid, masked: h.masked, meanH: h.mean, meanI: ig.meanIgnored, minH: h.min, maxH: h.max, minI: poisoned ? NaN : ig.min, maxI: poisoned ? NaN : ig.max, idx };
}

const GREY = [hexToRgb("#04060b"), hexToRgb("#222b3e"), hexToRgb("#6b665e"), hexToRgb("#1a1917")];
const greyRamp = (t) => {
  const f = clamp(t, 0, 1) * (GREY.length - 1), i = Math.min(GREY.length - 2, Math.floor(f));
  return mixOklab(GREY[i], GREY[i + 1], f - i);
};
const GREY_LUT = Array.from({ length: 256 }, (_, i) => greyRamp(i / 255));
const NDVI_LUT = Array.from({ length: 256 }, (_, i) => divergingRGB(i / 127.5 - 1));
const CHECK = [[236, 232, 224], [224, 219, 208]];
const IMPOSSIBLE = hexToRgb("#8a2a36");

export function pixelColour(layer, i) {
  const v = layer.values[i];
  if (layer.hole[i]) return CHECK[((i % layer.width) + Math.floor(i / layer.width)) & 1];
  if (layer.band === "ndvi") {
    if (v < -1 || v > 1) return IMPOSSIBLE;
    return NDVI_LUT[clamp(Math.round((v + 1) * 127.5), 0, 255)];
  }
  if (v < 0 || v > 10000) return IMPOSSIBLE;
  return GREY_LUT[clamp(Math.round(Math.pow(v / BAND_MAX[layer.band], 0.8) * 255), 0, 255)];
}

export function pixelsFor(scene, params, hand = null) {
  const layer = buildLayer(scene, params, hand);
  const n = layer.values.length;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = pixelColour(layer, i);
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  return { rgba, layer };
}

export function bitString(q) {
  return "0b" + q.toString(2).padStart(4, "0");
}

export function bitNames(q) {
  return ["nodata", "cloud", "shadow", "paint"].filter((_, k) => q & (1 << k));
}

const HATCH = {
  nodata: { color: "rgba(180,35,53,.95)", kind: "fwd" },
  cloud: { color: "rgba(29,99,168,.95)", kind: "back" },
  shadow: { color: "rgba(112,70,166,.95)", kind: "flat" },
  hand: { color: "rgba(184,82,23,.95)", kind: "cross" },
};

const fmtMean = (v, band) => (v !== v ? "NaN" : fmtNum(v, band === "ndvi" ? 3 : 1));
const fmtVal = (v, band) => (v !== v ? "NaN" : band === "ndvi" ? fmtNum(v, 3) : fmtNum(v, Number.isInteger(v) ? 0 : 1));

export async function mount(ctx) {
  let params = { ...ctx.params };
  let scene = null;
  try { scene = decodeScene(ctx.data.get("scene_synthetic.json")); } catch (e) { scene = null; }
  const W0 = scene ? scene.width : 128, H0 = scene ? scene.height : 128;
  const hand = new Uint8Array(W0 * H0);
  const parseRect = (s) => {
    if (!s) return null;
    const p = String(s).split(",").map(Number);
    return p.length === 4 && p.every(Number.isInteger) ? normRect(p, W0, H0) : null;
  };
  let rect = parseRect(ctx.url.get("reg")) || DEFAULT_REGION.slice();
  let layer = null, rs = null, rgba = null;
  let img = null;
  let L = null;
  let hover = null;
  let pointer = null;
  let armed = false;
  let dragging = null;
  let first = true;
  let heroShown = NaN, heroTween = null;
  const fade = { nodata: params.mNodata ? 1 : 0, cloud: params.mCloud ? 1 : 0, shadow: params.mShadow ? 1 : 0, hand: 1 };
  const fadeTweens = {};
  let hatchPaths = null, hatchKey = "";
  let patterns = null, patternDpr = 0;

  const layoutOf = (W, H) => {
    const pad = 16;
    const bottom = H - ctx.stage.insetBottom - pad;
    const panelW = clamp(Math.round(W * 0.31), 236, 300);
    const availW = Math.max(120, W - pad * 3 - panelW), availH = Math.max(120, bottom - pad);
    const dpr = ctx.stage.dpr || 1;
    let s = Math.min(availW / W0, availH / H0);
    if (s * dpr >= 3) s = Math.floor(s * dpr) / dpr;
    const size = W0 * s, sizeY = H0 * s;
    const snapPx = (v) => Math.round(v * dpr) / dpr;
    const ix = snapPx(pad + (availW - size) / 2), iy = snapPx(pad + (availH - sizeY) / 2);
    return { W, H, pad, bottom, panelW, px: W - pad - panelW, s, ix, iy, size, sizeY, dpr };
  };

  const toPixel = (X, Y) => [Math.floor((X - L.ix) / L.s), Math.floor((Y - L.iy) / L.s)];
  const inImage = (c, r) => c >= 0 && r >= 0 && c < W0 && r < H0;

  const recompute = () => {
    if (!scene) return;
    const out = pixelsFor(scene, params, hand);
    layer = out.layer;
    rgba = out.rgba;
    rs = regionStats(layer, rect);
    if (!img) { img = document.createElement("canvas"); img.width = W0; img.height = H0; }
    img.getContext("2d").putImageData(new ImageData(rgba, W0, H0), 0, 0);
    hatchPaths = null;
  };

  const heroTarget = () => (rs ? (params.honour ? rs.meanH : rs.meanI) : NaN);
  const retargetHero = (instant) => {
    const to = heroTarget();
    if (heroTween) { heroTween.cancel(); heroTween = null; }
    if (instant || ctx.reducedMotion || !Number.isFinite(to) || !Number.isFinite(heroShown) || heroShown === to) { heroShown = to; return; }
    heroTween = ctx.anim.tween({ from: heroShown, to, duration: 620, ease: ctx.anim.ease.out, onUpdate: (v) => { heroShown = v; stage.request(); }, onDone: () => { heroTween = null; heroShown = to; stage.request(); } });
  };

  const fadeFlag = (name, on) => {
    if (fadeTweens[name]) fadeTweens[name].cancel();
    const to = on ? 1 : 0;
    if (ctx.reducedMotion) { fade[name] = to; return; }
    fadeTweens[name] = ctx.anim.tween({ from: fade[name], to, duration: on ? 420 : 260, ease: ctx.anim.ease.out, onUpdate: (v) => { fade[name] = v; stage.request(); }, onDone: () => { fadeTweens[name] = null; stage.request(); } });
  };

  const makePatterns = (g, dpr) => {
    const T = Math.max(6, Math.round(7 * dpr));
    const out = {};
    for (const [name, h] of Object.entries(HATCH)) {
      const c = document.createElement("canvas");
      c.width = T; c.height = T;
      const cg = c.getContext("2d");
      cg.lineCap = "square";
      cg.beginPath();
      const fwd = () => { for (const o of [-T, 0, T]) { cg.moveTo(o, T); cg.lineTo(o + T, 0); } };
      const back = () => { for (const o of [-T, 0, T]) { cg.moveTo(o, 0); cg.lineTo(o + T, T); } };
      if (h.kind === "fwd") fwd();
      else if (h.kind === "back") back();
      else if (h.kind === "flat") { cg.moveTo(0, T / 2); cg.lineTo(T, T / 2); }
      else { fwd(); back(); }
      cg.strokeStyle = "rgba(250,248,243,.7)";
      cg.lineWidth = Math.max(2.4, dpr * 2.6);
      cg.stroke();
      cg.strokeStyle = h.color;
      cg.lineWidth = Math.max(1, dpr * 1.1);
      cg.stroke();
      const p = g.createPattern(c, "repeat");
      if (p.setTransform) p.setTransform(new DOMMatrix().scale(1 / dpr));
      out[name] = p;
    }
    return out;
  };

  const flagOf = {
    nodata: (i) => isHole(layer.values[i], layer.nodata, layer.nan) || layer.qa[i] & QA.nodata,
    cloud: (i) => layer.qa[i] & QA.cloud,
    shadow: (i) => layer.qa[i] & QA.shadow,
    hand: (i) => layer.qa[i] & QA.hand,
  };
  const flagAlpha = (name) => (name === "nodata" && layer.nan ? 1 : fade[name]);
  const flagShown = {
    nodata: () => params.mNodata || params.nan || fade.nodata > 0,
    cloud: () => params.mCloud || fade.cloud > 0,
    shadow: () => params.mShadow || fade.shadow > 0,
    hand: () => true,
  };

  const buildHatch = () => {
    const key = [L.ix, L.iy, L.s].join(",");
    if (hatchPaths && hatchKey === key) return hatchPaths;
    hatchKey = key;
    const paths = {};
    for (const name of Object.keys(HATCH)) {
      const test = flagOf[name];
      const p = new Path2D();
      let any = false;
      for (let r = 0; r < H0; r++) {
        let c = 0;
        while (c < W0) {
          if (!test(r * W0 + c)) { c++; continue; }
          const c0 = c;
          while (c < W0 && test(r * W0 + c)) c++;
          p.rect(L.ix + c0 * L.s, L.iy + r * L.s, (c - c0) * L.s, L.s);
          any = true;
        }
      }
      paths[name] = any ? p : null;
    }
    hatchPaths = paths;
    return paths;
  };

  const drawImage = (g) => {
    g.save();
    g.fillStyle = "rgba(0,0,0,.35)";
    g.fillRect(L.ix - 1, L.iy - 1, L.size + 2, L.sizeY + 2);
    g.imageSmoothingEnabled = false;
    g.drawImage(img, L.ix, L.iy, L.size, L.sizeY);
    if (!patterns || patternDpr !== L.dpr) { patterns = makePatterns(g, L.dpr); patternDpr = L.dpr; }
    const paths = buildHatch();
    for (const name of ["shadow", "cloud", "nodata", "hand"]) {
      if (!paths[name] || !flagShown[name]()) continue;
      g.globalAlpha = flagAlpha(name);
      g.fillStyle = patterns[name];
      g.fill(paths[name]);
    }
    g.globalAlpha = 1;
    g.strokeStyle = "rgba(60,52,40,.35)";
    g.lineWidth = 1;
    g.strokeRect(L.ix - 0.5, L.iy - 0.5, L.size + 1, L.sizeY + 1);
    g.restore();
  };

  const drawRegion = (g) => {
    const [c0, r0, c1, r1] = rect;
    const X0 = L.ix + c0 * L.s, Y0 = L.iy + r0 * L.s, X1 = L.ix + c1 * L.s, Y1 = L.iy + r1 * L.s;
    g.save();
    g.beginPath();
    g.rect(L.ix, L.iy, L.size, L.sizeY);
    g.rect(X0, Y0, X1 - X0, Y1 - Y0);
    g.fillStyle = "rgba(250,248,243,.5)";
    g.fill("evenodd");
    g.lineJoin = "miter";
    g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 4;
    g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    g.strokeStyle = INK.brass; g.lineWidth = 2;
    g.strokeRect(X0, Y0, X1 - X0, Y1 - Y0);
    if (params.tool === "region" && !armed) {
      for (const [X, Y] of [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]]) {
        g.fillStyle = "#faf8f3"; g.fillRect(X - 4.5, Y - 4.5, 9, 9);
        g.strokeStyle = INK.brass; g.lineWidth = 1.5; g.strokeRect(X - 4.5, Y - 4.5, 9, 9);
      }
    }
    const label = `${c1 - c0} × ${r1 - r0} = ${fmtNum((c1 - c0) * (r1 - r0))} px`;
    g.font = `600 11px ${FONT_MONO}`;
    const tw = g.measureText(label).width + 14;
    const lx = clamp(X0, L.ix, L.ix + L.size - tw), ly = Y0 - 22 >= L.iy - 24 && Y0 - 22 > 4 ? Y0 - 22 : Y1 + 4;
    g.fillStyle = "rgba(250,248,243,.92)";
    g.beginPath(); g.roundRect(lx, ly, tw, 18, 5); g.fill();
    g.fillStyle = INK.brass; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText(label, lx + 7, ly + 9.5);
    g.restore();
  };

  const drawPointer = (g) => {
    if (!pointer || !hover) return;
    if (params.tool === "paint" && !armed) {
      g.save();
      g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 3;
      g.beginPath(); g.arc(L.ix + (hover[0] + 0.5) * L.s, L.iy + (hover[1] + 0.5) * L.s, 2.5 * L.s, 0, 2 * Math.PI); g.stroke();
      g.strokeStyle = INK.brass; g.lineWidth = 1.5; g.stroke();
      g.restore();
      return;
    }
    const X = L.ix + hover[0] * L.s, Y = L.iy + hover[1] * L.s;
    g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 3;
    g.strokeRect(X - 1, Y - 1, L.s + 2, L.s + 2);
    g.strokeStyle = "#ffffff"; g.lineWidth = 1.5;
    g.strokeRect(X - 1, Y - 1, L.s + 2, L.s + 2);
  };

  const sectionTitle = (g, x, y, str) => {
    g.font = `600 10px ${FONT_UI}`;
    g.fillStyle = INK.ink3; g.textAlign = "left"; g.textBaseline = "middle";
    if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
    g.fillText(str.toUpperCase(), x, y);
    if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
  };

  const drawHistogram = (g, x, y, w, h) => {
    const idx = rs.idx;
    let lo = Infinity, hi = -Infinity, nanCount = 0, nanSkipped = 0;
    for (const i of idx) { const v = layer.raw[i]; if (v !== v) { nanCount++; if (layer.skip[i] || layer.values[i] !== layer.values[i]) nanSkipped++; continue; } if (v < lo) lo = v; if (v > hi) hi = v; }
    const nanW = nanCount ? 34 : 0;
    const hw = w - nanW;
    g.strokeStyle = "rgba(60,52,40,.3)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y + h + 0.5); g.lineTo(x + hw, y + h + 0.5); g.stroke();
    if (!(hi >= lo)) { lo = 0; hi = 1; }
    if (hi === lo) { lo -= 1; hi += 1; }
    const B = 40;
    const kept = new Float64Array(B), cut = new Float64Array(B);
    for (const i of idx) {
      const v = layer.raw[i];
      if (v !== v) continue;
      const b = Math.min(B - 1, Math.floor(((v - lo) / (hi - lo)) * B));
      if (layer.skip[i] || layer.values[i] !== layer.values[i]) cut[b]++; else kept[b]++;
    }
    let top = 1;
    for (let b = 0; b < B; b++) top = Math.max(top, kept[b] + cut[b]);
    top = Math.max(top, nanCount);
    const sh = (n) => (Math.sqrt(n) / Math.sqrt(top)) * h;
    const bw = hw / B;
    for (let b = 0; b < B; b++) {
      const hk = sh(kept[b] + cut[b]), hc = kept[b] + cut[b] ? hk * (cut[b] / (kept[b] + cut[b])) : 0;
      if (hk <= 0) continue;
      g.fillStyle = "rgba(29,99,168,.75)";
      g.fillRect(x + b * bw + 0.5, y + h - hk, Math.max(1, bw - 1), hk - hc);
      if (hc > 0) {
        g.fillStyle = "rgba(180,35,53,.85)";
        g.fillRect(x + b * bw + 0.5, y + h - hc, Math.max(1, bw - 1), hc);
      }
    }
    if (nanCount) {
      const hn = sh(nanCount);
      g.fillStyle = nanSkipped ? "rgba(180,35,53,.85)" : "rgba(29,99,168,.75)";
      g.fillRect(x + hw + 10, y + h - hn, nanW - 12, hn);
      text(g, x + hw + 10 + (nanW - 12) / 2, y + h + 9, "NaN", { size: 9.5, color: INK.ink3, align: "center", halo: false });
    }
    const band = layer.band;
    text(g, x, y + h + 9, fmtVal(lo, band), { size: 9.5, color: INK.ink3, halo: false });
    text(g, x + hw, y + h + 9, fmtVal(hi, band), { size: 9.5, color: INK.ink3, align: "right", halo: false });
    const marks = [];
    if (Number.isFinite(rs.meanH)) marks.push({ v: rs.meanH, color: INK.ok, label: "honoured" });
    if (Number.isFinite(rs.meanI)) marks.push({ v: rs.meanI, color: INK.err, label: "ignored" });
    for (const m of marks) m.X = Math.round(x + clamp((m.v - lo) / (hi - lo), 0, 1) * hw) + 0.5;
    const near = marks.length === 2 && Math.abs(marks[0].X - marks[1].X) < 110;
    const leftmost = marks.length === 2 ? (marks[0].X <= marks[1].X ? marks[0] : marks[1]) : null;
    for (const m of marks) {
      g.strokeStyle = m.color; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(m.X, y - 4); g.lineTo(m.X, y + h); g.stroke();
      const toLeft = near ? m === leftmost : m.X > x + hw - 64;
      text(g, toLeft ? m.X - 4 : m.X + 4, y - 7, m.label, { size: 9.5, color: m.color, align: toLeft ? "right" : "left", weight: 600 });
    }
  };

  const drawMeanPanel = (g, x, y, w) => {
    const h = 232;
    panel(g, x, y, w, h, { accent: params.honour ? INK.ok : INK.err });
    const ix = x + 22, iw = w - 36;
    sectionTitle(g, ix, y + 17, "Mean in the region");
    const band = layer.band;
    const shown = Number.isFinite(heroShown) ? heroShown : heroTarget();
    g.font = `600 28px ${FONT_MONO}`;
    g.fillStyle = params.honour ? INK.ok : INK.err;
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillText(fmtMean(shown, band), ix, y + 56, iw);
    text(g, ix + iw, y + 17, params.honour ? "mask honoured" : "mask ignored", { size: 10.5, color: params.honour ? INK.ok : INK.err, align: "right", halo: false, mono: false, weight: 600 });
    const fs = iw < 240 ? 10.5 : 11.5;
    const row = (yy, parts) => spans(g, ix, yy, parts, { size: fs });
    row(y + 78, [["honoured ", INK.ink3], [fmtMean(rs.meanH, band).padStart(8), params.honour ? INK.ok : INK.ink2, 600], ["  min ", INK.ink3], [fmtVal(rs.minH, band), INK.ink2]]);
    row(y + 96, [["ignored  ", INK.ink3], [fmtMean(rs.meanI, band).padStart(8), params.honour ? INK.ink2 : INK.err, 600], ["  min ", INK.ink3], [fmtVal(rs.minI, band), rs.minI < rs.minH - 1e-9 ? INK.err : INK.ink2]]);
    drawHistogram(g, ix, y + 120, iw, 54);
    row(y + 202, [["valid ", INK.ink3], [fmtNum(rs.valid), INK.signal, 600], [" + masked ", INK.ink3], [fmtNum(rs.masked), INK.err, 600]]);
    row(y + 219, [["= ", INK.ink3], [fmtNum(rs.count), INK.ink, 600], [" px in the region", INK.ink3]]);
    return h;
  };

  const drawLoupe = (g, x, y, w) => {
    const h = 148;
    panel(g, x, y, w, h, { accent: INK.signal });
    const ix = x + 22;
    sectionTitle(g, ix, y + 17, "Under the pointer");
    if (!hover || !inImage(hover[0], hover[1])) {
      text(g, ix, y + 44, "Point at a pixel to see its", { size: 12, color: INK.ink2, mono: false, halo: false });
      text(g, ix, y + 62, "value and its mask bits.", { size: 12, color: INK.ink2, mono: false, halo: false });
      return h;
    }
    const [hc, hr] = hover;
    const N = 9, cs = 11, lx = ix, ly = y + 32;
    g.save();
    g.beginPath(); g.rect(lx, ly, N * cs, N * cs); g.clip();
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const c = hc + k - 4, r = hr + j - 4;
      if (!inImage(c, r)) { g.fillStyle = "#f1ede4"; g.fillRect(lx + k * cs, ly + j * cs, cs, cs); continue; }
      const i = r * W0 + c;
      g.fillStyle = `rgb(${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]})`;
      g.fillRect(lx + k * cs, ly + j * cs, cs, cs);
      for (const name of ["shadow", "cloud", "nodata", "hand"]) {
        if (!flagShown[name]() || !flagOf[name](i)) continue;
        g.globalAlpha = flagAlpha(name);
        g.fillStyle = patterns[name];
        g.fillRect(lx + k * cs, ly + j * cs, cs, cs);
        g.globalAlpha = 1;
      }
    }
    g.restore();
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1;
    g.strokeRect(lx - 0.5, ly - 0.5, N * cs + 1, N * cs + 1);
    g.strokeStyle = "#ffffff"; g.lineWidth = 1.5;
    g.strokeRect(lx + 4 * cs - 0.5, ly + 4 * cs - 0.5, cs + 1, cs + 1);
    const i = hr * W0 + hc;
    const tx = lx + N * cs + 14;
    const band = layer.band;
    const q = layer.qa[i];
    spans(g, tx, ly + 6, [["col ", INK.ink3], [String(hc), INK.ink], [" row ", INK.ink3], [String(hr), INK.ink]], { size: 11 });
    spans(g, tx, ly + 24, [[band === "ndvi" ? "NDVI " : band === "nir" ? "NIR " : "red ", INK.ink3], [fmtVal(layer.values[i], band), layer.hole[i] || (band === "ndvi" && Math.abs(layer.values[i]) > 1) ? INK.err : INK.ink, 600]], { size: 11 });
    if (band === "ndvi" && layer.raw[i] !== layer.values[i] && !(layer.raw[i] !== layer.raw[i] && layer.values[i] !== layer.values[i])) {
      spans(g, tx, ly + 41, [["naive ", INK.ink3], [fmtVal(layer.raw[i], band), INK.err, 600]], { size: 11 });
    }
    spans(g, tx, ly + 58, [["QA ", INK.ink3], [`${bitString(q)} = ${q}`, INK.ink, 600]], { size: 11 });
    const names = [["N", "nodata", QA.nodata], ["C", "cloud", QA.cloud], ["S", "shadow", QA.shadow], ["P", "hand", QA.hand]];
    names.forEach(([letter, name, bit], k) => {
      const bx = tx + k * 24, by = ly + 70;
      const on = q & bit;
      const col = HATCH[name].color;
      g.fillStyle = on ? col : "rgba(60,52,40,.06)";
      g.beginPath(); g.roundRect(bx, by, 20, 18, 4); g.fill();
      g.strokeStyle = on ? col : "rgba(60,52,40,.25)"; g.lineWidth = 1; g.stroke();
      text(g, bx + 10, by + 9.5, letter, { size: 10.5, weight: 700, color: on ? "#faf8f3" : INK.ink4, align: "center", halo: false });
    });
    const out = params.honour && layer.skip[i];
    const why = !params.honour ? "counted: honour is off" : out ? "outside the count" : "counted";
    text(g, tx, ly + 102, why, { size: 11, color: out ? INK.err : INK.ok, mono: false, halo: false, weight: 600 });
    return h;
  };

  const drawRamp = (g, x, y, w) => {
    const h = 58;
    panel(g, x, y, w, h, { accent: INK.ink3 });
    const ix = x + 22, iw = w - 36;
    const band = params.band;
    sectionTitle(g, ix, y + 15, band === "ndvi" ? "NDVI, −1 to 1" : `${band === "nir" ? "NIR" : "Red"} reflectance × 10,000`);
    for (let k = 0; k < iw; k++) {
      const t = k / (iw - 1);
      const c = band === "ndvi" ? NDVI_LUT[Math.round(t * 255)] : GREY_LUT[Math.round(t * 255)];
      g.fillStyle = css(c);
      g.fillRect(ix + k, y + 26, 1, 10);
    }
    const lo = band === "ndvi" ? "−1" : "0", hi = band === "ndvi" ? "1" : fmtNum(BAND_MAX[band]) + "+";
    text(g, ix, y + 46, lo, { size: 9.5, color: INK.ink3, halo: false });
    text(g, ix + iw, y + 46, hi, { size: 9.5, color: INK.ink3, align: "right", halo: false });
    text(g, ix + iw / 2, y + 46, band === "ndvi" ? "0" : "", { size: 9.5, color: INK.ink3, align: "center", halo: false });
    return h;
  };

  const caption = () => {
    if (armed) return ["Draw a region.", "Drag across the image.", "Press Esc to stop."];
    if (params.tool === "paint") return ["Paint your own mask.", "Drag to paint. Shift-drag to erase.", "Painted pixels leave the count."];
    if (!params.honour) {
      if (params.nan) return ["NaN poisons the sum.", "One NaN makes the mean NaN."];
      return ["The mask is ignored.", "The sentinel enters the mean.", "Turn on Honour the mask."];
    }
    if (!params.mNodata) {
      if (params.nan) return ["NaN marks itself.", "The stats skip NaN. Band maths", "carries NaN through."];
      if (params.band === "ndvi") return ["The nodata mask is off.", "NDVI of two sentinels is 0.", "It looks like real data."];
      return ["The nodata mask is off.", "The sentinel enters the mean."];
    }
    if (params.band === "ndvi") return ["A hole in red or NIR", "is a hole in NDVI.", "The mask passes through."];
    return ["Hatched pixels are outside the count.", "Drag the region or its corners.", "Point at a pixel for its bits."];
  };

  const draw = (g, W, H) => {
    L = layoutOf(W, H);
    background(g, W, H);
    if (!scene || !layer) {
      text(g, W / 2, H / 2, "The scene did not load.", { color: INK.ink2, align: "center", mono: false });
      return;
    }
    drawImage(g);
    drawRegion(g);
    drawPointer(g);
    let y = L.pad;
    const cap = drawCaption(g, L.px, y, caption(), { accent: params.honour ? INK.ok : INK.err, maxWidth: L.panelW - 28 });
    y += cap.h + 10;
    y += drawMeanPanel(g, L.px, y, L.panelW) + 10;
    if (y + 148 <= L.bottom) y += drawLoupe(g, L.px, y, L.panelW) + 10;
    if (y + 58 <= L.bottom) drawRamp(g, L.px, y, L.panelW);
  };

  const stage = pixelStage(ctx, { draw });

  const readouts = () => {
    if (!rs) return;
    const band = params.band;
    ctx.readout.setMany({ meanH: fmtMean(rs.meanH, band), meanI: fmtMean(rs.meanI, band), valid: rs.valid, masked: rs.masked });
  };

  const refresh = (instant) => {
    recompute();
    retargetHero(instant);
    readouts();
    stage.request();
  };

  const writeUrl = () => {
    const same = rect.every((v, k) => v === DEFAULT_REGION[k]);
    ctx.url.set("reg", same ? null : rect.join(","));
  };

  const paintAt = (c, r, erase) => {
    let changed = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const cc = c + dx, rr = r + dy;
      if (!inImage(cc, rr)) continue;
      const i = rr * W0 + cc;
      const v = erase ? 0 : 1;
      if (hand[i] !== v) { hand[i] = v; changed = true; }
    }
    return changed;
  };
  const paintLine = (a, b, erase) => {
    const n = Math.max(1, Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])));
    let changed = false;
    for (let k = 0; k <= n; k++) changed = paintAt(Math.round(a[0] + ((b[0] - a[0]) * k) / n), Math.round(a[1] + ((b[1] - a[1]) * k) / n), erase) || changed;
    return changed;
  };

  const cornerAt = (X, Y) => {
    const [c0, r0, c1, r1] = rect;
    const pts = [[c0, r0, "nw"], [c1, r0, "ne"], [c0, r1, "sw"], [c1, r1, "se"]];
    for (const [c, r, k] of pts) if (Math.hypot(L.ix + c * L.s - X, L.iy + r * L.s - Y) < 10) return k;
    return null;
  };
  const insideRect = (c, r) => c >= rect[0] && c < rect[2] && r >= rect[1] && r < rect[3];
  const clampPix = (X, Y) => [clamp(Math.round((X - L.ix) / L.s), 0, W0), clamp(Math.round((Y - L.iy) / L.s), 0, H0)];

  stage.on("move", (X, Y) => {
    if (!L) return;
    pointer = [X, Y];
    const [c, r] = toPixel(X, Y);
    hover = inImage(c, r) ? [c, r] : null;
    if (params.tool === "paint" && !armed) stage.setCursor(hover ? "none" : "default");
    else if (armed) stage.setCursor("crosshair");
    else {
      const k = cornerAt(X, Y);
      stage.setCursor(k ? (k === "nw" || k === "se" ? "nwse-resize" : "nesw-resize") : hover && insideRect(c, r) ? "move" : hover ? "crosshair" : "default");
    }
    stage.request();
  });
  stage.on("leave", () => { hover = null; pointer = null; stage.request(); });

  stage.on("down", (X, Y, e) => {
    if (!L || !scene) return null;
    const [c, r] = toPixel(X, Y);
    if (params.tool === "paint" && !armed) {
      if (!inImage(c, r)) return null;
      const claim = { kind: "paint", erase: e.shiftKey, last: [c, r] };
      if (paintAt(c, r, claim.erase)) refresh(true);
      dragging = claim;
      return claim;
    }
    const k = armed ? null : cornerAt(X, Y);
    if (k) { dragging = { kind: "corner", k }; return dragging; }
    if (!armed && inImage(c, r) && insideRect(c, r)) { dragging = { kind: "move", c, r, rect0: rect.slice() }; return dragging; }
    if (!inImage(c, r)) return null;
    dragging = { kind: "new", start: clampPix(X, Y), prev: rect.slice() };
    return dragging;
  });
  stage.on("drag", (claim, X, Y, dx, dy, e) => {
    if (claim.kind === "paint") {
      const [c, r] = toPixel(X, Y);
      hover = inImage(c, r) ? [c, r] : null;
      const cc = clamp(c, 0, W0 - 1), rr = clamp(r, 0, H0 - 1);
      const changed = paintLine(claim.last, [cc, rr], claim.erase || e.shiftKey);
      claim.last = [cc, rr];
      if (changed) refresh(true); else stage.request();
      return;
    }
    if (claim.kind === "new") {
      const p = clampPix(X, Y);
      if (p[0] === claim.start[0] || p[1] === claim.start[1]) return;
      rect = normRect([claim.start[0], claim.start[1], p[0], p[1]], W0, H0);
    } else if (claim.kind === "move") {
      const [c, r] = toPixel(X, Y);
      const w = claim.rect0[2] - claim.rect0[0], h = claim.rect0[3] - claim.rect0[1];
      const c0 = clamp(claim.rect0[0] + c - claim.c, 0, W0 - w), r0 = clamp(claim.rect0[1] + r - claim.r, 0, H0 - h);
      rect = [c0, r0, c0 + w, r0 + h];
    } else if (claim.kind === "corner") {
      const p = clampPix(X, Y);
      const [c0, r0, c1, r1] = rect;
      const fixed = { nw: [c1, r1], ne: [c0, r1], sw: [c1, r0], se: [c0, r0] }[claim.k];
      if (p[0] === fixed[0] || p[1] === fixed[1]) return;
      rect = normRect([fixed[0], fixed[1], p[0], p[1]], W0, H0);
      const nk = (p[1] < fixed[1] ? "n" : "s") + (p[0] < fixed[0] ? "w" : "e");
      claim.k = nk;
    }
    const [c, r] = toPixel(X, Y);
    hover = inImage(c, r) ? [c, r] : null;
    refresh(true);
  });
  stage.on("dragEnd", (claim, X, Y, moved) => {
    dragging = null;
    if (claim.kind === "paint") return;
    if (claim.kind === "new" && !moved) { rect = claim.prev; refresh(true); return; }
    if (armed) armed = false;
    writeUrl();
    refresh(false);
  });
  stage.on("escape", () => {
    if (!armed) return;
    armed = false;
    stage.request();
  });

  recompute();
  heroShown = heroTarget();

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (first) {
        first = false;
        ctx.controls.disable("nodata", !!params.nan);
        refresh(true);
        return;
      }
      if (keys.includes("region")) {
        armed = true;
        if (params.tool !== "region") ctx.controls.set("tool", "region");
      }
      if (keys.includes("clear")) hand.fill(0);
      if (keys.includes("tool") && params.tool === "paint") armed = false;
      if (keys.includes("nan")) ctx.controls.disable("nodata", !!params.nan);
      if (prev.mNodata !== params.mNodata) fadeFlag("nodata", params.mNodata);
      if (prev.mCloud !== params.mCloud) fadeFlag("cloud", params.mCloud);
      if (prev.mShadow !== params.mShadow) fadeFlag("shadow", params.mShadow);
      if (!keys.length) {
        fade.nodata = params.mNodata ? 1 : 0; fade.cloud = params.mCloud ? 1 : 0; fade.shadow = params.mShadow ? 1 : 0;
      }
      const urlRect = parseRect(ctx.url.get("reg"));
      if (!dragging) rect = urlRect || (keys.length > 3 ? DEFAULT_REGION.slice() : rect);
      if (keys.includes("honour") && params.honour && !prev.honour) ctx.done();
      refresh(keys.includes("band") || keys.length > 3);
    },
    resize() { hatchPaths = null; stage.render(); },
    unmount() {
      if (heroTween) heroTween.cancel();
      for (const t of Object.values(fadeTweens)) if (t) t.cancel();
      ctx.url.set("reg", null);
      stage.dispose();
      ctx.overlay.clear(PREFIX);
    },
  };
}
