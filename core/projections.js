import * as d3 from "d3";
import { DEG, RAD, clamp, lerp, lerpAngle, lonLatToXYZ, xyzToLonLat, slerp, solveNewton2 } from "@/core/math.js";

const EPS = 1e-12;

function carlsonRF(x, y, z) {
  for (let i = 0; i < 100; i++) {
    const lam = Math.sqrt(x * y) + Math.sqrt(y * z) + Math.sqrt(z * x);
    x = (x + lam) / 4; y = (y + lam) / 4; z = (z + lam) / 4;
    const A = (x + y + z) / 3;
    const dx = 1 - x / A, dy = 1 - y / A, dz = 1 - z / A;
    if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) < 1e-9) {
      const E2 = dx * dy + dy * dz + dz * dx, E3 = dx * dy * dz;
      return (1 - E2 / 10 + E3 / 14 + (E2 * E2) / 24 - (3 * E2 * E3) / 44) / Math.sqrt(A);
    }
  }
  return NaN;
}

export function ellipticF(phi, m) {
  const s = Math.sin(phi), c = Math.cos(phi);
  return s * carlsonRF(c * c, 1 - m * s * s, 1);
}

export function jacobiAmplitude(u, m) {
  const a = [1], c = [Math.sqrt(m)];
  let b = Math.sqrt(1 - m);
  let n = 0;
  while (Math.abs(c[n]) > 1e-15 && n < 30) {
    const an = a[n];
    a.push((an + b) / 2);
    c.push((an - b) / 2);
    b = Math.sqrt(an * b);
    n++;
  }
  let phi = 2 ** n * a[n] * u;
  for (let k = n; k > 0; k--) phi = (phi + Math.asin(clamp((c[k] / a[k]) * Math.sin(phi), -1, 1))) / 2;
  return phi;
}

const aacos = (v) => Math.acos(clamp(v, -1, 1));
const aasin = (v) => Math.asin(clamp(v, -1, 1));

export function adamsSquare2() {
  const raw = (lam, phi) => {
    const spp = Math.tan(0.5 * phi);
    let a = Math.cos(aasin(spp)) * Math.sin(0.5 * lam);
    const sm = spp + a < 0, sn = spp - a < 0;
    const b = aacos(spp);
    a = aacos(a);
    let m = aasin(Math.sqrt(1 + Math.min(0, Math.cos(a + b))));
    if (sm) m = -m;
    let n = aasin(Math.sqrt(Math.abs(1 - Math.max(0, Math.cos(a - b)))));
    if (sn) n = -n;
    const X = ellipticF(m, 0.5), Y = ellipticF(n, 0.5);
    return [Math.SQRT1_2 * (X - Y), Math.SQRT1_2 * (X + Y)];
  };
  raw.invert = (x, y) => {
    const X = Math.SQRT1_2 * (x + y), Y = Math.SQRT1_2 * (y - x);
    const m = jacobiAmplitude(X, 0.5), n = jacobiAmplitude(Y, 0.5);
    const cm = Math.cos(m), cn = Math.cos(n);
    const s = Math.sin(m) * Math.sqrt(1 + cn * cn);
    const d = Math.sin(n) * Math.sqrt(1 + cm * cm);
    const u = clamp((s + d) / 2, -1, 1), w = (s - d) / 2;
    const cp = Math.sqrt(Math.max(0, 1 - u * u));
    const lam = cp < EPS ? 0 : 2 * aasin(w / cp);
    return [lam, 2 * Math.atan(u)];
  };
  return raw;
}

export const ADAMS_SQUARE_SIDE = 2 * ellipticF(Math.PI / 2, 0.5);
export const OCEAN_SQUARE_ROTATION = [-66.94970198, 49.56371678, 40.17823482];

