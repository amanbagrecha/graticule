import { FONT_UI, FONT_MONO, drawCaption } from "@/core/map2d.js";
import { ui } from "@/core/palette.js";
import { interpolateViridis, rgb } from "d3";

export { FONT_UI, FONT_MONO, drawCaption };

export const INK = {
  ink: ui.ink, ink2: ui.ink2, ink3: ui.ink3, ink4: ui.ink4,
  brass: ui.brass, signal: ui.signal, violet: ui.violet, ok: ui.ok, warn: ui.warn, err: ui.err,
  panel: "rgba(255,255,255,.94)", line: ui.line, line2: ui.line2, halo: "rgba(250,248,243,.92)",
  grid: "rgba(60,52,40,.16)", gridMajor: "rgba(60,52,40,.30)",
};

export function fmtNum(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v < 0 && Number(s.replace(/,/g, "")) !== 0 ? "−" : "") + s;
}

export function fmtPlain(v, digits = 0) {
  return fmtNum(v, digits).replace(/,/g, "");
}

export function trimNum(v, maxDigits = 3) {
  if (!Number.isFinite(v)) return fmtNum(v);
  const s = fmtNum(v, maxDigits);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function pixelStage(ctx, { draw, cursor = "default", zIndex = 3 } = {}) {
  const canvas = ctx.stage.canvas("px-stage");
  canvas.style.zIndex = String(zIndex);
  canvas.style.touchAction = "none";
  canvas.style.cursor = cursor;
  const g = canvas.getContext("2d");
  const handlers = {};
  const signal = ctx.signal;
  const st = { canvas, g, W: 1, H: 1, dpr: ctx.stage.dpr, pointer: null, drag: null, handlers };
  let raf = 0;
  let disposed = false;

  st.size = () => {
    const W = Math.max(1, Math.round(ctx.stage.width)), H = Math.max(1, Math.round(ctx.stage.height));
    const dpr = ctx.stage.dpr;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    st.W = W; st.H = H; st.dpr = dpr;
  };
  st.render = () => {
    if (disposed) return;
    st.size();
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    draw(g, st.W, st.H);
  };
  st.request = () => {
    if (raf || disposed) return;
    raf = requestAnimationFrame(() => { raf = 0; st.render(); });
  };
  st.on = (name, fn) => { handlers[name] = fn; return st; };
  st.setCursor = (c) => { if (canvas.style.cursor !== c) canvas.style.cursor = c; };
  st.chip = (x, y, lines) => ctx.overlay.chip(x, y, lines);
  st.hideChip = () => ctx.overlay.hideChip();

  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const p = pos(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    const claim = handlers.down ? handlers.down(p.x, p.y, e) : null;
    st.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, moved: 0, claim, t: performance.now(), shift: e.shiftKey };
    st.hideChip();
  }, { signal });
  canvas.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    const p = pos(e);
    st.pointer = p;
    if (st.drag) {
      const d = st.drag;
      const dx = p.x - d.x, dy = p.y - d.y;
      d.moved += Math.abs(dx) + Math.abs(dy);
      d.x = p.x; d.y = p.y;
      d.shift = e.shiftKey;
      if (d.claim && handlers.drag) handlers.drag(d.claim, p.x, p.y, dx, dy, e);
      return;
    }
    if (handlers.move) handlers.move(p.x, p.y, e);
  }, { signal });
  const end = (e) => {
    e.stopPropagation();
    const d = st.drag;
    if (!d) return;
    st.drag = null;
    const p = pos(e);
    if (d.moved < 4 && performance.now() - d.t < 700) {
      if (d.claim && handlers.dragEnd) handlers.dragEnd(d.claim, p.x, p.y, false);
      if (handlers.click) handlers.click(p.x, p.y, e);
    } else if (d.claim && handlers.dragEnd) handlers.dragEnd(d.claim, p.x, p.y, true);
    if (handlers.move) handlers.move(p.x, p.y, e);
  };
  canvas.addEventListener("pointerup", end, { signal });
  canvas.addEventListener("pointercancel", end, { signal });
  canvas.addEventListener("pointerleave", (e) => {
    e.stopPropagation();
    if (st.drag) return;
    st.pointer = null;
    st.hideChip();
    if (handlers.leave) handlers.leave();
  }, { signal });
  canvas.addEventListener("dblclick", (e) => e.stopPropagation(), { signal });
  canvas.addEventListener("wheel", (e) => {
    e.stopPropagation();
    if (handlers.wheel) { e.preventDefault(); const p = pos(e); handlers.wheel(p.x, p.y, e.deltaY, e); }
  }, { signal, passive: false });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && handlers.escape) handlers.escape(); }, { signal });

  st.dispose = () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    st.hideChip();
    canvas.remove();
  };
  return st;
}

export function background(g, W, H) {
  const grad = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.72);
  grad.addColorStop(0, "#faf8f3");
  grad.addColorStop(1, "#f1ede4");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}

export function text(g, x, y, str, { color = INK.ink2, size = 11, weight = 500, mono = true, align = "left", baseline = "middle", halo = true } = {}) {
  g.font = `${weight} ${size}px ${mono ? FONT_MONO : FONT_UI}`;
  g.textAlign = align;
  g.textBaseline = baseline;
  if (halo) {
    g.lineJoin = "round";
    g.lineWidth = 3.5;
    g.strokeStyle = INK.halo;
    g.strokeText(str, x, y);
  }
  g.fillStyle = color;
  g.fillText(str, x, y);
  return g.measureText(str).width;
}

