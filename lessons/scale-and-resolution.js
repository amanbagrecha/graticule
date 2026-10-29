import { resolution, scaleDenominator, MAX_LAT } from "@/core/tiles.js";
import { degreeLengths, inverse, geodesicPoints } from "@/core/geodesy.js";
import { drawCaption, FONT_MONO, FONT_UI } from "@/core/map2d.js";
import { clamp, DEG } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const HALO = "rgba(250,248,243,.9)";

export const meta = {
  id: "scale-and-resolution",
  title: "Pixels get smaller with latitude",
  track: 6,
  order: 12,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "webMercator",
  labels: false,
  paragraph: "On a web map a pixel covers less ground as you move north. At zoom 0 one pixel is 156 km at the equator and half that at 60°. The scale bar is only true where it is drawn. Map scale is a ratio of distances; resolution is ground per pixel. They are not the same thing.",
  deeper: [
    "m/px = 156,543.03 · cos φ / 2^z.",
    "Zoom 12 at the equator = 38.22 m/px; at 45° = 27.02 m/px.",
    "OGC scale denominator at zoom 0 = 559,082,264.",
    "A scale of 1:50,000 means 1 cm = 500 m.",
  ],
  keywords: ["resolution", "scale", "metres per pixel", "zoom", "scale denominator", "OGC", "scale bar", "Web Mercator", "ground sample distance"],
  controls: [
    { key: "z", type: "range", label: "Zoom z", min: 0, max: 18, step: 1, default: 12, ticks: [0, 6, 12, 18] },
    { key: "lat", type: "range", label: "Latitude", min: 0, max: 85, step: 0.1, default: 45, unit: "°", fillFrom: 0, ticks: [0, 30, 60, 85] },
    { key: "dpi", type: "segment", label: "Screen pixel", options: [{ value: "96", label: "96 dpi" }, { value: "ogc", label: "0.28 mm (OGC)" }], default: "ogc" },
    { key: "ruler", type: "button", label: "Ruler", icon: "i-plus" },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "A 1″ pixel as the map draws it (drag it)" },
      { color: SIGNAL, label: "The same pixel on the ground" },
      { color: INK2, line: true, label: "Scale bars, each true on its own line" },
      { color: VIOLET, line: true, label: "Ruler, the ground distance" },
    ] },
  ],
  readouts: [
    { key: "resEq", label: "m/px at the equator", digits: 2, unit: "m/px" },
    { key: "resLat", label: "m/px at latitude", digits: 2, unit: "m/px", hero: true },
    { key: "scale", label: "Scale denominator", digits: 0 },
    { key: "ruler", label: "Ruler length", digits: 0, unit: "km" },
    { key: "arcsec", label: "1″ pixel on the ground", mono: true },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
const INSET_TOP = 66;
const BOX_DEG = 26;
const ARCSEC = 1 / 3600;
const FIT_TARGET = { type: "MultiPoint", coordinates: [[-179.9, -58], [179.9, -58], [-179.9, 85], [179.9, 85]] };
const RULER_DEFAULT = [[-74.006, 40.7128], [-0.1276, 51.5072]];
const COMPACT_W = 640;
const PANES = { chart: "Chart", ground: "Ground" };

export const PIXEL_SIZE = { ogc: 0.00028, 96: 0.0254 / 96 };

export function metresPerPixel(z, lat) {
  return resolution(z, lat);
}

export function scaleAt(z, lat, dpi = "ogc") {
  return scaleDenominator(z, lat, PIXEL_SIZE[dpi] ?? PIXEL_SIZE.ogc);
}

export function cmOnGround(z, lat, dpi = "ogc") {
  return scaleAt(z, lat, dpi) * 0.01;
}

export function pixelGround(lat, sizeDeg = ARCSEC) {
  const d = degreeLengths(lat);
  return { ew: Math.max(0, d.lon) * sizeDeg, ns: d.lat * sizeDeg };
}

export function mapStretch(lat) {
  return 1 / Math.cos(lat * DEG);
}

export function rulerKm(a, b) {
  return inverse(a[0], a[1], b[0], b[1]).s12 / 1000;
}

export function niceLength(maxM) {
  if (!(maxM > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(maxM));
  const f = maxM / p;
  return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
}

const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toLocaleString("en-US", { maximumFractionDigits: m >= 1e5 ? 0 : 1 })} km` : m >= 10 ? `${m.toFixed(0)} m` : m >= 1 ? `${m.toFixed(1)} m` : `${(m * 100).toFixed(0)} cm`);
const fmtM = (m) => (m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2));
const fmtLat = (v) => `${v.toFixed(1)}° ${v > 0.04 ? "N" : ""}`.trim();
const fmtRes = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km/px` : `${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 })} m/px`);

