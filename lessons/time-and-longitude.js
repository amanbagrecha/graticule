import { subsolar, sun, solarTime, terminator, dateFromDayOfYear } from "@/core/astro.js";
import { geo, drawCaption, smallCircle, FONT_MONO } from "@/core/map2d.js";
import { mod, clamp } from "@/core/math.js";
import { loadImage } from "@/core/data.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const SUN = "#e3a20b";
export const YEAR = 2026;
export const KASHGAR = [75.99, 39.47];
const ZONE_FILE = "time_zones_simple.json";
const NIGHT_FILE = "earth_night_3600.jpg";
const NIGHT_RINGS = [[92, 0.08], [90, 0.4], [87, 0.1], [84, 0.1], [80, 0.16]];
let lightsCanvas = null;
function nightLights() {
  if (!lightsCanvas) lightsCanvas = loadImage(NIGHT_FILE).then((img) => {
    const w = 2048, h = 1024;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, (d[i] + d[i + 1] + d[i + 2]) / 765 - 0.08) / 0.92;
      const q = Math.pow(v, 1.6) * 255 * 1.3;
      d[i] = q; d[i + 1] = q * 0.85; d[i + 2] = q * 0.63; d[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  }).catch(() => null);
  return lightsCanvas;
}

export const meta = {
  id: "time-and-longitude",
  title: "The projection of time",
  track: 4,
  order: 5,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  light: "sun",
  labels: false,
  paragraph: "Noon moves west at 15° of longitude each hour. Time zones are a map of that idea, cut by politics. The terminator is a great circle that tilts with the season. Scrub the time and the date. Compare the solar lines with the real zones.",
  deeper: [
    "4 minutes of time per degree of longitude.",
    "The subsolar latitude is the Sun's declination, ±23.44°.",
    "The equation of time shifts noon by up to 16 minutes.",
    "China uses one zone across 60° of longitude.",
  ],
  keywords: ["time zones", "terminator", "subsolar", "solar time", "longitude"],
  controls: [
    { key: "utc", type: "range", label: "Time (UTC)", min: 0, max: 24, step: 0.1, default: 12, unit: "h", ticks: [0, 6, 12, 18, 24] },
    { key: "doy", type: "range", label: "Day of year", min: 1, max: 366, step: 1, default: 80, ticks: [1, 80, 172, 266, 355] },
    { key: "play", type: "button", label: "Play time", icon: "i-play" },
    { type: "legend", label: "Layers", items: [{ color: BRASS, line: true, label: "Terminator: day and night" }, { color: SIGNAL, line: true, label: "Solar time, one line per hour" }, { color: VIOLET, label: "Time zones (half-hour zones in brass)" }] },
    { key: "terminator", type: "toggle", label: "Terminator", default: true, shortcut: "n" },
    { key: "solar", type: "toggle", label: "Solar lines", default: true, shortcut: "s" },
    { key: "zones", type: "toggle", label: "Time zones", default: true, shortcut: "z" },
    { key: "point", type: "point", label: "Place", default: KASHGAR },
  ],
  readouts: [
    { key: "subsolar", label: "Subsolar point" },
    { key: "solarTime", label: "Solar time at place" },
    { key: "zoneTime", label: "Zone at place" },
    { key: "diff", label: "Zone − solar", digits: 0, unit: "min", hero: true },
  ],
  transport: null,
  compare: null,
  view: null,
  data: [ZONE_FILE],
};

const PREFIX = meta.id + ":";

export function dateFor(doy, utc) {
  return dateFromDayOfYear(YEAR, doy, utc);
}

export function subsolarFor(doy, utc) {
  return subsolar(dateFor(doy, utc));
}

export function zoneAt(zones, lonlat) {
  for (const f of zones.features) if (geo.contains(f, lonlat)) return f.properties;
  return null;
}

