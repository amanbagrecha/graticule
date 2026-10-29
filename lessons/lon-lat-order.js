import { inverse, geodesicPoints } from "@/core/geodesy.js";
import { clamp } from "@/core/math.js";
import { FONT_UI } from "@/core/map2d.js";

const BLUE = "#1d63a8";
const ORANGE = "#b85217";
const INK = "#1a1917";
const HALO = "#faf8f3";
const SERIF = '"Newsreader", "Iowan Old Style", Charter, Georgia, serif';

export const CITIES = [
  { value: "london", label: "London", lon: -0.13, lat: 51.5 },
  { value: "tokyo", label: "Tokyo", lon: 139.65, lat: 35.68 },
  { value: "newyork", label: "New York", lon: -74.01, lat: 40.71 },
  { value: "sydney", label: "Sydney", lon: 151.21, lat: -33.87 },
  { value: "cairo", label: "Cairo", lon: 31.24, lat: 30.04 },
  { value: "saopaulo", label: "São Paulo", lon: -46.63, lat: -23.55 },
  { value: "mumbai", label: "Mumbai", lon: 72.88, lat: 19.08 },
  { value: "moscow", label: "Moscow", lon: 37.62, lat: 55.76 },
  { value: "lagos", label: "Lagos", lon: 3.38, lat: 6.52 },
  { value: "mexico", label: "Mexico City", lon: -99.13, lat: 19.43 },
  { value: "capetown", label: "Cape Town", lon: 18.42, lat: -33.92 },
  { value: "reykjavik", label: "Reykjavík", lon: -21.94, lat: 64.15 },
];

export const NAME = { lonlat: "lon, lat", latlon: "lat, lon" };
export const COLOR = { latlon: BLUE, lonlat: ORANGE };
export const CLICK = "click";
const OTHER = { lonlat: "latlon", latlon: "lonlat" };

