import { make, interpolate, unrotatedLonLat, pathFor } from "@/core/projections.js";

const VIEWS = [
  { value: "ocean", label: "Ocean square" },
  { value: "peirce", label: "Peirce square" },
];
const ORANGE = "#b85217";
const DIM = "rgba(250,248,243,.45)";
const LAND = "#ebe5d5";
const PAPER = "#f1ede4";
const D2R = Math.PI / 180;

export const EDGE_ON_LAND = { ocean: 88, peirce: 11 };
export const CENTRE_NAME = { ocean: "Indian Ocean", peirce: "North Pole" };
export const EDGE_LABEL = "Map edge = cut line";
export const SINGULAR_NEAR = 4;

export const meta = {
  id: "world-in-a-square",
  title: "A world map in a square",
  track: 2,
  order: 8,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "equirectangular",
  labels: false,
  paragraph: "A flat map must cut the globe somewhere. This square map keeps angles and cuts mostly through land, so the oceans stay in one piece. But every flat map changes shape or size. Next, you measure how much.",
  deeper: [
    "Athelstan Spilhaus drew ocean-first world maps from 1942. This one is the Adams World in a Square II (1925), turned to centre on 49.56°S 66.95°E.",
    "Angles are not kept at the corners. Two corners are one point in Canada. The other two are in China and Argentina.",
    "Peirce (1879) puts the North Pole in the centre and the South Pole in all four corners. Angles are not kept at the middle of each edge, on the equator.",
    "Elliptic integrals, not trigonometry, build these maps.",
  ],
  keywords: ["Adams", "Spilhaus", "Peirce", "square", "conformal", "ocean"],
  controls: [
    { key: "view", type: "segment", label: "Map", options: VIEWS, default: "ocean" },
  ],
  readouts: [
    { key: "edge", label: "Map edge on land", digits: 0, unit: "%", hero: true },
  ],
  transport: { label: ["globe", "square"], key: "m", default: 1 },
  compare: { key: "view", value: "peirce", sync: false },
  view: { lon: 66.95, lat: -49.56, dist: 2.9 },
  data: ["land-110m.json"],
};

const PREFIX = meta.id + ":";
const PAD = 28;
const EDGE_EPS = 1e-3;

export function squareProjection(view) {
  return view === "peirce" ? make("peirce") : make("oceanSquare");
}

export function fitted(p, box) {
  p.fitExtent(box, { type: "Sphere" });
  return p;
}

export function projectionAt(view, t, box) {
  const sq = fitted(squareProjection(view), box);
  if (t >= 1) return sq;
  const r = sq.rotate(), angle = sq.angle();
  const unit = [[0, 0], [1000, 1000]];
  const start = fitted(make("equirectangular", { rotate: [0, 0, 0] }), unit);
  const diamond = fitted(squareProjection(view).rotate([0, 0, 0]).angle(0), unit);
  const e = t * t * (3 - 2 * t);
  const p = t <= 0 ? make("equirectangular", { rotate: r }) : interpolate(start, diamond, t).rotate(r);
  p.angle(angle * e);
  return fitted(p, box);
}

export function outlineLonLat(rotation, steps = 180) {
  const e = 1e-3, pts = [];
  for (let i = 0; i <= steps; i++) pts.push(unrotatedLonLat(rotation, 180 - e, -90 + e + (180 - 2 * e) * i / steps));
  for (let i = 0; i <= steps; i++) pts.push(unrotatedLonLat(rotation, 180 - e - (360 - 2 * e) * i / steps, 90 - e));
  for (let i = 0; i <= steps; i++) pts.push(unrotatedLonLat(rotation, -180 + e, 90 - e - (180 - 2 * e) * i / steps));
  for (let i = 0; i <= steps; i++) pts.push(unrotatedLonLat(rotation, -180 + e + (360 - 2 * e) * i / steps, -90 + e));
  return pts;
}

export function outlineRing(projection, ring = outlineLonLat(projection.rotate())) {
  const out = [];
  for (const ll of ring) {
    const q = projection(ll);
    if (q && isFinite(q[0]) && isFinite(q[1])) out.push(q);
  }
  return out;
}

export const UNFOLD_SPLIT = 0.55;

const xyz = (lon, lat) => {
  const lo = lon * D2R, la = lat * D2R, c = Math.cos(la);
  return [c * Math.sin(lo), Math.sin(la), c * Math.cos(lo)];
};

