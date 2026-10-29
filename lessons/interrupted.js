import { get as getProjection, interpolate, factors, reframeClip, fromRaw } from "@/core/projections.js";
import { morphs } from "@/core/globe.js";
import { interruptedAt, drawIndicatrices, indicatrixGrid, drawCaption, geo, EARTH_R_KM, FONT_MONO } from "@/core/map2d.js";
import { landPoints } from "@/lessons/compromise-maps.js";
import { smoothstep } from "@/core/math.js";

const lobes = (north, south) => [north.map(([a, c, b]) => [[a, 0], [c, 90], [b, 0]]), south.map(([a, c, b]) => [[a, 0], [c, -90], [b, 0]])];

export const LAYOUTS = {
  goodeLand: { label: "Goode land", raw: "homolosine", lobes: lobes([[-180, -100, -40], [-40, 30, 180]], [[-180, -160, -100], [-100, -60, -20], [-20, 20, 80], [80, 140, 180]]), count: 6, rotate: [0, 0, 0], kink: true },
  goodeOcean: { label: "Goode ocean", raw: "homolosine", lobes: lobes([[-180, -140, -100], [-100, -20, 60], [60, 120, 180]], [[-180, -122.5, -65], [-65, 15, 95], [95, 137.5, 180]]), count: 6, rotate: [160, 0, 0], kink: true },
  gores: { label: "12 gores", raw: "sinusoidal", lobes: lobes(Array.from({ length: 12 }, (_, k) => [-180 + 30 * k, -165 + 30 * k, -150 + 30 * k]), Array.from({ length: 12 }, (_, k) => [-180 + 30 * k, -165 + 30 * k, -150 + 30 * k])), count: 12, rotate: [0, 0, 0] },
  butterfly: { label: "Butterfly", net: "butterfly", base: "azimuthalEqualArea", baseOpts: { lat0: 90, lon0: 0, clipAngle: 179.9 }, count: 8 },
  icosahedral: { label: "Icosahedral", net: "airocean", base: "equalEarth", count: 20, facets: true },
};

