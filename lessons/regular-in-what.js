import { inverse as geodesicInverse } from "@/core/geodesy.js";
import { DEG, RAD, smoothstep } from "@/core/math.js";
import { drawCaption, FONT_UI, FONT_MONO, INK, text, fmtNum } from "@/lessons/_pixelkit.js";

export const SATELLITES = [
  { value: "0", label: "0° (Meteosat)", lon: 0, sweep: "y" },
  { value: "-75.2", label: "75.2 W (GOES-East)", lon: -75.2, sweep: "x" },
  { value: "140.7", label: "140.7 E (Himawari)", lon: 140.7, sweep: "y" },
];

export const meta = {
  id: "regular-in-what",
  title: "Regular in which coordinates?",
  track: 6,
  order: 3,
  mode: "3d",
  renderer: "webgl",
  paragraph: "\"Regular\" means regular in some coordinates. A geostationary sensor scans equal angles, so its pixels are equal in angle, not in metres. Near the edge of the disc one pixel covers many kilometres. A grid shipped as two arrays of longitude and latitude is regular in a projection nobody wrote down.",
  deeper: [
    "Geostationary height 35,786 km; orbit radius 42,164 km.",
    "The Earth subtends 17.4° from there.",
    "A 3 km pixel at nadir is over 9 km near 70° of latitude.",
    "The disc edge is 81.3° of great-circle angle from the sub-satellite point.",
  ],
  keywords: ["geostationary", "scan angle", "regular grid", "satellite"],
  controls: [
    { key: "satellite", type: "select", label: "Satellite", options: SATELLITES.map(({ value, label }) => ({ value, label })), default: "0" },
    { key: "frame", type: "segment", label: "Regular in", options: [{ value: "scan", label: "Scan angle" }, { value: "lonlat", label: "Lon/lat" }, { value: "metres", label: "Metres" }], default: "scan" },
    { key: "step", type: "segment", label: "Step", options: [{ value: "coarse", label: "Coarse" }, { value: "fine", label: "Fine" }], default: "coarse" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", label: "Equal scan angles at the satellite" }, { color: "#b85217", label: "Equal degrees of lon and lat" }, { color: "#2f7d4f", label: "Equal metres on a map" }, { color: "#b7791f", line: true, dash: true, label: "Edge of the disc (limb)" }] },
  ],
  readouts: [
    { key: "satLon", label: "Satellite longitude" },
    { key: "half", label: "Earth half-angle", digits: 2, unit: "°" },
    { key: "cell", label: "Ground size of the cell", hero: true },
    { key: "limb", label: "Limb angle", digits: 1, unit: "°" },
  ],
  transport: { label: ["globe", "sensor frame"], key: "m" },
  compare: null,
  view: { lon: 35, lat: 20, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
export const GEO = { h: 42164, req: 6378.137, rpol: 6356.7523142 };
export const R_MEAN = 6371.0088;
export const STEPS = { scan: { coarse: 0.8, fine: 0.4 }, lonlat: { coarse: 6, fine: 3 }, metres: { coarse: 700, fine: 350 } };
export const COLOURS = { scan: "#1d63a8", lonlat: "#b85217", metres: "#2f7d4f" };
const UNITS = { scan: "°", lonlat: "°", metres: " km" };

export function halfAngle(R = GEO.req, h = GEO.h) {
  return Math.asin(R / h) * RAD;
}

export function limbAngle(R = GEO.req, h = GEO.h) {
  return Math.acos(R / h) * RAD;
}

export function satelliteOf(value) {
  return SATELLITES.find((s) => s.value === String(value)) || SATELLITES[0];
}

const wrap = (d) => ((d + 540) % 360) - 180;

export function geosForward(lon, lat, subLon = 0, sweep = "y") {
  const { h, req, rpol } = GEO;
  const e2r = (rpol * rpol) / (req * req);
  const cl = Math.atan(e2r * Math.tan(lat * DEG));
  const rl = rpol / Math.sqrt(1 - (1 - e2r) * Math.cos(cl) ** 2);
  const dl = (lon - subLon) * DEG;
  const px = rl * Math.cos(cl) * Math.cos(dl), py = rl * Math.cos(cl) * Math.sin(dl), pz = rl * Math.sin(cl);
  const r1 = h - px;
  if (r1 * px - py * py - (pz * pz * req * req) / (rpol * rpol) < 0) return null;
  const rn = Math.hypot(r1, py, pz);
  if (sweep === "x") return [Math.asin(py / rn) * RAD, Math.atan(pz / r1) * RAD];
  return [Math.atan(py / r1) * RAD, Math.asin(pz / rn) * RAD];
}

export function geosInverse(x, y, subLon = 0, sweep = "y") {
  const { h, req, rpol } = GEO;
  const cx = Math.cos(x * DEG), sx = Math.sin(x * DEG), cy = Math.cos(y * DEG), sy = Math.sin(y * DEG);
  const u = sweep === "x" ? [-cx * cy, sx, cx * sy] : [-cx * cy, cy * sx, sy];
  const k = (req * req) / (rpol * rpol);
  const A = u[0] * u[0] + u[1] * u[1] + k * u[2] * u[2];
  const B = 2 * h * u[0];
  const C = h * h - req * req;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = (-B - Math.sqrt(disc)) / (2 * A);
  const px = h + s * u[0], py = s * u[1], pz = s * u[2];
  const lon = wrap(subLon + Math.atan2(py, px) * RAD);
  const lat = Math.atan((k * pz) / Math.hypot(px, py)) * RAD;
  return [lon, lat];
}

export function centralAngle(lon, lat, subLon) {
  const a = lat * DEG, d = (lon - subLon) * DEG;
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(a) * Math.cos(d)))) * RAD;
}

