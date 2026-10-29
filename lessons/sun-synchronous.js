import { sunSyncInclination, nodalPrecession, orbitPeriod, subsolar, dateFromDayOfYear, SUN_RATE, TROPICAL_YEAR, RE } from "@/core/astro.js";
import { FONT_UI, FONT_MONO } from "@/core/map2d.js";
import { clamp, mod, DEG, RAD } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const SUN = "#e3a20b";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
export const YEAR = 2026;
export const DAY0_DOY = 79;
export const DAYS = 365;
export const MS_PER_YEAR = 12000;
export const OFF_SYNC_INC = 90;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const meta = {
  id: "sun-synchronous",
  title: "Always the same local time",
  track: 7,
  order: 4,
  mode: "3d",
  renderer: "webgl",
  light: "sun",
  paragraph: "The Earth is not a perfect sphere, so an orbit plane slowly turns. Choose the inclination so it turns once a year. Then the satellite always sees the ground at the same local time. That is a sun-synchronous orbit. Most imaging satellites use one, near 98° of inclination.",
  deeper: [
    "Precession = −1.5 · n · J2 · (R/a)² · cos i.",
    "705 km needs 98.2°; 786 km needs about 98.6°.",
    "The plane must turn 0.9856° per day.",
    "Sentinel-2 crosses at 10:30 local time.",
  ],
  keywords: ["sun-synchronous", "J2", "precession", "local time", "LTAN", "Sentinel-2", "Landsat"],
  controls: [
    { key: "altitude", type: "range", label: "Altitude", min: 400, max: 1200, step: 1, default: 705, unit: "km", ticks: [400, 600, 800, 1000, 1200] },
    { key: "autoSync", type: "toggle", label: "Sun-synchronous", default: true, shortcut: "s" },
    { key: "inclination", type: "range", label: "Inclination", min: 90, max: 105, step: 0.01, default: 98.21, unit: "°", ticks: [90, 95, 100, 105], tickFormat: (t) => String(t) },
    { key: "ltan", type: "range", label: "Crossing time", min: 9, max: 12, step: 0.25, default: 10, ticks: [9, 10, 11, 12], format: (v) => fmtClock(v), tickFormat: (v) => fmtClock(v) },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "Orbit plane" },
      { color: VIOLET, line: true, label: "Plane needed for the crossing time" },
      { color: SUN, line: true, label: "Direction to the Sun, local noon" },
      { color: SIGNAL, line: true, label: "Crossing time, measured from noon" },
    ] },
  ],
  readouts: [
    { key: "reqInc", label: "Required inclination", digits: 2, unit: "°" },
    { key: "precession", label: "Nodal precession", digits: 4, unit: "°/day" },
    { key: "localTime", label: "Local time at the crossing", hero: true },
    { key: "lag", label: "Plane lags the Sun", digits: 1, unit: "°" },
  ],
  transport: { label: ["day 0", "day 365"], key: "m" },
  compare: null,
  view: { lon: -52, lat: 20, dist: 3.4 },
  data: [],
};

const PREFIX = meta.id + ":";
const wrap = (l) => mod(l + 180, 360) - 180;
const R_SURF = 1.003;
const TIP = 1.42;

export function dateForDay(day) {
  return dateFromDayOfYear(YEAR, DAY0_DOY + day, 12);
}

