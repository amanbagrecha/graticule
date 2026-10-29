import * as h3 from "h3";
import * as s2 from "@/core/s2.js";
import * as gh from "@/core/geohash.js";
import { make } from "@/core/projections.js";
import { geo, FONT_MONO, FONT_UI } from "@/core/map2d.js";
import { DEG, RAD, clamp } from "@/core/math.js";
import { mixOklab, hexToRgb, css } from "@/core/palette.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const WARN = "#b7791f";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const INK4 = "#a29c91";
const BG = "#faf8f3";
const LINE2 = "#cdc6b7";
const OCEAN = "#b1c8d6";
const LAND = "#ddd3bb";
const COAST = "rgba(50,46,40,.55)";

export const R_KM = 6371.0088;
const R_H3 = 6371.007180918475;

export const GRIDS = ["s2", "h3", "gh"];
export const GRID_INFO = {
  s2: { name: "S2", unit: "level", colour: BRASS, shape: "Squares from a cube", note: "Smallest at the middle of each face edge" },
  h3: { name: "H3", unit: "resolution", colour: SIGNAL, shape: "Hexagons from an icosahedron", note: "" },
  gh: { name: "Geohash", unit: "length", colour: VIOLET, shape: "Boxes from halving", note: "Same degrees, fewer km toward the poles" },
};

export const SIZES = {
  "100000": { s2: 5, h3: 2, gh: 2 },
  "10000": { s2: 7, h3: 3, gh: 3 },
  "1000": { s2: 8, h3: 4, gh: 4 },
};

export const REGIONS = {
  europe: { label: "Europe", centre: [10, 50] },
  africa: { label: "Africa", centre: [20, 2] },
  pacific: { label: "Pacific", centre: [-157.5, 20.5] },
  arctic: { label: "Arctic", centre: [15, 80] },
};

const SIZE_OPTIONS = [
  { value: "100000", label: "~100,000 km²" },
  { value: "10000", label: "~10,000 km²" },
  { value: "1000", label: "~1,000 km²" },
];

export const meta = {
  id: "dggs-compare",
  title: "Cells side by side",
  track: 5,
  order: 10,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "Every global grid is a projection plus a rule for cutting. Squares from a cube, hexagons from an icosahedron, boxes from halving. Each makes a choice between equal area and equal shape. Compare cells of similar size and see how much their areas vary.",
  deeper: [
    "S2 level 5 has 6,144 cells, mean 83,019 km².",
    "H3 res 2 has 5,882 cells, mean 86,716 km² (hexagons 86,802 km²).",
    "Geohash 3 is 156 km square at the equator and far narrower at 70°.",
    "H3 hexagons vary in area by under 2:1 (2.3:1 with the 12 pentagons); geohash boxes by much more.",
  ],
  keywords: ["DGGS", "S2", "H3", "geohash", "cell area", "compactness", "equal area"],
  controls: [
    { key: "size", type: "segment", label: "Cell size", options: SIZE_OPTIONS, default: "100000" },
    { key: "region", type: "select", label: "Region", options: Object.entries(REGIONS).map(([value, r]) => ({ value, label: r.label })), default: "europe" },
    { key: "metric", type: "segment", label: "Measure", options: [{ value: "area", label: "Area" }, { value: "compactness", label: "Compactness" }], default: "area" },
    { type: "legend", label: "Key", items: [
      { color: "#2f6fc0", label: "Smaller than the mean cell of its grid" },
      { color: BRASS, label: "Larger than the mean cell of its grid" },
      { color: SIGNAL, line: true, label: "The place you clicked, in all three grids" },
      { color: WARN, line: true, label: "H3 pentagon" },
    ] },
  ],
  readouts: [
    { key: "s2Cells", label: "S2 cells" },
    { key: "s2Ratio", label: "S2 max / min", hero: true },
    { key: "h3Cells", label: "H3 cells" },
    { key: "h3Ratio", label: "H3 max / min", hero: true },
    { key: "ghCells", label: "Geohash cells" },
    { key: "ghRatio", label: "Geohash max / min", hero: true },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-50m.json"],
};

const PREFIX = meta.id + ":";

export function levelsFor(size) {
  return SIZES[String(size)] || SIZES["100000"];
}

export function cellCount(grid, level) {
  if (grid === "s2") return s2.cellCount(level);
  if (grid === "h3") return h3.getNumCells(level);
  return 32 ** level;
}

export function meanArea(grid, level) {
  const R = grid === "h3" ? R_H3 : R_KM;
  return (4 * Math.PI * R * R) / cellCount(grid, level);
}

export function cellAt(grid, level, lon, lat) {
  if (grid === "s2") return s2.cellFromLatLng(lon, lat, level).token;
  if (grid === "h3") return h3.latLngToCell(lat, lon, level);
  return gh.encode(clamp(lon, -180, 180 - 1e-9), clamp(lat, -90, 90 - 1e-9), level);
}

export function gridLabel(grid, level) {
  const i = GRID_INFO[grid];
  return `${i.name} ${grid === "h3" ? "res" : i.unit} ${level}`;
}

const xyz = (lon, lat) => { const c = Math.cos(lat * DEG); return [c * Math.cos(lon * DEG), c * Math.sin(lon * DEG), Math.sin(lat * DEG)]; };
const toLL = (v) => [Math.atan2(v[1], v[0]) * RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD];
const arc = (a, b) => {
  const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
};

export function cellRing(grid, id) {
  if (grid === "s2") return s2.cellBoundary(s2.cellFromToken(id));
  if (grid === "h3") return h3.cellToBoundary(id).map(([lat, lng]) => [lng, lat]);
  const b = gh.bounds(id);
  return [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]];
}

export function denseRing(grid, id, stepDeg = 0.5) {
  const ring = cellRing(grid, id);
  const out = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length];
    if (grid === "gh") {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / stepDeg));
      for (let q = 0; q < n; q++) out.push([a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n]);
    } else {
      const A = xyz(a[0], a[1]), B = xyz(b[0], b[1]);
      const w = arc(A, B);
      const n = Math.max(1, Math.ceil(w / (stepDeg * DEG)));
      for (let q = 0; q < n; q++) {
        const t = q / n;
        if (w < 1e-12) { out.push(a); continue; }
        const s0 = Math.sin((1 - t) * w) / Math.sin(w), s1 = Math.sin(t * w) / Math.sin(w);
        out.push(toLL([A[0] * s0 + B[0] * s1, A[1] * s0 + B[1] * s1, A[2] * s0 + B[2] * s1]));
      }
    }
  }
  return out;
}

