import * as d3 from "d3";
import * as palette from "@/core/palette.js";
import { loadMesh, loadGeoJSON } from "@/core/data.js";
import { getBasemap } from "@/core/basemap.js";
import { assetUrl, reducedMotion, dpr } from "@/core/env.js";
import { LabelLayer, defaultLabelItems } from "@/core/labels.js";
import { registry as projRegistry, factors as projFactors, tissot as projTissot } from "@/core/projections.js";

const PAD = 28;
const SCALE_MIN = 0.6, SCALE_MAX = 24;
const GRID_STEP = 4;
const RASTER_GAP = 160;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function easeEmph(t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    const x = 3 * (1 - s) * (1 - s) * s * 0.3 + s * s * s;
    if (x < t) lo = s; else hi = s;
  }
  return 3 * (1 - s) * s * s * 1 + s * s * s;
}

const fallback = {
  mercator: () => d3.geoMercator(), webMercator: () => d3.geoMercator(), transverseMercator: () => d3.geoTransverseMercator(),
  equirectangular: () => d3.geoEquirectangular(), cylindricalEqualArea: () => d3.geoCylindricalEqualArea(), gallPeters: () => d3.geoCylindricalEqualArea().parallel(45),
  miller: () => d3.geoMiller(), lcc: () => d3.geoConicConformal().parallels([30, 60]), albers: () => d3.geoConicEqualArea().parallels([30, 60]), eqdc: () => d3.geoConicEquidistant().parallels([30, 60]),
  stereographic: () => d3.geoStereographic().clipAngle(150), gnomonic: () => d3.geoGnomonic().clipAngle(70), orthographic: () => d3.geoOrthographic().clipAngle(90),
  azimuthalEqualArea: () => d3.geoAzimuthalEqualArea(), azimuthalEquidistant: () => d3.geoAzimuthalEquidistant().clipAngle(179.5), satellite: () => d3.geoSatellite().distance(2).clipAngle(55),
  mollweide: () => d3.geoMollweide(), hammer: () => d3.geoHammer(), sinusoidal: () => d3.geoSinusoidal(), robinson: () => d3.geoRobinson(), winkel3: () => d3.geoWinkel3(),
  equalEarth: () => d3.geoEqualEarth(), naturalEarth1: () => d3.geoNaturalEarth1(), interruptedHomolosine: () => d3.geoInterruptedHomolosine(),
  interruptedHomolosineOcean: () => d3.geoInterruptedHomolosine(), gores12: () => d3.geoInterruptedSinusoidal(), butterfly: () => d3.geoPolyhedralButterfly(),
  airocean: () => d3.polygon.geoAirocean(), peirce: () => d3.geoPeirceQuincuncial(), polarNorth3413: () => d3.geoStereographic().rotate([45, -90]).clipAngle(60),
  polarSouth3031: () => d3.geoStereographic().rotate([0, 90]).clipAngle(60), easeNorth: () => d3.geoAzimuthalEqualArea().rotate([0, -90]).clipAngle(90)
};

let projLib = null;
async function loadProjLib() {
  if (projLib !== null) return projLib;
  try { projLib = await import("@/core/projections.js"); } catch (e) { projLib = false; }
  return projLib;
}

function isProjection(p) { return typeof p === "function" && typeof p.stream === "function"; }

function boxed(p) {
  if (!p || (p.clipAngle && p.clipAngle())) return p;
  const [[x0, y0], [x1, y1]] = d3.geoPath(p).bounds({ type: "Sphere" });
  if (![x0, y0, x1, y1].every(Number.isFinite)) return p;
  const tall = p([0, 89.999]), mid = p([0, 0]);
  if (!tall || Math.abs(tall[1] - mid[1]) <= (y1 - y0) * 0.75) return p;
  const f = (ll) => { const q = p(ll); return q ? [clamp(q[0], x0, x1), clamp(q[1], y0, y1)] : q; };
  for (const k of ["scale", "translate", "rotate", "clipAngle", "clipExtent", "precision", "stream"]) if (p[k]) f[k] = (...a) => (a.length ? p[k](...a) : p[k]());
  f.invert = p.invert ? (xy) => p.invert(xy) : undefined;
  return f;
}