export function squareMorph(view, width = 2.4) {
  const sq = squareProjection(view);
  const r = sq.rotate();
  const flat = squareProjection(view).rotate([0, 0, 0]).angle(0).scale(1).translate([0, 0]);
  const b = pathFor(flat).bounds({ type: "Sphere" });
  const S = width / Math.sqrt(pathFor(flat).area({ type: "Sphere" }));
  const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  const C = xyz(...unrotatedLonLat(r, 0, 0)), E = xyz(...unrotatedLonLat(r, 90, 0)), N = xyz(...unrotatedLonLat(r, 0, 90));
  const h = 1e-4, q0 = flat([0, 0]), q1 = flat([h, 0]);
  const k0 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) * S / (h * D2R);
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const byLonLat = new Map(), byRotated = new Map();
  const entry = (pe, pn, pc, lr, br) => {
    let ex = pe, ey = pn;
    const dl = Math.hypot(ex, ey);
    if (dl < 1e-12) { ex = 1; ey = 0; } else { ex /= dl; ey /= dl; }
    return [Math.acos(Math.max(-1, Math.min(1, pc))), ex, ey, NaN, NaN, lr, br];
  };
  const put = (x, y, z, out) => {
    out[0] = x * E[0] + y * N[0] + z * C[0]; out[1] = x * E[1] + y * N[1] + z * C[1]; out[2] = x * E[2] + y * N[2] + z * C[2];
    return out;
  };
  let phaseT = NaN, kPow = 1, bendR = Infinity, mix = 0;
  const phase = (t) => {
    phaseT = t;
    if (t <= UNFOLD_SPLIT) { const u = smooth(t / UNFOLD_SPLIT); kPow = k0 ** u; bendR = 1 - u < 1e-6 ? Infinity : 1 / (1 - u); }
    else mix = smooth((t - UNFOLD_SPLIT) / (1 - UNFOLD_SPLIT));
  };
  const place = (e, t, out) => {
    if (t !== phaseT) phase(t);
    const cc = e[0], ex = e[1], ey = e[2];
    if (t <= UNFOLD_SPLIT) {
      const s0 = cc * kPow;
      if (bendR === Infinity) return put(s0 * ex, s0 * ey, 1, out);
      const rad = bendR * Math.sin(s0 / bendR), z = 1 - bendR * (1 - Math.cos(s0 / bendR));
      return put(rad * ex, rad * ey, z, out);
    }
    if (e[3] !== e[3]) {
      const q = flat([e[5], e[6]]);
      e[3] = (q[0] - cx) * S; e[4] = -(q[1] - cy) * S;
    }
    const ax = cc * k0 * ex, ay = cc * k0 * ey;
    return put(ax + (e[3] - ax) * mix, ay + (e[4] - ay) * mix, 1, out);
  };
  const rotated = (lr, br, t, out = [0, 0, 0]) => {
    const key = lr * 1e6 + br;
    let e = byRotated.get(key);
    if (e === undefined) {
      const l = lr * D2R, p = br * D2R, cp = Math.cos(p);
      e = entry(cp * Math.sin(l), Math.sin(p), cp * Math.cos(l), lr, br);
      byRotated.set(key, e);
    }
    return place(e, t, out);
  };
  const fn = (lon, lat, t, out = [0, 0, 0]) => {
    const key = lon * 1e6 + lat;
    let e = byLonLat.get(key);
    if (e === undefined) {
      const lo = lon * D2R, la = lat * D2R, c = Math.cos(la);
      const x = c * Math.sin(lo), y = Math.sin(la), z = c * Math.cos(lo);
      const pe = x * E[0] + y * E[1] + z * E[2], pn = x * N[0] + y * N[1] + z * N[2], pc = x * C[0] + y * C[1] + z * C[2];
      e = entry(pe, pn, pc, Math.atan2(pe, pc) / D2R, Math.asin(Math.max(-1, Math.min(1, pn))) / D2R);
      byLonLat.set(key, e);
    }
    return place(e, t, out);
  };
  const ups = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b2]) => [0, 1, 2].map((i) => (a * N[i] + b2 * E[i]) / Math.SQRT2));
  fn.up = ups.reduce((best, u) => (u[1] > best[1] ? u : best));
  fn.centre = C;
  fn.phased = true; fn.seam = 180; fn.gridRotation = r.slice(); fn.rotated = rotated;
  fn.meshTear = view === "peirce" ? 8 : Infinity;
  return fn;
}

