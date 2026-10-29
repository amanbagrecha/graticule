import { registry, factors } from "@/core/projections.js";
import { geo, dom, smallCircle, onVisibleSide, drawIndicatrices, indicatrixGrid, FONT_MONO } from "@/core/map2d.js";

const KEEP = [
  { value: "area", label: "Area", why: "Equal-area maps keep the size of every region." },
  { value: "angle", label: "Angles", why: "Conformal maps keep local angles and shapes." },
  { value: "distance", label: "Distance", why: "Equidistant maps keep distance from one point or along some lines." },
  { value: "compromise", label: "Compromise", why: "Compromise maps keep nothing exactly but nothing is very wrong." },
];
const WHERE = [
  { value: "world", label: "World" },
  { value: "hemisphere", label: "Hemisphere" },
  { value: "mid-latitude band", label: "Mid-latitude band" },
  { value: "polar", label: "Polar" },
  { value: "local strip", label: "Local strip" },
  { value: "one point", label: "One point" },
];

export const meta = {
  id: "chooser",
  title: "Which projection?",
  track: 3,
  order: 4,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "equalEarth",
  labels: false,
  paragraph: "Choose a projection for a job. First decide what must stay true: area, angles, or distance from a point. Then decide where the map must be good. The flow gives one answer. Change a choice and see the map change.",
  deeper: [
    "Area + world → Equal Earth.",
    "Angle + local strip → transverse Mercator (UTM).",
    "Distance from one point → azimuthal equidistant.",
    "Angle + polar → polar stereographic.",
  ],
  keywords: ["choose", "projection", "decision", "EPSG", "Tissot"],
  controls: [
    { key: "keep", type: "select", label: "Keep true", options: KEEP.map(({ value, label }) => ({ value, label })), default: "area" },
    { key: "where", type: "select", label: "Where", options: WHERE, default: "world" },
    { key: "tissot", type: "toggle", label: "Tissot", default: true, shortcut: "t" },
    { type: "legend", label: "Key", items: [{ color: "#b85217", label: "Area where the map must be good" }, { color: "#1d63a8", label: "Tissot ellipse, filled when not conformal" }] },
  ],
  readouts: [
    { key: "rec", label: "Recommended", mono: false, hero: true },
    { key: "epsg", label: "EPSG example" },
    { key: "maxOmega", label: "Max ω in the area", digits: 1, unit: "°" },
    { key: "areaRange", label: "Area scale range" },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["chooser.json"],
};

const PREFIX = meta.id + ":";
export const FOCUS = [10, 52];
export const STRIP_LON = 15;

const VIEW = {
  hemisphere: { lon0: FOCUS[0], lat0: FOCUS[1] },
  "one point": { lon0: FOCUS[0], lat0: FOCUS[1] },
  polar: { lat0: 90, lon0: 0, clipAngle: 60 },
  "local strip": { lon0: STRIP_LON, lat0: FOCUS[1] },
};
const ZOOM = { "local strip": [STRIP_LON, 40, 2], "one point": [FOCUS[0], FOCUS[1], 1.8] };
const BAND = { albers: { lon0: -96, parallels: [29.5, 45.5] }, lcc: { lon0: 10, parallels: [35, 65] }, eqdc: { lon0: -96, parallels: [33, 45] } };

export function choose(table, keep, where) {
  return table.table[keep] && table.table[keep][where] ? table.table[keep][where] : null;
}

export function viewOptions(projectionId, where) {
  const e = registry.get(projectionId);
  if (!e) return {};
  if (where === "mid-latitude band" && BAND[projectionId]) return { ...BAND[projectionId] };
  if (projectionId === "polarNorth3413" || projectionId === "easeNorth") return {};
  if (where === "local strip" && (projectionId === "transverseMercator" || e.family === "cylindrical")) return { lon0: STRIP_LON };
  const v = VIEW[where];
  if (!v) return {};
  if (e.family === "azimuthal") return { ...v };
  return { lon0: v.lon0 };
}

export function inRegion(where, lon, lat) {
  switch (where) {
    case "world": return Math.abs(lat) <= 80;
    case "hemisphere": return geo.distance([lon, lat], FOCUS) <= Math.PI / 2;
    case "mid-latitude band": return lat >= 25 && lat <= 65;
    case "polar": return lat >= 60;
    case "local strip": return Math.abs(lon - STRIP_LON) <= 3 && lat >= 0 && lat <= 84;
    case "one point": return geo.distance([lon, lat], FOCUS) <= 15 * Math.PI / 180;
    default: return true;
  }
}

const small = (ring) => {
  const poly = { type: "Polygon", coordinates: [ring] };
  return geo.area(poly) > 2 * Math.PI ? { type: "Polygon", coordinates: [ring.slice().reverse()] } : poly;
};

export function regionShape(where) {
  switch (where) {
    case "hemisphere": return small(smallCircle(FOCUS[0], FOCUS[1], 90, 180));
    case "one point": return small(smallCircle(FOCUS[0], FOCUS[1], 15, 120));
    case "polar": return small(smallCircle(0, 90, 30, 180));
    case "mid-latitude band": {
      const ring = [];
      for (let lat = 25; lat <= 65; lat += 2.5) ring.push([-180, lat]);
      for (let lon = -180; lon <= 180; lon += 2) ring.push([lon, 65]);
      for (let lat = 65; lat >= 25; lat -= 2.5) ring.push([180, lat]);
      for (let lon = 180; lon >= -180; lon -= 2) ring.push([lon, 25]);
      return small(ring);
    }
    case "local strip": {
      const ring = [];
      for (let lat = 0; lat <= 84; lat += 2) ring.push([STRIP_LON - 3, lat]);
      for (let lat = 84; lat >= 0; lat -= 2) ring.push([STRIP_LON + 3, lat]);
      ring.push(ring[0]);
      return small(ring);
    }
    default: return null;
  }
}

export function evaluate(projection, where) {
  const fine = where === "one point" || where === "local strip";
  const step = fine ? 0.5 : 2;
  let maxOmega = 0, lo = Infinity, hi = -Infinity, n = 0;
  for (let lat = -89; lat <= 89; lat += step) for (let lon = -180 + step / 2; lon < 180; lon += step) {
    if (!inRegion(where, lon, lat) || !onVisibleSide(projection, lon, lat, 0.5)) continue;
    const f = factors(projection, lon, lat);
    if (!f || !isFinite(f.omega) || !isFinite(f.areaScale)) continue;
    n++;
    if (f.omega > maxOmega) maxOmega = f.omega;
    if (f.areaScale < lo) lo = f.areaScale;
    if (f.areaScale > hi) hi = f.areaScale;
  }
  return { maxOmega, areaMin: lo, areaMax: hi, n };
}

const fmtScale = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export async function mount(ctx) {
  const map = ctx.stage.map;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  const table = ctx.data.get("chooser.json") || (await ctx.data.load("chooser.json"));
  let params = { ...ctx.params };
  let result = null;
  let stats = null;
  let token = 0;
  let enter = 1, enterTween = null;
  let linkTween = null;
  let linkPts = null;

  const chipStyle = (on) => ({
    font: "500 12px/16px var(--font-ui)", padding: "5px 10px", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${on ? brass : "var(--line-2)"}`, background: on ? "var(--brass-soft)" : "rgba(255,255,255,.9)", color: on ? brass : "var(--ink-2)",
    transition: "background 240ms, color 240ms, border-color 240ms",
  });
  const rowLabel = (n, text) => dom("div", { style: { margin: "0 0 6px 0" } }, dom("span", { style: { display: "inline-block", position: "relative", zIndex: "1", padding: "0 6px 0 2px", background: "rgb(250,248,243)", font: `600 10px/12px ${FONT_MONO}`, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--ink-3)" } }, `${n} · ${text}`));

  const panel = ctx.stage.element("div", "chooser-flow");
  Object.assign(panel.style, { pointerEvents: "none" });
  const box = dom("div", { style: { position: "absolute", left: "20px", right: "20px", top: "14px", padding: "12px 14px 12px", background: "rgba(250,248,243,.86)", border: "1px solid var(--line)", borderRadius: "10px", pointerEvents: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.25)" } });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  Object.assign(svg.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" });
  const link = document.createElementNS("http://www.w3.org/2000/svg", "path");
  link.setAttribute("fill", "none"); link.setAttribute("stroke", brass); link.setAttribute("stroke-width", "1.5"); link.setAttribute("stroke-linecap", "round"); link.setAttribute("opacity", ".85");
  svg.append(link);
  const keepRow = dom("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } });
  const whereRow = dom("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } });
  const resName = dom("span", { style: { font: "600 15px/20px var(--font-ui)", color: "var(--ink)" } });
  const resEpsg = dom("span", { style: { font: `500 11px/16px ${FONT_MONO}`, color: brass, border: "1px solid rgba(184,82,23,.45)", borderRadius: "6px", padding: "1px 6px" } });
  const resWhy = dom("div", { style: { font: "400 12.5px/17px var(--font-ui)", color: "var(--ink-2)", marginTop: "2px" } });
  const resBox = dom("div", { style: { display: "flex", flexDirection: "column", padding: "8px 10px", border: `1px solid ${brass}`, borderRadius: "8px", background: "rgba(184,82,23,.08)" } },
    dom("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, resName, resEpsg), resWhy);
  box.append(svg,
    dom("div", { style: { position: "relative" } }, rowLabel(1, "What must stay true?"), keepRow),
    dom("div", { style: { position: "relative", marginTop: "14px" } }, rowLabel(2, "Where must the map be good?"), whereRow),
    dom("div", { style: { marginTop: "14px", position: "relative" } }, rowLabel(3, "Use this map"), resBox));
  panel.append(box);
  for (const t of ["pointerdown", "pointerup", "pointermove", "dblclick", "wheel"]) box.addEventListener(t, (e) => e.stopPropagation(), { signal: ctx.signal });
  box.addEventListener("pointerleave", () => ctx.overlay.hideChip(), { signal: ctx.signal });

  const chips = { keep: new Map(), where: new Map() };
  const tip = (e, lines) => {
    const r = ctx.stage.el.getBoundingClientRect();
    ctx.overlay.chip(e.clientX - r.left, e.clientY - r.top, lines);
  };
  for (const k of KEEP) {
    const b = dom("button", { type: "button", text: k.label, onclick: () => ctx.controls.set("keep", k.value), onpointermove: (e) => tip(e, [k.why]) });
    chips.keep.set(k.value, b);
    keepRow.append(b);
  }
  for (const w of WHERE) {
    const b = dom("button", { type: "button", text: w.label, onclick: () => ctx.controls.set("where", w.value), onpointermove: (e) => { const r = choose(table, params.keep, w.value); tip(e, r ? [`${r.name}: ${r.reason}`] : []); } });
    chips.where.set(w.value, b);
    whereRow.append(b);
  }

  const anchors = () => {
    const br = box.getBoundingClientRect();
    const a = chips.keep.get(params.keep).getBoundingClientRect();
    const b = chips.where.get(params.where).getBoundingClientRect();
    const c = resBox.getBoundingClientRect();
    return [[a.left + a.width / 2 - br.left, a.bottom - br.top], [b.left + b.width / 2 - br.left, b.top - br.top], [b.left + b.width / 2 - br.left, b.bottom - br.top], [c.left + 24 - br.left, c.top - br.top]];
  };
  const drawLink = (pts) => {
    const [a, b0, b1, c] = pts;
    const r = 6;
    const elbow = (p, q) => {
      const my = (p[1] + q[1]) / 2;
      const dx = q[0] - p[0];
      if (Math.abs(dx) < 2 * r) return `M${p[0]},${p[1]} L${p[0]},${my} L${q[0]},${my} L${q[0]},${q[1]}`;
      const sx = Math.sign(dx);
      return `M${p[0]},${p[1]} L${p[0]},${my - r} Q${p[0]},${my} ${p[0] + sx * r},${my} L${q[0] - sx * r},${my} Q${q[0]},${my} ${q[0]},${my + r} L${q[0]},${q[1]}`;
    };
    link.setAttribute("d", `${elbow(a, b0)} ${elbow(b1, c)}`);
  };
  const paintFlow = (animate) => {
    for (const [v, b] of chips.keep) { const s = chipStyle(v === params.keep); for (const k in s) b.style[k] = s[k]; }
    for (const [v, b] of chips.where) { const s = chipStyle(v === params.where); for (const k in s) b.style[k] = s[k]; }
    const to = anchors();
    if (linkTween) linkTween.cancel();
    if (!animate || !linkPts || ctx.reducedMotion) { linkPts = to; drawLink(to); return; }
    const from = linkPts.map((p) => p.slice());
    linkTween = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (u) => { linkPts = from.map((p, i) => [p[0] + (to[i][0] - p[0]) * u, p[1] + (to[i][1] - p[1]) * u]); drawLink(linkPts); } });
  };

  const insetTop = () => box.getBoundingClientRect().height + 14 + 10;

  const readouts = () => {
    if (!result) return;
    ctx.readout.setMany({
      rec: result.name,
      epsg: result.epsg || "none",
      maxOmega: stats ? stats.maxOmega : NaN,
      areaRange: stats && isFinite(stats.areaMin) ? `${fmtScale(stats.areaMin)}–${fmtScale(stats.areaMax)}` : "–",
    });
  };

  const runEnter = () => {
    if (enterTween) enterTween.cancel();
    if (ctx.reducedMotion) { enter = 1; return; }
    enter = 0;
    enterTween = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.out, onUpdate: (v) => { enter = v; map.invalidate(); } });
  };

  const apply = async (animate) => {
    const my = ++token;
    result = choose(table, params.keep, params.where);
    if (!result) return;
    resName.textContent = result.name;
    resEpsg.textContent = result.epsg || "no EPSG code";
    resWhy.textContent = result.reason;
    paintFlow(animate);
    readouts();
    map.setInsets({ top: insetTop(), bottom: ctx.stage.insetBottom });
    await map.setProjection(result.projection, { duration: animate ? 900 : (map.projectionId === result.projection ? 0 : 700), opts: viewOptions(result.projection, params.where), tag: params.where });
    if (my !== token) return;
    const zoom = ZOOM[params.where];
    if (zoom) await map.lookAt(zoom[0], zoom[1], zoom[2], { duration: animate && !ctx.reducedMotion ? 650 : 0 });
    if (my !== token) return;
    stats = evaluate(map.projection, params.where);
    readouts();
    runEnter();
    map.invalidate();
  };

  const regionLayer = (g, path) => {
    const shape = regionShape(params.where);
    if (!shape) return;
    g.beginPath();
    path(shape);
    g.fillStyle = "rgba(184,82,23,.16)";
    g.fill();
    g.strokeStyle = "rgba(250,248,243,.5)"; g.lineWidth = 3; g.stroke();
    g.setLineDash([6, 4]); g.strokeStyle = brass; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
  };

  const tissotLayer = (g, path, projection) => {
    if (!params.tissot) return;
    drawIndicatrices(g, projection, { points: indicatrixGrid(15, 75), radius: 2.5, color: signal, scale: (lon, lat) => (map.morph ? 1 : ctx.anim.ease.out(Math.max(0, Math.min(1, (enter - Math.abs(lat) / 75 * 0.4) / 0.6)))) });
  };

  map.addLayer(PREFIX + "veil", (g) => { g.fillStyle = "rgba(250,248,243,.25)"; g.fillRect(0, 0, map.width, map.height); }, { order: 46 });
  map.addLayer(PREFIX + "region", regionLayer, { order: 48 });
  map.addLayer(PREFIX + "tissot", tissotLayer, { order: 52 });
  await apply(false);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.some((k) => k === "keep" || k === "where")) apply(true);
      else paintFlow(false);
      map.invalidate();
    },
    hover(lon, lat) {
      const f = factors(map.projection, lon, lat);
      if (!f) return [];
      return [`ω = ${f.omega.toFixed(1)}°   area = ${f.areaScale.toFixed(3)}`, inRegion(params.where, lon, lat) ? "inside the area" : "outside the area"];
    },
    probe() { return null; },
    unprobe() {},
    resize() {
      paintFlow(false);
      map.setInsets({ top: insetTop(), bottom: ctx.stage.insetBottom });
      map.invalidate();
    },
    unmount() {
      if (enterTween) enterTween.cancel();
      if (linkTween) linkTween.cancel();
      ctx.overlay.hideChip();
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0 });
      panel.remove();
    },
  };
}
