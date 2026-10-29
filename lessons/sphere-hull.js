import { convexHullFaces, sphereVoronoi, xyzToLonLat as toLL, lonLatToXYZ as toXYZ } from "@/core/globe.js";
import { clamp, smoothstep, vec3 } from "@/core/math.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const VIOLET = "#7046a6";
const INK = "#1a1917";
const FACE = "#c9d6e4";

export const meta = {
  id: "sphere-hull",
  title: "Hull, Delaunay, Voronoi",
  track: 4,
  order: 3,
  mode: "3d",
  renderer: "webgl",
  labels: false,
  paragraph: "Stretch a skin around points on a sphere. It pulls tight into flat triangles: the convex hull. Push each triangle out onto the sphere and you have the Delaunay triangulation. The cells around each point, closest to it, are the Voronoi cells. Every circle through a triangle's corners is empty.",
  deeper: [
    "A closed triangle solid with n corners has 2n − 4 faces.",
    "The hull of points on a sphere uses every point.",
    "d3.geoVoronoi gives these cells on the sphere.",
    "Spherical Voronoi cells are bounded by great-circle arcs.",
  ],
  keywords: ["convex hull", "Delaunay", "Voronoi", "empty circle", "sphere"],
  controls: [
    { key: "n", type: "range", label: "Points", min: 4, max: 400, step: 1, default: 60, ticks: [4, 100, 200, 300, 400] },
    { type: "legend", label: "Show", items: [{ color: FACE, label: "Hull faces" }, { color: BRASS, line: true, label: "Delaunay edges" }, { color: VIOLET, line: true, label: "Voronoi cells" }, { color: SIGNAL, dash: true, label: "Empty circle of one face" }] },
    { key: "hull", type: "toggle", label: "Hull", default: true },
    { key: "delaunay", type: "toggle", label: "Delaunay", default: true },
    { key: "voronoi", type: "toggle", label: "Voronoi", default: false, shortcut: "v" },
    { key: "circles", type: "toggle", label: "Circles", default: false, shortcut: "c" },
    { key: "new", type: "button", label: "New points", icon: "i-refresh" },
    { key: "seed", type: "number", label: "Seed", min: 1, max: 9999, step: 1, default: 7 },
  ],
  readouts: [
    { key: "points", label: "Points n", digits: 0 },
    { key: "faces", label: "Faces (2n − 4)", digits: 0, hero: true },
    { key: "edges", label: "Edges (3n − 6)", digits: 0 },
    { key: "cells", label: "Voronoi cells", digits: 0 },
  ],
  transport: { label: ["hull", "sphere"], key: "m", default: 1 },
  compare: null,
  view: { lon: 20, lat: 25, dist: 2.9 },
  data: [],
};

const PREFIX = meta.id + ":";
const LIFT = 1.004;

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomPoints(n, seed) {
  const r = rng(seed * 7919 + 13);
  const out = [];
  for (let i = 0; i < n; i++) {
    const z = 2 * r() - 1, a = 2 * Math.PI * r(), q = Math.sqrt(1 - z * z);
    out.push([q * Math.sin(a), z, q * Math.cos(a)]);
  }
  return out;
}

export function hullOf(xyz) {
  const faces = convexHullFaces(xyz).map(([a, b, c]) => {
    const A = xyz[a], B = xyz[b], C = xyz[c];
    let nrm = vec3.normalize(vec3.cross(vec3.sub(B, A), vec3.sub(C, A)));
    let tri = [a, b, c];
    if (vec3.dot(nrm, A) < 0) { nrm = vec3.scale(nrm, -1); tri = [a, c, b]; }
    return { v: tri, n: nrm, d: vec3.dot(nrm, A) };
  });
  const edgeSet = new Set();
  for (const f of faces) for (let k = 0; k < 3; k++) {
    const i = f.v[k], j = f.v[(k + 1) % 3];
    edgeSet.add(i < j ? i + "," + j : j + "," + i);
  }
  const edges = [...edgeSet].map((s) => s.split(",").map(Number));
  return { faces, edges };
}

export function cellsOf(xyz) {
  return sphereVoronoi(xyz.map((p) => toLL(p[0], p[1], p[2])));
}

export function circumcap(face) {
  return { centre: toLL(face.n[0], face.n[1], face.n[2]), radius: Math.acos(clamp(face.d, -1, 1)) * 180 / Math.PI };
}

export function inflate(p, t) {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const k = 1 + (1 / l - 1) * t;
  return [p[0] * k, p[1] * k, p[2] * k];
}

export function faceAt(hull, dir) {
  for (let i = 0; i < hull.faces.length; i++) {
    const [a, b, c] = hull.faces[i].v.map((k) => hull.xyz[k]);
    if (vec3.dot(vec3.cross(a, b), dir) >= -1e-12 && vec3.dot(vec3.cross(b, c), dir) >= -1e-12 && vec3.dot(vec3.cross(c, a), dir) >= -1e-12) return i;
  }
  return -1;
}

