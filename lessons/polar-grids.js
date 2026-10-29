import proj4 from "proj4";
import { make, factors, polarStereoK0 } from "@/core/projections.js";
import { clamp, lerp } from "@/core/math.js";
import { drawCaption, FONT_MONO } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const HALO = "rgba(250,248,243,.88)";

export const EASE2 = {
  north: { code: 6931, name: "EASE-Grid 2.0 north", proj4: "+proj=laea +lat_0=90 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs" },
  south: { code: 6932, name: "EASE-Grid 2.0 south", proj4: "+proj=laea +lat_0=-90 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs" },
  grids: { "25": { cols: 720, rows: 720, cell: 25000, ulx: -9000000, uly: 9000000 }, "12.5": { cols: 1440, rows: 1440, cell: 12500, ulx: -9000000, uly: 9000000 } },
};

const STEREO = { north: { code: "3413", lat: 70 }, south: { code: "3031", lat: 71 } };

export const meta = {
  id: "polar-grids",
  title: "Grids for the poles",
  track: 5,
  order: 9,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "polarNorth3413",
  paragraph: "Mercator has no pole. Polar work uses a polar stereographic or an equal-area azimuthal map. They look alike over a hemisphere, so the choice must be stated. Sea-ice grids are square lattices in these maps. On the globe the lattice lines are not meridians.",
  deeper: [
    "EPSG:3413: true at 70 N, centred on 45 W.",
    "EPSG:3031: true at 71 S.",
    "The NSIDC 25 km north grid is 304 × 448 cells.",
    "k at the pole = (1 + sin 70°)/2 = 0.970 on a sphere.",
  ],
  keywords: ["polar stereographic", "EPSG:3413", "EPSG:3031", "EASE-Grid 2.0", "sea ice", "NSIDC", "Arctic", "Antarctic"],
  controls: [
    { key: "pole", type: "segment", label: "Pole", options: [{ value: "north", label: "North" }, { value: "south", label: "South" }], default: "north" },
    { key: "grid", type: "segment", label: "Cell size", options: [{ value: "25", label: "25 km" }, { value: "12.5", label: "12.5 km" }], default: "25" },
    { key: "latTs", type: "range", label: "True-scale latitude", min: 60, max: 90, step: 0.5, default: 70, unit: "°", ticks: [60, 70, 80, 90] },
    { key: "proj", type: "hidden", default: "stereo", url: false },
    { type: "legend", label: "Key", items: [
      { color: SIGNAL, line: true, label: "Sea-ice grid lattice" },
      { color: BRASS, line: true, label: "True-scale parallel, k = 1" },
      { color: "rgba(26,25,23,.8)", dash: true, label: "Meridian through the cell" },
      { color: VIOLET, line: true, label: "EASE-Grid 2.0 (compare)" },
    ] },
  ],
  readouts: [
    { key: "kpole", label: "k at the pole", digits: 4 },
    { key: "kprobe", label: "k at the probe", digits: 4, hero: true },
    { key: "dims", label: "Grid columns × rows" },
    { key: "cell", label: "Cell at the probe" },
  ],
  transport: null,
  compare: { key: "proj", value: "ease" },
  view: null,
  data: ["crs.json"],
};

const PREFIX = meta.id + ":";

export function defaultLatTs(pole) {
  return STEREO[pole === "south" ? "south" : "north"].lat;
}

export function gridSpec(crs, { pole = "north", grid = "25", latTs, proj = "stereo" } = {}) {
  const south = pole === "south";
  const sign = south ? -1 : 1;
  if (proj === "ease") {
    const e = south ? EASE2.south : EASE2.north;
    const g = EASE2.grids[grid] || EASE2.grids["25"];
    return { kind: "ease", pole, grid, epsg: "EPSG:" + e.code, name: e.name, def: e.proj4, latTs: null, ...g };
  }
  const s = STEREO[south ? "south" : "north"];
  const entry = crs.crs[s.code];
  const g = entry.seaIceGrids[grid === "12.5" ? "12.5km" : "25km"];
  const ts = latTs == null ? s.lat : latTs;
  const def = entry.proj4.replace(/\+lat_ts=[-\d.]+/, `+lat_ts=${sign * ts}`);
  return { kind: "stereo", pole, grid, epsg: entry.epsg, name: entry.label, def, latTs: ts, lon0: entry.centralMeridian, cols: g.cols, rows: g.rows, cell: g.cell, ulx: g.ulx, uly: g.uly };
}

