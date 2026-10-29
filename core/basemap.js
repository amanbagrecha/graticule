import * as d3 from "d3";
import { assetUrl } from "@/core/env.js";
import { loadGridI16, loadTopo, loadGeoJSON, loadImage } from "@/core/data.js";
import { oceanLUT, landLUT, hexToRgb, ice, iceShelf, lake } from "@/core/palette.js";

export const WIDTH = 4096;
export const HEIGHT = 2048;
const VERSION = "graticule-basemap-v4";
const pending = new Map();

const equirect = d3.geoEquirectangular().scale(WIDTH / (2 * Math.PI)).translate([WIDTH / 2, HEIGHT / 2]).precision(0.2);

function rings(fc, pick) {
  const out = [];
  const feats = pick ? fc.features.filter(pick) : fc.features;
  const projected = d3.geoProject({ type: "FeatureCollection", features: feats }, equirect);
  for (const f of projected.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) out.push(ring);
  }
  return out;
}

async function fromCache(key) {
  if (typeof caches === "undefined") return null;
  try {
    const c = await caches.open(VERSION);
    const parts = await Promise.all(["color", "mask", "hillshade", "normal"].map((p) => c.match(`/${key}/${p}`)));
    if (parts.some((p) => !p)) return null;
    const [color, mask, hillshade, normal] = await Promise.all(parts.map((p) => p.arrayBuffer()));
    return { color: new Uint8ClampedArray(color), mask: new Uint8Array(mask), hillshade: new Uint8Array(hillshade), normal: new Uint8ClampedArray(normal) };
  } catch (e) { return null; }
}

async function toCache(key, bm) {
  if (typeof caches === "undefined") return;
  try {
    const c = await caches.open(VERSION);
    const put = (p, arr) => c.put(`/${key}/${p}`, new Response(arr.slice().buffer, { headers: { "content-type": "application/octet-stream" } }));
    await Promise.all([put("color", bm.color), put("mask", bm.mask), put("hillshade", bm.hillshade), put("normal", bm.normal)]);
  } catch (e) { }
}

async function satellitePixels() {
  const img = await loadImage("earth_bluemarble_5400.jpg");
  const cv = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
  return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
}

async function build(colour) {
  const t0 = performance.now();
  const [etopo, landFc, countries, lakes, sat] = await Promise.all([
    loadGridI16("etopo_15m.i16"), loadTopo("land-50m.json", "land"), loadTopo("countries-50m.json", "countries"),
    loadGeoJSON("ne_50m_lakes.geojson"), colour === "satellite" ? satellitePixels() : null
  ]);
  const msg = {
    W: WIDTH, H: HEIGHT, etopo: etopo.data, ew: etopo.width, eh: etopo.height,
    lutOcean: oceanLUT(), lutLand: landLUT(), ice: hexToRgb(ice), shelf: hexToRgb(iceShelf), lake: hexToRgb(lake),
    rings: {
      land: rings(landFc),
      antarctica: rings(countries, (f) => f.properties.name === "Antarctica"),
      greenland: rings(countries, (f) => f.properties.name === "Greenland"),
      lakes: rings(lakes, (f) => f.properties.scalerank <= 7)
    },
    satellite: sat, zFactor: 6
  };
  const worker = new Worker(assetUrl("workers/basemap.js"), { type: "module" });
  const result = await new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(new Error("basemap worker: " + e.message));
    worker.postMessage(msg, sat ? [sat.buffer] : []);
  });
  worker.terminate();
  result.ms = performance.now() - t0;
  result.workerMs = result.ms;
  return result;
}

export function getBasemap({ colour = "ramp" } = {}) {
  const key = colour === "satellite" ? "satellite" : "ramp";
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const t0 = performance.now();
    const cached = await fromCache(key);
    if (cached) return { ...cached, width: WIDTH, height: HEIGHT, colour: key, ms: performance.now() - t0, cached: true };
    const r = await build(key);
    const bm = { color: r.color, mask: r.mask, hillshade: r.hillshade, normal: r.normal, width: WIDTH, height: HEIGHT, colour: key, ms: performance.now() - t0, cached: false };
    toCache(key, bm);
    return bm;
  })();
  pending.set(key, p);
  p.catch(() => pending.delete(key));
  return p;
}

export function readBasemapCache(colour = "ramp") { return fromCache(colour === "satellite" ? "satellite" : "ramp"); }

export async function clearBasemapCache() {
  pending.clear();
  if (typeof caches !== "undefined") await caches.delete(VERSION);
}

export function sampleColor(bm, lon, lat) {
  const x = Math.min(Math.max(Math.floor(((lon + 180) / 360) * bm.width), 0), bm.width - 1);
  const y = Math.min(Math.max(Math.floor(((90 - lat) / 180) * bm.height), 0), bm.height - 1);
  const i = (y * bm.width + x) * 4;
  return [bm.color[i], bm.color[i + 1], bm.color[i + 2]];
}
