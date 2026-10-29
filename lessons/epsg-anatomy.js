import proj4 from "proj4";
import { make } from "@/core/projections.js";
import { FONT_MONO, FONT_UI, dom, geo as geoTools } from "@/core/map2d.js";
import { loadMesh, loadGeoJSON } from "@/core/data.js";

const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const LINE = "#e3ded3";
const HALO = "#faf8f3";
const SERIF = '"Newsreader", "Iowan Old Style", Charter, Georgia, serif';

export const CODES = [4326, 3857, 32633, 32733, 25833, 27700, 3031, 3413, 5070, 2056];
export const PARTS = ["datum", "projection", "axes", "unit"];
const PART_LABEL = { datum: "Datum", projection: "Projection", axes: "Axes", unit: "Unit" };

export const meta = {
  id: "epsg-anatomy",
  title: "EPSG codes",
  track: 1,
  order: 8,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "transverseMercator",
  labels: false,
  paragraph: "A file's coordinates mean nothing until you know the datum, the axis order and the projection. An EPSG code names all of them in one number.",
  deeper: [
    "326xx is UTM north, 327xx is UTM south.",
    "3857 uses a sphere of radius 6,378,137 m.",
    "27700 is a transverse Mercator with k0 = 0.9996012717.",
  ],
  keywords: ["EPSG", "CRS", "UTM", "datum", "axis order", "unit"],
  controls: [
    { key: "code", type: "select", label: "EPSG code", options: [
      { value: "4326", label: "4326", description: "WGS 84 latitude, longitude" },
      { value: "3857", label: "3857", description: "Web Mercator" },
      { value: "32633", label: "32633", description: "UTM zone 33N" },
      { value: "32733", label: "32733", description: "UTM zone 33S" },
      { value: "25833", label: "25833", description: "ETRS89 / UTM zone 33N" },
      { value: "27700", label: "27700", description: "British National Grid" },
      { value: "3031", label: "3031", description: "Antarctic polar stereographic" },
      { value: "3413", label: "3413", description: "Arctic polar stereographic" },
      { value: "5070", label: "5070", description: "Conus Albers equal-area" },
      { value: "2056", label: "2056", description: "Swiss grid LV95" },
    ], default: "32633" },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: null,
  data: ["crs.json"],
};

const PREFIX = meta.id + ":";
const CARD_W = 264;
const GLIDE_MS = 480;
export const COMPACT_W = 640;

export function cardLayout(W, H, insetBottom = 0) {
  if (W >= COMPACT_W) return { compact: false, x: 16, y: 16, w: CARD_W, clearLeft: CARD_W + 24, clearTop: 4, insets: { left: CARD_W + 20, top: 4, right: 4, bottom: insetBottom + 4 } };
  const m = 8, pad = 8, headH = 20, gap = 6, cellH = 34;
  const h = 2 + 2 * pad + headH + gap + 2 * cellH + 4;
  const clearTop = m + h + 4;
  return { compact: true, x: m, y: m, w: W - 2 * m, h, pad, headH, gap, cellH, clearLeft: 4, clearTop, insets: { left: 4, top: clearTop, right: 4, bottom: insetBottom + 4 } };
}

const fmtDeg = (v, pos, neg) => `${+Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;
const fmtM = (v) => `${Math.round(v).toLocaleString("en-US")} m`;

export function utmFromCode(code) {
  const n = +code;
  if (n >= 32601 && n <= 32660) return { zone: n - 32600, hemisphere: "N" };
  if (n >= 32701 && n <= 32760) return { zone: n - 32700, hemisphere: "S" };
  return null;
}

const convCache = new Map();
export function converter(c) {
  let conv = convCache.get(c.proj4);
  if (!conv) { conv = proj4("EPSG:4326", c.proj4); convCache.set(c.proj4, conv); }
  return conv;
}

export function crsCoords(c, lon, lat) {
  if (c.kind === "geographic") return { x: lon, y: lat, unit: "degree" };
  const [x, y] = converter(c).forward([lon, lat]);
  return { x, y, unit: "metre" };
}

export const fmtCoord = (v, unit) => (unit === "degree" ? `${v.toFixed(4)}°` : fmtM(v));

export function shortDatum(c) {
  return c.name.split(" / ")[0];
}

export function shortProjection(c) {
  if (c.kind === "geographic") return "none";
  if (+c.code === 3857) return "Mercator on a sphere";
  const p = c.projection;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export function mainNumbers(c) {
  if (c.kind === "geographic") return "angles only";
  const cm = c.centralMeridian;
  if (+c.code === 3857) return `R ${c.sphereRadius ? c.sphereRadius.toLocaleString("en-US") : "6,378,137"} m`;
  if (c.method === "Transverse Mercator") return `lon0 ${fmtDeg(cm, "E", "W")} · k0 ${c.k0}`;
  if (c.latTs !== null && c.latTs !== undefined) return `lat_ts ${fmtDeg(c.latTs, "N", "S")} · lon0 ${fmtDeg(cm, "E", "W")}`;
  if (c.standardParallels) return `${c.standardParallels.map((v) => v + "°").join(", ")} N · lon0 ${fmtDeg(cm, "E", "W")}`;
  return `centre ${(+cm.toFixed(2))}° E, ${(+c.latitudeOfOrigin.toFixed(2))}° N`;
}

export function partValue(part, c) {
  switch (part) {
    case "datum": return { main: shortDatum(c), sub: `ellipsoid ${c.ellipsoid.name}` };
    case "projection": return { main: shortProjection(c), sub: mainNumbers(c) };
    case "axes": return { main: c.axes.map((a) => a.abbrev).join(", "), sub: c.kind === "geographic" ? "latitude first" : `${c.axes[0].abbrev} first` };
    case "unit": return { main: c.unit, sub: null };
    default: return { main: "", sub: null };
  }
}

const fmtParam = (p) => (p.unit === "degree" ? `${+p.value.toFixed(6)}°` : p.unit === "metre" ? fmtM(p.value) : String(p.value));

export function partDetail(part, c) {
  const e = c.ellipsoid;
  switch (part) {
    case "datum": return [c.datum.replace(" ensemble", ""), `Ellipsoid ${e.name}: a = ${e.a.toLocaleString("en-US")} m, 1/f = ${e.invf}`, "Lesson 5: a new datum gives new numbers."];
    case "projection":
      if (c.kind === "geographic") return ["No projection. The coordinates are angles."];
      return [c.method, ...(+c.code === 3857 ? ["Sphere radius 6,378,137 m"] : []), ...c.parameters.map((p) => `${p.name}: ${fmtParam(p)}`)];
    case "axes": return [...c.axes.map((a, i) => `${i + 1}: ${a.name} (${a.abbrev})`), "Lesson 7: the order of the pair matters."];
    case "unit": return [c.kind === "geographic" ? "Each coordinate is an angle in degrees." : "Each coordinate is a distance in metres."];
    default: return [];
  }
}

export function areaRing({ west: w, south: s, east: e, north: n }) {
  if (w <= -180 && e >= 180 && n >= 89.9 && s > -89.9) return Array.from({ length: 361 }, (_, i) => [180 - i, s]);
  if (w <= -180 && e >= 180 && s <= -89.9 && n < 89.9) return Array.from({ length: 361 }, (_, i) => [-180 + i, n]);
  const pts = [];
  const seg = (a, b, k) => { for (let i = 0; i < k; i++) { const t = i / k; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } };
  const kx = Math.max(2, Math.ceil(Math.abs(e - w))), ky = Math.max(2, Math.ceil(Math.abs(n - s)));
  seg([w, s], [w, n], ky); seg([w, n], [e, n], kx); seg([e, n], [e, s], ky); seg([e, s], [w, s], kx);
  pts.push([w, s]);
  return pts;
}

export const isWorld = (a) => a.west <= -180 && a.east >= 180 && a.south <= -85 && a.north >= 85;

export function areaGeometry(a) {
  if (a.west <= -180 && a.east >= 180 && a.south <= -90 && a.north >= 90) return { type: "Sphere" };
  return { type: "Polygon", coordinates: [areaRing(a)] };
}

export function fitGeometry(a) {
  if (a.west <= -180 && a.east >= 180 && a.south <= -90 && a.north >= 90) return { type: "Sphere" };
  const pts = areaRing(a);
  if (a.south <= -89.9) pts.push([0, -90]);
  if (a.north >= 89.9) pts.push([0, 90]);
  return { type: "MultiPoint", coordinates: pts };
}

export function niceStep(span, target) {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export function projectedBounds(c) {
  const conv = converter(c);
  const pts = areaRing(c.areaOfUse);
  if (c.areaOfUse.south <= -89.9) pts.push([0, -90]);
  if (c.areaOfUse.north >= 89.9) pts.push([0, 90]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lon, lat] of pts) {
    const q = conv.forward([lon, Math.max(-89.9999, Math.min(89.9999, lat))]);
    if (!q || !isFinite(q[0]) || !isFinite(q[1])) continue;
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  return { x0, x1, y0, y1 };
}

const insideArea = (a, [lon, lat]) => lon >= a.west - 1e-6 && lon <= a.east + 1e-6 && lat >= a.south - 1e-6 && lat <= a.north + 1e-6;

export function buildGrid(c) {
  const a = c.areaOfUse;
  const lines = [];
  if (c.kind === "geographic") {
    for (let lon = -180; lon <= 180; lon += 30) lines.push({ axis: 0, value: lon, coords: Array.from({ length: 91 }, (_, i) => [lon, -90 + 2 * i]) });
    for (let lat = -60; lat <= 60; lat += 30) lines.push({ axis: 1, value: lat, coords: Array.from({ length: 181 }, (_, i) => [-180 + 2 * i, lat]) });
  } else {
    const conv = converter(c);
    const b = projectedBounds(c);
    const sx = niceStep(b.x1 - b.x0, 6), sy = niceStep(b.y1 - b.y0, 6);
    const sample = (fn, n = 64) => {
      const out = [];
      for (let i = 0; i <= n; i++) { const ll = conv.inverse(fn(i / n)); if (ll && isFinite(ll[0]) && isFinite(ll[1])) out.push(ll); }
      return out;
    };
    const ox = c.method === "Transverse Mercator" ? c.falseEasting : 0;
    for (let x = ox + Math.ceil((b.x0 - ox) / sx) * sx; x <= b.x1; x += sx) lines.push({ axis: 0, value: x, coords: sample((t) => [x, b.y0 + (b.y1 - b.y0) * t]) });
    for (let y = Math.ceil(b.y0 / sy) * sy; y <= b.y1; y += sy) lines.push({ axis: 1, value: y, coords: sample((t) => [b.x0 + (b.x1 - b.x0) * t, y]) });
  }
  for (const l of lines) l.inside = l.coords.filter((p) => insideArea(a, p));
  const pick = (axis, centre) => {
    const cand = lines.filter((l) => l.axis === axis && l.inside.length > 1);
    if (!cand.length) return null;
    const mid = centre ?? (Math.min(...cand.map((l) => l.value)) + Math.max(...cand.map((l) => l.value))) / 2;
    return cand.reduce((p, q) => (Math.abs(q.value - mid) < Math.abs(p.value - mid) - 1e-6 ? q : p));
  };
  const geographic = c.kind === "geographic";
  const ex = pick(0, geographic ? 0 : c.method === "Transverse Mercator" ? c.falseEasting : undefined);
  const ny = pick(1, geographic ? 30 : undefined);
  const xAxis = geographic ? "Lon" : c.axes[0].abbrev, yAxis = geographic ? "Lat" : c.axes[1].abbrev;
  const text = (axis, v) => (geographic ? `${axis} ${v}°` : `${axis} ${(Math.round(v) || 0).toLocaleString("en-US")} m`);
  const labels = [];
  if (ex) labels.push({ axis: 0, line: ex, text: text(xAxis, ex.value) });
  if (ny) labels.push({ axis: 1, line: ny, text: text(yAxis, ny.value) });
  return { lines, labels, multi: { type: "MultiLineString", coordinates: lines.map((l) => l.coords) } };
}

export function projectionFor(code) {
  switch (+code) {
    case 4326: return make("equirectangular");
    case 3857: return make("webMercator");
    case 32633: case 32733: case 25833: return make("transverseMercator", { lon0: 15 });
    case 27700: return make("transverseMercator", { lon0: -2, lat0: 49 });
    case 3031: return make("polarSouth3031");
    case 3413: return make("polarNorth3413");
    case 5070: return make("albers", { lon0: -96, parallels: [29.5, 45.5] });
    case 2056: return make("mercator", { rotate: [-7.439583333333333, -46.95240555555556, 0] });
    default: return make("equirectangular");
  }
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  const data = ctx.data.get("crs.json") || (await ctx.data.load("crs.json"));
  let params = { ...ctx.params };
  let crs = data.crs[params.code] || data.crs["32633"];
  let shownCode = null, grid = null, area = null, cache = null, ref = null, chipPart = null, borders = null, lakes = null;
  const grids = new Map();
  const touch = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
  let L = cardLayout(ctx.stage.width, ctx.stage.height, ctx.stage.insetBottom);

  const measure = document.createElement("canvas").getContext("2d");
  const card = ctx.stage.element("div", "epsg-card");
  const codeEl = dom("div", { style: { font: `500 20px/26px ${FONT_MONO}`, color: INK, whiteSpace: "nowrap" } });
  const nameEl = dom("div", { style: { color: INK2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } });
  const head = dom("div", {}, codeEl, nameEl);
  const list = dom("div", {});
  card.append(head, list);
  const rows = new Map();
  for (const p of PARTS) {
    const label = dom("div", { text: PART_LABEL[p], style: { font: `600 10.5px/14px ${FONT_UI}`, letterSpacing: ".07em", textTransform: "uppercase", color: INK3 } });
    const main = dom("div", { style: { font: `500 13px/18px ${FONT_MONO}`, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } });
    const sub = dom("div", { style: { font: `400 11px/15px ${FONT_MONO}`, color: INK3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } });
    const el = dom("button", { type: "button", style: { display: "block", width: "100%", minWidth: "0", textAlign: "left", background: "transparent", border: "0", borderTop: `1px solid ${LINE}`, borderRadius: "0", color: "inherit", cursor: "default", font: "inherit" } }, label, main, sub);
    const show = () => showChip(p);
    const hide = () => { if (chipPart === p) hideChip(); };
    el.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") show(); }, { signal: ctx.signal });
    el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hide(); }, { signal: ctx.signal });
    el.addEventListener("focus", show, { signal: ctx.signal });
    el.addEventListener("blur", hide, { signal: ctx.signal });
    el.addEventListener("click", () => { if (touch) { if (chipPart === p) hideChip(); else show(); } }, { signal: ctx.signal });
    list.append(el);
    rows.set(p, { el, label, main, sub });
  }
  for (const ev of ["pointerdown", "wheel", "dblclick"]) card.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  function showChip(p) {
    const r = rows.get(p);
    if (!r) return;
    chipPart = p;
    const sr = ctx.stage.el.getBoundingClientRect(), br = r.el.getBoundingClientRect();
    for (const x of rows.values()) x.el.style.background = x === r ? "rgba(184,82,23,.08)" : "transparent";
    const lines = partDetail(p, crs);
    if (L.compact) ctx.overlay.chip(Math.max(0, br.left - sr.left - 12), br.bottom - sr.top - 6, lines);
    else ctx.overlay.chip(br.right - sr.left - 4, br.top - sr.top - 10, lines);
  }

  function hideChip() {
    chipPart = null;
    for (const x of rows.values()) x.el.style.background = "transparent";
    ctx.overlay.hideChip();
  }

  const layout = () => {
    L = cardLayout(ctx.stage.width, ctx.stage.height, ctx.stage.insetBottom);
    const base = `position:absolute;inset:auto;z-index:4;pointer-events:auto;box-sizing:border-box;border:1px solid ${LINE};background:rgba(255,255,255,.94);box-shadow:0 8px 24px -18px rgba(0,0,0,.6);color:${INK2};`;
    if (L.compact) {
      card.style.cssText = base + `left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px;overflow:hidden;padding:${L.pad}px ${L.pad + 2}px;border-radius:12px;font:400 11.5px/15px ${FONT_UI};`;
      Object.assign(head.style, { display: "flex", alignItems: "baseline", gap: "10px", height: L.headH + "px", marginBottom: L.gap + "px", minWidth: "0" });
      Object.assign(codeEl.style, { font: `500 15px/20px ${FONT_MONO}` });
      Object.assign(list.style, { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: "12px" });
      for (const r of rows.values()) {
        Object.assign(r.el.style, { height: L.cellH + "px", padding: "3px 4px 0", cursor: touch ? "pointer" : "default" });
        r.main.style.font = `500 12px/16px ${FONT_MONO}`;
        r.sub.style.display = "none";
      }
    } else {
      card.style.cssText = base + `left:${L.x}px;top:${L.y}px;width:${L.w}px;height:auto;max-height:calc(100% - ${32 + ctx.stage.insetBottom}px);overflow:auto;padding:14px 14px 6px;border-radius:14px;font:400 12.5px/17px ${FONT_UI};`;
      Object.assign(head.style, { display: "block", height: "", marginBottom: "10px" });
      Object.assign(codeEl.style, { font: `500 20px/26px ${FONT_MONO}` });
      Object.assign(list.style, { display: "block" });
      for (const r of rows.values()) {
        Object.assign(r.el.style, { height: "", padding: "8px 4px 9px", cursor: touch ? "pointer" : "default" });
        r.main.style.font = `500 13px/18px ${FONT_MONO}`;
        r.sub.style.display = "";
      }
    }
    paintCard();
    map.setInsets(L.insets);
  };

  const paintCard = () => {
    codeEl.textContent = crs.epsg;
    nameEl.textContent = crs.name;
    for (const [p, r] of rows) {
      const v = partValue(p, crs);
      r.main.textContent = v.main;
      r.sub.textContent = v.sub || "";
      r.sub.style.display = L.compact || !v.sub ? "none" : "";
      r.el.setAttribute("aria-label", `${PART_LABEL[p]}: ${v.main}${v.sub ? ", " + v.sub : ""}`);
    }
  };

  const gridFor = (c) => {
    let g = grids.get(c.code);
    if (!g) { g = buildGrid(c); grids.set(c.code, g); }
    return g;
  };

  const ok = (q) => q && isFinite(q[0]) && isFinite(q[1]);

  const buildPaths = (projection, full) => {
    const world = area.type === "Sphere";
    return {
      area: world ? null : geoTools.path2D(projection, area),
      shade: world ? null : geoTools.path2D(projection, { type: "GeometryCollection", geometries: [{ type: "Sphere" }, area] }),
      grid: geoTools.path2D(projection, grid.multi),
      borders: full && borders ? geoTools.path2D(projection, borders) : null,
      lakes: full && lakes ? geoTools.path2D(projection, lakes) : null,
    };
  };

  const geometry = (projection) => {
    const key = map.stateKey() + "|" + crs.code;
    if (cache && cache.key === key) return cache;
    if (map.morph) {
      cache = { key, paths: buildPaths(projection, false), labels: null };
      return cache;
    }
    const s = projection.scale(), t = projection.translate();
    const base = map.baseKey() + "|" + crs.code + "|" + !!borders + !!lakes;
    const rest = !map.interacting && !map.inertia;
    let m = null;
    if (ref && ref.base === base) {
      const k = s / ref.s;
      if (rest && (k > 1.5 || k < 0.67)) ref = null;
      else if (Math.abs(k - 1) > 1e-9 || t[0] !== ref.t[0] || t[1] !== ref.t[1]) m = new DOMMatrix([k, 0, 0, k, t[0] - ref.t[0] * k, t[1] - ref.t[1] * k]);
    } else ref = null;
    if (!ref) ref = { base, s, t: t.slice(), paths: buildPaths(projection, true) };
    const moved = {};
    for (const [name, p2] of Object.entries(ref.paths)) {
      if (!p2 || !m) { moved[name] = p2; continue; }
      const q = new Path2D(); q.addPath(p2, m); moved[name] = q;
    }
    cache = { key, paths: moved, labels: null };
    return cache;
  };

  const placeLabels = (projection) => {
    const g = measure;
    const W = map.width, H = map.height - ctx.stage.insetBottom;
    const x0 = L.clearLeft + 4, x1 = W - 6, y0 = L.clearTop + 12, y1 = H - 12;
    const out = [];
    const put = (text, x, y, align, color, font) => {
      g.font = font;
      const w = g.measureText(text).width;
      let left = align === "left" ? x : align === "right" ? x - w : x - w / 2;
      left = Math.max(x0, Math.min(x1 - w, left));
      const top = Math.max(y0, Math.min(y1, y));
      const box = [left - 3, top - 9, left + w + 3, top + 9];
      if (out.some((o) => box[0] < o.box[2] && box[2] > o.box[0] && box[1] < o.box[3] && box[3] > o.box[1])) return;
      out.push({ text, x: left, y: top, color, font, box });
    };
    const fontNum = `500 11px ${FONT_MONO}`;
    for (const lab of grid.labels) {
      const pts = lab.line.inside.map((p) => projection(p)).filter(ok).filter((q) => q[0] >= x0 && q[0] <= x1 && q[1] >= y0 - 8 && q[1] <= y1 + 8);
      if (!pts.length) continue;
      if (lab.axis === 0) {
        const q = pts.reduce((p, r) => (r[1] > p[1] ? r : p));
        put(lab.text, q[0], q[1] + 14, "center", ORANGE, fontNum);
      } else {
        const q = pts.reduce((p, r) => (r[0] < p[0] ? r : p));
        g.font = fontNum;
        const w = g.measureText(lab.text).width;
        if (q[0] - 8 - w >= x0) put(lab.text, q[0] - 8, q[1], "right", ORANGE, fontNum);
        else put(lab.text, q[0] + 6, q[1] - 9, "left", ORANGE, fontNum);
      }
    }
    if (!isWorld(crs.areaOfUse)) {
      const a = crs.areaOfUse;
      const cap = a.west <= -180 && a.east >= 180;
      const ring = cap ? areaRing(a).map((p) => projection(p)).filter(ok) : [projection([(a.west + a.east) / 2, a.north])].filter(ok);
      if (ring.length) {
        const top = ring.reduce((p, r) => (r[1] < p[1] ? r : p));
        const font = `500 16px ${SERIF}`;
        if (top[1] - 12 >= y0) put("area of use", top[0], top[1] - 12, "center", BLUE, font);
        else put("area of use", top[0], top[1] + 16, "center", BLUE, font);
      }
    }
    return out;
  };

  const lakesLayer = (g, path, projection) => {
    if (!grid || map.morph) return;
    const p = geometry(projection).paths.lakes;
    if (p) { g.fillStyle = ctx.palette.lake; g.fill(p); }
  };

  const bordersLayer = (g, path, projection) => {
    if (!grid || map.morph) return;
    const p = geometry(projection).paths.borders;
    if (p) { g.strokeStyle = ctx.palette.lines.border; g.lineWidth = 0.5; g.lineJoin = "round"; g.stroke(p); }
  };

  const drawLayer = (g, path, projection) => {
    if (!grid) return;
    const c = geometry(projection).paths;
    if (c.shade) { g.fillStyle = "rgba(250,248,243,.6)"; g.fill(c.shade, "evenodd"); }
    g.save();
    if (c.area) g.clip(c.area);
    g.strokeStyle = "rgba(184,82,23,.75)"; g.lineWidth = 1.1; g.lineCap = "butt";
    g.stroke(c.grid);
    g.restore();
    if (c.area) {
      g.lineJoin = "round";
      g.strokeStyle = HALO; g.lineWidth = 4; g.stroke(c.area);
      g.strokeStyle = BLUE; g.lineWidth = 1.8; g.stroke(c.area);
    }
  };

  const labelLayer = (g, path, projection) => {
    if (!grid || map.morph) return;
    const c = geometry(projection);
    if (!c.labels) c.labels = placeLabels(projection);
    g.textBaseline = "middle"; g.textAlign = "left"; g.lineJoin = "round";
    for (const l of c.labels) {
      g.font = l.font;
      g.lineWidth = 4; g.strokeStyle = HALO; g.strokeText(l.text, l.x, l.y);
      g.fillStyle = l.color; g.fillText(l.text, l.x, l.y);
    }
  };

  const showCode = async (animate) => {
    const code = params.code;
    if (code === shownCode) return;
    shownCode = code;
    crs = data.crs[code] || data.crs["32633"];
    grid = gridFor(crs);
    area = areaGeometry(crs.areaOfUse);
    cache = ref = null;
    if (chipPart) hideChip();
    paintCard();
    map.setFitTarget(fitGeometry(crs.areaOfUse));
    const p = projectionFor(code);
    p.precision(0.3);
    await map.setProjection(p, { duration: animate && !ctx.reducedMotion && !map.morph ? GLIDE_MS : 0, tag: "epsg" + code });
    map.invalidate();
  };

  map.setLayer("graticule", false);
  map.setLayer("lakes", false);
  map.addLayer(PREFIX + "lakes", lakesLayer, { order: 20 });
  map.addLayer(PREFIX + "borders", bordersLayer, { order: 35 });
  map.addLayer(PREFIX + "grid", drawLayer, { order: 48 });
  loadMesh("countries-50m.json", "countries", (a, b) => a !== b).then((b) => { if (ctx.signal.aborted) return; borders = b; cache = ref = null; map.invalidate(); }).catch(() => {});
  loadGeoJSON("ne_50m_lakes.geojson").then((l) => { if (ctx.signal.aborted) return; lakes = { type: "FeatureCollection", features: l.features.filter((f) => f.properties.scalerank <= 7) }; cache = ref = null; map.invalidate(); }).catch(() => {});
  map.addLayer(PREFIX + "labels", labelLayer, { order: 70, clip: false });
  layout();
  await showCode(false);
  if (document.fonts && document.fonts.load) document.fonts.load(`500 16px "Newsreader"`).then(() => { if (!ctx.signal.aborted) { cache = null; map.invalidate(); } }).catch(() => {});

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("code")) showCode(keys.length === 1);
      else map.invalidate();
    },
    hover(lon, lat) {
      const v = crsCoords(crs, lon, lat);
      if (crs.kind === "geographic") return [];
      return [`${crs.axes[0].abbrev} ${fmtCoord(v.x, v.unit)}   ${crs.axes[1].abbrev} ${fmtCoord(v.y, v.unit)}`];
    },
    resize() { cache = ref = null; layout(); },
    unmount() {
      if (chipPart) ctx.overlay.hideChip();
      map.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
      map.setFitTarget(null);
      map.setLayer("lakes", true);
      map.setLayer("graticule", true);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