export const meta = {
  id: "interrupted",
  title: "Cut where it hurts least",
  track: 3,
  order: 9,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "interruptedHomolosine",
  labels: false,
  paragraph: "Cutting the globe in more places makes every piece more true. Goode cut the oceans so the land stays good. Gores cut everything into strips you can paste on a ball. A butterfly cuts into eight triangles. Slide the cut to see the lobes separate.",
  deeper: [
    "Goode changes rule at 40°44′ N and S.",
    "12 gores are 30° wide each.",
    "An octant holds 1/8 of the sphere, 63.8 M km².",
    "The icosahedral net has 20 triangles and no visible cut through a continent.",
  ],
  keywords: ["interrupted", "Goode", "homolosine", "gores", "butterfly", "icosahedron"],
  controls: [
    { key: "layout", type: "select", label: "Layout", options: Object.entries(LAYOUTS).map(([value, l]) => ({ value, label: l.label })), default: "goodeLand" },
    { key: "tissot", type: "toggle", label: "Tissot", default: false, shortcut: "t" },
    { type: "legend", label: "Key", items: [{ color: "#1d63a8", dash: true, label: "Central meridian of each lobe" }, { color: "#b85217", label: "Lobe under the pointer" }] },
  ],
  readouts: [
    { key: "lobes", label: "Lobes", digits: 0, hero: true },
    { key: "cutLat", label: "Cut latitude" },
    { key: "lobeArea", label: "Mean area of a lobe", digits: 1, unit: "million km²" },
    { key: "maxOmega", label: "Largest angle error ω on land", digits: 1, unit: "degrees" },
  ],
  transport: { label: ["cut", "joined"], key: "m" },
  compare: null,
  view: { lon: 0, lat: 0, dist: 2.9 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
export const GOODE_KINK = 40.7366;
export const SPHERE_MKM2 = (4 * Math.PI * EARTH_R_KM * EARTH_R_KM) / 1e6;
const INSET_TOP = 60;

const RAD = 180 / Math.PI;

export function netOutline(net, base) {
  const ring = [], clip = net.preclip(), skip = () => {};
  const sink = { point: skip, lineStart: skip, lineEnd: skip, polygonStart: skip, polygonEnd: skip, sphere: skip };
  net.preclip(() => ({ ...sink, point: (x, y) => ring.push([x * RAD, y * RAD]) }));
  net.stream({ ...sink }).sphere();
  net.preclip(clip);
  if (!base) return ring;
  return ring.flatMap((v, i) => {
    const a = ring[(i + ring.length - 2) % (ring.length - 1)], c = ring[(i + 1) % (ring.length - 1)];
    const pa = base([a[0], v[1]]), pc = base([c[0], v[1]]);
    if (Math.abs(v[1]) < 89.9 || Math.hypot(pa[0] - pc[0], pa[1] - pc[1]) < 1) return [v];
    const s0 = wrap(a[0] - v[0]) * 0.9999, s1 = wrap(c[0] - v[0]) * 0.9999, n = Math.ceil(Math.abs(s1 - s0) / 2);
    return Array.from({ length: n + 1 }, (_, k) => [v[0] + s0 + ((s1 - s0) * k) / n, v[1]]);
  });
}

function screenRings(p) {
  const rings = [], skip = () => {};
  let ring = null;
  p.stream({ polygonStart: skip, polygonEnd: skip, sphere: skip, lineStart: () => rings.push(ring = []), lineEnd: skip, point: (x, y) => ring.push([x, y]) }).sphere();
  return rings;
}

function newton(p, [x, y], seed, J = null) {
  if (!seed || !isFinite(seed[0]) || !isFinite(seed[1])) return null;
  let [lon, lat] = seed, prev = Infinity;
  for (let i = 0; i < 10; i++) {
    const f = p([lon, lat]), ex = f[0] - x, ey = f[1] - y, e = Math.abs(ex) + Math.abs(ey);
    if (!isFinite(e)) return null;
    if (e < 0.02) return [lon, lat, J];
    if (!J || e > prev * 0.5) {
      const h = lat > 0 ? -1e-5 : 1e-5, fx = p([lon + h, lat]), fy = p([lon, lat + h]);
      J = [(fx[0] - f[0]) / h, (fy[0] - f[0]) / h, (fx[1] - f[1]) / h, (fy[1] - f[1]) / h];
    }
    prev = e;
    const [a, b, c, d] = J, det = a * d - b * c;
    if (!(Math.abs(det) > 1e-12)) return null;
    const dl = (d * ex - b * ey) / det, dp = (a * ey - c * ex) / det;
    if (Math.abs(dl) > 30 || Math.abs(dp) > 30) return null;
    lon = wrap(lon - dl); lat -= dp;
    if (Math.abs(lat) > 90) return null;
  }
  return null;
}

function winding(rings, x, y) {
  let w = 0;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yj <= y) { if (yi > y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) > 0) w++; }
    else if (yi <= y && (xi - xj) * (y - yj) - (x - xj) * (yi - yj) < 0) w--;
  }
  return w !== 0;
}

const FACET_N = 10;
const FACET_SHRINK = 0.65;
const FACET_SPREAD = 0.35;
const FACET_PHASE = 0.35;
const FACET_POLE_STEP = 6;
const facetModels = new Map();

const unitVec = ([lon, lat]) => { const l = lon / RAD, p = lat / RAD, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; };
const normed = (v) => { const h = Math.hypot(v[0], v[1], v[2]); return [v[0] / h, v[1] / h, v[2] / h]; };
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotV = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mixV = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const lonLatOf = (v, side = 0) => {
  let lon = Math.atan2(v[1], v[0]) * RAD;
  if (side < 0 && lon > 90) lon -= 360;
  if (side > 0 && lon < -90) lon += 360;
  return [lon, Math.asin(Math.max(-1, Math.min(1, v[2]))) * RAD];
};

function halfOf(poly, sign, pole) {
  const out = [];
  let at = -1;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], ia = sign * a[1] >= 0, ib = sign * b[1] >= 0;
    if (ia) out.push(a);
    if (ia !== ib) { const s = a[1] / (a[1] - b[1]); out.push(normed([a[0] + s * (b[0] - a[0]), 0, a[2] + s * (b[2] - a[2])])); if (ia) at = out.length; }
  });
  if (pole && at >= 0) out.splice(at, 0, pole);
  return out;
}

