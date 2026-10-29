import { morphs } from "@/core/globe.js";
import { cellFromLatLng, cellFromFaceIJ, cellCenter, cellBoundary, cellArea, cellCount, averageArea, hilbertOrder, stToUV, uvToST, stToUVLinear, uvToSTLinear, uvToXYZ, faceUV, lonLatToXYZ, xyzToLonLat, token as tokenOf, parent as parentOf, children as childrenOf, FACE_CENTRES, MAX_LEVEL } from "@/core/s2.js";
import { DEG, clamp, smoothstep, sphericalPolygonArea } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const R_KM = 6371.0088;
const GLOBE_MAX = 8;
const HILBERT_MAX = 6;
const EPS = 1e-6;

export const meta = {
  id: "s2-cells",
  title: "A cube around the globe",
  track: 5,
  order: 4,
  mode: "3d",
  renderer: "webgl",
  paragraph: "Put a light at the centre and a cube around the globe. Each point lands on one of six faces. That is the gnomonic map six times. S2 stretches each face so cells are more equal, then cuts it into a grid. Each level splits a cell into four. A curve numbers them.",
  deeper: [
    "Level k has 6·4^k cells.",
    "Face centres: 0 at (0 N, 0 E), 2 at the north pole, 5 at the south pole.",
    "The id is 64 bits: 3 face bits, 2 bits per level, then a 1.",
    "Level 30 cells are under 1 cm².",
  ],
  keywords: ["S2", "cube", "Hilbert", "cell", "quadtree"],
  controls: [
    { key: "level", type: "range", label: "Level", min: 0, max: 30, step: 1, default: 2, ticks: [0, 8, 15, 30] },
    { key: "hilbert", type: "toggle", label: "Hilbert curve", default: true, shortcut: "h" },
    { key: "stretch", type: "toggle", label: "Stretch (S2)", default: true, shortcut: "s" },
    { key: "point", type: "point", label: "Place", default: [2.3522, 48.8566] },
    { key: "closeUp", type: "toggle", label: "Close-up, levels 9 to 30", default: false },
    { key: "parent", type: "button", label: "Parent", icon: "i-chevron-left" },
    { key: "child", type: "button", label: "Child", icon: "i-chevron-right" },
    { type: "legend", label: "Key", items: [
      { color: "rgba(26,25,23,.6)", line: true, label: "Cell edges at this level" },
      { color: BRASS, line: true, label: "Hilbert curve, in id order" },
      { color: SIGNAL, line: true, label: "The cell of the place" },
    ] },
  ],
  readouts: [
    { key: "face", label: "Face" },
    { key: "level", label: "Level" },
    { key: "token", label: "Cell token", hero: true },
    { key: "id", label: "Cell id" },
    { key: "area", label: "Cell area" },
    { key: "count", label: "Cells at this level" },
  ],
  transport: { label: ["sphere", "cube net"], key: "m" },
  compare: null,
  view: { lon: 20, lat: 28, dist: 3.2 },
  data: [],
};

const PREFIX = meta.id + ":";
const FIT_PADDING = 28;

const st = (stretch) => (stretch ? stToUV : stToUVLinear);
const ts = (stretch) => (stretch ? uvToST : uvToSTLinear);

export function faceOfPoint(lon, lat) {
  return faceUV(lonLatToXYZ(lon, lat)).face;
}

export function cellAt(lon, lat, level, stretch = true) {
  if (stretch) return cellFromLatLng(lon, lat, level);
  const { face, u, v } = faceUV(lonLatToXYZ(lon, lat));
  const n = 2 ** level;
  const i = clamp(Math.floor(uvToSTLinear(u) * n), 0, n - 1), j = clamp(Math.floor(uvToSTLinear(v) * n), 0, n - 1);
  return cellFromFaceIJ(face, i, j, level);
}

export function areaOf(cell, stretch = true) {
  if (stretch) return cellArea(cell, R_KM);
  return sphericalPolygonArea(cellBoundary(cell, { stretch: false })) * R_KM * R_KM;
}

export function stPoint(face, s, t, stretch = true) {
  const f = st(stretch);
  return xyzToLonLat(uvToXYZ(face, f(s), f(t)));
}

