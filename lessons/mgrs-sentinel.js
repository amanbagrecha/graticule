import { zone as utmZone, band as utmBand, forward as utmForward, inverse as utmInverse, gridZoneBounds, gridZones, centralMeridian } from "@/core/utm.js";
import { toMGRS, fromMGRS, sentinelTile, sentinelTileBounds, squaresInZone, squareRing, SENTINEL_TILE_SIZE } from "@/core/mgrs.js";
import { make } from "@/core/projections.js";
import { clamp } from "@/core/math.js";
import { FONT_MONO, FONT_UI } from "@/core/map2d.js";

const BRASS = "#b85217";
const SIGNAL = "#1d63a8";
const WARN = "#b7791f";
const INK = "#1a1917";
const INK2 = "#3f3c37";
const INK3 = "#6b665e";
const HALO = "rgba(250,248,243,.85)";
const SQUARE = "rgba(26,25,23,.42)";
const SQUARE_FAR = "rgba(26,25,23,.2)";
const TILE = "rgba(29,99,168,.55)";

export const PRECISIONS = [
  { value: "10km", label: "10 km", digits: 1 },
  { value: "1km", label: "1 km", digits: 2 },
  { value: "100m", label: "100 m", digits: 3 },
  { value: "10m", label: "10 m", digits: 4 },
  { value: "1m", label: "1 m", digits: 5 },
];
export const PARIS = [2.3522, 48.8566];

export const meta = {
  id: "mgrs-sentinel",
  title: "Letters for squares",
  track: 5,
  order: 2,
  mode: "both",
  defaultMode: "2d",
  renderer: "canvas2d",
  projectionId: "transverseMercator",
  paragraph: "MGRS names a place with letters and digits. The zone number and a band letter give a grid zone, like 31U. Two more letters name a 100 km square. Digits add metres. Sentinel-2 images are cut on these same squares, with a small overlap. Click anywhere to see its name.",
  deeper: [
    "Bands run C to X, 8° each, X is 12°.",
    "A Sentinel-2 tile is 10,980 pixels at 10 m = 109.8 km, overlap 9.8 km.",
    "Zone 32V is widened to cover Norway.",
    "There is no zone 32X, 34X or 36X.",
  ],
  keywords: ["MGRS", "Sentinel", "tile", "100 km square", "military grid"],
  controls: [
    { key: "point", type: "point", label: "Place", default: PARIS },
    { key: "precision", type: "segment", label: "Precision", options: PRECISIONS.map(({ value, label }) => ({ value, label })), default: "1km" },
    { key: "tiles", type: "toggle", label: "Sentinel-2 tiles", default: true, shortcut: "t" },
    { key: "exceptions", type: "toggle", label: "Exceptions", default: true, shortcut: "e" },
    { type: "legend", label: "Key", items: [
      { color: BRASS, line: true, label: "Grid zone edge (zone and band)" },
      { color: SQUARE, line: true, label: "100 km square" },
      { color: TILE, dash: true, label: "Sentinel-2 tile, 109.8 km" },
      { color: WARN, label: "Zone that breaks the rule" },
    ] },
  ],
  readouts: [
    { key: "ref", label: "MGRS reference", mono: false },
    { key: "zone", label: "Zone" },
    { key: "band", label: "Band" },
    { key: "square", label: "100 km square" },
    { key: "E", label: "E", digits: 0, unit: "m" },
    { key: "N", label: "N", digits: 0, unit: "m" },
    { key: "tile", label: "Sentinel-2 tile" },
  ],
  transport: null,
  compare: null,
  view: { lon: 2.35, lat: 48.86, dist: 1.5 },
  data: [],
};

const PREFIX = meta.id + ":";
const PANEL_W = 300;
const COMPACT_MAX_W = 460;

export const isCompact = (W, H) => W < 640 || H < 420;

const hits = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const within = (a, r) => a[0] >= r[0] && a[1] >= r[1] && a[2] <= r[2] && a[3] <= r[3];
const grow = (r, m) => [r[0] - m, r[1] - m, r[2] + m, r[3] + m];

export const digitsOf = (precision) => (PRECISIONS.find((p) => p.value === precision) || PRECISIONS[1]).digits;
export const precisionOfDigits = (d) => (PRECISIONS.find((p) => p.digits === d) || PRECISIONS[1]).value;

export function reference(lon, lat, digits = 2) {
  return toMGRS(lon, lat, digits);
}

