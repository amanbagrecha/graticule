import * as THREE from "three";
import * as d3 from "d3";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import * as palette from "@/core/palette.js";
import { loadMesh, loadGeoJSON, loadImage } from "@/core/data.js";
import { getBasemap } from "@/core/basemap.js";
import { reducedMotion, dpr } from "@/core/env.js";
import { LabelLayer, defaultLabelItems } from "@/core/labels.js";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const FOV = 50;
const DIST_MIN = 1.25, DIST_MAX = 16, DIST_DEFAULT = 2.9;
const LINE_LIFT = 1.0015;
const MORPH_LIFT = 0.002;
const SPECULAR = 0.05;
const TEAR = 4;
const TEAR_MIN = 0.25;

export function lonLatToXYZ(lon, lat, out = [0, 0, 0], r = 1) {
  const la = lat * DEG, lo = lon * DEG, c = Math.cos(la) * r;
  out[0] = c * Math.sin(lo); out[1] = Math.sin(la) * r; out[2] = c * Math.cos(lo);
  return out;
}
export function xyzToLonLat(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return [Math.atan2(x, z) * RAD, Math.asin(Math.max(-1, Math.min(1, y / r))) * RAD];
}
const wrapRel = (d) => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function easeEmph(t) {
  return cubicBezier(0.3, 0, 0.1, 1, t);
}
function cubicBezier(x1, y1, x2, y2, t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2;
    const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
    if (x < t) lo = s; else hi = s;
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
}

function buildGrid(cols, rows, seam = 180, rotation = null) {
  const nc = cols + 1, nr = rows + 1;
  const nodeLon = new Float32Array(nc * nr), nodeLat = new Float32Array(nc * nr);
  for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
    nodeLon[j * nc + i] = seam - 360 + (360 * i) / cols;
    nodeLat[j * nc + i] = 90 - (180 * j) / rows;
  }
  let rotLon = null, rotLat = null;
  if (rotation) {
    const rot = d3.geoRotation(rotation);
    rotLon = Float32Array.from(nodeLon); rotLat = Float32Array.from(nodeLat);
    for (let k = 0; k < nodeLon.length; k++) {
      const ll = rot.invert([rotLon[k], rotLat[k]]);
      nodeLon[k] = ll[0]; nodeLat[k] = ll[1];
    }
  }
  const nv = cols * rows * 6;
  const vertNode = new Uint32Array(nv);
  let k = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
    vertNode[k++] = a; vertNode[k++] = c; vertNode[k++] = b;
    vertNode[k++] = b; vertNode[k++] = c; vertNode[k++] = d;
  }
  const m = finishMesh({ nodeLon, nodeLat, vertNode, cols: nc, rows: nr, kind: "grid" });
  if (rotation) { m.rotLon = rotLon; m.rotLat = rotLat; m.rotation = rotation.slice(); m.rot = d3.geoRotation(rotation); }
  return m;
}

function finishMesh(m) {
  const n = m.vertNode.length, nn = m.nodeLon.length;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const nodePos = new Float32Array(nn * 3);
  const p = [0, 0, 0];
  for (let i = 0; i < nn; i++) { lonLatToXYZ(m.nodeLon[i], m.nodeLat[i], p); nodePos[i * 3] = p[0]; nodePos[i * 3 + 1] = p[1]; nodePos[i * 3 + 2] = p[2]; }
  for (let v = 0; v < n; v += 3) {
    const lons = [m.nodeLon[m.vertNode[v]], m.nodeLon[m.vertNode[v + 1]], m.nodeLon[m.vertNode[v + 2]]];
    const lats = [m.nodeLat[m.vertNode[v]], m.nodeLat[m.vertNode[v + 1]], m.nodeLat[m.vertNode[v + 2]]];
    let ref = null;
    for (let q = 0; q < 3; q++) if (Math.abs(lats[q]) < 89.999) { ref = lons[q]; break; }
    if (ref === null) ref = lons[0];
    for (let q = 0; q < 3; q++) {
      const node = m.vertNode[v + q];
      let lon = lons[q];
      if (Math.abs(lats[q]) >= 89.999) lon = ref;
      lon = ref + wrapRel(lon - ref);
      const i = v + q;
      pos[i * 3] = nodePos[node * 3]; pos[i * 3 + 1] = nodePos[node * 3 + 1]; pos[i * 3 + 2] = nodePos[node * 3 + 2];
      nrm[i * 3] = nodePos[node * 3]; nrm[i * 3 + 1] = nodePos[node * 3 + 1]; nrm[i * 3 + 2] = nodePos[node * 3 + 2];
      uv[i * 2] = (lon + 180) / 360; uv[i * 2 + 1] = (90 - lats[q]) / 180;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aMorphPos", new THREE.BufferAttribute(pos.slice(), 3));
  g.setAttribute("aMorphNormal", new THREE.BufferAttribute(nrm.slice(), 3));
  m.geometry = g; m.nodePos = nodePos; m.nodeTarget = new Float32Array(nn * 3); m.nodeNormal = new Float32Array(nn * 3);
  m.edgeLen = null;
  return m;
}

function buildFaceMesh(poly, sub) {
  const nodeLon = [], nodeLat = [], nodeFace = [], vertNode = [];
  for (let f = 0; f < poly.faces.length; f++) {
    const face = poly.faces[f];
    const base = nodeLon.length;
    if (face.verts.length === 4) {
      const [v0, v1, v2, v3] = face.verts;
      for (let j = 0; j <= sub; j++) for (let i = 0; i <= sub; i++) {
        const s = i / sub, t = j / sub;
        const p = [0, 1, 2].map((k) => (v0[k] * (1 - s) + v1[k] * s) * (1 - t) + (v3[k] * (1 - s) + v2[k] * s) * t);
        const ll = xyzToLonLat(p[0], p[1], p[2]);
        nodeLon.push(ll[0]); nodeLat.push(ll[1]); nodeFace.push(f);
      }
      const nc = sub + 1;
      for (let j = 0; j < sub; j++) for (let i = 0; i < sub; i++) {
        const a = base + j * nc + i, b = a + 1, c = a + nc, d = c + 1;
        vertNode.push(a, b, c, b, d, c);
      }
    } else {
      const [v0, v1, v2] = face.verts;
      const idx = [];
      for (let i = 0; i <= sub; i++) {
        idx.push([]);
        for (let j = 0; j <= sub - i; j++) {
          const s = i / sub, t = j / sub;
          const p = [0, 1, 2].map((k) => v0[k] + (v1[k] - v0[k]) * s + (v2[k] - v0[k]) * t);
          const ll = xyzToLonLat(p[0], p[1], p[2]);
          idx[i].push(nodeLon.length);
          nodeLon.push(ll[0]); nodeLat.push(ll[1]); nodeFace.push(f);
        }
      }
      for (let i = 0; i < sub; i++) for (let j = 0; j < sub - i; j++) {
        vertNode.push(idx[i][j], idx[i + 1][j], idx[i][j + 1]);
        if (j < sub - i - 1) vertNode.push(idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]);
      }
    }
  }
  const m = finishMesh({ nodeLon: Float32Array.from(nodeLon), nodeLat: Float32Array.from(nodeLat), vertNode: Uint32Array.from(vertNode), kind: "faces" });
  m.nodeFace = Int16Array.from(nodeFace);
  return m;
}

const v3 = (a, b, c) => new THREE.Vector3(a, b, c);
function unitFace(vs) {
  const c = new THREE.Vector3();
  for (const v of vs) c.add(v3(v[0], v[1], v[2]));
  return c.normalize();
}

const ICO_VERTS = [[10.536199, 64.7], [-143.47849, 50.103201], [122.3, 39.1], [-67.132326, 23.717925], [58.157706, 10.447345], [-5.24539, 2.300882], [174.75461, -2.300882], [-121.842294, -10.447345], [112.867674, -23.717925], [-57.7, -39.1], [36.52151, -50.103201], [-169.463801, -64.7]];

const polyCache = new Map();
export function polyhedron(kind) {
  if (polyCache.has(kind)) return polyCache.get(kind);
  let faces;
  if (kind === "cube") {
    const C = [[1, 1, 1], [-1, 1, 1], [-1, -1, 1], [1, -1, 1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]];
    const q = (a, b, c, d) => [C[a], C[b], C[c], C[d]];
    faces = [
      { verts: q(0, 1, 2, 3), n: [0, 0, 1] },
      { verts: q(4, 0, 3, 7), n: [1, 0, 0] },
      { verts: q(4, 5, 1, 0), n: [0, 1, 0] },
      { verts: q(5, 4, 7, 6), n: [0, 0, -1] },
      { verts: q(1, 5, 6, 2), n: [-1, 0, 0] },
      { verts: q(3, 2, 6, 7), n: [0, -1, 0] }
    ];
    for (let f = 0; f < 6; f++) faces[f].parent = f - 1;
  } else {
    const inr = 0.7946544723;
    const V = ICO_VERTS.map(([lon, lat]) => lonLatToXYZ(lon, lat, [0, 0, 0], 1 / inr));
    const U = ICO_VERTS.map(([lon, lat]) => lonLatToXYZ(lon, lat));
    const adj = (i, j) => U[i][0] * U[j][0] + U[i][1] * U[j][1] + U[i][2] * U[j][2] > 0.3;
    faces = [];
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
      if (adj(i, j) && adj(j, k) && adj(i, k)) {
        const n = unitFace([V[i], V[j], V[k]]);
        const e1 = v3(...V[j]).sub(v3(...V[i])), e2 = v3(...V[k]).sub(v3(...V[i]));
        const cw = e1.cross(e2).dot(n) < 0;
        faces.push({ verts: cw ? [V[i], V[k], V[j]] : [V[i], V[j], V[k]], ids: [i, j, k], n: [n.x, n.y, n.z], parent: -1 });
      }
    }
    let north = 0;
    for (let i = 1; i < 12; i++) if (U[i][1] > U[north][1]) north = i;
    let south = 0;
    for (let i = 1; i < 12; i++) if (U[i][1] < U[south][1]) south = i;
    const axis = v3(...U[north]);
    const ref = v3(0, 0, 1).sub(axis.clone().multiplyScalar(axis.z)).normalize();
    const ref2 = axis.clone().cross(ref);
    const top = [], bottom = [], strip = [];
    faces.forEach((f, i) => { if (f.ids.includes(north)) top.push(i); else if (f.ids.includes(south)) bottom.push(i); else strip.push(i); });
    const az = (i) => { const n = v3(...faces[i].n); return Math.atan2(n.dot(ref2), n.dot(ref)); };
    strip.sort((a, b) => az(a) - az(b));
    const shares = (a, b) => faces[a].ids.filter((x) => faces[b].ids.includes(x)).length === 2;
    for (let s = 1; s < strip.length; s++) faces[strip[s]].parent = strip[s - 1];
    for (const t of top) faces[t].parent = strip.find((s) => shares(s, t));
    for (const b of bottom) faces[b].parent = strip.find((s) => shares(s, b));
    const order = [strip[0]];
    const rest = faces.map((_, i) => i).filter((i) => i !== strip[0]);
    while (rest.length) {
      for (let r = 0; r < rest.length; r++) if (order.includes(faces[rest[r]].parent)) { order.push(rest[r]); rest.splice(r, 1); break; }
    }
    const reordered = order.map((i) => faces[i]);
    const remap = new Map(order.map((old, idx) => [old, idx]));
    reordered.forEach((f) => { f.parent = f.parent === -1 ? -1 : remap.get(f.parent); f.cap = f.ids.includes(north) ? "top" : f.ids.includes(south) ? "bottom" : null; });
    faces = reordered;
  }
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    face.normal = v3(...face.n);
    if (face.parent < 0) continue;
    const par = faces[face.parent];
    const shared = face.verts.filter((v) => par.verts.some((w) => Math.abs(w[0] - v[0]) + Math.abs(w[1] - v[1]) + Math.abs(w[2] - v[2]) < 1e-6));
    const A = v3(...shared[0]), B = v3(...shared[1]);
    const a = B.clone().sub(A).normalize();
    const nc = face.normal, np = par.normal;
    face.hinge = A;
    face.axis = a;
    face.angle = Math.atan2(a.dot(nc.clone().cross(np)), nc.dot(np));
  }
  const poly = { kind, faces, mats: faces.map(() => new THREE.Matrix4()), rots: faces.map(() => new THREE.Matrix4()) };
  composeNet(poly, 1);
  const centres = faces.map((f, i) => unitFace(f.verts).applyMatrix4(poly.mats[i]));
  const root = faces[0].normal.clone();
  let d;
  if (kind === "cube") d = v3(1, 0, 0);
  else {
    const strip = faces.map((f, i) => (f.cap ? -1 : i)).filter((i) => i >= 0);
    d = centres[strip[2]].clone().sub(centres[strip[0]]);
    d.sub(root.clone().multiplyScalar(d.dot(root))).normalize();
    const up = root.clone().cross(d);
    const capIdx = faces.findIndex((f) => f.cap === "top");
    if (capIdx > 0 && centres[capIdx].clone().sub(centres[0]).dot(up) < 0) d.negate();
  }
  const up = root.clone().cross(d);
  const m3 = new THREE.Matrix4().makeBasis(d, up, root).transpose();
  poly.qFinal = new THREE.Quaternion().setFromRotationMatrix(m3);
  const allPts = [];
  faces.forEach((f, i) => f.verts.forEach((v) => allPts.push(v3(...v).applyMatrix4(poly.mats[i]).applyQuaternion(poly.qFinal))));
  const bb = new THREE.Box3().setFromPoints(allPts);
  const size = bb.getSize(new THREE.Vector3());
  poly.scale = Math.min(1, 4.0 / size.x, 2.5 / size.y);
  const c = bb.getCenter(new THREE.Vector3());
  poly.centre = v3(c.x * poly.scale, c.y * poly.scale, poly.scale);
  polyCache.set(kind, poly);
  return poly;
}

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3();
function composeNet(poly, u) {
  for (let f = 0; f < poly.faces.length; f++) {
    const face = poly.faces[f];
    if (face.parent < 0) { poly.mats[f].identity(); poly.rots[f].identity(); continue; }
    tmpQ.setFromAxisAngle(face.axis, face.angle * u);
    tmpM.makeRotationFromQuaternion(tmpQ);
    tmpM2.makeTranslation(-face.hinge.x, -face.hinge.y, -face.hinge.z);
    tmpM.multiply(tmpM2);
    tmpM2.makeTranslation(face.hinge.x, face.hinge.y, face.hinge.z);
    tmpM.premultiply(tmpM2);
    poly.mats[f].multiplyMatrices(poly.mats[face.parent], tmpM);
    tmpM.makeRotationFromQuaternion(tmpQ);
    poly.rots[f].multiplyMatrices(poly.rots[face.parent], tmpM);
  }
}