const unitSquare = (view) => fitted(squareProjection(view), [[0, 0], [1, 1]]);

export function corners(view) {
  const p = unitSquare(view), e = 1e-4;
  return [[e, e], [1 - e, e], [1 - e, 1 - e], [e, 1 - e]].map((xy) => p.invert(xy));
}

export function edgeMiddles(view) {
  const p = unitSquare(view), e = 1e-4;
  return [[0.5, e], [1 - e, 0.5], [0.5, 1 - e], [e, 0.5]].map((xy) => p.invert(xy));
}

export function centreOf(view) {
  return unitSquare(view).invert([0.5, 0.5]);
}

export function angularDistance(a, b) {
  const s = Math.sin((b[1] - a[1]) * D2R / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin((b[0] - a[0]) * D2R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) / D2R;
}

export function singularPoints(view) {
  const pts = view === "peirce" ? edgeMiddles(view) : corners(view);
  const out = [];
  for (const p of pts) if (!out.some((q) => angularDistance(p, q) < 0.01)) out.push(p);
  return out;
}

export function edgePoints(view, n = 200) {
  const p = unitSquare(view), e = EDGE_EPS, pts = [];
  for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
    const s = (i + 0.5) / n;
    const xy = side === 0 ? [s, e] : side === 1 ? [1 - e, s] : side === 2 ? [1 - s, 1 - e] : [e, 1 - s];
    pts.push(p.invert(xy));
  }
  return pts;
}

export function edgeOnLand(view, contains, n = 200) {
  const pts = edgePoints(view, n);
  return 100 * pts.filter((ll) => contains(ll)).length / pts.length;
}

export function edgeLabelAt(view) {
  return unitSquare(view).invert([0.03, 0.012]);
}

export function hoverLines(view, t, lon, lat) {
  if (t < 1) return [];
  const near = singularPoints(view).some((s) => angularDistance([lon, lat], s) < SINGULAR_NEAR);
  return [near ? "Angles not kept here" : "Angles kept"];
}

function cutSegments(view) {
  const p = unitSquare(view), e = EDGE_EPS, n = 120, segs = [];
  for (let side = 0; side < 4; side++) {
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = e + (1 - 2 * e) * i / n;
      const xy = side === 0 ? [s, e] : side === 1 ? [1 - e, s] : side === 2 ? [1 - s, 1 - e] : [e, 1 - s];
      const ll = p.invert(xy);
      if (prev && ll && isFinite(ll[0]) && angularDistance(prev, ll) < 10) segs.push([prev, ll]);
      prev = ll;
    }
  }
  return segs;
}