function fanOf(poly) {
  const a = poly.findIndex((v) => Math.abs(v[2]) > 1 - 1e-9);
  if (a < 0) return poly.slice(1, -1).map((_, k) => [poly[0], poly[k + 1], poly[k + 2]]);
  const ring = [...poly.slice(a), ...poly.slice(0, a)], apex = ring[0], rim = [ring[1]];
  for (let k = 1; k + 1 < ring.length; k++) {
    const P = ring[k], Q = ring[k + 1], span = Math.abs(((Math.atan2(Q[1], Q[0]) - Math.atan2(P[1], P[0])) * RAD + 540) % 360 - 180);
    const m = Math.max(1, Math.ceil(span / FACET_POLE_STEP));
    for (let s = 1; s <= m; s++) rim.push(normed(mixV(P, Q, s / m)));
  }
  return rim.slice(0, -1).map((v, k) => [apex, v, rim[k + 1]]);
}

function facetPieces(net) {
  const rot = geo.rotation(net.rotate()), pieces = [];
  for (const f of net.faces) {
    const tri = f.face.map((q) => unitVec(rot.invert(q)));
    if (dotV(tri[0], crossV(tri[1], tri[2])) < 0) tri.reverse();
    const cut = tri.some((a, i) => {
      const b = tri[(i + 1) % 3];
      return a[1] * b[1] < 0 && a[0] + (a[1] / (a[1] - b[1])) * (b[0] - a[0]) < 0;
    });
    const pole = [[0, 0, 1], [0, 0, -1]].find((P) => tri.every((a, i) => dotV(P, crossV(a, tri[(i + 1) % 3])) > 0));
    for (const [poly, side] of cut ? [[halfOf(tri, -1, pole), -1], [halfOf(tri, 1, pole), 1]] : [[tri, 0]]) if (poly.length >= 3) pieces.push({ poly, side });
  }
  return pieces;
}

function facetModel(base, net) {
  const n = FACET_N, fans = [], pieces = facetPieces(net);
  for (const piece of pieces) {
    const { poly, side } = piece, verts = [];
    piece.fans = [];
    for (const [A, B, C] of fanOf(poly)) {
      const det = dotV(A, crossV(B, C));
      const mid = normed([0, 1, 2].map((d) => 0.5 * A[d] + 0.3 * B[d] + 0.2 * C[d]));
      const fan = { piece, A, B, C, inv: [crossV(B, C), crossV(C, A), crossV(A, B)].map((r) => r.map((x) => x / det)), base: verts.length };
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
        const q = [0, 1, 2].map((d) => A[d] + (i / n) * (B[d] - A[d]) + (j / n) * (C[d] - A[d]));
        const v = normed(mixV(normed(q), mid, 1e-6));
        verts.push({ b: base(lonLatOf(v, side)), m: net(lonLatOf(v)) });
      }
      piece.fans.push(fan);
      fans.push(fan);
    }
    let cb = [0, 0], cn = [0, 0];
    for (const v of verts) { cb[0] += v.b[0]; cb[1] += v.b[1]; cn[0] += v.m[0]; cn[1] += v.m[1]; }
    cb = cb.map((x) => x / verts.length); cn = cn.map((x) => x / verts.length);
    let sc = 0, sd = 0, bb = 0, nn = 0;
    for (const v of verts) {
      const bx = v.b[0] - cb[0], by = v.b[1] - cb[1], nx = v.m[0] - cn[0], ny = v.m[1] - cn[1];
      sc += bx * ny - by * nx; sd += bx * nx + by * ny; bb += bx * bx + by * by; nn += nx * nx + ny * ny;
    }
    const theta = Math.atan2(sc, sd), scale = Math.sqrt(nn / bb), co = Math.cos(-theta) / scale, si = Math.sin(-theta) / scale;
    piece.verts = verts.map((v) => {
      const nx = v.m[0] - cn[0], ny = v.m[1] - cn[1];
      return [v.b[0] - cb[0], v.b[1] - cb[1], co * nx - si * ny, si * nx + co * ny];
    });
    Object.assign(piece, { cb, cn, theta, scale });
    const c = normed(poly.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]));
    const ring = poly.map((v) => lonLatOf(normed(mixV(v, c, 1e-4))));
    ring.push(ring[0]);
    piece.ring = geo.area({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI ? ring.reverse() : ring;
  }
  const mid = [0, 0, 0, 0];
  for (const p of pieces) { mid[0] += p.cb[0] / pieces.length; mid[1] += p.cb[1] / pieces.length; mid[2] += p.cn[0] / pieces.length; mid[3] += p.cn[1] / pieces.length; }
  return { n, pieces, fans, mid, rows: Array.from({ length: n + 1 }, (_, i) => i * (n + 1) - (i * (i - 1)) / 2) };
}

