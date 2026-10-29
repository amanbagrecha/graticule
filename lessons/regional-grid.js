import { make, coneConstant } from "@/core/projections.js";
import { zone as utmZone, centralMeridian, K0 } from "@/core/utm.js";
import { DEG, clamp } from "@/core/math.js";
import { sampleField, contourSegments, drawLegend, drawCaption, FONT_MONO } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const HALO = "rgba(250,248,243,.85)";
const BELOW_RGB = [43, 101, 173];
const ABOVE_RGB = [184, 82, 23];
const BELOW_ALPHA = 0.6;
const ABOVE_ALPHA = 0.45;
const BLEND = "soft-light";
const LEGEND_BG = [118, 126, 128];

export function fieldTint(t) {
  const v = clamp(t, -1, 1);
  const rgb = v < 0 ? BELOW_RGB : ABOVE_RGB;
  return [rgb[0], rgb[1], rgb[2], (v < 0 ? BELOW_ALPHA : ABOVE_ALPHA) * Math.pow(Math.abs(v), 0.8)];
}

export function softLight(cb, cs) {
  if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
  const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

export function overBackground(t, bg = LEGEND_BG) {
  const [r, g, b, a] = fieldTint(t);
  return [r, g, b].map((c, i) => Math.round(255 * ((1 - a) * bg[i] / 255 + a * softLight(bg[i] / 255, c / 255))));
}

function tintImage(values, gw, gh, tintAt, canvas) {
  if (typeof document === "undefined") return null;
  const c = canvas || document.createElement("canvas");
  if (c.width !== gw || c.height !== gh) { c.width = gw; c.height = gh; }
  const g = c.getContext("2d");
  const img = g.createImageData(gw, gh);
  const d = img.data;
  for (let q = 0; q < values.length; q++) {
    const v = values[q];
    if (v !== v) continue;
    const col = tintAt(v);
    d[q * 4] = col[0]; d[q * 4 + 1] = col[1]; d[q * 4 + 2] = col[2]; d[q * 4 + 3] = Math.round(col[3] * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

export const PRESETS = {
  victoria: { label: "Victoria (36 S, 38 S)", lat1: -36, lat2: -38, lat0: -37, lon0: 145, property: "conformal", region: { west: 140.9, east: 150.0, south: -39.2, north: -33.9 } },
  europe: { label: "Europe LCC (35 N, 65 N)", lat1: 35, lat2: 65, lat0: 52, lon0: 10, property: "conformal", region: { west: -25, east: 45, south: 34, north: 72 } },
  usa: { label: "USA Albers (29.5 N, 45.5 N)", lat1: 29.5, lat2: 45.5, lat0: 23, lon0: -96, property: "equal-area", region: { west: -124.79, east: -66.91, south: 24.41, north: 49.38 } },
};

export const meta = {
  id: "regional-grid",
  title: "One grid for one region",
  track: 5,
  order: 3,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "lcc",
  paragraph: "A region wider than it is tall does not fit a UTM strip. A conic with two standard parallels fits it better. Scale is true on both parallels, a little small between them and a little large outside. The error does not change along a parallel.",
  deeper: [
    "Two standard parallels halve the error compared with one.",
    "Between 36 S and 38 S the scale dips to 0.99985.",
    "Albers is the equal-area version of the same cone.",
    "A state grid is a projection plus a datum of its time.",
  ],
  keywords: ["Lambert conformal conic", "regional", "standard parallels", "state grid", "Albers"],
  controls: [
    { key: "preset", type: "select", label: "Region", options: [
      { value: "victoria", label: "Victoria", description: "Lambert conformal, 36° S and 38° S" },
      { value: "europe", label: "Europe LCC", description: "Lambert conformal, 35° N and 65° N" },
      { value: "usa", label: "USA Albers", description: "Equal-area cone, 29.5° N and 45.5° N" },
      { value: "custom", label: "Custom", description: "Drag the parallels" },
    ], default: "victoria" },
    { key: "lat1", type: "range", label: "Standard parallel 1", min: -80, max: 80, step: 0.5, default: -36, unit: "°", fillFrom: 0, ticks: [-80, -40, 0, 40, 80] },
    { key: "lat2", type: "range", label: "Standard parallel 2", min: -80, max: 80, step: 0.5, default: -38, unit: "°", fillFrom: 0, ticks: [-80, -40, 0, 40, 80] },
    { key: "field", type: "toggle", label: "Scale field", default: true, shortcut: "f" },
    { key: "grid", type: "hidden", default: "conic", url: false },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "Standard parallel, k = 1" },
      { color: "rgba(26,25,23,.7)", dash: true, label: "The region" },
      { color: `rgb(${BELOW_RGB.join(",")})`, label: "k below 1" },
      { color: BRASS, label: "k above 1" },
    ] },
  ],
  readouts: [
    { key: "kprobe", label: "k at probe", digits: 5, hero: true },
    { key: "kmid", label: "k midway", digits: 5 },
    { key: "kcorner", label: "k at corners" },
    { key: "n", label: "Cone constant n", digits: 4 },
  ],
  transport: null,
  compare: { key: "grid", value: "utm" },
  view: null,
  data: ["countries-50m.json", "crs.json"],
};

const PREFIX = meta.id + ":";

export function coneN(property, lat1, lat2) {
  return coneConstant(property, lat1, lat2);
}

export function kConic(property, lat1, lat2, lat) {
  const n = coneN(property, lat1, lat2);
  const p1 = lat1 * DEG, p = clamp(lat, -89.9, 89.9) * DEG;
  if (property === "equal-area") {
    const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
    const rho = Math.sqrt(Math.max(0, C - 2 * n * Math.sin(p))) / Math.abs(n);
    return (Math.abs(n) * rho) / Math.cos(p);
  }
  const t = (q) => Math.tan(Math.PI / 4 + q / 2);
  const F = (Math.cos(p1) * Math.pow(t(p1), n)) / n;
  const rho = F / Math.pow(t(p), n);
  return (n * rho) / Math.cos(p);
}

export function kTM(lon, lat, cm) {
  const B = Math.cos(lat * DEG) * Math.sin(((lon - cm + 540) % 360 - 180) * DEG);
  return K0 / Math.sqrt(1 - B * B);
}

export function setupOf(params, last = "europe") {
  const base = PRESETS[params.preset] || PRESETS[last] || PRESETS.europe;
  const lat1 = params.lat1, lat2 = params.lat2;
  const region = { ...base.region };
  if (!PRESETS[params.preset]) {
    region.south = Math.max(-85, Math.min(region.south, Math.min(lat1, lat2) - 3));
    region.north = Math.min(85, Math.max(region.north, Math.max(lat1, lat2) + 3));
  }
  const property = base.property;
  const lon0 = base.lon0;
  const lat0 = PRESETS[params.preset] ? base.lat0 : (lat1 + lat2) / 2;
  const zone = utmZone(lon0, lat0);
  return { lat1, lat2, lat0, lon0, property, region, zone, cm: centralMeridian(zone), n: coneN(property, lat1, lat2) };
}

export function kAt(setup, grid, lon, lat) {
  return grid === "utm" ? kTM(lon, lat, setup.cm) : kConic(setup.property, setup.lat1, setup.lat2, lat);
}

export function cornerKs(setup, grid) {
  const r = setup.region;
  return [[r.west, r.north], [r.east, r.north], [r.east, r.south], [r.west, r.south]].map(([lon, lat]) => kAt(setup, grid, lon, lat));
}

export function errorScales(setup) {
  const mid = kConic(setup.property, setup.lat1, setup.lat2, (setup.lat1 + setup.lat2) / 2);
  const ks = [...cornerKs(setup, "conic"), mid];
  const lo = Math.max(2e-6, ...ks.map((k) => 1 - k));
  const hi = Math.max(2e-6, ...ks.map((k) => k - 1));
  return { lo, hi };
}

const fmtLat = (v) => `${Math.abs(v)}° ${v < 0 ? "S" : "N"}`;
const fmtK = (k) => k.toFixed(5);

export async function mount(ctx) {
  const map = ctx.stage.map;
  const crs = ctx.data.get("crs.json") || (await ctx.data.load("crs.json"));
  const albers = crs && crs.crs && crs.crs["5070"];
  if (albers && albers.standardParallels) Object.assign(PRESETS.usa, { lat1: albers.standardParallels[0], lat2: albers.standardParallels[1], lat0: albers.latitudeOfOrigin, lon0: albers.centralMeridian });
  const side = ctx.side;
  let params = { ...ctx.params };
  let lastPreset = PRESETS[params.preset] ? params.preset : "europe";
  let setup = setupOf(params, lastPreset);
  let shownKey = "";
  let field = null, fieldKey = "", fieldCanvas = null, fieldAlpha = 1;
  let probed = null;
  let dragging = null;
  let slide = null;
  let displayTimer = 0;
  let booted = false;
  let applying = false;
  let capBox = null, taken = [];
  map.labelLayer.avoid = () => taken;
  const grid = () => (params.grid === "utm" ? "utm" : "conic");
  const accent = side === "B" ? VIOLET : SIGNAL;

  map.setLayer("borders", true);

  const layout = () => map.setInsets({ top: 12, left: 12, right: 12, bottom: ctx.stage.insetBottom + 12 });

  const displayProjection = () => {
    if (grid() === "utm") return make("transverseMercator", { lon0: setup.cm });
    const id = setup.property === "equal-area" ? "albers" : "lcc";
    return make(id, { parallels: [setup.lat1, setup.lat2], lon0: setup.lon0 });
  };

  const fitGeo = () => {
    const r = setup.region, pts = [];
    for (let i = 0; i <= 8; i++) { const lo = r.west + ((r.east - r.west) * i) / 8; pts.push([lo, r.south], [lo, r.north]); }
    for (let j = 0; j <= 8; j++) { const la = r.south + ((r.north - r.south) * j) / 8; pts.push([r.west, la], [r.east, la]); }
    return { type: "MultiPoint", coordinates: pts };
  };

  const applyDisplay = async (animate) => {
    const key = [grid(), setup.property, setup.lat1, setup.lat2, setup.lon0, setup.cm, JSON.stringify(setup.region)].join("|");
    if (key === shownKey) return;
    shownKey = key;
    map.setFitTarget(fitGeo());
    await map.setProjection(displayProjection(), { duration: animate && !ctx.reducedMotion ? 650 : 0, tag: key });
    fadeField();
    map.invalidate();
  };

  const scheduleDisplay = () => {
    clearTimeout(displayTimer);
    displayTimer = setTimeout(() => applyDisplay(false), dragging ? 400 : 260);
  };

  const fadeField = () => {
    if (ctx.reducedMotion) { fieldAlpha = 1; return; }
    ctx.anim.tween({ from: 0.25, to: 1, duration: 240, ease: ctx.anim.ease.out, onUpdate: (v) => { fieldAlpha = v; map.invalidate(); } });
  };

  const colourAt = (k) => {
    const s = errorScales(setup);
    return fieldTint(k < 1 ? (k - 1) / s.lo : (k - 1) / s.hi);
  };

  const legendBox = () => {
    const w = 170;
    return { x: side === "B" ? map.width - w - 42 : 18, y: map.height - ctx.stage.insetBottom - 74, w };
  };

  const panels = () => {
    const out = capBox ? [capBox] : [];
    if (params.field) { const L = legendBox(); out.push([L.x, L.y, L.x + L.w + 24, L.y + 58]); }
    return out;
  };

  const hitIn = (b, list) => list.find((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);

  const text = (g, s, x, y, color, align = "left") => {
    const w = g.measureText(s).width, x0 = align === "right" ? x - w : x;
    g.textAlign = align;
    g.lineWidth = 3; g.strokeStyle = HALO; g.strokeText(s, x, y);
    g.fillStyle = color; g.fillText(s, x, y);
    taken.push([x0 - 3, y - 11, x0 + w + 3, y + 4]);
  };

  const parallelLine = (lat) => {
    const r = setup.region, pts = [];
    const w = Math.min(r.west, setup.lon0 - 40), e = Math.max(r.east, setup.lon0 + 40);
    for (let lo = w; lo <= e; lo += 1) pts.push([lo, lat]);
    return { type: "LineString", coordinates: pts };
  };

  map.addLayer(PREFIX + "field", (g, path, P) => {
    taken = [];
    if (!params.field) return;
    const key = map.stateKey() + "|" + [grid(), setup.property, setup.lat1, setup.lat2, setup.cm].join(",");
    if (!field || key !== fieldKey) {
      field = sampleField(P, map.width, map.height, map.interacting || dragging ? 8 : 4, (lon, lat) => kAt(setup, grid(), lon, lat));
      fieldCanvas = tintImage(field.values, field.gw, field.gh, colourAt, fieldCanvas);
      fieldKey = key;
    }
    g.save();
    g.globalAlpha = fieldAlpha;
    g.globalCompositeOperation = BLEND;
    g.imageSmoothingEnabled = true;
    g.drawImage(fieldCanvas, field.x0, field.y0, field.gw * field.step, field.gh * field.step);
    g.restore();
    const s = errorScales(setup);
    const levels = [-s.lo / 2, s.hi / 2, s.hi].map((d) => 1 + d);
    g.lineWidth = 1;
    for (const lv of levels) {
      const segs = contourSegments(field.values, field.gw, field.gh, field.step, lv, { x0: field.x0, y0: field.y0, quantum: 1e-8 });
      if (!segs.length) continue;
      g.beginPath();
      for (const [a, b] of segs) { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
      g.setLineDash([4, 3]);
      g.lineWidth = 2.5; g.strokeStyle = "rgba(250,248,243,.45)"; g.stroke();
      g.lineWidth = 1.25; g.strokeStyle = lv < 1 ? "rgba(61,110,180,.95)" : "rgba(201,130,20,.95)"; g.stroke();
      g.setLineDash([]);
      const [a, b] = segs[Math.floor(segs.length / 2)];
      const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      const L = legendBox();
      const onLegend = x > L.x - 60 && x < L.x + L.w + 24 && y > L.y - 6 && y < L.y + 64;
      g.font = `500 10px ${FONT_MONO}`;
      const tw = g.measureText(lv.toFixed(5)).width;
      if (!onLegend && x > 20 && x < map.width - 80 && y > 20 && y < map.height - 20 && !hitIn([x + 1, y - 14, x + tw + 7, y], panels())) {
        text(g, lv.toFixed(5), x + 4, y - 4, INK2);
        g.lineWidth = 1;
      }
    }
  }, { order: 46 });

  map.addLayer(PREFIX + "lines", (g, path, P) => {
    const r = setup.region;
    const ring = [];
    for (let lo = r.west; lo <= r.east; lo += 0.5) ring.push([lo, r.north]);
    for (let la = r.north; la >= r.south; la -= 0.5) ring.push([r.east, la]);
    for (let lo = r.east; lo >= r.west; lo -= 0.5) ring.push([lo, r.south]);
    for (let la = r.south; la <= r.north; la += 0.5) ring.push([r.west, la]);
    g.beginPath(); path({ type: "LineString", coordinates: ring });
    g.strokeStyle = "rgba(26,25,23,.7)"; g.lineWidth = 1.25; g.setLineDash([6, 4]); g.stroke(); g.setLineDash([]);
    g.font = `500 11px ${FONT_MONO}`;
    if (grid() === "conic") {
      for (const [i, lat] of [[1, setup.lat1], [2, setup.lat2]]) {
        g.beginPath(); path(parallelLine(lat));
        g.strokeStyle = BRASS; g.lineWidth = dragging && dragging.key === "lat" + i ? 3.25 : 2.25; g.stroke();
        const q = P([r.west, lat]);
        if (q) {
          const s = `${fmtLat(lat)} · k = 1`, y = clamp(q[1] - 7, 14, map.height - 8);
          let x = clamp(q[0] + 8, 8, map.width - 160);
          const hit = hitIn([x - 3, y - 11, x + g.measureText(s).width + 3, y + 4], panels());
          if (hit) x = hit[2] + 8;
          text(g, s, x, y, BRASS);
        }
      }
    } else {
      const segs = [];
      for (const s of [-3, 3]) { const pts = []; for (let la = r.south - 5; la <= r.north + 5; la += 0.5) pts.push([setup.cm + s, la]); segs.push(pts); }
      g.beginPath(); path({ type: "MultiLineString", coordinates: segs });
      g.strokeStyle = "rgba(26,25,23,.85)"; g.lineWidth = 1.5; g.stroke();
      const q = P([setup.cm + 3, (r.south + r.north) / 2]);
      if (q) text(g, `zone ${setup.zone} edge`, q[0] + 6, q[1], INK);
    }
    const ks = cornerKs(setup, grid());
    [[r.west, r.north], [r.east, r.north], [r.east, r.south], [r.west, r.south]].forEach(([lon, lat], i) => {
      const q = P([lon, lat]);
      if (!q || q[0] < 0 || q[0] > map.width || q[1] < 0 || q[1] > map.height) return;
      g.fillStyle = INK; g.beginPath(); g.arc(q[0], q[1], 3, 0, Math.PI * 2); g.fill();
      const right = i === 1 || i === 2, below = i >= 2;
      const x = q[0] + (right ? -6 : 6), w = g.measureText(fmtK(ks[i])).width, x0 = right ? x - w : x;
      const y = [q[1] + (below ? -8 : 16), q[1] + (below ? 16 : -8)].find((v) => !hitIn([x0 - 3, v - 11, x0 + w + 3, v + 4], [...panels(), ...taken]));
      if (y !== undefined) text(g, fmtK(ks[i]), x, y, INK, right ? "right" : "left");
    });
  }, { order: 55 });

  map.addLayer(PREFIX + "chrome", (g) => {
    const name = grid() === "utm" ? `UTM zone ${setup.zone} · transverse Mercator` : setup.property === "equal-area" ? "Albers equal-area conic" : "Lambert conformal conic";
    const sub = grid() === "utm" ? `Central meridian ${Math.abs(setup.cm)}° ${setup.cm < 0 ? "W" : "E"}, k0 = 0.9996.` : `Standard parallels ${fmtLat(setup.lat1)} and ${fmtLat(setup.lat2)}.`;
    const right = side === "B";
    const cap = drawCaption(g, right ? map.width - 18 : 18, 14, [name, sub, grid() === "utm" ? "The strip is 6° wide." : "k does not change along a parallel."], { accent: right ? VIOLET : BRASS, align: right ? "right" : "left" });
    const cx = right ? map.width - 18 - cap.w : 18, box = [cx, 14, cx + cap.w, 14 + cap.h];
    if (!capBox || box.some((v, i) => v !== capBox[i])) { capBox = box; map.invalidate(); }
    taken.push(...panels());
    if (params.field) {
      const s = errorScales(setup);
      const L = legendBox();
      drawLegend(g, { x: L.x, y: L.y, w: L.w, colourAt: (t) => overBackground(2 * t - 1), ticks: [{ t: 0, label: (1 - s.lo).toFixed(5) }, { t: 0.5, label: "1" }, { t: 1, label: (1 + s.hi).toFixed(5) }], title: "Scale factor k" });
    }
  }, { order: 90, clip: false });

  const readouts = () => {
    const mid = (setup.lat1 + setup.lat2) / 2;
    const ks = cornerKs(setup, grid());
    ctx.readout.setMany({
      kprobe: probed ? kAt(setup, grid(), probed.lon, probed.lat) : null,
      kmid: kAt(setup, grid(), grid() === "utm" ? setup.cm : setup.lon0, mid),
      kcorner: `${fmtK(Math.min(...ks))} – ${fmtK(Math.max(...ks))}`,
      n: grid() === "utm" ? "–" : setup.n,
    });
  };

  const nearParallel = (x, y) => {
    if (grid() !== "conic") return null;
    const ll = map.pick(x, y);
    if (!ll) return null;
    let best = null;
    for (const [key, lat] of [["lat1", setup.lat1], ["lat2", setup.lat2]]) {
      const q = map.projection([ll.lon, lat]);
      if (!q) continue;
      const d = Math.hypot(q[0] - x, q[1] - y);
      if (d < 9 && (!best || d < best.d)) best = { key, d };
    }
    return best ? { key: best.key } : null;
  };

  const slideTo = (lat1, lat2) => {
    if (slide) slide.cancel();
    const a1 = params.lat1, a2 = params.lat2;
    if (!booted || ctx.reducedMotion) { applying = true; ctx.controls.set("lat1", lat1); ctx.controls.set("lat2", lat2); applying = false; return; }
    slide = ctx.anim.tween({ from: 0, to: 1, duration: 240, ease: ctx.anim.ease.standard, onUpdate: (u) => {
      applying = true;
      ctx.controls.set("lat1", Math.round((a1 + (lat1 - a1) * u) * 2) / 2, { live: u < 1 });
      ctx.controls.set("lat2", Math.round((a2 + (lat2 - a2) * u) * 2) / 2, { live: u < 1 });
      applying = false;
    }, onDone: () => { slide = null; } });
  };

  if (side === "A") {
    map.setDragFilter((x, y) => nearParallel(x, y));
    const off = map.on("customdrag", (e) => {
      if (e.phase === "start") { dragging = e.claim; map.canvas.style.cursor = "ns-resize"; map.invalidate(); return; }
      if (e.phase === "move") {
        const ll = map.pick(e.x, e.y);
        if (!ll) return;
        ctx.controls.set(dragging.key, clamp(Math.round(ll.lat * 2) / 2, -80, 80), { live: true });
        return;
      }
      const key = dragging && dragging.key;
      dragging = null;
      map.canvas.style.cursor = "grab";
      if (key) ctx.controls.set(key, params[key]);
      map.invalidate();
    });
    ctx.signal.addEventListener("abort", off);
    map.canvas.addEventListener("pointermove", (ev) => {
      if (dragging) return;
      const r = map.canvas.getBoundingClientRect();
      map.canvas.style.cursor = nearParallel(ev.clientX - r.left, ev.clientY - r.top) ? "ns-resize" : "grab";
    }, { signal: ctx.signal });
  }

  layout();
  await applyDisplay(false);
  readouts();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (keys.includes("preset") && PRESETS[params.preset]) {
        lastPreset = params.preset;
        const pr = PRESETS[params.preset];
        if (side === "A" && (prev.lat1 !== pr.lat1 || prev.lat2 !== pr.lat2)) {
          setup = setupOf({ ...params, lat1: pr.lat1, lat2: pr.lat2 }, lastPreset);
          shownKey = "";
          applyDisplay(booted).then(() => slideTo(pr.lat1, pr.lat2));
          setup = setupOf(params, lastPreset);
          readouts();
          map.invalidate();
          return;
        }
      }
      if ((keys.includes("lat1") || keys.includes("lat2")) && !applying && side === "A" && PRESETS[params.preset]) {
        const pr = PRESETS[params.preset];
        if (params.lat1 !== pr.lat1 || params.lat2 !== pr.lat2) { lastPreset = params.preset; params.preset = "custom"; Promise.resolve().then(() => ctx.controls.set("preset", "custom")); }
      }
      setup = setupOf(params, lastPreset);
      if (keys.length > 2 || keys.includes("grid") || keys.includes("preset")) applyDisplay(false);
      else if (keys.includes("lat1") || keys.includes("lat2")) scheduleDisplay();
      if (keys.includes("field")) fadeField();
      readouts();
      map.invalidate();
    },
    hover(lon, lat) {
      const k = kAt(setup, grid(), lon, lat);
      const mm = (k - 1) * 1e6;
      return [`k = ${k.toFixed(5)}`, `${mm >= 0 ? "+" : "−"}${Math.abs(mm).toFixed(0)} mm per km`];
    },
    probe(lon, lat) {
      probed = { lon, lat };
      return { kprobe: kAt(setup, grid(), lon, lat) };
    },
    unprobe() {
      probed = null;
      readouts();
    },
    resize() { layout(); map.invalidate(); },
    unmount() {
      clearTimeout(displayTimer);
      if (slide) slide.cancel();
      map.setDragFilter(null);
      map.canvas.style.cursor = "grab";
      map.setLayer("borders", false);
      map.removePrefix(PREFIX);
      map.labelLayer.avoid = null;
      map.setFitTarget(null);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
    },
  };
}