export function pill(g, x, y, str, { color = INK.ink2, bg = "rgba(250,248,243,.92)", size = 11, align = "center", border = null } = {}) {
  g.font = `600 ${size}px ${FONT_MONO}`;
  const w = g.measureText(str).width + 12, h = size + 8;
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(left, y - h / 2, w, h, 5); g.fill();
  if (border) { g.strokeStyle = border; g.lineWidth = 1; g.stroke(); }
  g.textAlign = "left"; g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(str, left + 6, y + 0.5);
  return { x: left, y: y - h / 2, w, h };
}

export function panel(g, x, y, w, h, { accent = null, radius = 10 } = {}) {
  g.fillStyle = INK.panel;
  g.beginPath(); g.roundRect(x, y, w, h, radius); g.fill();
  g.strokeStyle = "rgba(205,198,183,.9)";
  g.lineWidth = 1;
  g.stroke();
  if (accent) { g.fillStyle = accent; g.fillRect(x + 10, y + 12, 2, h - 24); }
}

export function spans(g, x, y, parts, { size = 12, weight = 500, mono = true, baseline = "middle" } = {}) {
  g.textAlign = "left";
  g.textBaseline = baseline;
  let cx = x;
  for (const p of parts) {
    if (!p) continue;
    const [str, color = INK.ink2, w = weight] = Array.isArray(p) ? p : [p];
    g.font = `${w} ${size}px ${mono ? FONT_MONO : FONT_UI}`;
    g.fillStyle = color;
    g.fillText(str, cx, y);
    cx += g.measureText(str).width;
  }
  return cx - x;
}

export function spansWidth(g, parts, { size = 12, weight = 500, mono = true } = {}) {
  let w = 0;
  for (const p of parts) {
    if (!p) continue;
    const [str, , ww = weight] = Array.isArray(p) ? p : [p];
    g.font = `${ww} ${size}px ${mono ? FONT_MONO : FONT_UI}`;
    w += g.measureText(str).width;
  }
  return w;
}

export function formulaPanel(g, x, y, title, rows, { accent = INK.brass, size = 12, gap = 19, pad = 14, minW = 0, align = "left", valign = "top" } = {}) {
  let w = minW;
  g.font = `600 10px ${FONT_UI}`;
  w = Math.max(w, g.measureText(title.toUpperCase()).width + 0);
  for (const r of rows) w = Math.max(w, spansWidth(g, r, { size }));
  w += pad * 2 + 8;
  const h = pad + 14 + rows.length * gap + pad - 4;
  const left = align === "right" ? x - w : x;
  const top = valign === "bottom" ? y - h : y;
  panel(g, left, top, w, h, { accent });
  g.font = `600 10px ${FONT_UI}`;
  g.fillStyle = INK.ink3;
  g.textAlign = "left"; g.textBaseline = "middle";
  if (g.letterSpacing !== undefined) g.letterSpacing = "0.06em";
  g.fillText(title.toUpperCase(), left + pad + 8, top + pad + 2);
  if (g.letterSpacing !== undefined) g.letterSpacing = "0px";
  rows.forEach((r, i) => spans(g, left + pad + 8, top + pad + 14 + gap * (i + 0.5) + 2, r, { size }));
  return { x: left, y: top, w, h };
}

export function imageCanvas(w, h, colourAt) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cg = c.getContext("2d");
  const img = cg.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const col = colourAt(i, j);
    const k = (j * w + i) * 4;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = col.length > 3 ? col[3] : 255;
  }
  cg.putImageData(img, 0, 0);
  return c;
}

export function arrow(g, x0, y0, x1, y1, { color = INK.ink2, width = 1.5, head = 7, dash = null } = {}) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round";
  if (dash) g.setLineDash(dash);
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * head * 0.6, y1 - Math.sin(a) * head * 0.6); g.stroke();
  g.setLineDash([]);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - Math.cos(a - 0.42) * head, y1 - Math.sin(a - 0.42) * head);
  g.lineTo(x1 - Math.cos(a + 0.42) * head, y1 - Math.sin(a + 0.42) * head);
  g.closePath(); g.fill();
}

export function hatch(g, x, y, w, h, { color = "rgba(180,35,53,.55)", step = 6, width = 1 } = {}) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = color; g.lineWidth = width;
  g.beginPath();
  for (let s = -h; s < w + h; s += step) { g.moveTo(x + s, y + h); g.lineTo(x + s + h, y); }
  g.stroke();
  g.restore();
}

export function niceStep(span, target = 6) {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rampRGB(stops, t) {
  const v = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const f = v * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export const VIRIDIS = Array.from({ length: 256 }, (_, i) => { const c = rgb(interpolateViridis(i / 255)); return [c.r, c.g, c.b]; });

export function urlPoint(ctx, key) {
  const s = ctx.url.get(key);
  if (!s) return null;
  const p = String(s).split(",").map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? p : null;
}

function b64bytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeScene(json) {
  if (!json) return null;
  const u16 = (s) => { const b = b64bytes(s); return new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
  return {
    width: json.width, height: json.height, scale: json.scale, nodata: json.nodata, synthetic: json.synthetic,
    names: json.bands.map((b) => b.name), wavelengths: json.bands.map((b) => b.wavelength_nm),
    bands: json.bands.map((b) => u16(b.data)),
    classNames: json.classNames, classes: b64bytes(json.classes),
    cloud: b64bytes(json.masks.cloud), shadow: b64bytes(json.masks.shadow), nodataMask: b64bytes(json.masks.nodata),
  };
}

export function sceneRGB(scene, i, gain = 3.2) {
  if (scene.nodataMask[i]) return [228, 223, 212];
  const f = (b) => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.min(1, (scene.bands[b][i] / scene.scale) * gain), 1 / 1.25))));
  return [f(2), f(1), f(0)];
}
