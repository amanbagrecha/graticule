import { url } from "@/core/env.js";
import { ticker, formatNumber, tween, ease, loop } from "@/core/anim.js";

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name, size = 20) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#" + name);
  svg.append(use);
  return svg;
}

export function button({ label, icon: ic, primary, ghost, iconOnly, title, cls, onClick, kbd }) {
  const b = h("button", {
    type: "button",
    class: ["btn", primary && "btn-primary", ghost && "btn-ghost", iconOnly && "btn-icon", cls].filter(Boolean).join(" "),
    title: title || (iconOnly ? label : null),
    "aria-label": iconOnly ? label : null,
    onclick: onClick,
  });
  if (ic) b.append(icon(ic, iconOnly ? 18 : 16));
  if (label && !iconOnly) b.append(h("span", { class: "btn-label", text: label }));
  if (kbd) b.append(h("kbd", { text: kbd }));
  return b;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function decimalsOf(step) {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

function formatValue(item, v) {
  if (v === null || v === undefined) return "";
  if (item.format) return item.format(v);
  if (typeof v === "number") {
    const d = item.digits !== undefined ? item.digits : decimalsOf(item.step || 1);
    return formatNumber(v, d);
  }
  return String(v);
}

export function encodeParam(item, v) {
  if (v === null || v === undefined) return null;
  switch (item.type) {
    case "toggle": return v ? "1" : "0";
    case "point": return Array.isArray(v) ? v.map((n) => (+n).toFixed(4).replace(/\.?0+$/, "")).join(",") : String(v);
    case "range":
    case "number": return String(Math.round(+v * 1e4) / 1e4);
    default: return String(v);
  }
}

export function decodeParam(item, s) {
  if (s === null || s === undefined || s === "") return undefined;
  switch (item.type) {
    case "toggle": return s === "1" || s === "true";
    case "point": {
      const p = String(s).split(",").map(Number);
      return p.length === 2 && p.every(Number.isFinite) ? p : undefined;
    }
    case "range":
    case "number": {
      const n = Number(s);
      if (!Number.isFinite(n)) return undefined;
      return item.min !== undefined && item.max !== undefined ? clamp(n, item.min, item.max) : n;
    }
    case "segment":
    case "select": {
      const ok = !item.options || item.options.some((o) => String(o.value) === s);
      return ok ? s : undefined;
    }
    default: return s;
  }
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
}

export function bindUrl(state, schema) {
  const items = schema.filter((it) => it.key && it.type !== "button" && it.type !== "legend" && it.type !== "group" && it.url !== false);
  return {
    readParam(key) {
      const item = items.find((it) => it.key === key);
      if (!item) return undefined;
      return decodeParam(item, url.get(key));
    },
    writeParam(key, value) {
      const item = items.find((it) => it.key === key);
      if (!item) return;
      const v = value === undefined ? state[key] : value;
      url.set(key, sameValue(v, item.default) ? null : encodeParam(item, v));
    },
    apply() {
      const changed = [];
      for (const item of items) {
        const v = decodeParam(item, url.get(item.key));
        const next = v === undefined ? item.default : v;
        if (!sameValue(state[item.key], next)) { state[item.key] = next; changed.push(item.key); }
      }
      return changed;
    },
    clear() {
      for (const item of items) url.set(item.key, null);
    },
    keys: items.map((it) => it.key),
  };
}

function closeMenus(except) {
  for (const m of document.querySelectorAll(".menu.open")) if (m !== except) { m.classList.remove("open"); m.remove(); }
}
document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".menu, .select-btn")) closeMenus(); });

