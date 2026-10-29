import { polyhedron } from "@/core/globe.js";
import { rotatedPole, tripolar, cubedSphere, yinYang, geoToRotated, rotatedToGeo, tripolarPoint, areaStats } from "@/core/grids.js";
import { DEG, RAD, smoothstep } from "@/core/math.js";
import { drawCaption, INK } from "@/lessons/_pixelkit.js";

export const meta = {
  id: "model-grids",
  title: "Bent rectangles",
  track: 6,
  order: 4,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A model computes on rectangles of cells bent around the sphere. A combed sphere always has a bald spot, so every grid has singular points. The craft is where to put them: over land for an ocean model, in the sea for a weather model. Unfold shows the array as the model sees it.",
  deeper: [
    "The European CORDEX grid rotates the pole to 39.25 N, 162 W.",
    "A cubed sphere C96 has 6 × 96 × 96 = 55,296 cells.",
    "A tripolar ocean grid puts two north poles over Canada and Siberia.",
    "Yin-Yang is two overlapping lat-lon patches of 270° by 90°.",
  ],
  keywords: ["rotated pole", "tripolar", "cubed sphere", "model grid"],
  controls: [
    { key: "grid", type: "select", label: "Grid", options: [{ value: "rotated", label: "Rotated pole" }, { value: "tripolar", label: "Tripolar" }, { value: "cubed", label: "Cubed sphere" }, { value: "yinyang", label: "Yin-Yang" }], default: "rotated" },
    { key: "res", type: "segment", label: "Resolution", options: [{ value: "coarse", label: "Coarse" }, { value: "fine", label: "Fine" }], default: "coarse" },
    { type: "group", label: "Rotated pole" },
    { key: "poleLon", type: "range", label: "Pole longitude", min: -180, max: 180, step: 0.25, default: -162, unit: "°", fillFrom: 0, ticks: [-180, -90, 0, 90, 180] },
    { key: "poleLat", type: "range", label: "Pole latitude", min: 0, max: 90, step: 0.25, default: 39.25, unit: "°", ticks: [0, 30, 60, 90] },
    { type: "group", label: "Cubed sphere" },
    { key: "cubeN", type: "segment", label: "Cells per face edge", options: [{ value: "24", label: "C24" }, { value: "48", label: "C48" }, { value: "96", label: "C96" }], default: "48" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "Cell edges (every line at coarse)" }, { color: "#b7791f", label: "Singular point (click it)" }, { color: "#b85217", line: true, label: "Edge of the array" }] },
  ],
  readouts: [
    { key: "cells", label: "Cells", digits: 0, hero: true },
    { key: "singular", label: "Singular points", digits: 0 },
    { key: "ratio", label: "Max/min cell area", digits: 2 },
    { key: "pole", label: "Pole position" },
  ],
  transport: { label: ["sphere", "array"], key: "m" },
  compare: null,
  view: { lon: -40, lat: 62, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
const wrap = (d) => ((d + 540) % 360) - 180;
const Q = Math.PI / 4;

export const RES = { rotated: { coarse: [72, 36], fine: [144, 72] }, tripolar: { coarse: [72, 40], fine: [144, 80] }, yinyang: { coarse: 12, fine: 24 } };
const LINE_STRIDE = { rotated: { coarse: 1, fine: 2 }, tripolar: { coarse: 1, fine: 2 }, yinyang: { coarse: 1, fine: 2 } };

export function buildGrid(p) {
  if (p.grid === "rotated") { const [nx, ny] = RES.rotated[p.res]; return rotatedPole(p.poleLon, p.poleLat, nx, ny); }
  if (p.grid === "tripolar") { const [nx, ny] = RES.tripolar[p.res]; return tripolar(nx, ny); }
  if (p.grid === "cubed") return cubedSphere(Number(p.cubeN));
  return yinYang(RES.yinyang[p.res]);
}

export function rotationFor(poleLon, poleLat) {
  return [-poleLon - 180, -(90 - poleLat), 0];
}

export function tripolarInverse(lon, lat, { latC = 65, lonP = 80 } = {}) {
  if (lat < latC) return null;
  const a = Math.tan(((90 - latC) * DEG) / 2);
  const r = Math.tan(((90 - lat) * DEG) / 2);
  const ph = (lon - lonP) * DEG;
  const x = r * Math.cos(ph), y = r * Math.sin(ph);
  const tau = 0.5 * Math.log(((x + a) ** 2 + y * y) / ((x - a) ** 2 + y * y));
  const sigma = Math.atan2(2 * a * y, x * x + y * y - a * a);
  const s = Math.max(0, Math.min(1, (2 * Math.abs(sigma)) / Math.PI - 1));
  const sign = sigma >= 0 ? 1 : -1;
  const theta = sign * 2 * Math.atan(Math.exp(-tau));
  let lonFrac = theta / (2 * Math.PI);
  lonFrac -= Math.floor(lonFrac);
  return { lonFrac, s };
}

export function tripolarIndex(lon, lat, g) {
  const { latC, lonP, latS, capRows } = g;
  const nLow = g.ny - capRows;
  if (lat < latS) return null;
  if (lat < latC) {
    let f = (lon - lonP) / 360;
    f -= Math.floor(f);
    return [f * g.nx, ((lat - latS) / (latC - latS)) * nLow];
  }
  const inv = tripolarInverse(lon, lat, { latC, lonP });
  return [inv.lonFrac * g.nx, nLow + inv.s * capRows];
}

const CUBE_THREE_TO_FACE = (n) => (n[2] > 0.5 ? 0 : n[0] > 0.5 ? 1 : n[2] < -0.5 ? 2 : n[0] < -0.5 ? 3 : n[1] > 0.5 ? 4 : 5);

export function cubeFaceOf(lon, lat) {
  const c = Math.cos(lat * DEG);
  const x = c * Math.cos(lon * DEG), y = c * Math.sin(lon * DEG), z = Math.sin(lat * DEG);
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (az >= ax && az >= ay) return z > 0 ? 4 : 5;
  if (ax >= ay) return x > 0 ? 0 : 2;
  return y > 0 ? 1 : 3;
}

export function cubeAngles(face, lon, lat) {
  const c = Math.cos(lat * DEG);
  const x = c * Math.cos(lon * DEG), y = c * Math.sin(lon * DEG), z = Math.sin(lat * DEG);
  let X, Y;
  if (face === 0) { X = y / x; Y = z / x; }
  else if (face === 1) { X = -x / y; Y = z / y; }
  else if (face === 2) { X = y / x; Y = z / -x; }
  else if (face === 3) { X = x / -y; Y = z / -y; }
  else if (face === 4) { X = y / z; Y = -x / z; }
  else { X = y / -z; Y = x / -z; }
  return [Math.atan(X), Math.atan(Y)];
}

const NET = { 3: [-1.5, 0], 0: [-0.5, 0], 1: [0.5, 0], 2: [1.5, 0], 4: [-0.5, 1], 5: [-0.5, -1] };
const CUBE_SIDE = 0.78;

export function arrayXY(p, lon, lat, extra = {}) {
  if (p.grid === "rotated") {
    const r = geoToRotated(lon, lat, p.poleLon, p.poleLat);
    return [(r[0] / 180) * 1.8, (r[1] / 90) * 0.9];
  }
  if (p.grid === "tripolar") {
    const g = extra.grid;
    const ij = tripolarIndex(lon, lat, g);
    const W = 3.4, H = (3.4 * g.ny) / g.nx;
    if (!ij) return [((((lon - g.lonP) / 360) % 1 + 1) % 1 - 0.5) * W, -H / 2 - 0.05 - (g.latS - lat) * 0.004];
    return [(ij[0] / g.nx - 0.5) * W, (ij[1] / g.ny - 0.5) * H];
  }
  if (p.grid === "cubed") {
    const f = extra.face ?? cubeFaceOf(lon, lat);
    const [a, b] = cubeAngles(f, lon, lat);
    const o = NET[f];
    return [(o[0] + a / (2 * Q)) * CUBE_SIDE, (o[1] + b / (2 * Q)) * CUBE_SIDE];
  }
  const patch = extra.patch ?? (Math.abs(lat) <= 45 && Math.abs(lon) <= 135 ? 0 : 1);
  const q = patch === 0 ? [lon, lat] : yangCoords(lon, lat);
  return [(q[0] / 135) * 1.5, (patch === 0 ? 0.56 : -0.56) + (q[1] / 45) * 0.5];
}

export function yangCoords(lon, lat) {
  const c = Math.cos(lat * DEG);
  const x = c * Math.cos(lon * DEG), y = c * Math.sin(lon * DEG), z = Math.sin(lat * DEG);
  const X = -x, Y = z, Z = y;
  return [Math.atan2(Y, X) * RAD, Math.asin(Math.max(-1, Math.min(1, Z))) * RAD];
}

export function cellIndex(p, lon, lat, grid) {
  if (p.grid === "rotated") {
    const r = geoToRotated(lon, lat, p.poleLon, p.poleLat);
    return [{ i: Math.min(grid.nx - 1, Math.floor(((r[0] + 180) / 360) * grid.nx)), j: Math.min(grid.ny - 1, Math.floor(((r[1] + 90) / 180) * grid.ny)) }];
  }
  if (p.grid === "tripolar") {
    const ij = tripolarIndex(lon, lat, grid);
    return ij ? [{ i: Math.min(grid.nx - 1, Math.floor(ij[0])), j: Math.min(grid.ny - 1, Math.floor(ij[1])) }] : [];
  }
  if (p.grid === "cubed") {
    const f = cubeFaceOf(lon, lat);
    const [a, b] = cubeAngles(f, lon, lat);
    const n = grid.nx;
    return [{ tile: f, i: Math.min(n - 1, Math.floor(((a + Q) / (2 * Q)) * n)), j: Math.min(n - 1, Math.floor(((b + Q) / (2 * Q)) * n)) }];
  }
  const out = [];
  const n = grid.ny, nx = grid.nx;
  if (Math.abs(lat) <= 45 && Math.abs(lon) <= 135) out.push({ tile: 0, i: Math.min(nx - 1, Math.floor(((lon + 135) / 270) * nx)), j: Math.min(n - 1, Math.floor(((lat + 45) / 90) * n)) });
  const q = yangCoords(lon, lat);
  if (Math.abs(q[1]) <= 45 && Math.abs(q[0]) <= 135) out.push({ tile: 1, i: Math.min(nx - 1, Math.floor(((q[0] + 135) / 270) * nx)), j: Math.min(n - 1, Math.floor(((q[1] + 45) / 90) * n)) });
  return out;
}

function makeMorph(p, grid) {
  let fn;
  if (p.grid === "cubed") {
    const poly = polyhedron("cube");
    const faceMap = poly.faces.map((f) => CUBE_THREE_TO_FACE(f.n));
    fn = (lon, lat, t, out = [0, 0, 0], face = -1) => {
      const xy = arrayXY(p, lon, lat, { face: face >= 0 ? faceMap[face] : undefined });
      out[0] = xy[0]; out[1] = xy[1]; out[2] = 0;
      return out;
    };
    fn.mesh = "cube"; fn.poly = poly;
    fn.face = (lon, lat) => { const f = cubeFaceOf(lon, lat); return faceMap.indexOf(f); };
  } else {
    fn = (lon, lat, t, out = [0, 0, 0]) => {
      const xy = arrayXY(p, lon, lat, { grid });
      out[0] = xy[0]; out[1] = xy[1]; out[2] = 0;
      return out;
    };
    if (p.grid === "rotated") {
      fn.gridRotation = rotationFor(p.poleLon, p.poleLat);
      fn.rotated = (rlon, rlat, t, out = [0, 0, 0]) => { out[0] = (wrap(rlon) / 180) * 1.8; out[1] = (rlat / 90) * 0.9; out[2] = 0; return out; };
      fn.tear = Infinity;
    }
  }
  fn.phased = false;
  return fn;
}

function patchMorph(patch) {
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    const xy = arrayXY({ grid: "yinyang" }, lon, lat, { patch });
    out[0] = xy[0]; out[1] = xy[1]; out[2] = 0;
    return out;
  };
  fn.phased = false;
  return fn;
}

