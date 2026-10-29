import { zone as utmZone, band as utmBand, forward as utmForward, inverse as utmInverse, gridZoneBounds, bandBounds, centralMeridian } from "@/core/utm.js";

const COLS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROWS = "ABCDEFGHJKLMNPQRSTUV";
const SOUTH_BANDS = "CDEFGHJKLM";

export const SENTINEL_TILE_SIZE = 109800;

const isSouthBand = (b) => SOUTH_BANDS.includes(b);

function squareLetters(z, E, N) {
  const col = Math.floor(E / 100000);
  const row = Math.floor(N / 100000);
  const c = COLS[(z - 1) % 3][col - 1];
  const r = ROWS[(((row + (z % 2 === 0 ? 5 : 0)) % 20) + 20) % 20];
  return c && r ? c + r : null;
}

export function toMGRS(lon, lat, precision = 5) {
  if (!(lat >= -80 && lat <= 84)) return null;
  const z = utmZone(lon, lat);
  const b = utmBand(lat);
  const { E, N } = utmForward(lon, lat, z, lat < 0);
  const sq = squareLetters(z, E, N);
  if (!sq) return null;
  const head = String(z) + b;
  if (precision <= 0) return `${head} ${sq}`;
  const div = Math.pow(10, 5 - precision);
  const e = String(Math.floor((E % 100000) / div + 1e-9)).padStart(precision, "0");
  const n = String(Math.floor((N % 100000) / div + 1e-9)).padStart(precision, "0");
  return `${head} ${sq} ${e} ${n}`;
}

function minNorthing(z, b) {
  const south = isSouthBand(b);
  const lat = bandBounds(b).south;
  const cm = centralMeridian(z);
  let min = Infinity;
  for (const dl of [0, -3, 3, -4.5, 4.5]) {
    const N = utmForward(cm + dl, lat, z, south).N;
    if (N < min) min = N;
  }
  if (!south && lat === 0) min = 0;
  return Math.floor(min / 100000) * 100000;
}

export function parseMGRS(ref) {
  const s = String(ref).replace(/\s+/g, "").toUpperCase();
  const m = s.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
  if (!m || m[5].length % 2) return null;
  const z = +m[1];
  if (z < 1 || z > 60) return null;
  const p = m[5].length / 2;
  return { zone: z, band: m[2], col: m[3], row: m[4], precision: p, e: p ? +m[5].slice(0, p) : 0, n: p ? +m[5].slice(p) : 0 };
}

export function fromMGRS(ref) {
  const r = parseMGRS(ref);
  if (!r) return null;
  const { zone: z, band: b } = r;
  const colIdx = COLS[(z - 1) % 3].indexOf(r.col);
  let rowIdx = ROWS.indexOf(r.row);
  if (colIdx < 0 || rowIdx < 0) return null;
  rowIdx = (rowIdx - (z % 2 === 0 ? 5 : 0) + 20) % 20;
  const size = Math.pow(10, 5 - r.precision);
  const E0 = (colIdx + 1) * 100000;
  let N0 = rowIdx * 100000;
  const minN = minNorthing(z, b);
  while (N0 < minN) N0 += 2000000;
  const E = E0 + r.e * size;
  const N = N0 + r.n * size;
  const south = isSouthBand(b);
  const sw = utmInverse(E, N, z, south);
  const c = utmInverse(E + size / 2, N + size / 2, z, south);
  return { lon: sw.lon, lat: sw.lat, E, N, zone: z, band: b, square: r.col + r.row, precision: r.precision, size, south, centre: [c.lon, c.lat] };
}

export function sentinelTile(lon, lat) {
  const ref = toMGRS(lon, lat, 0);
  return ref ? "T" + ref.replace(/\s+/g, "").padStart(5, "0") : null;
}

export function sentinelTileBounds(id) {
  const s = String(id).replace(/^T/i, "");
  const r = fromMGRS(s);
  if (!r) return null;
  const E0 = Math.floor(r.E / 100000) * 100000;
  const N0 = Math.floor(r.N / 100000) * 100000;
  return { zone: r.zone, band: r.band, south: r.south, square: r.square, xmin: E0, xmax: E0 + SENTINEL_TILE_SIZE, ymax: N0 + 100000, ymin: N0 + 100000 - SENTINEL_TILE_SIZE };
}

export function squareRing(z, south, E0, N0, size = 100000, steps = 8) {
  const pts = [];
  const push = (E, N) => {
    const p = utmInverse(E, N, z, south);
    pts.push([p.lon, p.lat]);
  };
  for (let i = 0; i < steps; i++) push(E0, N0 + (size * i) / steps);
  for (let i = 0; i < steps; i++) push(E0 + (size * i) / steps, N0 + size);
  for (let i = 0; i < steps; i++) push(E0 + size, N0 + size - (size * i) / steps);
  for (let i = 0; i < steps; i++) push(E0 + size - (size * i) / steps, N0);
  pts.push(pts[0].slice());
  return pts;
}

function clipRing(ring, g) {
  const edges = [
    (p) => p[0] >= g.west, (p) => p[0] <= g.east, (p) => p[1] >= g.south, (p) => p[1] <= g.north,
  ];
  const cut = [
    (a, b) => { const t = (g.west - a[0]) / (b[0] - a[0]); return [g.west, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (g.east - a[0]) / (b[0] - a[0]); return [g.east, a[1] + t * (b[1] - a[1])]; },
    (a, b) => { const t = (g.south - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), g.south]; },
    (a, b) => { const t = (g.north - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), g.north]; },
  ];
  let out = ring.slice(0, -1);
  for (let k = 0; k < 4 && out.length; k++) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = edges[k](a), ib = edges[k](b);
      if (ib) {
        if (!ia) out.push(cut[k](a, b));
        out.push(b);
      } else if (ia) out.push(cut[k](a, b));
    }
  }
  if (out.length < 3) return null;
  out.push(out[0].slice());
  return out;
}

export function squaresInZone(z, b, steps = 8) {
  const g = gridZoneBounds(z, b);
  if (!g) return [];
  const south = isSouthBand(b.toUpperCase());
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  const n = 24;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const lon = g.west + ((g.east - g.west) * i) / n;
    const lat = g.south + ((g.north - g.south) * j) / n;
    const { E, N } = utmForward(lon, lat, z, south);
    minE = Math.min(minE, E); maxE = Math.max(maxE, E);
    minN = Math.min(minN, N); maxN = Math.max(maxN, N);
  }
  const out = [];
  const lon0 = centralMeridian(z);
  const unwrap = (ring) => ring.map(([lo, la]) => [lo - lon0 > 180 ? lo - 360 : lo - lon0 < -180 ? lo + 360 : lo, la]);
  for (let E0 = Math.max(100000, Math.floor(minE / 100000) * 100000); E0 < maxE && E0 < 900000; E0 += 100000) {
    for (let N0 = Math.floor(minN / 100000) * 100000; N0 < maxN; N0 += 100000) {
      const ring = clipRing(unwrap(squareRing(z, south, E0, N0, 100000, steps)), g);
      if (!ring) continue;
      const sq = squareLetters(z, E0 + 1, N0 + 1);
      out.push({ zone: z, band: g.band, square: sq, id: String(z).padStart(2, "0") + g.band + sq, E0, N0, ring });
    }
  }
  return out;
}