function makeRange(item, state, emit) {
  const min = item.min ?? 0, max = item.max ?? 100, step = item.step ?? 1;
  const fillFrom = item.fillFrom !== undefined ? clamp(item.fillFrom, min, max) : min;
  const input = h("input", { type: "range", min, max, step, class: "range", "aria-label": item.label });
  const valueBtn = h("button", { type: "button", class: "ctl-value mono", title: "Type a value" });
  const unitEl = h("span", { class: "unit", text: item.unit || "" });
  const row = h("div", { class: "ctl ctl-range", dataset: { key: item.key } },
    h("div", { class: "ctl-head" }, h("span", { class: "ctl-label", text: item.label }), h("span", { class: "ctl-val-wrap" }, valueBtn, unitEl)),
    h("div", { class: "ctl-body" }, input));
  let ticksEl = null;
  if (item.ticks && item.ticks.length) {
    ticksEl = h("div", { class: "ticks" });
    for (const t of item.ticks) {
      const pct = ((t - min) / (max - min)) * 100;
      ticksEl.append(h("span", { class: "tick", style: { left: pct + "%" } }, h("i"), h("b", { text: item.tickFormat ? item.tickFormat(t) : formatValue(item, t) })));
    }
    row.append(ticksEl);
    row.classList.add("has-ticks");
  }
  const paint = () => {
    const v = +state[item.key];
    const a = ((Math.min(v, fillFrom) - min) / (max - min)) * 100;
    const b = ((Math.max(v, fillFrom) - min) / (max - min)) * 100;
    input.style.setProperty("--a", a + "%");
    input.style.setProperty("--b", b + "%");
    input.value = String(v);
    valueBtn.textContent = formatValue(item, v);
  };
  let raf = 0;
  input.addEventListener("input", () => {
    const v = +input.value;
    state[item.key] = v;
    valueBtn.textContent = formatValue(item, v);
    const a = ((Math.min(v, fillFrom) - min) / (max - min)) * 100;
    const b = ((Math.max(v, fillFrom) - min) / (max - min)) * 100;
    input.style.setProperty("--a", a + "%");
    input.style.setProperty("--b", b + "%");
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; emit(item.key, state[item.key], { live: true }); });
  });
  input.addEventListener("change", () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } emit(item.key, +input.value, { live: false }); });
  input.addEventListener("keydown", (e) => {
    if (!e.shiftKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1;
    const v = clamp(+input.value + dir * step * 10, min, max);
    input.value = String(v);
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
  });
  valueBtn.addEventListener("click", () => {
    const field = h("input", { type: "text", class: "ctl-value mono editing", value: formatValue(item, state[item.key]).replace(/,/g, ""), "aria-label": item.label + " value" });
    valueBtn.replaceWith(field);
    field.focus();
    field.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        const n = Number(field.value.replace(/[^0-9.+-eE]/g, ""));
        if (Number.isFinite(n)) {
          const v = clamp(Math.round(n / step) * step, min, max);
          state[item.key] = +v.toFixed(decimalsOf(step));
          paint();
          emit(item.key, state[item.key], { live: false });
        }
      }
      field.replaceWith(valueBtn);
      paint();
    };
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); valueBtn.focus(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); valueBtn.focus(); }
      e.stopPropagation();
    });
    field.addEventListener("blur", () => finish(true));
  });
  paint();
  return { el: row, paint, disable(b) { input.disabled = b; valueBtn.disabled = b; row.classList.toggle("disabled", b); } };
}

function makeSegment(item, state, emit) {
  const group = h("div", { class: "segment", role: "radiogroup", "aria-label": item.label });
  const buttons = new Map();
  const paint = () => {
    for (const [v, b] of buttons) {
      const on = String(state[item.key]) === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    }
    if (![...buttons.values()].some((b) => b.tabIndex === 0) && buttons.size) buttons.values().next().value.tabIndex = 0;
  };
  const choose = (v) => {
    if (String(state[item.key]) === v) return;
    state[item.key] = v;
    paint();
    emit(item.key, v, { live: false });
  };
  const build = (options) => {
    group.replaceChildren();
    buttons.clear();
    for (const o of options) {
      const b = h("button", { type: "button", role: "radio", class: "seg", title: o.title || null, dataset: { value: String(o.value) } },
        o.swatch ? h("i", { class: "swatch", style: { background: o.swatch } }) : null,
        o.icon ? icon(o.icon, 16) : null,
        h("span", { text: o.label ?? String(o.value) }));
      b.addEventListener("click", () => choose(String(o.value)));
      buttons.set(String(o.value), b);
      group.append(b);
    }
    paint();
  };
  group.addEventListener("keydown", (e) => {
    const keys = [...buttons.keys()];
    const i = keys.indexOf(String(state[item.key]));
    let j = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % keys.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + keys.length) % keys.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = keys.length - 1;
    if (j < 0) return;
    e.preventDefault();
    choose(keys[j]);
    buttons.get(keys[j]).focus();
  });
  build(item.options || []);
  const row = h("div", { class: "ctl ctl-segment", dataset: { key: item.key } },
    h("div", { class: "ctl-head" }, h("span", { class: "ctl-label", text: item.label })),
    h("div", { class: "ctl-body" }, group));
  return { el: row, paint, setOptions: build, disable(b) { for (const x of buttons.values()) x.disabled = b; row.classList.toggle("disabled", b); } };
}

