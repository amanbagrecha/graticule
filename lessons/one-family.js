import { factors, familyMember, familyCap } from "@/core/projections.js";
import { smallCircle } from "@/core/map2d.js";
import { DEG } from "@/core/math.js";

const BRASS = "#b85217";
const BLUE = "#1d63a8";
const INK = "#1a1917";
const PAD = 28;
const CAP_EDGE = 20;
const R = 5;
const MORPH_MS = 650;
const CYL_LON = 90;

export const SURFACES = [
  { value: "cylinder", label: "Cylinder" },
  { value: "cone", label: "Cone" },
  { value: "plane", label: "Plane" },
];
export const KEEPS = [
  { value: "conformal", label: "Angles" },
  { value: "equal-area", label: "Area" },
  { value: "equidistant", label: "Distance" },
];
export const LAT1 = { cylinder: 0, cone: 40, plane: 90 };
export const MARK = { cylinder: [0, 60], cone: [0, 0], plane: [0, 0] };
export const GRID_LATS = [0, 20, 40, 60];
export const GRID_LONS = Array.from({ length: 12 }, (_, i) => -180 + 30 * i);

export const NAMES = {
  conformal: { cylinder: "Mercator", cone: "Lambert conformal conic", plane: "Polar stereographic" },
  "equal-area": { cylinder: "Lambert cylindrical equal-area", cone: "Albers equal-area conic", plane: "Lambert azimuthal equal-area" },
  equidistant: { cylinder: "Plate carrée", cone: "Equidistant conic", plane: "Azimuthal equidistant" },
};

export const meta = {
  id: "one-family",
  title: "Angles, area or distance",
  track: 2,
  order: 5,
  mode: "2d",
  renderer: "canvas2d",
  labels: false,
  projectionId: "mercator",
  paragraph: "A sea chart needs true angles; a forest map needs true area. Each surface can keep angles, area or distance, not all three. Blue shapes are equal circles on the globe. Next, turn the cylinder to your area.",
  deeper: [
    "No flat map keeps angles, area and distance all true. Gauss proved this in 1827.",
    "Maps that keep angles: Mercator, the Lambert conformal conic and the polar stereographic.",
    "Maps that keep area: the Lambert cylindrical equal-area, the Albers conic and the Lambert azimuthal equal-area.",
    "The plate carrée and the equidistant conic keep distance along the meridians. The azimuthal equidistant map keeps distance from the centre.",
  ],
  keywords: ["conformal", "equal-area", "equidistant", "Tissot", "distortion"],
  controls: [
    { key: "surface", type: "segment", label: "Surface", options: SURFACES, default: "cylinder" },
    { key: "property", type: "segment", label: "Keep", options: KEEPS, default: "conformal" },
  ],
  readouts: [{ key: "name", label: "Map name", mono: false, hero: true }],
  transport: null,
  compare: null,
  view: null,
  data: [],
};

const PREFIX = meta.id + ":";

export function projectionFor(property, surface) {
  return familyMember(property, LAT1[surface], "north", { edge: CAP_EDGE });
}

export function capTop(surface) {
  return familyCap(LAT1[surface], "north", CAP_EDGE).coordinates[0][0][1];
}

