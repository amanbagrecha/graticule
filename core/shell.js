import { url, assetUrl, dataUrl, reducedMotion } from "@/core/env.js";
import * as anim from "@/core/anim.js";
import { h, icon, button, buildControls, bindUrl, readouts, transport, snack, keymap, global, fmtLon, fmtLat, kbd } from "@/core/ui.js";
import { Stage } from "@/core/stage.js";
import { tracks, lessons, byId, trackOf, lessonsOfTrack, neighbours, first } from "@/core/registry.js";

const VERSION = "1.0";
const RESERVED_KEYS = new Set(["l", "m", "v", "cmp", "d"]);
const GLIDE = 650;

const progress = {
  data: { visited: {}, done: {} },
  load() {
    try { const s = JSON.parse(localStorage.getItem("graticule.progress") || "{}"); this.data = { visited: s.visited || {}, done: s.done || {} }; } catch (e) {}
  },
  save() { try { localStorage.setItem("graticule.progress", JSON.stringify(this.data)); } catch (e) {} },
  visit(id) { if (!this.data.visited[id]) { this.data.visited[id] = Date.now(); this.save(); } },
  finish(id) { if (!this.data.done[id]) { this.data.done[id] = Date.now(); this.save(); } },
  state(id) { return this.data.done[id] ? "done" : this.data.visited[id] ? "visited" : "new"; },
  count() { return lessons.filter((l) => this.data.visited[l.id] || this.data.done[l.id]).length; },
};

let coreLibs = null;
function loadCore() {
  if (coreLibs) return coreLibs;
  const names = ["geodesy", "projections", "utm", "mgrs", "s2", "geohash", "l3bins", "tiles", "grids", "astro", "raster", "math"];
  coreLibs = (async () => {
    const geo = {};
    const results = await Promise.all(names.map((n) => import(`@/core/${n}.js`).catch(() => null)));
    names.forEach((n, i) => { geo[n] = results[i]; });
    const palette = await import("@/core/palette.js").catch(() => null);
    const data = await import("@/core/data.js").catch(() => null);
    return { geo, palette, data };
  })();
  return coreLibs;
}

const dataCache = new Map();
async function loadData(name, lib) {
  if (dataCache.has(name)) return dataCache.get(name);
  const p = (async () => {
    const m = name.match(/^(land|countries)-(\d+m)\.json$/);
    if (lib) {
      if (m && lib.loadTopo) return lib.loadTopo(name, m[1]);
      if (name.endsWith(".geojson") && lib.loadGeoJSON) return lib.loadGeoJSON(name);
      if (name.endsWith(".i16") && lib.loadGridI16) return lib.loadGridI16(name);
      if (/\.(jpg|jpeg|png|webp)$/.test(name) && lib.loadImage) return lib.loadImage(name);
      if (lib.loadJSON) return lib.loadJSON(name);
    }
    const res = await fetch(dataUrl(name));
    if (!res.ok) throw new Error("Cannot load " + name);
    if (/\.(json|geojson)$/.test(name)) return res.json();
    if (/\.(jpg|jpeg|png|webp)$/.test(name)) return createImageBitmap(await res.blob());
    return res.arrayBuffer();
  })();
  dataCache.set(name, p);
  p.catch(() => dataCache.delete(name));
  return p;
}

export class Shell {
  constructor(root) {
    this.root = root;
    this.current = null;
    this.sides = { A: null, B: null };
    this.loadToken = 0;
    this.narrow = matchMedia("(max-width: 1240px)");
    this.navOpen = !this.narrow.matches;
    this.railOpen = true;
    this.armedKey = null;
    this.probe = null;
    progress.load();
    this.buildDom();
    this.toggleNav(this.navOpen);
    this.narrow.addEventListener("change", (e) => this.toggleNav(!e.matches));
    this.stage = new Stage(this.stageEl, {
      onHover: (ll, p, side) => this.onHover(ll, p, side),
      onPointer: (ll) => this.readout && this.readout.setPointer(ll ? ll.lon : null, ll ? ll.lat : null),
      onClick: (ll, p, side) => this.onClick(ll, p, side),
      onDblClick: (ll) => this.centreOn(ll),
      onDragStart: () => this.stage.overlay.hideChip(),
      onDragEnd: () => this.writeView(),
      onResize: () => this.eachSide((s) => s.handlers && s.handlers.resize && s.handlers.resize()),
      onModeRequest: (m) => this.setMode(m),
    });
    snack.mount(this.stageEl);
    this.bindKeys();
    this.unsubUrl = url.onChange(() => this.onUrlChange());
    this.buildNav();
    const id = url.get("l") || first.id;
    this.open(id, { initial: true });
  }

