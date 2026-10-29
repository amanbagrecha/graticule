import { reducedMotion } from "@/core/env.js";
import { h } from "@/core/ui.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
  return el;
};

export class Overlay {
  constructor(stageEl) {
    this.el = stageEl;
    this.svg = svgEl("svg", { class: "overlay-svg", "aria-hidden": "true" });
    this.html = h("div", { class: "overlay-html", "aria-hidden": "true" });
    this.chipEl = h("div", { class: "chip" });
    this.html.append(this.chipEl);
    stageEl.append(this.svg, this.html);
    this.items = new Map();
    this.projector = null;
    this.clip = null;
    this.inset = null;
    this.insetBottom = () => 0;
    this.width = 0;
    this.height = 0;
    this.resize();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.width = r.width;
    this.height = r.height;
    this.svg.setAttribute("viewBox", `0 0 ${Math.max(1, r.width)} ${Math.max(1, r.height)}`);
    this.update();
  }

  setProjector(fn) {
    this.projector = fn;
    this.update();
  }

  project(p, side) {
    let r = null;
    if (p && typeof p.x === "number") r = { x: p.x, y: p.y, visible: true };
    else if (p && typeof p.lon === "number" && this.projector) {
      const q = this.projector(p.lon, p.lat, side);
      r = q ? { x: q.x, y: q.y, visible: q.visible !== false && isFinite(q.x) && isFinite(q.y) } : null;
    }
    if (r && r.visible && side && this.clip) {
      const c = this.clip(side);
      if (c && (r.x < c[0] || r.x > c[1])) r.visible = false;
    }
    return r;
  }

  update(side) {
    if (!this.items.size) return;
    this.inset = null;
    for (const it of this.items.values()) if (!side || (it.side || "A") === side) this._place(it);
    this.inset = null;
  }

  _size(it, el) {
    if (!it.w) { it.w = el.offsetWidth; it.h = el.offsetHeight; }
    return [it.w, it.h];
  }

  _bounds(it) {
    const m = 4;
    const c = it.side && this.clip ? this.clip(it.side) : null;
    return { x0: (c ? c[0] : 0) + m, x1: (c ? c[1] : this.width) - m, y0: m, y1: this.height - this._inset() - m };
  }

  _inset() {
    if (this.inset === null) this.inset = Math.max(0, this.insetBottom() || 0);
    return this.inset;
  }

  _placePinLabel(it, s) {
    if (it.lab === undefined) it.lab = it.el.querySelector(".pin-label");
    const lab = it.lab;
    if (!lab) return;
    const [w, hh] = this._size(it, lab);
    if (!w) return;
    const b = this._bounds(it);
    let lx = 12;
    if (s.x + lx + w > b.x1 && s.x - 12 - w >= b.x0) lx = -12 - w;
    lx = Math.min(Math.max(lx, b.x0 - s.x), b.x1 - s.x - w);
    const ly = Math.min(Math.max(-8, b.y0 - s.y), b.y1 - s.y - hh);
    lab.style.left = lx.toFixed(1) + "px";
    lab.style.top = ly.toFixed(1) + "px";
  }

  _place(it) {
    if (it.kind === "pin") {
      const s = this.project(it.at, it.side);
      if (!s || !s.visible) { it.el.style.display = "none"; return; }
      it.el.style.display = "";
      it.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      this._placePinLabel(it, s);
    } else if (it.kind === "label") {
      const s = this.project(it.at, it.side);
      if (!s || !s.visible) { it.el.style.display = "none"; if (it.leader) it.leader.style.display = "none"; return; }
      it.el.style.display = "";
      const [w, hh] = this._size(it, it.el);
      const b = this._bounds(it);
      let x = s.x + it.dx, y = s.y + it.dy;
      if (w) {
        if (x + w > b.x1 && s.x - it.dx - w >= b.x0) x = s.x - Math.max(it.dx, 0) - w;
        else if (x < b.x0 && s.x - it.dx + w <= b.x1) x = s.x - Math.min(it.dx, 0);
        if (y + hh > b.y1 && s.y - it.dy - hh >= b.y0) y = s.y - Math.max(it.dy, 0) - hh;
        else if (y < b.y0 && s.y - it.dy + hh <= b.y1) y = s.y - Math.min(it.dy, 0);
        x = Math.min(Math.max(x, b.x0), b.x1 - w);
        y = Math.min(Math.max(y, b.y0), b.y1 - hh);
      }
      it.el.style.transform = `translate(${x}px, ${y}px)`;
      if (it.leader) {
        const ex = Math.min(Math.max(s.x + it.dx, x), x + w), ey = Math.min(Math.max(s.y + it.dy, y), y + hh);
        it.leader.style.display = "";
        it.leader.setAttribute("x1", s.x);
        it.leader.setAttribute("y1", s.y);
        it.leader.setAttribute("x2", ex);
        it.leader.setAttribute("y2", ey);
      }
    } else if (it.kind === "line") {
      let d = "";
      let pen = false;
      for (const p of it.points) {
        const s = this.project(p, it.side);
        if (!s || !s.visible) { pen = false; continue; }
        d += (pen ? "L" : "M") + s.x.toFixed(1) + " " + s.y.toFixed(1);
        pen = true;
      }
      it.el.setAttribute("d", d);
    }
  }