export class Map2D {
  constructor(stageEl, { colour = "ramp", projectionId = "equalEarth", labels = true, raster = true, hillshade = 0.14 } = {}) {
    this.el = stageEl;
    this.opts = { colour, projectionId, labels, hillshade };
    this.layers = new Map();
    this.layerState = new Map();
    this.listeners = new Map();
    this.gratOpts = { minor: true, major: true, equator: true, tropics: true, step: 10 };
    this.rasterEnabled = raster;
    this.width = 1; this.height = 1;
    this.disposed = false;
    this.projection = null;
    this.projectionId = projectionId;
    this.morph = null;
    this.interacting = false;
    this.pathCache = new Map();
    this.frameTimes = [];
    this.rasterTimes = [];
    this.animations = new Set();
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.projectionTag = "";
    this.dragFilter = null;
    this.touchTimer = 0;
    this.fitTarget = null;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;";
    stageEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.rasterCanvas = document.createElement("canvas");
    this.rasterCtx = this.rasterCanvas.getContext("2d");
    this.rasterInfo = null;
    this.labelLayer = new LabelLayer(stageEl);
    this.labelLayer.setVisible(labels);

    this.workers = [];
    this.jobId = 0;
    this.jobPending = false;
    this.jobRunning = null;
    this.lastJobAt = 0;
    this.rasterTimer = null;

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stageEl);
    this.resize();
    this.ready = this.load();
  }

  async load() {
    await loadProjLib();
    const first = await this.makeProjection(this.projectionId);
    if (!this.projection) { this.projection = first; this.fitScale = first.scale(); }
    this.render();
    this.addGraticule();
    const coastReady = loadMesh("land-110m.json", "land").then((coast110) => {
      this.coast110 = coast110;
      this.addFeatures("coast", coast110, { stroke: palette.lines.coast, width: 0.7, order: 40, base: true });
    });
    const bm = await getBasemap({ colour: this.opts.colour });
    await coastReady;
    this.basemap = bm;
    loadMesh("land-50m.json", "land").then((c) => { this.coast50 = c; this.invalidate(); });
    Promise.all([loadGeoJSON("ne_50m_lakes.geojson"), loadGeoJSON("ne_110m_lakes.geojson")]).then(([l, l110]) => { this.lakes = { type: "FeatureCollection", features: l.features.filter((f) => f.properties.scalerank <= 7) }; this.addFeatures("lakes", this.lakes, { fill: palette.lake, order: 20, base: true, fastFeatures: l110 }); });
    if (this.disposed) return;
    await this.startWorkers(bm);
    if (this.opts.labels) await this.loadLabels();
    this.invalidate();
  }

  async loadLabels() {
    if (!this.labelItems) { this.labelItems = await defaultLabelItems(2); this.labelLayer.setItems(this.labelItems); }
  }

  async startWorkers(bm) {
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    const inits = [];
    const list = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(assetUrl("workers/reproject.js"), { type: "module" });
      const color = bm.color.slice(), hs = bm.hillshade.slice();
      inits.push(new Promise((resolve) => {
        w.onmessage = (e) => { if (e.data.type === "ready") resolve(); };
        w.postMessage({ type: "init", color, width: bm.width, height: bm.height, hillshade: hs, hw: bm.width / 2, hh: bm.height / 2 }, [color.buffer, hs.buffer]);
      }));
      list.push(w);
    }
    await Promise.all(inits);
    if (this.disposed) { for (const w of list) w.terminate(); return; }
    for (const w of list) w.onmessage = (e) => this.onWorker(e.data);
    this.workers = list;
    this.invalidate();
  }

  extent() {
    const i = this.insets;
    return [[PAD + i.left, PAD + i.top], [Math.max(PAD + i.left + 1, this.width - PAD - i.right), Math.max(PAD + i.top + 1, this.height - PAD - i.bottom)]];
  }

  fitObject() { return this.fitTarget || { type: "Sphere" }; }

  setFitTarget(geo) { this.fitTarget = geo || null; }

  setInsets(insets = {}) {
    const e0 = this.extent();
    Object.assign(this.insets, insets);
    this.reframe(e0);
  }

  reframe(e0) {
    const p = this.projection;
    if (p && p.fitExtent) {
      const e1 = this.extent();
      const s = p.scale(), t = p.translate();
      const obj = this.fitObject();
      const valid = (k, tr) => k > 0 && isFinite(k) && tr.every(Number.isFinite);
      let k0 = NaN, t0 = [NaN, NaN];
      if (e0 && e0[1][0] - e0[0][0] > 2 && e0[1][1] - e0[0][1] > 2) { p.fitExtent(e0, obj); k0 = p.scale(); t0 = p.translate(); }
      p.fitExtent(e1, obj);
      const k1 = p.scale(), t1 = p.translate();
      if (!valid(k1, t1)) { p.scale(s); p.translate(t); }
      else if (valid(k0, t0) && this.fitScale) {
        const f = k1 / k0;
        const move = (q) => { const qt = q.translate(); q.scale(q.scale() * f); q.translate([t1[0] + (qt[0] - t0[0]) * f, t1[1] + (qt[1] - t0[1]) * f]); };
        p.scale(s); p.translate(t); move(p);
        if (this.morph) for (const q of new Set([this.morph.from, this.morph.to])) if (q && q !== p && q.scale && q.translate) move(q);
        this.fitScale *= f;
      } else this.fitScale = k1;
      this.sphereScale = this.sphereScaleOf(p);
    }
    this.pathCache.clear();
    this.invalidate();
  }

  async makeProjection(idOrProj, opts = {}) {
    let p;
    const { keep, fit = true, ...rest } = opts;
    if (isProjection(idOrProj)) p = idOrProj;
    else {
      const lib = await loadProjLib();
      if (lib && lib.get) p = lib.get(idOrProj, { ...rest, width: this.width, height: this.height, padding: PAD });
      else {
        const make = fallback[idOrProj];
        if (!make) throw new Error("unknown projection " + idOrProj);
        p = make();
        if (p.precision) p.precision(0.3);
      }
    }
    if (!p.translate || !p.scale) return p;
    if (!keep && (fit || !isProjection(idOrProj)) && p.fitExtent) p.fitExtent(this.extent(), this.fitObject());
    return p;
  }

  async setProjection(idOrProjection, { duration = 900, opts = {}, tag, interpolated = false } = {}) {
    const target = await this.makeProjection(idOrProjection, opts);
    this.interpolated = !!interpolated;
    if (!isProjection(idOrProjection)) this.projectionId = idOrProjection;
    this.projectionTag = tag !== undefined ? String(tag) : Object.keys(opts).length ? JSON.stringify(opts) : "";
    const from = this.projection;
    const lib = await loadProjLib();
    this.stopMorph();
    if (!from || reducedMotion || duration <= 1 || !lib || !lib.interpolate) {
      this.projection = target; this.fitScale = target.scale(); this.sphereScale = this.sphereScaleOf(target); this.morph = null; this.pathCache.clear();
      this.invalidate();
      return;
    }
    const t0 = performance.now();
    const mFrom = boxed(from), mTo = boxed(target);
    const morph = { from, to: target, t: 0, mFrom, mTo };
    this.morph = morph;
    this.interacting = true;
    return new Promise((resolve) => {
      const finish = () => { this.animations.delete(anim); if (this.morphAnim === anim) this.morphAnim = null; resolve(); };
      const anim = (now) => {
        if (this.morph !== morph) { finish(); return; }
        const u = easeEmph(clamp((now - t0) / duration, 0, 1));
        morph.t = u;
        this.projection = u >= 1 ? target : lib.interpolate(mFrom, mTo, u);
        this.pathCache.clear();
        if (u >= 1) { this.morph = null; this.fitScale = target.scale(); this.sphereScale = this.sphereScaleOf(target); this.interacting = false; finish(); }
      };
      anim.finish = finish;
      this.morphAnim = anim;
      this.animations.add(anim);
      this.invalidate();
    });
  }

  stopMorph() {
    const a = this.morphAnim;
    if (!a) return;
    this.morphAnim = null;
    this.morph = null;
    this.interacting = false;
    a.finish();
  }

  setMorphT(t) {
    if (!this.morph) return;
    this.morph.t = clamp(t, 0, 1);
    this.projection = projLib.interpolate(this.morph.mFrom || this.morph.from, this.morph.mTo || this.morph.to, this.morph.t);
    this.pathCache.clear();
    this.invalidate();
  }

  addLayer(id, drawFn, { order = 50, clip = true } = {}) {
    this.layers.set(id, { id, drawFn, order, clip });
    if (!this.layerState.has(id)) this.layerState.set(id, true);
    this.invalidate();
  }

  addFeatures(id, features, { fill = null, stroke = null, width = 1, dash = null, order = 50, opacity = 1, base = false, lineCap = "round", fastFeatures = null } = {}) {
    const fc = Array.isArray(features) ? { type: "FeatureCollection", features } : features;
    const drawFn = (ctx, path) => {
      const fast = !!fastFeatures && !!(this.interacting || this.morph || this.inertia);
      const key = id + (fast ? "|fast|" : "|") + this.stateKey();
      let p2 = this.pathCache.get(key);
      if (!p2) { p2 = new Path2D(); const pp = d3.geoPath(this.projection, p2); pp(fast ? fastFeatures : fc); this.pathCache.set(key, p2); }
      ctx.globalAlpha = opacity;
      if (fill) { ctx.fillStyle = fill; ctx.fill(p2); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = lineCap; ctx.lineJoin = "round"; ctx.setLineDash(dash || []); ctx.stroke(p2); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
    };
    this.layers.set(id, { id, drawFn, order, base, fc });
    if (!this.layerState.has(id)) this.layerState.set(id, true);
    this.invalidate();
  }

  addGraticule(opts = {}) {
    Object.assign(this.gratOpts, opts);
    const g = this.gratOpts;
    const minorStep = () => { const z = this.detail(); return z > 6 ? 1 : z > 2 ? 5 : 10; };
    const lines = (step, filter, lat = true) => {
      const out = [];
      for (let v = -180; v < 180; v += step) if (filter(v)) out.push({ type: "LineString", coordinates: d3.range(-90, 90.001, 2).map((la) => [v, Math.min(la, 90)]) });
      if (lat) for (let v = -80; v <= 80; v += step) if (filter(v)) out.push({ type: "LineString", coordinates: d3.range(-180, 180.001, 2).map((lo) => [lo, v]) });
      return { type: "MultiLineString", coordinates: out.map((l) => l.coordinates) };
    };
    const draw = (ctx, path) => {
      const s = minorStep();
      const key = "grat|" + s + "|" + this.stateKey();
      let set = this.pathCache.get(key);
      if (!set) {
        const mk = (geo) => { const p2 = new Path2D(); d3.geoPath(this.projection, p2)(geo); return p2; };
        set = {
          minor: mk(lines(s, (v) => v !== 0 && v % 30 !== 0)),
          major: mk(lines(30, (v) => v !== 0)),
          equator: mk({ type: "MultiLineString", coordinates: [d3.range(-180, 180.001, 2).map((lo) => [lo, 0]), d3.range(-90, 90.001, 2).map((la) => [0, la])] }),
          tropics: mk({ type: "MultiLineString", coordinates: [23.44, -23.44, 66.56, -66.56].map((la) => d3.range(-180, 180.001, 2).map((lo) => [lo, la])) })
        };
        this.pathCache.set(key, set);
      }
      ctx.lineCap = "butt";
      if (g.minor) { ctx.strokeStyle = palette.lines.gratMinor; ctx.lineWidth = 1; ctx.stroke(set.minor); }
      if (g.major) { ctx.strokeStyle = palette.lines.gratMajor; ctx.lineWidth = 1; ctx.stroke(set.major); }
      if (g.tropics) { ctx.strokeStyle = palette.lines.tropic; ctx.lineWidth = 1; ctx.setLineDash([6, 3]); ctx.stroke(set.tropics); ctx.setLineDash([]); }
      if (g.equator) { ctx.strokeStyle = palette.lines.equator; ctx.lineWidth = 1.25; ctx.stroke(set.equator); }
    };
    this.layers.set("graticule", { id: "graticule", drawFn: draw, order: 45, base: true });
    if (!this.layerState.has("graticule")) this.layerState.set("graticule", true);
    this.invalidate();
  }

  setGraticule(opts) { Object.assign(this.gratOpts, opts); this.invalidate(); }

  setLayer(id, on) {
    if (id === "labels") { this.labelLayer.setVisible(!!on); if (on) this.loadLabels().then(() => this.invalidate()); return; }
    if (id === "raster") { this.rasterOn(on); return; }
    if (id === "rivers" && on && !this.layers.has("rivers")) {
      loadGeoJSON("ne_50m_rivers_lake_centerlines.geojson").then((r) => { this.addFeatures("rivers", r, { stroke: palette.lines.river, width: 0.6, order: 30, base: true }); this.layerState.set("rivers", true); this.invalidate(); });
    }
    if (id === "borders" && on && !this.layers.has("borders")) {
      loadMesh("countries-50m.json", "countries", (a, b) => a !== b).then((b) => { this.addFeatures("borders", b, { stroke: palette.lines.border, width: 0.5, order: 35, base: true }); this.layerState.set("borders", true); this.invalidate(); });
    }
    this.layerState.set(id, !!on);
    this.invalidate();
  }

  remove(id) { this.layers.delete(id); this.layerState.delete(id); this.invalidate(); }
  removePrefix(prefix) { for (const id of [...this.layers.keys()]) if (id.startsWith(prefix)) this.remove(id); }

  rasterOn(on) { this.rasterEnabled = !!on; this.invalidate(); }

  zoom() { return this.projection && this.fitScale ? this.projection.scale() / this.fitScale : 1; }

  detail() { return this.fitTarget && this.sphereScale ? Math.max(this.zoom(), this.projection.scale() / this.sphereScale) : this.zoom(); }

  smoothOutline() {
    const key = "outline|" + this.stateKey();
    const hit = this.pathCache.get(key);
    if (hit) return hit;
    const p = this.projection;
    const cf = p.clipFrame;
    const ca = cf ? cf.angle : p.clipAngle ? p.clipAngle() : 0;
    const rot = d3.geoRotation(cf ? cf.rotate : p.rotate ? p.rotate() : [0, 0, 0]);
    const ring = [];
    if (ca > 0) ring.push(...d3.geoCircle().radius(ca).precision(0.5)().coordinates[0]);
    else {
      const E = 1e-4, L = 180 - E, M = 90 - E, n = 360;
      for (let i = 0; i <= n; i++) ring.push([L, -M + (2 * M * i) / n]);
      for (let i = 0; i <= 2 * n; i++) ring.push([L - (2 * L * i) / (2 * n), M]);
      for (let i = 0; i <= n; i++) ring.push([-L, M - (2 * M * i) / n]);
      for (let i = 0; i <= 2 * n; i++) ring.push([-L + (2 * L * i) / (2 * n), -M]);
    }
    const out = new Path2D();
    const w = this.width, h = this.height;
    let started = false;
    for (const q of ring) {
      const xy = p(rot.invert(q));
      if (!xy || Number.isNaN(xy[0]) || Number.isNaN(xy[1])) continue;
      const x = clamp(xy[0], -w, 2 * w), y = clamp(xy[1], -h, 2 * h);
      if (started) out.lineTo(x, y); else { out.moveTo(x, y); started = true; }
    }
    out.closePath();
    this.pathCache.set(key, out);
    return out;
  }

  sphereScaleOf(p) {
    if (!this.fitTarget || !p || !p.fitExtent) return null;
    const s0 = p.scale(), t0 = p.translate();
    p.fitExtent(this.extent(), { type: "Sphere" });
    const s = p.scale();
    p.scale(s0); p.translate(t0);
    return s;
  }

  stateKey() {
    const p = this.projection;
    if (!p) return "none";
    const t = p.translate ? p.translate() : [0, 0];
    const r = p.rotate ? p.rotate() : [0, 0, 0];
    return `${this.projectionId}${this.projectionTag}|${p.scale ? p.scale().toFixed(3) : ""}|${t[0].toFixed(2)},${t[1].toFixed(2)}|${r.map((v) => v.toFixed(3)).join(",")}|${this.morph ? this.morph.t.toFixed(4) : ""}`;
  }

  project(lon, lat) {
    const p = this.projection ? this.projection([lon, lat]) : null;
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return { x: NaN, y: NaN, visible: false };
    let visible = true;
    if (this.projection.invert) {
      const back = this.projection.invert(p);
      if (!back || !isFinite(back[0])) visible = false;
      else {
        const dl = Math.abs(((back[0] - lon + 540) % 360) - 180), dp = Math.abs(back[1] - lat);
        if (dl > 0.5 && Math.abs(lat) < 89 || dp > 0.5) visible = false;
      }
    }
    if (visible && this.outlinePath && !this.ctx.isPointInPath(this.outlinePath, p[0] * dpr, p[1] * dpr)) visible = false;
    return { x: p[0], y: p[1], visible };
  }

  hitPath(path2d, x, y) {
    return !!path2d && this.ctx.isPointInPath(path2d, x * dpr, y * dpr);
  }

  insideOutline(x, y) {
    return !this.outlinePath || this.ctx.isPointInPath(this.outlinePath, x * dpr, y * dpr);
  }

  pick(x, y) {
    if (!this.projection || !this.projection.invert) return null;
    const ll = this.projection.invert([x, y]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
    const back = this.projection([ll[0], ll[1]]);
    if (!back || Math.hypot(back[0] - x, back[1] - y) > 1) return null;
    if (this.outlinePath && !this.ctx.isPointInPath(this.outlinePath, x * dpr, y * dpr)) return null;
    return { lon: ((ll[0] + 540) % 360) - 180, lat: ll[1] };
  }

  pan(dx, dy) {
    if (!this.projection || !this.projection.translate) return;
    const t = this.projection.translate();
    this.projection.translate([t[0] + dx, t[1] + dy]);
    this.pathCache.clear();
    this.invalidate();
  }

  zoomAt(x, y, factor) {
    if (!this.projection || !this.projection.scale) return;
    const k0 = this.zoom();
    const k1 = clamp(k0 * factor, SCALE_MIN, SCALE_MAX);
    const f = k1 / k0;
    if (f === 1) return;
    const t = this.projection.translate();
    this.projection.scale(this.projection.scale() * f);
    this.projection.translate([x + (t[0] - x) * f, y + (t[1] - y) * f]);
    this.pathCache.clear();
    this.invalidate();
  }

  touch(ms = 160) {
    this.interacting = true;
    clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => { this.interacting = false; this.invalidate(); }, ms);
    this.invalidate();
  }

  setDragFilter(fn) { this.dragFilter = fn; }

  fit() {
    if (!this.projection || !this.projection.fitExtent) return;
    this.projection.fitExtent(this.extent(), this.fitObject());
    this.fitScale = this.projection.scale();
    this.sphereScale = this.sphereScaleOf(this.projection);
    this.pathCache.clear();
    this.invalidate();
  }

  viewCenter() {
    const i = this.insets;
    return [(i.left + this.width - i.right) / 2, (i.top + this.height - i.bottom) / 2];
  }

  state() {
    const [vx, vy] = this.viewCenter();
    const c = this.pick(vx, vy) || { lon: 0, lat: 0 };
    return { lon: +c.lon.toFixed(4), lat: +c.lat.toFixed(4), scale: +this.zoom().toFixed(4), projection: this.projectionId };
  }

  setState(s) {
    if (!s || !this.projection) return;
    if (s.scale) this.projection.scale(this.fitScale * clamp(s.scale, SCALE_MIN, SCALE_MAX));
    if (s.lon !== undefined && s.lat !== undefined) {
      const p = this.projection([s.lon, s.lat]);
      if (p && isFinite(p[0])) {
        const t = this.projection.translate();
        const [vx, vy] = this.viewCenter();
        this.projection.translate([t[0] + vx - p[0], t[1] + vy - p[1]]);
      }
    }
    this.pathCache.clear();
    this.invalidate();
  }

  lookAt(lon, lat, scale, { duration = 650 } = {}) {
    const s0 = this.state();
    const target = { lon, lat, scale: scale || s0.scale };
    if (reducedMotion || duration <= 1) { this.setState(target); return Promise.resolve(); }
    const p0 = this.projection([lon, lat]);
    if (!p0) { this.setState(target); return Promise.resolve(); }
    const t0 = performance.now(), tr0 = this.projection.translate(), k0 = this.zoom();
    const [vx, vy] = this.viewCenter();
    const trTarget = [tr0[0] + vx - p0[0], tr0[1] + vy - p0[1]];
    return new Promise((resolve) => {
      const anim = (now) => {
        const u = easeEmph(clamp((now - t0) / duration, 0, 1));
        const k = lerp(k0, target.scale, u);
        const cx = vx, cy = vy;
        const tr = [lerp(tr0[0], trTarget[0], u), lerp(tr0[1], trTarget[1], u)];
        this.projection.scale(this.fitScale * k);
        const f = k / k0;
        this.projection.translate([cx + (tr[0] - cx) * f, cy + (tr[1] - cy) * f]);
        this.pathCache.clear();
        if (u >= 1) { this.animations.delete(anim); resolve(); }
      };
      this.animations.add(anim);
      this.invalidate();
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, payload) { const s = this.listeners.get(event); if (s) for (const fn of s) fn(payload); }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      try { c.setPointerCapture(e.pointerId); } catch (err) {}
      const claim = this.dragFilter ? this.dragFilter(x, y) : null;
      drag = { x: e.clientX, y: e.clientY, moved: 0, claim: claim || null, x0: x, y0: y };
      this.vel = [0, 0];
      this.inertia = null;
      if (claim) { this.emit("customdrag", { phase: "start", claim, x, y, dx: 0, dy: 0 }); return; }
      c.style.cursor = "grabbing";
    });
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.claim) { this.emit("customdrag", { phase: "move", claim: drag.claim, x, y, dx, dy, moved: drag.moved }); return; }
        this.interacting = true;
        this.vel = [dx, dy];
        this.pan(dx, dy);
        this.emit("drag", this.state());
        return;
      }
      const p = this.pick(x, y);
      this.emit("hover", p ? { lon: p.lon, lat: p.lat, x, y } : null);
    });
    const end = (e) => {
      if (!drag) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const moved = drag.moved;
      const claim = drag.claim;
      drag = null;
      c.style.cursor = "grab";
      this.interacting = false;
      if (claim) { this.emit("customdrag", { phase: moved < 4 ? "click" : "end", claim, x, y, dx: 0, dy: 0, moved }); this.invalidate(); return; }
      if (moved < 4) { const p = this.pick(x, y); if (p) this.emit("click", { lon: p.lon, lat: p.lat, x, y }); }
      else if (!reducedMotion && this.vel) this.inertia = this.vel.slice();
      this.emit("dragend", this.state());
      this.invalidate();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => { if (!drag) this.emit("hover", null); });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const f = Math.exp(-clamp(e.deltaY, -60, 60) * 0.0025);
      this.touch(200);
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, f);
      this.emit("wheel", this.state());
    }, { passive: false });
    c.addEventListener("dblclick", (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const claim = this.dragFilter ? this.dragFilter(x, y) : null;
      if (claim) { e.stopPropagation(); this.emit("customdblclick", { claim, x, y }); return; }
      const p = this.pick(x, y);
      if (p) this.lookAt(p.lon, p.lat, this.zoom(), { duration: 650 });
    });
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height) return;
    const e0 = this.width > 1 && this.height > 1 ? this.extent() : null;
    this.width = w; this.height = h;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.reframe(e0);
  }

  invalidate() {
    this.needsRender = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    this.raf = null;
    if (this.disposed) return;
    let animating = false;
    for (const a of this.animations) { a(now); animating = true; }
    if (this.inertia) {
      const [vx, vy] = this.inertia;
      this.pan(vx, vy);
      this.inertia = [vx * 0.92, vy * 0.92];
      if (Math.hypot(vx, vy) < 0.3) { this.inertia = null; } else animating = true;
    }
    this.render();
    if ((animating || this.needsRender) && !this.raf) this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  render() {
    if (this.disposed) return;
    const t0 = performance.now();
    this.needsRender = false;
    const ctx = this.ctx;
    if (!this.projection) return;
    const w = this.width, h = this.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const path = d3.geoPath(this.projection, ctx);
    const outline = this.morph || this.interpolated ? this.smoothOutline() : new Path2D();
    if (!this.morph && !this.interpolated) d3.geoPath(this.projection, outline)({ type: "Sphere" });
    this.outlinePath = outline;
    ctx.save();
    ctx.clip(outline);
    if (this.rasterEnabled && this.workers.length) {
      this.drawRaster();
      this.requestRaster();
    } else if (!this.rasterEnabled) {
      ctx.fillStyle = "#d5e4eb"; ctx.fill(outline);
    }
    const fast = this.interacting || this.morph || this.inertia;
    const all = [...this.layers.values()].filter((l) => this.layerState.get(l.id) !== false).sort((a, b) => a.order - b.order);
    const layers = all.filter((l) => l.clip !== false);
    for (const l of layers) {
      if (l.id === "coast") {
        const fc = fast || !this.coast50 || this.detail() < 1.5 ? this.coast110 : this.coast50;
        const key = "coast" + (fc === this.coast50 ? "50" : "110") + "|" + this.stateKey();
        let p2 = this.pathCache.get(key);
        if (!p2) { p2 = new Path2D(); d3.geoPath(this.projection, p2)(fc); this.pathCache.set(key, p2); }
        ctx.strokeStyle = palette.lines.coast; ctx.lineWidth = 0.7; ctx.lineJoin = "round"; ctx.stroke(p2);
        continue;
      }
      if (l.id === "rivers" && this.detail() < 2) continue;
      ctx.save();
      try { l.drawFn(ctx, path, this.projection, this.morph ? this.morph.t : 0); } catch (e) { console.error("layer " + l.id, e); }
      ctx.restore();
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = palette.lines.outlineGlow; ctx.shadowBlur = 14;
    ctx.strokeStyle = palette.lines.outline; ctx.lineWidth = 1;
    ctx.stroke(outline);
    ctx.stroke(outline);
    ctx.restore();
    for (const l of all) {
      if (l.clip !== false) continue;
      ctx.save();
      try { l.drawFn(ctx, path, this.projection, this.morph ? this.morph.t : 0); } catch (e) { console.error("layer " + l.id, e); }
      ctx.restore();
    }
    if (this.pathCache.size > 64) this.pathCache.clear();
    if (this.labelLayer.visible && this.labelItems) this.labelLayer.update((lon, lat) => this.project(lon, lat), w, h);
    const dt = performance.now() - t0;
    this.frameTimes.push(dt); if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.lastFrameMs = dt;
  }

  drawRaster() {
    const r = this.rasterInfo;
    if (!r) return;
    const ctx = this.ctx;
    const p = this.projection;
    const k = p.scale ? p.scale() / r.scale : 1;
    const t = p.translate ? p.translate() : [0, 0];
    const dx = t[0] - r.translate[0] * k, dy = t[1] - r.translate[1] * k;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.rasterCanvas, dx, dy, r.w / r.res * k, r.h / r.res * k);
    ctx.restore();
  }

  baseKey() {
    const p = this.projection;
    const r = p && p.rotate ? p.rotate() : [0, 0, 0];
    return `${this.projectionId}${this.projectionTag}|${r.map((v) => v.toFixed(3)).join(",")}`;
  }

  requestRaster() {
    const key = this.stateKey();
    const info = this.rasterInfo;
    if (info && info.key === key && info.res === this.rasterRes()) return;
    if (info && !this.morph && (this.interacting || this.inertia) && info.base === this.baseKey()) {
      const wait = RASTER_GAP - (performance.now() - this.lastJobAt);
      if (wait > 0) {
        if (!this.rasterTimer) this.rasterTimer = setTimeout(() => { this.rasterTimer = null; this.invalidate(); }, wait);
        return;
      }
    }
    if (this.jobRunning) { this.jobPending = true; return; }
    this.startJob();
  }

  rasterRes() { return (this.interacting || this.morph || this.inertia || (this.projection && this.projection.seedProjection)) ? Math.min(dpr, 2) * 0.5 : Math.min(dpr, 2); }

  outlineMask(p, w, h, res) {
    if (typeof OffscreenCanvas === "undefined") return null;
    const c = this.maskCanvas || (this.maskCanvas = new OffscreenCanvas(1, 1));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d", { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.setTransform(res, 0, 0, res, 0, 0);
    g.beginPath();
    d3.geoPath(p, g)({ type: "Sphere" });
    g.fill();
    return g.getImageData(0, 0, w, h).data;
  }

  startJob() {
    const p = this.projection;
    if (!p.invert) { this.rasterInfo = null; return; }
    const res = this.rasterRes();
    const w = Math.ceil(this.width * res), h = Math.ceil(this.height * res);
    const seedP = !this.morph && p.seedProjection ? p.seedProjection() : null;
    const morphing = !!this.morph || (!!seedP && !!(this.interacting || this.inertia));
    const step = seedP ? GRID_STEP * (morphing ? 8 : 2) : morphing ? GRID_STEP * 2 : GRID_STEP * Math.max(1, Math.round(res));
    const gw = Math.ceil(w / step) + 1, gh = Math.ceil(h / step) + 1;
    const grid = new Float32Array(gw * gh * 2);
    const tol = 0.6 / res + 0.01;
    const exactInv = (x, y) => {
      const ll = p.invert([x / res, y / res]);
      if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
      const back = p([ll[0], ll[1]]);
      if (!back || Math.abs(back[0] - x / res) > tol || Math.abs(back[1] - y / res) > tol) return null;
      return ll;
    };
    const seeded = (x, y, seed) => {
      const px = x / res, py = y / res;
      let lon = seed[0], lat = seed[1];
      for (let it = 0; it < 6; it++) {
        const f = p([lon, lat]);
        if (!f || !isFinite(f[0])) return null;
        const ex = f[0] - px, ey = f[1] - py;
        if (Math.abs(ex) < tol * 0.5 && Math.abs(ey) < tol * 0.5) return [lon, lat];
        const h = 1e-3;
        const fx = p([lon + h, lat]), fy = p([lon, clamp(lat + h, -89.999, 89.999)]);
        if (!fx || !fy || !isFinite(fx[0]) || !isFinite(fy[0])) return null;
        const a = (fx[0] - f[0]) / h, b = (fy[0] - f[0]) / h, c = (fx[1] - f[1]) / h, d = (fy[1] - f[1]) / h;
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-12) return null;
        let dl = (d * ex - b * ey) / det, dp = (-c * ex + a * ey) / det;
        const m = Math.max(Math.abs(dl), Math.abs(dp));
        if (m > 20) { dl *= 20 / m; dp *= 20 / m; }
        lon -= dl; lat = clamp(lat - dp, -89.999, 89.999);
        if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
      }
      return null;
    };
    const prev = (morphing || seedP) && this.morphGrid && this.morphGrid.gw === gw && this.morphGrid.gh === gh ? this.morphGrid.grid : null;
    const mask = seedP ? this.outlineMask(p, w, h, res) : null;
    const outside = (x, y) => !!mask && mask[(Math.min(h - 1, y | 0) * w + Math.min(w - 1, x | 0)) * 4 + 3] === 0;
    const node = (k) => (k >= 0 && grid[k] === grid[k] ? [grid[k], grid[k + 1]] : null);
    const blendInv = (x, y, seeds) => {
      if (outside(x, y)) return null;
      for (const s of seeds) if (s) { const r = seeded(x, y, s); if (r) return r; }
      const s = seedP.invert([x / res, y / res]);
      const r = s && isFinite(s[0]) && isFinite(s[1]) ? seeded(x, y, s) : null;
      return r || (mask ? exactInv(x, y) : null);
    };
    const inv = (x, y, k, i = 0, j = 0) => {
      const hasPrev = prev && k !== undefined && prev[k] === prev[k];
      if (seedP) return blendInv(x, y, [hasPrev ? [prev[k], prev[k + 1]] : null, i > 0 ? node(k - 2) : null, j > 0 ? node(k - gw * 2) : null]);
      if (!morphing) return exactInv(x, y);
      let seed = null;
      if (hasPrev) seed = [prev[k], prev[k + 1]];
      else if (this.morph.from.invert) { const s = this.morph.from.invert([x / res, y / res]); if (s && isFinite(s[0])) seed = s; }
      if (!seed && this.morph.to.invert) { const s = this.morph.to.invert([x / res, y / res]); if (s && isFinite(s[0])) seed = s; }
      return seed ? seeded(x, y, seed) : null;
    };
    const t0 = performance.now();
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = (j * gw + i) * 2;
      const ll = inv(i * step, j * step, k, i, j);
      if (ll) { grid[k] = ll[0]; grid[k + 1] = ll[1]; } else { grid[k] = NaN; grid[k + 1] = NaN; }
    }
    if (morphing || seedP) this.morphGrid = { gw, gh, grid }; else this.morphGrid = null;
    const exactIdx = [];
    if (!morphing) for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = (j * gw + i) * 2, b = a + 2, c = a + gw * 2, d = c + 2;
      const lons = [grid[a], grid[b], grid[c], grid[d]], lats = [grid[a + 1], grid[b + 1], grid[c + 1], grid[d + 1]];
      let bad = false, nan = 0;
      for (let q = 0; q < 4; q++) if (lons[q] !== lons[q]) nan++;
      if (nan === 4 && !(mask && (!outside(i * step, j * step) || !outside((i + 1) * step, j * step) || !outside(i * step, (j + 1) * step) || !outside((i + 1) * step, (j + 1) * step) || !outside((i + 0.5) * step, (j + 0.5) * step)))) continue;
      if (nan > 0) bad = true;
      if (!bad) {
        const lo = Math.min(...lons), hi = Math.max(...lons), la = Math.min(...lats), lb = Math.max(...lats);
        if (hi - lo > 60 || lb - la > 30 || lb > 85 || la < -85) bad = !(closeLL(lons[0], lats[0], lons[3], lats[3]) && closeLL(lons[1], lats[1], lons[2], lats[2]));
      }
      if (bad) exactIdx.push(j * (gw - 1) + i);
    }
    const exactLL = new Float32Array(exactIdx.length * step * step * 2);
    for (let e = 0; e < exactIdx.length; e++) {
      const cell = exactIdx[e], cy = Math.floor(cell / (gw - 1)), cx = cell % (gw - 1), base = (cy * gw + cx) * 2;
      const corners = seedP ? [node(base), node(base + 2), node(base + gw * 2), node(base + gw * 2 + 2)] : null;
      let last = null;
      for (let ly = 0; ly < step; ly++) for (let lx = 0; lx < step; lx++) {
        const x = cx * step + lx + 0.5, y = cy * step + ly + 0.5;
        const ll = seedP ? blendInv(x, y, [last, ...corners]) : inv(x, y, base);
        if (ll) last = ll;
        const k = (e * step * step + ly * step + lx) * 2;
        if (ll) { exactLL[k] = ll[0]; exactLL[k + 1] = ll[1]; } else { exactLL[k] = NaN; exactLL[k + 1] = NaN; }
      }
    }
    const gridMs = performance.now() - t0;
    const pxPerDeg = (p.scale ? p.scale() : 100) * Math.PI / 180 * res;
    const srcPxPerDeg = this.basemap.width / 360;
    let mip = 0;
    while (mip < 3 && srcPxPerDeg / Math.pow(2, mip + 1) >= pxPerDeg * 1.2) mip++;
    const id = ++this.jobId;
    this.lastJobAt = performance.now();
    const n = this.workers.length;
    const bands = [];
    for (let i = 0; i < n; i++) bands.push([Math.floor((h * i) / n), Math.floor((h * (i + 1)) / n)]);
    this.jobRunning = { id, w, h, res, step, key: this.stateKey(), base: this.baseKey(), scale: p.scale ? p.scale() : 1, translate: p.translate ? p.translate() : [0, 0], parts: n, done: 0, t0: performance.now(), gridMs, buffer: new Uint8ClampedArray(w * h * 4), exact: exactIdx.length, mip };
    const exactIdxArr = Int32Array.from(exactIdx);
    this.workers.forEach((wk, i) => {
      wk.postMessage({ type: "job", id, w, h, y0: bands[i][0], y1: bands[i][1], step, gw, gh, grid, exactIdx: exactIdxArr, exactLL, mip, shade: this.opts.hillshade });
    });
  }

  onWorker(m) {
    const j = this.jobRunning;
    if (!j || m.id !== j.id) return;
    j.buffer.set(m.data, m.y0 * j.w * 4);
    j.done++;
    if (j.done < j.parts) return;
    this.rasterCanvas.width = j.w; this.rasterCanvas.height = j.h;
    this.rasterCtx.putImageData(new ImageData(j.buffer, j.w, j.h), 0, 0);
    const ms = performance.now() - j.t0;
    this.rasterTimes.push({ ms, gridMs: j.gridMs, res: j.res, exact: j.exact, mip: j.mip, w: j.w, h: j.h });
    if (this.rasterTimes.length > 60) this.rasterTimes.shift();
    this.rasterInfo = { key: j.key, base: j.base, res: j.res, w: j.w, h: j.h, scale: j.scale, translate: j.translate };
    this.jobRunning = null;
    if (this.jobPending) { this.jobPending = false; this.requestRaster(); }
    this.invalidate();
  }

  frameStats() {
    const a = this.frameTimes;
    if (!a.length) return { n: 0 };
    const s = a.slice().sort((x, y) => x - y);
    const r = this.rasterTimes;
    return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: s[Math.floor(s.length / 2)], max: s[s.length - 1], raster: r.length ? r[r.length - 1] : null };
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.rasterTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    clearTimeout(this.touchTimer);
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.labelLayer.dispose();
    this.canvas.width = this.canvas.height = 0;
    this.rasterCanvas.width = this.rasterCanvas.height = 0;
    this.canvas.remove();
  }
}