export function perspectiveRaw(D) {
  const inf = !isFinite(D);
  const raw = (lam, phi) => {
    const cp = Math.cos(phi), cc = cp * Math.cos(lam);
    const k = inf ? 1 : (1 + D) / (D + cc);
    return [k * cp * Math.sin(lam), k * Math.sin(phi)];
  };
  raw.invert = (x, y) => {
    const rho = Math.hypot(x, y);
    if (rho < EPS) return [0, 0];
    let c;
    if (inf) c = aasin(rho);
    else {
      const K = 1 + D;
      c = Math.atan2(rho, K) + aasin((rho * D) / Math.hypot(K, rho));
    }
    const sc = Math.sin(c), cc = Math.cos(c);
    return [Math.atan2(x * sc, rho * cc), aasin((y * sc) / rho)];
  };
  return raw;
}

export function perspectiveRho(D, cDeg) {
  const c = cDeg * DEG;
  if (!isFinite(D)) return Math.sin(c);
  return ((1 + D) * Math.sin(c)) / (D + Math.cos(c));
}

export function perspectiveHorizon(D) {
  if (!isFinite(D)) return 90;
  return (D <= 1 ? Math.acos(-D) : Math.acos(-1 / D)) * RAD;
}

export function perspectiveName(D) {
  if (!isFinite(D) || D > 1e6) return "orthographic";
  if (Math.abs(D) < 1e-9) return "gnomonic";
  if (Math.abs(D - 1) < 1e-9) return "stereographic";
  if (Math.abs(D - (1 + Math.SQRT1_2)) < 1e-3) return "La Hire";
  return "vertical perspective";
}

export function perspective(D = 1) {
  const p = d3.geoProjection(perspectiveRaw(D));
  const h = perspectiveHorizon(D);
  const clip = !isFinite(D) ? 90 : D < 1 ? Math.max(30, Math.min(h - 25, h * 0.85)) : Math.min(h, 179) - 1e-3;
  return p.clipAngle(clip);
}

export function azimuthalRho(rule, cDeg) {
  const c = cDeg * DEG;
  switch (rule) {
    case "equal-area": case "compass": return 2 * Math.sin(c / 2);
    case "equidistant": case "string": return c;
    case "stereographic": case "conformal": return 2 * Math.tan(c / 2);
    case "gnomonic": return Math.tan(c);
    case "orthographic": return Math.sin(c);
    default: return NaN;
  }
}

export function cylinderY(rule, latDeg, lat0 = 0) {
  const p = latDeg * DEG, c0 = Math.cos(lat0 * DEG);
  switch (rule) {
    case "conformal": return c0 * Math.log(Math.tan(Math.PI / 4 + p / 2));
    case "equal-area": return Math.sin(p) / c0;
    case "equidistant": return p;
    default: return NaN;
  }
}

export function cylinderWidth(lat0 = 0) {
  return 2 * Math.PI * Math.cos(lat0 * DEG);
}

export function coneConstants(lat0) {
  const p = lat0 * DEG;
  const n = Math.sin(p);
  return { n, sectorDeg: 360 * n, apex: 1 / n, rho0: 1 / Math.tan(p) };
}

function equirectangularRaw(lat1 = 0) {
  const c = Math.cos(lat1 * DEG);
  const raw = (lam, phi) => [lam * c, phi];
  raw.invert = (x, y) => [x / c, y];
  return raw;
}

const transverseEquirectangularRaw = (lam, phi) => [phi, -lam];
transverseEquirectangularRaw.invert = (x, y) => [-y, x];

function scaledRaw(raw, k) {
  const r = (lam, phi) => {
    const p = raw(lam, phi);
    return [p[0] * k, p[1] * k];
  };
  r.invert = (x, y) => raw.invert(x / k, y / k);
  return r;
}

export const stereographicRaw = scaledRaw(d3.geoStereographicRaw, 2);
export const robinsonRaw = scaledRaw(d3.geoRobinsonRaw, 0.8487);

export function polarStereoK0(latTs) {
  return (1 + Math.sin(Math.abs(latTs) * DEG)) / 2;
}