function fanAt(fans, g) {
  let fan = null, w = null;
  for (const f of fans) {
    const a = dotV(f.inv[0], g), b = dotV(f.inv[1], g), c = dotV(f.inv[2], g), s = a + b + c;
    if (!(s > 0)) continue;
    const m = Math.min(a, b, c) / s;
    if (!w || m > w[3]) { fan = f; w = [a / s, b / s, c / s, m]; if (m >= 0) break; }
  }
  return fan && { fan, w };
}

function facetClip(model) {
  const pieceOf = (v) => { const h = fanAt(model.fans, v); return h ? h.fan.piece : null; };
  const rad = (v) => [Math.atan2(v[1], v[0]), Math.asin(Math.max(-1, Math.min(1, v[2])))];
  const rings = model.pieces.map((p) => p.ring.slice(0, -1).map(([lon, lat]) => [lon / RAD, lat / RAD]));
  return (sink) => {
    let prev = null, piece = null, first = null, ring = false;
    const emit = (v) => { const q = rad(v); sink.point(q[0], q[1]); };
    const to = (v) => {
      const k = pieceOf(v);
      for (let guard = 0; prev && k !== piece && guard < 8; guard++) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (pieceOf(normed(mixV(prev, v, m))) === piece) lo = m; else hi = m; }
        const a = normed(mixV(prev, v, lo)), b = normed(mixV(prev, v, hi));
        emit(a); sink.lineEnd(); sink.lineStart(); emit(b);
        prev = b; piece = pieceOf(b);
      }
      emit(v); prev = v; piece = k;
    };
    return {
      point: (l, p) => { const c = Math.cos(p), v = [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; if (!first) first = v; to(v); },
      lineStart: () => { prev = null; piece = null; first = null; sink.lineStart(); },
      lineEnd: () => { if (ring && first) to(first); sink.lineEnd(); },
      polygonStart: () => { ring = true; },
      polygonEnd: () => { ring = false; },
      sphere: () => {
        sink.polygonStart();
        for (const r of rings) { sink.lineStart(); for (const q of r) sink.point(q[0], q[1]); sink.lineEnd(); }
        sink.polygonEnd();
      },
    };
  };
}