export function indexToGeo(p, grid, tile, i, j) {
  if (p.grid === "rotated") return rotatedToGeo(-180 + (360 * i) / grid.nx, -90 + (180 * j) / grid.ny, p.poleLon, p.poleLat);
  if (p.grid === "tripolar") {
    const nLow = grid.ny - grid.capRows;
    if (j <= nLow) return [wrap(grid.lonP + (360 * i) / grid.nx), grid.latS + ((grid.latC - grid.latS) * j) / nLow];
    return tripolarPoint(i / grid.nx, (j - nLow) / grid.capRows, grid);
  }
  if (p.grid === "cubed") {
    const n = grid.nx;
    const a = -Q + (2 * Q * i) / n, b = -Q + (2 * Q * j) / n;
    const X = Math.tan(a), Y = Math.tan(b);
    const v = [[1, X, Y], [-X, 1, Y], [-1, -X, Y], [X, -1, Y], [-Y, X, 1], [Y, X, -1]][tile];
    return [Math.atan2(v[1], v[0]) * RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD];
  }
  const lon = -135 + (270 * i) / grid.nx, lat = -45 + (90 * j) / grid.ny;
  if (tile === 0) return [lon, lat];
  const c = Math.cos(lat * DEG);
  const x = c * Math.cos(lon * DEG), y = c * Math.sin(lon * DEG), z = Math.sin(lat * DEG);
  return [Math.atan2(z, -x) * RAD, Math.asin(Math.max(-1, Math.min(1, y))) * RAD];
}

