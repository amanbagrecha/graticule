export const EARTH_RADIUS = 6378137;
export const MAX_LAT = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI;
export const TILE_SIZE = 256;

export function tile(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const p = (la * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * n);
  return { z, x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

const tileLat = (y, n) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

export function bounds(z, x, y) {
  const n = 2 ** z;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: tileLat(y, n), south: tileLat(y + 1, n) };
}

export function quadkey(z, x, y) {
  let q = "";
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    q += String((x & m ? 1 : 0) + (y & m ? 2 : 0));
  }
  return q;
}

export function fromQuadkey(q) {
  let x = 0, y = 0;
  const z = q.length;
  for (let i = z; i > 0; i--) {
    const m = 1 << (i - 1);
    const d = +q[z - i];
    if (d & 1) x |= m;
    if (d & 2) y |= m;
  }
  return { z, x, y };
}

export function resolution(z, lat = 0, tileSize = TILE_SIZE) {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos((lat * Math.PI) / 180)) / (tileSize * 2 ** z);
}

export function scaleDenominator(z, lat = 0, pixelM = 0.00028, tileSize = TILE_SIZE) {
  return resolution(z, lat, tileSize) / pixelM;
}

export function tileCount(z) {
  return 4 ** z;
}

export function children(z, x, y) {
  return [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]].map(([cx, cy]) => ({ z: z + 1, x: cx, y: cy }));
}

export function parent(z, x, y) {
  return z > 0 ? { z: z - 1, x: x >> 1, y: y >> 1 } : null;
}
