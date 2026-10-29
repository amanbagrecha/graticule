import { DEG, RAD } from "@/core/math.js";
import { WGS84 } from "@/core/geodesy.js";

export const K0 = 0.9996;
export const FALSE_EASTING = 500000;
export const FALSE_NORTHING_SOUTH = 10000000;
export const BANDS = "CDEFGHJKLMNPQRSTUVWX";

function coefficients(ell) {
  const n = ell.n, n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const A = (ell.a / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const alpha = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
    (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
    (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
    (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
    (212378941 / 319334400) * n6,
  ];
  const beta = [
    n / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
    (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
    (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
    (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
    (4583 / 161280) * n5 - (108847 / 3991680) * n6,
    (20648693 / 638668800) * n6,
  ];
  return { A, alpha, beta };
}

const cache = new Map();
function coef(ell) {
  let c = cache.get(ell);
  if (!c) { c = coefficients(ell); cache.set(ell, c); }
  return c;
}

const lonDiff = (lon, lon0) => {
  let d = (lon - lon0) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

export function tmForward(lon, lat, lon0, k0 = K0, ell = WGS84) {
  const { A, alpha } = coef(ell);
  const e = ell.e;
  const lam = lonDiff(lon, lon0) * DEG;
  const latc = Math.abs(lat) >= 90 ? Math.sign(lat) * (90 - 1e-9) : lat;
  const phi = latc * DEG;
  const cl = Math.cos(lam), sl = Math.sin(lam);
  const tau = Math.tan(phi);
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
  const taup = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  const xip = Math.atan2(taup, cl);
  const etap = Math.asinh(sl / Math.sqrt(taup * taup + cl * cl));
  let xi = xip, eta = etap, p = 1, q = 0;
  for (let j = 1; j <= 6; j++) {
    const a = alpha[j - 1];
    const s2 = Math.sin(2 * j * xip), c2 = Math.cos(2 * j * xip);
    const sh = Math.sinh(2 * j * etap), ch = Math.cosh(2 * j * etap);
    xi += a * s2 * ch;
    eta += a * c2 * sh;
    p += 2 * j * a * c2 * ch;
    q += 2 * j * a * s2 * sh;
  }
  const x = k0 * A * eta, y = k0 * A * xi;
  const gamma = Math.atan2(taup * sl, Math.sqrt(1 + taup * taup) * cl) + Math.atan2(q, p);
  const sphi = Math.sin(phi);
  const kp = (Math.sqrt(1 - ell.e2 * sphi * sphi) * Math.sqrt(1 + tau * tau)) / Math.sqrt(taup * taup + cl * cl);
  const k = k0 * kp * (A / ell.a) * Math.hypot(p, q);
  return { x, y, k, gamma: gamma * RAD };
}

export function tmInverse(x, y, lon0, k0 = K0, ell = WGS84) {
  const { A, beta } = coef(ell);
  const e2 = ell.e2;
  const xi = y / (k0 * A), eta = x / (k0 * A);
  let xip = xi, etap = eta;
  for (let j = 1; j <= 6; j++) {
    const b = beta[j - 1];
    xip -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etap -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const sh = Math.sinh(etap), cx = Math.cos(xip);
  const r = Math.sqrt(sh * sh + cx * cx);
  const taup = Math.sin(xip) / r;
  const lam = Math.atan2(sh, cx);
  let tau = taup;
  const e = ell.e;
  for (let i = 0; i < 10; i++) {
    const s = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
    const tpi = tau * Math.sqrt(1 + s * s) - s * Math.sqrt(1 + tau * tau);
    const dt = ((taup - tpi) / Math.sqrt(1 + tpi * tpi)) * ((1 + (1 - e2) * tau * tau) / ((1 - e2) * Math.sqrt(1 + tau * tau)));
    tau += dt;
    if (Math.abs(dt) < 1e-14 * Math.max(1, Math.abs(tau))) break;
  }
  const lat = r === 0 ? Math.sign(xip) * 90 : Math.atan(tau) * RAD;
  let lon = lon0 + lam * RAD;
  lon = ((lon + 540) % 360) - 180;
  return { lon, lat };
}

export function centralMeridian(zone) {
  return -183 + 6 * zone;
}

export function zone(lon, lat = 0) {
  let L = ((lon + 180) % 360 + 360) % 360 - 180;
  if (lon === 180) L = 180;
  let z = Math.floor((L + 180) / 6) + 1;
  if (L === 180) z = 60;
  if (lat >= 56 && lat < 64 && L >= 3 && L < 12) z = 32;
  if (lat >= 72 && lat < 84) {
    if (L >= 0 && L < 9) z = 31;
    else if (L >= 9 && L < 21) z = 33;
    else if (L >= 21 && L < 33) z = 35;
    else if (L >= 33 && L < 42) z = 37;
  }
  return z;
}

export function band(lat) {
  if (!(lat >= -80 && lat <= 84)) return null;
  return BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
}

export function bandBounds(letter) {
  const i = BANDS.indexOf(letter.toUpperCase());
  if (i < 0) return null;
  const south = -80 + 8 * i;
  return { south, north: i === 19 ? 84 : south + 8 };
}

export function gridZoneBounds(z, letter) {
  const b = bandBounds(letter);
  if (!b) return null;
  let west = centralMeridian(z) - 3, east = centralMeridian(z) + 3;
  const L = letter.toUpperCase();
  if (L === "V") {
    if (z === 31) east = 3;
    if (z === 32) west = 3;
  }
  if (L === "X") {
    if (z === 32 || z === 34 || z === 36) return null;
    if (z === 31) east = 9;
    if (z === 33) { west = 9; east = 21; }
    if (z === 35) { west = 21; east = 33; }
    if (z === 37) west = 33;
  }
  return { zone: z, band: L, west, east, south: b.south, north: b.north };
}

export function gridZones() {
  const out = [];
  for (let z = 1; z <= 60; z++) for (const L of BANDS) {
    const g = gridZoneBounds(z, L);
    if (g) out.push(g);
  }
  return out;
}

export function forward(lon, lat, z = zone(lon, lat), south = lat < 0) {
  const r = tmForward(lon, lat, centralMeridian(z), K0, WGS84);
  return { E: FALSE_EASTING + r.x, N: r.y + (south ? FALSE_NORTHING_SOUTH : 0), k: r.k, gamma: r.gamma, zone: z, south };
}

export function inverse(E, N, z, south = false) {
  const x = E - FALSE_EASTING, y = N - (south ? FALSE_NORTHING_SOUTH : 0);
  const { lon, lat } = tmInverse(x, y, centralMeridian(z), K0, WGS84);
  const f = tmForward(lon, lat, centralMeridian(z), K0, WGS84);
  return { lon, lat, k: f.k, gamma: f.gamma };
}

export function scaleFactorSphere(lon, lat, lon0, k0 = K0) {
  const B = Math.cos(lat * DEG) * Math.sin(lonDiff(lon, lon0) * DEG);
  return k0 / Math.sqrt(1 - B * B);
}

export function convergenceSphere(lon, lat, lon0) {
  return Math.atan(Math.tan(lonDiff(lon, lon0) * DEG) * Math.sin(lat * DEG)) * RAD;
}

export function epsg(z, south) {
  return (south ? 32700 : 32600) + z;
}

export function proj4String(z, south) {
  return `+proj=utm +zone=${z}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}