export function describe(lon, lat, digits = 2) {
  const ref = toMGRS(lon, lat, digits);
  if (!ref) return null;
  const z = utmZone(lon, lat), b = utmBand(lat);
  const { E, N } = utmForward(lon, lat, z, lat < 0);
  const parts = ref.split(" ");
  return { ref, zone: z, band: b, square: parts[1], E, N, tile: sentinelTile(lon, lat), south: lat < 0 };
}

export function tileOf(lon, lat) {
  return sentinelTile(lon, lat);
}

export function parseReference(text) {
  const clean = String(text || "").replace(/\s+/g, "").toUpperCase();
  const r = fromMGRS(clean);
  if (!r || r.precision > 5 || !gridZoneBounds(r.zone, r.band)) return null;
  const centre = r.precision === 0 ? fromMGRS(clean + "55").centre : r.centre;
  const back = toMGRS(centre[0], centre[1], r.precision);
  if (!back || back.replace(/\s+/g, "") !== clean) return null;
  return { ...r, centre };
}

export function exceptionZones() {
  return gridZones().filter((g) => (g.band === "V" && (g.zone === 31 || g.zone === 32)) || g.band === "X" && g.zone >= 31 && g.zone <= 37);
}

const zoneCache = new Map();
function zoneData(z, b) {
  const key = z + b;
  if (!zoneCache.has(key)) {
    const g = gridZoneBounds(z, b);
    zoneCache.set(key, g ? { g, squares: squaresInZone(z, b, 8) } : null);
  }
  return zoneCache.get(key);
}

export function neighbourZones(lon, lat) {
  const z = utmZone(lon, lat), b = utmBand(lat);
  const g = gridZoneBounds(z, b);
  if (!g) return [];
  const seen = new Map();
  for (let lo = g.west - 4.5; lo <= g.east + 4.5; lo += 1.5) for (let la = g.south - 6; la <= g.north + 6; la += 2) {
    const L = clamp(la, -79.99, 83.99);
    const LL = ((lo + 540) % 360) - 180;
    const zz = utmZone(LL, L), bb = utmBand(L);
    if (bb && !seen.has(zz + bb)) seen.set(zz + bb, { zone: zz, band: bb, home: zz === z && bb === b });
  }
  return [...seen.values()];
}

function boxRing(z, south, E0, N0, size) {
  return squareRing(z, south, E0, N0, size, 6).map(([lo, la]) => [lo, la]);
}

export async function mount(ctx) {
  return ctx.stage.globe ? mount3D(ctx) : mount2D(ctx);
}