const COS_CELL = Math.cos(5 * Math.PI / 180);
function closeLL(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180, c1 = Math.cos(lat1 * r), c2 = Math.cos(lat2 * r);
  return c1 * c2 * Math.cos((lon1 - lon2) * r) + Math.sin(lat1 * r) * Math.sin(lat2 * r) > COS_CELL;
}

export function sampleField(projection, width, height, step, fn, { x0 = 0, y0 = 0, x1 = width, y1 = height } = {}) {
  const gw = Math.max(1, Math.ceil((x1 - x0) / step)), gh = Math.max(1, Math.ceil((y1 - y0) / step));
  const values = new Float32Array(gw * gh);
  let min = Infinity, max = -Infinity;
  const tol = step * 0.75 + 0.5;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const x = x0 + (i + 0.5) * step, y = y0 + (j + 0.5) * step;
    let v = NaN;
    const ll = projection.invert ? projection.invert([x, y]) : null;
    if (ll && isFinite(ll[0]) && isFinite(ll[1]) && Math.abs(ll[1]) <= 89.9) {
      const back = projection(ll);
      if (back && Math.abs(back[0] - x) <= tol && Math.abs(back[1] - y) <= tol) v = fn(((ll[0] + 540) % 360) - 180, ll[1]);
    }
    values[j * gw + i] = v;
    if (v === v) { if (v < min) min = v; if (v > max) max = v; }
  }
  return { gw, gh, step, x0, y0, values, min, max };
}

const fieldCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;

export function drawField(ctx, field, colourAt, { alpha = 0.78 } = {}) {
  if (!fieldCanvas || !field) return;
  const { gw, gh, step, x0, y0, values } = field;
  if (fieldCanvas.width !== gw || fieldCanvas.height !== gh) { fieldCanvas.width = gw; fieldCanvas.height = gh; }
  const fctx = fieldCanvas.getContext("2d");
  const img = fctx.createImageData(gw, gh);
  const d = img.data;
  for (let k = 0; k < values.length; k++) {
    const v = values[k];
    if (v !== v) continue;
    const c = colourAt(v);
    d[k * 4] = c[0]; d[k * 4 + 1] = c[1]; d[k * 4 + 2] = c[2]; d[k * 4 + 3] = 255;
  }
  fctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fieldCanvas, x0, y0, gw * step, gh * step);
  ctx.restore();
}

export function contourPaths(field, thresholds) {
  const { gw, gh, step, x0, y0, values } = field;
  const vals = Array.from(values, (v) => (v === v ? v : NaN));
  const out = [];
  for (const level of thresholds) {
    const p2 = new Path2D();
    let any = false;
    const at = (i, j) => { const v = vals[j * gw + i]; return v; };
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      if (a !== a || b !== b || c !== c || d !== d) continue;
      const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const px = (i + 0.5) * step + x0, py = (j + 0.5) * step + y0;
      const t = (u, v) => (level - u) / (v - u);
      const top = [px + step * t(a, b), py], right = [px + step, py + step * t(b, c)], bottom = [px + step * t(d, c), py + step], left = [px, py + step * t(a, d)];
      const segs = [];
      switch (idx) {
        case 1: case 14: segs.push([left, bottom]); break;
        case 2: case 13: segs.push([bottom, right]); break;
        case 3: case 12: segs.push([left, right]); break;
        case 4: case 11: segs.push([top, right]); break;
        case 5: segs.push([top, left], [bottom, right]); break;
        case 10: segs.push([top, right], [left, bottom]); break;
        case 6: case 9: segs.push([top, bottom]); break;
        case 7: case 8: segs.push([top, left]); break;
      }
      for (const [p, q] of segs) { p2.moveTo(p[0], p[1]); p2.lineTo(q[0], q[1]); any = true; }
    }
    if (any) out.push({ value: level, path: p2 });
  }
  return out;
}