function facetFrame(model, t) {
  const { n, pieces, fans, rows } = model, idx = (i, j) => rows[i] + j;
  const gap = 1 - FACET_SHRINK * smoothstep(0, FACET_PHASE, t) * (1 - smoothstep(1 - FACET_PHASE, 1, t));
  const tm = smoothstep(FACET_PHASE - 0.05, 1.05 - FACET_PHASE, t), ex = 1 + FACET_SPREAD * Math.sin(Math.PI * tm);
  const mx = model.mid[0] + (model.mid[2] - model.mid[0]) * tm, my = model.mid[1] + (model.mid[3] - model.mid[1]) * tm;
  const posOf = new Map();
  for (const piece of pieces) {
    const sig = Math.pow(piece.scale, tm) * gap, a = piece.theta * tm, co = Math.cos(a) * sig, si = Math.sin(a) * sig;
    const cx = mx + ex * (piece.cb[0] + (piece.cn[0] - piece.cb[0]) * tm - mx), cy = my + ex * (piece.cb[1] + (piece.cn[1] - piece.cb[1]) * tm - my);
    const pos = new Float64Array(piece.verts.length * 2);
    posOf.set(piece, pos);
    piece.verts.forEach((v, k) => {
      const x = v[0] + (v[2] - v[0]) * t, y = v[1] + (v[3] - v[1]) * t;
      pos[2 * k] = cx + co * x - si * y; pos[2 * k + 1] = cy + si * x + co * y;
    });
  }
  const tris = model.tris || (model.tris = fans.flatMap((fan) => {
    const out = [], tri = (uv) => out.push({ fan, v: uv.map(([i, j]) => fan.base + idx(i, j)), uv });
    for (let i = 0; i < n; i++) for (let j = 0; i + j < n; j++) {
      tri([[i, j], [i + 1, j], [i, j + 1]]);
      if (i + j < n - 1) tri([[i + 1, j + 1], [i, j + 1], [i + 1, j]]);
    }
    return out;
  }));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const fan of fans) {
    const pos = posOf.get(fan.piece);
    for (let k = fan.base; k < fan.base + rows[n] + 1; k++) {
      const x = pos[2 * k], y = pos[2 * k + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const cell = Math.max((x1 - x0) / 96, (y1 - y0) / 96, 1), gw = Math.ceil((x1 - x0) / cell) + 1, gh = Math.ceil((y1 - y0) / cell) + 1;
  const grid = Array.from({ length: gw * gh }, () => []);
  for (const tr of tris) {
    const pos = posOf.get(tr.fan.piece), [a, b, c] = tr.v;
    const xa = pos[2 * a], xb = pos[2 * b], xc = pos[2 * c], ya = pos[2 * a + 1], yb = pos[2 * b + 1], yc = pos[2 * c + 1];
    const ci0 = Math.floor((Math.min(xa, xb, xc) - x0) / cell), ci1 = Math.floor((Math.max(xa, xb, xc) - x0) / cell);
    const cj0 = Math.floor((Math.min(ya, yb, yc) - y0) / cell), cj1 = Math.floor((Math.max(ya, yb, yc) - y0) / cell);
    for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) grid[cj * gw + ci].push(tr);
  }
  const forward = (g) => {
    const hit = fanAt(fans, g);
    if (!hit) return null;
    const { fan, w } = hit;
    const u = w[1] * n, v = w[2] * n;
    const i = Math.max(0, Math.min(n - 1, Math.floor(u))), j = Math.max(0, Math.min(n - 1 - i, Math.floor(v))), fu = u - i, fv = v - j;
    const pos = posOf.get(fan.piece), at = (ii, jj) => 2 * (fan.base + idx(ii, jj));
    const [k0, k1, k2, w0, w1, w2] = fu + fv <= 1 || i + j >= n - 1
      ? [at(i, j), at(i + 1, j), at(i, j + 1), 1 - fu - fv, fu, fv]
      : [at(i + 1, j + 1), at(i, j + 1), at(i + 1, j), fu + fv - 1, 1 - fu, 1 - fv];
    return [w0 * pos[k0] + w1 * pos[k1] + w2 * pos[k2], w0 * pos[k0 + 1] + w1 * pos[k1 + 1] + w2 * pos[k2 + 1]];
  };
  const inverse = (x, y) => {
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((y - y0) / cell);
    if (ci < 0 || cj < 0 || ci >= gw || cj >= gh) return null;
    for (const tr of grid[cj * gw + ci]) {
      const pos = posOf.get(tr.fan.piece), [p, q, r] = tr.v.map((k) => 2 * k);
      const ax = pos[p], ay = pos[p + 1], bx = pos[q] - ax, by = pos[q + 1] - ay, cx = pos[r] - ax, cy = pos[r + 1] - ay;
      const det = bx * cy - by * cx;
      if (!det) continue;
      const l1 = ((x - ax) * cy - (y - ay) * cx) / det, l2 = (bx * (y - ay) - by * (x - ax)) / det, l0 = 1 - l1 - l2;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const u = (l0 * tr.uv[0][0] + l1 * tr.uv[1][0] + l2 * tr.uv[2][0]) / n, v = (l0 * tr.uv[0][1] + l1 * tr.uv[1][1] + l2 * tr.uv[2][1]) / n;
      const { A, B, C } = tr.fan;
      return normed([A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1]), A[2] + u * (B[2] - A[2]) + v * (C[2] - A[2])]);
    }
    return null;
  };
  return { forward, inverse };
}

export function facetMorph(base, net, t, extent) {
  const key = JSON.stringify(extent);
  let model = facetModels.get(key);
  if (!model) { facetModels.clear(); facetModels.set(key, model = facetModel(base, net)); }
  const { forward, inverse } = facetFrame(model, t);
  const k = base.scale(), c0 = forward(unitVec([0, 0]));
  const raw = (lam, phi) => {
    const c = Math.cos(phi), q = forward([c * Math.cos(lam), c * Math.sin(lam), Math.sin(phi)]);
    return q ? [(q[0] - c0[0]) / k, (c0[1] - q[1]) / k] : [NaN, NaN];
  };
  raw.invert = (x, y) => {
    const g = inverse(c0[0] + x * k, c0[1] - y * k);
    return g ? [Math.atan2(g[1], g[0]), Math.asin(Math.max(-1, Math.min(1, g[2])))] : [NaN, NaN];
  };
  return fromRaw(raw).preclip(model.clip || (model.clip = facetClip(model))).scale(k).translate(c0).precision(0.3);
}

