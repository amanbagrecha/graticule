import { DEG, RAD } from "@/core/math.js";

export const MU = 398600.4418;
export const RE = 6378.137;
export const J2 = 1.08263e-3;
export const OMEGA_EARTH = 7.2921150e-5;
export const TROPICAL_YEAR = 365.2422;
export const SUN_RATE = 360 / TROPICAL_YEAR;
export const GEO_ALTITUDE = 35786;

const norm360 = (x) => ((x % 360) + 360) % 360;
const norm180 = (x) => norm360(x + 180) - 180;

export function julianDay(date) {
  const ms = date instanceof Date ? date.getTime() : +date;
  return ms / 86400000 + 2440587.5;
}

export function dateFromDayOfYear(year, doy, utcHours = 12) {
  return new Date(Date.UTC(year, 0, 1) + ((doy - 1) * 24 + utcHours) * 3600000);
}

export function sun(date) {
  const n = julianDay(date) - 2451545.0;
  const L = norm360(280.46 + 0.9856474 * n);
  const g = norm360(357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * RAD);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)) * RAD;
  const gmst = norm360(280.46061837 + 360.98564736629 * n);
  const eot = norm180(L - ra) * 4;
  return { ra, dec, gmst, eot, eclipticLon: norm360(lambda * RAD), obliquity: eps * RAD };
}

export function subsolar(date) {
  const s = sun(date);
  return { lon: norm180(s.ra - s.gmst), lat: s.dec };
}

export const declination = (date) => sun(date).dec;
export const equationOfTime = (date) => sun(date).eot;

export function solarTime(date, lon) {
  const ss = subsolar(date);
  return norm360(12 * 15 + lon - ss.lon) / 15;
}

export function terminator(date, n = 360) {
  const { lon, lat } = subsolar(date);
  const p0 = lat * DEG, l0 = lon * DEG;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const az = (2 * Math.PI * k) / n;
    const p = Math.asin(Math.cos(p0) * Math.cos(az));
    const l = l0 + Math.atan2(Math.sin(az), -Math.sin(p0) * Math.cos(az));
    pts.push([norm180(l * RAD), p * RAD]);
  }
  return pts;
}

export function semiMajorAxis(altKm) {
  return RE + altKm;
}

export function meanMotion(altKm) {
  const a = semiMajorAxis(altKm);
  return Math.sqrt(MU / (a * a * a));
}

export function orbitPeriod(altKm) {
  return (2 * Math.PI) / meanMotion(altKm) / 60;
}

export function orbitsPerDay(altKm) {
  return 1440 / orbitPeriod(altKm);
}

export function orbitalSpeed(altKm) {
  return Math.sqrt(MU / semiMajorAxis(altKm));
}

export function groundSpeed(altKm) {
  return (orbitalSpeed(altKm) * RE) / semiMajorAxis(altKm);
}

export function nodalPrecession(altKm, incDeg) {
  const a = semiMajorAxis(altKm);
  const rate = -1.5 * meanMotion(altKm) * J2 * (RE / a) ** 2 * Math.cos(incDeg * DEG);
  return rate * 86400 * RAD;
}

export function sunSyncInclination(altKm) {
  const a = semiMajorAxis(altKm);
  const k = 1.5 * meanMotion(altKm) * J2 * (RE / a) ** 2 * 86400 * RAD;
  const c = -SUN_RATE / k;
  return Math.abs(c) <= 1 ? Math.acos(c) * RAD : NaN;
}

export function westShiftPerOrbit(altKm, incDeg) {
  const T = orbitPeriod(altKm) * 60;
  const omegaDot = (nodalPrecession(altKm, incDeg) * DEG) / 86400;
  return (OMEGA_EARTH - omegaDot) * T * RAD;
}

export function groundTrack(altKm, incDeg, tStartMin, tEndMin, stepS = 30, earthRotates = true, lon0 = 0) {
  const n = meanMotion(altKm);
  const i = incDeg * DEG;
  const omegaDot = (nodalPrecession(altKm, incDeg) * DEG) / 86400;
  const out = [];
  const steps = Math.max(1, Math.round(((tEndMin - tStartMin) * 60) / stepS));
  for (let k = 0; k <= steps; k++) {
    const tMin = tStartMin + ((tEndMin - tStartMin) * k) / steps;
    const t = tMin * 60;
    const u = n * t;
    const lat = Math.asin(Math.sin(i) * Math.sin(u));
    let lon = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u));
    if (earthRotates) lon += (omegaDot - OMEGA_EARTH) * t;
    out.push([norm180(lon0 + lon * RAD), lat * RAD, tMin]);
  }
  return out;
}

export function maxGroundLatitude(incDeg) {
  return incDeg <= 90 ? incDeg : 180 - incDeg;
}

export function earthHalfAngle(altKm, R = RE) {
  return Math.asin(R / (R + altKm)) * RAD;
}

export function limbAngle(altKm, R = RE) {
  return Math.acos(R / (R + altKm)) * RAD;
}

export function viewGeometry(altKm, gcDeg, R = RE) {
  const a = R + altKm;
  const g = gcDeg * DEG;
  const slant = Math.sqrt(R * R + a * a - 2 * R * a * Math.cos(g));
  const zenith = Math.asin(Math.min(1, (a * Math.sin(g)) / slant));
  const nadir = zenith - g;
  return {
    slant,
    zenith: zenith * RAD,
    nadirAngle: nadir * RAD,
    alongFactor: slant / altKm,
    acrossFactor: slant / altKm / Math.cos(zenith),
    visible: gcDeg < limbAngle(altKm, R),
  };
}

export function gcFromNadirAngle(altKm, nadirDeg, R = RE) {
  const s = ((R + altKm) / R) * Math.sin(nadirDeg * DEG);
  if (s > 1) return NaN;
  return (Math.asin(s) - nadirDeg * DEG) * RAD;
}

export function swathEdgePixel(altKm, swathKm, nadirPixelKm, R = RE) {
  const v = viewGeometry(altKm, (swathKm / 2 / R) * RAD, R);
  return { across: nadirPixelKm * v.acrossFactor, along: nadirPixelKm * v.alongFactor, nadirAngle: v.nadirAngle, zenith: v.zenith };
}
