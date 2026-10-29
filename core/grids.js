import { DEG, RAD, lonLatToXYZ, xyzToLonLat, vec3, sphericalPolygonArea } from "@/core/math.js";

function frame(poleLon, poleLat) {
  const P = lonLatToXYZ(poleLon, poleLat);
  const O = lonLatToXYZ(poleLon + 180, 90 - poleLat);
  const Y = vec3.cross(P, O);
  return { P, O, Y };
}

export function rotatedToGeo(rlon, rlat, poleLon, poleLat) {
  const { P, O, Y } = frame(poleLon, poleLat);
  const l = rlon * DEG, p = rlat * DEG, c = Math.cos(p);
  const a = c * Math.cos(l), b = c * Math.sin(l), s = Math.sin(p);
  return xyzToLonLat([a * O[0] + b * Y[0] + s * P[0], a * O[1] + b * Y[1] + s * P[1], a * O[2] + b * Y[2] + s * P[2]]);
}

export function geoToRotated(lon, lat, poleLon, poleLat) {
  const { P, O, Y } = frame(poleLon, poleLat);
  const v = lonLatToXYZ(lon, lat);
  return xyzToLonLat([vec3.dot(v, O), vec3.dot(v, Y), vec3.dot(v, P)]);
}

function centreOf(corners) {
  const s = corners.reduce((acc, [lo, la]) => vec3.add(acc, lonLatToXYZ(lo, la)), [0, 0, 0]);
  return xyzToLonLat(s);
}

function finish(kind, nx, ny, tiles, cells, singular, extra = {}) {
  const centres = cells.map(centreOf);
  return {
    kind, nx, ny, tiles, cells, centres, singular,
    count: cells.length,
    index: (i, j, tile = 0) => tile * nx * ny + j * nx + i,
    ...extra,
  };
}

export function rotatedPole(poleLon = -162, poleLat = 39.25, nx = 72, ny = 36, { rlon = [-180, 180], rlat = [-90, 90] } = {}) {
  const cells = [];
  const dl = (rlon[1] - rlon[0]) / nx, dp = (rlat[1] - rlat[0]) / ny;
  const g = (a, b) => rotatedToGeo(a, b, poleLon, poleLat);
  for (let j = 0; j < ny; j++) {
    const p0 = rlat[0] + j * dp, p1 = p0 + dp;
    for (let i = 0; i < nx; i++) {
      const l0 = rlon[0] + i * dl, l1 = l0 + dl;
      cells.push([g(l0, p0), g(l0, p1), g(l1, p1), g(l1, p0)]);
    }
  }
  const north = [poleLon, poleLat];
  const south = [poleLon > 0 ? poleLon - 180 : poleLon + 180, -poleLat];
  return finish("rotated pole", nx, ny, 1, cells, [north, south], {
    pole: north,
    toGeo: (a, b) => rotatedToGeo(a, b, poleLon, poleLat),
    fromGeo: (lon, lat) => geoToRotated(lon, lat, poleLon, poleLat),
  });
}

export function tripolarPoint(lonFrac, s, { latC = 65, lonP = 80 } = {}) {
  let theta = (lonFrac * 2 * Math.PI) % (2 * Math.PI);
  if (theta > Math.PI) theta -= 2 * Math.PI;
  const a = Math.tan(((90 - latC) * DEG) / 2);
  const tau = Math.log(Math.abs(1 / Math.tan(theta / 2)));
  const sign = theta >= 0 ? 1 : -1;
  const sigma = sign * (Math.PI / 2 + (s * Math.PI) / 2);
  let x, y;
  if (!isFinite(tau)) {
    x = tau > 0 ? a : -a;
    y = 0;
  } else {
    const d = Math.cosh(tau) - Math.cos(sigma);
    x = (a * Math.sinh(tau)) / d;
    y = (a * Math.sin(sigma)) / d;
  }
  const r = Math.hypot(x, y);
  const lat = 90 - 2 * Math.atan(r) * RAD;
  let lon = lonP + Math.atan2(y, x) * RAD;
  lon = ((lon + 540) % 360) - 180;
  return [lon, lat];
}

