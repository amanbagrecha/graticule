import { Geodesic } from "geodesic";
import { DEG, RAD, clamp, lonLatToXYZ, xyzToLonLat, slerp } from "@/core/math.js";

export function ellipsoid(a, invf, name = "") {
  const f = invf ? 1 / invf : 0;
  const b = a * (1 - f);
  const e2 = f * (2 - f);
  return Object.freeze({ name, a, f, invf: invf || Infinity, b, e2, e: Math.sqrt(e2), ep2: e2 / (1 - e2), n: f / (2 - f) });
}

export const WGS84 = ellipsoid(6378137, 298.257223563, "WGS 84");
export const GRS80 = ellipsoid(6378137, 298.257222101, "GRS 1980");
export const AIRY1830 = ellipsoid(6377563.396, 299.3249646, "Airy 1830");
export const INTL1924 = ellipsoid(6378388, 297, "International 1924");
export const BESSEL1841 = ellipsoid(6377397.155, 299.1528128, "Bessel 1841");
export const CLARKE1866 = ellipsoid(6378206.4, 294.9786982138982, "Clarke 1866");
export const SPHERE = ellipsoid(6371008.8, 0, "Sphere (mean radius)");
export const ELLIPSOIDS = { WGS84, GRS80, AIRY1830, INTL1924, BESSEL1841, CLARKE1866, SPHERE };

export const R_MEAN = 6371008.8;

const geodCache = new Map();
function geod(ell) {
  const key = ell.a + "/" + ell.f;
  let g = geodCache.get(key);
  if (!g) {
    g = ell.a === WGS84.a && ell.f === WGS84.f ? Geodesic.WGS84 : new Geodesic.Geodesic(ell.a, ell.f);
    geodCache.set(key, g);
  }
  return g;
}

export function latitudes(phiDeg, ell = WGS84) {
  const p = phiDeg * DEG;
  if (Math.abs(phiDeg) === 90) return { geodetic: phiDeg, geocentric: phiDeg, parametric: phiDeg };
  return {
    geodetic: phiDeg,
    geocentric: Math.atan((1 - ell.e2) * Math.tan(p)) * RAD,
    parametric: Math.atan((1 - ell.f) * Math.tan(p)) * RAD,
  };
}

export function radii(phiDeg, ell = WGS84) {
  const s = Math.sin(phiDeg * DEG);
  const w = Math.sqrt(1 - ell.e2 * s * s);
  const N = ell.a / w;
  const M = (ell.a * (1 - ell.e2)) / (w * w * w);
  return { M, N, Rm: Math.sqrt(M * N) };
}

export function degreeLengths(phiDeg, ell = WGS84) {
  const { M, N } = radii(phiDeg, ell);
  return { lon: N * Math.cos(phiDeg * DEG) * DEG, lat: M * DEG };
}

export function meridianArc(phiDeg, ell = WGS84) {
  const n = ell.n, n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const p = phiDeg * DEG;
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  return A * (
    p
    - (1.5 * n - (9 / 16) * n3) * Math.sin(2 * p)
    + ((15 / 16) * n2 - (15 / 32) * n4) * Math.sin(4 * p)
    - (35 / 48) * n3 * Math.sin(6 * p)
    + (315 / 512) * n4 * Math.sin(8 * p)
  );
}

export function geodeticToECEF(lon, lat, h = 0, ell = WGS84) {
  const l = lon * DEG, p = lat * DEG;
  const s = Math.sin(p), c = Math.cos(p);
  const N = ell.a / Math.sqrt(1 - ell.e2 * s * s);
  return [(N + h) * c * Math.cos(l), (N + h) * c * Math.sin(l), (N * (1 - ell.e2) + h) * s];
}

export function ecefToGeodetic(x, y, z, ell = WGS84) {
  const { a, e2, b } = ell;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x) * RAD;
  if (p < 1e-9) {
    const lat = z >= 0 ? 90 : -90;
    return [lon, lat, Math.abs(z) - b];
  }
  let phi = Math.atan2(z, p * (1 - e2));
  let h = 0;
  for (let i = 0; i < 30; i++) {
    const s = Math.sin(phi);
    const N = a / Math.sqrt(1 - e2 * s * s);
    const c = Math.cos(phi);
    h = Math.abs(c) > 1e-3 ? p / c - N : z / s - N * (1 - e2);
    const next = Math.atan2(z, p * (1 - (e2 * N) / (N + h)));
    if (Math.abs(next - phi) < 1e-15) { phi = next; break; }
    phi = next;
  }
  const s = Math.sin(phi);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const c = Math.cos(phi);
  h = Math.abs(c) > 1e-3 ? p / c - N : z / s - N * (1 - e2);
  return [lon, phi * RAD, h];
}