export function arcsecText(lat) {
  const g = pixelGround(lat);
  return `${g.ew.toFixed(1)} m E–W × ${g.ns.toFixed(1)} m N–S`;
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  let params = { ...ctx.params };
  let shownLat = params.lat, shownZ = params.z;
  const compact = () => ctx.stage.width < COMPACT_W;
  let boxLon = 62;
  let ruler = null;
  let latTween = null, zTween = null, rulerTween = null, rulerU = 0;
  let dragging = null;
  let booted = false;
  let pane = Object.hasOwn(PANES, ctx.url.get("pane") || "") ? ctx.url.get("pane") : "chart";

  const panelH = () => (compact() ? Math.round(clamp(ctx.stage.height * 0.37, 150, 168)) : ctx.stage.height < 700 ? 164 : ctx.stage.height > 1100 ? 214 : 184);
  const panelW = () => Math.min(ctx.stage.width - (compact() ? 20 : 32), 1000);
  const panelGap = () => (compact() ? 10 : 16);
  const capX = () => (compact() ? 12 : 18), capY = () => (compact() ? 10 : 14);
  const capOpts = () => ({ accent: BRASS, maxWidth: compact() ? ctx.stage.width - 24 : Math.max(240, ctx.stage.width - 80) });
  const measure = document.createElement("canvas");
  const capRect = () => {
    measure.width = Math.max(1, Math.round(ctx.stage.width)); measure.height = 1;
    const r = drawCaption(measure.getContext("2d"), capX(), capY(), caption(), capOpts());
    return { x0: capX(), y0: capY(), x1: capX() + r.w, y1: capY() + r.h };
  };
  const layout = () => {
    const c = compact();
    map.setFitTarget(FIT_TARGET);
    map.setInsets({ top: c ? capRect().y1 - 18 : INSET_TOP, bottom: ctx.stage.insetBottom + panelH() + (c ? 6 : 18), left: 14, right: 14 });
  };

  const frameInfo = (P) => {
    const a = P([-180, 0]), b = P([180, 0]), t = P([0, MAX_LAT]), s = P([0, -MAX_LAT]);
    if (!a || !b || !t || !s) return null;
    const pxPerDeg = (b[0] - a[0]) / 360;
    return { left: a[0], right: b[0], top: t[1], bottom: s[1], yEq: a[1], pxPerDeg, pxPerM: pxPerDeg / degreeLengths(0).lon };
  };

  const boxGeom = (P) => {
    const f = frameInfo(P);
    if (!f) return null;
    const c = P([boxLon, shownLat]);
    if (!c) return null;
    const W = BOX_DEG * f.pxPerDeg;
    const d0 = degreeLengths(0).lon, d = degreeLengths(shownLat);
    return { cx: c[0], cy: c[1], mapW: W, mapH: W * mapStretch(shownLat), gW: (W * d.lon) / d0, gH: (W * d.lat) / d0, f };
  };

  const LINE_FONT = `500 11px ${FONT_MONO}`;
  const cardSize = (g, lines) => {
    let w = 0;
    for (const [s, , font] of lines) { g.font = font || LINE_FONT; w = Math.max(w, g.measureText(s).width); }
    return { W: w + 14, H: lines.length * 16 + 10 };
  };
  const hits = (a, b) => !!(a && b) && a[0] < b[2] + 4 && a[2] + 4 > b[0] && a[1] < b[3] + 4 && a[3] + 4 > b[1];
  const card = (g, x, y, lines, { align = "left", valign = "middle" } = {}) => {
    const lh = 16, pad = 7;
    const { W, H } = cardSize(g, lines);
    const x0 = align === "right" ? x - W : align === "center" ? x - W / 2 : x;
    const y0 = valign === "middle" ? y - H / 2 : valign === "bottom" ? y - H : y;
    g.fillStyle = "rgba(250,248,243,.86)"; g.strokeStyle = "rgba(227,222,211,.95)"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x0 + 0.5, y0 + 0.5, W, H, 6); g.fill(); g.stroke();
    g.textAlign = "left"; g.textBaseline = "middle";
    lines.forEach(([s, colour, font], i) => { g.font = font || LINE_FONT; g.fillStyle = colour; g.fillText(s, x0 + pad, y0 + pad + 6 + i * lh); });
    return { x: x0, y: y0, w: W, h: H };
  };

  const boxLayer = (g, path, P) => {
    const b = boxGeom(P);
    if (!b) return;
    const { cx, cy, mapW, mapH, gW, gH, f } = b;
    g.save();
    g.beginPath(); g.rect(f.left, f.top, f.right - f.left, f.bottom - f.top); g.clip();
    g.strokeStyle = "rgba(184,82,23,.35)"; g.lineWidth = 1; g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(f.left, cy); g.lineTo(f.right, cy); g.stroke(); g.setLineDash([]);
    g.fillStyle = "rgba(29,99,168,.30)";
    g.fillRect(cx - gW / 2, cy - gH / 2, gW, gH);
    g.strokeStyle = SIGNAL; g.lineWidth = 1.6;
    g.strokeRect(cx - gW / 2, cy - gH / 2, gW, gH);
    g.fillStyle = dragging === "box" ? "rgba(184,82,23,.16)" : "rgba(184,82,23,.07)";
    g.fillRect(cx - mapW / 2, cy - mapH / 2, mapW, mapH);
    g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 4.5; g.strokeRect(cx - mapW / 2, cy - mapH / 2, mapW, mapH);
    g.strokeStyle = BRASS; g.lineWidth = dragging === "box" ? 2.6 : 2; g.strokeRect(cx - mapW / 2, cy - mapH / 2, mapW, mapH);
    g.fillStyle = BRASS; g.beginPath(); g.arc(cx, cy, 2.5, 0, 2 * Math.PI); g.fill();
    g.restore();
    if (compact()) return;
    const gr = pixelGround(shownLat);
    const lx = cx + Math.max(mapW, gW) / 2 + 12;
    const fits = lx + 230 <= ctx.stage.width - 8;
    const x = fits ? lx : cx;
    const cap = capRect();
    const ly0 = fits ? clamp(cy, f.top + 30, f.bottom - 30) : Math.min(cy + Math.max(mapH, gH) / 2 + 10, f.bottom - 60);
    const ly = fits && x < cap.x1 + 4 ? Math.max(ly0, cap.y1 + 6 + 29) : ly0;
    const align = fits ? "left" : "center";
    card(g, x, ly, [
      [`1″ pixel at ${fmtLat(shownLat)}`, INK, `600 12px ${FONT_UI}`],
      [`ground ${gr.ew.toFixed(1)} × ${gr.ns.toFixed(1)} m`, SIGNAL],
      [`map: ${mapStretch(shownLat).toFixed(2)}× taller than wide`, BRASS],
    ], { align, valign: fits ? "middle" : "top" });
  };

  const bar = (g, x, y, len, label, colour, side = "above") => {
    g.strokeStyle = HALO; g.lineWidth = 5; g.lineCap = "butt";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
    g.fillStyle = HALO; g.fillRect(x - 2, y - 7, len + 4, 9);
    g.fillStyle = colour; g.fillRect(x, y - 5, len / 2, 5);
    g.strokeStyle = colour; g.lineWidth = 1; g.strokeRect(x + 0.5, y - 4.5, len - 1, 5);
    g.beginPath(); g.moveTo(x + 0.5, y - 9); g.lineTo(x + 0.5, y + 1); g.moveTo(x + len - 0.5, y - 9); g.lineTo(x + len - 0.5, y + 1); g.stroke();
    if (side) card(g, x - 2, side === "below" ? y + 6 : y - 12, [[label, colour]], { valign: side === "below" ? "top" : "bottom" });
  };

  const barLayer = (g, path, P) => {
    const f = frameInfo(P);
    if (!f) return;
    const mapW = f.right - f.left;
    const k = mapStretch(shownLat);
    const lenM = niceLength(Math.min(0.22 * mapW / f.pxPerM, (0.42 * mapW) / (f.pxPerM * k)));
    if (!lenM) return;
    const x = Math.max(f.left, 0) + 12;
    const eqPx = lenM * f.pxPerM, latPx = eqPx * k;
    const yLat = P([0, shownLat])[1];
    const close = Math.abs(yLat - f.yEq) < 52;
    const on = shownLat > 0.04;
    const eqSide = compact() && on && f.yEq - yLat >= 16 ? "below" : "above";
    const yEq = eqSide === "below" ? f.yEq : f.yEq + (close ? 44 : 0);
    const eqLabel = `${fmtLen(lenM)} on the equator`;
    bar(g, x, yEq, eqPx, eqLabel, INK2, eqSide);
    if (!on) return;
    const label = `${fmtLen(lenM)} at ${fmtLat(shownLat)}`;
    const labelRect = (y, text, side) => {
      const { W, H } = cardSize(g, [[text]]);
      const top = side === "below" ? y + 6 : y - 12 - H;
      return [x - 2, top, x - 2 + W, top + H];
    };
    const cap = capRect(), rc = rulerCard(g, P);
    const taken = [[cap.x0, cap.y0, cap.x1, cap.y1], labelRect(yEq, eqLabel, eqSide), [x - 2, yEq - 9, x + eqPx + 2, yEq + 2], rc && rc.rect];
    const side = ["above", "below"].find((sd) => !taken.some((t) => hits(labelRect(yLat, label, sd), t)));
    bar(g, x, yLat, latPx, label, INK, side || null);
  };

  const southMask = (g, path, P) => {
    const a = P([0, -58]);
    if (!a) return;
    const y0 = a[1] + 4, y1 = y0 + (compact() ? 14 : 28);
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, "rgba(250,248,243,0)");
    grad.addColorStop(1, "rgba(250,248,243,1)");
    g.fillStyle = grad; g.fillRect(0, y0, map.width, y1 - y0);
    g.fillStyle = "rgb(250,248,243)"; g.fillRect(0, y1, map.width, Math.max(0, map.height - y1));
  };

  const rulerCard = (g, P) => {
    if (!ruler || rulerU < 1) return null;
    const f = frameInfo(P);
    if (!f) return null;
    const pts = geodesicPoints(ruler[0], ruler[1], 96).map((p) => P(p)).filter(Boolean);
    if (pts.length < 2) return null;
    let px = 0;
    for (let i = 1; i < pts.length; i++) px += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const mid = pts[Math.floor(pts.length / 2)];
    const km = rulerKm(ruler[0], ruler[1]);
    const barText = `${Math.round(px / f.pxPerM / 1000).toLocaleString("en-US")} km`;
    const below = mid[1] < f.top + 60;
    const lines = [
      [`${Math.round(km).toLocaleString("en-US")} km on the ground`, VIOLET, `600 11px ${FONT_MONO}`],
      [compact() ? `equator bar: ${barText}` : `the equator bar reads ${barText}`, INK2],
    ];
    const { W, H } = cardSize(g, lines);
    const y = mid[1] + (below ? 14 : -14), top = below ? y : y - H;
    return { x: mid[0], y, below, lines, rect: [mid[0] - W / 2, top, mid[0] + W / 2, top + H] };
  };

  const rulerLayer = (g, path, P) => {
    if (!ruler || rulerU <= 0) return;
    const pts = geodesicPoints(ruler[0], ruler[1], 96).map((p) => P(p)).filter(Boolean);
    const n = Math.max(2, Math.round(pts.length * rulerU));
    const vis = pts.slice(0, n);
    g.save();
    g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); vis.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.strokeStyle = HALO; g.lineWidth = 5; g.stroke();
    g.strokeStyle = VIOLET; g.lineWidth = 2.2; g.stroke();
    g.globalAlpha = Math.min(1, rulerU * 1.4);
    for (const [i, end] of [[0, ruler[0]], [1, ruler[1]]]) {
      const p = P(end);
      if (!p) continue;
      g.fillStyle = HALO; g.beginPath(); g.arc(p[0], p[1], 8, 0, 2 * Math.PI); g.fill();
      g.fillStyle = dragging === "r" + i ? INK : VIOLET; g.beginPath(); g.arc(p[0], p[1], 5.5, 0, 2 * Math.PI); g.fill();
    }
    g.restore();
    const rc = rulerCard(g, P);
    if (rc) card(g, rc.x, rc.y, rc.lines, { align: "center", valign: rc.below ? "top" : "bottom" });
  };

  const caption = () => {
    const where = `Zoom ${params.z} at ${fmtLat(shownLat)}`;
    const scale = `scale 1 : ${Math.round(scaleAt(params.z, shownLat, params.dpi)).toLocaleString("en-US")}.`;
    const cm = `1 cm on the screen is ${fmtLen(cmOnGround(params.z, shownLat, params.dpi))} on the ground.`;
    if (!compact()) return [
      "Drag the brass pixel north. Its ground shape shrinks east to west.",
      "Each scale bar is true only on its own parallel.",
      `${where}: ${scale} ${cm}`,
    ];
    return ["Drag the brass pixel north.", "Its ground shape shrinks east to west.", `${where}: ${scale}`, ctx.stage.height >= 460 && cm];
  };

  const panel = ctx.stage.element("div", "sr-panel");
  const pTitle = document.createElement("div");
  const chart = document.createElement("canvas");
  const fTitle = document.createElement("div");
  const foot = document.createElement("canvas");
  const colA = document.createElement("div");
  const colB = document.createElement("div");
  const sw = document.createElement("div");
  colA.append(pTitle, chart);
  colB.append(fTitle, foot);
  panel.append(colA, colB, sw);
  const titleCss = `font:600 12px/16px ${FONT_UI};color:${INK};margin:0 0 6px;white-space:nowrap;`;
  pTitle.style.cssText = titleCss;
  fTitle.style.cssText = titleCss;
  colA.style.cssText = "flex:1 1 auto;min-width:0;";
  colB.style.cssText = "flex:0 0 auto;";

  sw.className = "segment";
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "Part to show");
  sw.style.cssText = "position:absolute;top:10px;right:12px;display:none;box-sizing:border-box;height:34px;padding:2px;gap:2px;pointer-events:auto;";
  sw.addEventListener("pointerdown", (e) => e.stopPropagation(), { signal: ctx.signal });
  const swBtns = Object.fromEntries(Object.entries(PANES).map(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.textContent = label;
    b.style.cssText = "flex:0 0 auto;height:28px;padding:0 12px;";
    b.addEventListener("click", () => {
      if (pane === k) return;
      pane = k;
      if (ctx.side === "A") ctx.url.set("pane", k === "chart" ? null : k);
      drawPanel();
    }, { signal: ctx.signal });
    sw.append(b);
    return [k, b];
  }));

  const sizeCanvas = (c, W, H) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    c.style.width = W + "px"; c.style.height = H + "px"; c.style.display = "block";
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    return g;
  };

  const drawChart = (W, H) => {
    const g = sizeCanvas(chart, W, H);
    const L = 8, R = W - 10, T = 22, B = H - 20;
    const X = (lat) => L + ((R - L) * lat) / 90;
    const r0 = resolution(shownZ, 0);
    const Y = (v) => B - ((B - T) * v) / r0;
    g.fillStyle = "rgba(107,102,94,.12)";
    g.fillRect(X(MAX_LAT), T - 6, X(90) - X(MAX_LAT), B - T + 6);
    g.strokeStyle = "rgba(60,52,40,.16)"; g.lineWidth = 1;
    g.beginPath();
    for (const lat of [0, 30, 60, 90]) { g.moveTo(X(lat) + 0.5, T - 6); g.lineTo(X(lat) + 0.5, B); }
    for (const v of [0.5, 1]) { g.moveTo(L, Math.round(Y(v * r0)) + 0.5); g.lineTo(R, Math.round(Y(v * r0)) + 0.5); }
    g.stroke();
    g.strokeStyle = "rgba(60,52,40,.4)";
    g.beginPath(); g.moveTo(L, B + 0.5); g.lineTo(R, B + 0.5); g.stroke();
    g.beginPath();
    for (let lat = 0; lat <= 90.001; lat += 0.5) { const x = X(lat), y = Y(resolution(shownZ, lat)); lat ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.lineTo(X(90), B); g.lineTo(X(0), B); g.closePath();
    g.fillStyle = "rgba(184,82,23,.13)"; g.fill();
    g.beginPath();
    for (let lat = 0; lat <= MAX_LAT; lat += 0.5) { const x = X(lat), y = Y(resolution(shownZ, lat)); lat ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke();
    g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textBaseline = "top";
    for (const lat of [0, 30, 60, 90]) { g.textAlign = lat === 0 ? "left" : lat === 90 ? "right" : "center"; g.fillText(`${lat}°`, X(lat), B + 5); }
    g.textAlign = "right"; g.textBaseline = "bottom";
    g.fillText("off the map", R, T - 8);
    g.textAlign = "left"; g.fillStyle = INK2;
    g.fillText(`${fmtRes(r0)} on the equator`, L + 2, T - 8);
    g.fillStyle = INK3; g.textBaseline = "middle";
    const lat = shownLat, v = resolution(shownZ, lat);
    const cx = X(lat), cy = Y(v);
    const s = fmtRes(v);
    g.font = `600 11px ${FONT_MONO}`;
    const tw = g.measureText(s).width;
    const tx = clamp(cx + 10 + tw > R ? cx - 10 - tw : cx + 10, L + 5, Math.max(L + 5, R - tw));
    const ty = clamp(cy - 12, T, B - 12);
    g.font = `500 10px ${FONT_MONO}`;
    const hw = g.measureText("half").width, hy = Y(r0 / 2) - 8;
    const free = (hx) => hx > tx + tw + 5 || hx + hw < tx - 5 || hy - 7 > ty + 9 || hy + 7 < ty - 9;
    const hx = [X(60) + 6, R - 4 - hw].find(free);
    if (hx !== undefined) g.fillText("half", hx, hy);
    g.strokeStyle = "rgba(29,99,168,.55)"; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(cx + 0.5, cy); g.lineTo(cx + 0.5, B); g.moveTo(L, cy); g.lineTo(cx, cy); g.stroke(); g.setLineDash([]);
    g.fillStyle = HALO; g.beginPath(); g.arc(cx, cy, 6.5, 0, 2 * Math.PI); g.fill();
    g.fillStyle = SIGNAL; g.beginPath(); g.arc(cx, cy, 4.5, 0, 2 * Math.PI); g.fill();
    g.font = `600 11px ${FONT_MONO}`;
    g.fillStyle = "rgba(250,248,243,.9)"; g.beginPath(); g.roundRect(tx - 5, ty - 9, tw + 10, 18, 4); g.fill();
    g.fillStyle = SIGNAL; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(s, tx, ty + 0.5);
  };

  const footItems = (cell) => {
    const k = Math.cos(shownLat * DEG);
    const d0 = degreeLengths(0).lon, d = degreeLengths(shownLat);
    const r = resolution(shownZ, shownLat), p = pixelGround(shownLat);
    return [
      { title: `Web map, z ${Math.round(shownZ)}`, w: cell * k, h: cell * k, colour: BRASS, fill: "rgba(184,82,23,.22)", text: r >= 1000 ? `${(r / 1000).toFixed(2)} × ${(r / 1000).toFixed(2)} km` : `${fmtM(r)} × ${fmtM(r)} m` },
      { title: "1″ pixel", w: (cell * d.lon) / d0, h: (cell * d.lat) / d0, colour: SIGNAL, fill: "rgba(29,99,168,.24)", text: `${p.ew.toFixed(1)} × ${p.ns.toFixed(1)} m` },
    ];
  };

  const drawCell = (g, it, cx, cell, gap) => {
    const x0 = cx - cell / 2, y0 = 18;
    g.font = `500 11px ${FONT_UI}`; g.fillStyle = INK2; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillText(it.title, cx, 11);
    g.strokeStyle = "rgba(60,52,40,.35)"; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.strokeRect(x0 + 0.5, y0 + 0.5, cell - 1, cell - 1); g.setLineDash([]);
    const cy = y0 + cell / 2;
    g.fillStyle = it.fill; g.fillRect(cx - it.w / 2, cy - it.h / 2, it.w, it.h);
    g.strokeStyle = it.colour; g.lineWidth = 1.6; g.strokeRect(cx - it.w / 2, cy - it.h / 2, it.w, it.h);
    g.font = `600 11px ${FONT_MONO}`; g.fillStyle = it.colour; g.textBaseline = "top";
    g.fillText(it.text, cx, y0 + cell + gap);
  };

  const NOTE = "Dashed: the same pixel on the equator";

  const drawFoot = (H) => {
    const cell = H - 50;
    const items = footItems(cell);
    const m = foot.getContext("2d");
    m.font = `600 11px ${FONT_MONO}`;
    const cols = items.map((it) => Math.max(cell + 32, Math.ceil(m.measureText(it.text).width) + 8));
    const W = cols[0] + cols[1];
    const g = sizeCanvas(foot, W, H);
    items.forEach((it, i) => drawCell(g, it, (i ? cols[0] : 0) + cols[i] / 2, cell, 8));
    g.font = `500 10px ${FONT_UI}`; g.fillStyle = INK3; g.textAlign = "center"; g.textBaseline = "top";
    g.fillText(NOTE, W / 2, H - 13);
    return W;
  };

  const wrapWords = (g, text, font, w) => {
    g.font = font;
    const out = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && g.measureText(next).width > w) { out.push(cur); cur = word; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };

  const drawGround = (W, H) => {
    const g = sizeCanvas(foot, W, H);
    const cell = Math.max(24, Math.min(64, H - 48));
    const items = footItems(cell);
    g.font = `600 11px ${FONT_MONO}`;
    let x = 0;
    for (const it of items) {
      const cw = Math.ceil(Math.max(cell + 16, g.measureText(it.text).width + 10));
      drawCell(g, it, x + cw / 2, cell, 6);
      x += cw;
    }
    g.font = `500 10px ${FONT_UI}`; g.fillStyle = INK3; g.textAlign = "center"; g.textBaseline = "top";
    g.fillText(NOTE, Math.max(x, g.measureText(NOTE).width) / 2, H - 12);
    const tx = x + 12, room = W - tx;
    const gr = pixelGround(shownLat);
    const lines = [];
    for (const [s, colour, font, once] of [
      [`1″ pixel at ${fmtLat(shownLat)}`, INK, `600 12px ${FONT_UI}`],
      [`ground ${gr.ew.toFixed(1)} × ${gr.ns.toFixed(1)} m`, SIGNAL, LINE_FONT, true],
      [`map: ${mapStretch(shownLat).toFixed(2)}× taller than wide`, BRASS, LINE_FONT],
    ]) {
      const ws = wrapWords(g, s, font, room);
      if (once && ws.length > 1) continue;
      for (const w of ws) lines.push([w, colour, font]);
    }
    const lh = 16, y = 18 + cell / 2 - ((lines.length - 1) * lh) / 2;
    g.textAlign = "left"; g.textBaseline = "middle";
    lines.forEach(([s, colour, font], i) => { g.font = font; g.fillStyle = colour; g.fillText(s, tx, y + i * lh); });
  };

  const drawPanel = () => {
    const c = compact();
    const PW = panelW(), PH = panelH();
    panel.style.cssText = `position:absolute;inset:auto;left:${(ctx.stage.width - PW) / 2}px;bottom:${ctx.stage.insetBottom + panelGap()}px;width:${PW}px;height:${PH}px;padding:${c ? "10px 12px" : "12px 14px"};display:${c ? "block" : "flex"};gap:22px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;box-sizing:border-box;`;
    fTitle.textContent = `On the ground at ${fmtLat(shownLat)}`;
    if (c) {
      const ground = pane === "ground";
      sw.style.display = "flex";
      for (const [k, b] of Object.entries(swBtns)) { b.classList.toggle("on", k === pane); b.setAttribute("aria-pressed", String(k === pane)); }
      colA.style.display = ground ? "none" : "";
      colB.style.display = ground ? "" : "none";
      const t = `${titleCss}line-height:34px;height:34px;margin:0 0 4px;padding-right:${sw.offsetWidth + 8}px;overflow:hidden;text-overflow:ellipsis;`;
      pTitle.style.cssText = t; fTitle.style.cssText = t;
      pTitle.textContent = `Metres per pixel, zoom ${Math.round(shownZ)}`;
      if (ground) drawGround(PW - 26, PH - 60);
      else drawChart(PW - 26, PH - 60);
      return;
    }
    sw.style.display = "none";
    colA.style.display = ""; colB.style.display = "";
    pTitle.style.cssText = titleCss; fTitle.style.cssText = titleCss;
    const H = PH - 26 - 22;
    const fw = drawFoot(H);
    pTitle.textContent = `Metres per pixel against latitude, zoom ${Math.round(shownZ)}`;
    drawChart(PW - 30 - 22 - fw, H);
  };

  const readouts = () => {
    ctx.readout.setMany({
      resEq: metresPerPixel(params.z, 0),
      resLat: metresPerPixel(params.z, shownLat),
      scale: scaleAt(params.z, shownLat, params.dpi),
      ruler: ruler ? rulerKm(ruler[0], ruler[1]) : "–",
      arcsec: arcsecText(shownLat),
    });
  };

  const redraw = () => { drawPanel(); map.invalidate(); };

  const setShownLat = (v) => { shownLat = v; redraw(); readouts(); };

  const animateLat = (to) => {
    if (latTween) latTween.cancel();
    if (!booted || ctx.reducedMotion || dragging) { setShownLat(to); return; }
    const from = shownLat;
    latTween = ctx.anim.tween({ from, to, duration: clamp(Math.abs(to - from) * 12, 240, 700), ease: ctx.anim.ease.standard, onUpdate: setShownLat, onDone: () => { latTween = null; setShownLat(to); } });
  };

  const animateZ = (to) => {
    if (zTween) zTween.cancel();
    if (!booted || ctx.reducedMotion) { shownZ = to; redraw(); return; }
    const from = shownZ;
    zTween = ctx.anim.tween({ from, to, duration: 240, ease: ctx.anim.ease.out, onUpdate: (v) => { shownZ = v; drawPanel(); }, onDone: () => { zTween = null; shownZ = to; drawPanel(); } });
  };

  const toggleRuler = () => {
    if (rulerTween) rulerTween.cancel();
    const on = !ruler || rulerU < 0.5;
    if (on && !ruler) ruler = RULER_DEFAULT.map((p) => p.slice());
    ctx.controls.setLabel("ruler", on ? "Hide ruler" : "Ruler");
    const done = () => { rulerTween = null; if (!on) ruler = null; readouts(); map.invalidate(); };
    if (ctx.reducedMotion) { rulerU = on ? 1 : 0; done(); return; }
    rulerTween = ctx.anim.tween({ from: rulerU, to: on ? 1 : 0, duration: on ? 520 : 200, ease: ctx.anim.ease.standard, onUpdate: (u) => { rulerU = u; map.invalidate(); }, onDone: () => { rulerU = on ? 1 : 0; done(); } });
    readouts();
  };

  const dragFilter = (x, y) => {
    if (ruler && rulerU >= 1) {
      for (const i of [0, 1]) {
        const p = map.projection(ruler[i]);
        if (p && Math.hypot(p[0] - x, p[1] - y) < 14) return "r" + i;
      }
    }
    const b = boxGeom(map.projection);
    if (!b) return null;
    const hw = Math.max(14, Math.max(b.mapW, b.gW) / 2 + 6), hh = Math.max(14, Math.max(b.mapH, b.gH) / 2 + 6);
    if (Math.abs(x - b.cx) <= hw && Math.abs(y - b.cy) <= hh) return "box";
    return null;
  };

  let grab = [0, 0];
  const offDrag = map.on("customdrag", (e) => {
    if (e.phase === "start") {
      dragging = e.claim;
      if (latTween) latTween.cancel();
      const b = boxGeom(map.projection);
      grab = e.claim === "box" && b ? [b.cx - e.x, b.cy - e.y] : [0, 0];
      map.canvas.style.cursor = "grabbing";
      map.invalidate();
      return;
    }
    if (e.phase === "move") {
      const ll = map.pick(e.x + grab[0], clamp(e.y + grab[1], -1e6, 1e6));
      const f = frameInfo(map.projection);
      const yTop = f ? f.top : 0, yBottom = f ? f.yEq : 0;
      const yc = clamp(e.y + grab[1], yTop + 0.5, yBottom);
      const ll2 = ll || map.pick(clamp(e.x + grab[0], f ? f.left + 1 : 0, f ? f.right - 1 : 0), yc);
      if (!ll2) return;
      if (dragging === "box") {
        boxLon = clamp(ll2.lon, -175, 175);
        const lat = clamp(Math.round(ll2.lat * 10) / 10, 0, 85);
        shownLat = lat;
        ctx.controls.set("lat", lat, { live: true });
        redraw(); readouts();
      } else if (dragging && ruler) {
        const i = dragging === "r0" ? 0 : 1;
        ruler[i] = [clamp(ll2.lon, -180, 180), clamp(ll2.lat, -MAX_LAT, MAX_LAT)];
        readouts(); map.invalidate();
      }
      return;
    }
    const was = dragging;
    dragging = null;
    map.canvas.style.cursor = "grab";
    if (was === "box" && e.phase === "end") ctx.controls.set("lat", params.lat);
    map.invalidate();
  });
  ctx.signal.addEventListener("abort", offDrag);
  map.canvas.addEventListener("pointermove", (ev) => {
    if (dragging) return;
    const r = map.canvas.getBoundingClientRect();
    map.canvas.style.cursor = dragFilter(ev.clientX - r.left, ev.clientY - r.top) ? "move" : "grab";
  }, { signal: ctx.signal });

  layout();
  await map.ready;
  if (compact()) map.fit();
  const f0 = frameInfo(map.projection);
  if (f0 && f0.right - f0.left < 360) boxLon = 120;
  map.setDragFilter(dragFilter);
  map.addLayer(PREFIX + "mask", southMask, { order: 49, clip: false });
  map.addLayer(PREFIX + "bars", barLayer, { order: 52, clip: false });
  map.addLayer(PREFIX + "box", boxLayer, { order: 55, clip: false });
  map.addLayer(PREFIX + "ruler", rulerLayer, { order: 58, clip: false });
  map.addLayer(PREFIX + "caption", (g) => drawCaption(g, capX(), capY(), caption(), capOpts()), { order: 90, clip: false });
  redraw();
  readouts();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("ruler") && keys.length === 1) { toggleRuler(); return; }
      if (keys.includes("lat") && Math.abs(params.lat - shownLat) > 1e-9) animateLat(params.lat);
      if (keys.includes("z") && params.z !== shownZ) animateZ(params.z);
      redraw();
      readouts();
    },
    hover(lon, lat) {
      const la = clamp(lat, -MAX_LAT, MAX_LAT);
      const g = pixelGround(Math.abs(la));
      return [`zoom ${params.z}: ${fmtRes(metresPerPixel(params.z, la))}`, `1″ pixel ${g.ew.toFixed(1)} × ${g.ns.toFixed(1)} m`];
    },
    probe(lon, lat) {
      boxLon = clamp(lon, -175, 175);
      ctx.controls.set("lat", clamp(Math.round(Math.abs(lat) * 10) / 10, 0, 85));
      map.invalidate();
      return null;
    },
    unprobe() {},
    resize() { layout(); redraw(); },
    unmount() {
      for (const t of [latTween, zTween, rulerTween]) if (t) t.cancel();
      ctx.url.set("pane", null);
      map.setDragFilter(null);
      map.setFitTarget(null);
      map.canvas.style.cursor = "grab";
      panel.remove();
      map.removePrefix(PREFIX);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