function makePanel(ctx, onSubmit) {
  const el = ctx.stage.element("div", "mgrs-panel");
  el.style.cssText = `position:absolute;inset:auto;left:16px;top:16px;width:${PANEL_W}px;height:auto;padding:12px 12px 10px;background:rgba(255,255,255,.94);border:1px solid #e3ded3;border-radius:14px;box-shadow:0 1px 0 rgba(0,0,0,.35),0 8px 24px -16px rgba(0,0,0,.8);z-index:5;pointer-events:none;box-sizing:border-box;`;
  const refEl = document.createElement("div");
  refEl.style.cssText = `font:500 22px/28px ${FONT_MONO};color:${INK};letter-spacing:.02em;white-space:nowrap;`;
  const input = document.createElement("input");
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = "Type a reference, then Enter";
  input.setAttribute("aria-label", "MGRS reference");
  input.style.cssText = `pointer-events:auto;width:100%;box-sizing:border-box;margin:8px 0 10px;height:30px;padding:0 10px;border-radius:8px;border:1px solid #cdc6b7;background:#faf8f3;color:${INK};font:500 12.5px ${FONT_MONO};outline:none;`;
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      const ok = onSubmit(input.value);
      input.style.borderColor = ok ? "#cdc6b7" : "#b42335";
      if (ok) input.blur();
    }
  });
  input.addEventListener("focus", () => { input.style.borderColor = BRASS; });
  input.addEventListener("blur", () => { input.style.borderColor = "#cdc6b7"; });
  const canvas = document.createElement("canvas");
  const cap = document.createElement("div");
  cap.style.cssText = `font:400 12px/17px ${FONT_UI};color:${INK2};margin-top:8px;`;
  el.append(refEl, input, canvas, cap);
  let compact = false;
  let capTexts = [""];
  const meter = document.createElement("canvas").getContext("2d");
  const paintCap = () => {
    if (!compact) { cap.textContent = capTexts[0]; return; }
    meter.font = `400 12px ${FONT_UI}`;
    const room = el.clientWidth - 20;
    cap.textContent = capTexts.find((t) => meter.measureText(t).width <= room) || capTexts[capTexts.length - 1];
  };
  const setCap = (texts) => { capTexts = texts; paintCap(); };
  const setCompact = (on, W) => {
    compact = on;
    el.style.left = el.style.top = on ? "8px" : "16px";
    el.style.width = (on ? Math.min(W - 16, COMPACT_MAX_W) : PANEL_W) + "px";
    el.style.padding = on ? "8px 10px" : "12px 12px 10px";
    el.style.borderRadius = on ? "12px" : "14px";
    refEl.style.font = on ? `500 18px/24px ${FONT_MONO}` : `500 22px/28px ${FONT_MONO}`;
    input.style.margin = on ? "6px 0 0" : "8px 0 10px";
    input.style.height = on ? "32px" : "30px";
    canvas.style.display = on ? "none" : "";
    cap.style.marginTop = on ? "6px" : "8px";
    paintCap();
  };
  const rect = () => [el.offsetLeft, el.offsetTop, el.offsetLeft + el.offsetWidth, el.offsetTop + el.offsetHeight];
  let typeTimer = null;
  const setRef = (parts, animate) => {
    clearInterval(typeTimer);
    const colours = [BRASS, BRASS, SIGNAL, INK, INK];
    const render = (n) => {
      refEl.replaceChildren();
      let used = 0;
      parts.forEach((p, i) => {
        if (!p) return;
        const s = document.createElement("span");
        s.style.color = colours[i];
        const take = Math.max(0, Math.min(p.length, n - used));
        s.textContent = p.slice(0, take);
        used += p.length;
        refEl.append(s);
      });
    };
    const total = parts.join("").length;
    if (!animate) { render(total); return; }
    let n = 0;
    render(0);
    typeTimer = setInterval(() => { n++; render(n); if (n >= total) clearInterval(typeTimer); }, 28);
  };
  const W = PANEL_W - 24, H = 132;
  const drawLens = (d, digits) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!d) return;
    const S = 108, top = 4;
    const boxes = [{ x: 14, size: 100000, label: d.square + " · 100 km" }, { x: 14 + S + 40, size: 10000, label: "10 km" }];
    const e = ((d.E % 100000) + 100000) % 100000, n = ((d.N % 100000) + 100000) % 100000;
    const e10 = Math.floor(e / 10000) * 10000, n10 = Math.floor(n / 10000) * 10000;
    boxes.forEach((bx, k) => {
      const x0 = bx.x, y0 = top;
      g.fillStyle = "rgba(250,248,243,.9)"; g.fillRect(x0, y0, S, S);
      g.strokeStyle = "rgba(60,52,40,.16)"; g.lineWidth = 1;
      for (let i = 1; i < 10; i++) { const q = x0 + (i * S) / 10; g.beginPath(); g.moveTo(q + 0.5, y0); g.lineTo(q + 0.5, y0 + S); g.stroke(); const r = y0 + (i * S) / 10; g.beginPath(); g.moveTo(x0, r + 0.5); g.lineTo(x0 + S, r + 0.5); g.stroke(); }
      g.strokeStyle = k === 0 ? BRASS : SIGNAL; g.lineWidth = 1.5; g.strokeRect(x0 + 0.5, y0 + 0.5, S - 1, S - 1);
      const ox = k === 0 ? 0 : e10, oy = k === 0 ? 0 : n10;
      const span = k === 0 ? 100000 : 10000;
      const px = (v) => x0 + ((v - ox) / span) * S, py = (v) => y0 + S - ((v - oy) / span) * S;
      const cell = Math.pow(10, 5 - Math.max(1, Math.min(digits, k === 0 ? 1 : 2)));
      const ce = Math.floor(e / cell) * cell, cn = Math.floor(n / cell) * cell;
      if (k === 0 || digits >= 2) {
        g.fillStyle = "rgba(29,99,168,.28)"; g.fillRect(px(ce), py(cn + cell), (cell / span) * S, (cell / span) * S);
        g.strokeStyle = SIGNAL; g.lineWidth = 1.25; g.strokeRect(px(ce), py(cn + cell), (cell / span) * S, (cell / span) * S);
      }
      g.fillStyle = INK; g.beginPath(); g.arc(px(e), py(n), 2.5, 0, Math.PI * 2); g.fill();
      g.font = `500 10px ${FONT_MONO}`; g.fillStyle = INK3; g.textAlign = "left";
      g.fillText(bx.label, x0, y0 + S + 14);
    });
    const x1 = boxes[0].x, s1 = S / 10;
    const ex = x1 + ((e10 + 5000) / 100000) * S, ny = top + S - ((n10 + 5000) / 100000) * S;
    g.strokeStyle = "rgba(29,99,168,.5)"; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(ex + s1 / 2, ny - s1 / 2); g.lineTo(boxes[1].x, top); g.moveTo(ex + s1 / 2, ny + s1 / 2); g.lineTo(boxes[1].x, top + S); g.stroke();
    g.setLineDash([]);
  };
  return { el, input, setRef, drawLens, setCap, setCompact, rect, dispose() { clearInterval(typeTimer); el.remove(); } };
}

