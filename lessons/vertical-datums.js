import { greatCirclePoints, inverse, direct } from "@/core/geodesy.js";
import { clamp } from "@/core/math.js";
import { FONT_UI } from "@/core/map2d.js";
import { ui, lake } from "@/core/palette.js";

const ORANGE = ui.brass;
const BLUE = ui.signal;
const INK = ui.ink;
const INK2 = ui.ink2;
const INK3 = ui.ink3;
const HALO = ui.halo;
const LAND = "#e1d8c1";
const LAND_EDGE = "rgba(74,66,54,.7)";
const SERIF = `"Newsreader", Georgia, serif`;

export const PROFILES = {
  nepal: { label: "Nepal", from: [88.3, 21.0], to: [86.925, 27.988], extend: 70, tide: 2.4, place: { name: "Everest", lon: 86.925, lat: 27.988, H: 8848.86, half: 14 } },
  netherlands: { label: "Netherlands", from: [3.3, 52.1], to: [4.617, 51.967], extend: 90, tide: 1.0, coast: [4.2, 52.01], place: { name: "Zuidplaspolder", lon: 4.617, lat: 51.967, H: -6.76, half: 6 } },
  chile: { label: "Chile coast", from: [-74.0, -32.9], to: [-70.011, -32.653], extend: 50, tide: 0.9, place: { name: "Aconcagua", lon: -70.011, lat: -32.653, H: 6961, half: 14 } },
};
export const DATUMS = ["ellipsoid", "geoid", "chart"];
const ZERO_NAME = { ellipsoid: "the ellipsoid", geoid: "the geoid", chart: "chart datum" };
const NAMES_LONG = { ellipsoid: "ellipsoid (GPS)", geoid: "geoid (sea level)", chart: "chart datum (low tide)" };
const NAMES_SHORT = { ellipsoid: "ellipsoid", geoid: "geoid", chart: "chart datum" };
const NOTE = "Gaps between the lines not to scale";