export function gridSegments(level, stretch = true, samples = 16) {
  const n = 2 ** level;
  const segs = [];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k <= n; k++) {
      const c = clamp(k / n, EPS, 1 - EPS);
      let pa = null, pb = null;
      for (let q = 0; q <= samples; q++) {
        const r = EPS + ((1 - 2 * EPS) * q) / samples;
        const a = stPoint(face, c, r, stretch), b = stPoint(face, r, c, stretch);
        if (pa) { segs.push([pa, a]); segs.push([pb, b]); }
        pa = a; pb = b;
      }
    }
  }
  return segs;
}

export function hilbertPath(level, stretch = true) {
  const pts = [];
  for (let face = 0; face < 6; face++) for (const c of hilbertOrder(level, face)) pts.push(cellCenter(c, stretch));
  return pts;
}

function slerpSegments(a, b, stepDeg = 1.5) {
  const A = lonLatToXYZ(a[0], a[1]), B = lonLatToXYZ(b[0], b[1]);
  const w = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1));
  const n = Math.max(1, Math.ceil(w / (stepDeg * DEG)));
  const out = [];
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    let p;
    if (w < 1e-9) p = b;
    else {
      const s0 = Math.sin((1 - t) * w) / Math.sin(w), s1 = Math.sin(t * w) / Math.sin(w);
      p = xyzToLonLat([A[0] * s0 + B[0] * s1, A[1] * s0 + B[1] * s1, A[2] * s0 + B[2] * s1]);
    }
    out.push([prev, p]);
    prev = p;
  }
  return out;
}

function cellOutline(cell, stretch, steps = 12) {
  const n = 2 ** cell.level;
  const s0 = clamp(cell.i / n, EPS, 1 - EPS), s1 = clamp((cell.i + 1) / n, EPS, 1 - EPS), t0 = clamp(cell.j / n, EPS, 1 - EPS), t1 = clamp((cell.j + 1) / n, EPS, 1 - EPS);
  const corners = [[s0, t0], [s1, t0], [s1, t1], [s0, t1], [s0, t0]];
  const segs = [];
  for (let k = 0; k < 4; k++) {
    let prev = null;
    for (let q = 0; q <= steps; q++) {
      const u = q / steps;
      const p = stPoint(cell.face, corners[k][0] + (corners[k + 1][0] - corners[k][0]) * u, corners[k][1] + (corners[k + 1][1] - corners[k][1]) * u, stretch);
      if (prev) segs.push([prev, p]);
      prev = p;
    }
  }
  return segs;
}

export function fmtArea(km2) {
  if (km2 >= 1) return { value: km2, unit: "km²" };
  const m2 = km2 * 1e6;
  if (m2 >= 1) return { value: m2, unit: "m²" };
  return { value: m2 * 1e4, unit: "cm²" };
}