function gridLines(p, grid, stride, tiles = null, samples = 3) {
  const segs = [];
  const { nx, ny } = grid;
  const list = tiles || [...Array(grid.tiles).keys()];
  for (const tile of list) {
    const line = (fixed, isI) => {
      const n = (isI ? ny : nx) * samples;
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const v = k / samples;
        const cur = isI ? indexToGeo(p, grid, tile, fixed, v) : indexToGeo(p, grid, tile, v, fixed);
        if (prev) segs.push([prev, cur]);
        prev = cur;
      }
    };
    for (let i = 0; i <= nx; i += stride) line(i, true);
    if (nx % stride) line(nx, true);
    for (let j = 0; j <= ny; j += stride) {
      if (p.grid === "rotated" && (j === 0 || j === ny)) continue;
      line(j, false);
    }
    if (ny % stride) line(ny, false);
  }
  return segs;
}

function subdivide(a, b, maxDeg = 2.5) {
  const ca = Math.cos(a[1] * DEG), cb = Math.cos(b[1] * DEG);
  const A = [ca * Math.cos(a[0] * DEG), ca * Math.sin(a[0] * DEG), Math.sin(a[1] * DEG)];
  const B = [cb * Math.cos(b[0] * DEG), cb * Math.sin(b[0] * DEG), Math.sin(b[1] * DEG)];
  const ang = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) * RAD;
  const n = Math.max(1, Math.ceil(ang / maxDeg));
  if (n === 1) return [[a, b]];
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const v = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    pts.push([Math.atan2(v[1], v[0]) * RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) * RAD]);
  }
  const segs = [];
  for (let k = 1; k < pts.length; k++) segs.push([pts[k - 1], pts[k]]);
  return segs;
}