function shared(ctx, getParams, setPoint) {
  const panel = makePanel(ctx, (text) => {
    const r = parseReference(text);
    if (!r) { ctx.snack("The reference is not valid."); return false; }
    const p = getParams();
    setPoint([+r.centre[0].toFixed(5), +r.centre[1].toFixed(5)], r.precision >= 1 && r.precision <= 5 ? precisionOfDigits(r.precision) : p.precision);
    return true;
  });
  const info = (params, animate) => {
    const [lon, lat] = params.point;
    const digits = digitsOf(params.precision);
    const d = describe(lon, lat, digits);
    if (!d) {
      panel.setRef(["outside", "", "", "", ""], false);
      panel.drawLens(null, digits);
      panel.setCap(["MGRS uses UTM from 80° S to 84° N. Polar areas use another grid.", "MGRS uses UTM from 80° S to 84° N.", "MGRS stops at 80° S and 84° N."]);
      ctx.readout.setMany({ ref: "outside 80° S – 84° N", zone: "–", band: "–", square: "–", E: null, N: null, tile: "–" });
      return null;
    }
    const parts = d.ref.split(" ");
    panel.setRef([String(d.zone), d.band, " " + parts[1], parts[2] ? " " + parts[2] : "", parts[3] ? " " + parts[3] : ""], animate);
    panel.drawLens(d, digits);
    const size = Math.pow(10, 5 - digits);
    const n = parts[2] ? parts[2].length * 2 : 0, box = size >= 1000 ? size / 1000 + " km" : size + " m";
    panel.setCap([`${n} digits name a ${box} box in square ${parts[1]}. Tile ${d.tile}.`, `${n} digits: a ${box} box in ${parts[1]}. Tile ${d.tile}.`, `${n} digits: a ${box} box in ${parts[1]}.`]);
    ctx.readout.setMany({ ref: d.ref, zone: String(d.zone), band: d.band, square: parts[1], E: d.E, N: d.N, tile: d.tile });
    return d;
  };
  const hoverLines = (lon, lat) => {
    const d = describe(lon, lat, 0);
    if (!d) return ["outside the MGRS area"];
    return [`square ${d.zone}${d.band} ${d.square}`, `tile ${d.tile}`];
  };
  return { panel, info, hoverLines };
}