export const morphs = {
  toCylinder({ lat0 = 0, seam = 180, rule = "conformal", latMax = 85 } = {}) {
    const lon0 = wrapRel(seam - 180), r0 = Math.cos(lat0 * DEG), c0 = r0;
    const yRule = (lat) => {
      const phi = lat * DEG;
      if (rule === "equal-area") return Math.sin(phi) / c0;
      if (rule === "equidistant") return phi;
      const p = clamp(phi, -latMax * DEG, latMax * DEG);
      return c0 * Math.log(Math.tan(Math.PI / 4 + p / 2));
    };
    const cs = Math.cos(lon0 * DEG), sn = Math.sin(lon0 * DEG);
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const rel = wrapRel(lon - lon0) * DEG;
      const phi = lat * DEG;
      const ys = Math.sin(phi), cl = Math.cos(phi);
      let x, y, z;
      if (t <= 0.4) {
        const a = smooth(t / 0.4);
        const r = lerp(cl, r0, a);
        x = r * Math.sin(rel); y = ys; z = r * Math.cos(rel);
      } else {
        const s = r0 * rel;
        let u = clamp((t - 0.4) / 0.45, 0, 1);
        const kap = Math.max((1 - u) * (1 - u), 0.004);
        const R = r0 / kap, ph = s / R;
        let bx = R * Math.sin(ph), bz = r0 - R + R * Math.cos(ph), by = ys;
        if (t > 0.85) {
          const c = smooth((t - 0.85) / 0.15);
          bx = lerp(bx, s, c); bz = lerp(bz, 0, c); by = lerp(ys, yRule(lat), c);
        }
        x = bx; y = by; z = bz;
      }
      out[0] = x * cs + z * sn; out[1] = y; out[2] = -x * sn + z * cs;
      return out;
    };
    fn.phased = true; fn.seam = seam; fn.lon0 = lon0; fn.latMax = latMax;
    return fn;
  },
  toAspectCylinder({ rotate = [0, 0, 0], rule = "conformal", latMax = 85 } = {}) {
    const rot = d3.geoRotation(rotate);
    const C = lonLatToXYZ(...rot.invert([0, 0])), Q = lonLatToXYZ(...rot.invert([0, 90])), E = lonLatToXYZ(...rot.invert([90, 0]));
    const base = morphs.toCylinder({ lat0: 0, seam: 180, rule, latMax });
    const tmp = [0, 0, 0];
    const rotated = (lr, br, t, out = [0, 0, 0]) => {
      base(lr, br, t, tmp);
      out[0] = tmp[0] * E[0] + tmp[1] * Q[0] + tmp[2] * C[0];
      out[1] = tmp[0] * E[1] + tmp[1] * Q[1] + tmp[2] * C[1];
      out[2] = tmp[0] * E[2] + tmp[1] * Q[2] + tmp[2] * C[2];
      return out;
    };
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const r = rot([lon, lat]);
      return rotated(r[0], r[1], t, out);
    };
    fn.phased = true; fn.seam = 180; fn.gridRotation = rotate.slice(); fn.rotated = rotated; fn.rotate = rotate.slice(); fn.pole = Q; fn.centre = C; fn.east = E;
    fn.toWorld = (p) => [p[0] * E[0] + p[1] * Q[0] + p[2] * C[0], p[0] * E[1] + p[1] * Q[1] + p[2] * C[1], p[0] * E[2] + p[1] * Q[2] + p[2] * C[2]];
    return fn;
  },
  toCone({ lat0 = 40, seam = 180, rule = "conformal", span = 3 } = {}) {
    const phi0 = clamp(lat0, 0.5, 89.5) * DEG, n = Math.sin(phi0), c0 = Math.cos(phi0), lon0 = wrapRel(seam - 180);
    const ya = 1 / n, rho0 = c0 / n, tan0 = Math.tan(Math.PI / 4 - phi0 / 2);
    const dRule = (phi) => {
      if (rule === "equidistant") return phi0 - phi;
      if (rule === "equal-area") {
        const a = Math.sqrt(Math.max(1 + n * n - 2 * n * Math.sin(phi), 0));
        return (-2 * (Math.sin(phi) - n)) / (a + c0);
      }
      const r = Math.tan(Math.PI / 4 - phi / 2) / tan0;
      const d = r <= 0 ? -rho0 : rho0 * Math.expm1(n * Math.log(r));
      return clamp(d, Math.max(-rho0, -span), span);
    };
    const dGeo = (phi) => phi0 - phi;
    const rhoLo = rho0 + dRule(Math.PI / 2), rhoHi = rho0 + dRule(-Math.PI / 2), halfSector = Math.PI * n;
    const yMin = -rhoHi, yMax = halfSector >= Math.PI / 2 ? -rhoHi * Math.cos(halfSector) : -rhoLo * Math.cos(halfSector);
    const yApex = -(yMin + yMax) / 2;
    const q0y = (u) => lerp(n, yApex - rho0, u), q0z = (u) => lerp(c0, 0, u);
    let lastT = NaN, lastP = null;
    const phases = (t) => {
      if (t === lastT) return lastP;
      const u = smooth(clamp((t - 0.4) / 0.45, 0, 1)), c = t > 0.85 ? smooth((t - 0.85) / 0.15) : 0;
      const alpha = phi0 + (Math.PI / 2 - phi0) * u, beta = (u * Math.PI) / 2;
      lastT = t;
      lastP = { u, c, alpha, beta, sa: Math.sin(alpha), ca: Math.cos(alpha), sb: Math.sin(beta), cb: Math.cos(beta), qy: lerp(n, yApex - rho0, u), qz: lerp(c0, 0, u) };
      return lastP;
    };
    const cs = Math.cos(lon0 * DEG), sn = Math.sin(lon0 * DEG);
    const rot = (x, y, z, out) => { out[0] = x * cs + z * sn; out[1] = y; out[2] = -x * sn + z * cs; return out; };
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const th = wrapRel(lon - lon0) * DEG, phi = lat * DEG;
      let x, y, z;
      if (t <= 0.4) {
        const a = smooth(t / 0.4), d = dGeo(phi), cl = Math.cos(phi), r = c0 + d * n;
        x = lerp(cl * Math.sin(th), r * Math.sin(th), a);
        y = lerp(Math.sin(phi), n - d * c0, a);
        z = lerp(cl * Math.cos(th), r * Math.cos(th), a);
      } else {
        const p = phases(t);
        const d = p.c > 0 ? lerp(dGeo(phi), dRule(phi), p.c) : dGeo(phi);
        const psi = (th * n) / p.sa, hp = Math.sin(psi / 2);
        const A = -2 * rho0 * hp * hp, B = rho0 * Math.sin(psi);
        const P1 = p.sa * (A + d * Math.cos(psi)), P2 = p.sa * (B + d * Math.sin(psi)), P3 = -d * p.ca;
        x = P2; y = -P1 * p.sb + P3 * p.cb + p.qy; z = P1 * p.cb + P3 * p.sb + p.qz;
      }
      return rot(x, y, z, out);
    };
    fn.phased = true; fn.seam = seam; fn.lon0 = lon0; fn.n = n; fn.rho0 = rho0; fn.apexHeight = ya; fn.sectorDeg = 360 * n;
    fn.rho = (lat, t = 1) => {
      const phi = lat * DEG;
      if (t <= 0.4) return rho0 + dGeo(phi);
      const p = phases(t);
      return rho0 + lerp(dGeo(phi), dRule(phi), p.c);
    };
    fn.frame = (t) => {
      const p = t <= 0.4 ? { u: 0, c: 0, alpha: phi0, beta: 0, sa: n, ca: c0, sb: 0, cb: 1 } : phases(t);
      const axis = rot(0, p.cb, p.sb, [0, 0, 0]);
      const apex = rot(0, q0y(p.u) + rho0 * Math.cos(p.alpha - p.beta), q0z(p.u) + rho0 * Math.sin(p.beta - p.alpha), [0, 0, 0]);
      const psiOf = (lon) => (wrapRel(lon - lon0) * DEG * n) / p.sa;
      const generator = (lon, out = [0, 0, 0]) => {
        const psi = psiOf(lon), cp = Math.cos(psi), sp = Math.sin(psi);
        return rot(p.sa * sp, -p.sa * cp * p.sb - p.ca * p.cb, p.sa * cp * p.cb - p.ca * p.sb, out);
      };
      const normal = (lon, out = [0, 0, 0]) => {
        const psi = psiOf(lon), cp = Math.cos(psi), sp = Math.sin(psi);
        return rot(p.ca * sp, -p.ca * cp * p.sb + p.sa * p.cb, p.ca * cp * p.cb + p.sa * p.sb, out);
      };
      const ring = (lon, out = [0, 0, 0]) => fn(lon, phi0 * RAD, t, out);
      return { ...p, t, apex, axis, rho0, n, generator, normal, ring, psiOf };
    };
    return fn;
  },
  toPlane({ lat0 = 90, lon0 = 0, rule = "equidistant" } = {}) {
    const P0 = lonLatToXYZ(lon0, lat0);
    const E = [Math.cos(lon0 * DEG), 0, -Math.sin(lon0 * DEG)];
    const N = [-Math.sin(lat0 * DEG) * Math.sin(lon0 * DEG), Math.cos(lat0 * DEG), -Math.sin(lat0 * DEG) * Math.cos(lon0 * DEG)];
    const rho = (c) => {
      if (rule === "equal-area") return 2 * Math.sin(c / 2);
      if (rule === "conformal" || rule === "stereographic") return 2 * Math.tan(Math.min(c, 150 * DEG) / 2);
      if (rule === "gnomonic") return Math.tan(Math.min(c, 72 * DEG));
      if (rule === "orthographic") return Math.sin(Math.min(c, Math.PI / 2));
      return c;
    };
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const P = lonLatToXYZ(lon, lat);
      const d = clamp(P[0] * P0[0] + P[1] * P0[1] + P[2] * P0[2], -1, 1);
      const c = Math.acos(d);
      let dx = 0, dy = 0;
      if (c > 1e-9) {
        const tx = P[0] - P0[0] * d, ty = P[1] - P0[1] * d, tz = P[2] - P0[2] * d;
        const l = Math.hypot(tx, ty, tz) || 1;
        dx = (tx * E[0] + ty * E[1] + tz * E[2]) / l; dy = (tx * N[0] + ty * N[1] + tz * N[2]) / l;
      }
      const r = rho(c), h = 1 - t;
      const mx = P0[0] * h + r * (dx * E[0] + dy * N[0]);
      const my = P0[1] * h + r * (dx * E[1] + dy * N[1]);
      const mz = P0[2] * h + r * (dx * E[2] + dy * N[2]);
      const s = smooth(t);
      out[0] = lerp(P[0], mx, s); out[1] = lerp(P[1], my, s); out[2] = lerp(P[2], mz, s);
      return out;
    };
    fn.phased = true;
    return fn;
  },
  toPolyhedron(kind = "cube") {
    const poly = polyhedron(kind);
    const faceOf = (P) => {
      let best = 0, bd = -2;
      for (let f = 0; f < poly.faces.length; f++) {
        const n = poly.faces[f].n, d = P[0] * n[0] + P[1] * n[1] + P[2] * n[2];
        if (d > bd) { bd = d; best = f; }
      }
      return best;
    };
    let lastU = -1;
    const q = new THREE.Quaternion();
    const prep = (t) => {
      const u = t <= 0.5 ? 0 : smooth((t - 0.5) / 0.5);
      if (u !== lastU) { composeNet(poly, u); q.copy(new THREE.Quaternion()).slerp(poly.qFinal, u); lastU = u; }
      return u;
    };
    const fn = (lon, lat, t, out = [0, 0, 0], face = -1) => {
      const P = lonLatToXYZ(lon, lat);
      const f = face >= 0 ? face : faceOf(P);
      const n = poly.faces[f].n;
      const d = Math.max(P[0] * n[0] + P[1] * n[1] + P[2] * n[2], 0.2);
      const g = [P[0] / d, P[1] / d, P[2] / d];
      if (t <= 0.5) {
        const a = smooth(t / 0.5);
        out[0] = lerp(P[0], g[0], a); out[1] = lerp(P[1], g[1], a); out[2] = lerp(P[2], g[2], a);
        return out;
      }
      const u = prep(t);
      tmpV.set(g[0], g[1], g[2]).applyMatrix4(poly.mats[f]).applyQuaternion(q);
      const s = lerp(1, poly.scale, u);
      out[0] = tmpV.x * s - poly.centre.x * u; out[1] = tmpV.y * s - poly.centre.y * u; out[2] = tmpV.z * s - poly.centre.z * u;
      return out;
    };
    fn.normal = (lon, lat, t, out = [0, 0, 0], face = -1) => {
      const P = lonLatToXYZ(lon, lat);
      const f = face >= 0 ? face : faceOf(P);
      const n = poly.faces[f].n;
      if (t <= 0.5) {
        const a = smooth(t / 0.5);
        tmpV.set(lerp(P[0], n[0], a), lerp(P[1], n[1], a), lerp(P[2], n[2], a)).normalize();
      } else {
        prep(t);
        tmpV.set(n[0], n[1], n[2]).applyMatrix4(poly.rots[f]).applyQuaternion(q);
      }
      out[0] = tmpV.x; out[1] = tmpV.y; out[2] = tmpV.z;
      return out;
    };
    fn.phased = true; fn.mesh = kind; fn.face = (lon, lat) => faceOf(lonLatToXYZ(lon, lat)); fn.poly = poly;
    return fn;
  },
  toProjection(proj, { width = 2.8 } = {}) {
    const path = d3.geoPath(proj);
    const b = path.bounds({ type: "Sphere" });
    const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
    const s = width / Math.max(w, h / 1.6);
    const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
    const rot = proj.rotate ? proj.rotate() : [0, 0, 0];
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const p = proj([lon, lat]);
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) { out[0] = NaN; out[1] = NaN; out[2] = NaN; return out; }
      out[0] = (p[0] - cx) * s; out[1] = -(p[1] - cy) * s; out[2] = 0;
      return out;
    };
    fn.phased = false; fn.seam = wrapRel(180 - rot[0]); fn.scale = s; fn.centre = [cx, cy];
    return fn;
  },
  toEllipsoid(f = 1 / 298.257223563) {
    const e2 = 2 * f - f * f;
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const phi = lat * DEG, s = Math.sin(phi), c = Math.cos(phi);
      const N = 1 / Math.sqrt(1 - e2 * s * s);
      out[0] = N * c * Math.sin(lon * DEG); out[1] = N * (1 - e2) * s; out[2] = N * c * Math.cos(lon * DEG);
      return out;
    };
    fn.phased = false;
    return fn;
  },
  toGeoid(sample, exaggeration = 8000, R = 6371000) {
    const fn = (lon, lat, t, out = [0, 0, 0]) => {
      const r = 1 + (sample(lon, lat) * exaggeration) / R;
      return lonLatToXYZ(lon, lat, out, r);
    };
    fn.phased = false;
    return fn;
  },
  toHeight(sample, exaggeration = 20, R = 6371000) {
    const fn = (lon, lat, t, out = [0, 0, 0]) => lonLatToXYZ(lon, lat, out, 1 + (Math.max(sample(lon, lat), 0) * exaggeration) / R);
    fn.phased = false;
    return fn;
  }
};