function edgeLines(p, grid) {
  if (p.grid === "rotated") {
    const segs = [];
    for (const e of [179.9, -179.9]) for (let r = -88; r < 88; r += 2) segs.push([rotatedToGeo(e, r, p.poleLon, p.poleLat), rotatedToGeo(e, r + 2, p.poleLon, p.poleLat)]);
    return segs;
  }
  if (p.grid === "tripolar") {
    const segs = [];
    const n = 120;
    for (let k = 0; k < n; k++) segs.push([tripolarPoint(k / n, 1, grid), tripolarPoint((k + 1) / n, 1, grid)]);
    for (let lat = grid.latS; lat < grid.latC; lat += 2) segs.push([[grid.lonP, lat], [grid.lonP, Math.min(grid.latC, lat + 2)]]);
    for (let lon = -180; lon < 180; lon += 2) segs.push([[lon, grid.latS], [lon + 2, grid.latS]]);
    return segs;
  }
  return [];
}

const SINGULAR_NAMES = {
  rotated: (k) => (k === 0 ? "rotated north pole" : "rotated south pole"),
  tripolar: (k) => (k === 0 ? "north pole over Siberia" : k === 1 ? "north pole over Canada" : "south pole, on Antarctica"),
  cubed: () => "cube corner: three faces meet",
  yinyang: () => "",
};