export function colourLUT(colourAt, n = 256) {
  const lut = [];
  for (let i = 0; i < n; i++) lut.push(colourAt(i / (n - 1)));
  return (t) => lut[Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))];
}

export function drawLegend(ctx, { x, y, w = 160, h = 10, colourAt, ticks = [], title = "", mono = "500 10px JetBrains Mono, ui-monospace, monospace", ink = "#3f3c37", ink2 = "#6b665e", bg = "rgba(250,248,243,.72)" } = {}) {
  const padX = 12, padY = 10;
  const bw = w + padX * 2, bh = h + 38 + padY;
  ctx.save();
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(227,222,211,.9)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = mono;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = ink2;
  ctx.fillText(title.toUpperCase(), x + padX, y + padY + 8);
  const gy = y + padY + 16;
  for (let i = 0; i < w; i++) {
    const c = colourAt(i / (w - 1));
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(x + padX + i, gy, 1.5, h);
  }
  ctx.strokeStyle = "rgba(60,52,40,.3)";
  ctx.strokeRect(x + padX + 0.5, gy + 0.5, w - 1, h - 1);
  ctx.fillStyle = ink;
  for (const tk of ticks) {
    const tx = x + padX + tk.t * w;
    ctx.fillStyle = "rgba(60,52,40,.6)";
    ctx.fillRect(Math.round(tx), gy + h, 1, 4);
    ctx.fillStyle = ink;
    ctx.textAlign = tk.t <= 0.02 ? "left" : tk.t >= 0.98 ? "right" : "center";
    ctx.fillText(tk.label, tx, gy + h + 16);
  }
  ctx.restore();
  return { w: bw, h: bh };
}