export const toLonLat = (spec, x, y) => proj4(spec.def, "EPSG:4326", [x, y]);
export const toXY = (spec, lon, lat) => proj4("EPSG:4326", spec.def, [lon, lat]);

export function gridCorners(spec) {
  const x1 = spec.ulx + spec.cols * spec.cell, y1 = spec.uly - spec.rows * spec.cell;
  return [[spec.ulx, spec.uly], [x1, spec.uly], [x1, y1], [spec.ulx, y1]];
}

export function cellOf(spec, x, y) {
  const col = Math.floor((x - spec.ulx) / spec.cell), row = Math.floor((spec.uly - y) / spec.cell);
  if (col < 0 || row < 0 || col >= spec.cols || row >= spec.rows) return null;
  return { col, row };
}

export function cellAt(spec, lon, lat) {
  const [x, y] = toXY(spec, lon, lat);
  return isFinite(x) && isFinite(y) ? cellOf(spec, x, y) : null;
}

export function cellBox(spec, col, row) {
  const x0 = spec.ulx + col * spec.cell, y0 = spec.uly - row * spec.cell;
  return [[x0, y0], [x0 + spec.cell, y0], [x0 + spec.cell, y0 - spec.cell], [x0, y0 - spec.cell]];
}

export function displayProjection(pole, proj = "stereo", opts = {}) {
  const south = pole === "south";
  if (proj === "ease") return south ? make("azimuthalEqualArea", { rotate: [0, 90, 0], clipAngle: 90, ...opts }) : make("easeNorth", { lon0: -45, ...opts });
  return make(south ? "polarSouth3031" : "polarNorth3413", opts);
}

export function unitProjection(pole, proj, latTs) {
  const south = pole === "south";
  const opts = proj === "ease" ? {} : { latTs: (south ? -1 : 1) * latTs };
  return displayProjection(pole, proj, opts).scale(1).translate([0, 0]).clipAngle(null);
}

export function kPole(proj, latTs) {
  return proj === "ease" ? 1 : polarStereoK0(latTs);
}

export function kAt(pole, proj, latTs, lon, lat) {
  const f = factors(unitProjection(pole, proj, latTs), lon, clamp(lat, -89.9999, 89.9999));
  return f ? f.k : NaN;
}

export function meridianAngle(spec, x, y) {
  const s = spec.pole === "south" ? 1 : -1;
  const a = Math.abs((Math.atan2(s * x, s * y) * 180) / Math.PI);
  return Math.min(a, 180 - a);
}

const fmtM = (v) => (v < 0 ? "−" : "") + Math.abs(Math.round(v)).toLocaleString("en-US");
const fmtCell = (c) => (c ? `row ${c.row}, col ${c.col}` : "–");