function polarStereographic(north, latTs, lon0) {
  const p = d3.geoProjection(scaledRaw(d3.geoStereographicRaw, 2 * polarStereoK0(latTs)));
  return p.rotate([-lon0, north ? -90 : 90]);
}

const lobes = (north, south) => [north.map(([a, c, b]) => [[a, 0], [c, 90], [b, 0]]), south.map(([a, c, b]) => [[a, 0], [c, -90], [b, 0]])];

const OCEAN_LOBES = lobes(
  [[-180, -140, -100], [-100, -20, 60], [60, 120, 180]],
  [[-180, -122.5, -65], [-65, 15, 95], [95, 137.5, 180]],
);

const GORE_LOBES = (() => {
  const n = [], s = [];
  for (let k = 0; k < 12; k++) {
    const a = -180 + 30 * k;
    n.push([a, a + 15, a + 30]);
    s.push([a, a + 15, a + 30]);
  }
  return lobes(n, s);
})();

const rot = (o) => o.rotate || [-(o.lon0 || 0), 0, 0];
const rotAz = (o) => o.rotate || [-(o.lon0 || 0), -(o.lat0 || 0), o.gamma || 0];

function entry(id, name, family, property, make, defaults = {}, clip = "antimeridian") {
  return { id, name, family, property, make: (o = {}) => make({ ...defaults, ...o }), defaults, clip };
}

