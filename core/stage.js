import { reducedMotion, dpr } from "@/core/env.js";
import { loop } from "@/core/anim.js";
import { h } from "@/core/ui.js";
import { Overlay } from "@/core/overlay.js";

const LAYER_METHODS = ["addLines", "addPolygons", "addPoints", "addMesh", "addLayer", "addFeatures"];
const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? 0 : ms));

const libs = { globe: null, map: null };
async function loadLib(kind) {
  if (libs[kind]) return libs[kind];
  libs[kind] = (async () => {
    try {
      if (kind === "globe") { const m = await import("@/core/globe.js"); return m.Globe || null; }
      const m = await import("@/core/map2d.js");
      return m.Map2D || null;
    } catch (e) {
      return null;
    }
  })();
  return libs[kind];
}

function releaseCanvases(el) {
  const list = el.tagName === "CANVAS" ? [el] : Array.from(el.querySelectorAll("canvas"));
  for (const c of list) { c.width = 0; c.height = 0; }
}

function placeholderSvg() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 200 200");
  s.setAttribute("class", "stage-empty-art");
  s.innerHTML = '<g fill="none" stroke="#3f3c37" stroke-width="1" stroke-linecap="round"><circle cx="100" cy="100" r="80"/><ellipse cx="100" cy="100" rx="40" ry="80"/><ellipse cx="100" cy="100" rx="69" ry="80"/><path d="M20 100h160"/><path d="M31 60c38 14 100 14 138 0M31 140c38-14 100-14 138 0M48 30c30 8 74 8 104 0M48 170c30-8 74-8 104 0"/></g>';
  return s;
}

export class Stage {
  constructor(el, hooks = {}) {
    this.el = el;
    this.hooks = hooks;
    this.mode = "3d";
    this.split = 0.5;
    this.compareOn = false;
    this.lessonId = null;
    this.gen = 0;
    this.views = {};
    for (const side of ["A", "B"]) {
      const view = h("div", { class: "stage-view side-" + side, dataset: { side } });
      el.append(view);
      this.views[side] = { side, el: view, kind: null, key: null, inst: null, ids: new Set(), customPick: null, customProject: null, lastState: null };
    }
    this.empty = h("div", { class: "stage-empty" }, placeholderSvg(), h("div", { class: "stage-empty-text" }));
    el.append(this.empty);
    this.overlay = new Overlay(el);
    this.divider = h("div", { class: "split-divider", role: "separator", "aria-orientation": "vertical" }, h("i", { class: "split-grip" }));
    el.append(this.divider);
    this.transportEl = h("div", { class: "transport hidden" });
    el.append(this.transportEl);
    this.overlay.setProjector((lon, lat, side) => this.project(lon, lat, side || "A"));
    this.overlay.clip = (side) => {
      if (!this.compareOn) return null;
      const x = this.width * this.split;
      return side === "B" ? [x, this.width] : [0, x];
    };
    this.overlay.insetBottom = () => this.insetBottom;
    this.width = 0;
    this.height = 0;
    this._bindPointer();
    this._bindDivider();
    this._frame = () => {
      if (this.compareOn) this._syncCompare();
      if (this.overlay.items.size && !this.views.A.inst) this.overlay.update();
      for (const v of Object.values(this.views)) if (v.inst && (v.inst.raf || v.inst.inertia || (v.inst.animations && v.inst.animations.size))) { loop.invalidate(); break; }
    };
    loop.add(this._frame);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(el);
    this.resize();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    for (const v of Object.values(this.views)) if (v.inst && v.inst.resize) v.inst.resize();
    this.overlay.resize();
    if (this.hooks.onResize) this.hooks.onResize(this.width, this.height);
    loop.invalidate();
  }

  get insetBottom() {
    const t = this.transportEl;
    return t.classList.contains("hidden") ? 0 : Math.max(0, this.height - t.offsetTop);
  }

  get syncOn() {
    const c = this.meta && this.meta.compare;
    return !(c && c.sync === false);
  }

  setEmpty(on, text = "") {
    this.empty.classList.toggle("on", !!on);
    this.empty.querySelector(".stage-empty-text").textContent = text;
  }

  modeFor(meta, mode) {
    if (!meta) return this.mode;
    if (meta.mode === "2d") return "2d";
    if (meta.mode === "3d" || meta.mode === "split") return "3d";
    if (mode === "2d" || mode === "3d") return mode;
    return meta.defaultMode === "2d" ? "2d" : "3d";
  }

