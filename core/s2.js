import { DEG, RAD, sphericalPolygonArea } from "@/core/math.js";

export const MAX_LEVEL = 30;
const MAX_SIZE = 1 << 30;
const POS_TO_IJ = [[0, 1, 3, 2], [0, 2, 3, 1], [3, 2, 0, 1], [3, 1, 0, 2]];
const POS_TO_ORIENT = [1, 0, 0, 3];
const IJ_TO_POS = POS_TO_IJ.map((row) => {
  const inv = [0, 0, 0, 0];
  row.forEach((ij, pos) => { inv[ij] = pos; });
  return inv;
});

export const FACE_CENTRES = [[0, 0], [90, 0], [0, 90], [180, 0], [-90, 0], [0, -90]];

export function lonLatToXYZ(lon, lat) {
  const l = lon * DEG, p = lat * DEG, c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

export function xyzToLonLat([x, y, z]) {
  return [Math.atan2(y, x) * RAD, Math.atan2(z, Math.hypot(x, y)) * RAD];
}

export function faceOf([x, y, z]) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let f = ax > ay ? (ax > az ? 0 : 2) : ay > az ? 1 : 2;
  if ([x, y, z][f] < 0) f += 3;
  return f;
}

export function faceUV(xyz, face = faceOf(xyz)) {
  const [x, y, z] = xyz;
  let u, v;
  switch (face) {
    case 0: u = y / x; v = z / x; break;
    case 1: u = -x / y; v = z / y; break;
    case 2: u = -x / z; v = -y / z; break;
    case 3: u = z / x; v = y / x; break;
    case 4: u = z / y; v = -x / y; break;
    default: u = -y / z; v = -x / z; break;
  }
  return { face, u, v };
}

export function uvToXYZ(face, u, v) {
  switch (face) {
    case 0: return [1, u, v];
    case 1: return [-u, 1, v];
    case 2: return [-u, -v, 1];
    case 3: return [-1, -v, -u];
    case 4: return [v, -1, -u];
    default: return [v, u, -1];
  }
}

export function stToUV(s) {
  return s >= 0.5 ? (1 / 3) * (4 * s * s - 1) : (1 / 3) * (1 - 4 * (1 - s) * (1 - s));
}

export function uvToST(u) {
  return u >= 0 ? 0.5 * Math.sqrt(1 + 3 * u) : 1 - 0.5 * Math.sqrt(1 - 3 * u);
}

export const stToUVLinear = (s) => 2 * s - 1;
export const uvToSTLinear = (u) => 0.5 * (u + 1);

const lsbForLevel = (level) => 1n << BigInt(2 * (MAX_LEVEL - level));

function leafPos(face, i, j) {
  let orient = face & 1;
  let pos = 0n;
  for (let k = MAX_LEVEL - 1; k >= 0; k--) {
    const ij = (((i >>> k) & 1) << 1) | ((j >>> k) & 1);
    const p = IJ_TO_POS[orient][ij];
    pos = (pos << 2n) | BigInt(p);
    orient ^= POS_TO_ORIENT[p];
  }
  return pos;
}

export function levelOf(id) {
  let lsb = id & -id;
  let level = MAX_LEVEL;
  while (lsb > 1n) { lsb >>= 2n; level--; }
  return level;
}

export function token(id) {
  if (id === 0n) return "X";
  return id.toString(16).padStart(16, "0").replace(/0+$/, "");
}

export function idFromToken(t) {
  if (t === "X" || t === "x") return 0n;
  return BigInt("0x" + t.padEnd(16, "0"));
}

export function cellFromId(id) {
  const level = levelOf(id);
  const face = Number(id >> 61n);
  let orient = face & 1;
  let i = 0, j = 0;
  for (let k = 0; k < level; k++) {
    const p = Number((id >> BigInt(59 - 2 * k)) & 3n);
    const ij = POS_TO_IJ[orient][p];
    i = (i << 1) | (ij >> 1);
    j = (j << 1) | (ij & 1);
    orient ^= POS_TO_ORIENT[p];
  }
  return { face, i, j, level, id, token: token(id) };
}

export const cellFromToken = (t) => cellFromId(idFromToken(t));

export function cellFromFaceIJ(face, i, j, level) {
  const shift = MAX_LEVEL - level;
  const pos = leafPos(face, i * 2 ** shift, j * 2 ** shift);
  const leaf = (BigInt(face) << 61n) | (pos << 1n) | 1n;
  const lsb = lsbForLevel(level);
  const id = (leaf & -lsb) | lsb;
  return { face, i, j, level, id, token: token(id) };
}

