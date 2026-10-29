export const PI = Math.PI;
export const TAU = 2 * Math.PI;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const deg2rad = (d) => d * DEG;
export const rad2deg = (r) => r * RAD;
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (x - a) / (b - a);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mod = (x, m) => ((x % m) + m) % m;
export const wrapLon = (lon) => {
  const w = mod(lon + 180, 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
};
export const lerpAngle = (a, b, t) => a + (mod(b - a + 180, 360) - 180) * t;

export const vec3 = {
  of: (x = 0, y = 0, z = 0) => [x, y, z],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  angle: (a, b) => Math.atan2(vec3.length(vec3.cross(a, b)), vec3.dot(a, b)),
};

export function lonLatToXYZ(lon, lat, r = 1) {
  const l = lon * DEG, p = lat * DEG, c = Math.cos(p);
  return [r * c * Math.cos(l), r * c * Math.sin(l), r * Math.sin(p)];
}

export function xyzToLonLat(v) {
  const [x, y, z] = v;
  return [Math.atan2(y, x) * RAD, Math.atan2(z, Math.hypot(x, y)) * RAD];
}

export function lonLatToThree(lon, lat, r = 1) {
  const l = lon * DEG, p = lat * DEG, c = Math.cos(p);
  return [r * c * Math.sin(l), r * Math.sin(p), r * c * Math.cos(l)];
}

export function threeToLonLat(v) {
  const [x, y, z] = v;
  return [Math.atan2(x, z) * RAD, Math.atan2(y, Math.hypot(x, z)) * RAD];
}

export function slerp(a, b, t) {
  const w = vec3.angle(a, b);
  if (w < 1e-12) return vec3.lerp(a, b, t);
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

export const quat = {
  identity: () => [0, 0, 0, 1],
  fromAxisAngle(axis, angle) {
    const n = vec3.normalize(axis), s = Math.sin(angle / 2);
    return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
  },
  multiply(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  },
  conjugate: (q) => [-q[0], -q[1], -q[2], q[3]],
  normalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  rotate(q, v) {
    const [qx, qy, qz, qw] = q;
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [
      v[0] + qw * tx + qy * tz - qz * ty,
      v[1] + qw * ty + qz * tx - qx * tz,
      v[2] + qw * tz + qx * ty - qy * tx,
    ];
  },
  slerp(a, b, t) {
    let [bx, by, bz, bw] = b;
    let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    if (c > 0.9995) return quat.normalize([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
    const w = Math.acos(c), s = Math.sin(w);
    const ka = Math.sin((1 - t) * w) / s, kb = Math.sin(t * w) / s;
    return [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb];
  },
  fromUnitVectors(a, b) {
    const d = vec3.dot(a, b);
    if (d < -1 + 1e-12) {
      const axis = Math.abs(a[0]) < 0.9 ? vec3.cross(a, [1, 0, 0]) : vec3.cross(a, [0, 1, 0]);
      return quat.fromAxisAngle(axis, Math.PI);
    }
    const c = vec3.cross(a, b);
    return quat.normalize([c[0], c[1], c[2], 1 + d]);
  },
};

export function rotateLonLat(lon, lat, rotation) {
  const [dl, dp = 0, dg = 0] = rotation;
  let l = (lon + dl) * DEG;
  const p = lat * DEG;
  const cp = Math.cos(p);
  const x = Math.cos(l) * cp, y = Math.sin(l) * cp, z = Math.sin(p);
  const cdp = Math.cos(dp * DEG), sdp = Math.sin(dp * DEG), cdg = Math.cos(dg * DEG), sdg = Math.sin(dg * DEG);
  const k = z * cdp + x * sdp;
  return [
    Math.atan2(y * cdg - k * sdg, x * cdp - z * sdp) * RAD,
    Math.asin(clamp(k * cdg + y * sdg, -1, 1)) * RAD,
  ];
}

export function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb) => "#" + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("");

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const toSrgb = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export function rgbToOklab(rgb) {
  const r = toLinear(rgb[0]), g = toLinear(rgb[1]), b = toLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(lab) {
  const [L, a, b] = lab;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), 0, 255),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), 0, 255),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), 0, 255),
  ];
}

export function mixOklab(c1, c2, t) {
  const a = rgbToOklab(typeof c1 === "string" ? hexToRgb(c1) : c1);
  const b = rgbToOklab(typeof c2 === "string" ? hexToRgb(c2) : c2);
  return oklabToRgb([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
}

export function rampOklab(stops, x) {
  if (x <= stops[0][0]) return mixOklab(stops[0][1], stops[0][1], 0);
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) return mixOklab(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  const last = stops[stops.length - 1][1];
  return mixOklab(last, last, 0);
}

export function sphericalPolygonArea(ring) {
  const n = ring.length;
  if (n < 3) return 0;
  const v = ring.map(([lo, la]) => lonLatToXYZ(lo, la));
  const c = vec3.normalize(v.reduce((s, p) => vec3.add(s, p), [0, 0, 0]));
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = v[i], b = v[(i + 1) % n];
    const num = vec3.dot(c, vec3.cross(a, b));
    const den = 1 + vec3.dot(c, a) + vec3.dot(a, b) + vec3.dot(b, c);
    area += 2 * Math.atan2(num, den);
  }
  return Math.abs(area);
}

export function solveNewton2(f, target, guess, { tol = 1e-12, maxIter = 40, step = 1e-7, maxStep = 0.5 } = {}) {
  let [x, y] = guess;
  for (let it = 0; it < maxIter; it++) {
    const p = f(x, y);
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
    const ex = p[0] - target[0], ey = p[1] - target[1];
    if (Math.abs(ex) < tol && Math.abs(ey) < tol) return [x, y];
    const px = f(x + step, y), py = f(x, y + step);
    if (!px || !py) return null;
    const a = (px[0] - p[0]) / step, b = (py[0] - p[0]) / step;
    const c = (px[1] - p[1]) / step, d = (py[1] - p[1]) / step;
    const det = a * d - b * c;
    if (!det || !isFinite(det)) return null;
    let dx = (d * ex - b * ey) / det, dy = (a * ey - c * ex) / det;
    const m = Math.hypot(dx, dy);
    if (m > maxStep) { dx *= maxStep / m; dy *= maxStep / m; }
    x -= dx;
    y -= dy;
  }
  const p = f(x, y);
  return p && Math.hypot(p[0] - target[0], p[1] - target[1]) < 1e-8 ? [x, y] : null;
}