  kindFor(meta, mode) {
    if (!meta) return null;
    return this.modeFor(meta, mode) === "2d" ? "map" : "globe";
  }

  async prepare(meta, { initial = false, mode = null } = {}) {
    const gen = ++this.gen;
    this.lessonId = meta ? meta.id : null;
    this.meta = meta || null;
    this.mode = this.modeFor(meta, mode);
    const kind = this.kindFor(meta, this.mode);
    const key = kind ? [kind, meta.colour || "ramp", meta.light || "camera", meta.labels === undefined ? "" : String(meta.labels)].join("|") : null;
    await this._swap("A", kind, key, meta, { initial, gen });
    if (gen !== this.gen) return null;
    if (this.compareOn) await this._swap("B", kind, key, meta, { initial: true, gen });
    if (gen !== this.gen) return null;
    this.el.dataset.kind = kind || "";
    return this.views.A.inst;
  }

  async _swap(side, kind, key, meta, { initial, gen }) {
    const v = this.views[side];
    if (v.key === key && v.inst) {
      v.el.classList.remove("fade-out");
      if (kind === "map" && v.inst.setProjection) await v.inst.setProjection(meta.projectionId || meta.projection || "equirectangular", { duration: 0 });
      return v.inst;
    }
    if (v.inst || v.el.childElementCount) {
      if (!initial) {
        v.el.classList.add("fade-out");
        await wait(200);
        if (gen !== this.gen) return null;
      }
      this._disposeView(v);
    }
    if (!kind) return null;
    const Lib = await loadLib(kind);
    if (gen !== this.gen) return null;
    if (Lib) {
      const opts = { colour: meta.colour || "ramp", light: meta.light || "camera", labels: meta.labels === undefined ? kind === "map" : meta.labels };
      if (kind === "map") opts.projectionId = meta.projectionId || meta.projection || "equirectangular";
      try {
        v.inst = new Lib(v.el, opts);
        v.kind = kind;
        v.key = key;
        this._track(v);
        if (v.inst.ready && v.inst.ready.catch) v.inst.ready.catch(() => {});
      } catch (e) {
        v.inst = null;
      }
    }
    v.el.classList.remove("fade-out");
    if (!initial) {
      const el = v.el;
      el.classList.add("fade-in");
      setTimeout(() => el.classList.remove("fade-in"), 320);
    }
    loop.invalidate();
    return v.inst;
  }

  _track(v) {
    const inst = v.inst;
    for (const name of LAYER_METHODS) {
      if (typeof inst[name] !== "function") continue;
      const orig = inst[name].bind(inst);
      inst[name] = (id, ...rest) => { const r = orig(id, ...rest); v.ids.add(id); return r; };
    }
    if (typeof inst.remove === "function") {
      const orig = inst.remove.bind(inst);
      inst.remove = (id) => { v.ids.delete(id); return orig(id); };
    }
    if (typeof inst.render === "function") {
      const orig = inst.render.bind(inst);
      inst.render = (...args) => {
        const r = orig(...args);
        if (v.inst === inst) this.overlay.update(v.side);
        return r;
      };
    }
  }

  _disposeView(v) {
    if (v.inst) {
      try { if (v.inst.dispose) v.inst.dispose(); } catch (e) {}
    }
    v.inst = null;
    v.kind = null;
    v.key = null;
    v.ids.clear();
    v.customPick = null;
    v.customProject = null;
    v.lastState = null;
    releaseCanvases(v.el);
    v.el.replaceChildren();
    v.el.classList.remove("fade-out", "fade-in");
  }

  cleanup(lessonId, side, { layersOnly = false } = {}) {
    const prefix = lessonId + ":";
    for (const v of Object.values(this.views)) {
      if (side && v.side !== side) continue;
      if (v.inst && typeof v.inst.remove === "function") {
        for (const id of Array.from(v.ids)) if (id.startsWith(prefix)) { try { v.inst.remove(id); } catch (e) {} v.ids.delete(id); }
      }
      for (const child of Array.from(v.el.children)) if (child.dataset && child.dataset.lesson === lessonId) { releaseCanvases(child); child.remove(); }
      if (layersOnly) continue;
      if (v.inst && typeof v.inst.morph === "function" && v.inst.morphFn) { try { v.inst.morph(null, 0); } catch (e) {} }
      if (v.kind === "globe" && v.inst && v.inst.layers && v.inst.layers.surface === false) { try { v.inst.setLayer("surface", true); } catch (e) {} }
      v.customPick = null;
      v.customProject = null;
    }
    if (side) return;
    this.overlay.clear(prefix);
    if (layersOnly) return;
    this.overlay.hideChip();
    this.overlay.crosshair(false);
    this.el.classList.remove("armed");
  }