const AS = DEG / 3600;

export function helmert7(xyz, p) {
  const tx = p.tx || 0, ty = p.ty || 0, tz = p.tz || 0;
  const pv = p.method === "position-vector";
  const sgn = pv ? -1 : 1;
  const rx = sgn * (p.rx || 0) * AS, ry = sgn * (p.ry || 0) * AS, rz = sgn * (p.rz || 0) * AS;
  const m = 1 + (p.ds || 0) * 1e-6;
  const [x, y, z] = xyz;
  return [
    m * (x + rz * y - ry * z) + tx,
    m * (-rz * x + y + rx * z) + ty,
    m * (ry * x - rx * y + z) + tz,
  ];
}

export function transformDatum(lon, lat, h, p, from = WGS84, to = WGS84) {
  const xyz = geodeticToECEF(lon, lat, h, from);
  const out = helmert7(xyz, p);
  const [lon2, lat2, h2] = ecefToGeodetic(out[0], out[1], out[2], to);
  const r = geod(WGS84).Inverse(lat, lon, lat2, lon2);
  return { lon: lon2, lat: lat2, h: h2, xyz: out, shift: r.s12, bearing: ((r.azi1 % 360) + 360) % 360 };
}

export function inverse(lon1, lat1, lon2, lat2, ell = WGS84) {
  const r = geod(ell).Inverse(lat1, lon1, lat2, lon2);
  return { s12: r.s12, azi1: r.azi1, azi2: r.azi2, a12: r.a12 };
}

export function direct(lon1, lat1, azi1, s12, ell = WGS84) {
  const r = geod(ell).Direct(lat1, lon1, azi1, s12);
  return { lon: r.lon2, lat: r.lat2, azi2: r.azi2, a12: r.a12 };
}

export function geodesicPoints(a, b, n = 64, ell = WGS84) {
  const g = geod(ell);
  const line = g.InverseLine(a[1], a[0], b[1], b[0]);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const r = line.Position((line.s13 * i) / n, Geodesic.LATITUDE | Geodesic.LONGITUDE | Geodesic.LONG_UNROLL);
    pts.push([r.lon2, r.lat2]);
  }
  return pts;
}

export function polygonArea(ring, ell = WGS84) {
  const poly = geod(ell).Polygon(false);
  for (const [lo, la] of ring) poly.AddPoint(la, lo);
  const r = poly.Compute(false, true);
  return { area: r.area, perimeter: r.perimeter };
}

export function sphereDistance(lon1, lat1, lon2, lat2, R = R_MEAN) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const sdp = Math.sin((p2 - p1) / 2), sdl = Math.sin(dl / 2);
  const h = sdp * sdp + Math.cos(p1) * Math.cos(p2) * sdl * sdl;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function sphereBearing(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * RAD) % 360 + 360) % 360;
}

export function antipode(lon, lat) {
  return [lon > 0 ? lon - 180 : lon + 180, -lat];
}

function isometricLat(p, e) {
  if (!e) return Math.asinh(Math.tan(p));
  return Math.asinh(Math.tan(p)) - e * Math.atanh(e * Math.sin(p));
}