export const meta = {
  id: "vertical-datums",
  title: "Measuring height",
  track: 1,
  order: 4,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  paragraph: "You measure every height from a zero surface. GPS, maps and sea charts each use a different zero. So one summit has three heights.",
  deeper: [
    "GPS height = map height + geoid height (h = H + N).",
    "Chart datum is near the lowest tide, so a chart shows the least depth.",
  ],
  keywords: ["orthometric", "ellipsoidal", "chart datum", "height"],
  controls: [
    { key: "profile", type: "select", label: "Profile", options: Object.entries(PROFILES).map(([value, p]) => ({ value, label: p.label })), default: "nepal" },
    { key: "datum", type: "segment", label: "Zero is", options: [{ value: "ellipsoid", label: "Ellipsoid" }, { value: "geoid", label: "Geoid" }, { value: "chart", label: "Chart" }], default: "geoid" },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: null,
  data: ["egm96_15m.i16", "etopo_15m.i16"],
};

const SAMPLES = 320;
const GAP_CURVE = 60;

export function heights(H, N, tide) {
  return { h: H + N, H, N, chart: H + tide };
}

export function heightAbove(hs, datum) {
  return datum === "ellipsoid" ? hs.h : datum === "geoid" ? hs.H : hs.chart;
}

export function zeroLevels(N, tide) {
  return { ellipsoid: -N, geoid: 0, chart: -tide };
}

export function buildProfile(id, geoid, etopo, n = SAMPLES) {
  const P = PROFILES[id], Q = P.place;
  const inv = inverse(P.from[0], P.from[1], P.to[0], P.to[1]);
  const end = P.extend ? direct(P.from[0], P.from[1], inv.azi1, inv.s12 + P.extend * 1000) : { lon: P.to[0], lat: P.to[1] };
  const b = [end.lon, end.lat];
  const total = inverse(P.from[0], P.from[1], b[0], b[1]).s12 / 1000;
  const pts = greatCirclePoints(P.from, b, n);
  const sPlace = inverse(P.from[0], P.from[1], Q.lon, Q.lat).s12 / 1000;
  const base = etopo.sample(Q.lon, Q.lat);
  const up = Q.H >= base;
  const samples = pts.map(([lon, lat], i) => {
    const s = (total * i) / n;
    let H = etopo.sample(lon, lat);
    const d = Math.abs(s - sPlace);
    if (d < Q.half) { const r = Q.H - (Q.H - base) * (d / Q.half); H = up ? Math.max(H, r) : Math.min(H, r); }
    return { lon, lat, s, H, N: geoid.sample(lon, lat) };
  });
  let top = 0;
  samples.forEach((q, i) => { if (Math.abs(q.s - sPlace) < Math.abs(samples[top].s - sPlace)) top = i; });
  samples[top] = { lon: Q.lon, lat: Q.lat, s: sPlace, H: Q.H, N: geoid.sample(Q.lon, Q.lat), place: true };
  let coast;
  if (P.coast) {
    const sc = inverse(P.from[0], P.from[1], P.coast[0], P.coast[1]).s12 / 1000;
    coast = samples.reduce((k, q, i) => (Math.abs(q.s - sc) < Math.abs(samples[k].s - sc) ? i : k), 0);
  } else {
    coast = Math.max(0, samples.findIndex((q) => q.H >= 0));
  }
  return { id, P, total, samples, top, coast, tide: P.tide };
}

export function makeScale(levels, { yBottom, gap, yTop, maxH, minRange = 400, k: kFixed }) {
  const lines = DATUMS.map((d) => ({ d, v: levels[d] })).sort((a, b) => b.v - a.v);
  lines.forEach((l, i) => { l.y = yBottom - (lines.length - 1 - i) * gap; });
  const k = kFixed ?? (lines[0].y - yTop) / Math.max(maxH - lines[0].v, minRange);
  const y = (v) => {
    if (v >= lines[0].v) return lines[0].y - (v - lines[0].v) * k;
    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i], b = lines[i + 1];
      if (v >= b.v) {
        const t = (a.v - v) / (a.v - b.v);
        return a.y + gap * (Math.log1p(GAP_CURVE * t) / Math.log1p(GAP_CURVE));
      }
    }
    return lines[lines.length - 1].y + (lines[lines.length - 1].v - v) * k;
  };
  const lineY = Object.fromEntries(lines.map((l) => [l.d, l.y]));
  return { y, lineY, lines, k };
}

const fmtM = (v) => Math.abs(Math.round(v)).toLocaleString("en-US");

export function heightText(v, datum) {
  return `${fmtM(v)} m ${Math.round(v) < 0 ? "below" : "above"} ${ZERO_NAME[datum]}`;
}