function makeToggle(item, state, emit) {
  const sw = h("button", { type: "button", role: "switch", class: "switch", "aria-label": item.label }, h("i", { class: "knob" }));
  const paint = () => sw.setAttribute("aria-checked", state[item.key] ? "true" : "false");
  sw.addEventListener("click", () => { state[item.key] = !state[item.key]; paint(); emit(item.key, state[item.key], { live: false }); });
  paint();
  const row = h("div", { class: "ctl ctl-toggle", dataset: { key: item.key } },
    h("span", { class: "ctl-label", text: item.label }),
    item.shortcut ? h("kbd", { class: "ctl-kbd", text: item.shortcut.toUpperCase() }) : null,
    sw);
  return { el: row, paint, disable(b) { sw.disabled = b; row.classList.toggle("disabled", b); } };
}

function makeSelect(item, state, emit) {
  const labelEl = h("span", { class: "select-label" });
  const btn = h("button", { type: "button", class: "select-btn", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": item.label }, labelEl, icon("i-chevron-down", 16));
  const menu = h("div", { class: "menu", role: "listbox" });
  let options = item.options || [];
  const flat = () => options;
  const findOpt = (v) => flat().find((o) => String(o.value) === String(v));
  const paint = () => {
    const o = findOpt(state[item.key]);
    labelEl.textContent = o ? o.label ?? String(o.value) : String(state[item.key] ?? "");
    for (const li of menu.querySelectorAll(".menu-item")) {
      const on = li.dataset.value === String(state[item.key]);
      li.classList.toggle("on", on);
      li.setAttribute("aria-selected", on ? "true" : "false");
    }
  };
  const choose = (v) => {
    close();
    if (String(state[item.key]) === String(v)) return;
    state[item.key] = v;
    paint();
    emit(item.key, v, { live: false });
  };
  const build = (opts) => {
    options = opts;
    menu.replaceChildren();
    const groups = new Map();
    for (const o of opts) {
      const g = o.group || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(o);
    }
    for (const [g, list] of groups) {
      if (g) menu.append(h("div", { class: "menu-group", text: g }));
      for (const o of list) {
        const li = h("div", { class: "menu-item", role: "option", tabindex: -1, dataset: { value: String(o.value) } },
          o.swatch ? h("i", { class: "swatch", style: { background: o.swatch } }) : null,
          h("div", { class: "menu-text" }, h("span", { class: "menu-title", text: o.label ?? String(o.value) }), o.description ? h("span", { class: "menu-desc", text: o.description }) : null),
          icon("i-check", 14));
        li.addEventListener("click", () => choose(String(o.value)));
        menu.append(li);
      }
    }
    paint();
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.width = r.width + "px";
    menu.style.left = r.left + "px";
    const below = window.innerHeight - r.bottom;
    const mh = Math.min(320, menu.scrollHeight + 8);
    const up = below < mh + 12 && r.top > mh + 12;
    menu.style.top = up ? Math.max(8, r.top - 4 - mh) + "px" : r.bottom + 4 + "px";
    menu.style.maxHeight = Math.min(320, Math.max(120, (up ? r.top - 12 : below - 12))) + "px";
  };
  const onScroll = (e) => { if (!menu.contains(e.target)) close(); };
  const open = () => {
    closeMenus(menu);
    document.body.append(menu);
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    place();
    window.addEventListener("resize", close, { once: true });
    document.addEventListener("scroll", onScroll, true);
    const cur = menu.querySelector(".menu-item.on") || menu.querySelector(".menu-item");
    if (cur) { cur.focus(); cur.scrollIntoView({ block: "nearest" }); }
  };
  const close = () => {
    if (!menu.classList.contains("open")) return;
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("scroll", onScroll, true);
    menu.remove();
  };
  btn.addEventListener("click", () => (menu.classList.contains("open") ? close() : open()));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll(".menu-item")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (i >= 0) choose(items[i].dataset.value); btn.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); }
    else if (e.key === "Tab") close();
  });
  build(options);
  const row = h("div", { class: "ctl ctl-select", dataset: { key: item.key } },
    h("div", { class: "ctl-head" }, h("span", { class: "ctl-label", text: item.label })),
    h("div", { class: "ctl-body select-wrap" }, btn));
  return { el: row, paint, setOptions: build, disable(b) { btn.disabled = b; row.classList.toggle("disabled", b); }, destroy: close };
}

