import { tracks, lessonsOfTrack } from "@/core/registry.js";

export const meta = {
  id: "start",
  title: "Course contents",
  track: 1,
  order: 0,
  mode: "2d",
  renderer: "canvas2d",
  projectionId: "equalEarth",
  labels: false,
  paragraph: "Every flat map bends the round Earth. This course shows how, in seven parts. Start with part 1, or select a lesson in the contents.",
  deeper: [],
  keywords: ["start", "contents", "course", "lessons"],
  controls: [],
  readouts: [],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const CSS = `
.toc { overflow-y: auto; overscroll-behavior: contain; background: var(--bg); padding: 28px 32px 40px; }
.toc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 28px 32px; max-width: 1180px; margin: 0 auto; }
.toc-part { border-top: 2px solid var(--ink); padding-top: 10px; }
.toc-num { font: 600 11px/14px var(--font-ui); letter-spacing: .08em; text-transform: uppercase; color: var(--brass); }
.toc-title { margin: 4px 0 2px; font: 600 22px/27px var(--font-serif); color: var(--ink); letter-spacing: -.01em; }
.toc-blurb { margin: 0 0 10px; font: 400 14px/20px var(--font-ui); color: var(--ink-2); }
.toc-list { list-style: none; margin: 0; padding: 0; }
.toc-row { display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 5px 6px; margin: 0 -6px; border: 0; border-radius: 6px; background: none; color: var(--ink-2); font: 400 14px/19px var(--font-ui); text-align: left; cursor: pointer; }
.toc-row:hover { background: var(--panel-2); color: var(--ink); }
.toc-row:focus-visible { outline: none; box-shadow: var(--focus); }
.toc-row .toc-n { flex: none; width: 18px; font: 500 11px/19px var(--font-mono); color: var(--ink-4); text-align: right; }
.toc-row .toc-t { flex: 1; min-width: 0; }
.toc-row .toc-seen { flex: none; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--ink-4); align-self: center; }
.toc-row[data-state="visited"] .toc-seen { background: var(--ink-3); border-color: var(--ink-3); }
.toc-row[data-state="done"] .toc-seen { background: var(--brass); border-color: var(--brass); }
@media (max-width: 760px) { .toc { padding: 18px 18px 28px; } .toc-grid { gap: 22px; } .toc-title { font-size: 20px; line-height: 25px; } }
`;

export function contents(skip = meta.id) {
  return tracks.map((t) => ({ id: t.id, title: t.title, blurb: t.blurb, lessons: lessonsOfTrack(t.id).filter((l) => l.id !== skip).map((l) => ({ id: l.id, title: l.title })) }));
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export async function mount(ctx) {
  const panel = ctx.stage.element("div", "toc");
  panel.append(el("style", "", CSS));
  const grid = el("div", "toc-grid");
  const rows = [];
  for (const part of contents()) {
    const sec = el("section", "toc-part");
    sec.append(el("div", "toc-num", "Part " + part.id), el("h2", "toc-title", part.title), el("p", "toc-blurb", part.blurb));
    const list = el("ol", "toc-list");
    part.lessons.forEach((l, i) => {
      const b = el("button", "toc-row");
      b.type = "button";
      b.dataset.id = l.id;
      b.append(el("span", "toc-n", String(i + 1)), el("span", "toc-t", l.title), el("i", "toc-seen"));
      b.addEventListener("click", () => ctx.course.open(l.id), { signal: ctx.signal });
      rows.push(b);
      const li = el("li");
      li.append(b);
      list.append(li);
    });
    sec.append(list);
    grid.append(sec);
  }
  panel.append(grid);
  for (const t of ["pointerdown", "pointerup", "pointermove", "dblclick", "wheel"]) panel.addEventListener(t, (e) => e.stopPropagation(), { signal: ctx.signal });
  const paint = () => { for (const b of rows) b.dataset.state = ctx.course.state(b.dataset.id); };
  paint();
  return {
    update() { paint(); },
    hover() { return []; },
    probe() { return null; },
    unprobe() {},
    resize() {},
    unmount() { panel.remove(); },
  };
}