  side(name) {
    const stage = this;
    const v = this.views[name];
    const lessonId = this.lessonId;
    return {
      get el() { return v.el; },
      get width() { return stage.width; },
      get height() { return stage.height; },
      get dpr() { return dpr; },
      get insetBottom() { return stage.insetBottom; },
      get mode() { return stage.mode; },
      setMode(m) { return stage.hooks.onModeRequest ? stage.hooks.onModeRequest(m) : null; },
      get globe() { return v.kind === "globe" ? v.inst : null; },
      get map() { return v.kind === "map" ? v.inst : null; },
      get renderer() { return v.inst; },
      get overlay() { return stage.overlay; },
      side: name,
      canvas(cls = "") {
        const c = h("canvas", { class: "lesson-canvas " + cls, dataset: { lesson: lessonId } });
        v.el.append(c);
        return c;
      },
      element(tag = "div", cls = "") {
        const e = h(tag, { class: "lesson-layer " + cls, dataset: { lesson: lessonId } });
        v.el.append(e);
        return e;
      },
      setPicker(fn) { v.customPick = fn; },
      setProjector(fn) { v.customProject = fn; stage.overlay.update(); },
      pick(x, y) { return stage.pick(x, y, name); },
      project(lon, lat) { return stage.project(lon, lat, name); },
      invalidate() { loop.invalidate(); },
    };
  }

  pick(x, y, side) {
    const v = this.views[side || this.sideAt(x)];
    if (!v) return null;
    try {
      if (v.inst && typeof v.inst.pick === "function") return v.inst.pick(x, y);
      if (v.customPick) return v.customPick(x, y);
    } catch (e) {}
    return null;
  }

  project(lon, lat, side = "A") {
    const v = this.views[side];
    if (!v) return null;
    try {
      if (v.inst && typeof v.inst.project === "function") return v.inst.project(lon, lat);
      if (v.customProject) return v.customProject(lon, lat);
    } catch (e) {}
    return null;
  }

  sideAt(x) {
    return this.compareOn && x > this.width * this.split ? "B" : "A";
  }

  async setMode(mode, meta) {
    if (mode === this.mode) return false;
    await this.prepare(meta, { mode });
    return true;
  }

  async compare(on, meta) {
    on = !!on;
    if (on === this.compareOn) return;
    this.compareOn = on;
    this.el.classList.toggle("compare", on);
    this.el.style.setProperty("--split", (this.split * 100).toFixed(2) + "%");
    if (meta) this.meta = meta;
    if (on) {
      const a = this.views.A;
      await this._swap("B", a.kind, a.key, meta || {}, { initial: true, gen: this.gen });
      this._syncCompare(true);
    } else {
      this._disposeView(this.views.B);
    }
    this.overlay.update();
    loop.invalidate();
  }

  _state(inst) {
    try {
      if (inst.camera && typeof inst.camera.state === "function") return inst.camera.state();
      if (typeof inst.state === "function") return inst.state();
    } catch (e) {}
    return null;
  }

  _setState(inst, s) {
    try {
      if (inst.camera && typeof inst.camera.setState === "function") return inst.camera.setState(s);
      if (typeof inst.setState === "function") return inst.setState(s);
    } catch (e) {}
  }

  _syncCompare(force) {
    const a = this.views.A, b = this.views.B;
    if (!a.inst || !b.inst || !this.syncOn) return;
    const sa = JSON.stringify(this._state(a.inst)), sb = JSON.stringify(this._state(b.inst));
    if (sa === sb) { a.lastState = sa; b.lastState = sb; return; }
    if (force || sa !== a.lastState) { this._setState(b.inst, JSON.parse(sa)); b.lastState = sa; a.lastState = sa; }
    else if (sb !== b.lastState) { this._setState(a.inst, JSON.parse(sb)); a.lastState = sb; b.lastState = sb; }
  }

  viewState() {
    const inst = this.views.A.inst;
    return inst ? this._state(inst) : null;
  }