function makeNumber(item, state, emit) {
  const min = item.min ?? -Infinity, max = item.max ?? Infinity, step = item.step ?? 1;
  const dec = decimalsOf(step);
  const field = h("input", { type: "text", inputmode: "decimal", class: "num-field mono", "aria-label": item.label });
  const dn = h("button", { type: "button", class: "num-btn", "aria-label": "Decrease" }, icon("i-minus", 14));
  const up = h("button", { type: "button", class: "num-btn", "aria-label": "Increase" }, icon("i-plus", 14));
  const paint = () => { field.value = formatValue(item, state[item.key]).replace(/,/g, ""); dn.disabled = state[item.key] <= min; up.disabled = state[item.key] >= max; };
  const setV = (v, live = false) => {
    v = clamp(+(Math.round(v / step) * step).toFixed(dec), min, max);
    if (!Number.isFinite(v)) { paint(); return; }
    if (v === state[item.key]) { paint(); return; }
    state[item.key] = v;
    paint();
    emit(item.key, v, { live });
  };
  dn.addEventListener("click", () => setV(state[item.key] - step));
  up.addEventListener("click", () => setV(state[item.key] + step));
  field.addEventListener("change", () => setV(Number(field.value)));
  field.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") { e.preventDefault(); setV(state[item.key] + step * (e.shiftKey ? 10 : 1)); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setV(state[item.key] - step * (e.shiftKey ? 10 : 1)); }
    else if (e.key === "Enter") { field.blur(); }
    e.stopPropagation();
  });
  field.addEventListener("wheel", (e) => { if (document.activeElement !== field) return; e.preventDefault(); setV(state[item.key] + (e.deltaY < 0 ? step : -step)); }, { passive: false });
  paint();
  const unitEl = item.unit ? h("span", { class: "unit", text: item.unit }) : null;
  const row = h("div", { class: "ctl ctl-number", dataset: { key: item.key } },
    h("span", { class: "ctl-label", text: item.label }),
    h("div", { class: "stepper" }, dn, field, unitEl, up));
  return { el: row, paint, disable(b) { field.disabled = dn.disabled = up.disabled = b; row.classList.toggle("disabled", b); } };
}

function makeButton(item, state, emit) {
  const b = button({ label: item.label, icon: item.icon, primary: item.primary, ghost: item.ghost, onClick: () => { if (item.onClick) item.onClick(); emit(item.key, state[item.key], { live: false, action: true }); } });
  const row = h("div", { class: "ctl ctl-button", dataset: { key: item.key } }, b);
  if (item.kbd) b.append(h("kbd", { text: item.kbd }));
  return { el: row, paint() {}, disable(x) { b.disabled = x; }, setLabel(t) { b.querySelector(".btn-label").textContent = t; }, button: b };
}

