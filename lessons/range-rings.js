import { sphereDistance, sphereBearing, antipode, R_MEAN } from "@/core/geodesy.js";
import { geo, smallCircle, drawCaption, FONT_MONO, FONT_UI } from "@/core/map2d.js";
import { DEG, clamp, lonLatToXYZ, xyzToLonLat, slerp } from "@/core/math.js";

export const meta = {
  id: "range-rings",
  title: "Distance from one point",
  track: 3,
  order: 6,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "azimuthalEquidistant",
  labels: false,
  paragraph: "Centre the map on your city. Every straight line from the centre is a true direction. Every ring is a true distance. The far edge of the map is one point, the antipode, stretched into a circle. Airlines and radio operators use this map.",
  deeper: [
    "The outer edge is at π R = 20,015 km.",
    "All directions from the centre are true.",
    "Areas near the edge are stretched by c/sin c.",
    "The UN emblem uses this map to 60 S.",
  ],
  keywords: ["azimuthal equidistant", "range ring", "distance", "bearing", "antipode"],
  controls: [
    { key: "centre", type: "point", label: "Centre", default: [-74.0, 40.7] },
    { key: "ringStep", type: "segment", label: "Ring step", options: [{ value: "1000", label: "1,000 km" }, { value: "2000", label: "2,000 km" }, { value: "5000", label: "5,000 km" }], default: "2000" },
    { key: "bearings", type: "toggle", label: "Bearings", default: true, shortcut: "b" },
    { key: "antipode", type: "toggle", label: "Antipode", default: true, shortcut: "a" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", line: true, label: "Range ring, true distance" }, { color: "rgba(60,52,40,.6)", line: true, label: "Bearing line, true direction" }, { color: "#b85217", line: true, label: "Edge of the map: the antipode" }] },
  ],
  readouts: [
    { key: "dist", label: "Distance to pointer", digits: 0, unit: "km", hero: true },
    { key: "bearing", label: "Bearing", digits: 1, unit: "°" },
    { key: "anti", label: "Antipode", mono: true },
    { key: "rings", label: "Rings", digits: 0 },
  ],
  transport: null,
  compare: null,
  view: null,
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
export const R_KM = R_MEAN / 1000;
export const EDGE_KM = Math.PI * R_KM;
const INSET_TOP = 60;
const CAP_X = 20, CAP_Y = 16;
const LABEL_GAP = 24;

export function ringRadii(stepKm) {
  const out = [];
  for (let d = stepKm; d < EDGE_KM - 1; d += stepKm) out.push(d);
  return out;
}

export function distanceKm(a, b) {
  return sphereDistance(a[0], a[1], b[0], b[1]) / 1000;
}

export function bearingDeg(a, b) {
  return (sphereBearing(a[0], a[1], b[0], b[1]) + 360) % 360;
}

export function antipodeOf(p) {
  return antipode(p[0], p[1]);
}

export function ringLabelEvery(radiusPx, stepKm) {
  const s = (radiusPx * stepKm) / EDGE_KM;
  return [1, 2, 5, 10, 20].find((k) => s * k >= LABEL_GAP) || 20;
}

export function captionLayout(sets, W, measure) {
  const width = (lines) => Math.max(...lines.map((l, i) => measure(l, i === 0)));
  const room = Math.min(420, W - CAP_X - 36);
  const fit = sets.filter((s) => width(s) <= room);
  const pool = fit.length ? fit : sets.slice(-1);
  const beside = pool.find((s) => CAP_X + width(s) + 28 <= W / 2 - 8);
  const lines = beside || pool[pool.length - 1];
  const h = 34 + 17 * (lines.length - 1);
  return { lines, top: beside ? INSET_TOP : Math.max(INSET_TOP, CAP_Y + h - 3) };
}

const fmtKm = (v) => Math.round(v).toLocaleString("en-US");

export async function mount(ctx) {
  const map = ctx.stage.map;
  const globe = ctx.stage.globe;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal, ink = palette.ui.ink;
  let params = { ...ctx.params };
  let centre = params.centre.slice();
  let pointer = null;
  let ripple = 1, rippleTween = null;
  let glide = null;

  const step = () => Number(params.ringStep) || 2000;

  const runRipple = () => {
    if (rippleTween) rippleTween.cancel();
    if (ctx.reducedMotion) { ripple = 1; return; }
    ripple = 0;
    const n = ringRadii(step()).length;
    rippleTween = ctx.anim.tween({ from: 0, to: 1, duration: 300 + n * 40, ease: ctx.anim.ease.linear, onUpdate: (v) => { ripple = v; if (map) map.invalidate(); } });
  };
  const ringAlpha = (i, n) => {
    if (ripple >= 1) return 1;
    const total = 300 + n * 40;
    return ctx.anim.ease.out(clamp((ripple * total - i * 40) / 300, 0, 1));
  };

  const readouts = (extra = {}) => {
    const a = antipodeOf(centre);
    ctx.readout.setMany({ anti: `${ctx.fmt.lat(a[1])} ${ctx.fmt.lon(a[0])}`, rings: ringRadii(step()).length, ...extra });
  };

  const tag = (g, x, y, text, colour, align = "center") => {
    g.font = `600 10.5px ${FONT_MONO}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(250,248,243,.92)";
    g.strokeText(text, x, y);
    g.fillStyle = colour;
    g.fillText(text, x, y);
  };

  const geometry = (projection) => {
    const c = projection(centre);
    const e = projection(geoDest(centre, 0, 179.9));
    if (!c || !e) return null;
    return { c, R: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  };

  const layer = (g, path, projection) => {
    const gm = geometry(projection);
    if (!gm) return;
    const { c, R } = gm;
    const radii = ringRadii(step());
    if (params.bearings) {
      for (let b = 0; b < 360; b += 30) {
        const q = projection(geoDest(centre, b, 179.5));
        if (!q) continue;
        g.strokeStyle = b % 90 === 0 ? "rgba(60,52,40,.6)" : "rgba(60,52,40,.38)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    }
    radii.forEach((d, i) => {
      const a = ringAlpha(i, radii.length);
      if (a <= 0) return;
      g.globalAlpha = a;
      g.beginPath();
      path({ type: "Polygon", coordinates: [smallCircle(centre[0], centre[1], (d / R_KM) / DEG, 240)] });
      const major = d % 10000 === 0;
      g.strokeStyle = "rgba(250,248,243,.5)"; g.lineWidth = major ? 3.5 : 3; g.stroke();
      g.strokeStyle = signal; g.lineWidth = major ? 1.8 : 1.2; g.stroke();
      g.globalAlpha = 1;
    });
    if (params.antipode && R > 0) {
      g.strokeStyle = "rgba(250,248,243,.6)"; g.lineWidth = 6;
      g.beginPath(); g.arc(c[0], c[1], R - 1.5, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = brass; g.lineWidth = 3;
      g.beginPath(); g.arc(c[0], c[1], R - 1.5, 0, Math.PI * 2); g.stroke();
    }
    if (pointer && !glide) {
      const q = projection(pointer);
      if (q) {
        g.setLineDash([6, 4]);
        g.strokeStyle = ink; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(q[0], q[1]); g.stroke();
        g.setLineDash([]);
        g.fillStyle = ink;
        g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fill();
      }
    }
    g.fillStyle = brass; g.strokeStyle = "rgba(250,248,243,.9)"; g.lineWidth = 2;
    g.beginPath(); g.arc(c[0], c[1], 5, 0, Math.PI * 2); g.fill(); g.stroke();
  };

  const labels = (g) => {
    if (map.morph) return;
    const projection = map.projection;
    const gm = geometry(projection);
    if (!gm) return;
    const { c, R } = gm;
    const radii = ringRadii(step());
    const every = ringLabelEvery(R, step());
    if (params.bearings) {
      for (let b = 0; b < 360; b += 30) {
        const q = projection(geoDest(centre, b, 179.5));
        if (!q) continue;
        const ang = Math.atan2(q[1] - c[1], q[0] - c[0]);
        tag(g, c[0] + Math.cos(ang) * (R + 15), c[1] + Math.sin(ang) * (R + 15), b === 0 ? "N" : b === 90 ? "E" : b === 180 ? "S" : b === 270 ? "W" : b + "°", palette.ui.ink2);
      }
    }
    radii.forEach((d, i) => {
      const a = ringAlpha(i, radii.length);
      if (a <= 0 || (i + 1) % every) return;
      const q = projection(geoDest(centre, 45, (d / R_KM) / DEG));
      if (!q) return;
      g.globalAlpha = a;
      tag(g, q[0], q[1], `${fmtKm(d)} km`, signal);
      g.globalAlpha = 1;
    });
    if (pointer && !glide) {
      const q = projection(pointer);
      if (q) tag(g, (c[0] + q[0]) / 2, (c[1] + q[1]) / 2 - 11, `${fmtKm(distanceKm(centre, pointer))} km · ${bearingDeg(centre, pointer).toFixed(0)}°`, ink);
    }
  };

  const meas = document.createElement("canvas").getContext("2d");
  const measure = (text, title) => {
    meas.font = title ? `600 13px ${FONT_UI}` : `400 12px ${FONT_UI}`;
    return meas.measureText(text).width;
  };
  const caption = () => {
    const a = antipodeOf(centre), at = `${ctx.fmt.lat(a[1])} ${ctx.fmt.lon(a[0])}`, on = params.antipode;
    const title = "Every ring is a true distance from the centre.";
    const sets = [
      [title, "Click to move the centre there. Hover for distance and bearing.", on ? `The brass edge is one point: the antipode, ${at}.` : ""],
      [title, "Click to move the centre. Hover for distance.", on ? `Brass edge: the antipode, ${at}.` : ""],
      [title, on ? "Brass edge: the antipode. Tap to move the centre." : "Tap to move the centre there."],
    ].map((s) => s.filter(Boolean));
    return captionLayout(sets, ctx.stage.width, measure);
  };

  const setMap = (at, duration = 0) => map.setProjection("azimuthalEquidistant", { duration, opts: { lon0: at[0], lat0: at[1] }, tag: at.map((v) => v.toFixed(4)).join(",") });

  const glideTo = async (target) => {
    if (glide) glide.cancel();
    const from = centre.slice();
    if (ctx.reducedMotion || !map) { centre = target.slice(); if (map) await setMap(centre); afterMove(); return; }
    const a = lonLatToXYZ(from[0], from[1]), b = lonLatToXYZ(target[0], target[1]);
    map.interacting = true;
    glide = ctx.anim.tween({
      from: 0, to: 1, duration: 650, ease: ctx.anim.ease.standard,
      onUpdate: (u) => { centre = xyzToLonLat(slerp(a, b, u)); setMap(centre); },
      onDone: () => { glide = null; centre = target.slice(); map.interacting = false; setMap(centre).then(() => { map.invalidate(); afterMove(); }); },
    });
  };

  const afterMove = () => {
    readouts();
    if (globe) build3d();
    if (ctx.side === "A" && globe) globe.camera.lookAt(centre[0], clamp(centre[1], -60, 60), null, { duration: ctx.reducedMotion ? 0 : 650 });
  };

  const build3d = () => {
    const segs = [];
    for (const d of ringRadii(step())) {
      const ring = smallCircle(centre[0], centre[1], (d / R_KM) / DEG, 180);
      for (let i = 1; i < ring.length; i++) segs.push([ring[i - 1], ring[i]]);
    }
    globe.addLines(PREFIX + "rings", segs, { color: signal, width: 1.6, depth: true });
    if (params.bearings) {
      const b = [];
      for (let az = 0; az < 360; az += 30) {
        let prev = centre;
        for (let s = 3; s <= 180; s += 3) { const q = geoDest(centre, az, s); b.push([prev, q]); prev = q; }
      }
      globe.addLines(PREFIX + "bearings", b, { color: "rgba(60,52,40,.5)", width: 1, depth: true });
    } else globe.remove(PREFIX + "bearings");
    globe.addPoints(PREFIX + "centre", [centre], { color: brass, size: 12 });
    if (params.antipode) globe.addPoints(PREFIX + "anti", [antipodeOf(centre)], { color: brass, size: 12 });
    else globe.remove(PREFIX + "anti");
  };

  if (map) {
    map.setInsets({ top: caption().top, bottom: ctx.stage.insetBottom });
    await setMap(centre, map.projectionId === "azimuthalEquidistant" ? 0 : 700);
    map.addLayer(PREFIX + "rings", layer, { order: 55 });
    map.addLayer(PREFIX + "labels", labels, { order: 61, clip: false });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, CAP_X, CAP_Y, caption().lines, { accent: signal }), { order: 90, clip: false });
    const off = map.on("hover", (h) => {
      pointer = h ? [h.lon, h.lat] : null;
      if (pointer) ctx.readout.setMany({ dist: distanceKm(centre, pointer), bearing: bearingDeg(centre, pointer) });
      map.invalidate();
    });
    ctx.signal.addEventListener("abort", off);
  } else if (globe) {
    build3d();
    if (ctx.side === "A") globe.camera.lookAt(centre[0], clamp(centre[1], -60, 60), null, { duration: 0 });
  }
  runRipple();
  readouts({ dist: "–", bearing: "–" });

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("centre") && (Math.abs(params.centre[0] - centre[0]) > 1e-9 || Math.abs(params.centre[1] - centre[1]) > 1e-9)) glideTo(params.centre);
      if (keys.includes("ringStep")) runRipple();
      if (globe) build3d();
      if (map) map.invalidate();
      readouts();
    },
    hover(lon, lat) {
      const d = distanceKm(centre, [lon, lat]), b = bearingDeg(centre, [lon, lat]);
      if (globe) ctx.readout.setMany({ dist: d, bearing: b });
      return [`${fmtKm(d)} km from the centre`, `bearing ${b.toFixed(1)}°`];
    },
    probe(lon, lat) {
      ctx.controls.set("centre", [+lon.toFixed(4), +lat.toFixed(4)]);
      return null;
    },
    unprobe() {},
    resize() { if (map) { map.setInsets({ top: caption().top, bottom: ctx.stage.insetBottom }); map.invalidate(); } },
    unmount() {
      if (glide) glide.cancel();
      if (rippleTween) rippleTween.cancel();
      if (map) { map.interacting = false; map.removePrefix(PREFIX); map.setInsets({ top: 0, bottom: 0 }); }
      if (globe) globe.removePrefix(PREFIX);
    },
  };
}

export function geoDest(from, bearing, distDeg) {
  const p1 = from[1] * DEG, l1 = from[0] * DEG, b = bearing * DEG, d = distDeg * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 / DEG + 540) % 360) - 180, p2 / DEG];
}