const list = [
  entry("mercator", "Mercator", "cylindrical", "conformal", (o) => d3.geoMercator().rotate(rot(o))),
  entry("transverseMercator", "Transverse Mercator", "cylindrical", "conformal", (o) => d3.geoTransverseMercator().rotate(o.rotate || [-(o.lon0 || 0), -(o.lat0 || 0)])),
  entry("equirectangular", "Equirectangular", "cylindrical", "equidistant", (o) => d3.geoProjection(equirectangularRaw(o.lat1)).rotate(rot(o)), { lat1: 0 }),
  entry("cassini", "Cassini (transverse equirectangular)", "cylindrical", "equidistant", (o) => d3.geoProjection(transverseEquirectangularRaw).rotate(o.rotate || [-(o.lon0 || 0), 0, 90])),
  entry("cylindricalEqualArea", "Lambert cylindrical equal-area", "cylindrical", "equal-area", (o) => d3.geoCylindricalEqualArea().parallel(o.lat1).rotate(rot(o)), { lat1: 0 }),
  entry("miller", "Miller", "cylindrical", "compromise", (o) => d3.geoMiller().rotate(rot(o))),
  entry("gallPeters", "Gall–Peters", "cylindrical", "equal-area", (o) => d3.geoCylindricalEqualArea().parallel(45).rotate(rot(o))),
  entry("lcc", "Lambert conformal conic", "conic", "conformal", (o) => d3.geoConicConformal().parallels(o.parallels).center([0, 0]).rotate(rot(o)), { parallels: [33, 45] }),
  entry("albers", "Albers equal-area conic", "conic", "equal-area", (o) => d3.geoConicEqualArea().parallels(o.parallels).center([0, 0]).rotate(rot(o)), { parallels: [29.5, 45.5] }),
  entry("eqdc", "Equidistant conic", "conic", "equidistant", (o) => d3.geoConicEquidistant().parallels(o.parallels).center([0, 0]).rotate(rot(o)), { parallels: [20, 60] }),
  entry("stereographic", "Stereographic", "azimuthal", "conformal", (o) => d3.geoProjection(stereographicRaw).rotate(rotAz(o)).clipAngle(o.clipAngle), { clipAngle: 150 }, "circle"),
  entry("gnomonic", "Gnomonic", "azimuthal", "perspective", (o) => d3.geoGnomonic().rotate(rotAz(o)).clipAngle(o.clipAngle), { clipAngle: 60 }, "circle"),
  entry("orthographic", "Orthographic", "azimuthal", "perspective", (o) => d3.geoOrthographic().rotate(rotAz(o)).clipAngle(o.clipAngle), { clipAngle: 90 }, "circle"),
  entry("azimuthalEqualArea", "Lambert azimuthal equal-area", "azimuthal", "equal-area", (o) => d3.geoAzimuthalEqualArea().rotate(rotAz(o)).clipAngle(o.clipAngle), { clipAngle: 180 - 1e-3 }, "circle"),
  entry("azimuthalEquidistant", "Azimuthal equidistant", "azimuthal", "equidistant", (o) => d3.geoAzimuthalEquidistant().rotate(rotAz(o)).clipAngle(o.clipAngle), { clipAngle: 180 - 1e-3 }, "circle"),
  entry("perspective", "Vertical perspective", "azimuthal", "perspective", (o) => perspective(o.D).rotate(rotAz(o)), { D: 1 }, "circle"),
  entry("satellite", "Tilted perspective", "azimuthal", "perspective", (o) => d3.geoSatellite().distance(o.distance).tilt(o.tilt).rotate(rotAz(o)).clipAngle(Math.acos(1 / o.distance) * RAD - 1e-6), { distance: 1 + 35786 / 6378.137, tilt: 0 }, "circle"),
  entry("mollweide", "Mollweide", "pseudo", "equal-area", (o) => d3.geoMollweide().rotate(rot(o))),
  entry("hammer", "Hammer", "pseudo", "equal-area", (o) => d3.geoHammer().rotate(rot(o))),
  entry("sinusoidal", "Sinusoidal", "pseudo", "equal-area", (o) => d3.geoSinusoidal().rotate(rot(o))),
  entry("robinson", "Robinson", "pseudo", "compromise", (o) => d3.geoProjection(robinsonRaw).rotate(rot(o))),
  entry("winkel3", "Winkel tripel", "pseudo", "compromise", (o) => d3.geoWinkel3().rotate(rot(o))),
  entry("equalEarth", "Equal Earth", "pseudo", "equal-area", (o) => d3.geoEqualEarth().rotate(rot(o))),
  entry("naturalEarth1", "Natural Earth", "pseudo", "compromise", (o) => d3.geoNaturalEarth1().rotate(rot(o))),
  entry("interruptedHomolosine", "Goode homolosine (land)", "pseudo", "equal-area", (o) => d3.geoInterruptedHomolosine().rotate(rot(o)), {}, "interrupted"),
  entry("interruptedHomolosineOcean", "Goode homolosine (ocean)", "pseudo", "equal-area", (o) => d3.geoInterrupt(d3.geoHomolosineRaw, OCEAN_LOBES).rotate(o.rotate || [160 - (o.lon0 || 0), 0]), {}, "interrupted"),
  entry("gores12", "Twelve gores", "pseudo", "equal-area", (o) => d3.geoInterrupt(d3.geoSinusoidalRaw, GORE_LOBES).rotate(rot(o)), {}, "interrupted"),
  entry("butterfly", "Butterfly", "polyhedral", "perspective", (o) => d3.geoPolyhedralButterfly(), {}, "polyhedral"),
  entry("airocean", "Icosahedral net", "polyhedral", "compromise", (o) => d3.polygon.geoAirocean(), {}, "polyhedral"),
  entry("peirce", "Peirce quincuncial", "other", "conformal", (o) => d3.geoPeirceQuincuncial(), {}, "polyhedral"),
  entry("oceanSquare", "Ocean square", "other", "conformal", (o) => d3.geoProjection(adamsSquare2()).rotate(o.rotate || OCEAN_SQUARE_ROTATION).angle(o.angle), { angle: -45 }, "polyhedral"),
  entry("polarNorth3413", "Polar stereographic north (EPSG:3413)", "azimuthal", "conformal", (o) => polarStereographic(true, o.latTs, o.lon0).clipAngle(o.clipAngle), { latTs: 70, lon0: -45, clipAngle: 60 }, "circle"),
  entry("polarSouth3031", "Polar stereographic south (EPSG:3031)", "azimuthal", "conformal", (o) => polarStereographic(false, o.latTs, o.lon0).clipAngle(o.clipAngle), { latTs: -71, lon0: 0, clipAngle: 60 }, "circle"),
  entry("easeNorth", "EASE-Grid 2.0 north (equal-area)", "azimuthal", "equal-area", (o) => d3.geoAzimuthalEqualArea().rotate([-(o.lon0 || 0), -90]).clipAngle(o.clipAngle), { clipAngle: 90 }, "circle"),
  entry("webMercator", "Web Mercator", "cylindrical", "conformal", (o) => d3.geoMercator().rotate(rot(o))),
];