  _set(id, item) {
    this.remove(id);
    this.items.set(id, item);
    this.inset = null;
    this._place(item);
    return item;
  }

  pin(id, at, { color = "var(--signal)", label = "", size = 10, side = null } = {}) {
    const el = h("div", { class: "pin" }, h("i", { class: "pin-dot" }), h("i", { class: "pin-ring" }), label ? h("span", { class: "pin-label mono", text: label }) : null);
    el.style.setProperty("--pin", color);
    el.style.setProperty("--pin-size", size + "px");
    this.html.append(el);
    return this._set(id, { kind: "pin", at, el, side });
  }

  ripple(x, y, { color = "var(--signal)" } = {}) {
    if (reducedMotion) return;
    const c = svgEl("circle", { cx: x, cy: y, r: 0, fill: "none", stroke: color, "stroke-width": 1.5, class: "ripple" });
    this.svg.append(c);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - t0) / 500));
      const e = 1 - Math.pow(1 - k, 3);
      c.setAttribute("r", (24 * e).toFixed(1));
      c.setAttribute("opacity", (1 - k).toFixed(3));
      if (k < 1) requestAnimationFrame(step); else c.remove();
    };
    requestAnimationFrame(step);
  }

  chip(x, y, lines) {
    if (!lines || !lines.length) { this.hideChip(); return; }
    this.chipEl.replaceChildren(...lines.map((l) => h("div", { text: l })));
    this.chipEl.classList.add("on");
    const w = this.chipEl.offsetWidth, hh = this.chipEl.offsetHeight;
    let cx = x + 12, cy = y + 12;
    if (cx + w > this.width - 8) cx = x - 12 - w;
    if (cy + hh > this.height - 8) cy = y - 12 - hh;
    this.chipEl.style.transform = `translate(${Math.round(cx)}px, ${Math.round(cy)}px)`;
  }

  hideChip() {
    this.chipEl.classList.remove("on");
  }

  label(id, at, text, { color = "var(--signal)", leader = false, dx = 0, dy = 0, mono = true, side = null } = {}) {
    const el = h("div", { class: "ov-label" + (mono ? " mono" : ""), style: { color }, text });
    this.html.append(el);
    let leaderEl = null;
    if (leader && (dx || dy)) {
      leaderEl = svgEl("line", { stroke: color, "stroke-width": 1, opacity: 0.8 });
      this.svg.append(leaderEl);
    }
    return this._set(id, { kind: "label", at, el, leader: leaderEl, dx, dy, side });
  }

  line(id, points, { color = "var(--signal)", width = 1.5, dash = null, opacity = 1, side = null } = {}) {
    const el = svgEl("path", { fill: "none", stroke: color, "stroke-width": width, "stroke-dasharray": dash, opacity, "stroke-linecap": "round", "stroke-linejoin": "round" });
    this.svg.append(el);
    return this._set(id, { kind: "line", points, el, side });
  }

  move(id, at) {
    const it = this.items.get(id);
    if (!it) return;
    if (it.kind === "line") it.points = at; else it.at = at;
    this.inset = null;
    this._place(it);
  }

  has(id) { return this.items.has(id); }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    it.el.remove();
    if (it.leader) it.leader.remove();
    this.items.delete(id);
  }

  clear(prefix = "") {
    for (const id of Array.from(this.items.keys())) if (!prefix || id.startsWith(prefix)) this.remove(id);
    if (!prefix) this.hideChip();
  }

  crosshair(on) {
    if (on && !this.cross) {
      this.cross = svgEl("g", { class: "crosshair" });
      this.cross.append(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0 }), svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 0 }));
      this.svg.append(this.cross);
    } else if (!on && this.cross) {
      this.cross.remove();
      this.cross = null;
    }
  }

  moveCrosshair(x, y) {
    if (!this.cross) return;
    const [a, b] = this.cross.children;
    a.setAttribute("x1", 0); a.setAttribute("x2", this.width); a.setAttribute("y1", y); a.setAttribute("y2", y);
    b.setAttribute("y1", 0); b.setAttribute("y2", this.height); b.setAttribute("x1", x); b.setAttribute("x2", x);
  }

  dispose() {
    this.clear();
    this.svg.remove();
    this.html.remove();
  }
}
