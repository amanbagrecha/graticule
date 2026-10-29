import { encode, decode, steps, bounds, neighbours as ghNeighbours, alphabet, cellSize } from "@/core/geohash.js";
import { clamp } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const WARN = "#b7791f";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const HALO = "rgba(250,248,243,.85)";
const LON_C = SIGNAL, LAT_C = VIOLET;
const R_KM = 6371.0088;
const DEFAULT_HASH = "u4pruydqqvj";

export const meta = {
  id: "geohash",
  title: "Letters by halving",
  track: 5,
  order: 6,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  paragraph: "A geohash is a string of letters. Each letter holds five bits. Each bit halves the box: first in longitude, then in latitude. Longer strings make smaller boxes. Nearby places share a prefix, but not always. The Z-order curve shows where the string jumps.",
  deeper: [
    "The alphabet skips a, i, l and o.",
    "5 letters give a 4.9 km box.",
    "7 letters give 153 m.",
    "Neighbours across a big split share no prefix.",
  ],
  keywords: ["geohash", "bits", "base32", "halving", "Z-order"],
  controls: [
    { key: "hash", type: "text", label: "Geohash", default: DEFAULT_HASH },
    { key: "length", type: "range", label: "Length", min: 1, max: 11, step: 1, default: 5, ticks: [1, 3, 5, 7, 9, 11] },
    { key: "point", type: "point", label: "Place", default: [10.40744, 57.64911] },
    { key: "zcurve", type: "toggle", label: "Z-order curve", default: false, shortcut: "z" },
    { key: "neighbours", type: "toggle", label: "Neighbours", default: true, shortcut: "n" },
    { type: "legend", label: "Key", items: [
      { color: LON_C, label: "Bit that halves longitude" },
      { color: LAT_C, label: "Bit that halves latitude" },
      { color: BRASS, line: true, label: "The box of the geohash" },
      { color: WARN, line: true, label: "Neighbour with no shared prefix" },
    ] },
  ],
  readouts: [
    { key: "hash", label: "Geohash", hero: true },
    { key: "centre", label: "Centre" },
    { key: "w", label: "Box width", digits: 3, unit: "km" },
    { key: "h", label: "Box height", digits: 3, unit: "km" },
    { key: "bits", label: "Bits" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
const PANEL_W = 316;
const STRIP_COL = 40, STRIP_GAP = 5, STRIP_ROW = 36, STRIP_ROW_GAP = 4;
const NB_CH = 24;

export const isCompact = (W, H) => W < 640 || H < 480;

export function stripLayout(inner, n) {
  const per = Math.max(1, Math.floor((inner + STRIP_GAP) / (STRIP_COL + STRIP_GAP)));
  const rows = Math.ceil(n / per);
  return { cols: Math.ceil(n / rows), rows, h: rows * STRIP_ROW + (rows - 1) * STRIP_ROW_GAP };
}

export function panelLayout(W, H, len) {
  const compact = isCompact(W, H);
  const top = compact && W < 640;
  const width = top ? W - 16 : PANEL_W;
  const inner = compact ? width - 22 : PANEL_W - 24;
  const s = stripLayout(inner, len);
  return { compact, top, width, inner, cols: s.cols, rows: s.rows, stripH: s.h, mapTop: 74 + s.h };
}

export function ladderRowH(H, len, nb) {
  return clamp(Math.floor((H - 102 - (nb ? 116 : 4)) / len), 22, 38);
}

export function sizeText(hash) {
  const km = boxKm(hash);
  return km.w >= 1 ? `${km.w.toFixed(km.w >= 100 ? 0 : 1)} × ${km.h.toFixed(km.h >= 100 ? 0 : 1)} km` : `${(km.w * 1000).toFixed(km.w >= 0.01 ? 0 : 1)} × ${(km.h * 1000).toFixed(km.h >= 0.01 ? 0 : 1)} m`;
}

const grow = (r, m) => [r[0] - m, r[1] - m, r[2] + m, r[3] + m];
const hits = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export function cleanHash(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s || s.length > 11) return null;
  for (const c of s) if (!alphabet.includes(c)) return null;
  return s;
}

export function boxKm(hash) {
  const b = bounds(hash);
  const lat = (b.south + b.north) / 2;
  const k = (Math.PI / 180) * R_KM;
  return { w: (b.east - b.west) * Math.cos((lat * Math.PI) / 180) * k, h: (b.north - b.south) * k };
}

export function bitCounts(len) {
  const bits = 5 * len;
  return { bits, lon: Math.ceil(bits / 2), lat: Math.floor(bits / 2) };
}

export function childGrid(len) {
  const odd = (len - 1) % 2 === 0;
  return odd ? { cols: 8, rows: 4 } : { cols: 4, rows: 8 };
}

export function childCells(parent) {
  const b = bounds(parent);
  const { cols, rows } = childGrid(parent.length + 1);
  const out = [];
  for (const c of alphabet) {
    const h = parent + c;
    const bb = bounds(h);
    out.push({ hash: h, char: c, box: bb, col: Math.round(((bb.west - b.west) / (b.east - b.west)) * cols), row: Math.round(((b.north - bb.north) / (b.north - b.south)) * rows) });
  }
  return out;
}

export function sharedPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

const fmtLL = (lon, lat, d) => `${Math.abs(lon).toFixed(d)}°${lon < 0 ? "W" : "E"} ${Math.abs(lat).toFixed(d)}°${lat < 0 ? "S" : "N"}`;

export async function mount(ctx) {
  const map = ctx.stage.map;
  let params = { ...ctx.params };
  let anim = null, step = Infinity;
  let booted = false;
  let syncing = false;
  let framed = "";
  let lay = panelLayout(ctx.stage.width, ctx.stage.height, 5);
  let nbOpen = false;
  let textBoxes = [];

  const current = () => {
    const h = cleanHash(params.hash) || DEFAULT_HASH;
    const len = clamp(params.length, 1, 11);
    return h.length >= len ? h.slice(0, len) : encode(params.point[0], params.point[1], len);
  };

  const panel = ctx.stage.element("div", "geohash-panel");
  panel.style.cssText = `position:absolute;inset:auto;left:16px;top:16px;width:${PANEL_W}px;height:auto;max-height:calc(100% - 32px);overflow:hidden;padding:12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;box-sizing:border-box;`;
  const input = document.createElement("input");
  input.type = "text"; input.spellcheck = false; input.maxLength = 11;
  input.setAttribute("aria-label", "Geohash");
  input.placeholder = "Type a geohash, then Enter";
  input.style.cssText = `pointer-events:auto;flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;height:34px;padding:0 10px;border-radius:8px;border:1px solid #cdc6b7;background:#faf8f3;color:${INK};font:500 18px ${FONT_MONO};letter-spacing:.08em;outline:none;`;
  const nbBtn = document.createElement("button");
  nbBtn.type = "button";
  nbBtn.style.cssText = `pointer-events:auto;display:none;flex:none;box-sizing:border-box;height:32px;padding:0 10px;border-radius:8px;border:1px solid #cdc6b7;background:#faf8f3;color:${INK};font:500 13px ${FONT_UI};cursor:pointer;`;
  nbBtn.addEventListener("click", () => { nbOpen = !nbOpen; drawLadder(); map.invalidate(); });
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;align-items:center;";
  row.append(input, nbBtn);
  row.addEventListener("pointerdown", (e) => e.stopPropagation());
  const ladder = document.createElement("canvas");
  ladder.style.cssText = "display:block;margin-top:10px;";
  panel.append(row, ladder);
  const panelRect = () => [panel.offsetLeft, panel.offsetTop, panel.offsetLeft + panel.offsetWidth, panel.offsetTop + panel.offsetHeight];
  map.labelLayer.avoid = () => [grow(panelRect(), 6), ...textBoxes];
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key !== "Enter") return;
    const h = cleanHash(input.value);
    if (!h) { input.style.borderColor = "#b42335"; ctx.snack("Use 1 to 11 letters from the geohash alphabet."); return; }
    input.style.borderColor = "#cdc6b7";
    input.blur();
    setHash(h, h.length);
  });

  const setHash = (h, len) => {
    syncing = true;
    const full = h.length < 11 ? h : h;
    const d = decode(full);
    if (len !== params.length) ctx.controls.set("length", len);
    ctx.controls.set("point", [+d.lon.toFixed(5), +d.lat.toFixed(5)]);
    ctx.controls.set("hash", full);
    syncing = false;
    refresh(true);
  };

  const layout = () => {
    lay = panelLayout(ctx.stage.width, ctx.stage.height, current().length);
    const c = lay.compact;
    panel.style.left = panel.style.top = c ? "8px" : "16px";
    panel.style.width = lay.width + "px";
    panel.style.padding = c ? "8px 10px" : "12px";
    panel.style.borderRadius = c ? "12px" : "14px";
    panel.style.maxHeight = c ? "calc(100% - 16px)" : "calc(100% - 32px)";
    input.style.height = c ? "32px" : "34px";
    input.placeholder = c ? "Type a geohash" : "Type a geohash, then Enter";
    ladder.style.marginTop = c ? "6px" : "10px";
    drawLadder();
    const bottom = ctx.stage.insetBottom + 10;
    map.setInsets(lay.top ? { left: 10, top: lay.mapTop, right: 10, bottom } : { left: lay.width + 28, top: 10, right: 10, bottom });
  };

  const frame = (animate) => {
    const h = current();
    const level = Math.min(h.length, 2);
    const key = h.slice(0, level - 1);
    if ("k" + key === framed) return;
    framed = "k" + key;
    const b = bounds(key);
    const lon = (b.west + b.east) / 2, lat = (b.south + b.north) / 2;
    const ins = map.insets;
    const viewW = map.width - ins.left - ins.right, viewH = map.height - ins.top - ins.bottom;
    const P = map.projection;
    const fitScale = map.fitScale || (P ? P.scale() : 1);
    const pxPerDeg = (fitScale * Math.PI) / 180;
    const zoom = clamp(Math.min(viewW / ((b.east - b.west) * 1.12 * pxPerDeg), viewH / ((b.north - b.south) * 1.12 * pxPerDeg)), 1, 24);
    map.lookAt(lon, lat, zoom, { duration: animate && !ctx.reducedMotion ? 650 : 0 });
  };

  const boxPath = (P, b) => {
    const a = P([b.west, b.north]), c = P([b.east, b.south]);
    return a && c ? [a[0], a[1], c[0] - a[0], c[1] - a[1]] : null;
  };

  map.addLayer(PREFIX + "boxes", (g, path, P) => {
    const h = current();
    const st = steps(h);
    const shown = Math.min(st.length, step);
    const level = Math.min(h.length, 2);
    g.lineJoin = "round";
    const view = [2, 2, map.width - 2, map.height - 2 - ctx.stage.insetBottom];
    const placed = [grow(panelRect(), 2)];
    textBoxes = [];
    const put = (text, fs, x, y) => {
      const w = g.measureText(text).width;
      const box = [x - w / 2 - 2, y - fs / 2 - 1, x + w / 2 + 2, y + fs / 2 + 1];
      if (box[0] < view[0] || box[1] < view[1] || box[2] > view[2] || box[3] > view[3] || placed.some((b) => hits(box, b))) return false;
      placed.push(box); textBoxes.push(box);
      return true;
    };
    const parent = h.slice(0, Math.max(0, level - 1));
    const cells = childCells(parent);
    const rects = cells.map((c) => boxPath(P, c.box));
    g.strokeStyle = "rgba(26,25,23,.28)"; g.lineWidth = 1;
    for (const r of rects) if (r) g.strokeRect(r[0], r[1], r[2], r[3]);
    if (params.zcurve) {
      g.beginPath();
      cells.forEach((c, i) => { const q = P([(c.box.west + c.box.east) / 2, (c.box.south + c.box.north) / 2]); if (q) (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); });
      g.strokeStyle = "rgba(184,82,23,.85)"; g.lineWidth = 1.75; g.stroke();
      cells.forEach((c, i) => { if (i === 0) return; const q = P([(c.box.west + c.box.east) / 2, (c.box.south + c.box.north) / 2]); if (q) { g.fillStyle = BRASS; g.beginPath(); g.arc(q[0], q[1], 2, 0, Math.PI * 2); g.fill(); } });
    }
    cells.forEach((c, i) => {
      const r = rects[i];
      if (!r || Math.abs(r[2]) <= 26 || Math.abs(r[3]) <= 18) return;
      const fs = Math.abs(r[2]) > 60 ? 15 : 12;
      g.font = `500 ${fs}px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
      if (!put(c.hash, fs, r[0] + r[2] / 2, r[1] + r[3] / 2)) return;
      g.lineWidth = 3; g.strokeStyle = HALO; g.strokeText(c.hash, r[0] + r[2] / 2, r[1] + r[3] / 2);
      g.fillStyle = c.hash === h.slice(0, level) ? BRASS : INK2; g.fillText(c.hash, r[0] + r[2] / 2, r[1] + r[3] / 2);
    });
    for (let i = 0; i < shown; i++) {
      const s = st[i];
      const r = boxPath(P, s.box);
      if (!r || Math.abs(r[2]) < 3) continue;
      const last = i === shown - 1;
      g.strokeStyle = s.axis === "lon" ? LON_C : LAT_C;
      g.globalAlpha = last ? 1 : 0.55;
      g.lineWidth = last ? 2 : 1.25;
      g.strokeRect(r[0], r[1], r[2], r[3]);
      if ((last || i < 10) && Math.abs(r[2]) > 22 && Math.abs(r[3]) > 16) {
        g.font = `600 ${last ? 14 : 11}px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
        if (!put(String(s.bit), last ? 14 : 11, r[0] + r[2] / 2, r[1] + r[3] / 2)) { g.globalAlpha = 1; continue; }
        g.lineWidth = 3; g.strokeStyle = HALO; g.strokeText(String(s.bit), r[0] + r[2] / 2, r[1] + r[3] / 2 - (last ? 0 : 0));
        g.fillStyle = s.axis === "lon" ? LON_C : LAT_C; g.fillText(String(s.bit), r[0] + r[2] / 2, r[1] + r[3] / 2);
      }
      g.globalAlpha = 1;
    }
    if (shown >= st.length) {
      const r = boxPath(P, bounds(h));
      if (r) {
        const sz = Math.max(Math.abs(r[2]), 6), sy = Math.max(Math.abs(r[3]), 6);
        g.strokeStyle = BRASS; g.lineWidth = 2.5;
        g.strokeRect(r[0] + r[2] / 2 - sz / 2, r[1] + r[3] / 2 - sy / 2, sz, sy);
      }
      if (params.neighbours) {
        const nb = ghNeighbours(h);
        for (const v of Object.values(nb)) {
          if (!v) continue;
          const rr = boxPath(P, bounds(v));
          if (!rr || Math.abs(rr[2]) < 4) continue;
          g.strokeStyle = sharedPrefix(v, h) === 0 ? WARN : "rgba(29,99,168,.7)"; g.lineWidth = 1.25; g.setLineDash([4, 3]);
          g.strokeRect(rr[0], rr[1], rr[2], rr[3]); g.setLineDash([]);
        }
      }
    }
  }, { order: 52 });

  const drawNeighbours = (g, h, W, y0, ch) => {
    const nb = ghNeighbours(h);
    const order = [["nw", "n", "ne"], ["w", null, "e"], ["sw", "s", "se"]];
    const cw = (W - 8) / 3;
    order.forEach((row, ri) => row.forEach((key, ci) => {
      const x = ci * (cw + 4), y = y0 + ri * (ch + 3);
      const v = key ? nb[key] : h;
      const sp = v ? sharedPrefix(v, h) : 0;
      g.fillStyle = key ? "rgba(250,248,243,1)" : "rgba(184,82,23,.18)";
      g.fillRect(x, y, cw, ch);
      g.strokeStyle = !key ? BRASS : v && sp === 0 ? WARN : "rgba(26,25,23,.25)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      g.font = `500 ${h.length > 8 ? 10 : 12}px ${FONT_MONO}`;
      if (!v) { g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = INK3; g.fillText("past the pole", x + cw / 2, y + ch / 2); return; } g.textBaseline = "middle"; g.textAlign = "center";
      const tw = g.measureText(v).width;
      let x0 = x + cw / 2 - tw / 2;
      g.textAlign = "left";
      g.fillStyle = BRASS; g.fillText(v.slice(0, sp), x0, y + ch / 2);
      x0 += g.measureText(v.slice(0, sp)).width;
      g.fillStyle = sp === 0 ? WARN : INK; g.fillText(v.slice(sp), x0, y + ch / 2);
    }));
  };

  const sizeCanvas = (W, Hh) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ladder.width = Math.round(W * dpr); ladder.height = Math.round(Hh * dpr);
    ladder.style.width = W + "px"; ladder.style.height = Hh + "px";
    const g = ladder.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, Hh);
    return g;
  };

  const drawStrip = (h, st, shown) => {
    const W = lay.inner;
    const open = nbOpen && params.neighbours && shown >= st.length;
    const Hh = lay.stripH + (open ? 8 + 3 * (NB_CH + 3) : 0) + 2;
    const g = sizeCanvas(W, Hh);
    for (let k = 0; k < h.length; k++) {
      const partial = clamp(shown - k * 5, 0, 5);
      if (partial === 0) continue;
      const done = partial === 5;
      const x = (k % lay.cols) * (STRIP_COL + STRIP_GAP), y = Math.floor(k / lay.cols) * (STRIP_ROW + STRIP_ROW_GAP);
      g.fillStyle = "rgba(250,248,243,1)"; g.fillRect(x, y, STRIP_COL, STRIP_ROW);
      g.strokeStyle = "rgba(26,25,23,.18)"; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, STRIP_COL - 1, STRIP_ROW - 1);
      g.textBaseline = "middle"; g.textAlign = "center";
      g.font = `600 17px ${FONT_MONO}`; g.fillStyle = done ? BRASS : INK3; g.fillText(done ? h[k] : "·", x + STRIP_COL / 2, y + 12);
      g.font = `500 11px ${FONT_MONO}`; g.textAlign = "left";
      const bw = g.measureText("0").width, bx = x + (STRIP_COL - 5 * bw) / 2;
      for (let b = 0; b < partial; b++) {
        const s = st[k * 5 + b];
        g.fillStyle = s.axis === "lon" ? LON_C : LAT_C;
        g.fillText(String(s.bit), bx + b * bw, y + 27);
      }
    }
    const kDone = Math.floor(Math.min(shown, st.length) / 5);
    if (lay.rows === 1 && kDone > 0) {
      const size = sizeText(h.slice(0, kDone));
      g.font = `500 11px ${FONT_MONO}`;
      if (W - lay.cols * (STRIP_COL + STRIP_GAP) >= g.measureText(size).width + 4) {
        g.textAlign = "right"; g.textBaseline = "middle";
        g.fillStyle = INK2; g.fillText(size, W, 26);
        g.font = `500 11px ${FONT_UI}`; g.fillStyle = INK3; g.fillText("Box", W, 10);
      }
    }
    if (open) drawNeighbours(g, h, W, lay.stripH + 8, NB_CH);
  };

  const drawTable = (h, st, shown) => {
    const W = PANEL_W - 24;
    const rowH = ladderRowH(ctx.stage.height, h.length, params.neighbours), nbH = params.neighbours ? 112 : 0;
    const sc = rowH / 38;
    const Hh = h.length * rowH + nbH + 4;
    const g = sizeCanvas(W, Hh);
    for (let k = 0; k < h.length; k++) {
      const y = k * rowH;
      const done = shown >= (k + 1) * 5;
      const partial = Math.max(0, Math.min(5, shown - k * 5));
      if (partial === 0) continue;
      const grid = childGrid(k + 1);
      const gw = (grid.cols === 8 ? 48 : 24) * sc, gh = (grid.cols === 8 ? 24 : 32) * sc;
      const gx = 0, gy = y + (rowH - gh) / 2;
      const cells = childCells(h.slice(0, k));
      const pb = bounds(h.slice(0, k));
      for (const c of cells) {
        const x0 = gx + ((c.box.west - pb.west) / (pb.east - pb.west)) * gw, y0 = gy + ((pb.north - c.box.north) / (pb.north - pb.south)) * gh;
        const cw = gw / grid.cols, chh = gh / grid.rows;
        const on = done && c.char === h[k];
        g.fillStyle = on ? "rgba(184,82,23,.85)" : "rgba(250,248,243,1)";
        g.fillRect(x0 + 0.5, y0 + 0.5, cw - 1, chh - 1);
      }
      if (params.zcurve) {
        g.beginPath();
        cells.forEach((c, i) => { const x = gx + (((c.box.west + c.box.east) / 2 - pb.west) / (pb.east - pb.west)) * gw, yy = gy + ((pb.north - (c.box.south + c.box.north) / 2) / (pb.north - pb.south)) * gh; if (i) g.lineTo(x, yy); else g.moveTo(x, yy); });
        g.strokeStyle = "rgba(184,82,23,.7)"; g.lineWidth = 0.75; g.stroke();
      }
      g.strokeStyle = "rgba(26,25,23,.3)"; g.lineWidth = 1; g.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);
      const tx = Math.round(48 * sc) + 12;
      g.textBaseline = "middle";
      g.font = `600 ${Math.max(15, Math.round(20 * sc))}px ${FONT_MONO}`; g.textAlign = "left";
      g.fillStyle = done ? BRASS : INK3; g.fillText(done ? h[k] : "·", tx, y + rowH / 2);
      g.font = `500 ${Math.max(11, Math.round(13 * sc))}px ${FONT_MONO}`;
      for (let b = 0; b < 5; b++) {
        const s = st[k * 5 + b];
        if (b >= partial) break;
        g.fillStyle = s.axis === "lon" ? LON_C : LAT_C;
        g.fillText(String(s.bit), tx + 24 + b * 11, y + rowH / 2);
      }
      if (done) {
        g.font = `500 11px ${FONT_MONO}`; g.fillStyle = INK2; g.textAlign = "right";
        g.fillText(sizeText(h.slice(0, k + 1)), W, y + rowH / 2);
      }
      g.strokeStyle = "rgba(227,222,211,.9)"; g.beginPath(); g.moveTo(0, y + rowH - 0.5); g.lineTo(W, y + rowH - 0.5); g.stroke();
    }
    if (params.neighbours && shown >= st.length) {
      const y0 = h.length * rowH + 10;
      g.font = `600 12px ${FONT_UI}`; g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "alphabetic";
      g.fillText("Neighbours", 0, y0 + 2);
      drawNeighbours(g, h, W, y0 + 10, 26);
    }
  };

  const drawLadder = () => {
    const h = current();
    const st = steps(h);
    const shown = Math.min(st.length, step);
    const showBtn = lay.compact && params.neighbours;
    nbBtn.style.display = showBtn ? "" : "none";
    nbBtn.textContent = nbOpen ? "Neighbours ▴" : "Neighbours ▾";
    nbBtn.setAttribute("aria-expanded", String(nbOpen));
    nbBtn.style.borderColor = nbOpen ? BRASS : "#cdc6b7";
    if (lay.compact) drawStrip(h, st, shown);
    else drawTable(h, st, shown);
  };

  const readouts = () => {
    const h = current();
    const d = decode(h);
    const km = boxKm(h);
    const bc = bitCounts(h.length);
    const digits = clamp(Math.ceil(h.length * 0.75), 1, 6);
    ctx.readout.setMany({ hash: h, centre: fmtLL(d.lon, d.lat, digits), w: km.w, h: km.h, bits: `${bc.bits}: ${bc.lon} lon, ${bc.lat} lat` });
    if (document.activeElement !== input) input.value = h;
  };

  const refresh = (animate) => {
    readouts();
    if (lay.top && stripLayout(lay.inner, current().length).rows !== lay.rows) { layout(); framed = ""; }
    frame(animate && booted);
    if (anim) anim.cancel();
    const total = current().length * 5;
    if (!animate || !booted || ctx.reducedMotion) { step = Infinity; drawLadder(); map.invalidate(); return; }
    step = 0;
    anim = ctx.anim.tween({ from: 0, to: total, duration: 40 * total, ease: ctx.anim.ease.linear, onUpdate: (v) => { const s = Math.floor(v); if (s !== step) { step = s; drawLadder(); map.invalidate(); } }, onDone: () => { anim = null; step = Infinity; drawLadder(); map.invalidate(); } });
  };

  layout();
  await map.ready;
  refresh(false);
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (syncing) return;
      if (keys.includes("point") && keys.length === 1) {
        const h = encode(params.point[0], params.point[1], 11);
        if (h !== params.hash) { params.hash = h; Promise.resolve().then(() => { syncing = true; ctx.controls.set("hash", h); syncing = false; }); }
        refresh(true);
        return;
      }
      if (keys.includes("hash") && keys.length === 1) {
        const h = cleanHash(params.hash);
        if (h) { const d = decode(h); params.point = [+d.lon.toFixed(5), +d.lat.toFixed(5)]; Promise.resolve().then(() => { syncing = true; ctx.controls.set("point", params.point); syncing = false; }); }
        refresh(true);
        return;
      }
      if (keys.includes("length") && keys.length === 1) { refresh(true); return; }
      if (keys.length > 2) framed = "";
      refresh(false);
    },
    hover(lon, lat) {
      const len = clamp(params.length, 1, 11);
      const h = encode(lon, lat, len);
      return [`${h}`, `shares ${sharedPrefix(h, current())} letters with ${current()}`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() { layout(); framed = ""; refresh(false); },
    unmount() {
      if (anim) anim.cancel();
      panel.remove();
      map.labelLayer.avoid = null;
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
      ctx.overlay.clear(PREFIX);
    },
  };
}