export const registry = new Map(list.map((e) => [e.id, e]));
export const ids = Object.freeze(Object.fromEntries(list.map((e) => [e.id, e.id])));

export function make(id, opts = {}) {
  const e = registry.get(id);
  if (!e) throw new Error("unknown projection " + id);
  return e.make(opts);
}

export function get(id, opts = {}) {
  const { width, height, padding = 28, fit = { type: "Sphere" }, precision = 0.3, ...rest } = opts;
  const p = make(id, rest);
  p.precision(precision);
  if (width && height) p.fitExtent([[padding, padding], [width - padding, height - padding]], fit);
  return p;
}

export function conic(property, lat1, lat2 = lat1) {
  const ctor = property === "conformal" ? d3.geoConicConformal : property === "equal-area" ? d3.geoConicEqualArea : d3.geoConicEquidistant;
  return ctor().parallels([lat1, lat2]).center([0, 0]);
}

export function coneConstant(property, lat1, lat2 = lat1) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG;
  if (property === "conformal") {
    if (Math.abs(p1 - p2) < 1e-12) return Math.sin(p1);
    const t = (p) => Math.tan(Math.PI / 4 + p / 2);
    return Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
  }
  if (property === "equal-area") return (Math.sin(p1) + Math.sin(p2)) / 2;
  if (Math.abs(p1 - p2) < 1e-12) return Math.sin(p1);
  return (Math.cos(p1) - Math.cos(p2)) / (p2 - p1);
}

export function interpolate(pa, pb, t) {
  const ka = pa.scale(), kb = pb.scale();
  const [ax, ay] = pa.translate(), [bx, by] = pb.translate();
  const ra = pa.rotate(), rb = pb.rotate();
  const r = [lerpAngle(ra[0], rb[0], t), lerp(ra[1], rb[1], t), lerpAngle(ra[2] || 0, rb[2] || 0, t)];
  const k = lerp(ka, kb, t);
  const rotT = d3.geoRotation(r);
  const blend = (g) => {
    const A = pa(g), B = pb(g);
    return A && B ? [lerp(A[0], B[0], t), lerp(A[1], B[1], t)] : null;
  };
  const c0 = blend(rotT.invert([0, 0]));
  const [tx, ty] = c0 && isFinite(c0[0]) && isFinite(c0[1]) ? c0 : [lerp(ax, bx, t), lerp(ay, by, t)];
  const raw = (lam, phi) => {
    const s = blend(rotT.invert([lam * RAD, phi * RAD]));
    return s ? [(s[0] - tx) / k, (ty - s[1]) / k] : [NaN, NaN];
  };
  const order = t < 0.5 ? [pa, pb] : [pb, pa];
  raw.invert = (x, y) => {
    const sx = tx + x * k, sy = ty - y * k;
    const f = (l, p) => raw(l * DEG, p * DEG);
    for (const src of order) {
      const g = src.invert ? src.invert([sx, sy]) : null;
      if (!g || !isFinite(g[0]) || !isFinite(g[1])) continue;
      const sol = solveNewton2(f, [x, y], rotT(g), { tol: 1e-11, step: 1e-7, maxIter: 60, maxStep: 20 });
      if (sol) return [sol[0] * DEG, sol[1] * DEG];
    }
    const sol = solveNewton2(f, [x, y], [0, 0], { tol: 1e-11, step: 1e-7, maxIter: 80, maxStep: 20 });
    return sol ? [sol[0] * DEG, sol[1] * DEG] : [NaN, NaN];
  };
  const seedRaw = (lam, phi) => raw(lam, phi);
  seedRaw.invert = (x, y) => {
    const sx = tx + x * k, sy = ty - y * k;
    for (const s of order) {
      const g = s.invert ? s.invert([sx, sy]) : null;
      if (!g || !isFinite(g[0]) || !isFinite(g[1])) continue;
      const q = rotT(g);
      return [q[0] * DEG, q[1] * DEG];
    }
    return [NaN, NaN];
  };
  const out = d3.geoProjection(raw).rotate(r).scale(k).translate([tx, ty]);
  out.seedProjection = () => d3.geoProjection(seedRaw).rotate(out.rotate()).angle(out.angle()).scale(out.scale()).translate(out.translate());
  const src = t < 0.5 ? pa : pb;
  const rs = src.rotate();
  const sameFrame = rs.every((v, i) => Math.abs(wrapAngle(v - r[i])) < 1e-9);
  const ca = src.clipAngle && src.clipAngle();
  if (sameFrame && ca) out.clipAngle(ca);
  else if (!sameFrame && src.preclip) { out.preclip(reframeClip(src.preclip(), r, rs)); out.clipFrame = { angle: ca || 0, rotate: rs }; }
  const ce = src.clipExtent && src.clipExtent();
  if (ce) out.clipExtent(ce);
  if (src.precision) out.precision(src.precision());
  return out;
}

