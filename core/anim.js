import { reducedMotion } from "@/core/env.js";

function bezier(x1, y1, x2, y2) {
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slope = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const s = slope(t);
      if (Math.abs(s) < 1e-6) break;
      t -= (sampleX(t) - x) / s;
    }
    if (t < 0 || t > 1) {
      let lo = 0, hi = 1;
      t = x;
      while (hi - lo > 1e-5) {
        const mid = (lo + hi) / 2;
        if (sampleX(mid) < x) lo = mid; else hi = mid;
        t = mid;
      }
    }
    return sampleY(t);
  };
}

export const ease = {
  standard: bezier(0.2, 0.8, 0.2, 1),
  emph: bezier(0.3, 0, 0.1, 1),
  out: bezier(0, 0, 0.2, 1),
  in: bezier(0.4, 0, 1, 1),
  linear: (t) => t,
};

const frameFns = new Set();
const tweens = new Set();
let dirty = false;
let rafId = 0;
let last = 0;
let start = 0;

function frame(now) {
  rafId = 0;
  if (!start) start = now;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  const t = (now - start) / 1000;
  const wasDirty = dirty;
  dirty = false;
  for (const tw of Array.from(tweens)) tw.step(now);
  for (const fn of Array.from(frameFns)) fn(dt, t, wasDirty);
  if (dirty || tweens.size) schedule();
  else last = 0;
}

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

export const loop = {
  add(fn) { frameFns.add(fn); schedule(); return () => frameFns.delete(fn); },
  remove(fn) { frameFns.delete(fn); },
  invalidate() { dirty = true; schedule(); },
  get active() { return dirty || tweens.size > 0; },
};

export function tween({ from = 0, to = 1, duration = 240, ease: fn = ease.standard, delay = 0, onUpdate, onDone }) {
  const d = reducedMotion ? 0 : duration;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  let t0 = 0;
  let done = false;
  const finish = (cancelled) => {
    if (done) return;
    done = true;
    tweens.delete(tw);
    if (!cancelled) {
      if (onUpdate) onUpdate(to, 1);
      if (onDone) onDone();
    }
    resolve(!cancelled);
  };
  const tw = {
    step(now) {
      if (!t0) t0 = now + (reducedMotion ? 0 : delay);
      if (now < t0) return;
      if (d <= 0) { finish(false); return; }
      const k = Math.min(1, (now - t0) / d);
      const e = fn(k);
      if (k >= 1) { finish(false); return; }
      if (onUpdate) onUpdate(from + (to - from) * e, e);
    },
    cancel() { finish(true); },
    promise,
  };
  tweens.add(tw);
  schedule();
  return tw;
}

export function tweenValues(obj, target, duration = 240, fn = ease.standard) {
  const keys = Object.keys(target).filter((k) => typeof target[k] === "number");
  const from = {};
  for (const k of keys) from[k] = typeof obj[k] === "number" ? obj[k] : target[k];
  return tween({
    from: 0, to: 1, duration, ease: fn,
    onUpdate: (v) => { for (const k of keys) obj[k] = from[k] + (target[k] - from[k]) * v; loop.invalidate(); },
  });
}

const tickerState = new WeakMap();

function formatNumber(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (typeof v !== "number") return String(v);
  if (!Number.isFinite(v)) return v > 0 ? "∞" : "−∞";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (v < 0 && Number(s.replace(/,/g, "")) !== 0 ? "−" : "") + s;
}

export function ticker(el, value, { digits = 2, unit = "", duration = 350 } = {}) {
  const prev = tickerState.get(el);
  if (prev && prev.tw) prev.tw.cancel();
  const render = (v) => {
    el.textContent = formatNumber(v, digits);
    if (unit) {
      let u = el.nextElementSibling;
      if (!u || !u.classList.contains("unit")) {
        u = document.createElement("span");
        u.className = "unit";
        el.after(u);
      }
      u.textContent = unit;
    } else if (el.nextElementSibling && el.nextElementSibling.classList.contains("unit")) {
      el.nextElementSibling.remove();
    }
  };
  if (typeof value !== "number" || !Number.isFinite(value) || reducedMotion || !prev || typeof prev.value !== "number" || prev.value === value) {
    render(value);
    tickerState.set(el, { value, tw: null });
    return;
  }
  const from = prev.value;
  const tw = tween({ from, to: value, duration, ease: ease.out, onUpdate: (v) => render(v) });
  tickerState.set(el, { value, tw });
}

export function pingPong(scrubber) {
  let dir = 1;
  let tw = null;
  const api = {
    get playing() { return !!tw; },
    play(duration = 1400) {
      api.pause();
      const cur = scrubber.get();
      if (cur >= 1) dir = -1; else if (cur <= 0) dir = 1;
      const to = dir > 0 ? 1 : 0;
      const span = Math.abs(to - cur);
      if (span < 1e-6) { dir = -dir; return api.play(duration); }
      tw = tween({
        from: cur, to, duration: duration * span, ease: ease.emph,
        onUpdate: (v) => scrubber.set(v),
        onDone: () => { tw = null; dir = -dir; scrubber.onPlay && scrubber.onPlay(false); scrubber.onEnd && scrubber.onEnd(); },
      });
      scrubber.onPlay && scrubber.onPlay(true);
    },
    pause() {
      if (tw) { tw.cancel(); tw = null; scrubber.onPlay && scrubber.onPlay(false); }
    },
    toggle(duration) { if (tw) api.pause(); else api.play(duration); },
  };
  return api;
}

export { formatNumber };