function makePoint(item, state, emit, hooks) {
  const lon = h("input", { type: "text", inputmode: "decimal", class: "num-field mono", "aria-label": item.label + " longitude" });
  const lat = h("input", { type: "text", inputmode: "decimal", class: "num-field mono", "aria-label": item.label + " latitude" });
  const pick = button({ label: "Pick on map", icon: "i-pin", onClick: () => arm(!armed) });
  let armed = false;
  const paint = () => {
    const p = Array.isArray(state[item.key]) ? state[item.key] : [0, 0];
    lon.value = formatNumber(p[0], 4).replace(/,/g, "");
    lat.value = formatNumber(p[1], 4).replace(/,/g, "");
  };
  const commit = () => {
    const a = Number(lon.value.replace("−", "-")), b = Number(lat.value.replace("−", "-"));
    if (!Number.isFinite(a) || !Number.isFinite(b)) { paint(); return; }
    const v = [clamp(((a + 180) % 360 + 360) % 360 - 180, -180, 180), clamp(b, -90, 90)];
    state[item.key] = v;
    paint();
    emit(item.key, v, { live: false });
  };
  const arm = (on) => {
    armed = on;
    pick.classList.toggle("armed", on);
    pick.setAttribute("aria-pressed", on ? "true" : "false");
    if (hooks && hooks.arm) hooks.arm(on ? item.key : null);
  };
  for (const f of [lon, lat]) {
    f.addEventListener("change", commit);
    f.addEventListener("keydown", (e) => { if (e.key === "Enter") f.blur(); e.stopPropagation(); });
  }
  paint();
  const row = h("div", { class: "ctl ctl-point", dataset: { key: item.key } },
    h("div", { class: "ctl-head" }, h("span", { class: "ctl-label", text: item.label })),
    h("div", { class: "ctl-body point-body" },
      h("div", { class: "point-fields" }, h("label", { class: "point-field" }, h("span", { class: "point-tag", text: "lon" }), lon), h("label", { class: "point-field" }, h("span", { class: "point-tag", text: "lat" }), lat)),
      pick));
  return { el: row, paint, disable(b) { lon.disabled = lat.disabled = pick.disabled = b; row.classList.toggle("disabled", b); }, arm, get armed() { return armed; } };
}

function makeLegend(item) {
  const row = h("div", { class: "ctl ctl-legend" },
    item.label ? h("div", { class: "ctl-head" }, h("span", { class: "ctl-label", text: item.label })) : null,
    h("div", { class: "legend" }, (item.items || []).map((it) => h("div", { class: "legend-row" },
      h("i", { class: it.dash ? "swatch line dashed" : it.line ? "swatch line" : "swatch", style: it.line || it.dash ? { borderColor: it.color } : { background: it.color } }),
      h("span", { text: it.label }),
      it.value !== undefined ? h("span", { class: "legend-value mono", text: String(it.value) }) : null))));
  return { el: row, paint() {}, disable() {} };
}

function makeGroup(item) {
  return { el: h("div", { class: "ctl-group", text: item.label }), paint() {}, disable() {} };
}

export function buildControls(dockEl, schema, state, onChange, hooks = {}) {
  const widgets = new Map();
  const frag = document.createDocumentFragment();
  const emit = (key, value, meta) => onChange && onChange(key, value, meta || {});
  const shortcuts = [];
  for (const raw of schema) {
    const item = raw.type === "segment" && raw.options && raw.options.length > 4 ? { ...raw, type: "select" } : raw;
    if (item.key && state[item.key] === undefined && item.default !== undefined) state[item.key] = Array.isArray(item.default) ? item.default.slice() : item.default;
    if (item.hidden) continue;
    let w;
    switch (item.type) {
      case "range": w = makeRange(item, state, emit); break;
      case "segment": w = makeSegment(item, state, emit); break;
      case "toggle": w = makeToggle(item, state, emit); break;
      case "select": w = makeSelect(item, state, emit); break;
      case "number": w = makeNumber(item, state, emit); break;
      case "button": w = makeButton(item, state, emit); break;
      case "point": w = makePoint(item, state, emit, hooks); break;
      case "legend": w = makeLegend(item); break;
      case "group": w = makeGroup(item); break;
      default: continue;
    }
    w.item = item;
    if (item.key) widgets.set(item.key, w);
    if (item.shortcut && item.key) shortcuts.push({ shortcut: item.shortcut, key: item.key, type: item.type });
    frag.append(w.el);
  }
  dockEl.replaceChildren(frag);
  const api = {
    el: dockEl,
    shortcuts,
    get(key) { return state[key]; },
    set(key, value, { silent = false, live = false } = {}) {
      const w = widgets.get(key);
      state[key] = value;
      if (w) w.paint();
      if (!silent) emit(key, value, { live });
    },
    disable(key, on = true) { const w = widgets.get(key); if (w) w.disable(on); },
    setOptions(key, options) { const w = widgets.get(key); if (w && w.setOptions) w.setOptions(options); },
    setLabel(key, text) { const w = widgets.get(key); if (w && w.setLabel) w.setLabel(text); },
    arm(key) {
      for (const [k, w] of widgets) if (w.arm && k !== key) w.arm(false);
      const w = widgets.get(key);
      if (w && w.arm) w.arm(true);
    },
    disarm() { for (const w of widgets.values()) if (w.arm && w.armed) w.arm(false); },
    paint() { for (const w of widgets.values()) w.paint(); },
    widget(key) { return widgets.get(key); },
    destroy() { for (const w of widgets.values()) if (w.destroy) w.destroy(); widgets.clear(); dockEl.replaceChildren(); },
  };
  return api;
}