export function cellFeature(grid, id) {
  if (grid === "s2") return s2.cellPolygon(s2.cellFromToken(id));
  if (grid === "h3") {
    const ring = cellRing("h3", id).reverse();
    ring.push(ring[0].slice());
    return { type: "Polygon", coordinates: [ring] };
  }
  const b = gh.bounds(id);
  const dl = b.east - b.west;
  const n = Math.max(1, Math.ceil(dl / 0.25));
  const ring = [[b.west, b.south], [b.west, b.north]];
  for (let q = 1; q < n; q++) ring.push([b.west + (dl * q) / n, b.north]);
  ring.push([b.east, b.north], [b.east, b.south]);
  for (let q = n - 1; q > 0; q--) ring.push([b.west + (dl * q) / n, b.south]);
  ring.push([b.west, b.south]);
  return { type: "Polygon", coordinates: [ring] };
}

function ghRowArea(south, north, dlon) {
  return dlon * DEG * (Math.sin(north * DEG) - Math.sin(south * DEG));
}

function ghRowPerimeter(south, north, dlon) {
  return dlon * DEG * (Math.cos(south * DEG) + Math.cos(north * DEG)) + 2 * (north - south) * DEG;
}

const pp = (areaSr, perimRad) => (4 * Math.PI * areaSr) / (perimRad * perimRad);

function s2Metrics(cell) {
  const n = 2 ** cell.level;
  const s0 = cell.i / n, s1 = (cell.i + 1) / n, t0 = cell.j / n, t1 = (cell.j + 1) / n;
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const P = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => unit(s2.cellVertexXYZ(cell, s, t)));
  const per = arc(P[0], P[1]) + arc(P[1], P[2]) + arc(P[2], P[3]) + arc(P[3], P[0]);
  const area = s2.cellArea(cell, 1);
  return { area: area * R_KM * R_KM, compact: pp(area, per) };
}

function h3Metrics(id) {
  const V = h3.cellToBoundary(id).map(([lat, lng]) => xyz(lng, lat));
  let per = 0;
  for (let k = 0; k < V.length; k++) per += arc(V[k], V[(k + 1) % V.length]);
  const sr = h3.cellArea(id, "rads2");
  return { area: sr * R_H3 * R_H3, compact: pp(sr, per) };
}

function ghMetrics(id) {
  const b = gh.bounds(id);
  const sr = ghRowArea(b.south, b.north, b.east - b.west);
  return { area: sr * R_KM * R_KM, compact: pp(sr, ghRowPerimeter(b.south, b.north, b.east - b.west)) };
}

export function metricsOf(grid, id) {
  if (grid === "s2") return s2Metrics(s2.cellFromToken(id));
  if (grid === "h3") return h3Metrics(id);
  return ghMetrics(id);
}

export const areaOf = (grid, id) => metricsOf(grid, id).area;
export const compactnessOf = (grid, id) => metricsOf(grid, id).compact;

export function geohashBoxKm(hash) {
  const b = gh.bounds(hash);
  const mid = (b.south + b.north) / 2;
  return { width: (b.east - b.west) * DEG * Math.cos(mid * DEG) * R_KM, height: (b.north - b.south) * DEG * R_KM };
}

export const BINS = 48;
export const AREA_DOMAIN = [-4, 1];
export const COMPACT_DOMAIN = [0, 1];
export const HEXAGON_COMPACTNESS = Math.PI / (2 * Math.sqrt(3));
export const SQUARE_COMPACTNESS = Math.PI / 4;

export function areaPosition(rel) {
  return (Math.log2(rel) - AREA_DOMAIN[0]) / (AREA_DOMAIN[1] - AREA_DOMAIN[0]);
}

export function* statsSteps(grid, level, chunk = 4096) {
  const mean = meanArea(grid, level);
  const area = new Float64Array(BINS), comp = new Float64Array(BINS);
  let under = 0, count = 0, sum = 0, min = Infinity, max = 0, hexMin = Infinity, hexMax = 0;
  let cMin = Infinity, cMax = 0;
  const add = (a, c, w, pent = false) => {
    count += w; sum += a * w;
    if (a < min) min = a;
    if (a > max) max = a;
    if (!pent) { if (a < hexMin) hexMin = a; if (a > hexMax) hexMax = a; }
    if (c < cMin) cMin = c;
    if (c > cMax) cMax = c;
    const p = areaPosition(a / mean);
    if (p < 0) under += w; else area[Math.min(BINS - 1, Math.floor(p * BINS))] += w;
    comp[clamp(Math.floor(c * BINS), 0, BINS - 1)] += w;
  };
  let k = 0;
  if (grid === "s2") {
    const n = 2 ** level;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const m = s2Metrics(s2.cellFromFaceIJ(0, i, j, level));
      add(m.area, m.compact, 6);
      if (++k % chunk === 0) yield k;
    }
  } else if (grid === "h3") {
    const cells = h3.uncompactCells(h3.getRes0Cells(), level);
    for (const c of cells) {
      const m = h3Metrics(c);
      add(m.area, m.compact, 1, h3.isPentagon(c));
      if (++k % chunk === 0) yield k;
    }
  } else {
    const size = gh.cellSize(level);
    const rows = Math.round(180 / size.lat), cols = Math.round(360 / size.lon);
    for (let r = 0; r < rows; r++) {
      const s = -90 + r * size.lat, n = s + size.lat;
      const sr = ghRowArea(s, n, size.lon);
      add(sr * R_KM * R_KM, pp(sr, ghRowPerimeter(s, n, size.lon)), cols);
    }
  }
  return { grid, level, count, mean: sum / count, closedMean: mean, min, max, hexMin, hexMax, ratio: max / min, hexRatio: hexMax / hexMin, compactMin: cMin, compactMax: cMax, area, under, comp };
}