export function laeaForward(lon, lat, subLon, R = R_MEAN) {
  const p = lat * DEG, d = (lon - subLon) * DEG;
  const k = Math.sqrt(2 / (1 + Math.cos(p) * Math.cos(d)));
  return [R * k * Math.cos(p) * Math.sin(d), R * k * Math.sin(p)];
}

export function laeaInverse(x, y, subLon, R = R_MEAN) {
  const rho = Math.hypot(x, y);
  if (rho < 1e-12) return [subLon, 0];
  if (rho > 2 * R) return null;
  const c = 2 * Math.asin(rho / (2 * R));
  const lat = Math.asin((y * Math.sin(c)) / rho) * RAD;
  const lon = subLon + Math.atan2(x * Math.sin(c), rho * Math.cos(c)) * RAD;
  return [wrap(lon), lat];
}

export function frameForward(frame, lon, lat, sat) {
  if (frame === "scan") return geosForward(lon, lat, sat.lon, sat.sweep);
  if (frame === "lonlat") return [wrap(lon - sat.lon), lat];
  return laeaForward(lon, lat, sat.lon);
}

export function frameInverse(frame, u, v, sat) {
  if (frame === "scan") return geosInverse(u, v, sat.lon, sat.sweep);
  if (frame === "lonlat") return Math.abs(v) <= 90 ? [wrap(sat.lon + u), v] : null;
  return laeaInverse(u, v, sat.lon);
}

export function visible(frame, lon, lat, sat) {
  if (frame === "scan") return !!geosForward(lon, lat, sat.lon, sat.sweep);
  return centralAngle(lon, lat, sat.lon) <= limbAngle();
}

export function frameExtent(frame) {
  if (frame === "scan") return halfAngle();
  if (frame === "lonlat") return limbAngle();
  return laeaForward(limbAngle(), 0, 0)[0];
}

export function groundDistance(a, b) {
  return geodesicInverse(a[0], a[1], b[0], b[1]).s12 / 1000;
}

export function cellSize(frame, u0, v0, u1, v1, sat) {
  const mid = (u, v) => frameInverse(frame, u, v, sat);
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const L = mid(u0, vm), R = mid(u1, vm), B = mid(um, v0), T = mid(um, v1);
  if (!L || !R || !B || !T) return null;
  return { w: groundDistance(L, R), h: groundDistance(B, T) };
}

