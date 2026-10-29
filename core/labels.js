import { loadCities, loadLabels } from "@/core/data.js";

const STYLE = {
  city: "font:500 11px var(--font-ui, Inter, -apple-system, 'Segoe UI', sans-serif);color:var(--ink-2,#3f3c37);text-shadow:0 0 3px #f1ede4,0 0 3px #f1ede4,0 0 2px #f1ede4;",
  ocean: "font:500 11px var(--font-ui, Inter, -apple-system, 'Segoe UI', sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(60,52,40,.55);text-shadow:0 0 3px #f1ede4,0 0 3px #f1ede4;",
  continent: "font:600 12px var(--font-ui, Inter, -apple-system, 'Segoe UI', sans-serif);letter-spacing:.12em;text-transform:uppercase;color:rgba(50,46,40,.65);text-shadow:0 0 3px #f1ede4,0 0 3px #f1ede4;"
};

export async function defaultLabelItems(rankMax = 2) {
  const [cities, named] = await Promise.all([loadCities(), loadLabels()]);
  const items = [];
  for (const c of named.continents) items.push({ id: "continent:" + c.name, text: c.name, lon: c.lon, lat: c.lat, kind: "continent", rank: 0 });
  for (const o of named.oceans) items.push({ id: "ocean:" + o.name, text: o.name, lon: o.lon, lat: o.lat, kind: "ocean", rank: 1 });
  for (const c of cities) if (c.rank <= rankMax) items.push({ id: "city:" + c.name, text: c.name, lon: c.lon, lat: c.lat, kind: "city", rank: 2 + c.rank, dot: true });
  return items;
}

export class LabelLayer {
  constructor(parentEl) {
    this.el = document.createElement("div");
    this.el.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;";
    parentEl.appendChild(this.el);
    this.items = [];
    this.nodes = new Map();
    this.visible = true;
    this.pad = 4;
    this.avoid = null;
    this.width = 0; this.height = 0;
  }
  setItems(items) {
    this.items = items.slice().sort((a, b) => a.rank - b.rank);
    for (const n of this.nodes.values()) n.remove();
    this.nodes.clear();
    for (const it of this.items) {
      const n = document.createElement("div");
      n.style.cssText = "position:absolute;left:0;top:0;white-space:nowrap;will-change:transform;display:none;" + (STYLE[it.kind] || STYLE.city);
      n.textContent = it.text;
      if (it.dot) {
        const d = document.createElement("span");
        d.style.cssText = "display:inline-block;width:4px;height:4px;border-radius:2px;background:var(--ink-2,#3f3c37);margin-right:5px;vertical-align:middle;";
        n.prepend(d);
      }
      this.el.appendChild(n);
      this.nodes.set(it.id, n);
    }
    this.measure();
  }
  measure() {
    for (const it of this.items) {
      const n = this.nodes.get(it.id);
      n.style.display = "block";
      n.style.visibility = "hidden";
      const r = n.getBoundingClientRect();
      it.w = r.width; it.h = r.height;
      n.style.display = "none";
      n.style.visibility = "";
    }
  }
  setVisible(v) {
    this.visible = v;
    this.el.style.display = v ? "block" : "none";
  }
  update(project, width, height) {
    if (!this.visible) return;
    const placed = this.avoid ? this.avoid().map((r) => [r[0], r[1], r[2], r[3]]) : [];
    const pad = this.pad, edge = 2;
    for (const it of this.items) {
      const n = this.nodes.get(it.id);
      const p = project(it.lon, it.lat);
      if (!p || !p.visible || p.x < -it.w || p.y < -it.h || p.x > width + it.w || p.y > height + it.h) { n.style.display = "none"; continue; }
      let x, y;
      if (it.kind === "city") { x = p.x + 6; y = p.y - it.h / 2; }
      else { x = p.x - it.w / 2; y = p.y - it.h / 2; }
      const box = [x - pad, y - pad, x + it.w + pad, y + it.h + pad];
      let hit = x < edge || y < edge || x + it.w > width - edge || y + it.h > height - edge;
      for (const b of placed) if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) { hit = true; break; }
      if (hit) { n.style.display = "none"; continue; }
      placed.push(box);
      n.style.display = "block";
      n.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }
  dispose() { this.el.remove(); this.nodes.clear(); }
}