function partsOf(it, value) {
  if (Array.isArray(it.multi)) {
    const get = (p, i) => value === null || value === undefined ? null : Array.isArray(value) ? value[i] : value[p.key];
    return it.multi.map((p, i) => ({ id: p.key ?? String(i), label: p.label ?? "", digits: p.digits ?? it.digits, unit: p.unit ?? it.unit, value: get(p, i) }));
  }
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((v, i) => ({ id: String(i), label: "", digits: it.digits, unit: it.unit, value: v }));
  if (typeof value === "object") return Object.keys(value).map((k) => ({ id: k, label: k, digits: it.digits, unit: it.unit, value: value[k] }));
  return [{ id: "0", label: "", digits: it.digits, unit: it.unit, value }];
}

function writeValue(el, value, digits, unit) {
  if (value === null || value === undefined) { el.textContent = "–"; return; }
  if (typeof value === "number") ticker(el, value, { digits: digits ?? 2, unit: unit || "" });
  else el.textContent = String(value);
}

export function readouts(stripEl, schema) {
  const tiles = new Map();
  const list = h("div", { class: "readout-list" });
  const side = (cls, it) => {
    const val = h("span", { class: "ro-val", text: "–" });
    const el = h("span", { class: "ro-side " + cls }, val, it.unit ? h("span", { class: "unit", text: it.unit }) : null);
    return { el, val };
  };
  const multiSide = (cls) => ({ el: h("span", { class: "ro-side ro-multi " + cls }), key: null, parts: new Map() });
  const build = () => {
    list.replaceChildren();
    tiles.clear();
    for (const it of schema) {
      const A = it.multi ? multiSide("ro-side-a") : side("ro-side-a", it);
      const B = it.multi ? multiSide("ro-side-b") : side("ro-side-b", it);
      const tile = h("div", { class: ["ro-tile", it.hero && "hero", it.multi && "multi", it.mono === false && "prose"].filter(Boolean).join(" "), dataset: { key: it.key } },
        h("span", { class: "ro-label", text: it.label }),
        h("span", { class: "ro-values" }, A.el, B.el));
      tiles.set(it.key, { tile, it, A, B });
      list.append(tile);
      if (Array.isArray(it.multi)) { writeMulti(it, A, null); writeMulti(it, B, null); }
    }
  };
  const writeMulti = (it, s, value) => {
    const parts = partsOf(it, value);
    const key = parts.map((p) => p.id + "|" + p.label).join(",");
    if (key !== s.key) {
      s.key = key;
      s.parts.clear();
      s.el.replaceChildren(...parts.map((p) => {
        const val = h("span", { class: "ro-val", text: "–" });
        s.parts.set(p.id, val);
        return h("span", { class: "ro-part" }, p.label ? h("span", { class: "ro-part-label", text: p.label }) : null, val, p.unit ? h("span", { class: "unit", text: p.unit }) : null);
      }));
      if (!parts.length) s.el.append(h("span", { class: "ro-val", text: "–" }));
    }
    for (const p of parts) writeValue(s.parts.get(p.id), p.value, p.digits, p.unit);
  };
  build();
  const pointer = h("div", { class: "ro-tile ro-pointer" }, h("span", { class: "ro-label", text: "Pointer" }), h("span", { class: "ro-values" }, h("span", { class: "ro-side" }, h("span", { class: "ro-val", text: "" }))));
  stripEl.replaceChildren(list, pointer);
  return {
    el: stripEl,
    set(key, value, which = "A") {
      const t = tiles.get(key);
      if (!t) return;
      const s = which === "B" ? t.B : t.A;
      if (t.it.multi) writeMulti(t.it, s, value);
      else writeValue(s.val, value, t.it.digits, t.it.unit);
    },
    setMany(obj, side = "A") { for (const k of Object.keys(obj)) this.set(k, obj[k], side); },
    highlight(key) {
      const t = tiles.get(key);
      if (!t) return;
      t.tile.classList.remove("flash");
      void t.tile.offsetWidth;
      t.tile.classList.add("flash");
    },
    setCompare(on) { stripEl.classList.toggle("compare", !!on); },
    setPointer(lon, lat) {
      const el = pointer.querySelector(".ro-val");
      if (lon === null || lon === undefined || lat === null || lat === undefined) { el.textContent = ""; pointer.classList.remove("live"); return; }
      el.textContent = fmtLon(lon) + "  " + fmtLat(lat);
      pointer.classList.add("live");
    },
    setProbe(on) { pointer.classList.toggle("probed", !!on); pointer.querySelector(".ro-label").textContent = on ? "Probe" : "Pointer"; },
    destroy() { tiles.clear(); stripEl.replaceChildren(); },
  };
}

