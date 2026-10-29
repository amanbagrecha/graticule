const host = typeof window !== "undefined" && window.fused ? window.fused : null;

function findAppDir() {
  if (typeof location === "undefined") return "";
  const own = new URLSearchParams(location.search).get("path") || "";
  if (own) {
    const cut = own.lastIndexOf("/");
    return own.slice(0, cut > 0 ? cut : own.length).replace(/\/dev$/, "");
  }
  const p = location.pathname;
  return p.slice(0, p.lastIndexOf("/")).replace(/\/dev$/, "");
}

export const appDir = findAppDir();
export const hosted = !!host;

export function assetUrl(rel) {
  const abs = appDir + "/" + rel;
  if (new URLSearchParams(location.search).get("path")) return "/api/fs/raw?path=" + encodeURIComponent(abs);
  return abs;
}

export function dataUrl(name) {
  return assetUrl("data/" + name);
}

const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
export let reducedMotion = !!(mq && mq.matches);
if (mq) mq.addEventListener("change", () => { reducedMotion = mq.matches; });

export const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);

export function isPreview() {
  if (new URLSearchParams(location.search).get("_preview") === "1") return true;
  try {
    let w = window;
    while (w.parent && w.parent !== w) {
      w = w.parent;
      if (new URLSearchParams(w.location.search).get("_preview") === "1") return true;
    }
  } catch (e) {}
  return false;
}

const RESERVED = new Set(["path"]);
const listeners = new Set();

function localAll() {
  const out = {};
  for (const [k, v] of new URLSearchParams(location.search)) {
    if (k.startsWith("_") || RESERVED.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function localSet(key, value) {
  const u = new URL(location.href);
  if (value === null || value === undefined) u.searchParams.delete(key);
  else u.searchParams.set(key, String(value));
  if (u.href === location.href) return;
  history.replaceState(history.state, "", u.href);
  const snap = localAll();
  for (const fn of listeners) fn(snap);
}

if (!host && typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const snap = localAll();
    for (const fn of listeners) fn(snap);
  });
}

export const url = {
  get(key) {
    if (host) return host.params.get(key);
    return localAll()[key];
  },
  all() {
    if (host) {
      const all = host.params.getAll();
      delete all._file;
      return all;
    }
    return localAll();
  },
  set(key, value) {
    if (key.startsWith("_") || RESERVED.has(key)) return;
    const v = value === null || value === undefined ? null : String(value);
    if (host) {
      const cur = host.params.get(key);
      if ((cur === undefined ? null : cur) === v) return;
      host.params.set(key, v, { history: "replace" });
      return;
    }
    localSet(key, v);
  },
  setMany(obj) {
    for (const k of Object.keys(obj)) url.set(k, obj[k]);
  },
  onChange(fn) {
    if (host) return host.params.onChange(fn);
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  share() {
    try {
      let w = window;
      let top = w;
      while (w.parent && w.parent !== w) {
        w = w.parent;
        void w.location.search;
        top = w;
      }
      return top.location.href;
    } catch (e) {}
    return location.href;
  },
};