function levelFor(n) {
  return n <= 40 ? 8 : n <= 120 ? 6 : n <= 260 ? 4 : 3;
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 1;
  let xyz = [];
  let H = null, V = null;
  let selected = -1;
  let dragging = null;
  let fadeTw = null, vorTw = null;
  let ptsAlpha = 1, vorDrawn = 1;
  let booted = false;
  let builtKey = "";

  globe.setLayer("surface", false);
  globe.setLayer("coast", false);
  globe.setGraticule({ minor: false, tropics: false });

  const regen = () => {
    xyz = randomPoints(params.n, params.seed);
    selected = -1;
  };

  const solve = () => {
    H = hullOf(xyz);
    H.xyz = xyz;
    V = cellsOf(xyz);
    if (selected >= H.faces.length) selected = -1;
  };

  const ease = (v) => clamp(v, 0, 1);

  const buildFaces = () => {
    if (!params.hull) { globe.remove(PREFIX + "faces"); return; }
    const L = levelFor(params.n);
    const u = ease(t);
    const pos = [], nor = [];
    for (const f of H.faces) {
      const [A, B, C] = f.v.map((k) => xyz[k]);
      const at = (i, j) => { const k = L - i - j; return [(A[0] * i + B[0] * j + C[0] * k) / L, (A[1] * i + B[1] * j + C[1] * k) / L, (A[2] * i + B[2] * j + C[2] * k) / L]; };
      const push = (p) => {
        const q = inflate(p, u);
        pos.push(q[0], q[1], q[2]);
        const s = vec3.normalize(p);
        const nn = vec3.normalize([f.n[0] * (1 - u) + s[0] * u, f.n[1] * (1 - u) + s[1] * u, f.n[2] * (1 - u) + s[2] * u]);
        nor.push(nn[0], nn[1], nn[2]);
      };
      for (let i = 0; i < L; i++) for (let j = 0; j < L - i; j++) {
        push(at(i, j)); push(at(i + 1, j)); push(at(i, j + 1));
        if (i + j < L - 1) { push(at(i + 1, j)); push(at(i + 1, j + 1)); push(at(i, j + 1)); }
      }
    }
    const P = Float32Array.from(pos), N = Float32Array.from(nor);
    if (!globe.setTriangles(PREFIX + "faces", P, { normals: N })) globe.addTriangles(PREFIX + "faces", P, { color: FACE, flat: false, normals: N, order: 1 });
  };

  const arc = (a, b, steps, u, lift) => {
    const segs = [];
    let prev = null;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const p = inflate([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], u);
      const q = [p[0] * lift, p[1] * lift, p[2] * lift];
      if (prev) segs.push([prev, q]);
      prev = q;
    }
    return segs;
  };

  const buildEdges = () => {
    if (!params.delaunay) { globe.remove(PREFIX + "edges"); return; }
    const u = ease(t);
    const steps = params.n > 200 ? 6 : 10;
    const segs = [];
    for (const [i, j] of H.edges) segs.push(...arc(xyz[i], xyz[j], steps, u, 1.003));
    if (!globe.setSegments3D(PREFIX + "edges", segs)) globe.addSegments3D(PREFIX + "edges", segs, { color: BRASS, width: params.n > 200 ? 1.2 : 1.6, depth: true, order: 3 });
  };

  const buildVoronoi = () => {
    if (!params.voronoi) { globe.remove(PREFIX + "vor"); globe.remove(PREFIX + "vorpts"); return; }
    const segs = [];
    const seen = new Set();
    for (const f of V.polygons.features) {
      const ring = f.geometry.coordinates[0];
      for (let k = 1; k < ring.length; k++) {
        const a = ring[k - 1], b = ring[k];
        const key = [a, b].map((q) => q[0].toFixed(6) + "," + q[1].toFixed(6)).sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const A = toXYZ(a[0], a[1]), B = toXYZ(b[0], b[1]);
        const w = vorDrawn;
        const E = [A[0] + (B[0] - A[0]) * w, A[1] + (B[1] - A[1]) * w, A[2] + (B[2] - A[2]) * w];
        segs.push(...arc(A, E, 8, 1, LIFT + 0.002));
      }
    }
    const opacity = 0.35 + 0.65 * smoothstep(0.4, 1, t);
    globe.addSegments3D(PREFIX + "vor", segs, { color: VIOLET, width: 1.6, depth: true, opacity, order: 4 });
    globe.addPoints3D(PREFIX + "vorpts", H.faces.map((f) => vec3.scale(f.n, LIFT + 0.002)), { color: VIOLET, size: params.n > 200 ? 3 : 4.5, order: 4 });
  };

  const buildPoints = () => {
    const pts = globe.addPoints3D(PREFIX + "pts", xyz.map((p) => vec3.scale(p, LIFT)), { color: SIGNAL, size: params.n > 200 ? 5 : 8, order: 5 });
    if (pts) { pts.material.opacity = ptsAlpha; pts.material.transparent = true; }
  };

  const buildCircle = () => {
    const ids = [PREFIX + "circle", PREFIX + "cap", PREFIX + "selface", PREFIX + "corners"];
    if (!params.circles || selected < 0) { for (const id of ids) globe.remove(id); ctx.overlay.remove(PREFIX + "cap"); return; }
    const f = H.faces[selected];
    const c = f.n, r = Math.acos(clamp(f.d, -1, 1));
    const e1 = vec3.normalize(vec3.cross(Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], c)), e2 = vec3.cross(c, e1);
    const ring = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      const p = vec3.add(vec3.scale(c, Math.cos(r)), vec3.add(vec3.scale(e1, Math.sin(r) * Math.cos(a)), vec3.scale(e2, Math.sin(r) * Math.sin(a))));
      ring.push(p);
    }
    const segs = [];
    for (let k = 1; k < ring.length; k++) segs.push([vec3.scale(ring[k - 1], 1.005), vec3.scale(ring[k], 1.005)]);
    globe.addSegments3D(PREFIX + "circle", segs, { color: SIGNAL, width: 2.2, depth: true, dash: [6, 4], order: 6 });
    const fan = [];
    const at = (rr, a) => vec3.scale(vec3.add(vec3.scale(c, Math.cos(rr)), vec3.add(vec3.scale(e1, Math.sin(rr) * Math.cos(a)), vec3.scale(e2, Math.sin(rr) * Math.sin(a)))), 1.0035);
    const RINGS = 10, SEG = 72;
    for (let i = 0; i < RINGS; i++) for (let k = 0; k < SEG; k++) {
      const r0 = (r * i) / RINGS, r1 = (r * (i + 1)) / RINGS, a0 = (k / SEG) * Math.PI * 2, a1 = ((k + 1) / SEG) * Math.PI * 2;
      const p00 = at(r0, a0), p01 = at(r0, a1), p10 = at(r1, a0), p11 = at(r1, a1);
      fan.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
    globe.addTriangles(PREFIX + "cap", Float32Array.from(fan), { color: "rgba(29,99,168,.2)", lit: false, depthWrite: false, order: 2.5 });
    const [A, B, C] = f.v.map((k) => xyz[k]);
    const u = ease(t);
    globe.addSegments3D(PREFIX + "selface", [...arc(A, B, 12, u, 1.004), ...arc(B, C, 12, u, 1.004), ...arc(C, A, 12, u, 1.004)], { color: INK, width: 2.6, depth: true, order: 6 });
    globe.addPoints3D(PREFIX + "corners", [A, B, C].map((p) => vec3.scale(p, LIFT + 0.001)), { color: INK, size: 11, order: 7 });
    const inside = xyz.filter((p, i) => !f.v.includes(i) && vec3.dot(p, c) > f.d + 1e-12).length;
    const ll = toLL(c[0], c[1], c[2]);
    ctx.overlay.label(PREFIX + "cap", { lon: ll[0], lat: ll[1] }, inside === 0 ? "empty circle: 0 points inside" : `${inside} points inside`, { color: SIGNAL, leader: true, dx: 40, dy: -64, mono: true });
  };

  const readouts = () => {
    ctx.readout.setMany({ points: xyz.length, faces: H.faces.length, edges: H.edges.length, cells: V.polygons.features.length });
  };

  const defaultFace = () => {
    const st = globe.camera.state();
    const dir = toXYZ(st.lon, st.lat);
    let best = 0, bd = -2;
    H.faces.forEach((f, i) => { const d = vec3.dot(f.n, dir); if (d > bd) { bd = d; best = i; } });
    return best;
  };

  const rebuildMorph = () => { buildFaces(); buildEdges(); buildCircle(); if (params.voronoi) buildVoronoi(); ctx.overlay.update(); };
  const rebuildAll = () => { solve(); if (params.circles && selected < 0) selected = defaultFace(); buildFaces(); buildEdges(); buildVoronoi(); buildPoints(); buildCircle(); readouts(); ctx.overlay.update(); };

  const fadeIn = () => {
    if (fadeTw) fadeTw.cancel();
    if (ctx.reducedMotion || !booted) { ptsAlpha = 1; return; }
    ptsAlpha = 0;
    const pts = () => globe.extra && globe.extra.get(PREFIX + "pts");
    fadeTw = ctx.anim.tween({ from: 0, to: 1, duration: 420, ease: ctx.anim.ease.out, onUpdate: (v) => { ptsAlpha = v; const p = pts(); if (p) { p.material.opacity = v; globe.invalidate(); } }, onDone: () => { fadeTw = null; } });
  };

  const drawOnVoronoi = () => {
    if (vorTw) vorTw.cancel();
    if (ctx.reducedMotion || !booted) { vorDrawn = 1; buildVoronoi(); return; }
    vorTw = ctx.anim.tween({ from: 0.02, to: 1, duration: 520, ease: ctx.anim.ease.out, onUpdate: (v) => { vorDrawn = v; buildVoronoi(); }, onDone: () => { vorTw = null; } });
  };

  const frame = (duration) => {
    if (ctx.side !== "A") return;
    const shell = [];
    for (let i = 0; i < 200; i++) { const y = 1 - (2 * (i + 0.5)) / 200, r = Math.sqrt(1 - y * y), g = i * 2.39996; shell.push([Math.cos(g) * r * 1.05, y * 1.05, Math.sin(g) * r * 1.05]); }
    const f = globe.camera.fit(shell, { padding: 20, insetBottom: ctx.stage.insetBottom, minDist: meta.view.dist, apply: false });
    globe.camera.glideTo(f, { duration });
  };

  const stagePos = (e) => { const r = ctx.stage.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pointAt = (x, y) => {
    let best = -1, bd = 11;
    xyz.forEach((p, i) => {
      const ll = toLL(p[0], p[1], p[2]);
      const s = globe.project(ll[0], ll[1]);
      if (!s.visible) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const el = ctx.stage.el;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || ctx.side !== "A") return;
    const [x, y] = stagePos(e);
    const i = pointAt(x, y);
    if (i < 0) return;
    e.stopPropagation(); e.preventDefault();
    dragging = { id: e.pointerId, i };
    ctx.overlay.hideChip();
    globe.canvas.style.cursor = "grabbing";
  }, { capture: true, signal: ctx.signal });
  el.addEventListener("pointermove", (e) => {
    const [x, y] = stagePos(e);
    if (!dragging) { if (pointAt(x, y) >= 0) globe.canvas.style.cursor = "grab"; return; }
    if (e.pointerId !== dragging.id) return;
    e.stopPropagation();
    const p = globe.pick(x, y);
    if (!p) return;
    xyz[dragging.i] = toXYZ(p.lon, p.lat);
    rebuildAll();
  }, { capture: true, signal: ctx.signal });
  const end = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    e.stopPropagation();
    dragging = null;
    globe.canvas.style.cursor = "grab";
  };
  el.addEventListener("pointerup", end, { capture: true, signal: ctx.signal });
  el.addEventListener("pointercancel", end, { capture: true, signal: ctx.signal });

  if (ctx.transport) {
    ctx.transport.onScrub((v) => { t = v; rebuildMorph(); });
  }

  regen();
  rebuildAll();
  frame(0);
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      const prev = params;
      params = { ...p };
      if (keys.includes("m")) t = params.m ?? t;
      if (keys.includes("new")) {
        ctx.controls.set("seed", 1 + Math.floor(Math.random() * 9999));
        return;
      }
      const key = params.n + "|" + params.seed;
      if (key !== builtKey) {
        builtKey = key;
        regen();
        rebuildAll();
        if (prev.n !== params.n || prev.seed !== params.seed) fadeIn();
      } else {
        if (keys.includes("hull")) buildFaces();
        if (keys.includes("delaunay")) buildEdges();
        if (keys.includes("voronoi")) { if (params.voronoi) drawOnVoronoi(); else buildVoronoi(); }
        if (keys.includes("circles")) { if (params.circles && selected < 0) selected = defaultFace(); buildCircle(); }
      }
      readouts();
    },
    hover(lon, lat) {
      const i = faceAt(H, toXYZ(lon, lat));
      if (i < 0) return [];
      const cap = circumcap(H.faces[i]);
      return [`face ${i + 1} of ${H.faces.length}`, `circle radius ${cap.radius.toFixed(1)}°`];
    },
    probe(lon, lat) {
      const i = faceAt(H, toXYZ(lon, lat));
      if (i < 0) return null;
      selected = i;
      if (!params.circles) ctx.controls.set("circles", true);
      else buildCircle();
      return null;
    },
    unprobe() {},
    resize() { frame(0); },
    unmount() {
      if (fadeTw) fadeTw.cancel();
      if (vorTw) vorTw.cancel();
      globe.removePrefix(PREFIX);
      globe.setLayer("surface", true);
      globe.setLayer("coast", true);
      globe.setGraticule({ minor: true, tropics: true });
      ctx.overlay.clear(PREFIX);
    },
  };
}