export function fitTarget(surface) {
  if (surface === "plane") return { type: "Sphere" };
  if (surface === "cone") return familyCap(LAT1.cone, "north", CAP_EDGE);
  const top = capTop("cylinder"), ring = [];
  for (let lon = -CYL_LON; lon <= CYL_LON; lon += 2) ring.push([lon, top]);
  for (let lon = CYL_LON; lon >= -CYL_LON; lon -= 2) ring.push([lon, -CAP_EDGE]);
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

export function heroBox(W, H, insetBottom = 0) {
  return [[PAD, PAD], [W - PAD, Math.max(PAD + 1, H - insetBottom - PAD)]];
}

export function fitted(property, surface, box) {
  const p = projectionFor(property, surface);
  p.precision(0.3).fitExtent(box, fitTarget(surface));
  return p;
}

const trueLineScale = (p, surface) => factors(p, 0, surface === "plane" ? 89.999 : LAT1[surface]).k;

export function distortion(property, surface, lon, lat, p = null) {
  const P = p || projectionFor(property, surface).scale(1).translate([0, 0]);
  const f = factors(P, lon, lat);
  if (!f) return null;
  const k0 = trueLineScale(P, surface);
  return { area: f.areaScale / (k0 * k0), shape: f.a / f.b, northSouth: f.h / k0, eastWest: f.k / k0 };
}

const times = (v) => `${v.toFixed(1)}×`;
const areaText = (a) => (Math.abs(a - 1) < 0.05 ? "area true here" : a > 1 ? `area ${times(a)} too big` : `area ${times(1 / a)} too small`);
const shapeText = (s) => (s < 1.05 ? "shape true here" : `shape squashed ${times(s)}`);

export function verdict(property, d) {
  if (property === "conformal") return ["Shape kept", areaText(d.area)];
  if (property === "equal-area") return ["Area kept", shapeText(d.shape)];
  return ["North–south length kept", areaText(d.area)];
}

export function markText(property, surface) {
  const [lon, lat] = MARK[surface];
  const [kept, lost] = verdict(property, distortion(property, surface, lon, lat));
  return `${kept}, ${lost}`;
}

export function touchText(surface) {
  return surface === "plane" ? "Touching point: map true here" : "Touching line: map true here";
}

export async function mount(ctx) {
  const map = ctx.stage.map;
  const params = { ...ctx.params };
  let hero = null;
  let shown = "";
  let booted = false;

  const box = () => heroBox(ctx.stage.width, ctx.stage.height, ctx.stage.insetBottom);

  const lineLL = () => Array.from({ length: 181 }, (_, i) => [-180 + 2 * i, LAT1[params.surface]]);

  map.addLayer(PREFIX + "tissot", (g, path, P) => {
    const [mlon, mlat] = MARK[params.surface];
    g.beginPath();
    for (const lat of GRID_LATS) for (const lon of GRID_LONS) if (lon !== mlon || lat !== mlat) path({ type: "Polygon", coordinates: [smallCircle(lon, lat, R, 36)] });
    g.fillStyle = "rgba(29,99,168,.14)"; g.fill();
    g.lineWidth = 1; g.strokeStyle = "rgba(29,99,168,.75)"; g.stroke();
    g.beginPath(); path({ type: "Polygon", coordinates: [smallCircle(mlon, mlat, R, 72)] });
    g.fillStyle = "rgba(29,99,168,.3)"; g.fill();
    g.lineWidth = 2; g.strokeStyle = BLUE; g.stroke();
    const c = P([mlon, mlat]);
    if (!c || map.morph) return;
    const r = R * DEG * P.scale() * trueLineScale(P, params.surface);
    g.beginPath(); g.arc(c[0], c[1], r, 0, 2 * Math.PI);
    g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke(); g.setLineDash([]);
  }, { order: 56 });

  map.addLayer(PREFIX + "line", (g, path, P) => {
    g.strokeStyle = BRASS; g.fillStyle = BRASS;
    if (params.surface === "plane") {
      const c = P([0, 90]);
      if (c) { g.beginPath(); g.arc(c[0], c[1], 4, 0, 2 * Math.PI); g.fill(); }
      return;
    }
    g.beginPath(); path({ type: "LineString", coordinates: lineLL() });
    g.lineWidth = 2.5; g.stroke();
  }, { order: 55 });

  map.addLayer(PREFIX + "mask", (g, path) => {
    if (params.surface === "plane") return;
    const cap = fitTarget(params.surface);
    g.globalCompositeOperation = "destination-in";
    g.beginPath(); path(cap); g.fillStyle = "#000"; g.fill();
    g.globalCompositeOperation = "source-over";
    g.beginPath(); path(cap); g.lineWidth = 1; g.strokeStyle = ctx.palette.lines.outline; g.stroke();
  }, { order: 50, clip: false });

  const placeLabels = () => {
    const s = params.surface, [mlon, mlat] = MARK[s];
    const touch = s === "plane" ? { lon: 0, lat: 90 } : { lon: s === "cone" ? -100 : -75, lat: LAT1[s] };
    ctx.overlay.label(PREFIX + "touch", touch, touchText(s), { color: BRASS, mono: false, dx: 10, dy: s === "plane" ? -26 : -24 });
    const east = { lon: mlon + (R / Math.cos(mlat * DEG)) * 1.02, lat: mlat };
    ctx.overlay.label(PREFIX + "mark", east, markText(params.property, s), { color: BLUE, mono: false, leader: true, dx: 14, dy: -26 });
    const c = hero([mlon, mlat]);
    const r = R * DEG * hero.scale() * trueLineScale(hero, s);
    const west = c && hero.invert([c[0] - r, c[1]]);
    if (!west) return;
    const item = ctx.overlay.label(PREFIX + "true", { lon: west[0], lat: west[1] }, "True size", { color: INK, mono: false, leader: true, dx: -90, dy: 22 });
    const w = item.el.offsetWidth;
    if (w) { item.dx = -w - 18; ctx.overlay.update(); }
  };

  const setHero = async (animate) => {
    hero = fitted(params.property, params.surface, box());
    const tag = [params.property, params.surface, box().flat().join(",")].join("|");
    if (tag === shown) return;
    shown = tag;
    ctx.readout.set("name", NAMES[params.property][params.surface]);
    const glide = animate && booted && !ctx.reducedMotion && !map.morph;
    if (glide) ctx.overlay.clear(PREFIX);
    await map.setProjection(hero, { duration: glide ? MORPH_MS : 0, opts: { fit: false }, tag });
    if (shown !== tag) return;
    placeLabels();
    map.invalidate();
  };

  await setHero(false);
  booted = true;

  return {
    update(p, keys) {
      Object.assign(params, p);
      if (keys.includes("surface") || keys.includes("property")) setHero(keys.length < 2);
    },
    hover(lon, lat) {
      if (lat > capTop(params.surface) || lat < -CAP_EDGE || (params.surface === "cylinder" && Math.abs(lon) > CYL_LON)) return [];
      const d = distortion(params.property, params.surface, lon, lat, hero);
      return d ? verdict(params.property, d).map((t) => t[0].toUpperCase() + t.slice(1)) : [];
    },
    probe() { return {}; },
    unprobe() {},
    resize() { setHero(false); },
    unmount() {
      map.removePrefix(PREFIX);
      ctx.overlay.clear(PREFIX);
      ctx.overlay.hideChip();
    },
  };
}