export function fromRaw(raw) {
  return d3.geoProjection(raw);
}

const wrapAngle = (v) => ((((v + 180) % 360) + 360) % 360) - 180;

function relayStream(f, s) {
  return {
    point: (x, y) => { const q = f([x * RAD, y * RAD]); s.point(q[0] * DEG, q[1] * DEG); },
    lineStart: () => s.lineStart(), lineEnd: () => s.lineEnd(),
    polygonStart: () => s.polygonStart(), polygonEnd: () => s.polygonEnd(),
    sphere: () => s.sphere(),
  };
}

export function reframeClip(clip, from, to) {
  const a = d3.geoRotation(from), b = d3.geoRotation(to);
  const inward = (q) => b(a.invert(q)), outward = (q) => a(b.invert(q));
  return (sink) => relayStream(inward, clip(relayStream(outward, sink)));
}

export function obliqueRotation(a, b) {
  const m = xyzToLonLat(slerp(lonLatToXYZ(a[0], a[1]), lonLatToXYZ(b[0], b[1]), 0.5));
  const r0 = d3.geoRotation([-m[0], -m[1], 0]);
  const q = r0(b);
  const y = Math.cos(q[1] * DEG) * Math.sin(q[0] * DEG), z = Math.sin(q[1] * DEG);
  return [-m[0], -m[1], Math.atan2(-z, y) * RAD];
}