const wrapRad = (x) => {
  let d = x % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

export function rhumb(lon1, lat1, lon2, lat2, R = R_MEAN) {
  const ell = typeof R === "object" ? R : null;
  const e = ell ? ell.e : 0;
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  const dl = wrapRad((lon2 - lon1) * DEG);
  const dpsi = isometricLat(clamp(p2, -Math.PI / 2 + 1e-12, Math.PI / 2 - 1e-12), e) - isometricLat(clamp(p1, -Math.PI / 2 + 1e-12, Math.PI / 2 - 1e-12), e);
  const alpha = Math.atan2(dl, dpsi);
  const bearing = ((alpha * RAD) % 360 + 360) % 360;
  let distance;
  if (ell) {
    const dm = meridianArc(lat2, ell) - meridianArc(lat1, ell);
    if (Math.abs(dpsi) < 1e-12) {
      distance = radii(lat1, ell).N * Math.cos(p1) * Math.abs(dl);
    } else {
      distance = Math.abs(dm / Math.cos(alpha));
    }
  } else {
    const dp = p2 - p1;
    const q = Math.abs(dpsi) > 1e-12 ? dp / dpsi : Math.cos(p1);
    distance = Math.sqrt(dp * dp + q * q * dl * dl) * R;
  }
  return { distance, bearing };
}

export function greatCirclePoints(a, b, n = 64) {
  const va = lonLatToXYZ(a[0], a[1]), vb = lonLatToXYZ(b[0], b[1]);
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(xyzToLonLat(slerp(va, vb, i / n)));
  return pts;
}

export function rhumbPoints(a, b, n = 64) {
  const p1 = a[1] * DEG, p2 = b[1] * DEG;
  const dl = wrapRad((b[0] - a[0]) * DEG);
  const q1 = isometricLat(clamp(p1, -1.5707963, 1.5707963), 0);
  const q2 = isometricLat(clamp(p2, -1.5707963, 1.5707963), 0);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const lat = Math.abs(q2 - q1) < 1e-12 ? a[1] : Math.atan(Math.sinh(q1 + (q2 - q1) * t)) * RAD;
    pts.push([a[0] + dl * t * RAD, lat]);
  }
  return pts;
}

const WMM_A = 6371.2;

export function magnetic(model, lon, lat, hKm = 0, year = model.epoch) {
  const nmax = model.nmax || 12;
  const dt = year - model.epoch;
  const G = [], H = [];
  for (let n = 0; n <= nmax; n++) { G.push(new Float64Array(n + 1)); H.push(new Float64Array(n + 1)); }
  for (const [n, m, g, h, gd, hd] of model.coefficients) {
    if (n > nmax) continue;
    G[n][m] = g + dt * gd;
    H[n][m] = h + dt * hd;
  }
  const [x, y, z] = geodeticToECEF(lon, lat, hKm * 1000, WGS84);
  const r = Math.hypot(x, y, z) / 1000;
  const phic = Math.asin(z / 1000 / r);
  const theta = Math.PI / 2 - phic;
  const ct = Math.cos(theta);
  const st = Math.max(Math.sin(theta), 1e-12);
  const P = [], dP = [], S = [];
  for (let n = 0; n <= nmax; n++) { P.push(new Float64Array(n + 1)); dP.push(new Float64Array(n + 1)); S.push(new Float64Array(n + 1)); }
  P[0][0] = 1;
  S[0][0] = 1;
  for (let n = 1; n <= nmax; n++) {
    S[n][0] = (S[n - 1][0] * (2 * n - 1)) / n;
    for (let m = 1; m <= n; m++) S[n][m] = S[n][m - 1] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        P[n][m] = st * P[n - 1][m - 1];
        dP[n][m] = st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1];
      } else if (n === 1 || m === n - 1) {
        P[n][m] = ct * P[n - 1][m];
        dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m];
      } else {
        const K = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
        P[n][m] = ct * P[n - 1][m] - K * P[n - 2][m];
        dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m] - K * dP[n - 2][m];
      }
    }
  }
  const lam = lon * DEG;
  let Xp = 0, Yp = 0, Zp = 0;
  for (let n = 1; n <= nmax; n++) {
    const ar = Math.pow(WMM_A / r, n + 2);
    for (let m = 0; m <= n; m++) {
      const cm = Math.cos(m * lam), sm = Math.sin(m * lam);
      const p = S[n][m] * P[n][m], dp = S[n][m] * dP[n][m];
      const gh = G[n][m] * cm + H[n][m] * sm;
      Xp += ar * gh * dp;
      Yp += (ar * m * (G[n][m] * sm - H[n][m] * cm) * p) / st;
      Zp -= ar * (n + 1) * gh * p;
    }
  }
  const d = phic - lat * DEG;
  const X = Xp * Math.cos(d) - Zp * Math.sin(d);
  const Y = Yp;
  const Z = Xp * Math.sin(d) + Zp * Math.cos(d);
  const Hh = Math.hypot(X, Y);
  const D = Math.atan2(Y, X) * RAD;
  let GV = null;
  if (Math.abs(lat) >= 55) {
    GV = D - (lat > 0 ? lon : -lon);
    GV = ((GV + 180) % 360 + 360) % 360 - 180;
  }
  return { X, Y, Z, H: Hh, F: Math.hypot(Hh, Z), I: Math.atan2(Z, Hh) * RAD, D, GV };
}

export function declination(model, lon, lat, year, hKm = 0) {
  return magnetic(model, lon, lat, hKm, year).D;
}