export function globalStats(grid, level) {
  const it = statsSteps(grid, level, Infinity);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export function regionCells(grid, level, centre, radiusKm) {
  const [lon0, lat0] = centre;
  const rDeg = (radiusKm / R_KM) * RAD;
  const C = xyz(lon0, lat0);
  const cosR = Math.cos(rDeg * DEG);
  const out = new Set();
  const poleN = lat0 + rDeg >= 90, poleS = lat0 - rDeg <= -90;
  const latLo = Math.max(-90, lat0 - rDeg), latHi = Math.min(90, lat0 + rDeg);
  const inCap = (lon, lat) => { const p = xyz(lon, lat); return p[0] * C[0] + p[1] * C[1] + p[2] * C[2] >= cosR; };
  const sinW = Math.sin(rDeg * DEG) / Math.cos(lat0 * DEG);
  const w = poleN || poleS || sinW >= 1 ? 180 : Math.asin(sinW) * RAD;
  if (grid === "gh") {
    const size = gh.cellSize(level);
    const rows = Math.round(180 / size.lat), cols = Math.round(360 / size.lon);
    const r0 = clamp(Math.floor((latLo + 90) / size.lat), 0, rows - 1), r1 = clamp(Math.floor((latHi + 90) / size.lat), 0, rows - 1);
    const c0 = w >= 180 ? 0 : Math.floor((lon0 - w + 180) / size.lon), c1 = w >= 180 ? cols - 1 : Math.floor((lon0 + w + 180) / size.lon);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const cc = ((c % cols) + cols) % cols;
      out.add(gh.encode(-180 + (cc + 0.5) * size.lon, -90 + (r + 0.5) * size.lat, level));
    }
    return [...out];
  }
  const typical = Math.sqrt(meanArea(grid, level) * 0.4);
  const step = Math.max(0.01, ((typical / R_KM) * RAD) / 3);
  for (let lat = latLo; lat <= latHi + 1e-9; lat += step) {
    const lstep = step / Math.max(Math.cos(lat * DEG), 0.02);
    for (let dl = -w; dl <= w + 1e-9; dl += lstep) {
      const lon = ((lon0 + dl + 540) % 360) - 180;
      if (!inCap(lon, lat)) continue;
      out.add(cellAt(grid, level, lon, clamp(lat, -89.9999, 89.9999)));
    }
  }
  return [...out];
}

export function ratioText(r) {
  return `${r.toFixed(r >= 100 ? 0 : r >= 10 ? 1 : 2)} : 1`;
}

const fmtInt = (v) => Math.round(v).toLocaleString("en-US");
export function fmtArea(km2) {
  if (km2 >= 100) return `${fmtInt(km2)} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${(km2 * 100).toFixed(0)} ha`;
}

const RAMP_BLUE = hexToRgb("#2f6fc0"), RAMP_MID = hexToRgb("#5b6886"), RAMP_BRASS = hexToRgb(BRASS);
const RAMP_LOW = hexToRgb("#b42335"), RAMP_HIGH = hexToRgb(SIGNAL);

export function areaColour(rel, a = 1) {
  const t = clamp(Math.log2(rel), -1, 1);
  return css(t < 0 ? mixOklab(RAMP_MID, RAMP_BLUE, -t) : mixOklab(RAMP_MID, RAMP_BRASS, t), a);
}

export function compactColour(c, a = 1) {
  const t = clamp((c - 0.45) / 0.5, 0, 1);
  return css(t < 0.5 ? mixOklab(RAMP_LOW, RAMP_MID, t * 2) : mixOklab(RAMP_MID, RAMP_HIGH, (t - 0.5) * 2), a);
}

export function spanKm(size) {
  return 11 * Math.sqrt(meanArea("s2", levelsFor(size).s2));
}

export function layout(W, H) {
  if (W < 640) return compactLayout(W, H);
  const pad = clamp(Math.round(W * 0.022), 14, 40);
  const gap = clamp(Math.round(W * 0.018), 10, 34);
  const titleH = 24, headH = 40, vgap = 10;
  const big = W > 1200;
  const statsRow = big ? 19 : 16;
  const statsH = statsRow * 6;
  const colW = Math.floor((W - 2 * pad - 2 * gap) / 3);
  const histH = clamp(Math.round(H * 0.17), 90, 200);
  const avail = H - 2 * pad - titleH - headH - histH - statsH - 3 * vgap;
  const mapH = Math.max(90, Math.min(colW, avail));
  const total = titleH + headH + mapH + histH + statsH + 3 * vgap;
  const top = Math.max(pad, Math.round((H - total) / 2));
  const cols = [0, 1, 2].map((i) => {
    const x = pad + i * (colW + gap);
    const head = { x, y: top + titleH, w: colW, h: headH };
    const map = { x, y: head.y + headH, w: colW, h: mapH };
    const hist = { x, y: map.y + mapH + vgap, w: colW, h: histH };
    const stats = { x, y: hist.y + histH + vgap, w: colW, h: statsH, row: statsRow };
    return { head, map, hist, stats };
  });
  return { pad, gap, top, title: { x: pad, y: top, w: W - 2 * pad, h: titleH }, cols, big, compact: false, bottom: top + total };
}

function compactLayout(W, H) {
  const pad = W < 380 ? 10 : 12;
  const titleH = 36, vgap = 8, gap = 12, headH = 18, subH = 14, statsRow = 15;
  const tile = Math.max(72, Math.min(Math.floor((H - 2 * pad - titleH - 2 * vgap) / 3), Math.round(W * 0.34)));
  const sub = tile >= 104;
  const total = titleH + 3 * tile + 2 * vgap;
  const top = Math.max(pad, Math.round((H - total) / 2));
  const rx = pad + tile + gap, rw = W - pad - rx;
  const cols = [0, 1, 2].map((i) => {
    const y = top + titleH + i * (tile + vgap);
    const head = { x: rx, y, w: rw, h: headH, sub: sub ? { y: y + headH, h: subH } : null };
    const stats = { x: rx, y: y + tile - statsRow, w: rw, h: statsRow, row: statsRow };
    const hy = y + headH + (sub ? subH : 0) + 4;
    const hist = { x: rx, y: hy, w: rw, h: stats.y - 2 - hy };
    return { head, map: { x: pad, y, w: tile, h: tile }, hist, stats };
  });
  return { pad, gap, top, title: { x: pad, y: top, w: W - 2 * pad, h: titleH }, cols, big: false, compact: true, bottom: top + total };
}