export function fmtLon(lon) {
  const a = Math.abs(lon);
  return a.toFixed(2) + "°" + (lon < 0 ? "W" : "E");
}
export function fmtLat(lat) {
  const a = Math.abs(lat);
  return a.toFixed(2) + "°" + (lat < 0 ? "S" : "N");
}

function player(scrubber, opts) {
  let dir = 1;
  let tw = null;
  const api = {
    get playing() { return !!tw; },
    play(duration = opts.duration) {
      api.pause();
      let cur = scrubber.get();
      if (!opts.bounce) { dir = 1; if (cur >= 1 - 1e-6) { cur = 0; scrubber.set(0); } }
      else if (cur >= 1) dir = -1;
      else if (cur <= 0) dir = 1;
      const to = dir > 0 ? 1 : 0;
      const span = Math.abs(to - cur);
      if (span < 1e-6) { dir = -dir; return api.play(duration); }
      const fn = typeof opts.ease === "function" ? opts.ease : ease[opts.ease] || ease.emph;
      tw = tween({
        from: cur, to, duration: duration * span, ease: fn,
        onUpdate: (v) => scrubber.set(v),
        onDone: () => { tw = null; if (opts.bounce) dir = -dir; scrubber.onPlay(false); scrubber.onEnd(); },
      });
      scrubber.onPlay(true);
    },
    pause() {
      if (tw) { tw.cancel(); tw = null; scrubber.onPlay(false); }
    },
    toggle() { if (tw) api.pause(); else api.play(); },
  };
  return api;
}