export async function mount(ctx) {
  const geoid = ctx.data.get("egm96_15m.i16") || (await ctx.data.load("egm96_15m.i16"));
  const etopo = ctx.data.get("etopo_15m.i16") || (await ctx.data.load("etopo_15m.i16"));
  let params = { ...ctx.params };
  let prof = null, place = null, hs = null, maxH = 0;
  let shown = { from: params.datum, to: params.datum, u: 1 };
  let tw = null, booted = false;

  const cv = ctx.stage.canvas("vd-section");
  cv.style.cssText += ";z-index:3;cursor:crosshair;touch-action:none;";
  const g = cv.getContext("2d");
  const hair = ctx.stage.element("div", "vd-hair");
  hair.style.cssText = `position:absolute;left:0;top:0;width:1px;background:${BLUE};opacity:.55;pointer-events:none;z-index:4;display:none;`;
  let W = 1, Hs = 1, dpr = 1, sc = null;
  const L = { x0: 0, x1: 1, yTop: 1, yBottom: 1, gap: 22, big: 22, names: NAMES_LONG, nameFont: "" };

  const X = (s) => L.x0 + ((L.x1 - L.x0) * s) / prof.total;

  const setProfile = (id) => {
    prof = buildProfile(id, geoid, etopo);
    place = prof.samples[prof.top];
    hs = heights(place.H, place.N, prof.tide);
    maxH = Math.max(...prof.samples.slice(prof.coast).map((q) => q.H));
  };

  const size = () => {
    W = Math.max(1, Math.round(ctx.stage.width));
    Hs = Math.max(1, Math.round(ctx.stage.height));
    dpr = ctx.stage.dpr;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(Hs * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(Hs * dpr); }
    const bottom = Hs - (ctx.stage.insetBottom || 0);
    L.big = Math.round(clamp(W / 24, 17, 26));
    L.gap = Math.round(clamp(bottom / 32, 18, 26));
    L.names = W < 600 ? NAMES_SHORT : NAMES_LONG;
    L.nameFont = `500 ${L.gap < 21 ? 12 : 13}px ${FONT_UI}`;
    g.font = `700 ${L.gap < 21 ? 12 : 13}px ${FONT_UI}`;
    const nameW = Math.max(...DATUMS.map((d) => g.measureText(L.names[d]).width));
    L.x0 = Math.round(12 + nameW + 14);
    L.x1 = W - 12;
    L.yTop = 18 + 14 + L.big + 22;
    const levels = zeroLevels(place.N, prof.tide);
    const first = makeScale(levels, { yBottom: bottom - 34, gap: L.gap, yTop: L.yTop, maxH });
    const free = first.lines[0].y - L.yTop - Math.max(0, maxH - first.lines[0].v) * first.k;
    L.yBottom = bottom - 34 - Math.max(0, free) * 0.5;
    sc = makeScale(levels, { yBottom: L.yBottom, gap: L.gap, yTop: L.yTop, maxH, k: first.k });
  };

  const halo = (text, x, y, color, font, align = "left") => {
    g.font = font; g.textAlign = align; g.textBaseline = "alphabetic";
    g.lineJoin = "round"; g.strokeStyle = HALO; g.lineWidth = 4; g.strokeText(text, x, y);
    g.fillStyle = color; g.fillText(text, x, y);
  };

  const footY = () => sc.lineY[shown.from] + (sc.lineY[shown.to] - sc.lineY[shown.from]) * shown.u;

  const draw = () => {
    size();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = ui.bg; g.fillRect(0, 0, W, Hs);
    const S = prof.samples, c = prof.coast;
    const xc = X(S[c].s);
    g.fillStyle = lake; g.fillRect(0, sc.lineY.geoid, xc, Hs - sc.lineY.geoid);
    g.beginPath();
    g.moveTo(xc, Hs);
    for (let i = c; i < S.length; i++) g.lineTo(X(S[i].s), sc.y(S[i].H));
    g.lineTo(L.x1, Hs); g.closePath();
    g.fillStyle = LAND; g.fill();
    g.beginPath();
    for (let i = c; i < S.length; i++) { const x = X(S[i].s), y = sc.y(S[i].H); if (i === c) g.moveTo(x, y); else g.lineTo(x, y); }
    g.strokeStyle = LAND_EDGE; g.lineWidth = 1.2; g.stroke();

    const style = { ellipsoid: [INK2, []], geoid: [BLUE, []], chart: [BLUE, [6, 4]] };
    for (const d of DATUMS) {
      const y = sc.lineY[d], on = d === shown.to;
      g.strokeStyle = on ? ORANGE : style[d][0]; g.lineWidth = on ? 3 : 1.4; g.setLineDash(on ? [] : style[d][1]);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.setLineDash([]);
    for (const d of DATUMS) {
      const on = d === shown.to;
      halo(L.names[d], 12, sc.lineY[d] - 5, on ? ORANGE : style[d][0], on ? L.nameFont.replace("500", "700") : L.nameFont);
    }
    halo(NOTE, 12, L.yBottom + 20, INK3, `italic 500 11px ${FONT_UI}`);

    const px = clamp(X(place.s), 16, W - 16), py = sc.y(place.H), fy = footY();
    const dir = py < fy ? -1 : 1;
    g.strokeStyle = ORANGE; g.fillStyle = ORANGE; g.lineWidth = 2;
    const tip = py - dir * 5;
    if (Math.abs(tip - fy) > 2) {
      g.beginPath(); g.moveTo(px, fy); g.lineTo(px, tip - dir * 7); g.stroke();
      g.beginPath(); g.moveTo(px, tip); g.lineTo(px - 5, tip - dir * 9); g.lineTo(px + 5, tip - dir * 9); g.closePath(); g.fill();
    }
    g.beginPath(); g.moveTo(px - 7, fy); g.lineTo(px + 7, fy); g.stroke();
    g.fillStyle = INK; g.strokeStyle = HALO; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill(); g.stroke();

    const val = heightAbove(hs, shown.from) + (heightAbove(hs, shown.to) - heightAbove(hs, shown.from)) * shown.u;
    const text = heightText(val, shown.to);
    const bigFont = `600 ${L.big}px ${SERIF}`;
    g.font = bigFont;
    const tw = g.measureText(text).width;
    const left = px > W / 2;
    const tx = clamp(left ? px + 8 - tw : px - 8, 12, W - 12 - tw);
    const step = (L.x1 - L.x0) / (S.length - 1);
    let clearY = Math.min(py, fy, sc.lines[0].y) - 18;
    for (let i = clamp(Math.floor((tx - L.x0) / step) - 1, c, S.length - 1); i <= clamp(Math.ceil((tx + tw - L.x0) / step) + 1, c, S.length - 1); i++) clearY = Math.min(clearY, sc.y(S[i].H) - 12);
    const by = Math.max(18 + 14 + L.big, clearY);
    halo(text, tx, by, ORANGE, bigFont);
    halo(prof.P.place.name, left ? tx + tw : tx, by - L.big - 4, INK, `600 13px ${FONT_UI}`, left ? "right" : "left");
  };

  const setDatum = (to) => {
    if (tw) { tw.cancel(); tw = null; }
    const cur = shown.u >= 0.5 ? shown.to : shown.from;
    if (!booted || ctx.reducedMotion || cur === to) { shown = { from: to, to, u: 1 }; draw(); return; }
    shown = { from: cur, to, u: 0 };
    tw = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (u) => { shown.u = u; draw(); }, onDone: () => { tw = null; shown = { from: to, to, u: 1 }; draw(); } });
  };

  const hideHover = () => { hair.style.display = "none"; ctx.overlay.hideChip(); };
  const showHover = (e) => {
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (x < L.x0 || x > L.x1) { hideHover(); return; }
    const S = prof.samples;
    const i = clamp(Math.round(((x - L.x0) / (L.x1 - L.x0)) * (S.length - 1)), 0, S.length - 1);
    const q = S[i], h = heights(q.H, q.N, prof.tide);
    hair.style.display = "block";
    hair.style.transform = `translate(${Math.round(X(q.s))}px, ${Math.round(L.yTop - 8)}px)`;
    hair.style.height = `${Math.round(L.yBottom - L.yTop + 8)}px`;
    const f = (v) => `${Math.round(v) < 0 ? "−" : ""}${fmtM(v)} m`;
    ctx.overlay.chip(x, y, [`Ellipsoid: ${f(h.h)}`, `Geoid: ${f(h.H)}`, `Chart datum: ${f(h.chart)}`]);
  };
  cv.addEventListener("pointermove", (e) => { e.stopPropagation(); showHover(e); }, { signal: ctx.signal });
  cv.addEventListener("pointerdown", (e) => { e.stopPropagation(); showHover(e); }, { signal: ctx.signal });
  cv.addEventListener("pointerleave", hideHover, { signal: ctx.signal });
  for (const ev of ["pointerup", "click", "wheel", "dblclick"]) cv.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  setProfile(params.profile);
  draw();
  if (document.fonts && document.fonts.load) document.fonts.load(`600 20px "Newsreader"`).then(() => { if (!ctx.signal.aborted) draw(); }, () => {});
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("profile") && prof.id !== params.profile) { setProfile(params.profile); hideHover(); }
      if (keys.includes("datum")) setDatum(params.datum);
      else draw();
    },
    hover() { return []; },
    probe() { return null; },
    unprobe() {},
    resize() { hideHover(); draw(); },
    unmount() {
      if (tw) tw.cancel();
      ctx.overlay.hideChip();
    },
  };
}