export function projectionAt(layoutId, cut, size) {
  const L = LAYOUTS[layoutId];
  if (L.net) {
    const fit = (id, o) => getProjection(id, o).fitExtent(size.extent, { type: "Sphere" });
    const net = fit(L.net);
    if (cut >= 1) return net;
    const base = fit(L.base, L.baseOpts);
    if (cut <= 0) return base;
    if (L.facets) return facetMorph(base, net, cut, size.extent);
    const p = interpolate(base, net, cut);
    p.preclip(reframeClip(net.preclip(), p.rotate(), net.rotate()));
    const ring = netOutline(net, base);
    if (ring.length) {
      const stream = p.stream;
      p.stream = (sink) => {
        const st = stream(sink);
        st.sphere = () => { st.polygonStart(); st.lineStart(); for (const q of ring) st.point(q[0], q[1]); st.lineEnd(); st.polygonEnd(); };
        return st;
      };
    }
    const invert = p.invert;
    let key = "", rings = [], last = null;
    p.invert = (xy) => {
      const k = p.scale() + "," + p.translate();
      if (k !== key) { key = k; rings = screenRings(p); last = null; }
      if (!winding(rings, xy[0], xy[1])) return [NaN, NaN];
      const g = (last && newton(p, xy, last, last[2])) || newton(p, xy, base.invert(xy)) || newton(p, xy, net.invert(xy));
      if (g) return [(last = g)[0], g[1]];
      return invert(xy);
    };
    return p;
  }
  const full = interruptedAt(L.raw, L.lobes, 1, { rotate: L.rotate });
  full.fitExtent(size.extent, { type: "Sphere" });
  const p = interruptedAt(L.raw, L.lobes, cut, { rotate: L.rotate });
  p.scale(full.scale()).translate(full.translate());
  const invert = p.invert, hits = (g, xy) => { const q = g && isFinite(g[0]) ? p(g) : null; return q && Math.abs(q[0] - xy[0]) + Math.abs(q[1] - xy[1]) < 0.5; };
  let key = "", lobes = [];
  p.invert = (xy) => {
    const g = invert(xy);
    if (hits(g, xy)) return g;
    const k = p.scale() + "," + p.translate();
    if (k !== key) { key = k; lobes = lobeProjections(L, cut, p); }
    for (const lb of lobes) {
      if (xy[0] < lb.box[0] || xy[0] > lb.box[2] || xy[1] < lb.box[1] || xy[1] > lb.box[3]) continue;
      const h = lb.p.invert(xy);
      if (!h || !isFinite(h[0]) || (h[1] >= 0) !== lb.north) continue;
      const l = wrap(h[0] + L.rotate[0]);
      if (l >= lb.west && l < lb.east && hits(h, xy)) return h;
    }
    return g;
  };
  return p;
}

function lobeProjections(L, cut, p) {
  return L.lobes.flatMap((hemi, k) => hemi.map(([a, c, b]) => {
    const north = k === 0, cc = c[0] * cut, sign = north ? 1 : -1;
    const one = interruptedAt(L.raw, [[[[-180, 0], [cc, 90], [180, 0]]], [[[-180, 0], [cc, -90], [180, 0]]]], 1, { rotate: L.rotate });
    one.scale(p.scale()).translate(p.translate());
    const at = [wrap((a[0] + b[0]) / 2 - L.rotate[0]), 20 * sign], d = p(at), e = one(at), [tx, ty] = one.translate();
    one.translate([tx + d[0] - e[0], ty + d[1] - e[1]]);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const lon of [a[0] + 1e-6, c[0], b[0] - 1e-6]) for (let k = 0; k <= 6; k++) {
      const q = p([wrap(lon - L.rotate[0]), sign * Math.min(k * 15, 89.999)]);
      box[0] = Math.min(box[0], q[0] - 1); box[1] = Math.min(box[1], q[1] - 1); box[2] = Math.max(box[2], q[0] + 1); box[3] = Math.max(box[3], q[1] + 1);
    }
    return { p: one, west: a[0], east: b[0], north, box };
  }));
}