export async function mount(ctx) {
  const map = ctx.stage.map;
  const crs = ctx.data.get("crs.json") || (await ctx.data.load("crs.json"));
  const side = ctx.side;
  let params = { ...ctx.params };
  const accent = () => (params.proj === "ease" ? VIOLET : SIGNAL);
  const accentRgb = () => (params.proj === "ease" ? "167,139,250" : "111,211,230");
  let spec = null, fitSpec = null, nodes = null;
  let shownKey = "";
  let alpha = 0;
  let fade = null, glideTw = null, glideToken = 0, gliding = false;
  let hovered = null, pinned = null;
  let taken = [];
  map.labelLayer.avoid = () => taken;

  const specFor = (p) => gridSpec(crs, { pole: p.pole, grid: p.grid, latTs: p.latTs, proj: p.proj });

  const buildNodes = (s) => {
    const step = 250000;
    const W = s.cols * s.cell, H = s.rows * s.cell;
    const xs = [], ys = [];
    for (let v = 0; v < W; v += step) xs.push(s.ulx + v);
    xs.push(s.ulx + W);
    for (let v = 0; v < H; v += step) ys.push(s.uly - v);
    ys.push(s.uly - H);
    const ll = new Float64Array(xs.length * ys.length * 2);
    for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) {
      const p = toLonLat(s, xs[i], ys[j]);
      const k = (j * xs.length + i) * 2;
      ll[k] = p[0]; ll[k + 1] = p[1];
    }
    return { xs, ys, ll, scr: new Float64Array(ll.length), key: "" };
  };

  const fitGeo = (s) => {
    const pts = [];
    const [[x0, y0], , [x1, y1]] = gridCorners(s);
    for (let i = 0; i <= 12; i++) {
      const x = lerp(x0, x1, i / 12), y = lerp(y0, y1, i / 12);
      pts.push(toLonLat(s, x, y0), toLonLat(s, x, y1), toLonLat(s, x0, y), toLonLat(s, x1, y));
    }
    return { type: "MultiPoint", coordinates: pts };
  };

  const layout = () => map.setInsets({ top: 100, left: 12, right: 12, bottom: ctx.stage.insetBottom + 12 });

  const fadeIn = (from = 0) => {
    if (fade) fade.cancel();
    if (ctx.reducedMotion) { alpha = 1; map.invalidate(); return; }
    fade = ctx.anim.tween({ from, to: 1, duration: 600, ease: ctx.anim.ease.out, onUpdate: (v) => { alpha = v; map.invalidate(); } });
  };

  const fadeOut = () => {
    if (fade) fade.cancel();
    const a0 = alpha;
    if (ctx.reducedMotion) { alpha = 0; return Promise.resolve(); }
    fade = ctx.anim.tween({ from: a0, to: 0, duration: 200, ease: ctx.anim.ease.in, onUpdate: (v) => { alpha = v; map.invalidate(); } });
    return fade.promise;
  };

  const rebuild = () => {
    spec = specFor(params);
    fitSpec = gridSpec(crs, { pole: params.pole, grid: "25", proj: "stereo" });
    nodes = buildNodes(spec);
    if (hovered) hovered = null;
    if (pinned) pinned = { ...pinned, cell: cellAt(spec, pinned.lon, pinned.lat) };
  };

  const displayKey = () => [params.pole, params.proj].join("|");

  const applyDisplay = async (duration = 0) => {
    const key = displayKey();
    if (key === shownKey) return;
    shownKey = key;
    map.setFitTarget(fitGeo(fitSpec));
    await map.setProjection(displayProjection(params.pole, params.proj), { duration, tag: key });
    ctx.overlay.update();
  };

  const rotFor = (pole) => (pole === "south" ? [0, 90, 0] : [45, -90, 0]);

  const glide = async (fromPole) => {
    const token = ++glideToken;
    if (glideTw) glideTw.cancel();
    if (ctx.reducedMotion) { gliding = false; await applyDisplay(0); alpha = 1; map.invalidate(); return; }
    gliding = true;
    await fadeOut();
    if (token !== glideToken) return;
    const r0 = rotFor(fromPole), r1 = rotFor(params.pole);
    const globe = make("orthographic", { rotate: r0, clipAngle: 90 });
    map.setFitTarget(null);
    shownKey = "";
    await map.setProjection(globe, { duration: 420, tag: "glide" });
    if (token !== glideToken) return;
    glideTw = ctx.anim.tween({ from: 0, to: 1, duration: 1100, ease: ctx.anim.ease.emph, onUpdate: (u) => {
      if (map.projection !== globe) return;
      globe.rotate([lerp(r0[0], r1[0], u), lerp(r0[1], r1[1], u), 0]);
      map.touch(220);
      ctx.overlay.update();
    } });
    await glideTw.promise;
    if (token !== glideToken) return;
    await applyDisplay(520);
    if (token !== glideToken) return;
    gliding = false;
    fadeIn();
  };

  const projectNodes = (P) => {
    const n = nodes, key = map.stateKey();
    if (n.key === key) return;
    for (let k = 0; k < n.ll.length; k += 2) {
      const q = P([n.ll[k], n.ll[k + 1]]);
      n.scr[k] = q ? q[0] : NaN; n.scr[k + 1] = q ? q[1] : NaN;
    }
    n.key = key;
  };

  const locate = (arr, v, desc) => {
    let lo = 0, hi = arr.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (desc ? arr[mid] >= v : arr[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const screenOf = (x, y) => {
    const n = nodes, nx = n.xs.length;
    const i = locate(n.xs, x, false), j = locate(n.ys, y, true);
    const u = (x - n.xs[i]) / (n.xs[i + 1] - n.xs[i]), v = (n.ys[j] - y) / (n.ys[j] - n.ys[j + 1]);
    const at = (a, b) => (b * nx + a) * 2;
    const A = at(i, j), B = at(i + 1, j), C = at(i, j + 1), D = at(i + 1, j + 1), s = n.scr;
    return [
      (1 - u) * (1 - v) * s[A] + u * (1 - v) * s[B] + (1 - u) * v * s[C] + u * v * s[D],
      (1 - u) * (1 - v) * s[A + 1] + u * (1 - v) * s[B + 1] + (1 - u) * v * s[C + 1] + u * v * s[D + 1],
    ];
  };

  const visibleRange = () => {
    const n = nodes, nx = n.xs.length, ny = n.ys.length, m = 40;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 2, x = n.scr[k], y = n.scr[k + 1];
      if (x > -m && x < map.width + m && y > -m && y < map.height + m) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    }
    if (i0 === Infinity) return null;
    return { i0: Math.max(0, i0 - 1), i1: Math.min(nx - 1, i1 + 1), j0: Math.max(0, j0 - 1), j1: Math.min(ny - 1, j1 + 1) };
  };

  const pxPerCell = () => {
    const n = nodes, nx = n.xs.length;
    const i = Math.floor(nx / 2) - 1, j = Math.floor(n.ys.length / 2);
    const k = (j * nx + i) * 2;
    const d = Math.hypot(n.scr[k + 2] - n.scr[k], n.scr[k + 3] - n.scr[k + 1]);
    return (d / (n.xs[i + 1] - n.xs[i])) * spec.cell;
  };

  const strokeLines = (g, r, xsList, ysList) => {
    const n = nodes;
    g.beginPath();
    for (const x of xsList) {
      let first = true;
      for (let j = r.j0; j <= r.j1; j++) { const q = screenOf(x, n.ys[j]); if (first) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); first = false; }
    }
    for (const y of ysList) {
      let first = true;
      for (let i = r.i0; i <= r.i1; i++) { const q = screenOf(n.xs[i], y); if (first) g.moveTo(q[0], q[1]); else g.lineTo(q[0], q[1]); first = false; }
    }
    g.stroke();
  };

  const lineSets = (r, every) => {
    const n = nodes, s = spec;
    const xLo = n.xs[r.i0], xHi = n.xs[r.i1], yHi = n.ys[r.j0], yLo = n.ys[r.j1];
    const c0 = Math.max(0, Math.floor((xLo - s.ulx) / s.cell)), c1 = Math.min(s.cols, Math.ceil((xHi - s.ulx) / s.cell));
    const r0 = Math.max(0, Math.floor((s.uly - yHi) / s.cell)), r1 = Math.min(s.rows, Math.ceil((s.uly - yLo) / s.cell));
    const major = Math.round(250000 / s.cell);
    const minorX = [], minorY = [], majorX = [], majorY = [];
    for (let c = c0; c <= c1; c++) {
      if (c % major === 0 || c === s.cols) majorX.push(s.ulx + c * s.cell);
      else if (every) minorX.push(s.ulx + c * s.cell);
    }
    for (let w = r0; w <= r1; w++) {
      if (w % major === 0 || w === s.rows) majorY.push(s.uly - w * s.cell);
      else if (every) minorY.push(s.uly - w * s.cell);
    }
    return { minorX, minorY, majorX, majorY };
  };

  const quad = (g, col, row) => {
    const b = cellBox(spec, col, row).map(([x, y]) => screenOf(x, y));
    g.beginPath(); g.moveTo(b[0][0], b[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(b[i][0], b[i][1]);
    g.closePath();
    return b;
  };

  const label = (g, text, x, y, color) => {
    g.font = `500 11px ${FONT_MONO}`; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.lineWidth = 3; g.strokeStyle = HALO; g.lineJoin = "round"; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
    taken.push([x - 3, y - 11, x + g.measureText(text).width + 3, y + 4]);
  };

  const meridianLine = (g, P, lon) => {
    const pts = [];
    const south = params.pole === "south";
    for (let la = south ? -90 : 90; south ? la <= -28 : la >= 28; la += south ? 1 : -1) { const q = P([lon, la]); if (q) pts.push(q); }
    g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.strokeStyle = "rgba(26,25,23,.8)"; g.lineWidth = 1.25; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
  };

  const drawFocus = (g, P, focus, strong) => {
    const { col, row } = focus.cell;
    const rgb = accentRgb();
    const [cx, cy] = [spec.ulx + (col + 0.5) * spec.cell, spec.uly - (row + 0.5) * spec.cell];
    const r = { i0: 0, i1: nodes.xs.length - 1, j0: 0, j1: nodes.ys.length - 1 };
    g.strokeStyle = HALO; g.lineWidth = strong ? 4 : 3;
    strokeLines(g, r, [cx], [cy]);
    g.strokeStyle = `rgba(${rgb},${strong ? 1 : 0.7})`; g.lineWidth = strong ? 2 : 1.5;
    strokeLines(g, r, [cx], [cy]);
    meridianLine(g, P, focus.lon);
    const px = pxPerCell();
    const pad = Math.max(0, (7 - px) / 2);
    const b = quad(g, col, row);
    g.fillStyle = `rgba(${rgb},${strong ? 0.55 : 0.35})`; g.fill();
    g.strokeStyle = accent(); g.lineWidth = 1.5; g.stroke();
    if (pad > 0) {
      const mx = (b[0][0] + b[2][0]) / 2, my = (b[0][1] + b[2][1]) / 2;
      g.beginPath(); g.arc(mx, my, 3.5 + pad / 2, 0, Math.PI * 2); g.strokeStyle = accent(); g.lineWidth = 1.5; g.stroke();
    }
  };

  map.addLayer(PREFIX + "lattice", (g, path, P) => {
    if (!spec || gliding || alpha <= 0.001) return;
    projectNodes(P);
    const r = visibleRange();
    if (!r) return;
    const px = pxPerCell();
    const minorA = clamp((px - 3) / 9, 0, 1) * 0.32;
    const rgb = accentRgb();
    const sets = lineSets(r, minorA > 0.01);
    g.save();
    g.globalAlpha = alpha;
    g.lineCap = "butt";
    if (minorA > 0.01) { g.strokeStyle = `rgba(${rgb},${minorA})`; g.lineWidth = 0.75; strokeLines(g, r, sets.minorX, sets.minorY); }
    g.strokeStyle = `rgba(${rgb},.42)`; g.lineWidth = 1; strokeLines(g, r, sets.majorX, sets.majorY);
    const c = gridCorners(spec).map(([x, y]) => screenOf(x, y));
    g.beginPath(); c.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
    g.strokeStyle = accent(); g.lineWidth = 1.75; g.stroke();
    if (spec.kind === "stereo") {
      const lat = (params.pole === "south" ? -1 : 1) * spec.latTs;
      g.beginPath(); path({ type: "LineString", coordinates: Array.from({ length: 361 }, (_, i) => [-180 + i, lat]) });
      g.strokeStyle = BRASS; g.lineWidth = 2.25; g.stroke();
    }
    if (hovered && hovered.cell && (!pinned || !pinned.cell || pinned.cell.col !== hovered.cell.col || pinned.cell.row !== hovered.cell.row)) drawFocus(g, P, hovered, false);
    if (pinned && pinned.cell) drawFocus(g, P, pinned, true);
    g.restore();
  }, { order: 48 });

  map.addLayer(PREFIX + "labels", (g, path, P) => {
    taken = [[0, map.height - ctx.stage.insetBottom, map.width, map.height]];
    if (!spec || gliding || alpha <= 0.001) return;
    g.save();
    g.globalAlpha = alpha;
    const south = params.pole === "south";
    const pole = P([0, south ? -90 : 90]);
    if (pole) {
      g.fillStyle = INK; g.beginPath(); g.arc(pole[0], pole[1], 3, 0, Math.PI * 2); g.fill();
      label(g, `k = ${kPole(params.proj, params.latTs).toFixed(4)}`, pole[0] + 8, pole[1] - 6, INK);
    }
    if (spec.kind === "stereo") {
      const lat = (south ? -1 : 1) * spec.latTs;
      let best = null;
      for (let lon = -180; lon < 180; lon += 5) {
        const q = P([lon, lat]);
        if (q && q[0] > 20 && q[0] < map.width - 180 && q[1] > 30 && q[1] < map.height - ctx.stage.insetBottom - 20 && (!best || q[0] > best[0])) best = q;
      }
      if (best && pole && Math.hypot(best[0] - pole[0], best[1] - pole[1]) < 110) {
        const low = P([south ? 180 : -45, lat]);
        if (low) best = [low[0] - 30, low[1] + 20];
      }
      if (best) label(g, `${spec.latTs}° ${south ? "S" : "N"} · k = 1`, best[0] + 6, best[1] - 6, BRASS);
    }
    const ul = screenOf(spec.ulx, spec.uly), ur = screenOf(spec.ulx + spec.cols * spec.cell, spec.uly);
    const xy = `(${fmtM(spec.ulx)}, ${fmtM(spec.uly)}) m`;
    g.font = `500 11px ${FONT_MONO}`;
    const corner = g.measureText(xy).width + 12 <= ur[0] - ul[0] ? [[xy, accent()]] : [[`x ${fmtM(spec.ulx)} m`, accent()], [`y ${fmtM(spec.uly)} m`, accent()]];
    corner.push(["row 0, col 0", INK2]);
    corner.forEach(([text, color], i) => label(g, text, ul[0] + 6, ul[1] + 16 + 14 * i, color));
    if (pinned && pinned.cell) {
      const b = cellBox(spec, pinned.cell.col, pinned.cell.row).map(([x, y]) => screenOf(x, y));
      const x = Math.max(b[0][0], b[1][0], b[2][0], b[3][0]) + 8, y = Math.min(b[0][1], b[1][1], b[2][1], b[3][1]) - 6;
      const [mx, my] = toXY(spec, pinned.lon, pinned.lat);
      const ang = meridianAngle(spec, mx, my);
      label(g, fmtCell(pinned.cell), x, y, INK);
      label(g, `column vs meridian ${ang.toFixed(1)}°`, x, y + 14, INK2);
    }
    g.restore();
  }, { order: 56 });

  map.addLayer(PREFIX + "chrome", (g) => {
    if (!spec) return;
    const south = params.pole === "south";
    const right = side === "B";
    let lines;
    if (spec.kind === "ease") {
      lines = [`${spec.epsg} · ${spec.name}`, "Lambert azimuthal equal-area.", `${spec.cell / 1000} km cells, ${spec.cols} × ${spec.rows}.`, `Every cell covers ${(spec.cell / 1000) ** 2} km².`];
      if (!south) lines.push("Its grid is centred on 0°, so it turns 45°.");
    } else {
      const official = spec.latTs === defaultLatTs(params.pole);
      lines = [`${official ? spec.epsg : "Polar stereographic"} · NSIDC sea-ice grid`, `Polar stereographic, true at ${spec.latTs}° ${south ? "S" : "N"}${south ? "" : ", centred on 45° W"}.`, `${spec.cell / 1000} km cells, ${spec.cols} × ${spec.rows}.`];
      if (!official) lines.push(`Not ${spec.epsg}. The same metres cover other ground.`);
      else if (south) lines.push("NSIDC defines this grid with true scale at 70° S.");
    }
    if (gliding) lines = [south ? "To the South Pole" : "To the North Pole", "The view moves over the globe."];
    const cap = drawCaption(g, right ? map.width - 18 : 18, 14, lines, { accent: right ? VIOLET : spec.kind === "ease" ? VIOLET : BRASS, align: right ? "right" : "left" });
    const x0 = right ? map.width - 18 - cap.w : 18;
    taken.push([x0, 14, x0 + cap.w, 14 + cap.h]);
  }, { order: 90, clip: false });

  const readouts = () => {
    ctx.readout.setMany({
      kpole: kPole(params.proj, params.latTs),
      kprobe: pinned ? kAt(params.pole, params.proj, params.latTs, pinned.lon, pinned.lat) : null,
      dims: `${spec.cols} × ${spec.rows}`,
      cell: pinned ? fmtCell(pinned.cell) : "–",
    });
  };

  map.canvas.addEventListener("pointerleave", () => { if (hovered) { hovered = null; map.invalidate(); } }, { signal: ctx.signal });

  if (side === "A" && params.pole === "south" && ctx.url.get("latTs") == null && params.latTs === meta.controls[2].default) {
    params.latTs = defaultLatTs("south");
    Promise.resolve().then(() => ctx.controls.set("latTs", params.latTs));
  }

  layout();
  rebuild();
  await applyDisplay(0);
  readouts();
  fadeIn();

  return {
    update(p, keys) {
      const prevPole = params.pole;
      params = { ...p };
      const poleChanged = keys.includes("pole") && prevPole !== params.pole && keys.length < 3;
      if (poleChanged && side === "A" && params.latTs !== defaultLatTs(params.pole)) {
        params.latTs = defaultLatTs(params.pole);
        Promise.resolve().then(() => ctx.controls.set("latTs", params.latTs));
      }
      rebuild();
      if (poleChanged) glide(prevPole);
      else if (!gliding) {
        if (displayKey() !== shownKey) { applyDisplay(0); fadeIn(); }
        else if (keys.length < 3 && keys.includes("grid")) fadeIn(0.15);
      }
      readouts();
      map.invalidate();
    },
    hover(lon, lat) {
      if (!spec) return [];
      const [x, y] = toXY(spec, lon, lat);
      const cell = cellOf(spec, x, y);
      hovered = cell ? { lon, lat, cell } : null;
      map.invalidate();
      const k = kAt(params.pole, params.proj, params.latTs, lon, lat);
      if (!cell) return [`k = ${k.toFixed(4)}`, "Outside the grid"];
      const ground = spec.kind === "ease" ? `cell area ${((spec.cell / 1000) ** 2).toFixed(2)} km² on the ground` : `cell ${(spec.cell / 1000 / k).toFixed(2)} km on the ground`;
      return [fmtCell(cell), `x ${fmtM(x)} m, y ${fmtM(y)} m`, `k = ${k.toFixed(4)} · ${ground}`];
    },
    probe(lon, lat) {
      if (!spec) return null;
      pinned = { lon, lat, cell: cellAt(spec, lon, lat) };
      map.invalidate();
      return { kprobe: kAt(params.pole, params.proj, params.latTs, lon, lat), cell: fmtCell(pinned.cell) };
    },
    unprobe() {
      pinned = null;
      readouts();
      map.invalidate();
    },
    resize() { layout(); map.invalidate(); },
    unmount() {
      glideToken++;
      if (glideTw) glideTw.cancel();
      if (fade) fade.cancel();
      map.removePrefix(PREFIX);
      map.labelLayer.avoid = null;
      map.setFitTarget(null);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