function fit(g, options, maxW) {
  return options.find((o) => g.measureText(o).width <= maxW) ?? null;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function tag(g, x, y, text, colour, { align = "left", font = `500 11px ${FONT_MONO}` } = {}) {
  g.font = font;
  const w = g.measureText(text).width + 12;
  const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  roundRect(g, x0, y - 10, w, 20, 6);
  g.fillStyle = "rgba(250,248,243,.88)";
  g.fill();
  g.strokeStyle = "rgba(29,99,168,.35)";
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = colour;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText(text, x0 + 6, y + 0.5);
}

export function drawHistogram(g, rect, st, { metric, grow = 1, compact = false, title = !compact, rug = null, marks = [] }) {
  const { x, y, w, h } = rect;
  const titleH = title ? 16 : 0, axisH = compact ? 12 : 26;
  const underW = metric === "area" ? (compact ? 14 : 20) : 0;
  const bx = x + underW + (underW ? 6 : 0), bw = w - (bx - x);
  const by = y + titleH, bh = h - titleH - axisH;
  if (title) {
    g.font = `500 11px ${FONT_UI}`;
    g.fillStyle = INK3;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(metric === "area" ? "Cell area ÷ mean, every cell" : "Compactness 4πA/P², every cell", x, y);
  }
  g.strokeStyle = "rgba(60,52,40,.22)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, by + bh + 0.5); g.lineTo(x + w, by + bh + 0.5); g.stroke();
  const pos = (v) => (metric === "area" ? areaPosition(v) : (v - COMPACT_DOMAIN[0]) / (COMPACT_DOMAIN[1] - COMPACT_DOMAIN[0]));
  const colourAt = (u) => (metric === "area" ? areaColour(2 ** (AREA_DOMAIN[0] + u * (AREA_DOMAIN[1] - AREA_DOMAIN[0]))) : compactColour(u));
  const rampY = by + bh + 3;
  for (let i = 0; i < 48; i++) { g.fillStyle = colourAt((i + 0.5) / 48); g.fillRect(bx + (i * bw) / 48, rampY, bw / 48 + 0.6, compact ? 3 : 4); }
  if (!st) {
    g.font = `500 11px ${FONT_UI}`; g.fillStyle = INK4; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("Counting cells…", bx + bw / 2, by + bh / 2);
  } else {
    const bins = metric === "area" ? st.area : st.comp;
    let peak = 0;
    for (const v of bins) if (v > peak) peak = v;
    if (metric === "area" && st.under > peak) peak = st.under;
    const sc = (v) => (peak ? Math.sqrt(v / peak) : 0) * (bh - 4) * grow;
    const bwid = bw / bins.length;
    for (let i = 0; i < bins.length; i++) {
      if (!bins[i]) continue;
      const hh = Math.max(1.5, sc(bins[i]));
      g.fillStyle = colourAt((i + 0.5) / bins.length);
      g.globalAlpha *= 0.92;
      g.fillRect(bx + i * bwid + 0.5, by + bh - hh, Math.max(1, bwid - 1), hh);
      g.globalAlpha /= 0.92;
    }
    if (underW && st.under) {
      const hh = Math.max(1.5, sc(st.under));
      g.fillStyle = areaColour(1 / 64);
      g.fillRect(x, by + bh - hh, underW, hh);
    }
  }
  if (underW) {
    g.font = `500 ${compact ? 8.5 : 9.5}px ${FONT_MONO}`; g.fillStyle = INK3; g.textAlign = "center"; g.textBaseline = "top";
    if (!compact) g.fillText("less", x + underW / 2, rampY + 8);
  }
  if (rug && rug.length) {
    g.strokeStyle = "rgba(26,25,23,.55)";
    g.lineWidth = 1;
    g.beginPath();
    for (const v of rug) {
      const u = pos(v);
      const px = u < 0 && underW ? x + underW / 2 : bx + clamp(u, 0, 1) * bw;
      g.moveTo(px + 0.5, by + bh - 5); g.lineTo(px + 0.5, by + bh);
    }
    g.stroke();
  }
  const refs = metric === "compactness" && !compact ? [[SQUARE_COMPACTNESS, "square"], [HEXAGON_COMPACTNESS, "hexagon"]] : [];
  for (const [v] of refs) {
    const px = bx + pos(v) * bw;
    g.save(); g.setLineDash([3, 3]); g.strokeStyle = "rgba(26,25,23,.35)";
    g.beginPath(); g.moveTo(px + 0.5, by + 10); g.lineTo(px + 0.5, by + bh); g.stroke(); g.restore();
  }
  for (const m of marks) {
    const u = pos(m.value);
    const px = u < 0 && underW ? x + underW / 2 : bx + clamp(u, 0, 1) * bw;
    g.strokeStyle = m.colour; g.lineWidth = m.width || 2;
    g.beginPath(); g.moveTo(px, by + 2); g.lineTo(px, by + bh + (compact ? 3 : 7)); g.stroke();
    g.fillStyle = m.colour; g.beginPath(); g.arc(px, by + 3, 2.5, 0, 2 * Math.PI); g.fill();
  }
  for (const [v, label] of refs) {
    const px = bx + pos(v) * bw;
    g.font = `500 9.5px ${FONT_UI}`; g.textAlign = "right"; g.textBaseline = "top";
    const ty = label === "hexagon" ? by : by + 12;
    g.lineWidth = 3; g.strokeStyle = BG; g.strokeText(label, px - 3, ty);
    g.fillStyle = INK2; g.fillText(label, px - 3, ty);
  }
  if (compact) return;
  g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textBaseline = "top";
  const ticks = metric === "area" ? [[1 / 16, "1/16"], [1 / 4, "1/4"], [1, "1"], [2, "2"]] : [[0, "0"], [0.5, "0.5"], [1, "1"]];
  for (const [v, label] of ticks) {
    const px = bx + pos(v) * bw;
    g.textAlign = px - bx < 8 ? "left" : bx + bw - px < 8 ? "right" : "center";
    g.fillText(label, px, rampY + 8);
  }
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const globe = stage.globe;
  const is3D = !!globe;
  let params = { ...ctx.params };
  let alive = true;
  const landData = ctx.data.get("land-50m.json") || (await ctx.data.load("land-50m.json"));
  const land = landData && landData.type === "Topology" ? geo.features(landData, "land") : landData;

  const parseAt = (s) => { const v = String(s || "").split(",").map(Number); return v.length === 2 && v.every(Number.isFinite) && Math.abs(v[1]) <= 90 ? [((v[0] + 540) % 360) - 180, v[1]] : null; };
  let pinned = parseAt(ctx.url.get("at"));
  let hover = null;

  const statsCache = new Map();
  const statsKey = (grid, level) => grid + level;
  const pending = new Set();
  const onStats = [];
  const ensureStats = (grid, level) => {
    const key = statsKey(grid, level);
    if (statsCache.has(key) || pending.has(key)) return;
    pending.add(key);
    const it = statsSteps(grid, level);
    const step = () => {
      if (!alive) return;
      const t0 = performance.now();
      let r = it.next();
      while (!r.done && performance.now() - t0 < 12) r = it.next();
      if (!r.done) { setTimeout(step, 0); return; }
      pending.delete(key);
      statsCache.set(key, r.value);
      for (const fn of onStats) fn(grid, level);
    };
    setTimeout(step, 0);
  };
  const statsOf = (grid) => statsCache.get(statsKey(grid, levelsFor(params.size)[grid])) || null;

  const pushReadouts = () => {
    const lv = levelsFor(params.size);
    const out = {};
    for (const grid of GRIDS) {
      const st = statsOf(grid);
      out[grid + "Cells"] = fmtInt(cellCount(grid, lv[grid]));
      out[grid + "Ratio"] = st ? ratioText(st.ratio) : "…";
    }
    ctx.readout.setMany(out);
  };

  const requestAll = () => {
    const lv = levelsFor(params.size);
    for (const grid of ["gh", "s2", "h3"]) ensureStats(grid, lv[grid]);
  };

  const chipLines = (lon, lat) => {
    const lv = levelsFor(params.size);
    const lines = [];
    for (const grid of GRIDS) {
      const id = cellAt(grid, lv[grid], lon, lat);
      const m = metricsOf(grid, id);
      lines.push(`${GRID_INFO[grid].name} ${id} · ${fmtArea(m.area)} · ${m.compact.toFixed(2)}`);
    }
    return lines;
  };

  if (is3D) return mount3D();
  return mount2D();

  function mount3D() {
    const card = stage.element("div", "dggs-card");
    card.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:auto;height:auto;padding:12px 14px 10px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;";
    const cv = document.createElement("canvas");
    card.append(cv);
    const CW = 268, ROW = 64, CH = 22 + ROW * 3;
    let grow = 1, growTween = null;
    let lastKey = "";

    const drawCard = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = CW * dpr; cv.height = CH * dpr;
      cv.style.width = CW + "px"; cv.style.height = CH + "px";
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, CW, CH);
      g.font = `600 12px ${FONT_UI}`; g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "top";
      g.fillText(params.metric === "area" ? "Cell area ÷ mean, every cell on the globe" : "Compactness, every cell on the globe", 0, 0);
      const lv = levelsFor(params.size);
      GRIDS.forEach((grid, i) => {
        const y = 22 + i * ROW;
        const st = statsOf(grid);
        g.fillStyle = GRID_INFO[grid].colour;
        g.fillRect(0, y + 3, 10, 3);
        g.font = `600 11.5px ${FONT_UI}`; g.fillStyle = INK; g.textAlign = "left"; g.textBaseline = "top";
        g.fillText(gridLabel(grid, lv[grid]), 16, y - 1);
        g.font = `500 11px ${FONT_MONO}`; g.fillStyle = INK2; g.textAlign = "right";
        g.fillText(st ? `max/min ${ratioText(st.ratio)}` : "…", CW, y - 1);
        const marks = [];
        if (pinned) { const m = metricsOf(grid, cellAt(grid, lv[grid], pinned[0], pinned[1])); marks.push({ value: params.metric === "area" ? m.area / meanArea(grid, lv[grid]) : m.compact, colour: SIGNAL }); }
        drawHistogram(g, { x: 0, y: y + 16, w: CW, h: ROW - 22 }, st, { metric: params.metric, grow, compact: true, marks });
      });
    };

    const regrow = () => {
      if (growTween) growTween.cancel();
      if (ctx.reducedMotion) { grow = 1; drawCard(); return; }
      growTween = ctx.anim.tween({ from: 0, to: 1, duration: 300, ease: ctx.anim.ease.out, onUpdate: (u) => { grow = u; drawCard(); }, onDone: () => { growTween = null; grow = 1; drawCard(); } });
    };

    const capKm = () => Math.sqrt((520 * meanArea("s2", levelsFor(params.size).s2)) / Math.PI);
    const distFor = () => ({ "100000": 2.45, "10000": 1.62, "1000": 1.3 }[params.size] || 2.45);

    const drawLines = () => {
      const lv = levelsFor(params.size);
      const centre = REGIONS[params.region].centre;
      const key = params.size + params.region;
      if (key === lastKey) return;
      lastKey = key;
      for (const grid of GRIDS) {
        const ids = regionCells(grid, lv[grid], centre, capKm());
        const step = Math.min(1, Math.sqrt(meanArea(grid, lv[grid])) / R_KM * RAD / 4);
        const segs = [];
        for (const id of ids) {
          const ring = denseRing(grid, id, step);
          for (let k = 0; k < ring.length; k++) segs.push([ring[k], ring[(k + 1) % ring.length]]);
        }
        globe.addLines(PREFIX + "grid-" + grid, segs, { color: css(hexToRgb(GRID_INFO[grid].colour), 0.8), width: grid === "gh" ? 1.1 : 1.3 });
      }
    };

    const drawPin = () => {
      if (!pinned) { for (const grid of GRIDS) globe.remove(PREFIX + "pin-" + grid); return; }
      const lv = levelsFor(params.size);
      for (const grid of GRIDS) {
        const id = cellAt(grid, lv[grid], pinned[0], pinned[1]);
        const ring = denseRing(grid, id, 0.2);
        const segs = ring.map((p, k) => [p, ring[(k + 1) % ring.length]]);
        globe.addLines(PREFIX + "pin-" + grid, segs, { color: GRID_INFO[grid].colour, width: 3.2 });
      }
    };

    const look = (duration) => {
      const c = REGIONS[params.region].centre;
      globe.camera.lookAt(c[0], c[1], distFor(), { duration: ctx.reducedMotion ? 0 : duration });
    };

    onStats.push(() => { pushReadouts(); regrow(); });
    requestAll();
    drawLines();
    drawPin();
    pushReadouts();
    drawCard();
    look(0);

    return {
      update(p, keys) {
        params = { ...p };
        if (keys.includes("size") || keys.includes("region")) { requestAll(); drawLines(); drawPin(); if (keys.length <= 2) look(900); }
        pushReadouts();
        if (keys.length <= 2 && (keys.includes("metric") || keys.includes("size"))) regrow(); else drawCard();
      },
      hover(lon, lat) {
        return chipLines(lon, lat);
      },
      probe(lon, lat) {
        pinned = [+lon.toFixed(4), +lat.toFixed(4)];
        ctx.url.set("at", pinned.join(","));
        drawPin();
        drawCard();
        return {};
      },
      unprobe() {
        pinned = null;
        ctx.url.set("at", null);
        drawPin();
        drawCard();
      },
      resize() {},
      unmount() {
        alive = false;
        if (growTween) growTween.cancel();
        globe.removePrefix(PREFIX);
        card.remove();
      },
    };
  }

  function mount2D() {
    const canvas = stage.canvas("dggs-canvas");
    canvas.style.cursor = "crosshair";
    canvas.style.touchAction = "none";
    const g = canvas.getContext("2d");
    const base = document.createElement("canvas");
    const snap = document.createElement("canvas");
    let W = 0, H = 0, dpr = 1, L = null;
    let panels = [];
    let pathKey = "";
    let fade = 1, fadeTween = null, haveSnap = false;
    const grow = [1, 1, 1];
    const growTweens = [null, null, null];

    const sizeCanvases = () => {
      W = stage.width; H = stage.height - stage.insetBottom;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [canvas, base, snap]) { c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(stage.height * dpr)); }
      L = layout(W, H);
    };

    const buildPanels = () => {
      const key = [params.size, params.region, W, H].join("|");
      if (key === pathKey) return;
      pathKey = key;
      const lv = levelsFor(params.size);
      const centre = REGIONS[params.region].centre;
      const span = spanKm(params.size);
      panels = GRIDS.map((grid, i) => {
        const m = L.cols[i].map;
        const scale = m.w / (span / R_KM);
        const proj = make("azimuthalEqualArea", { lon0: centre[0], lat0: centre[1] })
          .scale(scale).translate([m.x + m.w / 2, m.y + m.h / 2])
          .clipExtent([[m.x - 6, m.y - 6], [m.x + m.w + 6, m.y + m.h + 6]])
          .precision(0.2);
        const radiusKm = (Math.hypot(m.w, m.h) / 2 / scale) * R_KM * 1.05 + Math.sqrt(meanArea(grid, lv[grid]));
        const level = lv[grid];
        const mean = meanArea(grid, level);
        const cells = regionCells(grid, level, centre, radiusKm).map((id) => {
          const mt = metricsOf(grid, id);
          return { id, area: mt.area, rel: mt.area / mean, compact: mt.compact, path: geo.path2D(proj, cellFeature(grid, id)), pent: grid === "h3" && h3.isPentagon(id) };
        });
        const index = new Map(cells.map((c) => [c.id, c]));
        return { grid, level, mean, proj, scale, cells, index, land: geo.path2D(proj, land) };
      });
    };

    const cellEntry = (P, id) => {
      let c = P.index.get(id);
      if (!c) {
        const mt = metricsOf(P.grid, id);
        c = { id, area: mt.area, rel: mt.area / P.mean, compact: mt.compact, path: geo.path2D(P.proj, cellFeature(P.grid, id)), pent: P.grid === "h3" && h3.isPentagon(id) };
        P.index.set(id, c);
      }
      return c;
    };

    const drawBase = () => {
      const b = base.getContext("2d");
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.clearRect(0, 0, W, stage.height);
      b.fillStyle = BG;
      b.fillRect(0, 0, W, stage.height);
      const region = REGIONS[params.region];
      const span = spanKm(params.size);
      b.font = `600 13px ${FONT_UI}`; b.fillStyle = INK; b.textAlign = "left"; b.textBaseline = "middle";
      const t1 = `${region.label} · ${ctx.fmt.lat(region.centre[1])} ${ctx.fmt.lon(region.centre[0])}`;
      b.fillText(t1, L.title.x, L.title.y + 9);
      const tw = b.measureText(t1).width;
      b.font = `500 12px ${FONT_UI}`; b.fillStyle = INK3;
      const room = L.title.w - tw;
      const km = fmtInt(Math.round(span / 10) * 10);
      const long = `  Each map is ${km} km across, on one equal-area map. Click a place to find it in all three.`;
      const short = `  Each map is ${km} km across, on one equal-area map.`;
      if (L.compact) {
        const sub = fit(b, [short, `  Each map is ${km} km across.`, `  ${km} km across`], room);
        if (sub) b.fillText(sub, L.title.x + tw, L.title.y + 9);
        b.font = `500 11px ${FONT_UI}`;
        const what = params.metric === "area" ? "cell area ÷ mean" : "compactness 4πA/P²";
        const cap = fit(b, [`Bars: ${what}, every cell on the globe. Tap a map to pin a place.`, `Bars: ${what}, every cell on the globe`, `Bars: ${what}, every cell`, `Bars: ${what}`], L.title.w);
        if (cap) b.fillText(cap, L.title.x, L.title.y + 26);
      } else {
        b.fillText(b.measureText(long).width <= room ? long : short, L.title.x + tw, L.title.y + 9, room);
      }
      panels.forEach((P, i) => {
        const col = L.cols[i];
        const info = GRID_INFO[P.grid];
        const st = statsOf(P.grid);
        const hd = col.head;
        if (L.compact) {
          b.fillStyle = info.colour;
          roundRect(b, hd.x, hd.y + 2, 4, hd.sub ? 26 : 14, 2); b.fill();
          const cy = hd.y + 9;
          b.textBaseline = "middle";
          b.font = `600 12.5px ${FONT_MONO}`;
          const ratio = st ? ratioText(st.ratio) : "…";
          const vw = b.measureText(ratio).width;
          b.font = `600 13px ${FONT_UI}`;
          const label = fit(b, [gridLabel(P.grid, P.level), `${info.name} ${P.level}`], hd.w - 12 - vw - 8);
          b.fillStyle = INK; b.textAlign = "left";
          b.fillText(label, hd.x + 12, cy);
          const lw = b.measureText(label).width;
          b.font = `600 12.5px ${FONT_MONO}`; b.fillStyle = info.colour; b.textAlign = "right";
          b.fillText(ratio, hd.x + hd.w, cy);
          b.font = `500 11px ${FONT_UI}`; b.fillStyle = INK3;
          const lead = fit(b, ["max / min ", "max/min "], hd.w - 12 - lw - vw - 10);
          if (lead) b.fillText(lead, hd.x + hd.w - vw, cy);
          if (hd.sub) {
            b.font = `500 11px ${FONT_UI}`; b.fillStyle = INK3; b.textAlign = "left";
            const shape = fit(b, [`${info.shape} · mean ${fmtArea(P.mean)}`, info.shape], hd.w - 12);
            if (shape) b.fillText(shape, hd.x + 12, hd.sub.y + hd.sub.h / 2);
          }
        } else {
          b.fillStyle = info.colour;
          roundRect(b, hd.x, hd.y + 7, 4, 26, 2); b.fill();
          b.font = `600 ${L.big ? 15 : 13}px ${FONT_UI}`; b.fillStyle = INK; b.textAlign = "left"; b.textBaseline = "top";
          b.fillText(gridLabel(P.grid, P.level), hd.x + 12, hd.y + 5);
          b.font = `500 ${L.big ? 12 : 11}px ${FONT_UI}`; b.fillStyle = INK3;
          b.fillText(info.shape, hd.x + 12, hd.y + (L.big ? 24 : 22));
        }
        const m = col.map;
        b.save();
        roundRect(b, m.x, m.y, m.w, m.h, 10);
        b.clip();
        b.fillStyle = OCEAN; b.fillRect(m.x, m.y, m.w, m.h);
        b.fillStyle = LAND; b.fill(P.land);
        for (const c of P.cells) {
          b.fillStyle = params.metric === "area" ? areaColour(c.rel, 0.58) : compactColour(c.compact, 0.5);
          b.fill(c.path);
        }
        b.strokeStyle = COAST; b.lineWidth = 0.8; b.stroke(P.land);
        const many = P.cells.length > 400;
        b.strokeStyle = many ? "rgba(26,25,23,.42)" : "rgba(26,25,23,.6)";
        b.lineWidth = many ? 0.7 : 1;
        for (const c of P.cells) b.stroke(c.path);
        for (const c of P.cells) if (c.pent) { b.strokeStyle = WARN; b.lineWidth = 2; b.stroke(c.path); }
        b.restore();
        roundRect(b, m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1, 10);
        b.strokeStyle = LINE2; b.lineWidth = 1; b.stroke();
        if (i === 0) {
          b.font = `500 10.5px ${FONT_MONO}`;
          const room = (v) => 12 + (v / R_KM) * P.scale + 6 + b.measureText(`${fmtInt(v)} km`).width <= m.w - 6;
          const km = [20, 50, 100, 200, 500, 1000].reduce((best, v) => (v / R_KM * P.scale <= m.w * 0.32 && room(v) ? v : best), 20);
          const px = (km / R_KM) * P.scale;
          const sx = m.x + 12, sy = m.y + m.h - 14;
          b.strokeStyle = "rgba(250,248,243,.8)"; b.lineWidth = 4;
          b.beginPath(); b.moveTo(sx, sy); b.lineTo(sx + px, sy); b.stroke();
          b.strokeStyle = INK; b.lineWidth = 1.5;
          b.beginPath(); b.moveTo(sx, sy - 4); b.lineTo(sx, sy); b.lineTo(sx + px, sy); b.lineTo(sx + px, sy - 4); b.stroke();
          b.font = `500 10.5px ${FONT_MONO}`; b.fillStyle = INK; b.textAlign = "left"; b.textBaseline = "bottom";
          b.save();
          b.lineWidth = 3; b.lineJoin = "round"; b.strokeStyle = "rgba(250,248,243,.85)";
          b.strokeText(`${fmtInt(km)} km`, sx + px + 6, sy + 4);
          b.restore();
          b.fillText(`${fmtInt(km)} km`, sx + px + 6, sy + 4);
        }
        const s = col.stats;
        if (L.compact) {
          const range = st ? `${fmtArea(st.min)} to ${fmtArea(st.max)}` : "";
          const options = P.grid === "h3"
            ? (st ? [`Without the 12 pentagons: ${ratioText(st.hexRatio)}`, `${ratioText(st.hexRatio)} without pentagons`] : [])
            : [info.note, range];
          b.font = `500 11px ${FONT_UI}`; b.fillStyle = INK3; b.textAlign = "left"; b.textBaseline = "middle";
          const note = fit(b, options.filter(Boolean), s.w);
          if (note) b.fillText(note, s.x, s.y + s.h / 2);
          return;
        }
        const rows = [
          ["Cells on the globe", fmtInt(cellCount(P.grid, P.level))],
          ["Mean area", fmtArea(P.mean)],
          ["Min area", st ? fmtArea(st.min) : "…"],
          ["Max area", st ? fmtArea(st.max) : "…"],
          ["Max / min", st ? ratioText(st.ratio) : "…"],
        ];
        rows.forEach(([k, v], r) => {
          const y = s.y + r * s.row + s.row / 2;
          const strong = r === 4;
          b.font = `500 ${L.big ? 12 : 11}px ${FONT_UI}`; b.fillStyle = strong ? INK2 : INK3; b.textAlign = "left"; b.textBaseline = "middle";
          b.fillText(k, s.x, y);
          b.font = `${strong ? 600 : 500} ${strong ? (L.big ? 14 : 12.5) : (L.big ? 12 : 11)}px ${FONT_MONO}`; b.fillStyle = strong ? info.colour : INK; b.textAlign = "right";
          b.fillText(v, s.x + s.w, y);
          if (r < 4) { b.fillStyle = "rgba(205,198,183,.5)"; b.fillRect(s.x, s.y + (r + 1) * s.row - 0.5, s.w, 1); }
        });
        const note = P.grid === "h3" ? (st ? `Without the 12 pentagons: ${ratioText(st.hexRatio)}` : "") : info.note;
        b.font = `500 ${L.big ? 11.5 : 10.5}px ${FONT_UI}`; b.fillStyle = INK3; b.textAlign = "left"; b.textBaseline = "middle";
        b.fillText(note, s.x, s.y + 5 * s.row + s.row / 2, s.w);
      });
    };

    const histMarks = (P) => {
      const marks = [];
      const val = (c) => (params.metric === "area" ? c.rel : c.compact);
      if (hover) marks.push({ value: val(cellEntry(P, cellAt(P.grid, P.level, hover.lon, hover.lat))), colour: "rgba(26,25,23,.85)", width: 1.5 });
      if (pinned) marks.push({ value: val(cellEntry(P, cellAt(P.grid, P.level, pinned[0], pinned[1]))), colour: SIGNAL, width: 2 });
      return marks;
    };

    const drawMarks = () => {
      panels.forEach((P, i) => {
        const m = L.cols[i].map;
        g.save();
        roundRect(g, m.x, m.y, m.w, m.h, 10);
        g.clip();
        if (hover) {
          const c = cellEntry(P, cellAt(P.grid, P.level, hover.lon, hover.lat));
          const own = hover.panel === i;
          g.strokeStyle = "rgba(250,248,243,.7)"; g.lineWidth = own ? 4 : 3; g.stroke(c.path);
          if (!own) g.setLineDash([4, 3]);
          g.strokeStyle = own ? INK : "rgba(26,25,23,.8)"; g.lineWidth = own ? 2 : 1.4; g.stroke(c.path);
          g.setLineDash([]);
          const q = P.proj([hover.lon, hover.lat]);
          if (q && !own) { g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(q[0], q[1], 4, 0, 2 * Math.PI); g.stroke(); }
        }
        if (pinned) {
          const c = cellEntry(P, cellAt(P.grid, P.level, pinned[0], pinned[1]));
          g.fillStyle = "rgba(29,99,168,.16)"; g.fill(c.path);
          g.strokeStyle = "rgba(250,248,243,.8)"; g.lineWidth = 5; g.stroke(c.path);
          g.strokeStyle = SIGNAL; g.lineWidth = 2.5; g.stroke(c.path);
          const q = P.proj(pinned);
          if (q) {
            g.fillStyle = SIGNAL; g.strokeStyle = BG; g.lineWidth = 2;
            g.beginPath(); g.arc(q[0], q[1], 4.5, 0, 2 * Math.PI); g.fill(); g.stroke();
          }
        }
        g.restore();
        if (pinned) {
          const c = cellEntry(P, cellAt(P.grid, P.level, pinned[0], pinned[1]));
          const sizes = L.compact ? [10.5, 9.5, 8.5] : [L.big ? 12 : 10.5];
          let font = "", text = null;
          for (const px of sizes) {
            font = `500 ${px}px ${FONT_MONO}`;
            g.font = font;
            text = fit(g, [`${c.id} · ${fmtArea(c.area)}`, c.id], m.w - 20);
            if (text) break;
          }
          tag(g, m.x + m.w / 2, m.y + 16, text || c.id, SIGNAL, { align: "center", font });
        }
      });
    };

    const render = () => {
      if (!L) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = BG;
      g.fillRect(0, 0, canvas.width, canvas.height);
      if (fade < 1 && haveSnap) { g.globalAlpha = 1 - fade; g.drawImage(snap, 0, 0); }
      g.globalAlpha = haveSnap ? fade : 1;
      g.drawImage(base, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      panels.forEach((P, i) => {
        const rug = P.cells.map((c) => (params.metric === "area" ? c.rel : c.compact));
        drawHistogram(g, L.cols[i].hist, statsOf(P.grid), { metric: params.metric, grow: grow[i], title: !L.compact, rug, marks: histMarks(P) });
      });
      drawMarks();
      g.globalAlpha = 1;
    };

    const regrow = (i) => {
      if (growTweens[i]) growTweens[i].cancel();
      if (ctx.reducedMotion) { grow[i] = 1; render(); return; }
      grow[i] = 0;
      growTweens[i] = ctx.anim.tween({ from: 0, to: 1, duration: 300, ease: ctx.anim.ease.out, onUpdate: (u) => { grow[i] = u; render(); }, onDone: () => { growTweens[i] = null; grow[i] = 1; render(); } });
    };

    const crossfade = () => {
      if (fadeTween) fadeTween.cancel();
      const sg = snap.getContext("2d");
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.clearRect(0, 0, snap.width, snap.height);
      sg.drawImage(canvas, 0, 0);
      haveSnap = true;
      if (ctx.reducedMotion) { fade = 1; return; }
      fade = 0;
      fadeTween = ctx.anim.tween({ from: 0, to: 1, duration: 320, ease: ctx.anim.ease.standard, onUpdate: (u) => { fade = u; render(); }, onDone: () => { fadeTween = null; fade = 1; render(); } });
    };

    const rebuild = ({ animate = false, regrowAll = false } = {}) => {
      if (animate) crossfade();
      buildPanels();
      drawBase();
      if (regrowAll) for (let i = 0; i < 3; i++) if (statsOf(GRIDS[i])) regrow(i);
      render();
    };

    onStats.push((grid, level) => {
      if (levelsFor(params.size)[grid] !== level) return;
      pushReadouts();
      drawBase();
      regrow(GRIDS.indexOf(grid));
    });

    const local = (e) => { const r = stage.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pickAt = (x, y) => {
      if (!L) return null;
      for (let i = 0; i < 3; i++) {
        const m = L.cols[i].map;
        if (x < m.x || x > m.x + m.w || y < m.y || y > m.y + m.h) continue;
        const ll = panels[i] && panels[i].proj.invert([x, y]);
        if (!ll || !Number.isFinite(ll[0])) return null;
        return { panel: i, lon: ll[0], lat: ll[1] };
      }
      return null;
    };
    const stop = (e) => e.stopPropagation();
    let down = null;
    canvas.addEventListener("pointerdown", (e) => { stop(e); down = local(e); }, { signal: ctx.signal });
    canvas.addEventListener("pointermove", (e) => {
      stop(e);
      const p = local(e);
      const hit = pickAt(p.x, p.y);
      if (!hit) {
        if (hover) { hover = null; render(); }
        ctx.overlay.hideChip();
        return;
      }
      hover = hit;
      render();
      const P = panels[hit.panel];
      const c = cellEntry(P, cellAt(P.grid, P.level, hit.lon, hit.lat));
      ctx.overlay.chip(p.x, p.y, [`${ctx.fmt.lat(hit.lat)} ${ctx.fmt.lon(hit.lon)}`, `${GRID_INFO[P.grid].name} ${c.id}`, `${fmtArea(c.area)} · ${(c.rel).toFixed(2)} × mean`, `compactness ${c.compact.toFixed(3)}${c.pent ? " · pentagon" : ""}`]);
    }, { signal: ctx.signal });
    canvas.addEventListener("pointerup", (e) => {
      stop(e);
      const p = local(e);
      const was = down;
      down = null;
      if (!was || Math.hypot(p.x - was.x, p.y - was.y) > 5) return;
      const hit = pickAt(p.x, p.y);
      if (!hit) { if (pinned) { pinned = null; ctx.url.set("at", null); render(); } return; }
      const same = pinned && GRIDS.every((grid, i) => cellAt(grid, panels[i].level, pinned[0], pinned[1]) === cellAt(grid, panels[i].level, hit.lon, hit.lat));
      pinned = same ? null : [+hit.lon.toFixed(4), +hit.lat.toFixed(4)];
      ctx.url.set("at", pinned ? pinned.join(",") : null);
      if (pinned) ctx.overlay.ripple(p.x, p.y);
      render();
    }, { signal: ctx.signal });
    canvas.addEventListener("pointerleave", () => { if (hover) { hover = null; render(); } ctx.overlay.hideChip(); }, { signal: ctx.signal });
    for (const type of ["click", "dblclick", "wheel", "pointercancel"]) canvas.addEventListener(type, stop, { signal: ctx.signal });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && pinned) { pinned = null; ctx.url.set("at", null); render(); } }, { signal: ctx.signal });

    sizeCanvases();
    requestAll();
    rebuild();
    pushReadouts();

    return {
      update(p, keys) {
        const prev = params;
        params = { ...p };
        const changed = keys.filter((k) => prev[k] !== params[k]);
        if (keys.includes("size")) requestAll();
        pushReadouts();
        const real = changed.length > 0 && keys.length <= 2;
        if (changed.includes("size") || changed.includes("region")) rebuild({ animate: real, regrowAll: real });
        else if (changed.includes("metric")) rebuild({ animate: real, regrowAll: real });
        else rebuild();
      },
      hover() { return null; },
      probe() { return null; },
      unprobe() {},
      resize() {
        sizeCanvases();
        pathKey = "";
        haveSnap = false;
        rebuild();
      },
      unmount() {
        alive = false;
        if (fadeTween) fadeTween.cancel();
        for (const t of growTweens) if (t) t.cancel();
        ctx.overlay.hideChip();
        canvas.remove();
      },
    };
  }
}