export function cellAt(frame, lon, lat, sat, step) {
  const f = frameForward(frame, lon, lat, sat);
  if (!f) return null;
  const i = Math.floor(f[0] / step), j = Math.floor(f[1] / step);
  return { i, j, u0: i * step, v0: j * step, u1: (i + 1) * step, v1: (j + 1) * step, f };
}

function planeBasis(subLon) {
  const s = Math.sin(subLon * DEG), c = Math.cos(subLon * DEG);
  return { n: [s, 0, c], e: [c, 0, -s], up: [0, 1, 0] };
}

export function frameMorph(frame, sat) {
  const ext = frameExtent(frame);
  const scale = 1 / ext;
  const { n, e, up } = planeBasis(sat.lon);
  const limb = limbAngle();
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    let a, b, d = 0;
    const f = frame === "lonlat" ? [wrap(lon - sat.lon), lat] : visible(frame, lon, lat, sat) ? frameForward(frame, lon, lat, sat) : null;
    if (f) { a = f[0] * scale; b = f[1] * scale; }
    else {
      const cl = Math.cos(lat * DEG);
      const P = [cl * Math.sin(lon * DEG), Math.sin(lat * DEG), cl * Math.cos(lon * DEG)];
      const pe = P[0] * e[0] + P[2] * e[2], pn = P[1];
      const l = Math.hypot(pe, pn) || 1;
      const c = centralAngle(lon, lat, sat.lon);
      a = pe / l; b = pn / l;
      d = -0.15 - 0.6 * Math.max(0, c - limb) / (180 - limb);
    }
    out[0] = a * e[0] + b * up[0] + d * n[0];
    out[1] = a * e[1] + b * up[1] + d * n[1];
    out[2] = a * e[2] + b * up[2] + d * n[2];
    return out;
  };
  fn.phased = false;
  fn.seam = wrap(sat.lon + 180);
  fn.tear = Infinity;
  return fn;
}

export function gridSegments(frame, step, sat) {
  const ext = frameExtent(frame) + step;
  const n = Math.ceil(ext / step);
  const ds = step / 10;
  const segs = [];
  const ok = (p) => p && visible(frame, p[0], p[1], sat);
  const line = (fixed, isU) => {
    let prev = null;
    for (let s = -ext; s <= ext + 1e-9; s += ds) {
      const p = isU ? frameInverse(frame, fixed, s, sat) : frameInverse(frame, s, fixed, sat);
      const cur = ok(p) ? p : null;
      if (prev && cur && Math.abs(wrap(cur[0] - prev[0])) < 30) segs.push([prev, cur]);
      prev = cur;
    }
  };
  for (let k = -n; k <= n; k++) {
    if (frame === "lonlat" && Math.abs(k * step) > 90) continue;
    line(k * step, true);
    line(k * step, false);
  }
  return segs;
}

export function limbSegments(sat, n = 240) {
  const limb = limbAngle() - 0.05;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const az = (i / n) * 2 * Math.PI;
    const c = limb * DEG;
    const lat = Math.asin(Math.sin(c) * Math.cos(az)) * RAD;
    const lon = sat.lon + Math.atan2(Math.sin(az) * Math.sin(c), Math.cos(c)) * RAD;
    pts.push([wrap(lon), lat]);
  }
  const segs = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
  return segs;
}

function cellOutline(frame, cell, sat) {
  const pts = [];
  const k = 16;
  const edge = (ua, va, ub, vb) => { for (let i = 0; i < k; i++) { const t = i / k; pts.push(frameInverse(frame, ua + (ub - ua) * t, va + (vb - va) * t, sat)); } };
  edge(cell.u0, cell.v0, cell.u1, cell.v0); edge(cell.u1, cell.v0, cell.u1, cell.v1); edge(cell.u1, cell.v1, cell.u0, cell.v1); edge(cell.u0, cell.v1, cell.u0, cell.v0);
  pts.push(pts[0]);
  const segs = [];
  for (let i = 1; i < pts.length; i++) if (pts[i - 1] && pts[i] && visible(frame, ...pts[i - 1], sat) && visible(frame, ...pts[i], sat)) segs.push([pts[i - 1], pts[i]]);
  return segs;
}