async function mount2D(ctx) {
  const map = ctx.stage.map;
  let params = { ...ctx.params };
  let homeKey = "";
  let pulse = 0;
  let booted = false;
  let current = null;
  const setPoint = (p, precision) => {
    if (precision !== params.precision) ctx.controls.set("precision", precision);
    ctx.controls.set("point", p);
  };
  const { panel, info, hoverLines } = shared(ctx, () => params, setPoint);
  const excZones = exceptionZones();
  let tileTag = null;
  let textBoxes = [];
  let compact = false;
  map.labelLayer.avoid = () => [grow(panel.rect(), 6), ...textBoxes.map((b) => grow(b, -5))];

  const layout = () => {
    const W = ctx.stage.width;
    compact = isCompact(W, ctx.stage.height);
    panel.setCompact(compact, W);
    const r = panel.rect(), bottom = ctx.stage.insetBottom + 10;
    map.setInsets(compact && W < 640 ? { left: 10, top: r[3] + 22, right: 10, bottom } : { left: r[2] + 12, top: 10, right: 10, bottom });
  };

  const frame = async (animate) => {
    const [lon, lat] = params.point;
    const z = utmZone(lon, clamp(lat, -79.9, 83.9)), b = utmBand(clamp(lat, -79.9, 83.9));
    const g = gridZoneBounds(z, b);
    const key = z + b;
    if (key === homeKey) return;
    homeKey = key;
    const cm = centralMeridian(z);
    const pts = [];
    for (let la = g.south - 0.6; la <= g.north + 0.6; la += 1) pts.push([g.west - 0.8, la], [g.east + 0.8, la]);
    map.setFitTarget({ type: "MultiPoint", coordinates: pts });
    await map.setProjection(make("transverseMercator", { lon0: cm }), { duration: animate ? 700 : 0, tag: "mgrs" + key });
    map.invalidate();
  };

  const lineString = (ring) => ({ type: "LineString", coordinates: ring });

  map.addLayer(PREFIX + "grid", (g, path, P) => {
    const [lon, lat] = params.point;
    const zones = neighbourZones(lon, clamp(lat, -79.9, 83.9));
    const scale = P.scale();
    const pxPerKm = scale / 6371;
    g.lineJoin = "round";
    if (params.exceptions) {
      for (const ez of excZones) {
        const ring = [];
        for (let la = ez.south; la <= ez.north; la += 1) ring.push([ez.west, la]);
        for (let la = ez.north; la >= ez.south; la -= 1) ring.push([ez.east, la]);
        ring.push(ring[0]);
        g.beginPath(); path(lineString(ring));
        g.fillStyle = "rgba(183,121,31,.2)"; g.fill();
        g.strokeStyle = "rgba(183,121,31,.85)"; g.lineWidth = 1.5; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]);
      }
    }
    for (const nz of zones) {
      const data = zoneData(nz.zone, nz.band);
      if (!data) continue;
      g.beginPath();
      for (const sq of data.squares) path(lineString(sq.ring));
      g.strokeStyle = nz.home ? SQUARE : SQUARE_FAR; g.lineWidth = 1; g.stroke();
    }
    if (params.tiles && current) {
      const data = zoneData(current.zone, current.band);
      if (data) {
        g.beginPath();
        const seen = new Set();
        for (const sq of data.squares) {
          const k = sq.E0 + "," + sq.N0;
          if (seen.has(k)) continue;
          seen.add(k);
          path(lineString(boxRing(sq.zone, current.south, sq.E0, sq.N0 + 100000 - SENTINEL_TILE_SIZE, SENTINEL_TILE_SIZE)));
        }
        g.strokeStyle = TILE; g.lineWidth = 1; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
      }
    }
    for (const nz of zones) {
      const gz = gridZoneBounds(nz.zone, nz.band);
      if (!gz) continue;
      const ring = [];
      for (let la = gz.south; la <= gz.north; la += 0.5) ring.push([gz.west, la]);
      for (let lo = gz.west; lo <= gz.east; lo += 0.5) ring.push([lo, gz.north]);
      for (let la = gz.north; la >= gz.south; la -= 0.5) ring.push([gz.east, la]);
      for (let lo = gz.east; lo >= gz.west; lo -= 0.5) ring.push([lo, gz.south]);
      g.beginPath(); path(lineString(ring));
      g.strokeStyle = nz.home ? BRASS : "rgba(184,82,23,.55)"; g.lineWidth = nz.home ? 2 : 1.25; g.stroke();
    }
    const view = [2, 2, map.width - 2, map.height - 2 - ctx.stage.insetBottom];
    const placed = [grow(panel.rect(), 4)];
    textBoxes = [];
    const put = (box) => {
      if (!within(box, view) || placed.some((b) => hits(grow(box, 2), b))) return false;
      placed.push(box); textBoxes.push(box);
      return true;
    };
    const byHome = [...zones].sort((a, b) => b.home - a.home);
    tileTag = null;
    if (params.tiles && current) {
      const tb = sentinelTileBounds(current.tile);
      const ll = tb && utmInverse(tb.xmin + SENTINEL_TILE_SIZE, tb.ymin, tb.zone, tb.south);
      const q = ll && P([ll.lon, ll.lat]);
      if (q && q[0] > view[0] && q[0] < view[2] && q[1] > view[1] && q[1] < view[3]) {
        g.font = `600 12px ${FONT_MONO}`;
        const w = g.measureText(current.tile).width;
        const x = clamp(q[0] - 4, view[0] + w, view[2]), y = clamp(q[1] + 4, view[1], view[3] - 12);
        if (put([x - w, y, x, y + 12])) tileTag = { x, y };
      }
    }
    const zoneTags = [];
    g.font = `600 13px ${FONT_MONO}`;
    for (const nz of byHome) {
      const gz = gridZoneBounds(nz.zone, nz.band);
      const q = gz && P([(gz.west + gz.east) / 2, gz.north]);
      if (!q) continue;
      const t = nz.zone + nz.band, w = g.measureText(t).width;
      if (put([q[0] - w / 2, q[1] - 13, q[0] + w / 2, q[1]])) zoneTags.push({ t, x: q[0], y: q[1], home: nz.home });
    }
    const excTags = [];
    if (params.exceptions) {
      let pickBox = null;
      if (current) {
        const E0 = Math.floor(current.E / 100000) * 100000, N0 = Math.floor(current.N / 100000) * 100000;
        const pts = boxRing(current.zone, current.south, E0, N0, 100000).map((ll) => P(ll)).filter(Boolean);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        if (pts.length) pickBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      g.font = `500 11px ${FONT_MONO}`;
      const c = map.pick(map.width / 2, map.height / 2);
      const home = current ? current.zone + current.band : "";
      for (const ez of [...excZones].sort((a, b) => (b.zone + b.band === home) - (a.zone + a.band === home))) {
        const lon = (ez.west + ez.east) / 2;
        const la = c ? clamp(c.lat, ez.south + 0.8, ez.north - 0.8) : (ez.south + ez.north) / 2;
        const p = P([lon, la]), n = P([lon, ez.north - 0.3]), s = P([lon, ez.south + 0.3]);
        if (!p || !n || !s) continue;
        const lo = Math.max(view[1] + 7, Math.min(n[1], s[1]) + 6), hi = Math.min(view[3] - 7, Math.max(n[1], s[1]) - 6);
        const t = ez.band === "V" ? (ez.zone === 32 ? "32V is wider" : "31V is narrower") : `${ez.zone}X is ${ez.east - ez.west}° wide`;
        const w = g.measureText(t).width;
        for (const dy of [0, 14, -14, 28, -28, 42, -42]) {
          const y = clamp(p[1] + dy, lo, hi), box = [p[0] - w / 2, y - 6, p[0] + w / 2, y + 6];
          if (Math.abs(y - p[1] - dy) > 8 || (pickBox && hits(box, pickBox))) continue;
          if (put(box)) { excTags.push({ t, x: p[0], y }); break; }
        }
      }
    }
    const sqTags = [];
    const fs = pxPerKm * 100 > 70 ? 12 : 10, minSq = compact ? 24 : 34;
    if (pxPerKm * 100 > minSq) {
      g.font = `500 ${fs}px ${FONT_MONO}`;
      for (const nz of byHome) {
        const data = zoneData(nz.zone, nz.band);
        if (!data) continue;
        for (const sq of data.squares) {
          const pts = sq.ring.map((ll) => P(ll));
          let sx = 0, sy = 0, n = 0, top = Infinity, bot = -Infinity;
          for (const q of pts) if (q) { sx += q[0]; sy += q[1]; n++; top = Math.min(top, q[1]); bot = Math.max(bot, q[1]); }
          if (!n) continue;
          const x = sx / n, y = sy / n;
          if (x < 0 || y < 0 || x > map.width || y > map.height) continue;
          const area = Math.abs(pts.reduce((a, p1, i) => { const p2 = pts[(i + 1) % pts.length]; return p1 && p2 ? a + p1[0] * p2[1] - p2[0] * p1[1] : a; }, 0)) / 2;
          if (area < (minSq - 4) ** 2) continue;
          const w = g.measureText(sq.square).width;
          for (const dy of [0, fs + 3, -fs - 3]) {
            const yy = y + dy;
            if (dy && (yy - fs / 2 < top + 2 || yy + fs / 2 > bot - 2)) continue;
            if (put([x - w / 2, yy - fs / 2, x + w / 2, yy + fs / 2])) { sqTags.push({ t: sq.square, x, y: yy, home: nz.home }); break; }
          }
        }
      }
    }
    g.textAlign = "center"; g.lineWidth = 3; g.strokeStyle = HALO;
    g.font = `500 ${fs}px ${FONT_MONO}`; g.textBaseline = "middle";
    for (const s of sqTags) { g.strokeText(s.t, s.x, s.y); g.fillStyle = s.home ? INK2 : INK3; g.fillText(s.t, s.x, s.y); }
    g.font = `600 13px ${FONT_MONO}`; g.textBaseline = "bottom";
    for (const s of zoneTags) { g.strokeText(s.t, s.x, s.y); g.fillStyle = s.home ? BRASS : "rgba(184,82,23,.7)"; g.fillText(s.t, s.x, s.y); }
    g.font = `500 11px ${FONT_MONO}`; g.textBaseline = "middle"; g.fillStyle = WARN;
    for (const s of excTags) { g.strokeText(s.t, s.x, s.y); g.fillText(s.t, s.x, s.y); }
  }, { order: 50 });

  map.addLayer(PREFIX + "pick", (g, path, P) => {
    if (!current) return;
    const E0 = Math.floor(current.E / 100000) * 100000, N0 = Math.floor(current.N / 100000) * 100000;
    const ring = boxRing(current.zone, current.south, E0, N0, 100000);
    g.beginPath(); path(lineString(ring));
    g.fillStyle = `rgba(184,82,23,${(0.14 + 0.2 * pulse).toFixed(3)})`; g.fill();
    g.strokeStyle = BRASS; g.lineWidth = 2.25 + 2.5 * pulse; g.stroke();
    if (params.tiles) {
      const tb = sentinelTileBounds(current.tile);
      if (tb) {
        g.beginPath(); path(lineString(boxRing(tb.zone, tb.south, tb.xmin, tb.ymin, SENTINEL_TILE_SIZE)));
        g.strokeStyle = SIGNAL; g.lineWidth = 1.75; g.stroke();
        if (tileTag) {
          g.font = `600 12px ${FONT_MONO}`; g.textAlign = "right"; g.textBaseline = "top";
          g.lineWidth = 3; g.strokeStyle = HALO; g.strokeText(current.tile, tileTag.x, tileTag.y);
          g.fillStyle = SIGNAL; g.fillText(current.tile, tileTag.x, tileTag.y);
        }
      }
    }
    const digits = digitsOf(params.precision);
    const size = Math.pow(10, 5 - digits);
    const ce = Math.floor(current.E / size) * size, cn = Math.floor(current.N / size) * size;
    const cell = boxRing(current.zone, current.south, ce, cn, size);
    g.beginPath(); path(lineString(cell));
    g.strokeStyle = SIGNAL; g.lineWidth = 1.5; g.stroke();
  }, { order: 56 });

  const refresh = (animate) => {
    current = info(params, animate);
    if (current) frame(animate);
    if (animate && !ctx.reducedMotion) {
      ctx.anim.tween({ from: 1, to: 0, duration: 700, ease: ctx.anim.ease.out, onUpdate: (v) => { pulse = v; map.invalidate(); } });
    }
    map.invalidate();
  };

  layout();
  current = info(params, false);
  if (current) await frame(false); else { homeKey = ""; }
  map.invalidate();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("point") || keys.includes("precision")) refresh(booted && keys.includes("point"));
      map.invalidate();
    },
    hover(lon, lat) { return hoverLines(lon, lat); },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() { layout(); map.invalidate(); },
    unmount() {
      map.labelLayer.avoid = null;
      panel.dispose();
      map.removePrefix(PREFIX);
      map.setFitTarget(null);
      map.setInsets({ top: 0, bottom: 0, left: 0, right: 0 });
      ctx.overlay.clear(PREFIX);
    },
  };
}