export function transport(barEl, { label = ["start", "end"], onScrub, onPlay, onCompare } = {}) {
  const playBtn = h("button", { type: "button", class: "btn btn-icon tp-play", "aria-label": "Play" }, icon("i-play", 18));
  const input = h("input", { type: "range", min: 0, max: 1, step: 0.001, value: 0, class: "range tp-range", "aria-label": "Scrubber" });
  const a = h("span", { class: "tp-label tp-a", text: label[0] });
  const b = h("span", { class: "tp-label tp-b", text: label[1] });
  const cmp = h("button", { type: "button", class: "btn tp-compare", "aria-pressed": "false", title: "Compare (C)" }, icon("i-compare", 16), h("span", { class: "btn-label", text: "Compare" }));
  barEl.replaceChildren(playBtn, a, input, b, cmp);
  let value = 0;
  let playing = false;
  const paint = () => {
    input.value = String(value);
    input.style.setProperty("--a", "0%");
    input.style.setProperty("--b", value * 100 + "%");
  };
  const scrub = { get: () => value, set: (t) => { value = clamp(t, 0, 1); paint(); if (onScrub) onScrub(value, { live: true, auto: true }); }, onPlay: (on) => { playing = on; playBtn.replaceChildren(icon(on ? "i-pause" : "i-play", 18)); playBtn.setAttribute("aria-label", on ? "Pause" : "Play"); if (onPlay) onPlay(on); }, onEnd: () => { if (onScrub) onScrub(value, { live: false, auto: true }); } };
  const opts = { duration: 1400, ease: "emph", bounce: true };
  const pp = player(scrub, opts);
  const toggle = () => { const was = pp.playing; pp.toggle(); if (was && onScrub) onScrub(value, { live: false, auto: true }); };
  playBtn.addEventListener("click", toggle);
  input.addEventListener("input", () => { pp.pause(); value = +input.value; paint(); if (onScrub) onScrub(value, { live: true }); });
  input.addEventListener("change", () => { value = +input.value; paint(); if (onScrub) onScrub(value, { live: false }); });
  cmp.addEventListener("click", () => { api.setCompare(!api.compare); if (onCompare) onCompare(api.compare); });
  paint();
  const api = {
    el: barEl,
    compare: false,
    get playing() { return pp.playing; },
    get(){ return value; },
    set(t, { silent = true, live = false } = {}) { pp.pause(); value = clamp(+t || 0, 0, 1); paint(); if (!silent && onScrub) onScrub(value, { live }); },
    play(d) { pp.play(d); },
    pause() { pp.pause(); },
    toggle,
    configure({ duration = 1400, ease: e = "emph", bounce = true } = {}) { pp.pause(); Object.assign(opts, { duration, ease: e, bounce }); },
    jump() { pp.pause(); api.set(value < 0.5 ? 1 : 0, { silent: false }); },
    hide() { barEl.classList.add("hidden"); pp.pause(); },
    show() { barEl.classList.remove("hidden"); },
    setLabels(l) { a.textContent = l[0]; b.textContent = l[1]; },
    setCompare(on) { api.compare = !!on; cmp.classList.toggle("on", api.compare); cmp.setAttribute("aria-pressed", api.compare ? "true" : "false"); },
    showCompare(on) { cmp.classList.toggle("hidden", !on); },
    showScrubber(on) { for (const el of [playBtn, a, input, b]) el.classList.toggle("hidden", !on); barEl.classList.toggle("no-scrub", !on); },
    onScrub(fn) { onScrub = fn; },
    destroy() { pp.pause(); },
  };
  return api;
}

let snackHost = null;
let snackTimer = 0;
let snackEl = null;
export function snack(text, { error = false, duration = 2400 } = {}) {
  if (!snackHost) snackHost = document.querySelector(".stage") || document.body;
  if (snackEl) { snackEl.remove(); snackEl = null; clearTimeout(snackTimer); }
  snackEl = h("div", { class: "snack" + (error ? " error" : ""), role: "status", text });
  snackHost.append(snackEl);
  requestAnimationFrame(() => snackEl && snackEl.classList.add("in"));
  snackTimer = setTimeout(() => {
    if (!snackEl) return;
    const el = snackEl;
    snackEl = null;
    el.classList.remove("in");
    setTimeout(() => el.remove(), 300);
  }, duration);
}
snack.mount = (el) => { snackHost = el; };

function keyName(e) {
  const parts = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && e.key.length > 1) parts.push("shift");
  let k = e.key;
  if (k === " ") k = "space";
  else if (k.length === 1) k = e.shiftKey && /[a-z]/i.test(k) ? k.toUpperCase() : k;
  else k = k.toLowerCase();
  parts.push(k);
  return parts.join("+");
}

const keymaps = [];
let keyListener = null;
export function keymap(bindings) {
  const entry = { bindings };
  keymaps.push(entry);
  if (!keyListener) {
    keyListener = (e) => {
      const target = e.target;
      const typing = target && (target.tagName === "INPUT" && target.type !== "range" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const name = keyName(e);
      if (target && target.tagName === "BUTTON" && (name === "space" || name === "enter")) return;
      for (let i = keymaps.length - 1; i >= 0; i--) {
        const fn = keymaps[i].bindings[name];
        if (!fn) continue;
        if (typing && !fn.global) continue;
        if (target && target.tagName === "INPUT" && target.type === "range" && /^(arrow|home|end)/.test(name)) continue;
        const r = fn(e);
        if (r !== false) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
    };
    window.addEventListener("keydown", keyListener);
  }
  return () => { const i = keymaps.indexOf(entry); if (i >= 0) keymaps.splice(i, 1); };
}

export function global(fn) { fn.global = true; return fn; }

export function kbd(text) { return h("kbd", { text }); }

export { formatNumber, loop };
