import { ELLIPSOIDS, WGS84, transformDatum } from "@/core/geodesy.js";
import { lonLatToXYZ } from "@/core/globe.js";
import { clamp, DEG } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const ORANGE = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const PAPER = "#faf8f3";
const SERIF = "var(--font-serif)";
const HALO = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, y]) => `${x}px ${y}px 1px ${PAPER}`).concat(`0 0 4px ${PAPER}`).join(", ");

export const KEYS = ["tx", "ty", "tz", "rx", "ry", "rz", "ds"];
export const PARIS = [2.35, 48.86];
export const PLACES = { ed50: PARIS, osgb36: [-0.13, 51.51], tokyo: [139.69, 35.69] };
export const NAMES = { ed50: "ED50", osgb36: "OSGB36", tokyo: "Tokyo" };
export const PRESETS = [
  { value: "ed50", label: "ED50 (Europe)" },
  { value: "osgb36", label: "OSGB36 (Britain)" },
  { value: "tokyo", label: "Tokyo (Japan)" },
];

export const meta = {
  id: "datums-helmert",
  title: "Datums",
  track: 1,
  order: 5,
  mode: "3d",
  renderer: "webgl",
  paragraph: "A datum pins the ellipsoid to the Earth. Old maps used regional datums; GPS uses WGS84. One spot has two coordinate pairs. Mix them and you miss by this gap.",
  deeper: [
    "A datum change uses 7 numbers: 3 shifts, 3 turns and 1 scale (a Helmert transform).",
    "ED50 → WGS84 (EPSG 1133): −87, −98, −121 m.",
    "A turn of 1″ moves a point by about 31 m.",
    "Plates move 2–7 cm each year, so modern datums carry a date.",
  ],
  keywords: ["datum", "Helmert", "transform", "ED50"],
  controls: [
    { key: "preset", type: "select", label: "Old datum", options: PRESETS, default: "ed50" },
  ],
  readouts: [],
  transport: null,
  compare: null,
  view: { lon: PARIS[0], lat: PARIS[1], dist: 1.9 },
  data: ["datums.json"],
};

const PREFIX = meta.id + ":";
const GLIDE = 480;
const FADE = 360;
const ARROW_R = 1.003;
const ARROW_LEN = 1.4;
const FIELD = { lon: 6.5, lat: 4.5, ni: 2, nj: 2 };
export const CARD = 196;
export const insetSize = (w, h) => (w < 640 ? clamp(Math.round(Math.min(w, h) * 0.34), 112, 140) : CARD);

export const presetId = (id) => (PLACES[id] ? id : "ed50");

export function presetParams(table, id) {
  const p = table.presets.find((q) => q.id === id) || table.presets[0];
  return Object.fromEntries(KEYS.map((k) => [k, p[k]]));
}

export function baseOf(table, id) {
  const p = table.presets.find((q) => q.id === id) || table.presets[0];
  const method = p.method === "geocentric-translation" ? "position-vector" : p.method;
  return { from: ELLIPSOIDS[p.from] || WGS84, to: ELLIPSOIDS[p.to] || WGS84, method, epsg: p.epsg, fromName: p.from, toName: p.to };
}

export function shiftAt(lon, lat, params, base) {
  const p = { ...params, method: base.method };
  const zero = KEYS.every((k) => !p[k]);
  if (zero && base.from === base.to) return { lon, lat, h: 0, shift: 0, bearing: 0, dE: 0, dN: 0 };
  const r = transformDatum(lon, lat, 0, p, base.from, base.to);
  const az = r.bearing * DEG;
  return { lon: r.lon, lat: r.lat, h: r.h, shift: r.shift, bearing: r.bearing, dE: r.shift * Math.sin(az), dN: r.shift * Math.cos(az) };
}

export function fieldNodes(centre) {
  const out = [];
  const c = Math.cos(centre[1] * DEG);
  for (let i = -FIELD.ni; i <= FIELD.ni; i++) for (let j = -FIELD.nj; j <= FIELD.nj; j++) {
    if (Math.abs(i) <= 1 && j >= 0 && j <= 1) continue;
    if (i === 0 && j === -1) continue;
    out.push([centre[0] + (i * FIELD.lon) / Math.max(c, 0.2), clamp(centre[1] + j * FIELD.lat, -85, 85)]);
  }
  return out;
}