export function factors(projection, lon, lat, step = 1e-4) {
  const k0 = projection.scale();
  const P = (lo, la) => projection([lo, la]);
  const latUp = Math.min(90, lat + step), latDn = Math.max(-90, lat - step);
  const n1 = P(lon, latUp), n0 = P(lon, latDn), e1 = P(lon + step, lat), e0 = P(lon - step, lat);
  if (!n1 || !n0 || !e1 || !e0) return null;
  const dp = (latUp - latDn) * DEG, dl = 2 * step * DEG;
  const cp = Math.cos(lat * DEG);
  const xN = (n1[0] - n0[0]) / dp / k0, yN = -(n1[1] - n0[1]) / dp / k0;
  const xE = (e1[0] - e0[0]) / dl / k0 / cp, yE = -(e1[1] - e0[1]) / dl / k0 / cp;
  const h = Math.hypot(xN, yN), k = Math.hypot(xE, yE);
  const det = xE * yN - xN * yE;
  const areaScale = Math.abs(det);
  const s2 = xE * xE + yE * yE + xN * xN + yN * yN;
  const ab = Math.sqrt(Math.max(0, s2 + 2 * areaScale)), amb = Math.sqrt(Math.max(0, s2 - 2 * areaScale));
  const a = (ab + amb) / 2, b = (ab - amb) / 2;
  const omega = 2 * Math.asin(clamp((a - b) / (a + b), 0, 1)) * RAD;
  const theta = Math.atan2(xE * xN + yE * yN, Math.sqrt(Math.max(0, (xE * xE + yE * yE) * (xN * xN + yN * yN)))) * RAD;
  return { h, k, a, b, areaScale, omega, intersection: 90 - theta };
}

export function tissot(projection, lon, lat, r = 2.5, step = 1e-4) {
  const c = projection([lon, lat]);
  if (!c) return null;
  const latUp = Math.min(90, lat + step), latDn = Math.max(-90, lat - step);
  const n1 = projection([lon, latUp]), n0 = projection([lon, latDn]);
  const e1 = projection([lon + step, lat]), e0 = projection([lon - step, lat]);
  if (!n1 || !n0 || !e1 || !e0) return null;
  const dp = (latUp - latDn) * DEG, dl = 2 * step * DEG * Math.cos(lat * DEG);
  const J = [[(e1[0] - e0[0]) / dl, (n1[0] - n0[0]) / dp], [(e1[1] - e0[1]) / dl, (n1[1] - n0[1]) / dp]];
  const A = J[0][0] * J[0][0] + J[0][1] * J[0][1];
  const B = J[0][0] * J[1][0] + J[0][1] * J[1][1];
  const C = J[1][0] * J[1][0] + J[1][1] * J[1][1];
  const tr = A + C, dt = Math.sqrt(Math.max(0, (A - C) * (A - C) + 4 * B * B));
  const l1 = (tr + dt) / 2, l2 = Math.max(0, (tr - dt) / 2);
  const angle = 0.5 * Math.atan2(2 * B, A - C);
  const rr = r * DEG;
  return { x: c[0], y: c[1], rx: Math.sqrt(l1) * rr, ry: Math.sqrt(l2) * rr, angle };
}

export function tissotGrid(projection, { spacing = 15, r = 2.5, latMax = 75 } = {}) {
  const out = [];
  for (let lat = -latMax; lat <= latMax + 1e-9; lat += spacing) {
    for (let lon = -180 + spacing / 2; lon < 180; lon += spacing) {
      const e = tissot(projection, lon, lat, r);
      const f = factors(projection, lon, lat);
      if (e && f) out.push({ lon, lat, ...e, factors: f });
    }
  }
  return out;
}

export function familyCap(lat1, hemisphere = "north", edge = 20) {
  const s = hemisphere === "south" ? -1 : 1;
  const k = clamp((lat1 - 10) / 30, 0, 1);
  const top = 84 + 6 * k * k * (3 - 2 * k);
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 2) ring.push([lon, top]);
  for (let lon = 180; lon >= -180; lon -= 2) ring.push([lon, -edge]);
  if (s < 0) { for (const q of ring) q[1] = -q[1]; ring.reverse(); }
  return { type: "Polygon", coordinates: [ring] };
}