export function fmtDate(day) {
  const d = dateForDay(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtClock(h) {
  const m = Math.round(mod(h, 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function capSentence(sync, sunMoved, turned, ltan, lt) {
  if (sync) return `The Sun moved ${sunMoved}°. The plane turned ${turned}°, the same angle. The satellite crosses at ${fmtClock(ltan)} every day.`;
  return `The Sun moved ${sunMoved}°. The plane turned ${turned}°. The crossing moved from ${fmtClock(ltan)} to ${fmtClock(lt)}.`;
}

export const COMPACT_W = 640;
const capGuess = (w) => 21 + 17 * Math.ceil(650 / Math.max(60, w - 28));
const hintGuess = (w) => 14 * Math.ceil(170 / Math.max(60, w));

export function layoutFor(W, H, ib = 0, capH = capGuess) {
  if (W >= COMPACT_W) {
    const colW = Math.round(clamp(W * 0.32, 230, 400));
    return { compact: false, W, H, ib, colW, cs: colW - 8, insetTop: 4, insetRight: colW + 40 };
  }
  const sw = { x: 10, y: 10, h: 34 }, top = sw.y + sw.h + 6, pad = 8, ip = 10, gap = 8, head = 26;
  const pw = W - 2 * pad, iw = pw - 2 * ip;
  const room = Math.max(160, H - ib - pad - top);
  const hStack = capH(iw);
  const sStack = Math.min(iw, room - head - gap - hStack - ip);
  const sSide = Math.min(room - 2 * ip, iw - gap - 140);
  const cw = iw - gap - sSide;
  const hSide = capH(cw), hHint = hintGuess(cw);
  const side = sStack < 190 && sSide > sStack && hSide + 6 + hHint <= sSide;
  const base = { compact: true, W, H, ib, side, sw, top, insetTop: top, insetRight: 0 };
  if (!side) {
    const cs = Math.max(120, Math.floor(sStack));
    const cap = { x: ip, y: head + cs + gap, w: iw, h: hStack };
    return { ...base, cs, head: true, pc: { x: Math.round((pw - cs) / 2), y: head }, cap, hint: null, panel: { x: pad, y: top, w: pw, h: cap.y + cap.h + ip } };
  }
  const cs = Math.max(120, Math.floor(sSide));
  const y0 = ip + Math.max(0, Math.round((cs - hSide - 6 - hHint) / 2));
  const cap = { x: ip + cs + gap, y: y0, w: cw, h: hSide };
  return { ...base, cs, head: false, pc: { x: ip, y: ip }, cap, hint: { x: cap.x, y: y0 + hSide + 6, w: cw, h: hHint }, panel: { x: pad, y: top, w: pw, h: cs + 2 * ip } };
}

export function effectiveInclination(alt, inc, autoSync) {
  return autoSync ? sunSyncInclination(alt) : inc;
}

export function lagDeg(alt, inc, day) {
  return (SUN_RATE - nodalPrecession(alt, inc)) * day;
}

export function crossingTime(alt, inc, ltan, day) {
  return mod(ltan - lagDeg(alt, inc, day) / 15, 24);
}

export function crossingLon(alt, inc, ltan, day) {
  return wrap(15 * (crossingTime(alt, inc, ltan, day) - 12));
}

export function sunRA(day) {
  return mod(SUN_RATE * day, 360);
}

export function nodeRA(alt, inc, ltan, day) {
  return mod(sunRA(day) + 15 * (crossingTime(alt, inc, ltan, day) - 12), 360);
}

export function sunLat(day) {
  return subsolar(dateForDay(day)).lat;
}

export function ringLonLat(inc, descLon, u) {
  const i = inc * DEG;
  const lat = Math.asin(Math.sin(i) * Math.sin(u)) * RAD;
  const lon = wrap(descLon + 180 + Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u)) * RAD);
  return [lon, lat];
}

export function ring(inc, descLon, n = 192) {
  const out = [];
  for (let j = 0; j <= n; j++) out.push(ringLonLat(inc, descLon, (2 * Math.PI * j) / n));
  return out;
}

export function facts(alt, inc, ltan, day) {
  return {
    reqInc: sunSyncInclination(alt),
    precession: nodalPrecession(alt, inc),
    localTime: crossingTime(alt, inc, ltan, day),
    lag: lagDeg(alt, inc, day),
    period: orbitPeriod(alt),
  };
}

export function xyz(lon, lat, r = 1, out = [0, 0, 0]) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la) * r;
  out[0] = c * Math.sin(lo); out[1] = Math.sin(la) * r; out[2] = c * Math.cos(lo);
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function hoursFromNoon(h) {
  const d = mod(h - 12 + 12, 24) - 12;
  const m = Math.round(Math.abs(d) * 60);
  if (m === 0) return "at noon";
  const hh = Math.floor(m / 60), mm = m % 60;
  const t = hh ? (mm ? `${hh} h ${String(mm).padStart(2, "0")} min` : `${hh} h`) : `${mm} min`;
  return `${t} ${d < 0 ? "before" : "after"} noon`;
}

export function nightCap(sunLatDeg, capDeg = 90, r = 1.0015, rings = 12, seg = 64) {
  const A = xyz(180, -sunLatDeg, 1);
  const e1 = norm(cross([0, 1, 0], A));
  const e2 = cross(A, e1);
  const at = (th, ph) => {
    const st = Math.sin(th), ct = Math.cos(th), cp = Math.cos(ph), sp = Math.sin(ph);
    return [(A[0] * ct + (e1[0] * cp + e2[0] * sp) * st) * r, (A[1] * ct + (e1[1] * cp + e2[1] * sp) * st) * r, (A[2] * ct + (e1[2] * cp + e2[2] * sp) * st) * r];
  };
  const out = new Float32Array(rings * seg * 18);
  let o = 0;
  const put = (v) => { out[o++] = v[0]; out[o++] = v[1]; out[o++] = v[2]; };
  for (let i = 0; i < rings; i++) {
    const t0 = (capDeg * DEG * i) / rings, t1 = (capDeg * DEG * (i + 1)) / rings;
    for (let j = 0; j < seg; j++) {
      const p0 = (2 * Math.PI * j) / seg, p1 = (2 * Math.PI * (j + 1)) / seg;
      const a = at(t0, p0), b = at(t1, p0), c = at(t1, p1), d = at(t0, p1);
      put(a); put(b); put(c); put(a); put(c); put(d);
    }
  }
  return out;
}

export function terminatorPoint(sunLatDeg, azDeg) {
  const p0 = sunLatDeg * DEG, az = azDeg * DEG;
  const lat = Math.asin(Math.cos(p0) * Math.cos(az));
  const lon = Math.atan2(Math.sin(az), -Math.sin(p0) * Math.cos(az));
  return [wrap(lon * RAD), lat * RAD];
}

function fitPoints(rO) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5)), n = 200;
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, s = Math.sqrt(1 - y * y);
    out.push([Math.cos(g * i) * s * rO, y * rO, Math.sin(g * i) * s * rO]);
  }
  for (const la of [-23.5, 0, 23.5]) out.push(xyz(0, la, TIP * 1.1));
  return out;
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const globe = stage.globe;
  const ui = await import("@/core/ui.js");
  let params = { ...ctx.params };
  let m = params.m ?? 0;
  let inc = effectiveInclination(params.altitude, params.inclination, params.autoSync);
  let lastManual = params.autoSync ? OFF_SYNC_INC : params.inclination;
  let playing = false, playTw = null, holdTimer = 0, autoTimer = 0, incTw = null;
  let applying = false, booted = false, dragInset = null;
  let L = null, arcLon = NaN, nightLat = NaN;

  const day = () => m * DAYS;
  const rO = () => 1 + params.altitude / RE;
  const synced = () => Math.abs(nodalPrecession(params.altitude, inc) - SUN_RATE) < 1e-4;

  const HEAD_CSS = `font:500 10px/14px ${FONT_UI};letter-spacing:.06em;color:${INK3};padding:10px 14px 0;`;
  const PC_CSS = "display:block;cursor:grab;touch-action:none;";
  const CAP_CSS = `position:relative;margin:2px 12px 12px;padding:9px 12px 10px 16px;border-radius:8px;background:rgba(250,248,243,.6);border:1px solid rgba(227,222,211,.95);font:400 12px/17px ${FONT_UI};color:${INK2};`;
  const CAPTITLE_CSS = `font:600 13px/18px ${FONT_UI};color:${INK};margin-bottom:2px;`;
  const PANEL_SKIN = "box-sizing:border-box;border-radius:12px;background:rgba(255,255,255,.92);border:1px solid #e3ded3;box-shadow:0 10px 30px -18px rgba(0,0,0,.9);pointer-events:auto;z-index:3;overflow:hidden;";
  const panel = stage.element("div", "ss-panel");
  const head = document.createElement("div");
  head.style.cssText = HEAD_CSS;
  head.textContent = "THE YEAR, SEEN FROM ABOVE";
  const pc = document.createElement("canvas");
  pc.style.cssText = PC_CSS;
  const cap = document.createElement("div");
  cap.style.cssText = CAP_CSS;
  const capTitle = document.createElement("div");
  capTitle.style.cssText = CAPTITLE_CSS;
  const capText = document.createElement("div");
  const capBar = document.createElement("i");
  capBar.style.cssText = "position:absolute;left:7px;top:10px;bottom:10px;width:2px;border-radius:1px;";
  cap.append(capBar, capTitle, capText);
  const hint = document.createElement("div");
  hint.textContent = "Drag the Earth to change the day";
  panel.append(head, pc, cap, hint);

  const PANES = { globe: "Globe", year: "Year" };
  let pane = ctx.url && ctx.url.get("pane") === "year" ? "year" : "globe";
  const sw = stage.element("div", "segment ss-switch");
  sw.setAttribute("role", "group");
  sw.setAttribute("aria-label", "View to show");
  sw.style.cssText = "inset:auto;left:10px;top:10px;width:auto;height:34px;box-sizing:border-box;padding:2px;gap:2px;display:none;z-index:5;pointer-events:auto;";
  const swBtns = Object.fromEntries(Object.keys(PANES).map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg";
    b.textContent = PANES[k];
    b.style.cssText = "flex:0 0 auto;min-width:64px;height:28px;padding:0 12px;";
    b.addEventListener("click", () => {
      if (pane === k) return;
      pane = k;
      if (ctx.side === "A" && ctx.url) ctx.url.set("pane", k === "globe" ? null : k);
      applyPane();
      render();
    }, { signal: ctx.signal });
    sw.append(b);
    return [k, b];
  }));
  const dayEl = stage.element("div", "ss-day");
  dayEl.style.cssText = `inset:auto;right:12px;top:10px;width:auto;height:34px;display:none;align-items:center;font:600 13px/18px ${FONT_UI};color:${INK};white-space:nowrap;pointer-events:none;z-index:5;`;
  const globeOn = () => !L || !L.compact || pane === "globe";

  const applyPane = () => {
    const c = !!(L && L.compact);
    sw.style.display = c ? "flex" : "none";
    dayEl.style.display = c ? "flex" : "none";
    if (c) panel.style.visibility = pane === "year" ? "visible" : "hidden";
    for (const [k, b] of Object.entries(swBtns)) {
      b.classList.toggle("on", k === pane);
      b.setAttribute("aria-pressed", String(k === pane));
    }
  };

  const capProbe = (w) => {
    const keep = capText.textContent;
    cap.style.width = w + "px";
    let h = 0;
    for (const sync of [true, false]) {
      capText.textContent = capSentence(sync, "359.9", "359.9", 23.99, 23.99);
      h = Math.max(h, cap.offsetHeight);
    }
    capText.textContent = keep;
    return Math.ceil(h);
  };

  const layout = () => {
    const W = stage.width, H = stage.height, ib = stage.insetBottom;
    if (W >= COMPACT_W) {
      L = layoutFor(W, H, ib);
      const cs = L.cs;
      panel.style.cssText = `position:absolute;right:14px;top:14px;left:auto;bottom:auto;width:${L.colW}px;height:auto;max-height:${H - ib - 28}px;${PANEL_SKIN}`;
      head.style.cssText = HEAD_CSS;
      cap.style.cssText = CAP_CSS;
      capTitle.style.cssText = CAPTITLE_CSS;
      pc.style.cssText = PC_CSS;
      hint.style.cssText = "display:none;";
      pc.style.width = cs + "px"; pc.style.height = cs + "px"; pc.style.margin = "0 4px";
      pc.width = Math.round(cs * stage.dpr); pc.height = Math.round(cs * stage.dpr);
      applyPane();
      return;
    }
    panel.style.cssText = `position:absolute;left:8px;top:50px;right:auto;bottom:auto;width:${W - 16}px;height:${Math.max(0, H - ib - 58)}px;${PANEL_SKIN}background:#fdfcfa;`;
    head.style.cssText = HEAD_CSS + "position:absolute;left:0;top:10px;padding:0 14px;";
    capTitle.style.cssText = CAPTITLE_CSS + "display:none;";
    cap.style.cssText = CAP_CSS + "position:absolute;margin:0;box-sizing:border-box;left:0;top:0;";
    L = layoutFor(W, H, ib, capProbe);
    const P = L.panel;
    Object.assign(panel.style, { left: P.x + "px", top: P.y + "px", width: P.w + "px", height: P.h + "px" });
    Object.assign(cap.style, { left: L.cap.x + "px", top: L.cap.y + "px", width: L.cap.w + "px", minHeight: L.cap.h + "px" });
    pc.style.cssText = PC_CSS + `position:absolute;left:${L.pc.x}px;top:${L.pc.y}px;margin:0;width:${L.cs}px;height:${L.cs}px;`;
    head.style.display = L.head ? "" : "none";
    hint.style.cssText = L.hint ? `position:absolute;left:${L.hint.x}px;top:${L.hint.y}px;width:${L.hint.w}px;font:500 10px/14px ${FONT_UI};color:${INK3};` : "display:none;";
    pc.width = Math.round(L.cs * stage.dpr); pc.height = Math.round(L.cs * stage.dpr);
    applyPane();
  };

  const fitCamera = () => {
    if (!globe || ctx.side !== "A") return;
    const f = globe.camera.fit(fitPoints(rO() * 1.02), { padding: 14, insetTop: L.insetTop, insetRight: L.insetRight, insetBottom: L.ib, apply: false });
    globe.camera.setDist(f.dist); globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  const build3D = () => {
    if (!globe) return;
    globe.addTriangles(PREFIX + "night", nightCap(0), { color: "#f1ede4", opacity: 0.42, lit: false, depthWrite: false, order: 1.2, normals: new Float32Array(12 * 64 * 18) });
    globe.addTriangles(PREFIX + "night2", nightCap(0, 82, 1.0016), { color: "#f1ede4", opacity: 0.3, lit: false, depthWrite: false, order: 1.25, normals: new Float32Array(12 * 64 * 18) });
    globe.addTriangles(PREFIX + "disc", new Float32Array(192 * 9), { color: BRASS, opacity: 0.1, lit: false, depthWrite: false, order: 1.6, normals: new Float32Array(192 * 9) });
    globe.addSegments3D(PREFIX + "ring", new Float32Array(192 * 6), { color: "rgba(184,82,23,.95)", width: 2, order: 2 });
    globe.addSegments3D(PREFIX + "need", new Float32Array(192 * 6), { color: "rgba(112,70,166,.85)", width: 1.4, dash: [4, 4], order: 2 });
    globe.addSegments3D(PREFIX + "sunLine", new Float32Array(6), { color: SUN, width: 2.2, order: 3 });
    globe.addTriangles(PREFIX + "sunHead", new Float32Array(9), { color: SUN, opacity: 1, lit: false, order: 3, normals: new Float32Array(9) });
    globe.addPoints3D(PREFIX + "sun", [[0, 0, TIP]], { color: SUN, size: 20, order: 4 });
    globe.addTriangles(PREFIX + "body", new Float32Array(36 * 3), { color: BRASS, opacity: 1, lit: true, order: 4 });
    globe.addTriangles(PREFIX + "panels", new Float32Array(12 * 3), { color: VIOLET, opacity: 0.95, lit: false, order: 4 });
    const merid = [];
    for (let la = -72; la < 72; la += 3) merid.push([[0, la], [0, la + 3]]);
    globe.addLines(PREFIX + "noon", merid, { color: "rgba(227,162,11,.75)", width: 1.4, dash: [4, 3] });
    globe.addLabel3D(PREFIX + "sunLabel", [0, 0, TIP], "to the Sun", { color: SUN, dx: -6, dy: -30, occlude: true });
    globe.addLabel3D(PREFIX + "satLabel", [0, 0, 1], "", { color: INK, dx: -14, dy: -32, occlude: true });
    globe.addLabel3D(PREFIX + "arcLabel", [0, 0, 1], "", { color: SIGNAL, dx: -14, dy: 12, occlude: true });
  };

  const ringSegs = (incDeg, descLon, R) => {
    const pts = ring(incDeg, descLon, 192), out = new Float32Array(192 * 6), a = [0, 0, 0], b = [0, 0, 0];
    for (let j = 0; j < 192; j++) { xyz(pts[j][0], pts[j][1], R, a); xyz(pts[j + 1][0], pts[j + 1][1], R, b); out.set(a, j * 6); out.set(b, j * 6 + 3); }
    return out;
  };

  const update3D = () => {
    if (!globe) return;
    const d = day(), R = rO();
    const slat = sunLat(d);
    globe.setSun(0, slat);
    if (Math.abs(slat - nightLat) > 0.02) {
      nightLat = slat;
      globe.setTriangles(PREFIX + "night", nightCap(slat), { normals: new Float32Array(12 * 64 * 18) });
      globe.setTriangles(PREFIX + "night2", nightCap(slat, 82, 1.0016), { normals: new Float32Array(12 * 64 * 18) });
      const term = [];
      for (let k = 0; k < 180; k++) term.push([terminatorPoint(slat, k * 2), terminatorPoint(slat, k * 2 + 2)]);
      globe.addLines(PREFIX + "term", term, { color: "rgba(227,162,11,.55)", width: 1.2 });
    }
    const lon = crossingLon(params.altitude, inc, params.ltan, d);
    const seg = ringSegs(inc, lon, R);
    globe.setSegments3D(PREFIX + "ring", seg);
    const disc = new Float32Array(192 * 9);
    for (let j = 0; j < 192; j++) { disc.set([0, 0, 0], j * 9); disc.set(seg.subarray(j * 6, j * 6 + 6), j * 9 + 3); }
    globe.setTriangles(PREFIX + "disc", disc, { normals: new Float32Array(disc.length) });
    const need = globe.extra.get(PREFIX + "need");
    const off = Math.abs(wrap(lon - crossingLon(params.altitude, sunSyncInclination(params.altitude), params.ltan, d))) > 0.3 || Math.abs(inc - sunSyncInclination(params.altitude)) > 0.05;
    if (need) {
      need.visible = off;
      if (off) globe.setSegments3D(PREFIX + "need", ringSegs(sunSyncInclination(params.altitude), 15 * (params.ltan - 12), R * 1.002));
    }

    const s = xyz(0, slat, 1);
    const p0 = s.map((x) => x * 1.02), p1 = s.map((x) => x * (TIP - 0.08));
    globe.setSegments3D(PREFIX + "sunLine", [[p0, p1]]);
    const side = norm(cross(s, [0, 1, 0])), hw = 0.035;
    const base = s.map((x) => x * (TIP - 0.12));
    globe.setTriangles(PREFIX + "sunHead", [...base.map((x, k) => x + side[k] * hw), ...base.map((x, k) => x - side[k] * hw), ...s.map((x) => x * (TIP - 0.03))], { normals: new Float32Array(9) });
    const tip = s.map((x) => x * TIP);
    globe.setPoints3D(PREFIX + "sun", [tip]);
    globe.setLabel3D(PREFIX + "sunLabel", { point: tip, visible: globeOn() });

    const P = xyz(lon, 0, R), r = norm(P);
    const nx = xyz(...ringLonLat(inc, lon, Math.PI + 0.01), R);
    const v = norm([nx[0] - P[0], nx[1] - P[1], nx[2] - P[2]]), c = norm(cross(r, v));
    const sz = 0.02 * clamp(globe.dist / 3.4, 0.5, 1.6), pv = sz * 0.8;
    const pt = (x, y, z) => [P[0] + r[0] * x + v[0] * y + c[0] * z, P[1] + r[1] * x + v[1] * y + c[1] * z, P[2] + r[2] * x + v[2] * y + c[2] * z];
    const C = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => pt(x * sz, y * sz * 1.3, z * sz));
    const box = [];
    for (const f of [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [2, 6, 7, 3], [1, 5, 6, 2], [0, 3, 7, 4]]) box.push(C[f[0]], C[f[1]], C[f[2]], C[f[0]], C[f[2]], C[f[3]]);
    globe.setTriangles(PREFIX + "body", box.flat());
    const pan = [];
    for (const sg of [1, -1]) {
      const a0 = pt(0, -pv, sg * sz * 1.3), a1 = pt(0, pv, sg * sz * 1.3), a2 = pt(0, pv, sg * sz * 5.2), a3 = pt(0, -pv, sg * sz * 5.2);
      pan.push(a0, a1, a2, a0, a2, a3);
    }
    globe.setTriangles(PREFIX + "panels", pan.flat());
    const lt = crossingTime(params.altitude, inc, params.ltan, d);
    globe.setLabel3D(PREFIX + "satLabel", { point: P, text: `${fmtClock(lt)} southbound`, visible: globeOn() });

    const dl = wrap(lon);
    if (Math.abs(dl) > 0.5 && Math.abs(dl) <= 170) {
      if (Math.abs(dl - arcLon) > 0.05) {
        const n = Math.max(2, Math.ceil(Math.abs(dl) / 2)), arc = [];
        for (let k = 0; k < n; k++) arc.push([[(dl * k) / n, 0], [(dl * (k + 1)) / n, 0]]);
        globe.addLines(PREFIX + "arc", arc, { color: SIGNAL, width: 3 });
        arcLon = dl;
      }
      globe.setLabel3D(PREFIX + "arcLabel", { point: xyz(dl, 0, R_SURF), text: hoursFromNoon(lt), visible: globeOn() });
    } else {
      globe.remove(PREFIX + "arc");
      arcLon = NaN;
      globe.setLabel3D(PREFIX + "arcLabel", { visible: false });
    }
  };

  const drawInset = () => {
    if (!L) return;
    const g = pc.getContext("2d"), dpr = stage.dpr, S = L.cs;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2 - 4, R = S * 0.35, d = day();
    const at = (deg, r = R) => [cx + Math.cos(deg * DEG) * r, cy - Math.sin(deg * DEG) * r];
    const earthAt = (dd) => at(sunRA(dd) + 180);

    g.setLineDash([2, 4]); g.strokeStyle = "rgba(60,52,40,.3)"; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    const sweep = sunRA(d) * DEG;
    if (d > 0.5) {
      g.strokeStyle = "rgba(184,82,23,.55)"; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, R, -Math.PI, -Math.PI - Math.min(sweep, Math.PI * 2 - 1e-3), true); g.stroke();
    }
    g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textBaseline = "middle";
    const inset = S < 200 ? 6 : 9;
    for (const [dd, ang] of [[0, 180], [93, 270], [186, 0], [276, 90]]) {
      const side = ang === 0 || ang === 180;
      const [x, y] = at(ang, side ? R - inset : R + 12);
      g.textAlign = ang === 180 ? "left" : ang === 0 ? "right" : "center";
      g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,.95)"; g.strokeText(fmtDate(dd), x, y);
      g.fillText(fmtDate(dd), x, y);
    }

    const k0 = S >= 220 ? 1 : Math.max(0.6, (S - 80) / 140);
    g.save(); g.translate(cx, cy);
    g.strokeStyle = SUN; g.lineWidth = 1.6; g.lineCap = "round";
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.beginPath(); g.moveTo(Math.cos(a) * 13 * k0, Math.sin(a) * 13 * k0); g.lineTo(Math.cos(a) * 18 * k0, Math.sin(a) * 18 * k0); g.stroke(); }
    g.beginPath(); g.arc(0, 0, 9.5 * k0, 0, Math.PI * 2); g.fillStyle = SUN; g.fill();
    g.restore();

    const half = R * 0.3;
    const planeAt = (dd, alpha, width, col, dot) => {
      const [ex, ey] = earthAt(dd);
      const a = nodeRA(params.altitude, inc, params.ltan, dd) * DEG;
      g.strokeStyle = col; g.lineWidth = width; g.globalAlpha = alpha;
      g.beginPath(); g.moveTo(ex - Math.cos(a) * half, ey + Math.sin(a) * half); g.lineTo(ex + Math.cos(a) * half, ey - Math.sin(a) * half); g.stroke();
      if (dot) { g.beginPath(); g.arc(ex + Math.cos(a) * half, ey - Math.sin(a) * half, 2.6, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
      g.beginPath(); g.arc(ex, ey, 3, 0, Math.PI * 2); g.fillStyle = "#3d7fc0"; g.fill();
      g.globalAlpha = 1;
    };
    const step = TROPICAL_YEAR / 12;
    for (let k = 0; k * step < d - step * 0.35; k++) planeAt(k * step, 0.45, 1.3, BRASS, true);

    const [ex, ey] = earthAt(d);
    g.setLineDash([3, 3]); g.strokeStyle = "rgba(227,162,11,.6)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(cx + (ex - cx) * 0.12, cy + (ey - cy) * 0.12); g.stroke(); g.setLineDash([]);
    const sa = sunRA(d), na = nodeRA(params.altitude, inc, params.ltan, d);
    const diff = mod(na - sa + 180, 360) - 180;
    g.strokeStyle = SIGNAL; g.lineWidth = 2;
    g.beginPath(); g.arc(ex, ey, half * 0.62, -sa * DEG, -(sa + diff) * DEG, diff > 0); g.stroke();
    planeAt(d, 1, 2.6, BRASS, false);
    const a = na * DEG, sx = ex + Math.cos(a) * half, sy = ey - Math.sin(a) * half;
    g.beginPath(); g.arc(sx, sy, 4.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.lineWidth = 1.6; g.strokeStyle = BRASS; g.stroke();
    g.save(); g.translate(ex, ey);
    g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fillStyle = "#bcd1dd"; g.fill();
    g.beginPath(); g.arc(0, 0, 7, -(sa + 90) * DEG, -(sa - 90) * DEG); g.closePath(); g.fillStyle = "#6fb3d4"; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = "rgba(50,46,40,.7)"; g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.stroke();
    g.restore();
    const lt = fmtClock(crossingTime(params.altitude, inc, params.ltan, d));
    const mid = (sa + diff / 2) * DEG, lr = half * 0.62 + 14;
    g.font = `600 11px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
    const lx = clamp(ex + Math.cos(mid) * lr, 22, S - 22), ly = clamp(ey - Math.sin(mid) * lr, 10, S - 10);
    g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.9)"; g.strokeText(lt, lx, ly);
    g.fillStyle = SIGNAL; g.fillText(lt, lx, ly);
    g.font = `500 10px ${FONT_UI}`; g.textAlign = "left"; g.textBaseline = "bottom"; g.fillStyle = INK3;
    if (!L.hint) g.fillText("Drag the Earth to change the day", 8, S - 4);
  };

  const caption = () => {
    const d = day();
    const f = facts(params.altitude, inc, params.ltan, d);
    const sync = synced();
    const t0 = nodalPrecession(params.altitude, inc) * d;
    const turned = Math.abs(t0) < 0.05 ? 0 : t0;
    capTitle.textContent = `Day ${Math.round(d)} · ${fmtDate(d)}`;
    dayEl.textContent = capTitle.textContent;
    capBar.style.background = sync ? BRASS : VIOLET;
    capText.textContent = capSentence(sync, (SUN_RATE * d).toFixed(1), turned.toFixed(1), params.ltan, f.localTime);
  };

  const readouts = () => {
    const f = facts(params.altitude, inc, params.ltan, day());
    ctx.readout.setMany({ reqInc: f.reqInc, precession: f.precession, localTime: fmtClock(f.localTime), lag: f.lag });
  };

  const render = () => {
    update3D();
    drawInset();
    caption();
    readouts();
  };

  const setM = (v) => { m = clamp(v, 0, 1); render(); };

  const bar = stage.el.parentElement ? stage.el.parentElement.querySelector(".transport") : null;
  const playBtn = bar ? bar.querySelector(".tp-play") : null;
  const range = bar ? bar.querySelector(".tp-range") : null;
  const paintPlay = (on) => {
    if (!playBtn) return;
    playBtn.replaceChildren(ui.icon(on ? "i-pause" : "i-play", 18));
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
  };
  const paintRange = () => { if (range) { range.value = String(m); range.style.setProperty("--b", m * 100 + "%"); } };
  const clearTimers = () => {
    if (playTw) { playTw.cancel(); playTw = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  };
  const stopPlay = (commit = true) => {
    if (!playing) return;
    playing = false;
    clearTimers();
    paintPlay(false);
    if (commit && ctx.transport) ctx.transport.set(m);
  };
  const run = () => {
    playTw = ctx.anim.tween({
      from: m, to: 1, duration: Math.max(1, (1 - m) * MS_PER_YEAR), ease: ctx.anim.ease.linear,
      onUpdate: (v) => { setM(v); paintRange(); },
      onDone: () => {
        playTw = null;
        holdTimer = setTimeout(() => {
          holdTimer = 0;
          if (!playing) return;
          playTw = ctx.anim.tween({ from: 1, to: 0, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
        }, 1200);
      },
    });
  };
  const startPlay = () => {
    if (playing) return;
    playing = true;
    paintPlay(true);
    if (m >= 0.999) playTw = ctx.anim.tween({ from: m, to: 0, duration: 700, ease: ctx.anim.ease.emph, onUpdate: (v) => { setM(v); paintRange(); }, onDone: () => { playTw = null; if (playing) run(); } });
    else run();
  };
  const togglePlay = () => { if (playing) stopPlay(); else startPlay(); };
  if (bar && ctx.side === "A") {
    bar.addEventListener("click", (e) => {
      if (!e.target.closest || !e.target.closest(".tp-play")) return;
      e.stopPropagation(); e.preventDefault();
      togglePlay();
    }, { capture: true, signal: ctx.signal });
  }
  const unkey = ctx.side === "A" ? ui.keymap({ space: () => togglePlay() }) : null;

  if (ctx.transport) ctx.transport.onScrub((v) => {
    if (playing) stopPlay(false);
    setM(v);
  });

  const insetDay = (e) => {
    const r = pc.getBoundingClientRect();
    const x = e.clientX - r.left - L.cs / 2, y = -(e.clientY - r.top - L.cs / 2);
    return mod(Math.atan2(y, x) * RAD - 180, 360) / SUN_RATE;
  };
  pc.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    pc.setPointerCapture(e.pointerId);
    dragInset = { id: e.pointerId };
    stopPlay(false);
    pc.style.cursor = "grabbing";
    setM(Math.min(insetDay(e), DAYS) / DAYS); paintRange();
  }, { signal: ctx.signal });
  pc.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    if (!dragInset) return;
    const dd = insetDay(e);
    const cur = day();
    const pick = Math.abs(dd - cur) > 180 && cur > 300 && dd < 60 ? DAYS : Math.abs(dd - cur) > 180 && cur < 60 && dd > 300 ? 0 : Math.min(dd, DAYS);
    setM(pick / DAYS); paintRange();
  }, { signal: ctx.signal });
  const endInset = (e) => {
    e.stopPropagation();
    if (!dragInset) return;
    dragInset = null;
    pc.style.cursor = "grab";
    if (ctx.transport) ctx.transport.set(m);
  };
  pc.addEventListener("pointerup", endInset, { signal: ctx.signal });
  pc.addEventListener("pointercancel", endInset, { signal: ctx.signal });
  for (const el of [panel, sw]) for (const ev of ["pointerdown", "pointermove", "wheel", "dblclick"]) el.addEventListener(ev, (e) => e.stopPropagation(), { signal: ctx.signal });

  const setInc = (v, opts) => {
    applying = true;
    ctx.controls.set("inclination", Math.round(v * 100) / 100, opts);
    applying = false;
  };

  const animateInc = (to, exact) => {
    if (incTw) incTw.cancel();
    const from = inc;
    const done = () => { incTw = null; inc = exact; setInc(to); params.inclination = Math.round(to * 100) / 100; render(); };
    if (ctx.reducedMotion || !booted) { done(); return; }
    incTw = ctx.anim.tween({
      from, to: exact, duration: 800, ease: ctx.anim.ease.emph,
      onUpdate: (v) => { inc = v; setInc(v, { silent: true }); render(); },
      onDone: done,
    });
  };

  layout();
  build3D();
  fitCamera();

  setTimeout(() => {
    booted = true;
    if (ctx.side === "A" && !ctx.reducedMotion && ctx.url.get("m") === undefined && !ctx.signal.aborted) autoTimer = setTimeout(() => { autoTimer = 0; if (!ctx.signal.aborted && m < 0.001) startPlay(); }, 700);
  }, 0);

  return {
    update(p, keys) {
      const prevAlt = params.altitude;
      params = { ...p };
      if (applying) return;
      if (keys.length > 1) {
        inc = effectiveInclination(params.altitude, params.inclination, params.autoSync);
        if (params.autoSync) setInc(inc, { silent: true });
        else lastManual = params.inclination;
        if (keys.includes("m")) m = params.m ?? m;
        render();
        return;
      }
      const k = keys[0];
      if (k === "autoSync") {
        if (params.autoSync) animateInc(sunSyncInclination(params.altitude), sunSyncInclination(params.altitude));
        else {
          animateInc(lastManual, lastManual);
          if (!playing && m < 0.02 && ctx.side === "A") startPlay();
        }
        return;
      }
      if (k === "inclination") {
        if (incTw) { incTw.cancel(); incTw = null; }
        inc = params.inclination;
        if (Math.abs(inc - sunSyncInclination(params.altitude)) > 0.006) {
          lastManual = inc;
          if (params.autoSync) { applying = true; ctx.controls.set("autoSync", false); applying = false; params.autoSync = false; }
        }
        render();
        return;
      }
      if (k === "altitude") {
        if (params.autoSync) { inc = sunSyncInclination(params.altitude); setInc(inc); params.inclination = Math.round(inc * 100) / 100; }
        if (prevAlt !== params.altitude) fitCamera();
        render();
        return;
      }
      if (k === "m") { if (!playing && !dragInset) m = params.m ?? m; }
      render();
    },
    hover(lon, lat) {
      const sl = sunLat(day()) * DEG, la = lat * DEG;
      const up = Math.sin(la) * Math.sin(sl) + Math.cos(la) * Math.cos(sl) * Math.cos(lon * DEG);
      return [`local time ${fmtClock(12 + lon / 15)}`, up > 0 ? "day side" : "night side"];
    },
    probe() { return null; },
    unprobe() {},
    resize() { layout(); fitCamera(); render(); },
    unmount() {
      stopPlay(false);
      clearTimers();
      if (autoTimer) clearTimeout(autoTimer);
      if (incTw) incTw.cancel();
      if (unkey) unkey();
      paintPlay(false);
      if (globe) globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
      panel.remove();
      sw.remove();
      dayEl.remove();
      if (ctx.side === "A" && ctx.url) ctx.url.set("pane", null);
    },
  };
}