const ATMO_VERT = `
varying vec3 vWorld;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const ATMO_FRAG = `
uniform vec3 uColor; uniform float uFade; uniform float uOuter;
varying vec3 vWorld;
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float tc = -dot(cameraPosition, d);
  float b = length(cameraPosition + d * tc);
  float w = max(fwidth(b), 1e-5);
  float ring = 1.0 - smoothstep(0.6 * w, 1.6 * w, abs(b - 1.0 - 0.6 * w));
  float halo = b > 1.0 ? 0.07 * pow(max(1.0 - (b - 1.0) / (uOuter - 1.0), 0.0), 3.0) : 0.0;
  float a = max(ring * 0.7, halo) * uFade;
  gl_FragColor = vec4(uColor, a);
}`;

export class Globe {
  constructor(stageEl, { colour = "ramp", light = "camera", labels = false, coastline = "50m", background = null } = {}) {
    this.el = stageEl;
    this.opts = { colour, light, labels, coastline };
    this.layers = { ocean: true, land: true, coast: true, borders: false, rivers: false, lakes: false, graticule: true, atmosphere: true, surface: true, labels, custom: new Map() };
    this.gratOpts = { minor: true, major: true, equator: true, tropics: true };
    this.listeners = new Map();
    this.lineLayers = new Map();
    this.overlays = new Map();
    this.extra = new Map();
    this.width = 1; this.height = 1;
    this.morphFn = null; this.morphT = 0; this.morphDirty = false;
    this.lineCache = new Map();
    this.disposed = false;
    this.needsRender = true;
    this.animations = new Set();
    this.lockAxis = null;
    this.sunLonLat = [0, 0];
    this.minorStep = 10;
    this.frameTimes = [];

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;cursor:grab;";
    stageEl.appendChild(canvas);
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    if (background) { canvas.style.background = background; }

    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
    this.dist = DIST_DEFAULT;
    this.pan = [0, 0];
    this.camera.position.set(0, 0, this.dist);
    this.camera.lookAt(0, 0, 0);

    const key = new THREE.DirectionalLight(palette.light.key, palette.light.keyIntensity);
    const kd = palette.light.keyDir;
    key.position.set(kd[0] * 10, kd[1] * 10, kd[2] * 10);
    key.target.position.set(0, 0, 0);
    this.scene.add(key, key.target);
    this.keyLight = key;
    const hemi = new THREE.HemisphereLight(palette.light.sky, palette.light.ground, palette.light.fillIntensity);
    this.scene.add(hemi);
    this.sunLight = new THREE.DirectionalLight(0xffffff, palette.light.sunIntensity);
    this.sunLight.position.set(0, 0, 50);
    this.sunLight.target = new THREE.Object3D();
    this.group.add(this.sunLight, this.sunLight.target);
    this.sunLight.visible = false;

    this.mesh = buildGrid(256, 128, 180); this.mesh.seam = 180;
    this.pickMesh = buildGrid(64, 32, 180); this.pickMesh.seam = 180;
    this.rayGeom = rayGeometry(this.pickMesh);
    this.pickObj = new THREE.Mesh(this.rayGeom, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    this.group.add(this.pickObj);
    this.raycaster = new THREE.Raycaster();

    this.uniforms = {
      uMorphT: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 0, 1) }, uSunMode: { value: 0 },
      uNight: { value: null }, uRim: { value: 0 }, uShowOcean: { value: 1 }, uShowLand: { value: 1 },
      uOverlay: { value: null }, uHasOverlay: { value: 0 }, uBg: { value: new THREE.Color(palette.ui.bg0) }
    };
    this.material = this.makeMaterial();
    this.surface = new THREE.Mesh(this.mesh.geometry, this.material);
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    this.atmoUniforms = { uColor: { value: new THREE.Color(palette.atmosphere.outer) }, uFade: { value: 1 }, uOuter: { value: 1.06 } };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 128, 64), new THREE.ShaderMaterial({
      uniforms: this.atmoUniforms, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide
    }));
    atmo.renderOrder = 10;
    this.atmo = atmo;
    this.scene.add(atmo);

    this.overlayCanvas = document.createElement("canvas");
    this.overlayCanvas.width = 4096; this.overlayCanvas.height = 2048;
    this.overlayCtx = this.overlayCanvas.getContext("2d", { willReadFrequently: true });
    this.overlayTex = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTex.flipY = false; this.overlayTex.colorSpace = THREE.SRGBColorSpace; this.overlayTex.anisotropy = 8; this.overlayTex.premultiplyAlpha = true;
    this.overlayProj = d3.geoEquirectangular().scale(4096 / (2 * Math.PI)).translate([2048, 1024]).precision(0.2);
    this.uniforms.uOverlay.value = this.overlayTex;

    this.labelLayer = new LabelLayer(stageEl);
    this.labels3d = new Map();
    this.labelInsetBottom = 0;
    this.label3dEl = document.createElement("div");
    this.label3dEl.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;";
    stageEl.appendChild(this.label3dEl);
    this.labelLayer.setVisible(labels);

    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stageEl);
    this.resize();
    this.ready = this.load();
  }

  makeMaterial() {
    const u = this.uniforms;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0, specularColor: new THREE.Color(palette.atmosphere.specular), specularIntensity: SPECULAR,
      normalScale: new THREE.Vector2(0.55, 0.55), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aMorphPos; attribute vec3 aMorphNormal; uniform float uMorphT; varying vec3 vSphereN; varying vec2 vGUv;")
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(mix(normal, aMorphNormal, uMorphT));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif\nvSphereN = normalize((modelMatrix * vec4(normal, 0.0)).xyz); vGUv = uv;")
        .replace("#include <begin_vertex>", "vec3 transformed = mix(position, aMorphPos, uMorphT);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uSunDir; uniform float uSunMode; uniform sampler2D uNight; uniform float uRim; uniform float uShowOcean; uniform float uShowLand; uniform sampler2D uOverlay; uniform float uHasOverlay; uniform vec3 uBg; uniform float uMorphT; varying vec3 vSphereN; varying vec2 vGUv; float gDay = 1.0;")
        .replace("#include <map_fragment>", `#include <map_fragment>
          float landMask = 1.0;
          #ifdef USE_ROUGHNESSMAP
          landMask = texture2D(roughnessMap, vGUv).r;
          #endif
          diffuseColor.rgb = mix(diffuseColor.rgb, uBg, (1.0 - landMask) * (1.0 - uShowOcean) + landMask * (1.0 - uShowLand));
          if (uHasOverlay > 0.5) { vec4 ov = texture2D(uOverlay, vGUv); diffuseColor.rgb = diffuseColor.rgb * (1.0 - ov.a) + ov.rgb; }`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          if (uSunMode > 0.5) {
            gDay = smoothstep(-0.052, 0.052, dot(normalize(vSphereN), uSunDir));
            vec3 nl = texture2D(uNight, vGUv).rgb;
            totalEmissiveRadiance += nl * nl * vec3(1.0, 0.85, 0.627) * ${palette.light.cityLights.toFixed(2)} * (1.0 - gDay) * landMask;
          }`)
        .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
          if (uSunMode > 0.5) { reflectedLight.indirectDiffuse *= mix(${palette.light.night.toFixed(2)}, 1.0, gDay); reflectedLight.indirectSpecular *= mix(${palette.light.night.toFixed(2)}, 1.0, gDay); }
          float rimF = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 3.0);
          reflectedLight.indirectDiffuse += vec3(0.561, 0.780, 1.0) * uRim * rimF * (1.0 - uMorphT) * 0.6;`);
    };
    mat.customProgramCacheKey = () => "graticule-globe";
    return mat;
  }

  async load() {
    const bm = await getBasemap({ colour: this.opts.colour });
    if (this.disposed) return;
    this.basemap = bm;
    const color = new THREE.DataTexture(bm.color, bm.width, bm.height, THREE.RGBAFormat);
    color.colorSpace = THREE.SRGBColorSpace; color.generateMipmaps = true; color.minFilter = THREE.LinearMipmapLinearFilter; color.magFilter = THREE.LinearFilter;
    color.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); color.wrapS = THREE.RepeatWrapping; color.needsUpdate = true;
    const w2 = bm.width / 2, h2 = bm.height / 2;
    const normal = new THREE.DataTexture(bm.normal, w2, h2, THREE.RGBAFormat);
    normal.generateMipmaps = true; normal.minFilter = THREE.LinearMipmapLinearFilter; normal.magFilter = THREE.LinearFilter; normal.wrapS = THREE.RepeatWrapping; normal.anisotropy = 4; normal.needsUpdate = true;
    const props = new Uint8Array(w2 * h2 * 4);
    for (let i = 0; i < w2 * h2; i++) {
      const land = bm.mask[i];
      props[i * 4] = land; props[i * 4 + 1] = Math.round(lerp(0.8, 0.95, land / 255) * 255); props[i * 4 + 2] = 0; props[i * 4 + 3] = 255;
    }
    const propsTex = new THREE.DataTexture(props, w2, h2, THREE.RGBAFormat);
    propsTex.generateMipmaps = true; propsTex.minFilter = THREE.LinearMipmapLinearFilter; propsTex.magFilter = THREE.LinearFilter; propsTex.wrapS = THREE.RepeatWrapping; propsTex.needsUpdate = true;
    this.material.map = color; this.material.normalMap = normal; this.material.roughnessMap = propsTex; this.material.needsUpdate = true;
    this.textures = { color, normal, props: propsTex };
    await this.buildBaseLines();
    if (this.opts.light === "sun") await this.enableSun();
    if (this.opts.labels) await this.loadLabels();
    this.invalidate();
  }

  async loadLabels() {
    if (!this.labelItems) { this.labelItems = await defaultLabelItems(2); this.labelLayer.setItems(this.labelItems); }
  }

  async enableSun() {
    if (!this.nightTex) {
      const img = await loadImage("earth_night_3600.jpg");
      const t = new THREE.Texture(img);
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; t.needsUpdate = true;
      this.nightTex = t;
      this.uniforms.uNight.value = t;
    }
    this.opts.light = "sun";
    this.uniforms.uSunMode.value = 1;
    this.keyLight.visible = false;
    this.sunLight.visible = true;
    this.setSun(this.sunLonLat[0], this.sunLonLat[1]);
    this.invalidate();
  }

  setLight(mode) {
    if (mode === "sun") return this.enableSun();
    this.opts.light = "camera";
    this.uniforms.uSunMode.value = 0;
    this.keyLight.visible = true;
    this.sunLight.visible = false;
    this.invalidate();
    return Promise.resolve();
  }

  setSun(lon, lat) {
    this.sunLonLat = [lon, lat];
    const p = lonLatToXYZ(lon, lat);
    this.sunLight.position.set(p[0] * 50, p[1] * 50, p[2] * 50);
    this.sunLight.target.position.set(0, 0, 0);
    if (this.opts.light !== "sun" && this.uniforms.uSunMode.value === 0) this.enableSun();
    this.invalidate();
  }

  async buildBaseLines() {
    const coastName = this.opts.coastline === "110m" ? "land-110m.json" : "land-50m.json";
    const coast = await loadMesh(coastName, "land");
    this.addLines("coast", meshToSegments(coast), { color: palette.lines.coast, width: 1, depth: true, base: "coast", smooth: true });
    this.buildGraticule();
    this.applyLayerVisibility();
  }

  async ensureBorders() {
    if (this.lineLayers.has("borders")) return;
    const b = await loadMesh("countries-50m.json", "countries", (a, c) => a !== c);
    this.addLines("borders", meshToSegments(b), { color: palette.lines.border, width: 0.8, depth: true, base: "borders" });
    this.applyLayerVisibility();
  }
  async ensureRivers() {
    if (this.lineLayers.has("rivers")) return;
    const r = await loadGeoJSON("ne_50m_rivers_lake_centerlines.geojson");
    const segs = [];
    for (const f of r.features) {
      const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
      for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1], l[i]]);
    }
    this.addLines("rivers", segs, { color: palette.lines.river, width: 0.6, depth: true, base: "rivers" });
    this.applyLayerVisibility();
  }
  async ensureLakes() {
    if (this.overlays.has("lakes")) return;
    const l = await loadGeoJSON("ne_50m_lakes.geojson");
    this.addPolygons("lakes", l.features.filter((f) => f.properties.scalerank <= 7), { fill: palette.lake, stroke: null, base: "lakes" });
    this.applyLayerVisibility();
  }

  buildGraticule() {
    const zoom = DIST_DEFAULT / this.dist;
    const step = zoom > 6 ? 1 : zoom > 2 ? 5 : 10;
    this.minorStep = step;
    const minor = [], major = [], equator = [], tropics = [];
    const sample = 2;
    const parallel = (lat, out) => { for (let lon = -180; lon < 180; lon += sample) out.push([[lon, lat], [lon + sample, lat]]); };
    const meridian = (lon, out, latMax = 90) => { for (let lat = -latMax; lat < latMax; lat += sample) out.push([[lon, lat], [lon, Math.min(lat + sample, latMax)]]); };
    for (let lat = -90 + step; lat < 90; lat += step) {
      if (lat === 0) continue;
      if (lat % 30 === 0) parallel(lat, major); else parallel(lat, minor);
    }
    for (let lon = -180; lon < 180; lon += step) {
      if (lon === 0) continue;
      if (lon % 30 === 0) meridian(lon, major); else meridian(lon, minor);
    }
    parallel(0, equator); meridian(0, equator);
    for (const lat of [23.44, -23.44, 66.56, -66.56]) parallel(lat, tropics);
    this.addLines("grat-minor", minor, { color: palette.lines.gratMinor, width: 1, depth: true, base: "graticule" });
    this.addLines("grat-major", major, { color: palette.lines.gratMajor, width: 1, depth: true, base: "graticule" });
    this.addLines("grat-equator", equator, { color: palette.lines.equator, width: 1.25, depth: true, base: "graticule" });
    this.addLines("grat-tropics", tropics, { color: palette.lines.tropic, width: 1, depth: true, dash: [6, 3], base: "graticule" });
    this.applyLayerVisibility();
  }

  setGraticule(opts) {
    Object.assign(this.gratOpts, opts);
    this.applyLayerVisibility();
  }

  setSurfaceOpacity(a = 1) {
    const v = clamp(a, 0, 1);
    this.material.opacity = v;
    this.material.transparent = v < 1;
    this.material.depthWrite = true;
    this.surface.renderOrder = v < 1 ? 1.9 : 0;
    this.material.needsUpdate = true;
    this.invalidate();
  }

  setLayer(name, on) {
    if (name in this.layers && name !== "custom") this.layers[name] = !!on;
    else this.layers.custom.set(name, !!on);
    if (name === "borders" && on) this.ensureBorders();
    if (name === "rivers" && on) this.ensureRivers();
    if (name === "lakes" && on) this.ensureLakes();
    if (name === "labels") { this.labelLayer.setVisible(!!on); if (on) this.loadLabels().then(() => this.invalidate()); }
    this.applyLayerVisibility();
  }

  applyLayerVisibility() {
    const L = this.layers, G = this.gratOpts;
    for (const [id, layer] of this.lineLayers) {
      let on = true;
      if (layer.base === "coast") on = L.coast;
      else if (layer.base === "borders") on = L.borders;
      else if (layer.base === "rivers") on = L.rivers && this.dist < 2.2;
      else if (layer.base === "graticule") {
        on = L.graticule && (id === "grat-minor" ? G.minor : id === "grat-major" ? G.major : id === "grat-equator" ? G.equator : G.tropics);
      } else if (L.custom.has(id)) on = L.custom.get(id);
      layer.mesh.visible = on;
    }
    for (const [id, ov] of this.overlays) {
      let on = true;
      if (ov.base === "lakes") on = L.lakes;
      else if (L.custom.has(id)) on = L.custom.get(id);
      if (ov.visible !== on) { ov.visible = on; this.overlayDirty = true; }
    }
    for (const [id, obj] of this.extra) if (L.custom.has(id)) obj.visible = L.custom.get(id);
    this.atmo.visible = L.atmosphere;
    this.surface.visible = L.surface;
    this.uniforms.uShowOcean.value = L.ocean ? 1 : 0;
    this.uniforms.uShowLand.value = L.land ? 1 : 0;
    this.invalidate();
  }

  addLines(id, segments, { color = palette.ui.signal, width = 1, depth = true, dash = null, opacity = null, base = null, smooth = false, morph = null } = {}) {
    this.remove(id);
    const n = segments.length;
    const lonlat = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const s = segments[i];
      lonlat[i * 4] = s[0][0]; lonlat[i * 4 + 1] = s[0][1]; lonlat[i * 4 + 2] = s[1][0]; lonlat[i * 4 + 3] = s[1][1];
    }
    const sphere = new Float32Array(n * 6);
    const p = [0, 0, 0];
    for (let i = 0; i < n * 2; i++) {
      lonLatToXYZ(lonlat[i * 2], lonlat[i * 2 + 1], p, LINE_LIFT);
      sphere[i * 3] = p[0]; sphere[i * 3 + 1] = p[1]; sphere[i * 3 + 2] = p[2];
    }
    const geom = new LineSegmentsGeometry();
    geom.setPositions(sphere.slice());
    const c = parseColor(color);
    const mat = new LineMaterial({
      color: c.hex, linewidth: width * dpr, transparent: true, opacity: opacity ?? c.a, depthTest: depth, depthWrite: false,
      dashed: !!dash, dashSize: dash ? dash[0] * 0.003 : 1, gapSize: dash ? dash[1] * 0.003 : 1, worldUnits: false, alphaToCoverage: smooth
    });
    mat.resolution.set(this.width * dpr, this.height * dpr);
    const mesh = new LineSegments2(geom, mat);
    if (dash) mesh.computeLineDistances();
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const layer = { id, lonlat, sphere, geom, mat, mesh, base, n, morph };
    this.lineLayers.set(id, layer);
    if (this.morphFn) this.morphLines(layer);
    this.invalidate();
    return layer;
  }

  setLineStyle(id, { opacity, color, width } = {}) {
    const l = this.lineLayers.get(id);
    const mat = l ? l.mat : this.extra.get(id)?.userData.segments3d ? this.extra.get(id).material : null;
    if (!mat) return false;
    if (color !== undefined) { const c = parseColor(color); mat.color.set(c.hex); if (opacity === undefined) mat.opacity = c.a; }
    if (opacity !== undefined) mat.opacity = opacity;
    if (width !== undefined) mat.linewidth = width * dpr;
    this.invalidate();
    return true;
  }

  addPolygons(id, features, { fill = "rgba(111,211,230,.25)", stroke = null, width = 1, opacity = 1, base = null } = {}) {
    this.remove(id);
    const fc = Array.isArray(features) ? { type: "FeatureCollection", features } : features;
    this.overlays.set(id, { id, fc, fill, stroke, width, opacity, base, visible: true });
    this.overlayDirty = true;
    this.invalidate();
  }

  addCanvasOverlay(id, draw, { opacity = 1 } = {}) {
    this.remove(id);
    this.overlays.set(id, { id, draw, opacity, visible: true });
    this.overlayDirty = true;
    this.invalidate();
  }

  refreshOverlay() {
    this.overlayDirty = true;
    this.invalidate();
  }

  redrawOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, 4096, 2048);
    let any = false;
    const path = d3.geoPath(this.overlayProj, ctx);
    for (const ov of this.overlays.values()) {
      if (!ov.visible) continue;
      any = true;
      ctx.globalAlpha = ov.opacity;
      if (ov.draw) { ctx.save(); try { ov.draw(ctx, this.overlayProj); } catch (e) { console.error("overlay " + ov.id, e); } ctx.restore(); continue; }
      ctx.beginPath();
      path(ov.fc);
      if (ov.fill) { ctx.fillStyle = ov.fill; ctx.fill(); }
      if (ov.stroke) { ctx.strokeStyle = ov.stroke; ctx.lineWidth = ov.width * 2; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    this.uniforms.uHasOverlay.value = any ? 1 : 0;
    this.overlayTex.needsUpdate = true;
    this.overlayDirty = false;
  }

  addPoints(id, lonlats, { color = palette.ui.signal, size = 6 } = {}) {
    this.remove(id);
    const n = lonlats.length;
    const pos = new Float32Array(n * 3), lonlat = new Float32Array(n * 2);
    const p = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      lonLatToXYZ(lonlats[i][0], lonlats[i][1], p, 1.003);
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
      lonlat[i * 2] = lonlats[i][0]; lonlat[i * 2 + 1] = lonlats[i][1];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const c = parseColor(color);
    const m = new THREE.PointsMaterial({ color: c.hex, size: size * dpr, sizeAttenuation: false, transparent: true, opacity: c.a, depthWrite: false, map: pointSprite(), alphaTest: 0.5 });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    pts.userData.lonlat = lonlat; pts.userData.sphere = pos.slice();
    this.group.add(pts);
    this.extra.set(id, pts);
    if (this.morphFn) this.morphPoints(pts);
    this.invalidate();
    return pts;
  }

  addMesh(id, geometry, material) {
    this.remove(id);
    const obj = geometry.isObject3D ? geometry : new THREE.Mesh(geometry, material);
    this.group.add(obj);
    this.extra.set(id, obj);
    this.invalidate();
    return obj;
  }

  addSegments3D(id, segments, { color = palette.ui.signal, width = 1, depth = true, dash = null, opacity = null, order = 2 } = {}) {
    this.remove(id);
    const geom = new LineSegmentsGeometry();
    geom.setPositions(flattenSegments(segments));
    const c = parseColor(color);
    const mat = new LineMaterial({
      color: c.hex, linewidth: width * dpr, transparent: true, opacity: opacity ?? c.a, depthTest: depth, depthWrite: false,
      dashed: !!dash, dashSize: dash ? dash[0] * 0.003 : 1, gapSize: dash ? dash[1] * 0.003 : 1, worldUnits: false
    });
    mat.resolution.set(this.width * dpr, this.height * dpr);
    const mesh = new LineSegments2(geom, mat);
    if (dash) mesh.computeLineDistances();
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData.segments3d = true;
    this.group.add(mesh);
    this.extra.set(id, mesh);
    this.invalidate();
    return mesh;
  }

  setSegments3D(id, segments, { opacity } = {}) {
    const mesh = this.extra.get(id);
    if (!mesh || !mesh.userData.segments3d) return null;
    const flat = flattenSegments(segments);
    const attr = mesh.geometry.attributes.instanceStart;
    if (attr && attr.data.array.length === flat.length) { attr.data.array.set(flat); attr.data.needsUpdate = true; }
    else { mesh.geometry.dispose(); mesh.geometry = new LineSegmentsGeometry(); mesh.geometry.setPositions(flat); }
    if (mesh.material.dashed) mesh.computeLineDistances();
    if (opacity !== undefined) mesh.material.opacity = opacity;
    mesh.geometry.computeBoundingSphere();
    this.invalidate();
    return mesh;
  }

  addTriangles(id, positions, { color = palette.ui.brass, opacity = 1, flat = true, side = "double", depthWrite = true, order = 1.5, lit = true, normals = null } = {}) {
    this.remove(id);
    const g = new THREE.BufferGeometry();
    const pos = positions instanceof Float32Array ? positions : Float32Array.from(positions.flat ? positions.flat() : positions);
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (normals) g.setAttribute("normal", new THREE.BufferAttribute(normals instanceof Float32Array ? normals : Float32Array.from(normals), 3));
    else g.computeVertexNormals();
    const c = parseColor(color);
    const common = { color: c.hex, transparent: opacity * c.a < 1, opacity: opacity * c.a, side: side === "front" ? THREE.FrontSide : THREE.DoubleSide, depthWrite, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const m = lit ? new THREE.MeshStandardMaterial({ ...common, roughness: 0.85, metalness: 0, flatShading: flat }) : new THREE.MeshBasicMaterial({ ...common, toneMapped: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData.triangles = true;
    this.group.add(mesh);
    this.extra.set(id, mesh);
    this.invalidate();
    return mesh;
  }

  setTriangles(id, positions, { normals = null, opacity, color } = {}) {
    const mesh = this.extra.get(id);
    if (!mesh || !mesh.userData.triangles) return null;
    const pos = positions instanceof Float32Array ? positions : Float32Array.from(positions);
    const attr = mesh.geometry.attributes.position;
    if (attr.array.length === pos.length) { attr.array.set(pos); attr.needsUpdate = true; }
    else mesh.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (normals) {
      const n = normals instanceof Float32Array ? normals : Float32Array.from(normals);
      const na = mesh.geometry.attributes.normal;
      if (na && na.array.length === n.length) { na.array.set(n); na.needsUpdate = true; }
      else mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(n, 3));
    } else mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    if (opacity !== undefined) { mesh.material.opacity = opacity; mesh.material.transparent = opacity < 1; }
    if (color !== undefined) mesh.material.color.set(parseColor(color).hex);
    this.invalidate();
    return mesh;
  }

  syncMatrices() {
    const q = this.group.quaternion, p = this.camera.position, k = this.matrixKey;
    if (k && k[0] === q.x && k[1] === q.y && k[2] === q.z && k[3] === q.w && k[4] === p.x && k[5] === p.y && k[6] === p.z) return;
    this.matrixKey = [q.x, q.y, q.z, q.w, p.x, p.y, p.z];
    this.camera.updateMatrixWorld();
    this.group.updateMatrixWorld(true);
  }

  ray(x, y) {
    this.syncMatrices();
    const nx = (x / this.width) * 2 - 1, ny = -(y / this.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const inv = this.group.quaternion.clone().invert();
    const o = this.raycaster.ray.origin.clone().applyQuaternion(inv), d = this.raycaster.ray.direction.clone().applyQuaternion(inv);
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  addPoints3D(id, points, { color = palette.ui.signal, size = 6, depth = true, order = 3 } = {}) {
    this.remove(id);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(flattenPoints(points), 3));
    const c = parseColor(color);
    const m = new THREE.PointsMaterial({ color: c.hex, size: size * dpr, sizeAttenuation: false, transparent: true, opacity: c.a, depthWrite: false, depthTest: depth, map: pointSprite(), alphaTest: 0.5 });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = order;
    pts.userData.points3d = true;
    this.group.add(pts);
    this.extra.set(id, pts);
    this.invalidate();
    return pts;
  }

  setPoints3D(id, points) {
    const pts = this.extra.get(id);
    if (!pts || !pts.userData.points3d) return null;
    const flat = flattenPoints(points);
    const attr = pts.geometry.attributes.position;
    if (attr.array.length === flat.length) { attr.array.set(flat); attr.needsUpdate = true; }
    else pts.geometry.setAttribute("position", new THREE.BufferAttribute(flat, 3));
    pts.geometry.computeBoundingSphere();
    this.invalidate();
    return pts;
  }

  addPanel(id, { centre = [0, 0, 1], xAxis = [1, 0, 0], yAxis = [0, 1, 0], half = 1, size = 1024, opacity = 1 } = {}) {
    this.remove(id);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: opacity < 1, opacity, side: THREE.DoubleSide, toneMapped: false, depthWrite: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = opacity < 1 ? 2.5 : 1;
    mesh.userData.panel = { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }), tex };
    this.group.add(mesh);
    this.extra.set(id, mesh);
    this.setPanel(id, { centre, xAxis, yAxis, half });
    return mesh.userData.panel;
  }

  setPanel(id, { centre, xAxis, yAxis, half, opacity, dirty = false } = {}) {
    const mesh = this.extra.get(id);
    if (!mesh || !mesh.userData.panel) return null;
    const P = mesh.userData.panel;
    if (centre) P.centre = centre; if (xAxis) P.xAxis = xAxis; if (yAxis) P.yAxis = yAxis; if (half) P.half = half;
    const c = P.centre, x = P.xAxis, y = P.yAxis, h = P.half;
    const arr = mesh.geometry.attributes.position.array;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], i) => {
      for (let q = 0; q < 3; q++) arr[i * 3 + q] = c[q] + (a * x[q] + b * y[q]) * h;
    });
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    if (opacity !== undefined) { mesh.material.opacity = opacity; mesh.material.transparent = opacity < 1; }
    if (dirty) P.tex.needsUpdate = true;
    this.invalidate();
    return P;
  }

  addLabel3D(id, point, text, { color = palette.ui.ink2, dx = 10, dy = -8, away = null, gap = 12, occlude = false } = {}) {
    this.remove(id);
    const el = document.createElement("div");
    el.className = "ov-label mono";
    el.style.color = color;
    el.style.willChange = "transform";
    el.textContent = text;
    this.label3dEl.appendChild(el);
    const lab = { id, el, point, text, dx, dy, away, gap, occlude, w: 0, h: 0, visible: true };
    this.labels3d.set(id, lab);
    this.invalidate();
    return lab;
  }

  setLabel3D(id, { point, text, color, dx, dy, away, visible } = {}) {
    const lab = this.labels3d.get(id);
    if (!lab) return null;
    if (point !== undefined) lab.point = point;
    if (text !== undefined && text !== lab.text) { lab.text = text; lab.el.textContent = text; lab.w = 0; }
    if (color !== undefined) lab.el.style.color = color;
    if (dx !== undefined) lab.dx = dx;
    if (dy !== undefined) lab.dy = dy;
    if (away !== undefined) lab.away = away;
    if (visible !== undefined) lab.visible = visible;
    this.invalidate();
    return lab;
  }

  placeLabels3D() {
    if (!this.labels3d.size) return;
    const W = this.width, H = this.height - this.labelInsetBottom;
    for (const lab of this.labels3d.values()) {
      const s = lab.visible && lab.point && lab.text ? this.projectPoint(lab.point, lab.occlude) : null;
      if (!s || !s.visible || !isFinite(s.x) || !isFinite(s.y)) { lab.el.style.display = "none"; continue; }
      lab.el.style.display = "";
      if (!lab.w) { lab.w = lab.el.offsetWidth; lab.h = lab.el.offsetHeight || 14; }
      const w = lab.w, h = lab.h;
      let x, y;
      if (lab.away) {
        const a = this.projectPoint(lab.away, false);
        let nx = s.x - a.x, ny = s.y - a.y;
        const l = Math.hypot(nx, ny);
        if (!isFinite(l) || l < 1e-6) { nx = 1; ny = 0; } else { nx /= l; ny /= l; }
        x = s.x + nx * lab.gap - (nx < -0.3 ? w : nx < 0.3 ? w / 2 : 0);
        y = s.y + ny * lab.gap - (ny < -0.3 ? h : ny < 0.3 ? h / 2 : 0);
      } else {
        x = lab.dx < 0 ? s.x + lab.dx - w : s.x + lab.dx;
        y = s.y + lab.dy;
      }
      if (x + w > W - 8) x = s.x - Math.abs(lab.dx || lab.gap) - w;
      if (x < 8) x = Math.min(s.x + Math.abs(lab.dx || lab.gap), W - w - 8);
      y = clamp(y, 8, Math.max(8, H - h - 8));
      lab.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  projectPoint(p, occlusion = true) {
    if (!p || !isFinite(p[0]) || !isFinite(p[1]) || !isFinite(p[2])) return { x: NaN, y: NaN, visible: false };
    this.syncMatrices();
    tmpV.set(p[0], p[1], p[2]).applyQuaternion(this.group.quaternion);
    let visible = true;
    if (occlusion) {
      const toCam = this.camera.position.clone().sub(tmpV);
      const d = toCam.length();
      this.raycaster.set(this.camera.position, toCam.normalize().negate());
      const hits = this.raycaster.intersectObject(this.pickObj, false);
      visible = !hits.length || hits[0].distance > d - 0.02;
    }
    tmpV.project(this.camera);
    if (tmpV.z > 1) visible = false;
    return { x: (tmpV.x + 1) / 2 * this.width, y: (1 - tmpV.y) / 2 * this.height, visible };
  }

  remove(id) {
    const l = this.lineLayers.get(id);
    if (l) { this.group.remove(l.mesh); l.geom.dispose(); l.mat.dispose(); this.lineLayers.delete(id); }
    if (this.overlays.delete(id)) this.overlayDirty = true;
    const e = this.extra.get(id);
    if (e) { this.group.remove(e); e.geometry?.dispose?.(); e.material?.dispose?.(); if (e.userData.panel) { e.userData.panel.tex.dispose(); e.userData.panel.canvas.width = e.userData.panel.canvas.height = 0; } this.extra.delete(id); }
    const lab = this.labels3d.get(id);
    if (lab) { lab.el.remove(); this.labels3d.delete(id); }
    this.invalidate();
  }
  removePrefix(prefix) {
    for (const id of [...this.lineLayers.keys(), ...this.overlays.keys(), ...this.extra.keys(), ...this.labels3d.keys()]) if (id.startsWith(prefix)) this.remove(id);
  }

  morph(fn, t = this.morphT) {
    const prev = this.morphFn;
    this.morphFn = fn || null;
    this.morphT = clamp(t, 0, 1);
    const wantMesh = fn && fn.mesh ? fn.mesh : "grid";
    const wantSeam = fn && fn.seam !== undefined ? fn.seam : 180;
    const wantRot = fn && fn.gridRotation ? fn.gridRotation.join(",") : "";
    const haveRot = this.mesh.rotation ? this.mesh.rotation.join(",") : "";
    if (wantMesh !== (this.mesh.kind === "faces" ? this.mesh.polyKind : "grid") || (wantMesh === "grid" && (this.mesh.seam !== wantSeam || wantRot !== haveRot))) this.rebuildMesh(wantMesh, wantSeam, fn);
    this.lineCache.clear();
    this.targetDirty = true;
    this.applyMorph(true);
    if (prev !== this.morphFn) this.lineCache.clear();
    this.invalidate();
  }

  setMorphT(t) {
    this.morphT = clamp(t, 0, 1);
    this.applyMorph(false);
    this.invalidate();
  }

  rebuildMesh(kind, seam, fn) {
    const old = this.mesh, oldPick = this.pickMesh;
    if (kind === "grid") {
      const rot = fn && fn.gridRotation ? fn.gridRotation : null;
      this.mesh = buildGrid(256, 128, rot ? 180 : seam, rot); this.mesh.seam = seam;
      this.pickMesh = buildGrid(64, 32, rot ? 180 : seam, rot); this.pickMesh.seam = seam;
    } else {
      const poly = fn.poly || polyhedron(kind);
      this.mesh = buildFaceMesh(poly, kind === "cube" ? 40 : 28); this.mesh.polyKind = kind;
      this.pickMesh = buildFaceMesh(poly, kind === "cube" ? 10 : 8); this.pickMesh.polyKind = kind;
    }
    this.surface.geometry = this.mesh.geometry;
    const oldRay = this.rayGeom;
    this.rayGeom = rayGeometry(this.pickMesh);
    this.pickObj.geometry = this.rayGeom;
    old.geometry.dispose(); oldPick.geometry.dispose(); oldRay.dispose();
  }

  applyMorph(force) {
    const fn = this.morphFn, t = this.morphT;
    if (!fn) {
      this.uniforms.uMorphT.value = 0;
      this.atmoUniforms.uFade.value = 1;
      this.material.specularIntensity = SPECULAR;
      for (const l of this.lineLayers.values()) this.restoreLines(l);
      for (const e of this.extra.values()) if (e.userData.sphere) this.restorePoints(e);
      this.syncRay();
      return;
    }
    const phased = fn.phased || fn.length >= 3 && fn.phased !== false;
    if (phased) {
      this.computeTarget(this.mesh, fn, t);
      this.computeTarget(this.pickMesh, fn, t);
      this.uniforms.uMorphT.value = t > 0 ? 1 : 0;
    } else {
      if (force || this.targetDirty) { this.computeTarget(this.mesh, fn, 1); this.computeTarget(this.pickMesh, fn, 1); this.targetDirty = false; }
      this.uniforms.uMorphT.value = t;
    }
    this.atmoUniforms.uFade.value = 1 - smooth(t / 0.3);
    this.material.specularIntensity = SPECULAR * (1 - smooth(t / 0.4));
    for (const l of this.lineLayers.values()) this.morphLines(l);
    for (const e of this.extra.values()) if (e.userData.sphere) this.morphPoints(e);
    this.syncRay();
  }

  syncRay() {
    const fn = this.morphFn, t = this.morphT, a = this.pickMesh.geometry.attributes;
    const sph = a.position.array, tgt = a.aMorphPos.array, attr = this.rayGeom.attributes.position, dst = attr.array;
    if (!fn || t === 0) dst.set(sph);
    else if (fn.phased || fn.length >= 3 && fn.phased !== false) dst.set(tgt);
    else for (let i = 0; i < dst.length; i++) dst[i] = isFinite(tgt[i]) ? sph[i] + (tgt[i] - sph[i]) * t : sph[i];
    attr.needsUpdate = true;
    this.rayGeom.computeBoundingSphere();
    this.rayGeom.computeBoundingBox();
  }

  computeTarget(m, fn, t) {
    const nn = m.nodeLon.length, tgt = m.nodeTarget, nrm = m.nodeNormal;
    const out = [0, 0, 0];
    const direct = m.rotLon && fn.rotated && fn.gridRotation && m.rotation.join(",") === fn.gridRotation.join(",");
    for (let i = 0; i < nn; i++) {
      if (direct) fn.rotated(m.rotLon[i], m.rotLat[i], t, out);
      else fn(m.nodeLon[i], m.nodeLat[i], t, out, m.nodeFace ? m.nodeFace[i] : -1);
      tgt[i * 3] = out[0]; tgt[i * 3 + 1] = out[1]; tgt[i * 3 + 2] = out[2];
    }
    const vn = m.vertNode, n = vn.length;
    const pos = m.geometry.attributes.aMorphPos.array, nor = m.geometry.attributes.aMorphNormal.array;
    const sph = m.geometry.attributes.position.array;
    if (m.kind === "grid" && !fn.normal) {
      const nc = m.cols, nr = m.rows;
      for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
        const k = j * nc + i;
        const ia = j * nc + Math.max(i - 1, 0), ib = j * nc + Math.min(i + 1, nc - 1);
        const ja = Math.max(j - 1, 0) * nc + i, jb = Math.min(j + 1, nr - 1) * nc + i;
        let ux = tgt[ib * 3] - tgt[ia * 3], uy = tgt[ib * 3 + 1] - tgt[ia * 3 + 1], uz = tgt[ib * 3 + 2] - tgt[ia * 3 + 2];
        let vx = tgt[ja * 3] - tgt[jb * 3], vy = tgt[ja * 3 + 1] - tgt[jb * 3 + 1], vz = tgt[ja * 3 + 2] - tgt[jb * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        let l = Math.hypot(nx, ny, nz);
        if (l < 1e-12 || j === 0 || j === nr - 1) {
          const jj = j === 0 ? 1 : j === nr - 1 ? nr - 2 : j;
          const kk = jj * nc + i;
          const ia2 = jj * nc + Math.max(i - 1, 0), ib2 = jj * nc + Math.min(i + 1, nc - 1), ja2 = Math.max(jj - 1, 0) * nc + i, jb2 = Math.min(jj + 1, nr - 1) * nc + i;
          ux = tgt[ib2 * 3] - tgt[ia2 * 3]; uy = tgt[ib2 * 3 + 1] - tgt[ia2 * 3 + 1]; uz = tgt[ib2 * 3 + 2] - tgt[ia2 * 3 + 2];
          vx = tgt[ja2 * 3] - tgt[jb2 * 3]; vy = tgt[ja2 * 3 + 1] - tgt[jb2 * 3 + 1]; vz = tgt[ja2 * 3 + 2] - tgt[jb2 * 3 + 2];
          nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx; l = Math.hypot(nx, ny, nz);
          void kk;
        }
        if (l < 1e-12) { nx = m.nodePos[k * 3]; ny = m.nodePos[k * 3 + 1]; nz = m.nodePos[k * 3 + 2]; l = 1; }
        nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
      }
      for (let v = 0; v < n; v++) {
        const k = vn[v];
        pos[v * 3] = tgt[k * 3]; pos[v * 3 + 1] = tgt[k * 3 + 1]; pos[v * 3 + 2] = tgt[k * 3 + 2];
        nor[v * 3] = nrm[k * 3]; nor[v * 3 + 1] = nrm[k * 3 + 1]; nor[v * 3 + 2] = nrm[k * 3 + 2];
      }
    } else if (fn.normal) {
      for (let i = 0; i < nn; i++) {
        fn.normal(m.nodeLon[i], m.nodeLat[i], t, out, m.nodeFace ? m.nodeFace[i] : -1);
        nrm[i * 3] = out[0]; nrm[i * 3 + 1] = out[1]; nrm[i * 3 + 2] = out[2];
      }
      for (let v = 0; v < n; v++) {
        const k = vn[v];
        pos[v * 3] = tgt[k * 3]; pos[v * 3 + 1] = tgt[k * 3 + 1]; pos[v * 3 + 2] = tgt[k * 3 + 2];
        nor[v * 3] = nrm[k * 3]; nor[v * 3 + 1] = nrm[k * 3 + 1]; nor[v * 3 + 2] = nrm[k * 3 + 2];
      }
    } else {
      for (let v = 0; v < n; v += 3) {
        for (let q = 0; q < 3; q++) { const k = vn[v + q]; pos[(v + q) * 3] = tgt[k * 3]; pos[(v + q) * 3 + 1] = tgt[k * 3 + 1]; pos[(v + q) * 3 + 2] = tgt[k * 3 + 2]; }
        const ax = pos[v * 3], ay = pos[v * 3 + 1], az = pos[v * 3 + 2];
        const ux = pos[v * 3 + 3] - ax, uy = pos[v * 3 + 4] - ay, uz = pos[v * 3 + 5] - az;
        const wx = pos[v * 3 + 6] - ax, wy = pos[v * 3 + 7] - ay, wz = pos[v * 3 + 8] - az;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        if (nx * sph[v * 3] + ny * sph[v * 3 + 1] + nz * sph[v * 3 + 2] < 0 && t < 0.5) { nx = -nx; ny = -ny; nz = -nz; }
        for (let q = 0; q < 3; q++) { nor[(v + q) * 3] = nx; nor[(v + q) * 3 + 1] = ny; nor[(v + q) * 3 + 2] = nz; }
      }
    }
    const tear = fn.meshTear ?? fn.tear ?? TEAR;
    for (let v = 0; v < n && isFinite(tear); v += 3) {
      let torn = false;
      for (let q = 0; q < 3 && !torn; q++) {
        const a = v + q, b = v + ((q + 1) % 3);
        const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        const sx = sph[a * 3] - sph[b * 3], sy = sph[a * 3 + 1] - sph[b * 3 + 1], sz = sph[a * 3 + 2] - sph[b * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz, s2 = sx * sx + sy * sy + sz * sz;
        if (!(d2 <= s2 * tear * tear + 1e-6) && d2 > TEAR_MIN * TEAR_MIN) torn = true;
      }
      if (torn) for (let q = 1; q < 3; q++) { pos[(v + q) * 3] = pos[v * 3]; pos[(v + q) * 3 + 1] = pos[v * 3 + 1]; pos[(v + q) * 3 + 2] = pos[v * 3 + 2]; }
    }
    m.geometry.attributes.aMorphPos.needsUpdate = true;
    m.geometry.attributes.aMorphNormal.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }

  morphLines(layer) {
    const fn = layer.morph && this.morphFn ? layer.morph : this.morphFn, t = this.morphT;
    const arr = layer.geom.attributes.instanceStart.data.array;
    const n = layer.n;
    if (!fn || t === 0) { arr.set(layer.sphere); layer.geom.attributes.instanceStart.data.needsUpdate = true; return; }
    const phased = fn.phased || fn.length >= 3 && fn.phased !== false;
    const out = [0, 0, 0];
    let target = layer.target;
    if (layer.targetFn !== fn) {
      layer.faceIds = fn.face ? new Int16Array(n * 2) : null;
      if (layer.faceIds) for (let i = 0; i < n * 2; i++) layer.faceIds[i] = fn.face(layer.lonlat[i * 2], layer.lonlat[i * 2 + 1]);
    }
    if (phased || !target || layer.targetFn !== fn) {
      if (!target) target = layer.target = new Float32Array(n * 6);
      const faces = layer.faceIds;
      const nrm = [0, 0, 0];
      for (let i = 0; i < n * 2; i++) {
        const lon = layer.lonlat[i * 2], lat = layer.lonlat[i * 2 + 1];
        fn(lon, lat, phased ? t : 1, out, faces ? faces[i] : -1);
        if (this.surfaceNormal(lon, lat, phased ? t : 1, nrm, faces ? faces[i] : -1)) { out[0] += nrm[0] * MORPH_LIFT; out[1] += nrm[1] * MORPH_LIFT; out[2] += nrm[2] * MORPH_LIFT; }
        target[i * 3] = out[0]; target[i * 3 + 1] = out[1]; target[i * 3 + 2] = out[2];
      }
      layer.targetFn = fn;
    }
    const mix = phased ? 1 : t;
    const sph = layer.sphere;
    const faceCut = layer.faceIds && t > 0.5;
    for (let i = 0; i < n; i++) {
      const a = i * 6;
      let ok = true;
      for (let q = 0; q < 6; q++) if (!isFinite(target[a + q])) { ok = false; break; }
      if (ok && faceCut && layer.faceIds[i * 2] !== layer.faceIds[i * 2 + 1]) ok = false;
      if (ok) {
        const dx = target[a] - target[a + 3], dy = target[a + 1] - target[a + 4], dz = target[a + 2] - target[a + 5];
        const sx = sph[a] - sph[a + 3], sy = sph[a + 1] - sph[a + 4], sz = sph[a + 2] - sph[a + 5];
        const d2 = dx * dx + dy * dy + dz * dz;
        const tear = fn.tear ?? TEAR;
        if (isFinite(tear) && d2 > (sx * sx + sy * sy + sz * sz) * tear * tear + 1e-8 && d2 > TEAR_MIN * TEAR_MIN) ok = false;
      }
      if (!ok) { arr[a] = 0; arr[a + 1] = 0; arr[a + 2] = -40; arr[a + 3] = 1e-4; arr[a + 4] = 0; arr[a + 5] = -40; continue; }
      for (let q = 0; q < 6; q++) arr[a + q] = sph[a + q] + (target[a + q] - sph[a + q]) * mix;
    }
    layer.geom.attributes.instanceStart.data.needsUpdate = true;
  }
  surfaceNormal(lon, lat, t, out, face = -1) {
    const fn = this.morphFn, m = this.mesh;
    if (fn && fn.normal) { fn.normal(lon, lat, t, out, face); return true; }
    if (m.kind !== "grid") return false;
    if (m.rot) { const r = m.rot([lon, lat]); lon = r[0]; lat = r[1]; }
    const cols = m.cols - 1, rows = m.rows - 1, seam = m.rot ? 180 : m.seam ?? 180;
    let u = (lon - (seam - 360)) / 360;
    u -= Math.floor(u);
    const i = Math.min(cols, Math.round(u * cols)), j = clamp(Math.round((90 - lat) / 180 * rows), 0, rows);
    const k = (j * m.cols + i) * 3;
    out[0] = m.nodeNormal[k]; out[1] = m.nodeNormal[k + 1]; out[2] = m.nodeNormal[k + 2];
    return true;
  }

  surfacePoints() {
    const m = this.pickMesh, fn = this.morphFn, t = this.morphT;
    if (!fn || t === 0) return m.nodePos;
    if (fn.phased || fn.length >= 3 && fn.phased !== false) return m.nodeTarget;
    const n = m.nodePos.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = isFinite(m.nodeTarget[i]) ? m.nodePos[i] + (m.nodeTarget[i] - m.nodePos[i]) * t : m.nodePos[i];
    return out;
  }

  fit(points = null, { padding = 24, insetTop = 0, insetBottom = 0, insetLeft = 0, insetRight = 0, minDist = DIST_MIN, apply = true, duration = 0 } = {}) {
    let flat = points;
    if (!flat) flat = this.surfacePoints();
    else if (Array.isArray(flat) && Array.isArray(flat[0])) { const f = new Float32Array(flat.length * 3); flat.forEach((p, i) => { f[i * 3] = p[0]; f[i * 3 + 1] = p[1]; f[i * 3 + 2] = p[2]; }); flat = f; }
    const q = this.group.quaternion;
    const W = Math.max(1, this.width - insetLeft - insetRight - 2 * padding), H = Math.max(1, this.height - insetTop - insetBottom - 2 * padding);
    const tanV = Math.tan((FOV / 2) * DEG);
    const kx = tanV * W / this.height, ky = tanV * H / this.height, ko = tanV * (insetBottom - insetTop) / this.height, kxo = tanV * (insetRight - insetLeft) / this.height;
    const n = flat.length / 3;
    const wx = new Float32Array(n), wy = new Float32Array(n), wz = new Float32Array(n);
    let count = 0, zmax = -Infinity, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = flat[i * 3], y = flat[i * 3 + 1], z = flat[i * 3 + 2];
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      tmpV.set(x, y, z).applyQuaternion(q);
      wx[count] = tmpV.x; wy[count] = tmpV.y; wz[count] = tmpV.z; count++;
      if (tmpV.z > zmax) zmax = tmpV.z;
      if (tmpV.x < xmin) xmin = tmpV.x; if (tmpV.x > xmax) xmax = tmpV.x;
      if (tmpV.y < ymin) ymin = tmpV.y; if (tmpV.y > ymax) ymax = tmpV.y;
    }
    if (!count) return { dist: this.dist, pan: this.pan.slice() };
    const solve = (dist) => {
      let xlo = -Infinity, xhi = Infinity, ylo = -Infinity, yhi = Infinity;
      for (let i = 0; i < count; i++) {
        const D = dist - wz[i];
        if (D <= 0.05) return null;
        const oy = D * ko;
        const ox = D * kxo;
        if (wx[i] + ox - D * kx > xlo) xlo = wx[i] + ox - D * kx;
        if (wx[i] + ox + D * kx < xhi) xhi = wx[i] + ox + D * kx;
        if (wy[i] - oy - D * ky > ylo) ylo = wy[i] - oy - D * ky;
        if (wy[i] - oy + D * ky < yhi) yhi = wy[i] - oy + D * ky;
      }
      if (xlo > xhi || ylo > yhi) return null;
      return [(xlo + xhi) / 2, (ylo + yhi) / 2];
    };
    let lo = zmax + 0.05, hi = Math.max(lo + 1, 60);
    for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (solve(mid)) hi = mid; else lo = mid; }
    const dist = clamp(hi, minDist, DIST_MAX);
    let pan = solve(dist);
    if (!pan) pan = [(xmin + xmax) / 2 + (dist - zmax) * kxo, (ymin + ymax) / 2 - (dist - zmax) * ko];
    const res = { dist, pan };
    if (apply) this.glideTo(res, duration);
    return res;
  }

  glideTo({ dist = this.dist, pan = this.pan } = {}, duration = 0) {
    const dTo = clamp(dist, DIST_MIN, DIST_MAX), pTo = [pan[0], pan[1]];
    this.animations.clear();
    if (reducedMotion || duration <= 1) { this.setPan(pTo[0], pTo[1]); this.setDist(dTo); return Promise.resolve(); }
    const d0 = this.dist, p0 = this.pan.slice(), t0 = performance.now();
    return new Promise((resolve) => {
      const anim = (now) => {
        const u = easeEmph(clamp((now - t0) / duration, 0, 1));
        this.setPan(lerp(p0[0], pTo[0], u), lerp(p0[1], pTo[1], u));
        this.setDist(lerp(d0, dTo, u));
        if (u >= 1) { this.animations.delete(anim); resolve(); }
      };
      this.animations.add(anim);
      this.invalidate();
    });
  }

  setPan(x, y) {
    this.pan = [x, y];
    this.camera.position.set(x, y, this.dist);
    this.invalidate();
  }

  restoreLines(layer) {
    const arr = layer.geom.attributes.instanceStart.data.array;
    arr.set(layer.sphere);
    layer.geom.attributes.instanceStart.data.needsUpdate = true;
  }
  morphPoints(pts) {
    const fn = this.morphFn, t = this.morphT, ll = pts.userData.lonlat, sph = pts.userData.sphere;
    const arr = pts.geometry.attributes.position.array, out = [0, 0, 0];
    const phased = fn.phased || fn.length >= 3 && fn.phased !== false;
    const mix = phased ? 1 : t;
    for (let i = 0; i < ll.length / 2; i++) {
      fn(ll[i * 2], ll[i * 2 + 1], phased ? t : 1, out);
      for (let q = 0; q < 3; q++) arr[i * 3 + q] = isFinite(out[q]) ? sph[i * 3 + q] + (out[q] - sph[i * 3 + q]) * mix : sph[i * 3 + q];
    }
    pts.geometry.attributes.position.needsUpdate = true;
  }
  restorePoints(pts) { pts.geometry.attributes.position.array.set(pts.userData.sphere); pts.geometry.attributes.position.needsUpdate = true; }

  surfacePoint(lon, lat, out = [0, 0, 0]) {
    const fn = this.morphFn, t = this.morphT;
    if (!fn || t === 0) return lonLatToXYZ(lon, lat, out);
    const phased = fn.phased || fn.length >= 3 && fn.phased !== false;
    if (phased) return fn(lon, lat, t, out);
    const s = lonLatToXYZ(lon, lat);
    fn(lon, lat, 1, out);
    for (let q = 0; q < 3; q++) out[q] = isFinite(out[q]) ? s[q] + (out[q] - s[q]) * t : s[q];
    return out;
  }

  project(lon, lat) {
    const p = this.surfacePoint(lon, lat);
    if (!isFinite(p[0])) return { x: NaN, y: NaN, visible: false };
    this.syncMatrices();
    tmpV.set(p[0], p[1], p[2]).applyQuaternion(this.group.quaternion);
    const wx = tmpV.x, wy = tmpV.y, wz = tmpV.z;
    let visible;
    if (!this.morphFn || this.morphT === 0) {
      visible = wx * (this.pan[0] - wx) + wy * (this.pan[1] - wy) + wz * (this.dist - wz) > 0;
    } else {
      const toCam = this.camera.position.clone().sub(tmpV);
      const d = toCam.length();
      this.raycaster.set(this.camera.position, toCam.normalize().negate());
      const hits = this.raycaster.intersectObject(this.pickObj, false);
      visible = !hits.length || hits[0].distance > d - 0.02;
    }
    tmpV.project(this.camera);
    const x = (tmpV.x + 1) / 2 * this.width, y = (1 - tmpV.y) / 2 * this.height;
    if (tmpV.z > 1) visible = false;
    return { x, y, visible };
  }

  pick(x, y) {
    this.syncMatrices();
    const nx = (x / this.width) * 2 - 1, ny = -(y / this.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    if (!this.morphFn || this.morphT === 0) {
      const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
      const b = o.dot(d), c = o.dot(o) - 1, disc = b * b - c;
      if (disc < 0) return null;
      const s = -b - Math.sqrt(disc);
      const hit = o.clone().addScaledVector(d, s);
      const p = hit.clone().applyQuaternion(this.group.quaternion.clone().invert());
      const ll = xyzToLonLat(p.x, p.y, p.z);
      return { lon: ll[0], lat: ll[1], point: hit };
    }
    const hits = this.raycaster.intersectObject(this.pickObj, false);
    if (!hits.length) return null;
    const h = hits[0];
    if (!h.uv) return null;
    const m = this.pickMesh;
    const tri = h.face;
    const a = m.vertNode[tri.a], b = m.vertNode[tri.b], c = m.vertNode[tri.c];
    const bary = barycentric(h.point, this.rayGeom, tri, this.group);
    const lonA = m.nodeLon[a], lonB = lonA + wrapRel(m.nodeLon[b] - lonA), lonC = lonA + wrapRel(m.nodeLon[c] - lonA);
    const lon = wrapRel(lonA * bary[0] + lonB * bary[1] + lonC * bary[2]);
    const lat = m.nodeLat[a] * bary[0] + m.nodeLat[b] * bary[1] + m.nodeLat[c] * bary[2];
    return { lon, lat, point: h.point };
  }

  bindEvents() {
    const c = this.canvas;
    c.addEventListener("webglcontextrestored", () => this.refreshOverlay());
    this.overlayCanvas.addEventListener("contextrestored", () => this.refreshOverlay());
    let drag = null;
    this.vel = [0, 0];
    const self = this;
    this.cameraControls = {
      lookAt: (lon, lat, dist, { duration = 650 } = {}) => self.lookAt(lon, lat, dist, duration),
      orient: (dir, up, { duration = 650 } = {}) => self.orient(dir, up, duration),
      state: () => self.state(),
      setState: (s) => self.setState(s),
      lock: (axis) => { self.lockAxis = axis || null; },
      get dist() { return self.dist; },
      get pan() { return self.pan.slice(); },
      setDist: (d) => { self.setDist(d); },
      setPan: (x, y) => { self.setPan(x, y); },
      fit: (points, opts) => self.fit(points, opts),
      glideTo: (target, { duration = 650 } = {}) => self.glideTo(target, duration)
    };
    Object.assign(this.camera, this.cameraControls);
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, moved: 0, last: performance.now(), q0: this.group.quaternion.clone() };
      this.vel = [0, 0];
      c.style.cursor = "grabbing";
      this.labelLayer.el.style.opacity = "0.7";
    });
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        this.rotateBy(dx, dy);
        this.vel = [dx, dy];
        this.emit("drag", this.state());
        return;
      }
      const p = this.pick(x, y);
      this.emit("hover", p ? { lon: p.lon, lat: p.lat, x, y } : null);
    });
    const end = (e) => {
      if (!drag) return;
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const moved = drag.moved;
      drag = null;
      c.style.cursor = "grab";
      this.labelLayer.el.style.opacity = "1";
      if (moved < 4) {
        const p = this.pick(x, y);
        if (p) this.emit("click", { lon: p.lon, lat: p.lat, x, y });
      } else if (!reducedMotion) {
        this.inertia = this.vel.slice();
        this.invalidate();
      }
      this.emit("dragend", this.state());
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("pointerleave", () => { if (!drag) this.emit("hover", null); });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = Math.exp(clamp(e.deltaY, -60, 60) * 0.0025);
      this.setDist(this.dist * f);
      this.emit("wheel", this.state());
    }, { passive: false });
    c.addEventListener("dblclick", (e) => {
      const r = c.getBoundingClientRect();
      const p = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (p) this.lookAt(p.lon, p.lat, this.dist, 650);
    });
  }

  rotateBy(dx, dy) {
    const f = (this.height / 2) / Math.tan((FOV / 2) * DEG);
    const k = (this.dist - 1) / f;
    const ax = dy * k, ay = dx * k;
    const q = this.group.quaternion;
    if (this.lockAxis === "yaw") {
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ay);
      q.multiply(tmpQ);
    } else if (this.lockAxis === "pitch") {
      tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), ax);
      q.premultiply(tmpQ);
    } else {
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ay);
      q.premultiply(tmpQ);
      tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), ax);
      q.premultiply(tmpQ);
    }
    q.normalize();
    this.invalidate();
  }

  setDist(d) {
    this.dist = clamp(d, DIST_MIN, DIST_MAX);
    this.camera.position.set(this.pan[0], this.pan[1], this.dist);
    const zoom = DIST_DEFAULT / this.dist;
    const step = zoom > 6 ? 1 : zoom > 2 ? 5 : 10;
    if (step !== this.minorStep && this.lineLayers.has("grat-minor")) this.buildGraticule();
    if (this.lineLayers.has("rivers")) this.applyLayerVisibility();
    this.invalidate();
  }

  state() {
    const inv = this.group.quaternion.clone().invert();
    const p = new THREE.Vector3(0, 0, 1).applyQuaternion(inv);
    const ll = xyzToLonLat(p.x, p.y, p.z);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(inv);
    const north = new THREE.Vector3(0, 1, 0);
    const east = new THREE.Vector3(0, 1, 0).cross(p).normalize();
    const n2 = p.clone().cross(east).normalize();
    const roll = Math.atan2(up.dot(east), up.dot(n2)) * RAD;
    const q = this.group.quaternion;
    return { lon: +ll[0].toFixed(4), lat: +ll[1].toFixed(4), dist: +this.dist.toFixed(4), roll: +roll.toFixed(3), pan: [+this.pan[0].toFixed(4), +this.pan[1].toFixed(4)], q: [q.x, q.y, q.z, q.w] };
  }

  setState(s) {
    if (!s) return;
    this.animations.clear();
    if (s.q) this.group.quaternion.set(s.q[0], s.q[1], s.q[2], s.q[3]);
    else if (s.lon !== undefined) this.group.quaternion.copy(quatFor(s.lon, s.lat, s.roll || 0));
    if (s.pan) this.setPan(s.pan[0], s.pan[1]);
    if (s.dist) this.setDist(s.dist);
    this.invalidate();
  }

  orient(dir, up, duration = 650) {
    const P = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    const north = new THREE.Vector3(up[0], up[1], up[2]).addScaledVector(P, -(up[0] * P.x + up[1] * P.y + up[2] * P.z));
    if (north.lengthSq() < 1e-12) return Promise.resolve();
    north.normalize();
    const east = north.clone().cross(P);
    const qTo = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, P)).invert();
    this.animations.clear();
    this.inertia = null;
    if (reducedMotion || duration <= 1) { this.group.quaternion.copy(qTo); this.invalidate(); return Promise.resolve(); }
    const q0 = this.group.quaternion.clone(), t0 = performance.now();
    return new Promise((resolve) => {
      const anim = (now) => {
        const u = easeEmph(clamp((now - t0) / duration, 0, 1));
        this.group.quaternion.copy(q0).slerp(qTo, u);
        if (u >= 1) { this.animations.delete(anim); resolve(); }
      };
      this.animations.add(anim);
      this.invalidate();
    });
  }

  lookAt(lon, lat, dist = this.dist, duration = 650) {
    const qTo = quatFor(lon, lat, 0);
    const moveDist = dist !== null && dist !== undefined;
    const dTo = moveDist ? clamp(dist, DIST_MIN, DIST_MAX) : this.dist;
    const pTo = moveDist ? [0, 0] : this.pan.slice();
    this.animations.clear();
    this.inertia = null;
    if (reducedMotion || duration <= 1) { this.group.quaternion.copy(qTo); this.setPan(pTo[0], pTo[1]); this.setDist(dTo); return Promise.resolve(); }
    const q0 = this.group.quaternion.clone(), d0 = this.dist, p0 = this.pan.slice(), t0 = performance.now();
    return new Promise((resolve) => {
      const anim = (now) => {
        const u = easeEmph(clamp((now - t0) / duration, 0, 1));
        this.group.quaternion.copy(q0).slerp(qTo, u);
        if (moveDist) { this.setPan(lerp(p0[0], pTo[0], u), lerp(p0[1], pTo[1], u)); this.setDist(lerp(d0, dTo, u)); }
        if (u >= 1) { this.animations.delete(anim); resolve(); }
      };
      this.animations.add(anim);
      this.invalidate();
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, payload) { const s = this.listeners.get(event); if (s) for (const fn of s) fn(payload); }

  resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const l of this.lineLayers.values()) l.mat.resolution.set(w * dpr, h * dpr);
    for (const e of this.extra.values()) if (e.userData.segments3d) e.material.resolution.set(w * dpr, h * dpr);
    this.invalidate();
  }

  invalidate() {
    this.needsRender = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    this.raf = null;
    if (this.disposed) return;
    let animating = false;
    for (const a of this.animations) { a(now); animating = true; }
    if (this.inertia) {
      const [vx, vy] = this.inertia;
      this.rotateBy(vx, vy);
      this.inertia = [vx * 0.92, vy * 0.92];
      const f = (this.height / 2) / Math.tan((FOV / 2) * DEG);
      const k = (this.dist - 1) / f;
      if (Math.hypot(vx, vy) * k < 0.05 * DEG) this.inertia = null; else animating = true;
    }
    this.render();
    if ((animating || this.needsRender) && !this.raf) this.raf = requestAnimationFrame((n) => this.frame(n));
  }

  render() {
    if (this.disposed) return;
    const t0 = performance.now();
    this.needsRender = false;
    if (this.overlayDirty) this.redrawOverlay();
    if (this.opts.light === "sun") {
      const p = lonLatToXYZ(this.sunLonLat[0], this.sunLonLat[1]);
      this.uniforms.uSunDir.value.set(p[0], p[1], p[2]).applyQuaternion(this.group.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
    if (this.layers.labels && this.labelItems) this.labelLayer.update((lon, lat) => this.project(lon, lat), this.width, this.height);
    this.placeLabels3D();
    const dt = performance.now() - t0;
    this.frameTimes.push(dt); if (this.frameTimes.length > 120) this.frameTimes.shift();
    this.lastFrameMs = dt;
  }

  frameStats() {
    const a = this.frameTimes;
    if (!a.length) return { n: 0 };
    const s = a.slice().sort((x, y) => x - y);
    return { n: a.length, mean: a.reduce((x, y) => x + y, 0) / a.length, p50: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const id of [...this.lineLayers.keys()]) this.remove(id);
    for (const id of [...this.extra.keys()]) this.remove(id);
    for (const id of [...this.labels3d.keys()]) this.remove(id);
    this.label3dEl.remove();
    this.labelLayer.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose(); this.pickMesh.geometry.dispose();
    if (this.textures) for (const t of Object.values(this.textures)) t.dispose();
    this.overlayTex.dispose();
    this.overlayCanvas.width = this.overlayCanvas.height = 0;
    this.renderer.dispose();
    this.canvas.width = this.canvas.height = 1;
    if (!this.renderer.getContext().isContextLost()) this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

function flattenSegments(segments) {
  if (segments instanceof Float32Array) return segments;
  const out = new Float32Array(segments.length * 6);
  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    out[i * 6] = a[0]; out[i * 6 + 1] = a[1]; out[i * 6 + 2] = a[2]; out[i * 6 + 3] = b[0]; out[i * 6 + 4] = b[1]; out[i * 6 + 5] = b[2];
  }
  return out;
}
function flattenPoints(points) {
  if (points instanceof Float32Array) return points;
  const out = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) { out[i * 3] = points[i][0]; out[i * 3 + 1] = points[i][1]; out[i * 3 + 2] = points[i][2]; }
  return out;
}

let spriteTex = null;
function pointSprite() {
  if (spriteTex) return spriteTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  spriteTex = new THREE.CanvasTexture(c);
  return spriteTex;
}

function quatFor(lon, lat, roll = 0) {
  const p = lonLatToXYZ(lon, lat);
  const P = new THREE.Vector3(p[0], p[1], p[2]);
  const east = new THREE.Vector3(0, 1, 0).cross(P);
  if (east.lengthSq() < 1e-9) east.set(1, 0, 0);
  east.normalize();
  const north = P.clone().cross(east).normalize();
  const m = new THREE.Matrix4().makeBasis(east, north, P);
  const q = new THREE.Quaternion().setFromRotationMatrix(m).invert();
  if (roll) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll * DEG));
  return q;
}

function rayGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.geometry.attributes.position.array.slice(), 3));
  g.setAttribute("uv", m.geometry.attributes.uv);
  g.computeBoundingSphere();
  return g;
}

function barycentric(pointWorld, geom, tri, group) {
  const p = pointWorld.clone().applyQuaternion(group.quaternion.clone().invert());
  const arr = geom.attributes.position.array;
  const A = new THREE.Vector3().fromArray(arr, tri.a * 3), B = new THREE.Vector3().fromArray(arr, tri.b * 3), C = new THREE.Vector3().fromArray(arr, tri.c * 3);
  const v0 = B.clone().sub(A), v1 = C.clone().sub(A), v2 = p.clone().sub(A);
  const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1), d20 = v2.dot(v0), d21 = v2.dot(v1);
  const den = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

function parseColor(c) {
  if (typeof c !== "string") return { hex: c, a: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const parts = m[1].split(",").map((s) => parseFloat(s));
    return { hex: (parts[0] << 16) | (parts[1] << 8) | parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  return { hex: new THREE.Color(c).getHex(), a: 1 };
}

export function canvasPath(projection, ctx2d) {
  return d3.geoPath(projection, ctx2d);
}

export function graticuleLines(step = 15) {
  return d3.geoGraticule().step([step, step]).extentMinor([[-180, -90 + 1e-6], [180, 90 - 1e-6]])();
}

export function meshToSegments(multiLine) {
  const segs = [];
  const lines = multiLine.type === "MultiLineString" ? multiLine.coordinates : multiLine.type === "LineString" ? [multiLine.coordinates] : [];
  for (const l of lines) for (let i = 1; i < l.length; i++) segs.push([l[i - 1], l[i]]);
  return segs;
}

export function lineToSegments(coords) {
  const segs = [];
  for (let i = 1; i < coords.length; i++) segs.push([coords[i - 1], coords[i]]);
  return segs;
}

export function convexHullFaces(points) {
  const vs = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const index = new Map(vs.map((v, i) => [v, i]));
  const hull = new ConvexHull().setFromPoints(vs);
  const faces = [];
  for (const f of hull.faces) {
    const loop = [];
    let e = f.edge;
    do { loop.push(index.get(e.head().point)); e = e.next; } while (e !== f.edge);
    for (let k = 1; k < loop.length - 1; k++) faces.push([loop[0], loop[k], loop[k + 1]]);
  }
  return faces;
}

export function sphereVoronoi(lonlats) {
  const v = d3.geoVoronoi(lonlats);
  const del = d3.geoDelaunay(lonlats);
  return { polygons: v.polygons(), triangles: del.triangles, centers: del.centers, edges: del.edges, neighbors: del.neighbors };
}