export function ellipsePath(ctx, e, scale = 1) {
  ctx.beginPath();
  ctx.ellipse(e.x, e.y, Math.max(0.1, e.rx * scale), Math.max(0.1, e.ry * scale), e.angle, 0, Math.PI * 2);
}

export const FONT_UI = '"Inter Variable", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

export function smallCircle(lon, lat, radiusDeg, n = 48) {
  return d3.geoCircle().center([lon, lat]).radius(Math.max(1e-6, radiusDeg)).precision(360 / n)().coordinates[0];
}

export function onVisibleSide(projection, lon, lat, margin = 0) {
  const ca = projection && projection.clipAngle ? projection.clipAngle() : null;
  if (!ca) return true;
  const r = projection.rotate ? projection.rotate() : [0, 0, 0];
  return d3.geoDistance([lon, lat], [-r[0], -r[1]]) * 180 / Math.PI <= ca - margin;
}

export function drawCaption(ctx, x, y, lines, { accent = palette.ui.signal, bg = "rgba(250,248,243,.78)", maxWidth = 420, align = "left" } = {}) {
  const [title, ...rest] = lines.filter(Boolean);
  if (!title) return { w: 0, h: 0 };
  ctx.save();
  const T = ctx.getTransform();
  const stageW = ctx.canvas.width / (Math.hypot(T.a, T.b) || 1);
  const room = (align === "right" ? x : stageW - x) - 8 - 28;
  const limit = Math.max(120, Math.min(maxWidth, room));
  const wrap = (text, font) => {
    ctx.font = font;
    if (ctx.measureText(text).width <= limit) return [text];
    const out = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? cur + " " + word : word;
      if (cur && ctx.measureText(next).width > limit) { out.push(cur); cur = word; }
      else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const titleFont = `600 13px ${FONT_UI}`, bodyFont = `400 12px ${FONT_UI}`;
  const heads = wrap(title, titleFont);
  const body = rest.flatMap((l) => wrap(l, bodyFont));
  let w = 0;
  ctx.font = titleFont;
  for (const l of heads) w = Math.max(w, ctx.measureText(l).width);
  ctx.font = bodyFont;
  for (const l of body) w = Math.max(w, ctx.measureText(l).width);
  w = Math.min(limit, w) + 28;
  const h = 18 + 16 * heads.length + body.length * 17;
  if (align === "right") x -= w;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(227,222,211,.95)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillRect(x + 10, y + 12, 2, h - 24);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = titleFont;
  ctx.fillStyle = palette.ui.ink;
  heads.forEach((l, i) => ctx.fillText(l, x + 18, y + 22 + i * 16, limit));
  ctx.font = bodyFont;
  ctx.fillStyle = palette.ui.ink2;
  const top = y + 22 + 16 * heads.length + 2;
  body.forEach((l, i) => ctx.fillText(l, x + 18, top + i * 17, limit));
  ctx.restore();
  return { w, h };
}

const FAMILY_LABEL = { cylindrical: "Cylindrical", conic: "Conic", azimuthal: "Azimuthal", pseudo: "Pseudocylindrical", polyhedral: "Polyhedral", other: "Other" };
const PROPERTY_LABEL = { conformal: "keeps angles", "equal-area": "keeps area", equidistant: "true along some lines", compromise: "shares the error", perspective: "a light through the globe" };

export function projectionOptions(filter = () => true) {
  return [...projRegistry.values()].filter(filter).map((e) => ({ value: e.id, label: e.name, group: FAMILY_LABEL[e.family] || e.family, description: PROPERTY_LABEL[e.property] || e.property }));
}

export function factorField(projection, { width, height, step = 4, latMax = 89.9, inside = null } = {}) {
  const gw = Math.max(1, Math.ceil(width / step)), gh = Math.max(1, Math.ceil(height / step));
  const n = gw * gh;
  const out = { gw, gh, step, x0: 0, y0: 0, h: new Float32Array(n), k: new Float32Array(n), area: new Float32Array(n), omega: new Float32Array(n), lon: new Float32Array(n), lat: new Float32Array(n), range: {} };
  const tol = step * 0.75 + 0.5;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const q = j * gw + i;
    const x = (i + 0.5) * step, y = (j + 0.5) * step;
    let f = null, ll = null;
    if (projection.invert && (!inside || inside(x, y))) {
      ll = projection.invert([x, y]);
      if (ll && isFinite(ll[0]) && isFinite(ll[1]) && Math.abs(ll[1]) <= latMax && onVisibleSide(projection, ll[0], ll[1], 0.5)) {
        const back = projection(ll);
        if (back && Math.abs(back[0] - x) <= tol && Math.abs(back[1] - y) <= tol) f = projFactors(projection, ll[0], ll[1]);
      }
    }
    if (f && isFinite(f.h) && isFinite(f.k)) {
      out.h[q] = f.h; out.k[q] = f.k; out.area[q] = f.areaScale; out.omega[q] = f.omega; out.lon[q] = ll[0]; out.lat[q] = ll[1];
    } else {
      out.h[q] = out.k[q] = out.area[q] = out.omega[q] = out.lon[q] = out.lat[q] = NaN;
    }
  }
  for (const key of ["h", "k", "area", "omega"]) {
    let lo = Infinity, hi = -Infinity;
    for (const v of out[key]) if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    out.range[key] = [lo, hi];
  }
  return out;
}