function arrowLonLat(lon, lat, bearing, len) {
  const c = Math.max(Math.cos(lat * DEG), 0.05);
  const step = (b, l, from) => [from[0] + (l * Math.sin(b * DEG)) / c, from[1] + l * Math.cos(b * DEG)];
  const a = step(bearing, -len / 2, [lon, lat]), b = step(bearing, len / 2, [lon, lat]);
  return [[a, b], [b, step(bearing + 150, len * 0.4, b)], [b, step(bearing - 150, len * 0.4, b)]];
}

export function arrowSegments(nodes, params, base) {
  const segs = [];
  const p = [0, 0, 0], q = [0, 0, 0];
  for (const [lon, lat] of nodes) {
    const r = shiftAt(lon, lat, params, base);
    for (const [a, b] of arrowLonLat(lon, lat, r.bearing, ARROW_LEN)) {
      lonLatToXYZ(a[0], a[1], p, ARROW_R); lonLatToXYZ(b[0], b[1], q, ARROW_R);
      segs.push([p.slice(), q.slice()]);
    }
  }
  return segs;
}

export const metres = (m) => `${Math.round(m).toLocaleString("en-US")} m`;
export const apart = (m) => `${metres(m)} apart`;

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  const ov = ctx.overlay;
  const table = ctx.data.get("datums.json") || (await ctx.data.load("datums.json"));
  let id = presetId(ctx.params.preset);
  let params = presetParams(table, id), base = baseOf(table, id);
  const urlP = String(ctx.url.get("p") || "").split(",").map(Number);
  let probe = urlP.length === 2 && urlP.every(Number.isFinite) ? [clamp(urlP[0], -180, 180), clamp(urlP[1], -89, 89)] : PLACES[id].slice();
  let fTw = null;
  const ids = { arrows: PREFIX + "arrows", pin: PREFIX + "pin", label: PREFIX + "shift" };

  globe.addSegments3D(ids.arrows, arrowSegments(fieldNodes(PLACES[id]), params, base), { color: ORANGE, width: 1.6, depth: true, opacity: 0.55, order: 3 });
  ov.pin(ids.pin, { lon: probe[0], lat: probe[1] }, { color: INK, size: 10 });
  const lab = ov.label(ids.label, { lon: probe[0], lat: probe[1] }, "", { color: ORANGE, dx: 12, dy: -30, mono: false });
  lab.el.style.font = `600 20px/1.2 ${SERIF}`;
  lab.el.style.textShadow = HALO;

  const card = ctx.stage.element("div", "datums-inset");
  const cv = document.createElement("canvas");
  card.append(cv);
  const dpr = ctx.stage.dpr;
  let size = CARD;
  const placeCard = () => {
    size = insetSize(ctx.stage.width, ctx.stage.height - ctx.stage.insetBottom);
    const m = size < CARD ? 10 : 16;
    cv.width = size * dpr; cv.height = size * dpr;
    cv.style.cssText = `width:${size}px;height:${size}px;display:block;`;
    card.style.cssText = `position:absolute;inset:auto;left:${m}px;top:${m}px;width:${size}px;height:${size}px;pointer-events:none;z-index:3;`;
  };

  const drawCard = (r) => {
    const g = cv.getContext("2d"), W = size, small = W < CARD;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, W);
    g.fillStyle = "rgba(250,248,243,.95)"; g.beginPath(); g.roundRect(0.5, 0.5, W - 1, W - 1, small ? 10 : 14); g.fill();
    g.strokeStyle = "#d9d2c3"; g.lineWidth = 1; g.stroke();
    const pad = small ? 10 : 14, barY = W - pad - 4;
    const pw = W - 2 * pad, ph = barY - 14 - pad;
    const k = Math.min((0.5 * Math.min(pw, ph)) / Math.max(r.shift, 1), (W - 2 * pad - 44) / 100);
    const cx = W / 2, cy = pad + ph / 2 + 4;
    const dx = r.dE * k, dy = -r.dN * k, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const ax = cx - dx / 2, ay = cy - dy / 2, bx = cx + dx / 2, by = cy + dy / 2;
    if (r.shift > 0.5) {
      const ex = bx - ux * 6, ey = by - uy * 6;
      g.strokeStyle = ORANGE; g.fillStyle = ORANGE; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ax + ux * 5, ay + uy * 5); g.lineTo(ex, ey); g.stroke();
      const an = Math.atan2(uy, ux);
      g.beginPath(); g.moveTo(ex + ux * 2, ey + uy * 2); g.lineTo(ex - 8 * Math.cos(an - 0.45), ey - 8 * Math.sin(an - 0.45)); g.lineTo(ex - 8 * Math.cos(an + 0.45), ey - 8 * Math.sin(an + 0.45)); g.closePath(); g.fill();
    }
    g.fillStyle = INK; g.beginPath(); g.arc(ax, ay, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = BLUE; g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fill();
    g.font = `600 ${small ? 11 : 12}px ${FONT_UI}`;
    const tag = (text, x, y, s, color) => {
      const w = g.measureText(text).width, hgt = 12;
      let tx = x + s * ux * 9, ty = y + s * uy * 9;
      tx = s * ux > 0.35 ? tx : s * ux < -0.35 ? tx - w : tx - w / 2;
      ty = s * uy > 0.35 ? ty + hgt : s * uy < -0.35 ? ty : ty + hgt / 2 - 1;
      tx = clamp(tx, 6, W - 6 - w); ty = clamp(ty, hgt + 4, barY - 10);
      g.fillStyle = color; g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillText(text, tx, ty);
    };
    tag(NAMES[id], ax, ay, -1, INK);
    tag("WGS84", bx, by, 1, BLUE);
    const bl = 100 * k;
    g.strokeStyle = INK; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(pad, barY); g.lineTo(pad + bl, barY); g.moveTo(pad, barY - 4); g.lineTo(pad, barY + 2); g.moveTo(pad + bl, barY - 4); g.lineTo(pad + bl, barY + 2); g.stroke();
    g.fillStyle = INK; g.font = `500 10px ${FONT_MONO}`; g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillText("100 m", pad + bl + 6, barY + 3);
  };

  const showProbe = () => {
    const r = shiftAt(probe[0], probe[1], params, base);
    const at = { lon: probe[0], lat: probe[1] };
    ov.move(ids.pin, at);
    lab.el.textContent = apart(r.shift);
    lab.w = 0;
    ov.move(ids.label, at);
    drawCard(r);
  };

  const fadeArrows = () => {
    if (fTw) fTw.cancel();
    if (ctx.reducedMotion) { globe.setLineStyle(ids.arrows, { opacity: 0.55 }); return; }
    globe.setLineStyle(ids.arrows, { opacity: 0 });
    fTw = ctx.anim.tween({ from: 0, to: 0.55, duration: FADE, ease: ctx.anim.ease.out, onUpdate: (v) => globe.setLineStyle(ids.arrows, { opacity: v }), onDone: () => { fTw = null; } });
  };

  const turnTo = (duration) => {
    if (ctx.side !== "A") return;
    const c = PLACES[id];
    globe.camera.lookAt(c[0], c[1], meta.view.dist, { duration: ctx.reducedMotion ? 0 : duration });
  };

  placeCard();
  showProbe();
  if (!ctx.url.get("v") && id !== "ed50") turnTo(0);
  fadeArrows();

  return {
    update(p, keys) {
      const next = presetId(p.preset);
      if (next === id || !keys.includes("preset")) return;
      id = next;
      params = presetParams(table, id);
      base = baseOf(table, id);
      probe = PLACES[id].slice();
      ctx.url.set("p", null);
      globe.setSegments3D(ids.arrows, arrowSegments(fieldNodes(PLACES[id]), params, base));
      fadeArrows();
      showProbe();
      turnTo(GLIDE);
    },
    hover(lon, lat) {
      return [apart(shiftAt(lon, lat, params, base).shift)];
    },
    probe(lon, lat) {
      probe = [+lon.toFixed(4), +lat.toFixed(4)];
      ctx.url.set("p", `${probe[0]},${probe[1]}`);
      showProbe();
      return null;
    },
    unprobe() {},
    resize() { placeCard(); showProbe(); },
    unmount() {
      if (fTw) fTw.cancel();
      globe.removePrefix(PREFIX);
      ov.clear(PREFIX);
    },
  };
}