  setView(view, { duration = 0 } = {}) {
    const inst = this.views.A.inst;
    if (!inst || !view) return;
    try {
      if (inst.camera && typeof inst.camera.lookAt === "function") inst.camera.lookAt(view.lon, view.lat, view.dist ?? 2.9, { duration: reducedMotion ? 0 : duration });
      else if (typeof inst.setState === "function") inst.setState(view);
    } catch (e) {}
    loop.invalidate();
  }

  arm(on) {
    this.el.classList.toggle("armed", !!on);
    this.overlay.crosshair(!!on);
  }

  _bindPointer() {
    const el = this.el;
    let down = null;
    let dragging = false;
    let hoverTimer = 0;
    let lastMove = null;
    const pos = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const inTransport = (e) => e.target.closest && e.target.closest(".transport, .split-divider, .snack, .stage-empty-text");
    el.addEventListener("pointerdown", (e) => {
      if (inTransport(e) || e.button !== 0) return;
      down = { ...pos(e), t: performance.now() };
      dragging = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (inTransport(e)) { this.overlay.hideChip(); return; }
      const p = pos(e);
      lastMove = p;
      if (down && !dragging && (Math.abs(p.x - down.x) > 4 || Math.abs(p.y - down.y) > 4)) {
        dragging = true;
        this.overlay.hideChip();
        el.classList.add("dragging");
        loop.invalidate();
        if (this.hooks.onDragStart) this.hooks.onDragStart();
      }
      if (this.el.classList.contains("armed")) this.overlay.moveCrosshair(p.x, p.y);
      if (dragging) return;
      clearTimeout(hoverTimer);
      const side = this.sideAt(p.x);
      const ll = this.pick(p.x, p.y, side);
      if (this.hooks.onPointer) this.hooks.onPointer(ll, p, side);
      if (!ll) { this.overlay.hideChip(); return; }
      hoverTimer = setTimeout(() => { if (this.hooks.onHover) this.hooks.onHover(ll, p, side); }, 80);
    });
    const finish = (e) => {
      if (!down) return;
      const p = pos(e);
      const wasDrag = dragging;
      const dt = performance.now() - down.t;
      down = null;
      dragging = false;
      el.classList.remove("dragging");
      if (wasDrag) { if (this.hooks.onDragEnd) this.hooks.onDragEnd(); return; }
      if (dt > 600) return;
      const side = this.sideAt(p.x);
      const ll = this.pick(p.x, p.y, side);
      if (this.hooks.onClick) this.hooks.onClick(ll, p, side, e);
    };
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", () => { down = null; dragging = false; el.classList.remove("dragging"); });
    el.addEventListener("pointerleave", () => {
      clearTimeout(hoverTimer);
      this.overlay.hideChip();
      lastMove = null;
      if (this.hooks.onPointer) this.hooks.onPointer(null, null, "A");
    });
    el.addEventListener("dblclick", (e) => {
      if (inTransport(e)) return;
      const p = pos(e);
      const side = this.sideAt(p.x);
      const ll = this.pick(p.x, p.y, side);
      if (ll && this.hooks.onDblClick) this.hooks.onDblClick(ll, p, side);
    });
    let wheelTimer = 0;
    el.addEventListener("wheel", () => {
      this.overlay.hideChip();
      loop.invalidate();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => { if (this.hooks.onDragEnd) this.hooks.onDragEnd(); }, 250);
    }, { passive: true });
    this.lastPointer = () => lastMove;
  }

  _bindDivider() {
    const d = this.divider;
    let active = false;
    d.addEventListener("pointerdown", (e) => { active = true; d.setPointerCapture(e.pointerId); e.preventDefault(); });
    d.addEventListener("pointermove", (e) => {
      if (!active) return;
      const r = this.el.getBoundingClientRect();
      this.split = Math.min(0.85, Math.max(0.15, (e.clientX - r.left) / r.width));
      this.el.style.setProperty("--split", (this.split * 100).toFixed(2) + "%");
      this.overlay.update();
    });
    const end = () => { active = false; };
    d.addEventListener("pointerup", end);
    d.addEventListener("pointercancel", end);
    d.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      this.split = Math.min(0.85, Math.max(0.15, this.split + (e.key === "ArrowLeft" ? -0.02 : 0.02)));
      this.el.style.setProperty("--split", (this.split * 100).toFixed(2) + "%");
      this.overlay.update();
    });
    d.tabIndex = 0;
  }

  dispose() {
    loop.remove(this._frame);
    this.ro.disconnect();
    for (const v of Object.values(this.views)) this._disposeView(v);
    this.overlay.dispose();
  }
}