export function lobeAt(layoutId, lon, lat) {
  const L = LAYOUTS[layoutId];
  if (!L.lobes) return null;
  const l = ((lon + L.rotate[0] + 540) % 360) - 180;
  const hemi = lat >= 0 ? L.lobes[0] : L.lobes[1];
  for (const [a, c, b] of hemi) if (l >= a[0] && l < b[0]) return { west: a[0] - L.rotate[0], centre: c[0] - L.rotate[0], east: b[0] - L.rotate[0], north: lat >= 0 };
  return null;
}

export function maxOmega(projection, land) {
  let m = 0;
  for (const [lon, lat] of land) {
    let w = Infinity;
    for (const d of [0, 0.07, -0.07]) {
      const f = factors(projection, lon + d, lat + d);
      if (f && isFinite(f.omega)) w = Math.min(w, f.omega);
    }
    if (w < Infinity && w > m) m = w;
  }
  return m;
}

const wrap = (v) => ((v + 540) % 360) - 180;

export async function mount(ctx) {
  const map = ctx.stage.map;
  const globe = ctx.stage.globe;
  const palette = ctx.palette;
  const brass = palette.ui.brass, signal = palette.ui.signal;
  const landFc = ctx.data.get("land-110m.json") || (await ctx.data.load("land-110m.json"));
  const land = landPoints(landFc, 4);
  let params = { ...ctx.params };
  let cut = 1 - (params.m ?? 0);
  let hover = null;
  let omegaTimer = 0;

  const layout = () => LAYOUTS[params.layout] || LAYOUTS.goodeLand;

  const apply = () => {
    const p = projectionAt(params.layout, cut, { extent: map.extent() });
    const done = map.setProjection(p, { duration: 0, opts: { fit: false }, tag: params.layout + ":" + cut.toFixed(4) });
    map.projectionId = "interrupted:" + params.layout;
    return done;
  };

  const readouts = () => {
    const l = layout();
    ctx.readout.setMany({
      lobes: l.count,
      cutLat: l.kink ? `${GOODE_KINK.toFixed(4)}° (rule changes)` : l.net ? "face edges" : "equator",
      lobeArea: SPHERE_MKM2 / l.count,
    });
    clearTimeout(omegaTimer);
    omegaTimer = setTimeout(() => { if (map) ctx.readout.set("maxOmega", maxOmega(map.projection, land)); }, 60);
  };

  const lobeShape = (lb) => {
    const ring = [];
    const pole = lb.north ? 90 : -90;
    for (let lat = 0; Math.abs(lat) <= 90; lat += lb.north ? 2 : -2) ring.push([lb.west + 1e-6, lat]);
    for (let lat = pole; Math.abs(lat) >= 0 && (lb.north ? lat >= 0 : lat <= 0); lat += lb.north ? -2 : 2) ring.push([lb.east - 1e-6, lat]);
    ring.push(ring[0]);
    return { type: "Polygon", coordinates: [lb.north ? ring.reverse() : ring] };
  };

  const meridianLines = (g, path) => {
    const l = layout();
    if (!l.lobes) return;
    g.setLineDash([5, 4]);
    g.strokeStyle = signal; g.lineWidth = 1.2; g.globalAlpha = 0.85;
    for (const [hemi, sign] of [[l.lobes[0], 1], [l.lobes[1], -1]]) for (const [, c] of hemi) {
      const lon = wrap(c[0] - l.rotate[0]);
      g.beginPath();
      path({ type: "LineString", coordinates: Array.from({ length: 46 }, (_, i) => [lon, sign * i * 2]) });
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
  };

  const layer = (g, path, projection) => {
    if (hover && layout().lobes) {
      g.beginPath(); path(lobeShape(hover));
      g.fillStyle = "rgba(184,82,23,.18)"; g.fill();
      g.strokeStyle = brass; g.lineWidth = 1.6; g.stroke();
    }
    meridianLines(g, path);
    if (layout().kink) {
      g.strokeStyle = "rgba(184,82,23,.7)"; g.lineWidth = 1; g.setLineDash([2, 3]);
      for (const lat of [GOODE_KINK, -GOODE_KINK]) { g.beginPath(); path({ type: "LineString", coordinates: Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]) }); g.stroke(); }
      g.setLineDash([]);
    }
    if (params.tissot) drawIndicatrices(g, projection, { points: indicatrixGrid(30, 60), radius: 4, color: signal });
  };

  const caption = () => {
    const l = layout();
    const pct = Math.round(cut * 100);
    return [`${l.label}: ${l.count} lobes`, pct >= 100 ? "Fully cut. Each lobe has its own central meridian." : pct <= 0 ? "Not cut. One central meridian for the whole map." : `${pct}% cut. The lobes slide toward their own meridians.`];
  };

  const morph3d = () => {
    if (!globe) return;
    const l = layout();
    if (params.layout === "icosahedral") {
      globe.morph(morphs.toPolyhedron("icosahedron"), cut);
      if (ctx.side === "A") {
        const f = globe.camera.fit(null, { padding: 24, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
        globe.camera.setDist(f.dist);
        globe.camera.setPan(f.pan[0] * smoothstep(0, 0.15, cut), f.pan[1] * smoothstep(0, 0.15, cut));
      }
    } else if (globe.morphFn) globe.morph(null, 0);
    const segs = [], mer = [];
    if (l.lobes) {
      for (const [hemi, sign] of [[l.lobes[0], 1], [l.lobes[1], -1]]) for (const [a, c] of hemi) {
        const lon = wrap(a[0] - l.rotate[0]), cl = wrap(c[0] - l.rotate[0]);
        for (let i = 0; i < 45; i++) { segs.push([[lon, sign * i * 2], [lon, sign * (i + 1) * 2]]); mer.push([[cl, sign * i * 2], [cl, sign * (i + 1) * 2]]); }
      }
      globe.addLines(PREFIX + "cuts", segs, { color: brass, width: 2, depth: true });
      globe.addLines(PREFIX + "centres", mer, { color: signal, width: 1.2, depth: true, dash: [5, 4] });
    } else { globe.remove(PREFIX + "cuts"); globe.remove(PREFIX + "centres"); }
  };

  if (map) {
    map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom });
    await apply();
    map.addLayer(PREFIX + "lobes", layer, { order: 50 });
    map.addLayer(PREFIX + "caption", (g) => drawCaption(g, 20, 16, caption(), { accent: brass }), { order: 90, clip: false });
    const off = map.on("hover", (h) => {
      const lb = h ? lobeAt(params.layout, h.lon, h.lat) : null;
      const same = lb && hover && lb.centre === hover.centre && lb.north === hover.north;
      if (!same && (lb || hover)) { hover = lb; map.invalidate(); }
    });
    ctx.signal.addEventListener("abort", off);
  } else morph3d();
  readouts();

  if (ctx.transport) ctx.transport.onScrub((v) => {
    cut = 1 - v;
    if (map) { if (v <= 0 || v >= 1) map.interacting = false; else if (layout().lobes || layout().facets) map.touch(250); else map.interacting = true; apply(); }
    morph3d();
    readouts();
  });

  return {
    update(p, keys) {
      params = { ...p };
      cut = 1 - (params.m ?? 0);
      if (keys.includes("layout")) { hover = null; if (map) apply(); morph3d(); }
      if (map) map.invalidate();
      readouts();
    },
    hover(lon, lat) {
      const lb = lobeAt(params.layout, lon, lat);
      const f = map ? factors(map.projection, lon, lat) : null;
      const lines = [];
      if (lb) lines.push(`lobe centre ${ctx.fmt.lon(wrap(lb.centre))}, ${lb.north ? "north" : "south"}`);
      if (f) lines.push(`ω = ${f.omega.toFixed(1)}°   area = ${f.areaScale.toFixed(3)}`);
      return lines;
    },
    probe() { return null; },
    unprobe() {},
    resize() { if (map) { map.setInsets({ top: INSET_TOP, bottom: ctx.stage.insetBottom }); apply(); } else morph3d(); },
    unmount() {
      clearTimeout(omegaTimer);
      if (map) { map.interacting = false; map.removePrefix(PREFIX); map.setInsets({ top: 0, bottom: 0 }); }
      if (globe) { globe.removePrefix(PREFIX); globe.morph(null, 0); }
    },
  };
}