export function familyMember(property, lat1, hemisphere = "north", { edge = null } = {}) {
  const s = hemisphere === "south" ? -1 : 1;
  let p;
  if (lat1 > 89.75) {
    const rot = [0, -90 * s], ca = edge === null ? 179.9 : 91 + edge;
    if (property === "conformal") p = d3.geoStereographic().rotate(rot).clipAngle(Math.min(ca, 150));
    else if (property === "equal-area") p = d3.geoAzimuthalEqualArea().rotate(rot).clipAngle(ca);
    else p = d3.geoAzimuthalEquidistant().rotate(rot).clipAngle(ca);
    return p;
  }
  if (lat1 < 0.25) {
    if (property === "conformal") p = d3.geoMercator();
    else if (property === "equal-area") p = d3.geoCylindricalEqualArea().parallel(0);
    else p = d3.geoEquirectangular();
  } else {
    const q = s * lat1;
    if (property === "conformal") p = d3.geoConicConformal().parallels([q, q]);
    else if (property === "equal-area") p = d3.geoConicEqualArea().parallels([q, q]);
    else p = d3.geoConicEquidistant().parallels([q, q]);
  }
  return p;
}

export function pathFor(projection, context = null) {
  return d3.geoPath(projection, context);
}

export function graticuleGeo(step = 15) {
  return d3.geoGraticule().step([step, step])();
}

export function aspectFrame({ aspect = "transverse", lon0 = 0, tilt = 90, azimuth = 90 } = {}) {
  if (aspect === "normal") return { pole: [0, 90], centre: [lon0, 0] };
  const t = aspect === "transverse" ? 90 : tilt, a = aspect === "transverse" ? 90 : azimuth;
  const wrap = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
  const pole = [wrap(lon0 + a), 90 - t];
  const Q = lonLatToXYZ(pole[0], pole[1]), P = lonLatToXYZ(lon0, 0);
  const d = Q[0] * P[0] + Q[1] * P[1] + Q[2] * P[2];
  const c = [P[0] - d * Q[0], P[1] - d * Q[1], P[2] - d * Q[2]];
  if (Math.hypot(c[0], c[1], c[2]) < 1e-9) return { pole, centre: [wrap(lon0 + a - 90), 0] };
  return { pole, centre: xyzToLonLat(c) };
}

export function aspectRotation(frame) {
  const { pole, centre } = frame;
  const r0 = d3.geoRotation([-centre[0], -centre[1], 0]);
  const q = r0(pole);
  let best = 0, bestLat = -Infinity;
  for (const g of [90 - q[1], q[1] - 90, 90 + q[1], -90 - q[1]]) {
    const lat = d3.geoRotation([-centre[0], -centre[1], g])(pole)[1];
    if (lat > bestLat) { bestLat = lat; best = g; }
  }
  return [-centre[0], -centre[1], best];
}

export function aspectMercator(frame) {
  return d3.geoMercator().rotate(aspectRotation(frame));
}

export function rotatedLonLat(rotation, lon, lat) {
  return d3.geoRotation(rotation)([lon, lat]);
}

export function unrotatedLonLat(rotation, lon, lat) {
  return d3.geoRotation(rotation).invert([lon, lat]);
}

export function frameThrough(a, b, centre = null) {
  const A = lonLatToXYZ(a[0], a[1]), B = lonLatToXYZ(b[0], b[1]);
  let Q = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
  const l = Math.hypot(Q[0], Q[1], Q[2]);
  Q = Q.map((v) => v / l);
  if (Q[2] < 0) Q = Q.map((v) => -v);
  const pole = xyzToLonLat(Q);
  const mid = centre ? lonLatToXYZ(centre[0], centre[1]) : slerp(A, B, 0.5);
  const d = mid[0] * Q[0] + mid[1] * Q[1] + mid[2] * Q[2];
  const c = [mid[0] - d * Q[0], mid[1] - d * Q[1], mid[2] - d * Q[2]];
  return { pole, centre: xyzToLonLat(c) };
}

export function sphereArea(geo) {
  return d3.geoArea(geo);
}

export function mergeTopology(topology, objectName, keep) {
  const geoms = topology.objects[objectName].geometries.filter(keep);
  return { type: "Feature", properties: {}, geometry: d3.topojson.merge(topology, geoms) };
}

export function topologyFeatures(topology, objectName = "countries") {
  return d3.topojson.feature(topology, topology.objects[objectName]).features;
}