async function mount3D(ctx) {
  const globe = ctx.stage.globe;
  let params = { ...ctx.params };
  let booted = false;
  let current = null;
  let zonesBuilt = false;
  const setPoint = (p, precision) => {
    if (precision !== params.precision) ctx.controls.set("precision", precision);
    ctx.controls.set("point", p);
  };
  const { panel, info, hoverLines } = shared(ctx, () => params, setPoint);
  const layout = () => {
    globe.labelInsetBottom = ctx.stage.insetBottom;
    panel.setCompact(isCompact(ctx.stage.width, ctx.stage.height), ctx.stage.width);
  };
  layout();
  globe.labelLayer.avoid = () => [grow(panel.rect(), 6)];
  globe.addLabel3D(PREFIX + "sq-label", null, "", { color: BRASS, dx: 10, dy: -22 });
  globe.addLabel3D(PREFIX + "tile-label", null, "", { color: SIGNAL, dx: 8, dy: 6 });

  const ringSegs = (ring) => { const s = []; for (let i = 1; i < ring.length; i++) s.push([ring[i - 1], ring[i]]); return s; };

  const drawZones = () => {
    if (!zonesBuilt) {
      const segs = [];
      for (const gz of gridZones()) {
        for (let la = gz.south; la < gz.north; la += 1) segs.push([[gz.west, la], [gz.west, Math.min(la + 1, gz.north)]]);
        for (let lo = gz.west; lo < gz.east; lo += 1) segs.push([[lo, gz.north], [Math.min(lo + 1, gz.east), gz.north]]);
        if (gz.south === -80) for (let lo = gz.west; lo < gz.east; lo += 1) segs.push([[lo, -80], [Math.min(lo + 1, gz.east), -80]]);
      }
      globe.addLines(PREFIX + "zones", segs, { color: "rgba(184,82,23,.6)", width: 1.25 });
      zonesBuilt = true;
    }
    const exc = [];
    for (const ez of exceptionZones()) {
      const ring = [];
      for (let la = ez.south; la <= ez.north; la += 1) ring.push([ez.west, la]);
      for (let lo = ez.west; lo <= ez.east; lo += 1) ring.push([lo, ez.north]);
      for (let la = ez.north; la >= ez.south; la -= 1) ring.push([ez.east, la]);
      for (let lo = ez.east; lo >= ez.west; lo -= 1) ring.push([lo, ez.south]);
      exc.push(...ringSegs(ring));
    }
    globe.addLines(PREFIX + "exc", exc, { color: WARN, width: 2, dash: [5, 3] });
    globe.setLayer(PREFIX + "exc", !!params.exceptions);
  };

  const drawLocal = () => {
    if (!current) { globe.remove(PREFIX + "squares"); globe.remove(PREFIX + "pick"); globe.remove(PREFIX + "tiles"); globe.remove(PREFIX + "tile"); return; }
    const [lon, lat] = params.point;
    const segs = [], far = [];
    for (const nz of neighbourZones(lon, lat)) {
      const data = zoneData(nz.zone, nz.band);
      if (!data) continue;
      for (const sq of data.squares) (nz.home ? segs : far).push(...ringSegs(sq.ring));
    }
    globe.addLines(PREFIX + "squares", segs, { color: SQUARE, width: 1 });
    globe.addLines(PREFIX + "squares-far", far, { color: SQUARE_FAR, width: 1 });
    const E0 = Math.floor(current.E / 100000) * 100000, N0 = Math.floor(current.N / 100000) * 100000;
    globe.addLines(PREFIX + "pick", ringSegs(boxRing(current.zone, current.south, E0, N0, 100000)), { color: BRASS, width: 2.5 });
    const tb = sentinelTileBounds(current.tile);
    if (tb && params.tiles) {
      const data = zoneData(current.zone, current.band);
      const tsegs = [];
      const seen = new Set();
      for (const sq of data ? data.squares : []) {
        const k = sq.E0 + "," + sq.N0;
        if (seen.has(k)) continue;
        seen.add(k);
        tsegs.push(...ringSegs(boxRing(sq.zone, current.south, sq.E0, sq.N0 + 100000 - SENTINEL_TILE_SIZE, SENTINEL_TILE_SIZE)));
      }
      globe.addLines(PREFIX + "tiles", tsegs, { color: TILE, width: 1, dash: [4, 3] });
      globe.addLines(PREFIX + "tile", ringSegs(boxRing(tb.zone, tb.south, tb.xmin, tb.ymin, SENTINEL_TILE_SIZE)), { color: SIGNAL, width: 2 });
      const ll = utmInverse(tb.xmin + SENTINEL_TILE_SIZE, tb.ymin, tb.zone, tb.south);
      globe.setLabel3D(PREFIX + "tile-label", { point: surface(ll.lon, ll.lat), text: current.tile });
    } else {
      globe.remove(PREFIX + "tiles"); globe.remove(PREFIX + "tile");
      globe.setLabel3D(PREFIX + "tile-label", { text: "" });
    }
    const c = utmInverse(E0, N0 + 100000, current.zone, current.south);
    globe.setLabel3D(PREFIX + "sq-label", { point: surface(c.lon, c.lat), text: `${current.zone}${current.band} ${current.square}` });
  };

  const surface = (lon, lat) => { const p = Math.cos(lat * Math.PI / 180); return [p * Math.sin(lon * Math.PI / 180), Math.sin(lat * Math.PI / 180), p * Math.cos(lon * Math.PI / 180)]; };

  const look = (animate) => {
    if (ctx.side !== "A") return;
    const [lon, lat] = params.point;
    globe.camera.lookAt(lon, lat, Math.min(globe.camera.dist, meta.view.dist), { duration: animate && !ctx.reducedMotion ? 650 : 0 });
  };

  current = info(params, false);
  drawZones();
  drawLocal();
  setTimeout(() => { booted = true; }, 0);

  return {
    update(p, keys) {
      params = { ...p };
      if (keys.includes("point") || keys.includes("precision")) current = info(params, booted && keys.includes("point"));
      if (keys.includes("point") || keys.includes("tiles")) drawLocal();
      if (keys.includes("exceptions")) globe.setLayer(PREFIX + "exc", !!params.exceptions);
      if (keys.includes("point") && booted) look(true);
    },
    hover(lon, lat) { return hoverLines(lon, lat); },
    probe(lon, lat) {
      ctx.controls.set("point", [+lon.toFixed(5), +lat.toFixed(5)]);
      return {};
    },
    unprobe() {},
    resize() { layout(); },
    unmount() {
      globe.labelLayer.avoid = null;
      panel.dispose();
      globe.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
    },
  };
}