export async function mount(ctx) {
  const is3d = ctx.stage.mode !== "2d" && !!ctx.stage.globe;
  const map = is3d ? null : ctx.stage.map;
  const globe = is3d ? ctx.stage.globe : null;
  const colour = ctx.side === "B" ? ctx.palette.ui.violet : ORANGE;
  let params = { ...ctx.params };
  let t = params.m ?? 1;
  const land = ctx.data.get("land-110m.json") || (await ctx.data.load("land-110m.json"));
  const centreId = PREFIX + "centre" + ctx.side, edgeId = PREFIX + "edge" + ctx.side;

  const marks = () => {
    const c = centreOf(params.view), a = edgeLabelAt(params.view);
    ctx.overlay.pin(centreId, { lon: c[0], lat: c[1] }, { color: colour, size: 8, label: CENTRE_NAME[params.view], side: ctx.side });
    ctx.overlay.label(edgeId, { lon: a[0], lat: a[1] }, EDGE_LABEL, { color: colour, dx: 6, dy: 12, side: ctx.side });
    ctx.readout.set("edge", EDGE_ON_LAND[params.view]);
  };
  const clearMarks = () => { ctx.overlay.remove(centreId); ctx.overlay.remove(edgeId); };

  if (ctx.transport) ctx.transport.setLabels(is3d ? ["globe", "square"] : ["rectangle", "square"]);

  if (is3d) {
    let faced = false, booted = false;
    const bootTimer = setTimeout(() => { booted = true; }, 600);
    const apply3d = () => {
      globe.morph(squareMorph(params.view), t);
      globe.addLines(PREFIX + "cut", cutSegments(params.view), { color: colour, width: 2, depth: true });
    };
    const frame3d = () => {
      const f = globe.camera.fit(null, { padding: PAD, insetBottom: ctx.stage.insetBottom, minDist: 2.9, apply: false });
      globe.camera.setDist(f.dist);
      globe.camera.setPan(f.pan[0], f.pan[1]);
    };
    const face = () => {
      if (faced) return;
      faced = true;
      const fn = globe.morphFn;
      globe.camera.orient(fn.centre, fn.up, { duration: booted && !ctx.reducedMotion ? 500 : 0 });
    };
    globe.setLayer("graticule", false);
    globe.addPolygons(PREFIX + "dim", land, { fill: DIM });
    apply3d();
    face();
    frame3d();
    marks();
    if (ctx.transport) ctx.transport.onScrub((v) => { t = v; globe.setMorphT(t); frame3d(); });
    return {
      update(p, keys) {
        const viewChanged = p.view !== params.view;
        params = { ...p };
        t = params.m ?? t;
        if (viewChanged) { faced = false; apply3d(); face(); frame3d(); marks(); }
        ctx.overlay.update();
      },
      hover: (lon, lat) => hoverLines(params.view, t, lon, lat),
      probe: () => ({}),
      unprobe() {},
      resize() { frame3d(); },
      unmount() {
        clearTimeout(bootTimer);
        globe.removePrefix(PREFIX);
        globe.morph(null, 0);
        globe.setLayer("graticule", true);
        clearMarks();
      },
    };
  }

  let current = null;
  let ring = null;
  const box = () => {
    const W = ctx.stage.width, H = ctx.stage.height - ctx.stage.insetBottom;
    const s = Math.min(W, H) - 2 * PAD;
    return [[(W - s) / 2, (H - s) / 2], [(W + s) / 2, (H + s) / 2]];
  };
  const apply = () => {
    current = projectionAt(params.view, t, box());
    map.setProjection(current, { duration: 0, opts: { fit: false }, tag: [params.view, t.toFixed(4), ctx.stage.width, ctx.stage.height].join("|") });
  };
  const setView = () => { ring = outlineLonLat(squareProjection(params.view).rotate()); };

  let landKey = "", landPath = null;
  map.addLayer(PREFIX + "land", (g, path, projection) => {
    const key = map.stateKey();
    if (key !== landKey) { landKey = key; landPath = new Path2D(); pathFor(projection, landPath)(land); }
    g.fillStyle = LAND; g.fill(landPath);
  }, { order: 39 });

  map.addLayer(PREFIX + "frame", (g, path) => {
    if (!current) return;
    const W = ctx.stage.width + 20, H = ctx.stage.height + 20;
    g.lineWidth = 2; g.strokeStyle = colour;
    if (t >= 1) { g.beginPath(); path({ type: "Sphere" }); g.stroke(); return; }
    const pts = outlineRing(current, ring);
    const trace = () => pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
    g.fillStyle = PAPER;
    g.beginPath(); g.rect(-10, -10, W, H); trace(); g.closePath(); g.fill("evenodd");
    g.beginPath(); g.rect(-10, -10, W, H); path({ type: "Sphere" }); g.fill("evenodd");
    g.beginPath(); trace(); g.closePath(); g.stroke();
  }, { order: 90, clip: false });

  map.setLayer("graticule", false);
  map.rasterOn(false);
  setView();
  apply();
  marks();

  if (ctx.transport) ctx.transport.onScrub((v) => {
    t = v;
    if (v > 0 && v < 1) map.touch(200); else map.interacting = false;
    apply();
    ctx.overlay.update();
  });

  return {
    update(p, keys) {
      const viewChanged = p.view !== params.view;
      params = { ...p };
      t = params.m ?? t;
      if (viewChanged) { setView(); apply(); marks(); }
      map.invalidate();
      ctx.overlay.update();
    },
    hover: (lon, lat) => hoverLines(params.view, t, lon, lat),
    probe: () => ({}),
    unprobe() {},
    resize() { apply(); ctx.overlay.update(); },
    unmount() {
      map.interacting = false;
      map.setLayer("graticule", true);
      map.rasterOn(true);
      map.removePrefix(PREFIX);
      clearMarks();
    },
  };
}