  buildDom() {
    const r = this.root;
    r.replaceChildren();
    this.brandBtn = h("button", { type: "button", class: "brand", title: "About Graticule", onclick: () => this.openAbout() },
      h("img", { class: "brand-mark", src: assetUrl("assets/logo.svg"), alt: "", width: 28, height: 28 }),
      h("span", { class: "wordmark", text: "Graticule" }));
    this.searchInput = h("input", { type: "search", class: "search-input", placeholder: "Search lessons", "aria-label": "Search lessons", autocomplete: "off", spellcheck: "false" });
    this.searchResults = h("div", { class: "search-results", role: "listbox" });
    this.searchEl = h("div", { class: "search" }, icon("i-search", 16), this.searchInput, h("kbd", { class: "search-kbd", text: navigator.platform && /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl K" }), this.searchResults);
    this.crumb = h("div", { class: "crumb" });
    this.modeSeg = h("div", { class: "segment mode-seg", role: "radiogroup", "aria-label": "View mode" },
      h("button", { type: "button", role: "radio", class: "seg", dataset: { mode: "2d" }, onclick: () => this.setMode("2d") }, icon("i-map", 15), h("span", { text: "2D" })),
      h("button", { type: "button", role: "radio", class: "seg", dataset: { mode: "3d" }, onclick: () => this.setMode("3d") }, icon("i-globe", 15), h("span", { text: "3D" })));
    this.navToggleBtn = button({ label: "Navigator", icon: "i-panel-left", iconOnly: true, ghost: true, onClick: () => this.toggleNav() });
    this.railToggleBtn = button({ label: "Rail", icon: "i-panel-right", iconOnly: true, ghost: true, onClick: () => this.toggleRail() });
    const resetBtn = button({ label: "Reset view", icon: "i-reset", iconOnly: true, ghost: true, onClick: () => this.reset() });
    const helpBtn = button({ label: "Shortcuts", icon: "i-help", iconOnly: true, ghost: true, cls: "help-btn", onClick: () => this.openShortcuts() });
    this.topbar = h("header", { class: "topbar" },
      h("div", { class: "topbar-left" }, this.navToggleBtn, this.brandBtn),
      this.searchEl,
      h("div", { class: "topbar-mid" }, this.crumb),
      h("div", { class: "topbar-right" }, this.modeSeg, resetBtn, helpBtn, this.railToggleBtn));

    this.navList = h("div", { class: "nav-list" });
    this.navFoot = h("div", { class: "nav-foot" }, h("span", { class: "nav-count" }), h("div", { class: "nav-bar" }, h("i")));
    this.nav = h("nav", { class: "nav", "aria-label": "Lessons" }, this.navList, this.navFoot);

    this.stageEl = h("main", { class: "stage", tabindex: 0, "aria-label": "Stage" });

    this.card = h("section", { class: "card" });
    this.dock = h("div", { class: "dock" });
    this.rail = h("aside", { class: "rail" }, this.card, h("div", { class: "dock-scroll" }, this.dock));

    this.stripEl = h("div", { class: "readout-strip" });
    const kbBtn = button({ label: "Keyboard shortcuts", icon: "i-keyboard", iconOnly: true, ghost: true, onClick: () => this.openShortcuts() });
    this.readoutBar = h("footer", { class: "readouts" }, this.stripEl, h("div", { class: "readout-end" }, kbBtn));

    const scrim = h("div", { class: "nav-scrim", onclick: () => this.toggleNav(false) });
    this.app = h("div", { class: "app" }, this.topbar, this.nav, scrim, this.stageEl, this.rail, this.readoutBar);
    r.append(this.app);
    this.buildDialogs();
    this.bindSearch();
  }

  buildDialogs() {
    const close = (d) => button({ label: "Close", icon: "i-close", iconOnly: true, ghost: true, cls: "dialog-close", onClick: () => d.close() });
    this.about = h("dialog", { class: "dialog about" });
    this.about.append(
      close(this.about),
      h("div", { class: "about-head" },
        h("img", { class: "about-mark", src: assetUrl("assets/logo.svg"), alt: "", width: 64, height: 64 }),
        h("div", null, h("div", { class: "about-name", text: "Graticule" }), h("div", { class: "about-tag", text: "Turn it. Cut it. Unroll it." }))),
      h("p", { class: "about-line", text: "An instrument for seeing how the Earth becomes a map." }),
      h("p", { class: "about-desc", text: "Graticule is a set of short lessons. Each lesson has one idea, one picture and a few controls. Turn the globe, change a number and see what the map does." }),
      h("dl", { class: "about-credits" },
        h("dt", { text: "Version" }), h("dd", { text: VERSION }),
        h("dt", { text: "Data" }), h("dd", { text: "Natural Earth, NASA Blue Marble, NOAA ETOPO1, NGA EGM96, GEBCO" }),
        h("dt", { text: "Libraries" }), h("dd", { text: "three.js, d3, h3-js, proj4js, GeographicLib" })));
    const rows = [
      ["←", "→", "Previous or next lesson"], ["⇧←", "⇧→", "Previous or next track"],
      ["Space", null, "Play or pause the scrubber"], ["U", null, "Jump the scrubber to the other end"],
      ["R", null, "Reset view and controls"], ["C", null, "Compare split"],
      ["G", null, "Graticule on or off"], ["L", null, "Labels on or off"], ["T", null, "Tissot on or off"],
      ["2", "3", "Switch 2D or 3D"], ["[", "]", "Hide or show the navigator or the rail"],
      ["⌘K", "/", "Search"], ["?", null, "This sheet"], ["Esc", null, "Close, disarm, clear the probe"],
      ["⇧D", null, "Copy a link to this view"],
    ];
    this.shortcuts = h("dialog", { class: "dialog shortcuts" });
    this.shortcuts.append(
      close(this.shortcuts),
      h("h2", { class: "dialog-title", text: "Keyboard shortcuts" }),
      h("div", { class: "kbd-grid" }, rows.map(([a, b, text]) => h("div", { class: "kbd-row" }, h("span", { class: "kbd-keys" }, kbd(a), b ? h("span", { class: "kbd-or", text: "or" }) : null, b ? kbd(b) : null), h("span", { class: "kbd-text", text })))));
    for (const d of [this.about, this.shortcuts]) {
      d.tabIndex = -1;
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
      document.body.append(d);
    }
  }

  openAbout() { if (!this.about.open) { this.about.showModal(); this.about.focus(); } }
  openShortcuts() { if (!this.shortcuts.open) { this.shortcuts.showModal(); this.shortcuts.focus(); } }
  closeDialogs() { let any = false; for (const d of [this.about, this.shortcuts]) if (d.open) { d.close(); any = true; } return any; }

  buildNav() {
    this.navList.replaceChildren();
    this.navRows = new Map();
    this.navGroups = new Map();
    for (const t of tracks) {
      const list = h("div", { class: "nav-lessons" });
      for (const l of lessonsOfTrack(t.id)) {
        const row = h("button", { type: "button", class: "nav-row", dataset: { id: l.id }, onclick: () => { this.open(l.id); if (this.narrow.matches) this.toggleNav(false); } },
          h("i", { class: "dot" }, icon("i-check", 10)),
          h("span", { class: "nav-title", text: l.title }),
          icon(l.mode === "2d" ? "i-map" : "i-globe", 14));
        this.navRows.set(l.id, row);
        list.append(row);
      }
      const head = h("button", { type: "button", class: "nav-track", "aria-expanded": "false" },
        icon("i-chevron-right", 16),
        h("span", { class: "nav-track-num mono", text: String(t.id) }),
        h("span", { class: "nav-track-title", text: t.title }));
      const group = h("div", { class: "nav-group", dataset: { track: t.id } }, head, h("div", { class: "nav-lessons-wrap" }, list));
      head.addEventListener("click", () => this.toggleTrack(t.id));
      this.navGroups.set(t.id, group);
      this.navList.append(group);
    }
    this.paintNav();
  }

  toggleTrack(id, force) {
    const g = this.navGroups.get(id);
    if (!g) return;
    const open = force === undefined ? !g.classList.contains("open") : force;
    g.classList.toggle("open", open);
    g.querySelector(".nav-track").setAttribute("aria-expanded", open ? "true" : "false");
    const wrap = g.querySelector(".nav-lessons-wrap");
    wrap.style.height = open ? wrap.firstChild.scrollHeight + "px" : "0px";
  }

  paintNav() {
    for (const [id, row] of this.navRows) {
      const st = progress.state(id);
      row.dataset.state = st;
      row.classList.toggle("on", !!this.current && this.current.id === id);
      row.setAttribute("aria-current", this.current && this.current.id === id ? "page" : "false");
    }
    const n = progress.count();
    this.navFoot.querySelector(".nav-count").textContent = `${n} / ${lessons.length} visited`;
    this.navFoot.querySelector(".nav-bar i").style.width = (n / lessons.length * 100).toFixed(1) + "%";
  }

  bindSearch() {
    const input = this.searchInput;
    const results = this.searchResults;
    let items = [];
    let active = -1;
    const render = () => {
      results.replaceChildren();
      results.classList.toggle("open", items.length > 0);
      items.forEach((l, i) => {
        const t = trackOf(l);
        const row = h("div", { class: "search-row" + (i === active ? " active" : ""), role: "option", dataset: { id: l.id } },
          h("i", { class: "dot", dataset: { state: progress.state(l.id) } }, icon("i-check", 10)),
          h("div", { class: "search-text" }, h("span", { class: "search-title", text: l.title }), h("span", { class: "search-sub", text: `Track ${t.id} · ${t.title} · ${l.keywords.slice(0, 2).join(", ")}` })),
          icon(l.mode === "2d" ? "i-map" : "i-globe", 14));
        row.addEventListener("pointerdown", (e) => { e.preventDefault(); this.open(l.id); close(); });
        results.append(row);
      });
    };
    const close = () => { items = []; active = -1; render(); input.blur(); };
    const query = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { items = []; active = -1; render(); return; }
      const score = (l) => {
        const t = l.title.toLowerCase(), id = l.id, kws = l.keywords.map((k) => k.toLowerCase());
        if (t.startsWith(q) || id.startsWith(q)) return 3;
        if (t.includes(q) || id.includes(q)) return 2;
        if (kws.some((k) => k.includes(q))) return 1;
        return 0;
      };
      items = lessons.map((l) => [score(l), l]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 8).map((x) => x[1]);
      active = items.length ? 0 : -1;
      render();
    };
    input.addEventListener("input", query);
    input.addEventListener("focus", query);
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) { items = []; render(); } }, 120));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; render(); } }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; render(); } }
      else if (e.key === "Enter") { e.preventDefault(); if (items[active]) { this.open(items[active].id); input.value = ""; close(); } }
      else if (e.key === "Escape") { e.preventDefault(); input.value = ""; close(); this.stageEl.focus(); }
      e.stopPropagation();
    });
    this.closeSearch = close;
  }

  focusSearch() { this.searchInput.focus(); this.searchInput.select(); }

  toggleNav(force) {
    this.navOpen = force === undefined ? !this.navOpen : force;
    this.app.classList.toggle("nav-closed", !this.navOpen);
  }

  toggleRail(force) {
    this.railOpen = force === undefined ? !this.railOpen : force;
    this.app.classList.toggle("rail-closed", !this.railOpen);
  }

  bindKeys() {
    const go = (dir) => { const n = neighbours(this.current ? this.current.id : ""); const t = dir < 0 ? n.prev : n.next; if (t) this.open(t.id); else if (n.index < 0) this.open(first.id); };
    const goTrack = (dir) => {
      if (!this.current) return;
      const t = this.current.track + dir;
      const list = lessonsOfTrack(t);
      if (list.length) this.open(list[0].id);
    };
    this.unbindKeys = keymap({
      arrowleft: () => go(-1), arrowright: () => go(1),
      "shift+arrowleft": () => goTrack(-1), "shift+arrowright": () => goTrack(1),
      space: () => { if (this.transport && this.transportOn) this.transport.toggle(); else return false; },
      u: () => { if (this.transport && this.transportOn) this.transport.jump(); },
      U: () => { if (this.transport && this.transportOn) this.transport.jump(); },
      r: () => this.reset(), R: () => this.reset(),
      c: () => this.toggleCompare(), C: () => this.toggleCompare(),
      "2": () => this.setMode("2d"), "3": () => this.setMode("3d"),
      "[": () => this.toggleNav(), "]": () => this.toggleRail(),
      "mod+k": global(() => this.focusSearch()), "/": () => this.focusSearch(),
      "?": () => this.openShortcuts(),
      escape: global(() => this.escape()),
      D: () => this.copyLink(),
      "shift+d": () => this.copyLink(),
    });
  }

  escape() {
    if (this.closeDialogs()) return;
    if (this.searchResults.classList.contains("open")) { this.closeSearch(); return; }
    if (this.armedKey) { this.disarm(); return; }
    if (this.probe) { this.clearProbe(); return; }
    if (this.narrow.matches && this.navOpen) { this.toggleNav(false); return; }
    return false;
  }

  async copyLink() {
    const link = url.share();
    try { await navigator.clipboard.writeText(link); snack("Link copied."); }
    catch (e) { snack("Copy failed. Use the address bar.", { error: true }); }
  }

  crumbText(entry) {
    const t = trackOf(entry);
    const list = lessonsOfTrack(entry.track);
    const i = list.findIndex((l) => l.id === entry.id);
    return i < 0 ? t.title : `Lesson ${i + 1} of ${list.length}`;
  }

  async open(id, { initial = false } = {}) {
    const entry = byId(id) || first;
    if (this.current && this.current.id === entry.id && !initial) return;
    const token = ++this.loadToken;
    const prev = this.current;
    this.current = entry;
    this.settled = false;
    this.modeCompare = false;
    this.paintNav();
    this.toggleTrack(entry.track, true);
    const row = this.navRows.get(entry.id);
    if (row) row.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    this.crumb.textContent = this.crumbText(entry);
    if (prev) {
      this.unmountAll(prev);
      for (const k of this.urlKeys || []) url.set(k, null);
      for (const k of ["m", "v", "cmp", "d"]) url.set(k, null);
    }
    url.set("l", entry.id);
    document.title = entry.title + " · Graticule";
    let mod = null;
    try { mod = await entry.loader(); } catch (e) { mod = null; }
    if (token !== this.loadToken) return;
    if (!mod || typeof mod.mount !== "function" || !mod.meta) {
      this.renderInProgress(entry, prev ? 1 : 0);
      return;
    }
    const meta = { ...mod.meta, id: entry.id };
    this.meta = meta;
    this.mount = mod.mount;
    await this.setupLesson(meta, { initial: initial || !prev, token, prev });
  }

  renderInProgress(entry, animate) {
    this.meta = null;
    this.mount = null;
    this.urlKeys = [];
    this.transportOn = false;
    if (this.transport) this.transport.hide();
    this.stage.prepare(null, { initial: true });
    this.stage.setEmpty(true, "In progress");
    this.modeSeg.classList.add("disabled");
    this.swapCard(this.cardContent({ id: entry.id, title: entry.title, track: entry.track, paragraph: "This lesson is in progress. Use the arrows to move to another lesson." }, entry), animate);
    this.dock.replaceChildren(h("div", { class: "dock-empty", text: "No controls yet." }));
    this.readout = readouts(this.stripEl, []);
    this.app.classList.add("no-readouts");
    this.readout.setPointer(null, null);
    progress.visit(entry.id);
    this.paintNav();
  }

  cardContent(meta, entry) {
    const t = trackOf(entry);
    const n = neighbours(entry.id);
    let deeperOpen = false;
    const deeperList = meta.deeper && meta.deeper.length ? h("ul", { class: "deeper-list" }, meta.deeper.map((d) => h("li", { text: d }))) : null;
    const deeperWrap = deeperList ? h("div", { class: "deeper-wrap" }, deeperList) : null;
    const deeperBtn = deeperList ? h("button", { type: "button", class: "deeper-btn", "aria-expanded": "false" }, icon("i-chevron-right", 16), h("span", { text: "Go deeper" })) : null;
    if (deeperBtn) deeperBtn.addEventListener("click", () => {
      deeperOpen = !deeperOpen;
      deeperBtn.setAttribute("aria-expanded", deeperOpen ? "true" : "false");
      deeperBtn.classList.toggle("open", deeperOpen);
      deeperWrap.style.height = deeperOpen ? deeperList.scrollHeight + "px" : "0px";
    });
    const prevBtn = button({ label: "Previous", icon: "i-arrow-left", ghost: true, cls: "card-prev", title: n.prev ? n.prev.title : "", onClick: () => n.prev && this.open(n.prev.id) });
    const nextBtn = h("button", { type: "button", class: "btn btn-ghost card-next", title: n.next ? n.next.title : "", onclick: () => n.next && this.open(n.next.id) },
      h("span", { class: "btn-label", text: n.next ? n.next.title : "End of course" }), icon("i-arrow-right", 16));
    prevBtn.disabled = !n.prev;
    nextBtn.disabled = !n.next;
    return h("div", { class: "card-inner" },
      h("div", { class: "card-track", text: entry.track ? `Track ${t.id} · ${t.title}` : "Demo" }),
      h("h1", { class: "card-title", text: meta.title || entry.title }),
      h("p", { class: "card-para", text: meta.paragraph || "" }),
      deeperBtn, deeperWrap,
      h("div", { class: "card-foot" }, prevBtn, nextBtn));
  }

  swapCard(content, animate) {
    const old = this.card.firstElementChild;
    if (!old || !animate || reducedMotion) { this.card.replaceChildren(content); return; }
    old.classList.add("out");
    setTimeout(() => {
      content.classList.add("in");
      this.card.replaceChildren(content);
      requestAnimationFrame(() => requestAnimationFrame(() => content.classList.remove("in")));
    }, 120);
  }

  async setupLesson(meta, { initial, token, prev }) {
    const entry = this.current;
    this.swapCard(this.cardContent(meta, entry), !!prev);
    this.modeSeg.classList.toggle("disabled", meta.mode !== "both");
    const urlMode = meta.mode === "both" ? url.get("d") : null;
    this.stage.setEmpty(false);
    const sameKind = prev && this.stage.kindFor(meta, urlMode) === this.stage.el.dataset.kind;
    await this.stage.prepare(meta, { initial, mode: urlMode });
    if (token !== this.loadToken) return;
    this.paintModeSeg();

    this.schema = (meta.controls || []).slice();
    this.params = {};
    for (const it of this.schema) if (it.key && it.default !== undefined) this.params[it.key] = Array.isArray(it.default) ? it.default.slice() : it.default;
    this.bind = bindUrl(this.params, this.schema);
    this.bind.apply();
    this.urlKeys = this.bind.keys.slice();
    this.controls = buildControls(this.dock, this.schema, this.params, (k, v, m) => this.onControl(k, v, m), { arm: (key) => this.setArmed(key) });
    this.readout = readouts(this.stripEl, meta.readouts || []);
    this.app.classList.toggle("no-readouts", !(meta.readouts || []).length);
    this.readout.setPointer(null, null);

    if (!this.transport) {
      this.transport = transport(this.stage.transportEl, {
        onScrub: (t, m) => this.onScrub(t, m),
        onCompare: (on) => this.toggleCompare(on),
      });
    }
    this.transportOn = !!meta.transport;
    const canCompare = !!meta.compare;
    if (this.transportOn || canCompare) {
      this.transport.setLabels(meta.transport ? meta.transport.label || ["start", "end"] : ["", ""]);
      this.transport.showScrubber(this.transportOn);
      this.transport.showCompare(canCompare);
      this.transport.show();
    } else this.transport.hide();
    if (this.transportOn) {
      const tc = meta.transport;
      this.transport.configure({ duration: tc.duration ?? 1400, ease: tc.ease ?? "emph", bounce: tc.bounce ?? true });
      const m = Number(url.get("m"));
      this.morph = Number.isFinite(m) && url.get("m") != null ? Math.min(1, Math.max(0, m)) : this.morphDefault();
      this.transport.set(this.morph);
      this.params[meta.transport.key || "m"] = this.morph;
    }

    this.shortcutUnbind = keymap(Object.fromEntries(this.controls.shortcuts.flatMap((s) => {
      const fn = () => { if (s.type === "toggle") this.controls.set(s.key, !this.controls.get(s.key)); };
      return [[s.shortcut.toLowerCase(), fn], [s.shortcut.toUpperCase(), fn]];
    })));

    const libs = await loadCore();
    if (token !== this.loadToken) return;
    const dataLib = libs.data;
    const preload = {};
    await Promise.all((meta.data || []).map(async (n) => { try { preload[n] = await loadData(n, dataLib); } catch (e) { preload[n] = null; } }));
    if (token !== this.loadToken) return;
    this.libs = libs;
    this.preload = preload;
    this.settled = true;

    const v = this.parseView(url.get("v"));
    if (!v && meta.view) this.stage.setView(meta.view, { duration: initial || !sameKind ? 0 : GLIDE });
    await this.mountSide("A");
    if (token !== this.loadToken) return;
    if (v) this.stage.setView(v, { duration: 0 });

    if (url.get("cmp") === "1" && canCompare) await this.toggleCompare(true);
    progress.visit(entry.id);
    this.paintNav();
    anim.loop.invalidate();
  }

  paramsFor(side) {
    if (side === "A" || !this.meta || !this.meta.compare) return this.params;
    const p = { ...this.params };
    const c = this.meta.compare;
    if (c && c.key) p[c.key] = c.value;
    if (c && c.params) Object.assign(p, c.params);
    return p;
  }

  makeCtx(side, rec) {
    const shell = this;
    const meta = this.meta;
    const ac = new AbortController();
    const live = () => !ac.signal.aborted;
    const params = this.paramsFor(side);
    const transportRef = this.transport;
    const tp = this.transportOn ? {
      set: (t, o = {}) => live() ? transportRef.set(t, { silent: false, live: !!o.live }) : undefined,
      get: () => transportRef.get(),
      play: () => live() ? transportRef.play(reducedMotion ? 0 : meta.transport.duration ?? 1400) : undefined,
      pause: () => live() ? transportRef.pause() : undefined,
      onScrub: (fn) => { if (live()) rec.onScrub = fn; },
      setLabels: (l) => { if (live() && side === "A") transportRef.setLabels(l); },
    } : null;
    const controls = this.controls;
    const readout = this.readout;
    const ctx = {
      meta,
      params,
      side,
      stage: this.stage.side(side),
      controls: {
        set: (k, v, o) => side === "A" && live() ? controls.set(k, v, o) : undefined,
        get: (k) => params[k],
        disable: (k, b) => side === "A" && live() && controls.disable(k, b),
        setOptions: (k, o) => side === "A" && live() && controls.setOptions(k, o),
        setLabel: (k, t) => side === "A" && live() && controls.setLabel(k, t),
      },
      readout: {
        set: (k, v) => live() ? readout.set(k, v, side) : undefined,
        setMany: (o) => live() ? readout.setMany(o, side) : undefined,
        highlight: (k) => live() ? readout.highlight(k) : undefined,
      },
      transport: tp,
      palette: this.libs.palette,
      data: { get: (n) => this.preload[n], load: (n) => loadData(n, this.libs.data) },
      anim,
      geo: this.libs.geo,
      overlay: this.stage.overlay,
      snack,
      get reducedMotion() { return reducedMotion; },
      url: { get: (k) => url.get(k), set: (k, v) => { if (RESERVED_KEYS.has(k) || !live()) return; this.writingUrl = true; try { url.set(k, v); } finally { this.writingUrl = false; } } },
      signal: ac.signal,
      done() { if (!live()) return; progress.finish(meta.id); shell.paintNav(); },
      course: { open: (id) => { if (live()) shell.open(id); }, state: (id) => progress.state(id) },
      fmt: { lon: fmtLon, lat: fmtLat },
    };
    return { ctx, ac };
  }

  async mountSide(side) {
    const rec = { ctx: null, ac: null, handlers: null, onScrub: null };
    const { ctx, ac } = this.makeCtx(side, rec);
    rec.ctx = ctx;
    rec.ac = ac;
    this.sides[side] = rec;
    let handlers = null;
    try {
      handlers = await this.mount(ctx);
    } catch (e) {
      if (!ac.signal.aborted) {
        console.error(e);
        snack("The lesson did not start.", { error: true });
      }
    }
    if (ac.signal.aborted) {
      if (handlers && handlers.unmount) try { handlers.unmount(); } catch (e) {}
      if (!this.meta || this.meta.id !== ctx.meta.id) this.stage.cleanup(ctx.meta.id, null, { layersOnly: true });
      return;
    }
    rec.handlers = handlers || {};
    if (rec.handlers.frame) rec.frameFn = (dt, t) => { try { rec.handlers.frame(dt, t); } catch (e) {} };
    if (rec.frameFn) anim.loop.add(rec.frameFn);
    this.callUpdate(side, Object.keys(ctx.params));
    if (this.transportOn && rec.onScrub) rec.onScrub(this.transport.get());
  }

  unmountSide(side) {
    const rec = this.sides[side];
    if (!rec) return;
    rec.ac.abort();
    if (rec.frameFn) anim.loop.remove(rec.frameFn);
    if (rec.handlers && rec.handlers.unmount) { try { rec.handlers.unmount(); } catch (e) { console.error(e); } }
    this.sides[side] = null;
  }

  unmountAll(prevEntry) {
    this.unmountSide("A");
    this.unmountSide("B");
    if (this.shortcutUnbind) { this.shortcutUnbind(); this.shortcutUnbind = null; }
    if (this.transport) this.transport.pause();
    this.clearProbe(true);
    this.disarm();
    if (this.stage.compareOn) { this.stage.compare(false); if (this.transport) this.transport.setCompare(false); this.readout && this.readout.setCompare(false); }
    this.stage.cleanup(prevEntry.id);
    if (this.controls) { this.controls.destroy(); this.controls = null; }
  }

  eachSide(fn) { for (const s of ["A", "B"]) if (this.sides[s]) fn(this.sides[s], s); }

  callUpdate(side, keys) {
    const rec = this.sides[side];
    if (!rec || !rec.handlers || !rec.handlers.update) return;
    const p = this.paramsFor(side);
    if (side === "B") Object.assign(rec.ctx.params, p);
    try { rec.handlers.update(rec.ctx.params, keys); } catch (e) { console.error(e); }
    anim.loop.invalidate();
  }

  onControl(key, value, { live = false, action = false } = {}) {
    this.eachSide((rec, side) => this.callUpdate(side, [key]));
    if (!live && !action && this.bind) {
      this.writingUrl = true;
      try { for (const k of this.bind.keys) this.bind.writeParam(k); } finally { this.writingUrl = false; }
    }
  }

  morphDefault() {
    const d = this.meta && this.meta.transport ? Number(this.meta.transport.default) : 0;
    return Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0;
  }

  onScrub(t, { live, auto } = {}) {
    this.morph = t;
    const key = this.meta && this.meta.transport ? this.meta.transport.key || "m" : "m";
    this.params[key] = t;
    this.eachSide((rec, side) => {
      rec.ctx.params[key] = t;
      if (rec.onScrub) { try { rec.onScrub(t); } catch (e) {} }
      else this.callUpdate(side, [key]);
    });
    if (!live) url.set("m", t.toFixed(2) === this.morphDefault().toFixed(2) ? null : t.toFixed(2));
  }

  async toggleCompare(force) {
    if (!this.meta || !this.meta.compare) { if (force === undefined) snack("This lesson has no compare view."); return; }
    const on = force === undefined ? !this.stage.compareOn : !!force;
    if (on === this.stage.compareOn) return;
    this.transport.setCompare(on);
    this.readout.setCompare(on);
    if (on) {
      await this.stage.compare(true, this.meta);
      await this.mountSide("B");
    } else {
      this.unmountSide("B");
      this.stage.cleanup(this.meta.id, "B");
      await this.stage.compare(false);
      this.callUpdate("A", []);
    }
    url.set("cmp", on ? "1" : null);
  }

  paintModeSeg() {
    for (const b of this.modeSeg.querySelectorAll(".seg")) {
      const on = b.dataset.mode === this.stage.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  async setMode(mode) {
    if (!this.settled || !this.meta || this.meta.mode !== "both" || mode === this.stage.mode) return;
    const token = ++this.loadToken;
    const meta = this.meta;
    const wasCompare = this.stage.compareOn || this.modeCompare;
    this.modeCompare = wasCompare;
    if (this.transport) this.transport.pause();
    this.clearProbe(true);
    this.disarm();
    this.unmountSide("A");
    this.unmountSide("B");
    this.stage.cleanup(meta.id);
    if (this.stage.compareOn) { await this.stage.compare(false); this.transport.setCompare(false); this.readout.setCompare(false); }
    url.set("d", mode);
    url.set("v", null);
    const swap = this.stage.setMode(mode, meta);
    this.paintModeSeg();
    await swap;
    if (token !== this.loadToken) return;
    if (meta.view) this.stage.setView(meta.view, { duration: 0 });
    await this.mountSide("A");
    if (token !== this.loadToken) return;
    this.modeCompare = false;
    if (wasCompare) await this.toggleCompare(true);
  }

  reset() {
    if (!this.meta) return;
    for (const it of this.schema) if (it.key && it.default !== undefined) this.controls.set(it.key, Array.isArray(it.default) ? it.default.slice() : it.default, { silent: true });
    this.controls.paint();
    const keys = this.schema.filter((it) => it.key).map((it) => it.key);
    if (this.transportOn) { const d = this.morphDefault(); this.transport.set(d); this.onScrub(d, { live: false }); }
    this.eachSide((rec, side) => this.callUpdate(side, keys));
    for (const k of this.urlKeys) url.set(k, null);
    url.set("v", null);
    this.clearProbe();
    if (this.meta.view) this.stage.setView(this.meta.view, { duration: GLIDE });
    snack("Reset.");
  }

  parseView(s) {
    if (!s) return null;
    const p = String(s).split(",").map(Number);
    if (p.length < 2 || !p.every(Number.isFinite)) return null;
    return this.stage.mode === "2d" ? { lon: p[0], lat: p[1], scale: p[2] ?? 1 } : { lon: p[0], lat: p[1], dist: p[2] ?? 2.9 };
  }

  writeView() {
    const s = this.stage.viewState();
    if (!s || typeof s.lon !== "number") return;
    const third = this.stage.mode === "2d" ? s.scale : s.dist;
    url.set("v", [s.lon.toFixed(2), s.lat.toFixed(2), third !== undefined ? (+third).toFixed(2) : ""].filter((x) => x !== "").join(","));
  }

  centreOn(ll) {
    if (!ll) return;
    const s = this.stage.viewState() || {};
    this.stage.setView({ lon: ll.lon, lat: ll.lat, dist: s.dist, scale: s.scale }, { duration: GLIDE });
    setTimeout(() => this.writeView(), GLIDE + 20);
  }

  onHover(ll, p, side) {
    if (!ll) { this.stage.overlay.hideChip(); return; }
    const rec = this.sides[side] || this.sides.A;
    const lines = [];
    if (rec && rec.handlers && rec.handlers.hover) {
      try { const extra = rec.handlers.hover(ll.lon, ll.lat); if (Array.isArray(extra)) lines.push(...extra); else if (typeof extra === "string") lines.push(extra); } catch (e) {}
    }
    this.stage.overlay.chip(p.x, p.y, lines);
  }

  onClick(ll, p, side) {
    if (!ll) return;
    if (this.armedKey) {
      const key = this.armedKey;
      this.disarm();
      this.stage.overlay.ripple(p.x, p.y);
      this.controls.set(key, [+ll.lon.toFixed(4), +ll.lat.toFixed(4)]);
      return;
    }
    const rec = this.sides[side] || this.sides.A;
    if (!rec || !rec.handlers || !rec.handlers.probe) return;
    this.stage.overlay.ripple(p.x, p.y);
    let result = null;
    try { result = rec.handlers.probe(ll.lon, ll.lat); } catch (e) {}
    if (result === null || result === undefined) return;
    this.probe = { lon: ll.lon, lat: ll.lat, side };
    this.stage.overlay.pin("probe", { lon: ll.lon, lat: ll.lat }, { color: "var(--signal)" });
    if (typeof result === "object") this.readout.setMany(result, side);
    this.readout.setProbe(true);
    this.readout.setPointer(ll.lon, ll.lat);
  }

  clearProbe(silent) {
    if (!this.probe) return;
    this.probe = null;
    this.stage.overlay.remove("probe");
    this.readout.setProbe(false);
    this.readout.setPointer(null, null);
    this.eachSide((rec) => { if (rec.handlers && rec.handlers.unprobe) { try { rec.handlers.unprobe(); } catch (e) {} } });
    if (!silent) this.eachSide((rec, side) => this.callUpdate(side, []));
  }

  setArmed(key) {
    this.armedKey = key;
    this.stage.arm(!!key);
  }

  disarm() {
    if (!this.armedKey) return;
    this.armedKey = null;
    this.stage.arm(false);
    if (this.controls) this.controls.disarm();
  }

  onUrlChange() {
    const l = url.get("l");
    if (l && (!this.current || l !== this.current.id)) { this.open(l); return; }
    if (!this.bind || !this.controls || this.writingUrl) return;
    const changed = this.bind.apply();
    if (changed.length) {
      this.controls.paint();
      this.eachSide((rec, side) => this.callUpdate(side, changed));
    }
    if (this.transportOn) {
      const m = url.get("m");
      const t = m === undefined || m === null ? this.morphDefault() : Number(m);
      if (Number.isFinite(t) && Math.abs(t - this.morph) > 1e-6) { this.transport.set(t); this.onScrub(t, { live: true }); }
    }
    if (this.meta && this.meta.compare) {
      const want = url.get("cmp") === "1";
      if (want !== this.stage.compareOn) this.toggleCompare(want);
    }
  }
}

export async function boot(root = document.body) {
  const sprite = await fetch(assetUrl("assets/icons.svg")).then((r) => r.text()).catch(() => "");
  if (root === document.body) root.replaceChildren();
  if (sprite) {
    const holder = document.createElement("div");
    holder.className = "sprite";
    holder.innerHTML = sprite;
    document.body.prepend(holder);
  }
  const mount = root === document.body ? h("div", { class: "root" }) : root;
  if (root === document.body) root.append(mount);
  const shell = new Shell(mount);
  window.graticule = { shell, version: VERSION };
  return shell;
}