export function singularCount(p) {
  return buildGrid({ ...p, res: "coarse", cubeN: "24" }).singular.length;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let grid = null;
  let booted = false;
  let probed = null;
  let pulse = null;
  let statsCache = new Map();

  const over = ctx.stage.canvas("mg-over");
  over.style.pointerEvents = "none";
  over.style.zIndex = "3";
  const og = over.getContext("2d");

  const drawCaptionBox = () => {
    const W = ctx.stage.width, H = ctx.stage.height, dpr = ctx.stage.dpr;
    if (over.width !== Math.round(W * dpr) || over.height !== Math.round(H * dpr)) { over.width = Math.round(W * dpr); over.height = Math.round(H * dpr); }
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    og.clearRect(0, 0, W, H);
    const lines = {
      rotated: ["A lat-lon grid with its pole moved.", "Drag the amber pole. The equator of the grid follows."],
      tripolar: ["Two north poles sit on land.", "The ocean has no singular point in the north."],
      cubed: ["Six faces of a cube, each a square array.", "Eight corners are the singular points."],
      yinyang: ["Two lat-lon patches overlap.", "Neither patch has a pole inside it."],
    }[params.grid];
    drawCaption(og, 16, 16, t > 0.5 ? [lines[0], "The scrubber shows the array as the model sees it."] : lines, { accent: INK.signal });
  };

  const rebuild = (keys) => {
    grid = buildGrid(params);
    const fn = makeMorph(params, grid);
    globe.morph(fn, t);
    globe.removePrefix(PREFIX + "lines");
    if (params.grid === "yinyang") {
      const per = grid.nx * grid.ny;
      const stride = LINE_STRIDE.yinyang[params.res];
      for (const patch of [0, 1]) {
        globe.addLines(PREFIX + "lines-" + patch, gridLines(params, grid, stride, [patch]), { color: patch === 0 ? "#1d63a8" : "#7046a6", width: 1, depth: true, opacity: 0.85, morph: patchMorph(patch) });
      }
    } else {
      const stride = params.grid === "cubed" ? Math.max(1, Number(params.cubeN) / 24) : LINE_STRIDE[params.grid][params.res];
      globe.addLines(PREFIX + "lines", gridLines(params, grid, stride, null, params.grid === "cubed" ? 2 : 3), { color: "#1d63a8", width: 1, depth: true, opacity: 0.8 });
    }
    const edges = edgeLines(params, grid);
    if (edges.length) globe.addLines(PREFIX + "edge", edges, { color: "#b85217", width: 2, depth: true });
    else globe.remove(PREFIX + "edge");
    drawSingular(keys && keys.some((k) => k === "grid" || k === "poleLon" || k === "poleLat") && booted);
    if (params.grid === "rotated") drawCordex(); else globe.remove(PREFIX + "cordex");
    drawLabels();
    readouts();
    drawCaptionBox();
    ctx.controls.disable("poleLon", params.grid !== "rotated");
    ctx.controls.disable("poleLat", params.grid !== "rotated");
    ctx.controls.disable("cubeN", params.grid !== "cubed");
    ctx.controls.disable("res", params.grid === "cubed");
  };

  const drawCordex = () => {
    const box = [[-28.375, -23.375], [18.155, -23.375], [18.155, 21.835], [-28.375, 21.835], [-28.375, -23.375]];
    const segs = [];
    for (let k = 1; k < box.length; k++) {
      const [a, b] = [box[k - 1], box[k]];
      for (let s = 0; s < 20; s++) {
        const u0 = s / 20, u1 = (s + 1) / 20;
        segs.push([rotatedToGeo(a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0, params.poleLon, params.poleLat), rotatedToGeo(a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1, params.poleLon, params.poleLat)]);
      }
    }
    globe.addLines(PREFIX + "cordex", segs, { color: "#1a1917", width: 1.75, depth: true, dash: [5, 3] });
  };

  const drawSingular = (animate) => {
    if (pulse) { pulse.cancel(); pulse = null; }
    const pts = grid.singular;
    if (!pts.length) { globe.remove(PREFIX + "singular"); return; }
    if (!animate || ctx.reducedMotion) { globe.addPoints(PREFIX + "singular", pts, { color: "#b7791f", size: 11 }); return; }
    pulse = ctx.anim.tween({ from: 26, to: 11, duration: 700, ease: ctx.anim.ease.out, onUpdate: (s) => globe.addPoints(PREFIX + "singular", pts, { color: "#b7791f", size: s }), onDone: () => { pulse = null; } });
  };

  const drawLabels = () => {
    for (const id of ["lab-a", "lab-b", "lab-i", "lab-j"]) globe.remove(PREFIX + id);
    if (t < 0.6) return;
    if (params.grid === "rotated") {
      globe.addLabel3D(PREFIX + "lab-a", [-1.8, -0.9, 0], `(0, 0)`, { dx: -10, dy: 10 });
      globe.addLabel3D(PREFIX + "lab-b", [1.8, 0.9, 0], `(${grid.nx}, ${grid.ny})`, { dx: 6, dy: -22 });
      globe.addLabel3D(PREFIX + "lab-i", [0, -0.9, 0], "i → rotated longitude", { dx: -60, dy: 10, color: INK.ink });
      globe.addLabel3D(PREFIX + "lab-j", [-1.8, 0, 0], "j ↑", { dx: -34, dy: -8, color: INK.ink });
    } else if (params.grid === "tripolar") {
      const W = 3.4, H = (3.4 * grid.ny) / grid.nx;
      globe.addLabel3D(PREFIX + "lab-a", [-W / 2, -H / 2, 0], "(0, 0)", { dx: -10, dy: 10 });
      globe.addLabel3D(PREFIX + "lab-b", [W / 2, H / 2, 0], `(${grid.nx}, ${grid.ny})`, { dx: 6, dy: -22 });
      globe.addLabel3D(PREFIX + "lab-i", [-W / 4, H / 2, 0], "top row: folds onto itself between the two poles", { dx: -120, dy: -24, color: INK.warn });
    } else if (params.grid === "cubed") {
      globe.addLabel3D(PREFIX + "lab-a", [1.0 * CUBE_SIDE, -0.6 * CUBE_SIDE, 0], `6 faces × ${grid.nx} × ${grid.nx} = ${grid.count.toLocaleString("en-US")} cells`, { dx: -40, dy: 14, color: INK.ink });
    } else {
      globe.addLabel3D(PREFIX + "lab-a", [-1.5, 1.06, 0], "Yin: 270° × 90°", { dx: 0, dy: -24, color: INK.signal });
      globe.addLabel3D(PREFIX + "lab-b", [-1.5, -1.06, 0], "Yang: the same patch, turned", { dx: 0, dy: 8, color: INK.violet });
    }
  };

  const stats = () => {
    const key = [params.grid, params.res, params.cubeN, params.poleLon, params.poleLat].join("|");
    if (!statsCache.has(key)) statsCache.set(key, areaStats(grid));
    return statsCache.get(key);
  };

  const readouts = () => {
    const s = stats();
    const pole = params.grid === "rotated" ? `${Math.abs(params.poleLat).toFixed(2)}° ${params.poleLat >= 0 ? "N" : "S"}, ${Math.abs(params.poleLon).toFixed(2)}° ${params.poleLon < 0 ? "W" : "E"}`
      : params.grid === "tripolar" ? "65° N at 80° E and 100° W" : params.grid === "cubed" ? "8 cube corners" : "no poles inside";
    ctx.readout.setMany({ cells: grid.count, singular: grid.singular.length, ratio: s.ratio, pole });
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) return;
    const w = smoothstep(0, 0.15, t);
    const f = globe.camera.fit(null, { padding: 30, insetTop: 70, insetBottom: ctx.stage.insetBottom, minDist: 2.2, apply: false });
    globe.camera.setDist(Math.max(f.dist, 2.2) * w + globe.camera.state().dist * (1 - w));
    globe.camera.setPan(f.pan[0] * w, f.pan[1] * w);
  };

  let faced = false;
  const faceCamera = () => {
    if (ctx.side !== "A") return;
    if (t > 0 && !faced) { globe.camera.lookAt(0, 0, null, { duration: booted && !ctx.reducedMotion ? 500 : 0 }); faced = true; }
    if (t <= 0) faced = false;
  };

  const probeCell = () => {
    globe.remove(PREFIX + "probe");
    ctx.overlay.remove(PREFIX + "sing");
    if (!probed) return;
    const s = grid.singular.findIndex(([lo, la]) => Math.acos(Math.min(1, Math.sin(la * DEG) * Math.sin(probed.lat * DEG) + Math.cos(la * DEG) * Math.cos(probed.lat * DEG) * Math.cos((lo - probed.lon) * DEG))) * RAD < 4);
    if (s >= 0) {
      const [lo, la] = grid.singular[s];
      ctx.overlay.label(PREFIX + "sing", { lon: lo, lat: la }, `${SINGULAR_NAMES[params.grid](s)} (${Math.abs(la).toFixed(2)}° ${la >= 0 ? "N" : "S"}, ${Math.abs(lo).toFixed(2)}° ${lo < 0 ? "W" : "E"})`, { color: INK.warn, leader: true, dx: 22, dy: -22 });
      return;
    }
    const per = grid.nx * grid.ny;
    const segs = [];
    for (const c of cellIndex(params, probed.lon, probed.lat, grid)) {
      const cell = grid.cells[(c.tile || 0) * per + c.j * grid.nx + c.i];
      if (!cell) continue;
      for (let k = 0; k < 4; k++) segs.push(...subdivide(cell[k], cell[(k + 1) % 4], 0.5));
    }
    if (segs.length) globe.addLines(PREFIX + "probe", segs, { color: "#ffffff", width: 2.5, depth: true });
  };

  let poleDrag = null;
  const nearPole = (x, y) => {
    if (params.grid !== "rotated" || t > 0.02) return false;
    const p = globe.project(params.poleLon, params.poleLat);
    return p.visible && Math.hypot(p.x - x, p.y - y) < 16;
  };
  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  ctx.stage.el.addEventListener("pointerdown", (e) => {
    if (ctx.side !== "A" || e.button !== 0) return;
    const [x, y] = stagePos(e);
    if (!nearPole(x, y)) return;
    e.stopPropagation();
    e.preventDefault();
    poleDrag = { id: e.pointerId, moved: 0, x, y };
    ctx.overlay.hideChip();
  }, { capture: true, signal: ctx.signal });
  window.addEventListener("pointermove", (e) => {
    if (!poleDrag) {
      if (params.grid === "rotated" && globe.canvas) { const [x, y] = stagePos(e); globe.canvas.style.cursor = nearPole(x, y) ? "move" : ""; }
      return;
    }
    const [x, y] = stagePos(e);
    poleDrag.moved = Math.max(poleDrag.moved, Math.hypot(x - poleDrag.x, y - poleDrag.y));
    if (poleDrag.moved < 4) return;
    const ll = globe.pick(x, y);
    if (!ll) return;
    ctx.controls.set("poleLon", Math.round(ll.lon * 4) / 4, { live: true, silent: true });
    ctx.controls.set("poleLat", Math.max(0, Math.round(ll.lat * 4) / 4), { live: true });
  }, { signal: ctx.signal });
  window.addEventListener("pointerup", () => {
    if (!poleDrag) return;
    const moved = poleDrag.moved;
    poleDrag = null;
    if (moved < 4) { probed = { lon: params.poleLon, lat: params.poleLat }; probeCell(); return; }
    const v = [params.poleLon, params.poleLat];
    ctx.controls.set("poleLon", v[0]);
    ctx.controls.set("poleLat", v[1]);
  }, { signal: ctx.signal });

  globe.setLayer("graticule", false);
  rebuild();
  if (ctx.transport) ctx.transport.onScrub((value) => {
    const was = t;
    t = value;
    globe.setMorphT(t);
    faceCamera();
    frameCamera();
    if ((was < 0.6) !== (t < 0.6)) { drawLabels(); drawCaptionBox(); }
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      t = params.m ?? t;
      if (keys.some((k) => ["grid", "res", "poleLon", "poleLat", "cubeN"].includes(k))) {
        rebuild(keys);
        if (t > 0) frameCamera();
      }
      probeCell();
    },
    hover(lon, lat) {
      const cs = cellIndex(params, lon, lat, grid);
      if (!cs.length) return params.grid === "tripolar" ? ["south of the grid (Antarctica)"] : [];
      return cs.map((c) => (c.tile !== undefined ? `${params.grid === "cubed" ? "face" : c.tile === 0 ? "Yin" : "Yang"} ${params.grid === "cubed" ? c.tile : ""}  i ${c.i}, j ${c.j}`.replace("  ", " ") : `i ${c.i}, j ${c.j}`));
    },
    probe(lon, lat) {
      probed = { lon, lat };
      probeCell();
      return {};
    },
    unprobe() {
      probed = null;
      globe.remove(PREFIX + "probe");
      ctx.overlay.remove(PREFIX + "sing");
    },
    resize() { drawCaptionBox(); if (t > 0) frameCamera(); },
    unmount() {
      if (pulse) pulse.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      globe.setLayer("graticule", true);
      if (globe.canvas) globe.canvas.style.cursor = "";
      over.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
