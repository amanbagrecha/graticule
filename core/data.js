import * as d3 from "d3";
import { dataUrl } from "@/core/env.js";

const cache = new Map();

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

async function fetchOk(name) {
  const r = await fetch(dataUrl(name));
  if (!r.ok) throw new Error(`data ${name}: HTTP ${r.status}`);
  return r;
}

export function loadJSON(name) {
  return memo("json:" + name, async () => (await fetchOk(name)).json());
}

export function loadGeoJSON(name) { return loadJSON(name); }

export function loadTopology(name) { return loadJSON(name); }

export function loadTopo(name, object) {
  return memo(`topo:${name}:${object || ""}`, async () => {
    const topo = await loadJSON(name);
    const key = object || Object.keys(topo.objects)[0];
    return d3.topojson.feature(topo, topo.objects[key]);
  });
}

export function loadMesh(name, object, filter) {
  return memo(`mesh:${name}:${object || ""}:${filter ? filter.name || "f" : ""}`, async () => {
    const topo = await loadJSON(name);
    const key = object || Object.keys(topo.objects)[0];
    return filter ? d3.topojson.mesh(topo, topo.objects[key], filter) : d3.topojson.mesh(topo, topo.objects[key]);
  });
}

export function loadBuffer(name) {
  return memo("buf:" + name, async () => (await fetchOk(name)).arrayBuffer());
}

export function loadGridI16(name) {
  return memo("grid:" + name, async () => {
    const [grids, buf] = await Promise.all([loadJSON("grids.json"), loadBuffer(name)]);
    const meta = grids[name];
    if (!meta) throw new Error(`grids.json has no entry for ${name}`);
    const data = new Int16Array(buf);
    const m = /row 0 = (-?[\d.]+)([NS]), col 0 = (-?[\d.]+)([EW])/.exec(meta.origin);
    const originRow0Lat = m ? parseFloat(m[1]) * (m[2] === "S" ? -1 : 1) : 90;
    const originCol0Lon = m ? parseFloat(m[3]) * (m[4] === "W" ? -1 : 1) : -180;
    const step = meta.step_deg;
    const { width, height } = meta;
    const wraps = Math.abs(width * step - 360) < 1e-6;
    const scale = /centimetre/.test(meta.what) ? 0.01 : 1;
    function sample(lon, lat) {
      let c = (lon - originCol0Lon) / step;
      if (wraps) c = ((c % width) + width) % width;
      else c = Math.min(Math.max(c, 0), width - 1);
      const r = Math.min(Math.max((originRow0Lat - lat) / step, 0), height - 1);
      const c0 = Math.floor(c), r0 = Math.floor(r);
      const c1 = wraps ? (c0 + 1) % width : Math.min(c0 + 1, width - 1);
      const r1 = Math.min(r0 + 1, height - 1);
      const fx = c - c0, fy = r - r0;
      const a = data[r0 * width + c0], b = data[r0 * width + c1], d = data[r1 * width + c0], e = data[r1 * width + c1];
      return ((a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy) * scale;
    }
    function at(col, row) { return data[row * width + col] * scale; }
    return { name, width, height, data, originRow0Lat, originCol0Lon, step, registration: meta.registration, scale, wraps, sample, at, meta };
  });
}

export function loadImage(name) {
  return memo("img:" + name, async () => createImageBitmap(await (await fetchOk(name)).blob()));
}

let cityList = null;
export function loadCities() {
  return memo("cities", async () => {
    const g = await loadJSON("ne_110m_populated_places_simple.geojson");
    cityList = g.features.map((f) => ({
      name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      rank: f.properties.scalerank, pop: f.properties.pop_max, capital: f.properties.adm0cap === 1
    })).sort((a, b) => a.rank - b.rank || b.pop - a.pop);
    return cityList;
  });
}

export function cities(rankMax = 2) {
  if (!cityList) { loadCities(); return []; }
  return cityList.filter((c) => c.rank <= rankMax);
}

export function loadLabels() { return loadJSON("labels.json"); }

export function clearCache() { cache.clear(); cityList = null; }