export function fmtClock(h) {
  const m = Math.round(mod(h, 24) * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function fmtOffset(z) {
  const s = z < 0 ? "−" : "+";
  const a = Math.abs(z);
  return `UTC${s}${String(Math.floor(a)).padStart(2, "0")}:${String(Math.round((a % 1) * 60)).padStart(2, "0")}`;
}

export function placeTimes(zones, doy, utc, lonlat) {
  const d = dateFor(doy, utc);
  const solar = solarTime(d, lonlat[0]);
  const z = zoneAt(zones, lonlat);
  const zoneTime = z ? mod(utc + z.zone, 24) : null;
  const diff = z ? mod((zoneTime - solar) * 60 + 720, 1440) - 720 : null;
  return { solar, zone: z ? z.zone : null, zoneTime, diff };
}

export function solarMeridians(ss) {
  const out = [];
  for (let k = -12; k < 12; k++) out.push({ hour: mod(12 + k, 24), lon: mod(ss.lon + 15 * k + 180, 360) - 180 });
  return out;
}

export async function mount(ctx) {
  const stage = ctx.stage;
  const map = stage.map;
  const globe = stage.globe;
  const zones = ctx.data.get(ZONE_FILE) || (await ctx.data.load(ZONE_FILE));
  let params = { ...ctx.params };
  let ss = subsolarFor(params.doy, params.utc);
  let zoneAlpha = params.zones ? 1 : 0;
  let zoneTw = null, playTw = null;
  let booted = false;
  let dragging = false;

  const classes = {
    even: { type: "FeatureCollection", features: zones.features.filter((f) => Number.isInteger(f.properties.zone) && mod(f.properties.zone, 2) === 0) },
    odd: { type: "FeatureCollection", features: zones.features.filter((f) => Number.isInteger(f.properties.zone) && mod(f.properties.zone, 2) === 1) },
    frac: { type: "FeatureCollection", features: zones.features.filter((f) => !Number.isInteger(f.properties.zone)) },
  };
  const FILL = { even: [111, 211, 230, 0.13], odd: [167, 139, 250, 0.16], frac: [232, 184, 106, 0.3] };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] * a).toFixed(3)})`;

  const night = () => {
    const anti = [mod(ss.lon + 360, 360) - 180, -ss.lat];
    return NIGHT_RINGS.map(([r, a]) => ({ a, geo: { type: "Polygon", coordinates: [smallCircle(anti[0], anti[1], r, 180)] } }));
  };
  let lights = null;

  const readouts = () => {
    const t = placeTimes(zones, params.doy, params.utc, params.point);
    ctx.readout.setMany({
      subsolar: `${Math.abs(ss.lon).toFixed(1)}°${ss.lon < 0 ? "W" : "E"} ${Math.abs(ss.lat).toFixed(1)}°${ss.lat < 0 ? "S" : "N"}`,
      solarTime: fmtClock(t.solar),
      zoneTime: t.zone === null ? "—" : `${fmtClock(t.zoneTime)} ${fmtOffset(t.zone)}`,
      diff: t.diff === null ? "—" : t.diff,
    });
  };

  const addZones2D = () => {
    if (!map) return;
    for (const k of Object.keys(classes)) {
      if (zoneAlpha <= 0.001) { map.remove(PREFIX + "z-" + k); continue; }
      map.addFeatures(PREFIX + "z-" + k, classes[k], { fill: rgba(FILL[k], zoneAlpha), stroke: `rgba(50,46,40,${(0.28 * zoneAlpha).toFixed(3)})`, width: 0.6, order: 42 });
    }
  };

  const drawSky = (g, path) => {
    if (!params.terminator) return;
    const rings = night();
    for (const n of rings) { g.beginPath(); path(n.geo); g.fillStyle = `rgba(28,38,62,${(n.a * 0.62).toFixed(3)})`; g.fill(); }
    drawLights(g, path, rings[2].geo);
    g.beginPath(); path({ type: "LineString", coordinates: terminator(dateFor(params.doy, params.utc), 360) });
    g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 4; g.stroke();
    g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke();
  };

  const drawLights = (g, path, clip) => {
    const P = map && map.projection;
    if (!lights || !P || !P.rotate) return;
    const r = P.rotate();
    if (Math.abs(r[1]) > 1e-6 || Math.abs(r[2]) > 1e-6) return;
    const c = P([-r[0], 0]), e = P([90 - r[0], 0]), n = P([-r[0], 45]);
    if (!c || !e || !n) return;
    const kx = (e[0] - c[0]) / 90, ky = (c[1] - n[1]) / 45;
    if (!(kx > 0) || !(ky > 0)) return;
    const x0 = c[0] + kx * (-180 + r[0]), y0 = c[1] - ky * 90;
    g.save();
    g.beginPath(); path(clip); g.clip();
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.9;
    g.imageSmoothingEnabled = true;
    for (const k of [-1, 0, 1]) g.drawImage(lights, x0 + k * 360 * kx, y0, 360 * kx, 180 * ky);
    g.restore();
  };

  const drawSolar = (g, path, P) => {
    if (!params.solar) return;
    g.font = `500 10px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "top";
    const top = P([0, 89.9]);
    for (const m of solarMeridians(ss)) {
      const noon = m.hour === 12;
      g.beginPath(); path({ type: "LineString", coordinates: [[m.lon, -90], [m.lon, 0], [m.lon, 90]] });
      g.setLineDash(noon ? [] : [3, 4]);
      g.strokeStyle = noon ? "rgba(227,162,11,.95)" : "rgba(29,99,168,.55)"; g.lineWidth = noon ? 2 : 1; g.stroke();
      g.setLineDash([]);
      const q = P([m.lon, 0]);
      if (q && top && m.hour % (map && map.width < 900 ? 2 : 1) === 0) {
        const y = top[1] + 6;
        const t = String(m.hour).padStart(2, "0");
        g.lineWidth = 3; g.strokeStyle = "rgba(250,248,243,.9)"; g.strokeText(t, q[0], y);
        g.fillStyle = noon ? SUN : SIGNAL; g.fillText(t, q[0], y);
      }
    }
  };

  const drawMarks = (g, path, P) => {
    const t = placeTimes(zones, params.doy, params.utc, params.point);
    const z = zoneAt(zones, params.point);
    if (z && params.zones) {
      const f = zones.features.find((x) => x.properties === z);
      g.beginPath(); path(f); g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke();
    }
    const s = P([ss.lon, ss.lat]);
    if (s) {
      g.save(); g.translate(s[0], s[1]);
      g.strokeStyle = SUN; g.lineWidth = 1.8; g.lineCap = "round";
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.beginPath(); g.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); g.lineTo(Math.cos(a) * 16, Math.sin(a) * 16); g.stroke(); }
      g.beginPath(); g.arc(0, 0, 7.5, 0, Math.PI * 2); g.fillStyle = SUN; g.fill(); g.lineWidth = 2; g.strokeStyle = "#f1ede4"; g.stroke();
      g.restore();
    }
    const p = P(params.point);
    if (p) {
      g.beginPath(); g.arc(p[0], p[1], 5.5, 0, Math.PI * 2); g.fillStyle = INK; g.fill(); g.lineWidth = 2; g.strokeStyle = "#f1ede4"; g.stroke();
      const lines = [`solar ${fmtClock(t.solar)}`, t.zone === null ? "no zone" : `zone ${fmtClock(t.zoneTime)}`];
      g.font = `500 11px ${FONT_MONO}`; g.textAlign = "left"; g.textBaseline = "middle";
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
      const bx = clamp(p[0] + 10, 6, (map ? map.width : 800) - w - 6), by = p[1] - 38;
      g.fillStyle = "rgba(250,248,243,.86)"; g.beginPath(); g.roundRect(bx, by, w, 34, 6); g.fill();
      g.strokeStyle = "rgba(184,82,23,.5)"; g.lineWidth = 1; g.stroke();
      g.fillStyle = SIGNAL; g.fillText(lines[0], bx + 7, by + 10);
      g.fillStyle = BRASS; g.fillText(lines[1], bx + 7, by + 24);
    }
  };

  const caption = () => {
    const t = placeTimes(zones, params.doy, params.utc, params.point);
    const d = dateFor(params.doy, params.utc);
    const eot = sun(d).eot;
    const lines = [`${d.toISOString().slice(5, 10)} ${fmtClock(params.utc)} UTC: the Sun is over ${Math.abs(ss.lon).toFixed(1)}°${ss.lon < 0 ? "W" : "E"}`, `Equation of time ${eot >= 0 ? "+" : "−"}${Math.abs(eot).toFixed(1)} min. Declination ${ss.lat.toFixed(2)}°.`];
    if (t.diff !== null) lines.push(Math.abs(t.diff) < 20 ? "At the place, clock and Sun agree within 20 minutes." : `At the place, the clock is ${Math.abs(t.diff).toFixed(0)} min ${t.diff > 0 ? "ahead of" : "behind"} the Sun.`);
    return lines;
  };

  const draw3D = () => {
    if (!globe) return;
    globe.setSun(ss.lon, ss.lat);
    const segs = (pts) => { const s = []; for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]); return s; };
    if (params.terminator) globe.addLines(PREFIX + "term", segs(terminator(dateFor(params.doy, params.utc), 360)), { color: BRASS, width: 2.2, depth: true }); else globe.remove(PREFIX + "term");
    if (params.solar) {
      const minor = [], noon = [];
      for (const m of solarMeridians(ss)) { const s = []; for (let la = -88; la < 88; la += 2) s.push([[m.lon, la], [m.lon, la + 2]]); (m.hour === 12 ? noon : minor).push(...s); }
      globe.addLines(PREFIX + "solar", minor, { color: "rgba(29,99,168,.55)", width: 1, depth: true, dash: [3, 4] });
      globe.addLines(PREFIX + "noon", noon, { color: SUN, width: 2, depth: true });
    } else { globe.remove(PREFIX + "solar"); globe.remove(PREFIX + "noon"); }
    if (zoneAlpha > 0.001) {
      for (const k of Object.keys(classes)) globe.addPolygons(PREFIX + "z-" + k, classes[k], { fill: rgba(FILL[k], zoneAlpha * 2.6), stroke: `rgba(50,46,40,${(0.3 * zoneAlpha).toFixed(3)})`, width: 0.8 });
    } else for (const k of Object.keys(classes)) globe.remove(PREFIX + "z-" + k);
    globe.addPoints(PREFIX + "sun", [[ss.lon, ss.lat]], { color: SUN, size: 16 });
    globe.addPoints(PREFIX + "place", [params.point], { color: INK, size: 10 });
    const t = placeTimes(zones, params.doy, params.utc, params.point);
    ctx.overlay.label(PREFIX + "place", { lon: params.point[0], lat: params.point[1] }, `solar ${fmtClock(t.solar)} · zone ${t.zoneTime === null ? "—" : fmtClock(t.zoneTime)}`, { color: INK, leader: true, dx: 16, dy: -22, mono: true });
    ctx.overlay.label(PREFIX + "sun", { lon: ss.lon, lat: ss.lat }, "subsolar point", { color: SUN, leader: true, dx: 16, dy: 22, mono: true });
  };

  const refresh = () => {
    ss = subsolarFor(params.doy, params.utc);
    if (map) { addZones2D(); map.invalidate(); }
    draw3D();
    readouts();
    ctx.overlay.update();
  };

  const fadeZones = () => {
    if (zoneTw) zoneTw.cancel();
    const to = params.zones ? 1 : 0;
    if (ctx.reducedMotion || !booted) { zoneAlpha = to; refresh(); return; }
    zoneTw = ctx.anim.tween({ from: zoneAlpha, to, duration: 320, ease: ctx.anim.ease.standard, onUpdate: (v) => { zoneAlpha = v; if (map) { addZones2D(); map.invalidate(); } else draw3D(); }, onDone: () => { zoneTw = null; } });
  };

  const stopPlay = () => {
    if (!playTw) return;
    playTw.cancel();
    playTw = null;
    ctx.controls.setLabel("play", "Play time");
    ctx.controls.set("utc", Math.round(params.utc * 10) / 10);
  };
  const startPlay = () => {
    const from = params.utc;
    ctx.controls.setLabel("play", "Pause");
    const run = (start) => {
      playTw = ctx.anim.tween({ from: start, to: start + 24, duration: 24 * 500, ease: ctx.anim.ease.linear, onUpdate: (v) => ctx.controls.set("utc", Math.round(mod(v, 24) * 1000) / 1000, { live: true }), onDone: () => run(mod(start, 24)) });
    };
    run(from);
  };

  if (map) nightLights().then((c) => { if (!c || ctx.signal.aborted) return; lights = c; map.invalidate(); });
  if (map) {
    map.setInsets({ top: 0, bottom: stage.insetBottom });
    await map.setProjection("equirectangular", { duration: 0 });
    addZones2D();
    map.addLayer(PREFIX + "sky", drawSky, { order: 50 });
    map.addLayer(PREFIX + "solar", drawSolar, { order: 52 });
    map.addLayer(PREFIX + "marks", drawMarks, { order: 58, clip: false });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 18, 14, caption(), { accent: SUN }), { order: 90, clip: false });
    map.setDragFilter((x, y) => { const s = map.projection([ss.lon, ss.lat]); return s && Math.hypot(s[0] - x, s[1] - y) < 18 ? "sun" : null; });
  }
  const offs = [];
  if (map) {
    offs.push(map.on("customdrag", (e) => {
      if (e.phase === "start") { stopPlay(); dragging = true; map.canvas.style.cursor = "grabbing"; return; }
      if (e.phase === "move") {
        const ll = map.pick(e.x, e.y);
        if (!ll) return;
        let u = params.utc;
        for (let i = 0; i < 3; i++) { const s = subsolarFor(params.doy, u); u = mod(u + (mod(s.lon - ll.lon + 180, 360) - 180) / 15, 24); }
        ctx.controls.set("utc", Math.round(u * 10) / 10, { live: true });
        return;
      }
      dragging = false;
      map.canvas.style.cursor = "grab";
      ctx.controls.set("utc", params.utc);
    }));
    map.canvas.addEventListener("pointermove", (ev) => {
      if (dragging) return;
      const r = map.canvas.getBoundingClientRect();
      const s = map.projection([ss.lon, ss.lat]);
      map.canvas.style.cursor = s && Math.hypot(s[0] - (ev.clientX - r.left), s[1] - (ev.clientY - r.top)) < 18 ? "ew-resize" : "grab";
    }, { signal: ctx.signal });
  }
  if (globe && ctx.side === "A") globe.camera.lookAt(mod(ss.lon + 125, 360) - 180, 15, null, { duration: 0 });
  refresh();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("play")) { if (playTw) stopPlay(); else startPlay(); return; }
      if (keys.includes("zones") && keys.length === 1) { fadeZones(); readouts(); return; }
      if (keys.length > 2) zoneAlpha = params.zones ? 1 : 0;
      refresh();
    },
    hover(lon, lat) {
      const t = placeTimes(zones, params.doy, params.utc, [lon, lat]);
      return [`solar ${fmtClock(t.solar)}`, t.zone === null ? "no zone" : `zone ${fmtClock(t.zoneTime)} ${fmtOffset(t.zone)}`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(4), +lat.toFixed(4)]);
      return null;
    },
    unprobe() {},
    resize() { refresh(); },
    unmount() {
      if (zoneTw) zoneTw.cancel();
      if (playTw) { playTw.cancel(); playTw = null; }
      for (const off of offs) off();
      if (map) { map.setDragFilter(null); map.removePrefix(PREFIX); }
      if (globe) globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
    },
  };
}