export function nadirSize(frame, step, sat) {
  return cellSize(frame, -step / 2, -step / 2, step / 2, step / 2, sat);
}

const fmtKm = (v) => (v >= 100 ? fmtNum(v, 0) : v >= 10 ? fmtNum(v, 1) : fmtNum(v, 2));

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let sat = satelliteOf(params.satellite);
  let builtKey = "";
  let probed = null;
  let framedLon = null;
  let booted = false;
  let fade = null;
  let morphTween = null;
  const lineIds = { scan: PREFIX + "grid-scan", lonlat: PREFIX + "grid-lonlat", metres: PREFIX + "grid-metres" };

  const over = ctx.stage.canvas("riw-over");
  over.style.pointerEvents = "none";
  over.style.zIndex = "3";
  const og = over.getContext("2d");

  const step = () => STEPS[params.frame][params.step];

  const buildGrids = () => {
    const key = sat.value + "|" + params.step;
    if (key === builtKey) return;
    builtKey = key;
    for (const f of ["scan", "lonlat", "metres"]) {
      globe.addLines(lineIds[f], gridSegments(f, STEPS[f][params.step], sat), { color: COLOURS[f], width: f === params.frame ? 1.25 : 1, depth: true, opacity: f === params.frame ? 0.9 : 0 });
      globe.setLayer(lineIds[f], f === params.frame);
    }
    globe.addLines(PREFIX + "limb", limbSegments(sat), { color: "#b7791f", width: 1.75, depth: true, dash: [6, 4] });
    globe.addPoints(PREFIX + "nadir", [[sat.lon, 0]], { color: "#1a1917", size: 7 });
  };

  const showFrame = (prev) => {
    if (fade) fade.cancel();
    const next = params.frame;
    for (const f of ["scan", "lonlat", "metres"]) globe.setLayer(lineIds[f], f === next || f === prev);
    if (!prev || prev === next || ctx.reducedMotion) {
      for (const f of ["scan", "lonlat", "metres"]) { globe.setLineStyle(lineIds[f], { opacity: f === next ? 0.9 : 0 }); globe.setLayer(lineIds[f], f === next); }
      return;
    }
    fade = ctx.anim.tween({ from: 0, to: 1, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (u) => {
      globe.setLineStyle(lineIds[next], { opacity: 0.9 * u });
      globe.setLineStyle(lineIds[prev], { opacity: 0.9 * (1 - u) });
    }, onDone: () => { fade = null; globe.setLayer(lineIds[prev], false); } });
  };

  const setMorph = (prevFrame) => {
    const target = frameMorph(params.frame, sat);
    if (morphTween) { morphTween.cancel(); morphTween = null; }
    if (!prevFrame || prevFrame === params.frame || t <= 0 || ctx.reducedMotion) { globe.morph(target, t); return; }
    const from = frameMorph(prevFrame, sat);
    const a = [0, 0, 0], b = [0, 0, 0];
    morphTween = ctx.anim.tween({ from: 0, to: 1, duration: 900, ease: ctx.anim.ease.emph, onUpdate: (u) => {
      const mix = (lon, lat, tt, out = [0, 0, 0]) => {
        from(lon, lat, 1, a); target(lon, lat, 1, b);
        out[0] = a[0] + (b[0] - a[0]) * u; out[1] = a[1] + (b[1] - a[1]) * u; out[2] = a[2] + (b[2] - a[2]) * u;
        return out;
      };
      mix.phased = false; mix.seam = target.seam; mix.tear = Infinity;
      globe.morph(u >= 1 ? target : mix, t);
      frameCamera(true);
      ctx.overlay.update();
    }, onDone: () => { morphTween = null; globe.morph(target, t); frameCamera(true); } });
  };

  const insetWidth = () => (ctx.stage.width < 760 ? 220 : 300);
  const showInset = () => ctx.stage.height >= 560;
  const frameCamera = (keepRotation, duration = 0) => {
    if (ctx.side !== "A") return;
    if (t <= 0) framedLon = null;
    if (t > 0 && !keepRotation && framedLon !== sat.lon) {
      globe.camera.lookAt(sat.lon, 0, null, { duration: booted && !ctx.reducedMotion ? 500 : 0 });
      framedLon = sat.lon;
    }
    const f = globe.camera.fit(null, { padding: 24, insetTop: 60, insetBottom: ctx.stage.insetBottom, insetLeft: showInset() ? insetWidth() + 24 : 0, minDist: meta.view.dist, apply: false });
    if (duration > 0 && !ctx.reducedMotion) { globe.camera.glideTo({ dist: f.dist, pan: f.pan }, { duration }); return; }
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0], f.pan[1]);
  };

  const probeCell = () => {
    if (!probed) { globe.remove(PREFIX + "probe"); return null; }
    const cell = cellAt(params.frame, probed.lon, probed.lat, sat, step());
    if (!cell || !visible(params.frame, probed.lon, probed.lat, sat)) { globe.remove(PREFIX + "probe"); return null; }
    globe.addLines(PREFIX + "probe", cellOutline(params.frame, cell, sat), { color: "#ffffff", width: 2.5, depth: true });
    return cell;
  };

  const sizeText = (cell) => {
    if (!cell) return "–";
    const s = cellSize(params.frame, cell.u0, cell.v0, cell.u1, cell.v1, sat);
    return s ? `${fmtKm(s.w)} × ${fmtKm(s.h)} km` : "off the disc";
  };

  const readouts = (cell) => {
    ctx.readout.setMany({
      satLon: sat.lon === 0 ? "0.0°" : `${Math.abs(sat.lon).toFixed(1)}° ${sat.lon < 0 ? "W" : "E"}`,
      half: halfAngle(),
      cell: cell ? sizeText(cell) : `${sizeText(cellAt(params.frame, sat.lon + 1e-9, 1e-9, sat, step()))} at nadir`,
      limb: limbAngle(),
    });
  };

  const insetH = 176;
  const drawOverlay = () => {
    const W = ctx.stage.width, H = ctx.stage.height, dpr = ctx.stage.dpr;
    if (over.width !== Math.round(W * dpr) || over.height !== Math.round(H * dpr)) { over.width = Math.round(W * dpr); over.height = Math.round(H * dpr); }
    og.setTransform(dpr, 0, 0, dpr, 0, 0);
    og.clearRect(0, 0, W, H);
    const lines = {
      scan: ["Equal steps of scan angle at the satellite.", "On the ground the cells grow toward the edge of the disc."],
      lonlat: ["Equal steps of longitude and latitude.", "Cells get narrow toward the poles."],
      metres: ["Equal steps in metres on an equal-area map.", "Each cell has the same area, not the same shape."],
    }[params.frame];
    drawCaption(og, 16, 16, lines, { accent: COLOURS[params.frame] });
    if (!showInset()) return;
    const insetW = insetWidth();
    const x0 = 16, y0 = H - ctx.stage.insetBottom - insetH - 14;
    og.fillStyle = "rgba(255,255,255,.92)";
    og.beginPath(); og.roundRect(x0, y0, insetW, insetH, 12); og.fill();
    og.strokeStyle = "rgba(205,198,183,.9)"; og.lineWidth = 1; og.stroke();
    og.font = `600 10px ${FONT_UI}`; og.fillStyle = INK.ink3; og.textAlign = "left"; og.textBaseline = "middle";
    og.fillText("SIDE VIEW: WHAT IS EQUAL", x0 + 14, y0 + 16);
    const R = (insetW - 64) / (GEO.h / GEO.req + 1), cx = x0 + R + 18, cy = y0 + 92;
    const sx = cx + (GEO.h / GEO.req) * R, sy = cy;
    og.fillStyle = "#bcd1dd";
    og.beginPath(); og.arc(cx, cy, R, 0, Math.PI * 2); og.fill();
    og.strokeStyle = "rgba(50,46,40,.55)"; og.lineWidth = 1; og.stroke();
    const col = COLOURS[params.frame];
    const hits = [];
    const limb = limbAngle() * DEG;
    if (params.frame === "scan") {
      const st = STEPS.scan[params.step] * 2;
      for (let a = -halfAngle(); a <= halfAngle() + 1e-6; a += st) {
        const ang = a * DEG;
        const d = [-Math.cos(ang), Math.sin(ang)];
        const b = 2 * ((sx - cx) * d[0] + (sy - cy) * d[1]);
        const c = (sx - cx) ** 2 + (sy - cy) ** 2 - R * R;
        const disc = b * b - 4 * c;
        if (disc < 0) continue;
        const s = (-b - Math.sqrt(disc)) / 2;
        const hx = sx + d[0] * s, hy = sy + d[1] * s;
        og.strokeStyle = "rgba(29,99,168,.35)"; og.lineWidth = 1;
        og.beginPath(); og.moveTo(sx, sy); og.lineTo(hx, hy); og.stroke();
        hits.push([hx, hy]);
      }
    } else {
      const angles = [];
      const mapX = cx + R + 22, mapScale = R / 1.3;
      const ext = frameExtent("metres"), stm = STEPS.metres[params.step] * 2;
      if (params.frame === "metres") {
        for (let x = -Math.floor(ext / stm) * stm; x <= ext + 1e-6; x += stm) angles.push([2 * Math.asin(x / (2 * R_MEAN)), x / R_MEAN]);
        og.strokeStyle = "rgba(47,125,79,.8)"; og.lineWidth = 1.5;
        og.beginPath(); og.moveTo(mapX, cy - (ext / R_MEAN) * mapScale - 4); og.lineTo(mapX, cy + (ext / R_MEAN) * mapScale + 4); og.stroke();
        text(og, mapX + 6, cy - (ext / R_MEAN) * mapScale - 10, "map", { color: "#2f7d4f", size: 10 });
      } else angles.push(...[...Array(1 + 2 * Math.floor(limb * RAD / (STEPS.lonlat[params.step] * 2)))].map((_, k) => [(-Math.floor(limb * RAD / (STEPS.lonlat[params.step] * 2)) + k) * STEPS.lonlat[params.step] * 2 * DEG, 0]));
      for (const [a, m] of angles) {
        const hx = cx + Math.cos(a) * R, hy = cy - Math.sin(a) * R;
        og.strokeStyle = params.frame === "lonlat" ? "rgba(184,82,23,.35)" : "rgba(47,125,79,.45)"; og.lineWidth = 1;
        og.beginPath();
        if (params.frame === "lonlat") og.moveTo(cx, cy); else { og.moveTo(mapX, cy - m * mapScale); og.fillStyle = "#2f7d4f"; og.fillRect(mapX - 3, cy - m * mapScale - 0.5, 6, 1); }
        og.lineTo(hx, hy); og.stroke();
        hits.push([hx, hy]);
      }
    }
    og.fillStyle = col;
    for (const [hx, hy] of hits) { og.beginPath(); og.arc(hx, hy, 2, 0, Math.PI * 2); og.fill(); }
    if (hits.length > 2) {
      const a = hits[hits.length - 1], b = hits[hits.length - 2], m0 = hits[Math.floor(hits.length / 2)], m1 = hits[Math.floor(hits.length / 2) - 1];
      og.strokeStyle = "#ffffff"; og.lineWidth = 2.5;
      og.beginPath(); og.moveTo(a[0], a[1]); og.lineTo(b[0], b[1]); og.stroke();
      og.beginPath(); og.moveTo(m0[0], m0[1]); og.lineTo(m1[0], m1[1]); og.stroke();
    }
    og.strokeStyle = "rgba(183,121,31,.8)"; og.setLineDash([4, 3]); og.lineWidth = 1;
    for (const s of [1, -1]) {
      const tx = cx + Math.cos(limb) * R, ty = cy - s * Math.sin(limb) * R;
      og.beginPath(); og.moveTo(sx, sy); og.lineTo(tx, ty); og.stroke();
    }
    og.setLineDash([]);
    og.fillStyle = INK.ink;
    og.beginPath(); og.moveTo(sx, sy - 5); og.lineTo(sx + 5, sy); og.lineTo(sx, sy + 5); og.lineTo(sx - 5, sy); og.closePath(); og.fill();
    text(og, sx, sy + 16, "satellite", { color: INK.ink2, size: 10, align: "center" });
    text(og, sx - 8, sy - 30, `${(2 * halfAngle()).toFixed(1)}°`, { color: INK.warn, size: 10, align: "right" });
    text(og, x0 + 14, y0 + insetH - 16, params.frame === "scan" ? "equal angle at the satellite" : params.frame === "lonlat" ? "equal angle at the centre" : "equal distance on the map", { color: col, size: 10.5 });
  };

  globe.setLayer("graticule", false);
  setMorph();
  buildGrids();
  showFrame();
  readouts(null);
  drawOverlay();
  if (ctx.side === "A" && globe.camera) { if (t <= 0) globe.camera.lookAt(sat.lon + 35, 20, null, { duration: 0 }); frameCamera(false); }

  if (ctx.transport) ctx.transport.onScrub((value) => {
    t = value;
    if (morphTween) { morphTween.cancel(); morphTween = null; globe.morph(frameMorph(params.frame, sat), t); }
    globe.setMorphT(t);
    frameCamera(false);
    ctx.overlay.update();
  });
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      const prevFrame = params.frame, prevSat = sat.value;
      params = { ...p };
      t = params.m ?? t;
      sat = satelliteOf(params.satellite);
      if (keys.includes("satellite") && prevSat !== sat.value) {
        setMorph();
        buildGrids();
        showFrame();
        if (ctx.side === "A") { globe.camera.lookAt(t > 0 ? sat.lon : sat.lon + 35, t > 0 ? 0 : 20, null, { duration: booted && !ctx.reducedMotion ? 650 : 0 }); framedLon = t > 0 ? sat.lon : null; }
      }
      if (keys.includes("step")) { buildGrids(); showFrame(); }
      if (keys.includes("frame") && prevFrame !== params.frame) { showFrame(prevFrame); setMorph(prevFrame); }
      if (t > 0 && !morphTween) frameCamera(false);
      if (keys.length > 1 && t <= 0) frameCamera(false);
      const cell = probeCell();
      readouts(cell);
      drawOverlay();
    },
    hover(lon, lat) {
      if (!visible(params.frame, lon, lat, sat)) return ["off the disc: the satellite cannot see it"];
      const cell = cellAt(params.frame, lon, lat, sat, step());
      if (!cell) return [];
      const s = cellSize(params.frame, cell.u0, cell.v0, cell.u1, cell.v1, sat);
      const nad = nadirSize(params.frame, step(), sat);
      const lines = [`cell (${cell.i}, ${cell.j}) of ${step()}${UNITS[params.frame]}`];
      if (s) lines.push(`${fmtKm(s.w)} × ${fmtKm(s.h)} km on the ground`);
      if (s && nad && params.frame === "scan") lines.push(`a 3 km nadir pixel here: ${(3 * s.w / nad.w).toFixed(1)} × ${(3 * s.h / nad.h).toFixed(1)} km`);
      lines.push(`${centralAngle(lon, lat, sat.lon).toFixed(1)}° from the sub-satellite point`);
      return lines;
    },
    probe(lon, lat) {
      probed = { lon, lat };
      const cell = probeCell();
      readouts(cell);
      return {};
    },
    unprobe() {
      probed = null;
      globe.remove(PREFIX + "probe");
      readouts(null);
    },
    resize() {
      drawOverlay();
      frameCamera(false);
    },
    unmount() {
      if (fade) fade.cancel();
      if (morphTween) morphTween.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      globe.setLayer("graticule", true);
      over.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