export function fieldImage(values, gw, gh, colourAt, canvas = null) {
  if (typeof document === "undefined") return null;
  const c = canvas || document.createElement("canvas");
  if (c.width !== gw || c.height !== gh) { c.width = gw; c.height = gh; }
  const g = c.getContext("2d");
  const img = g.createImageData(gw, gh);
  const d = img.data;
  for (let q = 0; q < values.length; q++) {
    const v = values[q];
    if (v !== v) continue;
    const col = colourAt(v);
    d[q * 4] = col[0]; d[q * 4 + 1] = col[1]; d[q * 4 + 2] = col[2]; d[q * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function contourSegments(values, gw, gh, step, level, { x0 = 0, y0 = 0, quantum = 1e-5 } = {}) {
  const at = (i, j) => { const v = values[j * gw + i]; return v === v ? Math.round(v / quantum) * quantum : NaN; };
  const segs = [];
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    if (a !== a || b !== b || c !== c || d !== d) continue;
    const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const px = (i + 0.5) * step + x0, py = (j + 0.5) * step + y0;
    const t = (u, v) => (u === v ? 0.5 : (level - u) / (v - u));
    const top = [px + step * t(a, b), py], right = [px + step, py + step * t(b, c)], bottom = [px + step * t(d, c), py + step], left = [px, py + step * t(a, d)];
    switch (idx) {
      case 1: case 14: segs.push([left, bottom]); break;
      case 2: case 13: segs.push([bottom, right]); break;
      case 3: case 12: segs.push([left, right]); break;
      case 4: case 11: segs.push([top, right]); break;
      case 5: segs.push([top, left], [bottom, right]); break;
      case 10: segs.push([top, right], [left, bottom]); break;
      case 6: case 9: segs.push([top, bottom]); break;
      case 7: case 8: segs.push([top, left]); break;
    }
  }
  return segs;
}

export function contourLabelSpots(segs, { taken = [], minGap = 150, max = 4, inside = () => true } = {}) {
  const out = [];
  for (let s = 0; s < segs.length && out.length < max; s += 7) {
    const [p, q] = segs[s];
    const x = (p[0] + q[0]) / 2, y = (p[1] + q[1]) / 2;
    if (!inside(x, y)) continue;
    if (taken.some((t) => Math.hypot(t[0] - x, t[1] - y) < minGap)) continue;
    let ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    out.push([x, y, ang]);
    taken.push([x, y]);
  }
  return out;
}

export const EARTH_R_KM = 6371.0088;

export const geo = {
  area: (f) => d3.geoArea(f),
  areaKm2: (f) => d3.geoArea(f) * EARTH_R_KM * EARTH_R_KM,
  centroid: (f) => d3.geoCentroid(f),
  contains: (f, ll) => d3.geoContains(f, ll),
  distance: (a, b) => d3.geoDistance(a, b),
  interpolate: (a, b) => d3.geoInterpolate(a, b),
  bounds: (f) => d3.geoBounds(f),
  pathArea: (projection, f) => d3.geoPath(projection).area(f),
  pathBounds: (projection, f) => d3.geoPath(projection).bounds(f),
  pathCentroid: (projection, f) => d3.geoPath(projection).centroid(f),
  path2D: (projection, f) => { const p = new Path2D(); d3.geoPath(projection, p)(f); return p; },
  rotation: (angles) => d3.geoRotation(angles),
  merge: (topology, objectName, keep) => d3.topojson.merge(topology, topology.objects[objectName].geometries.filter(keep)),
  features: (topology, objectName) => d3.topojson.feature(topology, topology.objects[objectName]),
  mesh: (topology, objectName, filter) => d3.topojson.mesh(topology, topology.objects[objectName], filter),
};

export function mover(from, to) {
  const dl = to[0] - from[0];
  const a = d3.geoRotation([-to[0], -from[1]]);
  const b = d3.geoRotation([-to[0], -to[1]]);
  return (pt) => b.invert(a([pt[0] + dl, pt[1]]));
}

export function mapCoords(geometry, fn) {
  const walk = (c, depth) => (depth === 0 ? fn(c) : c.map((x) => walk(x, depth - 1)));
  const depthOf = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };
  if (!geometry) return geometry;
  if (geometry.type === "Feature") return { ...geometry, geometry: mapCoords(geometry.geometry, fn) };
  if (geometry.type === "FeatureCollection") return { ...geometry, features: geometry.features.map((f) => mapCoords(f, fn)) };
  if (geometry.type === "GeometryCollection") return { ...geometry, geometries: geometry.geometries.map((g) => mapCoords(g, fn)) };
  return { ...geometry, coordinates: walk(geometry.coordinates, depthOf[geometry.type]) };
}

export function moveFeature(feature, from, to) {
  return mapCoords(feature, mover(from, to));
}

export function dom(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "style") { for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk.startsWith("--") ? sk : sk.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), sv); }
    else if (k === "text") el.textContent = v;
    else if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function indicatrixGrid(spacing = 30, latMax = 60) {
  const pts = [];
  for (let lat = -latMax; lat <= latMax + 1e-9; lat += spacing) for (let lon = -180 + spacing; lon < 180 - 1e-9; lon += spacing) pts.push([lon, lat]);
  return pts;
}