export function tripolar(nx = 72, ny = 40, { latC = 65, lonP = 80, latS = -78 } = {}) {
  const span = 90 - latS;
  const nCap = Math.max(2, Math.round((ny * (90 - latC)) / span));
  const nLow = ny - nCap;
  const rowEdge = (j) => {
    if (j <= nLow) return { lat: latS + ((latC - latS) * j) / nLow };
    return { s: (j - nLow) / nCap };
  };
  const pt = (i, j) => {
    const e = rowEdge(j);
    const lonFrac = i / nx;
    if (e.lat !== undefined) {
      let lon = lonP + 360 * lonFrac;
      lon = ((lon + 540) % 360) - 180;
      return [lon, e.lat];
    }
    return tripolarPoint(lonFrac, e.s, { latC, lonP });
  };
  const cells = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) cells.push([pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)]);
  const other = lonP > 0 ? lonP - 180 : lonP + 180;
  return finish("tripolar", nx, ny, 1, cells, [[lonP, latC], [other, latC], [0, -90]], { latC, lonP, latS, capRows: nCap });
}

const CUBE_FACES = [
  (X, Y) => [1, X, Y],
  (X, Y) => [-X, 1, Y],
  (X, Y) => [-1, -X, Y],
  (X, Y) => [X, -1, Y],
  (X, Y) => [-Y, X, 1],
  (X, Y) => [Y, X, -1],
];

export function cubePoint(face, a, b) {
  return xyzToLonLat(CUBE_FACES[face](Math.tan(a), Math.tan(b)));
}

export function cubedSphere(n = 48) {
  const cells = [];
  const q = Math.PI / 4;
  const ang = (k) => -q + (2 * q * k) / n;
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      cells.push([cubePoint(f, ang(i), ang(j)), cubePoint(f, ang(i), ang(j + 1)), cubePoint(f, ang(i + 1), ang(j + 1)), cubePoint(f, ang(i + 1), ang(j))]);
    }
  }
  const c = Math.atan(1 / Math.SQRT2) * RAD;
  const singular = [];
  for (const lat of [c, -c]) for (const lon of [-135, -45, 45, 135]) singular.push([lon, lat]);
  return finish("cubed sphere", n, n, 6, cells, singular);
}

export function yinYang(n = 24) {
  const cells = [];
  const nx = 3 * n, ny = n;
  const yin = (lon, lat) => [lon, lat];
  const yang = (lon, lat) => {
    const [x, y, z] = lonLatToXYZ(lon, lat);
    return xyzToLonLat([-x, z, y]);
  };
  for (const map of [yin, yang]) {
    for (let j = 0; j < ny; j++) {
      const p0 = -45 + (90 * j) / ny, p1 = -45 + (90 * (j + 1)) / ny;
      for (let i = 0; i < nx; i++) {
        const l0 = -135 + (270 * i) / nx, l1 = -135 + (270 * (i + 1)) / nx;
        cells.push([map(l0, p0), map(l0, p1), map(l1, p1), map(l1, p0)]);
      }
    }
  }
  return finish("Yin-Yang", nx, ny, 2, cells, []);
}

export function cellArea(corners, R = 6371.0088) {
  return sphericalPolygonArea(corners) * R * R;
}

export function areaStats(grid, R = 6371.0088) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const c of grid.cells) {
    const a = cellArea(c, R);
    if (a < min) min = a;
    if (a > max) max = a;
    sum += a;
  }
  return { min, max, ratio: max / min, mean: sum / grid.cells.length, total: sum };
}

export function sigmaLevels(depth, layers) {
  const z = new Float64Array(layers + 1);
  for (let k = 0; k <= layers; k++) z[k] = (depth * k) / layers;
  return z;
}

export function indexSpaceColumns(grid, depthSampler, layers = 20) {
  const out = [];
  const per = grid.nx * grid.ny;
  grid.centres.forEach(([lon, lat], idx) => {
    const depth = depthSampler(lon, lat);
    if (!(depth > 0)) return;
    const tile = Math.floor(idx / per), rem = idx - tile * per;
    const j = Math.floor(rem / grid.nx), i = rem - j * grid.nx;
    out.push({ index: idx, i, j, tile, lon, lat, depth, layers, thickness: depth / layers, levels: sigmaLevels(depth, layers) });
  });
  return out;
}