export const meta = {
  id: "lon-lat-order",
  title: "Coordinate order",
  track: 1,
  order: 7,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  labels: false,
  paragraph: "Before you load data, check the order. Some files put longitude first, others latitude. Read it wrong and the point jumps far away.",
  deeper: [
    "GeoJSON and most code use longitude, latitude.",
    "EPSG:4326 and many map apps use latitude, longitude.",
    "A latitude of 139° is impossible; a longitude of 139° is Tokyo.",
  ],
  keywords: ["axis order", "longitude", "latitude", "GeoJSON", "EPSG:4326"],
  controls: [
    { key: "place", type: "select", label: "Place", options: [...CITIES.map(({ value, label }) => ({ value, label })), { value: "click", label: "Your click" }], default: "london" },
    { key: "convention", type: "segment", label: "The pair means", options: [{ value: "lonlat", label: "lon, lat" }, { value: "latlon", label: "lat, lon" }], default: "latlon" },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";
const DROP_MS = 300;
const LINE_MS = 360;
const MARGIN = 56;

export function readings(a, b) {
  return {
    lonlat: { lon: a, lat: b, ok: Math.abs(b) <= 90 && Math.abs(a) <= 180 },
    latlon: { lon: b, lat: a, ok: Math.abs(a) <= 90 && Math.abs(b) <= 180 },
  };
}

export function pairFor(point, convention) {
  return convention === "lonlat" ? [point.lon, point.lat] : [point.lat, point.lon];
}

export function distanceKm(r) {
  if (!r.lonlat.ok || !r.latlon.ok) return null;
  return inverse(r.lonlat.lon, r.lonlat.lat, r.latlon.lon, r.latlon.lat).s12 / 1000;
}

const num = (v) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
export const pairText = (a, b) => `${num(a)}, ${num(b)}`;
export const offText = (p) => `Not a place: lat ${p.lat.toFixed(2)}°`;
export const awayText = (km) => `${Math.round(km).toLocaleString("en-US")} km away`;

const easeBack = (t) => { const s = 2.04, u = t - 1; return 1 + u * u * ((s + 1) * u + s); };

export async function mount(ctx) {
  const map = ctx.stage.map;
  let params = { ...ctx.params };
  let target = null, clicked = null, state = null, drop = 1, lead = 1, tw = null;

  const cityOf = (v) => CITIES.find((c) => c.value === v) || CITIES[0];

  const compute = () => {
    const [a, b] = pairFor(target, params.convention);
    const r = readings(a, b);
    const right = params.convention, wrong = OTHER[right];
    const km = distanceKm(r);
    const line = km !== null && km > 0.5 ? geodesicPoints([r[right].lon, r[right].lat], [r[wrong].lon, r[wrong].lat], 96) : null;
    state = { r, right, wrong, km, line, pair: [a, b] };
  };

  const textBox = (g, small, big) => {
    g.font = `600 13px ${FONT_UI}`; const w1 = g.measureText(small).width;
    g.font = `500 20px ${SERIF}`; const w2 = g.measureText(big).width;
    return { w: Math.max(w1, w2), h: 44 };
  };

  const drawText = (g, x, y, box, small, big, color, alpha, align, bigFirst = false) => {
    g.save(); g.globalAlpha = alpha;
    g.textAlign = align; g.textBaseline = "alphabetic";
    g.lineJoin = "round"; g.strokeStyle = HALO; g.lineWidth = 4;
    const tx = align === "left" ? x : align === "right" ? x + box.w : x + box.w / 2;
    const ys = bigFirst ? y + 39 : y + 13, yb = bigFirst ? y + 18 : y + 39;
    g.font = `600 13px ${FONT_UI}`; g.strokeText(small, tx, ys); g.fillStyle = color; g.fillText(small, tx, ys);
    g.font = `500 20px ${SERIF}`; g.strokeText(big, tx, yb); g.fillStyle = INK; g.fillText(big, tx, yb);
    g.restore();
  };

  const spot = (q, box, avoid, path) => {
    const W = map.width, H = map.height;
    const opts = [
      { x: q[0] + 14, y: q[1] - 46, align: "left" },
      { x: q[0] - 14 - box.w, y: q[1] - 46, align: "right" },
      { x: q[0] + 12, y: q[1] + 8, align: "left" },
      { x: q[0] - 12 - box.w, y: q[1] + 8, align: "right" },
    ];
    const fits = (p) => p.x >= 8 && p.x + box.w <= W - 8 && p.y >= 6 && p.y + box.h <= H - 6;
    const clear = (p) => !avoid || p.x + box.w < avoid.x - 6 || p.x > avoid.x + avoid.w + 6 || p.y + box.h < avoid.y - 4 || p.y > avoid.y + avoid.h + 4;
    const free = (p) => !path || !path.some((t) => t[0] > p.x - 4 && t[0] < p.x + box.w + 4 && t[1] > p.y - 4 && t[1] < p.y + box.h + 4);
    const pick = opts.find((p) => fits(p) && clear(p) && free(p)) || opts.find((p) => fits(p) && clear(p)) || opts.find(fits) || opts[0];
    return { ...pick, x: clamp(pick.x, 8, W - 8 - box.w), y: clamp(pick.y, 6, H - 6 - box.h), w: box.w, h: box.h };
  };

  const pin = (g, x, y, color, alpha) => {
    g.save(); g.globalAlpha = alpha;
    g.fillStyle = color; g.strokeStyle = HALO; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 10, y - 14, x - 9, y - 26, x, y - 26); g.bezierCurveTo(x + 9, y - 26, x + 10, y - 14, x, y); g.fill(); g.stroke();
    g.fillStyle = HALO; g.beginPath(); g.arc(x, y - 18, 3.2, 0, Math.PI * 2); g.fill();
    g.restore();
  };

  const dashed = (g, projection) => {
    const pts = state.line, n = pts.length - 1, k = Math.round(n * lead);
    if (k < 1) return;
    g.beginPath();
    let prev = null;
    for (let i = 0; i <= k; i++) {
      const q = projection([((pts[i][0] + 540) % 360) - 180, pts[i][1]]);
      if (!q) { prev = null; continue; }
      if (prev && Math.abs(q[0] - prev[0]) < map.width / 3) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
      prev = q;
    }
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = "rgba(250,248,243,.75)"; g.lineWidth = 4.5; g.setLineDash([]); g.stroke();
    g.strokeStyle = INK; g.lineWidth = 1.75; g.setLineDash([7, 5]); g.stroke();
    g.setLineDash([]);
  };

  const pinsLayer = (g, path, projection) => {
    if (!state) return;
    const { r, right, wrong, km } = state;
    const R = r[right], X = r[wrong];
    const qr = projection([R.lon, R.lat]);
    const qw = X.ok ? projection([X.lon, X.lat]) : null;
    const dy = -(1 - drop) * 70, fade = clamp(drop * 2.5, 0, 1);
    if (qw && state.line && lead > 0) dashed(g, projection);
    if (qw) pin(g, qw[0], qw[1] + dy, COLOR[wrong], fade);
    pin(g, qr[0], qr[1], COLOR[right], 1);
    const botR = `read as ${NAME[right]}` + (target.name ? `: ${target.name}` : ""), topR = pairText(...state.pair);
    const boxR = textBox(g, botR, topR);
    const trail = qw && state.line ? state.line.filter((_, i) => i % 4 === 0).map((t) => projection(t)).filter(Boolean) : null;
    const atR = spot(qr, boxR, null, trail);
    const topW = `read as ${NAME[wrong]}`;
    if (qw) {
      const botW = km > 0.5 ? awayText(km) : "Same place";
      const boxW = textBox(g, topW, botW);
      const atW = spot([qw[0], qw[1] + dy], boxW, atR, trail);
      drawText(g, atW.x, atW.y, boxW, topW, botW, COLOR[wrong], fade, atW.align);
    } else {
      const botW = offText(X);
      const boxW = textBox(g, topW, botW);
      const qx = projection([clamp(X.lon, -180, 180), 0]);
      const W = map.width, H = map.height - ctx.stage.insetBottom;
      const x = clamp((qx ? qx[0] : W / 2) - boxW.w / 2, 8, W - 8 - boxW.w);
      let y = X.lat > 0 ? 14 : H - 14 - boxW.h;
      if (!(x + boxW.w < atR.x - 6 || x > atR.x + atR.w + 6 || y + boxW.h < atR.y - 4 || y > atR.y + atR.h + 4)) y = X.lat > 0 ? atR.y + atR.h + 10 : atR.y - boxW.h - 10;
      drawText(g, x, y, boxW, topW, botW, COLOR[wrong], fade, "center");
    }
    drawText(g, atR.x, atR.y, boxR, botR, topR, COLOR[right], 1, atR.align, true);
  };

  const cover = () => {
    const f = map.fitScale || 1, W = map.width, H = map.height - ctx.stage.insetBottom;
    return Math.max(W / (2 * Math.PI * f), H / (Math.PI * f)) * 1.002;
  };

  const goal = () => {
    const { r, right, wrong } = state;
    const pts = [r[right], r[wrong]].filter((p) => p.ok);
    const k = cover(), ppd = (map.fitScale * k * Math.PI) / 180;
    const hl = map.width / 2 / ppd, hp = (map.height - ctx.stage.insetBottom) / 2 / ppd;
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
    const mid = (v) => (Math.min(...v) + Math.max(...v)) / 2;
    const lon = hl >= 180 ? 0 : clamp(mid(lons), -180 + hl, 180 - hl);
    const lat = hp >= 90 ? 0 : clamp(mid(lats), -90 + hp, 90 - hp);
    return { lon, lat, scale: k };
  };

  const inView = () => {
    if (map.zoom() < cover() * 0.98) return false;
    const { r, right, wrong } = state, H = map.height - ctx.stage.insetBottom;
    return [r[right], r[wrong]].filter((p) => p.ok).every((p) => {
      const q = map.projection([p.lon, p.lat]);
      return q && q[0] >= MARGIN && q[0] <= map.width - MARGIN && q[1] >= MARGIN && q[1] <= H - MARGIN;
    });
  };

  const frameView = (glide) => {
    if (!state || !map.projection) return;
    const g = goal();
    if (!glide || ctx.reducedMotion) { map.setState(g); return; }
    if (inView()) return;
    map.touch(560);
    map.lookAt(g.lon, g.lat, g.scale, { duration: 480 });
  };

  const animate = () => {
    if (tw) tw.cancel();
    tw = null;
    if (ctx.reducedMotion) { drop = 1; lead = 1; map.invalidate(); return; }
    drop = 0; lead = 0;
    const total = DROP_MS + LINE_MS, split = DROP_MS / total;
    tw = ctx.anim.tween({ from: 0, to: 1, duration: total, ease: ctx.anim.ease.linear, onUpdate: (v) => {
      drop = easeBack(clamp(v / split, 0, 1));
      lead = ctx.anim.ease.out(clamp((v - split) / (1 - split), 0, 1));
      map.invalidate();
    }, onDone: () => { tw = null; drop = 1; lead = 1; map.invalidate(); } });
  };

  const setPlace = () => {
    if (params.place === CLICK) {
      if (clicked) { target = clicked; return; }
      params.place = meta.controls[0].default;
      ctx.controls.set("place", params.place, { silent: true });
      ctx.url.set("place", null);
    }
    const c = cityOf(params.place);
    target = { lon: c.lon, lat: c.lat, name: c.label };
  };

  await map.setProjection("equirectangular", { duration: map.projectionId === "equirectangular" ? 0 : 700 });
  map.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
  map.addLayer(PREFIX + "pins", pinsLayer, { order: 60, clip: false });
  if (document.fonts && document.fonts.load) document.fonts.load(`500 20px "Newsreader"`).then(() => map.invalidate()).catch(() => {});
  let first = true;

  return {
    update(p, keys) {
      params = { ...p };
      if (!target || keys.includes("place")) setPlace();
      compute();
      if (first) { first = false; frameView(false); map.invalidate(); return; }
      if (keys.length) { frameView(keys.length > 1 ? false : true); animate(); } else map.invalidate();
    },
    hover(lon, lat) {
      const [a, b] = pairFor({ lon, lat }, params.convention);
      return [`Pair (${NAME[params.convention]}): ${pairText(a, b)}`];
    },
    probe(lon, lat) {
      clicked = target = { lon: Math.round(lon * 100) / 100, lat: Math.round(lat * 100) / 100, name: null };
      if (params.place !== CLICK) { params.place = CLICK; ctx.controls.set("place", CLICK, { silent: true }); }
      compute();
      frameView(true);
      animate();
      return null;
    },
    unprobe() {},
    resize() { map.resize(); if (state && !inView()) frameView(false); },
    unmount() {
      if (tw) tw.cancel();
      map.removePrefix(PREFIX);
    },
  };
}