export function fmtSize(km2) {
  const m = Math.sqrt(km2) * 1000;
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 1e5 ? 0 : 1)} km`;
  if (m >= 1) return `${m.toFixed(m >= 100 ? 0 : 1)} m`;
  return `${(m * 100).toFixed(1)} cm`;
}

export function countLabel(level) {
  return (6n * 4n ** BigInt(level)).toLocaleString("en-US");
}

export async function mount(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let t = params.m ?? 0;
  let booted = false;
  let oriented = false;
  let gridKey = "";
  let hilbertLayer = null, hilbertKey = "", drawOn = null;
  let split = null;
  let lastLevel = params.level;
  let picked = null;

  const morph = morphs.toPolyhedron("cube");
  globe.morph(morph, t);
  globe.labelInsetBottom = ctx.stage.insetBottom;
  FACE_CENTRES.forEach((_, f) => globe.addLabel3D(PREFIX + "face" + f, null, "", { color: INK, dx: -22, dy: -8, occlude: true }));
  globe.addLabel3D(PREFIX + "cell-label", null, "", { color: SIGNAL, dx: 12, dy: -20 });

  const panel = ctx.stage.element("div", "s2-panel");
  panel.style.cssText = "position:absolute;inset:auto;left:16px;top:16px;width:auto;height:auto;padding:10px 12px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;display:none;";
  const pTitle = document.createElement("div");
  pTitle.style.cssText = `font:600 12px/16px ${FONT_UI};color:${INK};margin-bottom:6px;`;
  const pCanvas = document.createElement("canvas");
  const pCap = document.createElement("div");
  pCap.style.cssText = `font:500 11px/15px ${FONT_MONO};color:${INK2};margin-top:6px;max-width:220px;`;
  panel.append(pTitle, pCanvas, pCap);

  const level = () => (params.closeUp ? params.level : Math.min(params.level, GLOBE_MAX));
  const gridLevel = () => Math.min(level(), GLOBE_MAX);

  const pickCell = () => {
    const [lon, lat] = params.point;
    picked = cellAt(lon, lat, level(), params.stretch);
    return picked;
  };

  const point3 = (ll, face = -1) => [...morph(ll[0], ll[1], t, [0, 0, 0], face)];

  const OV_W = 4096, OV_H = 2048;
  const strokeLonLat = (g, line) => {
    let px = null;
    for (const [lon, lat] of line) {
      const x = ((lon + 180) / 360) * OV_W, y = ((90 - lat) / 180) * OV_H;
      if (px === null || Math.abs(x - px) > OV_W / 2) g.moveTo(x, y); else g.lineTo(x, y);
      px = x;
    }
  };

  const gridLines = (L, stretch, samples) => {
    const n = 2 ** L, lines = [];
    for (let face = 0; face < 6; face++) for (let k = 0; k <= n; k++) {
      const c = clamp(k / n, EPS, 1 - EPS);
      const a = [], b = [];
      for (let q = 0; q <= samples; q++) { const r = EPS + ((1 - 2 * EPS) * q) / samples; a.push(stPoint(face, c, r, stretch)); b.push(stPoint(face, r, c, stretch)); }
      lines.push(a, b);
    }
    return lines;
  };

  const drawGrid = () => {
    const L = gridLevel();
    const key = L + "|" + params.stretch;
    if (key === gridKey) return;
    gridKey = key;
    if (L <= 5) {
      globe.remove(PREFIX + "grid-ov");
      const samples = L <= 2 ? 24 : 16;
      const alpha = L <= 3 ? 0.62 : 0.45;
      globe.addLines(PREFIX + "grid", gridSegments(L, params.stretch, samples), { color: `rgba(26,25,23,${alpha})`, width: 1 });
      return;
    }
    globe.remove(PREFIX + "grid");
    const lines = gridLines(L, params.stretch, 48);
    globe.addCanvasOverlay(PREFIX + "grid-ov", (g) => {
      g.beginPath();
      for (const line of lines) strokeLonLat(g, line);
      const a = L === 6 ? 0.5 : L === 7 ? 0.42 : 0.34;
      g.strokeStyle = `rgba(26,25,23,${a})`;
      g.lineWidth = L === 8 ? 1 : 1.4;
      g.stroke();
    });
  };

  const drawHilbert = (animate) => {
    const L = Math.min(level(), HILBERT_MAX);
    const key = L + "|" + params.stretch;
    const viaOverlay = L >= 6;
    if (!params.hilbert || params.closeUp) { globe.setLayer(PREFIX + "hilbert", false); globe.setLayer(PREFIX + "hilbert-ov", false); return; }
    if (key !== hilbertKey) {
      hilbertKey = key;
      const pts = hilbertPath(L, params.stretch);
      if (viaOverlay) {
        globe.remove(PREFIX + "hilbert");
        hilbertLayer = null;
        globe.addCanvasOverlay(PREFIX + "hilbert-ov", (g) => {
          g.beginPath(); strokeLonLat(g, pts);
          g.strokeStyle = "rgba(184,82,23,.9)"; g.lineWidth = 2.2; g.lineJoin = "round"; g.stroke();
        });
      } else {
        globe.remove(PREFIX + "hilbert-ov");
        const segs = [];
        for (let k = 1; k < pts.length; k++) segs.push(...slerpSegments(pts[k - 1], pts[k], L <= 2 ? 1.5 : L <= 4 ? 2.5 : 6));
        hilbertLayer = globe.addLines(PREFIX + "hilbert", segs, { color: BRASS, width: L >= 5 ? 1.25 : 2 });
      }
      animate = animate !== false;
    }
    globe.setLayer(viaOverlay ? PREFIX + "hilbert-ov" : PREFIX + "hilbert", true);
    if (drawOn) drawOn.cancel();
    if (!hilbertLayer) return;
    const total = hilbertLayer.n;
    if (!animate || !booted || ctx.reducedMotion) { hilbertLayer.geom.instanceCount = total; globe.invalidate(); return; }
    hilbertLayer.geom.instanceCount = 0;
    drawOn = ctx.anim.tween({ from: 0, to: total, duration: 1400, ease: ctx.anim.ease.linear, onUpdate: (v) => { hilbertLayer.geom.instanceCount = Math.max(1, Math.round(v)); globe.invalidate(); }, onDone: () => { drawOn = null; } });
  };

  const drawPicked = () => {
    const c = pickCell();
    globe.addLines(PREFIX + "cell", cellOutline(c, params.stretch, c.level <= 3 ? 24 : 8), { color: SIGNAL, width: 2.5 });
    globe.setLabel3D(PREFIX + "cell-label", { point: point3(cellCenter(c, params.stretch), c.face), text: c.token });
  };

  const animateSplit = (cell) => {
    if (split) split.cancel();
    if (!booted || ctx.reducedMotion || cell.level < 1) { globe.remove(PREFIX + "split"); return; }
    const par = parentOf(cell);
    const n = 2 ** par.level;
    const cs = (par.i + 0.5) / n, ct = (par.j + 0.5) / n, h = 0.5 / n;
    split = ctx.anim.tween({ from: 0, to: 1, duration: 320, ease: ctx.anim.ease.out, onUpdate: (u) => {
      const segs = [];
      for (const [ds, dt] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let prev = stPoint(par.face, cs, ct, params.stretch);
        for (let q = 1; q <= 8; q++) {
          const r = (q / 8) * u * h;
          const p = stPoint(par.face, clamp(cs + ds * r, EPS, 1 - EPS), clamp(ct + dt * r, EPS, 1 - EPS), params.stretch);
          segs.push([prev, p]);
          prev = p;
        }
      }
      globe.addLines(PREFIX + "split", segs, { color: SIGNAL, width: 2 });
    }, onDone: () => { split = null; setTimeout(() => globe.remove(PREFIX + "split"), 250); } });
  };

  const drawFaces = () => {
    const show = level() <= 6;
    FACE_CENTRES.forEach(([lon, lat], f) => {
      globe.setLabel3D(PREFIX + "face" + f, { point: point3([lon, lat], f), text: show ? `face ${f}` : "" });
    });
  };

  const drawPanel = () => {
    panel.style.display = params.closeUp ? "" : "none";
    if (!params.closeUp || !picked) return;
    const c = picked;
    const W = 220, H = 220;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pCanvas.width = W * dpr; pCanvas.height = H * dpr;
    pCanvas.style.width = W + "px"; pCanvas.style.height = H + "px";
    const g = pCanvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const up = Math.min(2, c.level);
    const anc = up ? parentOf(c, c.level - up) : c;
    const k = 2 ** up;
    const cells = [];
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) cells.push(cellFromFaceIJ(c.face, anc.i * k + a, anc.j * k + b, c.level));
    cells.sort((x, y) => (x.id < y.id ? -1 : 1));
    const px = (i) => 10 + ((i - anc.i * k) / k) * (W - 20), py = (j) => H - 10 - ((j - anc.j * k) / k) * (H - 20);
    const cw = (W - 20) / k;
    for (const q of cells) {
      const on = q.id === c.id;
      g.fillStyle = on ? "rgba(29,99,168,.3)" : "rgba(250,248,243,.9)";
      g.fillRect(px(q.i), py(q.j + 1), cw, cw);
      g.strokeStyle = on ? SIGNAL : "rgba(26,25,23,.35)"; g.lineWidth = on ? 2 : 1;
      g.strokeRect(px(q.i) + 0.5, py(q.j + 1) + 0.5, cw - 1, cw - 1);
    }
    g.beginPath();
    cells.forEach((q, idx) => { const x = px(q.i) + cw / 2, y = py(q.j) - cw / 2; if (idx) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = BRASS; g.lineWidth = 2; g.stroke();
    g.font = `500 10px ${FONT_MONO}`; g.textAlign = "center"; g.textBaseline = "middle";
    cells.forEach((q, idx) => { g.fillStyle = q.id === c.id ? INK : INK3; g.fillText(String(idx), px(q.i) + cw / 2 + 9, py(q.j) - cw / 2 - 8); });
    pTitle.textContent = up ? `Level ${c.level} inside level ${anc.level}` : `Level ${c.level}`;
    pCap.textContent = `${c.token} · about ${fmtSize(areaOf(c, params.stretch))} across · ${countLabel(c.level)} cells`;
  };

  const readouts = () => {
    const c = picked || pickCell();
    const a = fmtArea(areaOf(c, params.stretch));
    ctx.readout.setMany({
      face: String(c.face),
      level: String(c.level),
      token: c.token,
      id: c.id.toString(),
      area: `${a.value >= 100 ? Math.round(a.value).toLocaleString("en-US") : a.value.toPrecision(3)} ${a.unit}`,
      count: countLabel(c.level),
    });
  };

  const netPoints = () => {
    const pts = [];
    for (let f = 0; f < 6; f++) for (const [s, tt] of [[EPS, EPS], [1 - EPS, EPS], [1 - EPS, 1 - EPS], [EPS, 1 - EPS], [0.5, 0.5]]) pts.push(point3(stPoint(f, s, tt, false), f));
    return pts;
  };

  const frameCamera = () => {
    if (ctx.side !== "A") return;
    if (t <= 0) { oriented = false; return; }
    if (t > 0.5 && !oriented) {
      oriented = true;
      globe.camera.lookAt(0, 0, null, { duration: booted && !ctx.reducedMotion ? 600 : 0 });
    }
    if (t <= 0.5) oriented = false;
    const f = globe.camera.fit(netPoints(), { padding: FIT_PADDING, insetBottom: ctx.stage.insetBottom, insetTop: params.closeUp ? 0 : 0, minDist: meta.view.dist, apply: false });
    const w = smoothstep(0, 0.2, t);
    globe.camera.setDist(f.dist);
    globe.camera.setPan(f.pan[0] * w, f.pan[1] * w);
  };

  const closeUpCamera = () => {
    if (ctx.side !== "A" || !booted) return;
    const [lon, lat] = params.point;
    if (params.closeUp && t === 0) globe.camera.lookAt(lon, lat, 1.45, { duration: ctx.reducedMotion ? 0 : 650 });
    else if (!params.closeUp && t === 0) globe.camera.lookAt(lon, lat, meta.view.dist, { duration: ctx.reducedMotion ? 0 : 650 });
  };

  drawGrid();
  drawPicked();
  drawFaces();
  readouts();
  drawPanel();

  if (ctx.transport) ctx.transport.onScrub((v) => {
    t = v;
    globe.setMorphT(t);
    drawFaces();
    globe.setLabel3D(PREFIX + "cell-label", { point: point3(cellCenter(picked, params.stretch), picked.face) });
    frameCamera();
    ctx.overlay.update();
  });
  if (params.closeUp && ctx.side === "A" && t === 0) globe.camera.lookAt(params.point[0], params.point[1], 1.45, { duration: 0 });
  setTimeout(() => { booted = true; drawHilbert(false); }, 0);
  drawHilbert(false);

  return {
    update(p, keys) {
      const prevLevel = lastLevel;
      params = { ...p };
      t = params.m ?? t;
      if (keys.length === 1 && (keys[0] === "parent" || keys[0] === "child")) {
        const next = clamp(level() + (keys[0] === "child" ? 1 : -1), 0, MAX_LEVEL);
        Promise.resolve().then(() => { if (next > GLOBE_MAX && !params.closeUp) ctx.controls.set("closeUp", true); ctx.controls.set("level", next); });
        return;
      }
      if (keys.includes("level") && params.level > GLOBE_MAX && !params.closeUp && ctx.side === "A") { Promise.resolve().then(() => ctx.controls.set("closeUp", true)); }
      if (keys.includes("closeUp") && !params.closeUp && params.level > GLOBE_MAX && ctx.side === "A") { Promise.resolve().then(() => ctx.controls.set("level", GLOBE_MAX)); return; }
      lastLevel = level();
      drawGrid();
      if (keys.some((k) => k === "level" || k === "stretch" || k === "hilbert" || k === "closeUp")) drawHilbert(keys.includes("level") || keys.includes("hilbert"));
      drawPicked();
      if (keys.includes("level") && lastLevel === prevLevel + 1 && keys.length === 1) animateSplit(picked);
      drawFaces();
      readouts();
      drawPanel();
      if (keys.includes("closeUp") || (keys.includes("point") && params.closeUp)) closeUpCamera();
      if (keys.length > 3 && t > 0) frameCamera();
    },
    hover(lon, lat) {
      const c = cellAt(lon, lat, level(), params.stretch);
      return [`face ${c.face}`, `level ${c.level} · ${c.token}`];
    },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() {
      globe.labelInsetBottom = ctx.stage.insetBottom;
      if (t > 0) frameCamera();
    },
    unmount() {
      if (drawOn) drawOn.cancel();
      if (split) split.cancel();
      globe.removePrefix(PREFIX);
      globe.morph(null, 0);
      panel.remove();
      ctx.overlay.clear(PREFIX);
    },
  };
}