export function drawIndicatrices(ctx, projection, { points = indicatrixGrid(), radius = 3, color = palette.ui.signal, fill = "rgba(29,99,168,.2)", scale = () => 1, alpha = 1, maxPx = 2000, tol = 0.25 } = {}) {
  ctx.save();
  ctx.lineJoin = "round";
  for (const [lon, lat] of points) {
    const s = scale(lon, lat);
    if (s <= 0.001 || !onVisibleSide(projection, lon, lat, radius)) continue;
    const e = projTissot(projection, lon, lat, radius);
    const f = projFactors(projection, lon, lat);
    if (!e || !f || !isFinite(e.rx) || e.rx > maxPx) continue;
    ellipsePath(ctx, e, s);
    const conformal = f.omega < tol;
    ctx.globalAlpha = alpha;
    if (fill && !conformal) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = "rgba(250,248,243,.55)";
    ctx.lineWidth = 2.6;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = conformal ? 1.4 : 1.1;
    ctx.stroke();
  }
  ctx.restore();
}

export function fitCircle(points) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of points) { sx += x; sy += y; n++; }
  const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const [x, y] of points) {
    const u = x - mx, v = y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const det = suu * svv - suv * suv;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const cx = uc + mx, cy = vc + my;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let worst = 0;
  for (const [x, y] of points) worst = Math.max(worst, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return { cx, cy, r, residual: worst };
}

const INTERRUPT_RAWS = { homolosine: () => d3.geoHomolosineRaw, sinusoidal: () => d3.geoSinusoidalRaw, mollweide: () => d3.geoMollweideRaw };

export function interruptedAt(rawName, lobes, t = 1, { rotate = [0, 0, 0], centre = 0 } = {}) {
  const lobesT = lobes.map((hemi) => hemi.map(([a, c, b]) => [a, [centre + (c[0] - centre) * t, c[1]], b]));
  return d3.geoInterrupt(INTERRUPT_RAWS[rawName](), lobesT).rotate(rotate).precision(0.3);
}