export function cellFromLatLng(lon, lat, level = MAX_LEVEL) {
  const { face, u, v } = faceUV(lonLatToXYZ(lon, lat));
  const clampIJ = (s) => Math.max(0, Math.min(MAX_SIZE - 1, Math.floor(MAX_SIZE * s)));
  const I = clampIJ(uvToST(u)), J = clampIJ(uvToST(v));
  const shift = MAX_LEVEL - level;
  const pos = leafPos(face, I, J);
  const leaf = (BigInt(face) << 61n) | (pos << 1n) | 1n;
  const lsb = lsbForLevel(level);
  const id = (leaf & -lsb) | lsb;
  return { face, i: Math.floor(I / 2 ** shift), j: Math.floor(J / 2 ** shift), level, id, token: token(id) };
}

function stBounds(cell) {
  const n = 2 ** cell.level;
  return [cell.i / n, (cell.i + 1) / n, cell.j / n, (cell.j + 1) / n];
}

export function cellVertexXYZ(cell, s, t, stretch = true) {
  const f = stretch ? stToUV : stToUVLinear;
  return uvToXYZ(cell.face, f(s), f(t));
}

export function cellBoundary(cell, { stretch = true, steps = 1 } = {}) {
  const [s0, s1, t0, t1] = stBounds(cell);
  const corners = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]];
  const out = [];
  for (let k = 0; k < 4; k++) {
    const [sa, ta] = corners[k], [sb, tb] = corners[(k + 1) % 4];
    for (let q = 0; q < steps; q++) {
      const t = q / steps;
      out.push(xyzToLonLat(cellVertexXYZ(cell, sa + (sb - sa) * t, ta + (tb - ta) * t, stretch)));
    }
  }
  return out;
}

export function cellPolygon(cell, opts) {
  const ring = cellBoundary(cell, opts).reverse();
  ring.push(ring[0].slice());
  return { type: "Polygon", coordinates: [ring] };
}

export function cellCenter(cell, stretch = true) {
  const [s0, s1, t0, t1] = stBounds(cell);
  return xyzToLonLat(cellVertexXYZ(cell, (s0 + s1) / 2, (t0 + t1) / 2, stretch));
}

export function cellArea(cell, R = 6371.0088) {
  if (cell.level >= 16) {
    const [s0, s1, t0, t1] = stBounds(cell);
    const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const a = unit(cellVertexXYZ(cell, s0, t0)), b = unit(cellVertexXYZ(cell, s1, t0));
    const c = unit(cellVertexXYZ(cell, s1, t1)), d = unit(cellVertexXYZ(cell, s0, t1));
    const p = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], q = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    return 0.5 * Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]) * R * R;
  }
  return sphericalPolygonArea(cellBoundary(cell)) * R * R;
}

export function cellCount(level) {
  return 6 * 4 ** level;
}

export function averageArea(level, R = 6371.0088) {
  return (4 * Math.PI * R * R) / cellCount(level);
}

export function parent(cell, level = cell.level - 1) {
  if (level < 0) return null;
  const lsb = lsbForLevel(level);
  return cellFromId((cell.id & -lsb) | lsb);
}

export function children(cell) {
  if (cell.level >= MAX_LEVEL) return [];
  const lsb = lsbForLevel(cell.level);
  const c = lsb >> 2n;
  const out = [];
  let id = cell.id - lsb + c;
  for (let k = 0; k < 4; k++, id += 2n * c) out.push(cellFromId(id));
  return out;
}

export function hilbertOrder(level, face) {
  const n = 4 ** level;
  const out = new Array(n);
  const lsb = lsbForLevel(level);
  const base = BigInt(face) << 61n;
  const shift = BigInt(61 - 2 * level);
  for (let p = 0; p < n; p++) {
    let orient = face & 1, i = 0, j = 0;
    for (let k = level - 1; k >= 0; k--) {
      const d = Math.floor(p / 4 ** k) % 4;
      const ij = POS_TO_IJ[orient][d];
      i = (i << 1) | (ij >> 1);
      j = (j << 1) | (ij & 1);
      orient ^= POS_TO_ORIENT[d];
    }
    const id = base | (BigInt(p) << shift) | lsb;
    out[p] = { face, i, j, level, id, token: token(id) };
  }
  return out;
}
