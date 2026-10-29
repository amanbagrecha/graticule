export function cubicWeight(x, a = -0.5) {
  const t = Math.abs(x);
  if (t <= 1) return (a + 2) * t * t * t - (a + 3) * t * t + 1;
  if (t < 2) return a * t * t * t - 5 * a * t * t + 8 * a * t - 4 * a;
  return 0;
}

export function weights(method, t, a = -0.5) {
  if (method === "nearest") return t < 0.5 ? [1, 0] : [0, 1];
  if (method === "bilinear") return [1 - t, t];
  return [cubicWeight(1 + t, a), cubicWeight(t, a), cubicWeight(1 - t, a), cubicWeight(2 - t, a)];
}

export function interp1(values, x, method = "bilinear", a = -0.5) {
  const n = values.length;
  const at = (i) => values[Math.max(0, Math.min(n - 1, i))];
  if (method === "nearest") return at(Math.floor(x + 0.5));
  const i = Math.floor(x), t = x - i;
  if (method === "bilinear") return at(i) * (1 - t) + at(i + 1) * t;
  const w = weights("cubic", t, a);
  return at(i - 1) * w[0] + at(i) * w[1] + at(i + 1) * w[2] + at(i + 2) * w[3];
}

export function sample(src, x, y, method = "bilinear", a = -0.5) {
  const { width: W, height: H, data } = src;
  const px = (i, j) => data[Math.max(0, Math.min(H - 1, j)) * W + Math.max(0, Math.min(W - 1, i))];
  if (method === "nearest") return px(Math.floor(x + 0.5), Math.floor(y + 0.5));
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  if (method === "bilinear") {
    return (px(i, j) * (1 - tx) + px(i + 1, j) * tx) * (1 - ty) + (px(i, j + 1) * (1 - tx) + px(i + 1, j + 1) * tx) * ty;
  }
  const wx = weights("cubic", tx, a), wy = weights("cubic", ty, a);
  let v = 0;
  for (let m = 0; m < 4; m++) {
    let row = 0;
    for (let k = 0; k < 4; k++) row += px(i - 1 + k, j - 1 + m) * wx[k];
    v += row * wy[m];
  }
  return v;
}

export function resample(src, w, h, method = "bilinear") {
  const { width: W, height: H, data } = src;
  const out = new Float64Array(w * h);
  const sx = W / w, sy = H / h;
  if (method === "average") {
    for (let oy = 0; oy < h; oy++) {
      const y0 = oy * sy, y1 = (oy + 1) * sy;
      for (let ox = 0; ox < w; ox++) {
        const x0 = ox * sx, x1 = (ox + 1) * sx;
        let sum = 0, wsum = 0;
        for (let j = Math.floor(y0); j < Math.min(H, Math.ceil(y1)); j++) {
          const wy = Math.min(y1, j + 1) - Math.max(y0, j);
          for (let i = Math.floor(x0); i < Math.min(W, Math.ceil(x1)); i++) {
            const wgt = wy * (Math.min(x1, i + 1) - Math.max(x0, i));
            const v = data[j * W + i];
            if (wgt > 0 && v === v) { sum += v * wgt; wsum += wgt; }
          }
        }
        out[oy * w + ox] = wsum ? sum / wsum : NaN;
      }
    }
    return { width: w, height: h, data: out };
  }
  for (let oy = 0; oy < h; oy++) {
    const y = (oy + 0.5) * sy - 0.5;
    for (let ox = 0; ox < w; ox++) {
      const x = (ox + 0.5) * sx - 0.5;
      out[oy * w + ox] = method === "nearest" ? data[Math.min(H - 1, Math.floor((oy + 0.5) * sy)) * W + Math.min(W - 1, Math.floor((ox + 0.5) * sx))] : sample(src, x, y, method);
    }
  }
  return { width: w, height: h, data: out };
}

function ringsOf(poly) {
  if (!poly) return [];
  if (poly.type === "Polygon") return [poly.coordinates];
  if (poly.type === "MultiPolygon") return poly.coordinates;
  if (Array.isArray(poly[0]) && typeof poly[0][0] === "number") return [[poly]];
  if (Array.isArray(poly[0][0]) && typeof poly[0][0][0] === "number") return [poly];
  return poly;
}

function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function signedArea(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function clipRingToRect(ring, xmin, ymin, xmax, ymax) {
  let pts = ring;
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
  const planes = [
    [(p) => p[0] >= xmin, (a, b) => [xmin, a[1] + ((xmin - a[0]) * (b[1] - a[1])) / (b[0] - a[0])]],
    [(p) => p[0] <= xmax, (a, b) => [xmax, a[1] + ((xmax - a[0]) * (b[1] - a[1])) / (b[0] - a[0])]],
    [(p) => p[1] >= ymin, (a, b) => [a[0] + ((ymin - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), ymin]],
    [(p) => p[1] <= ymax, (a, b) => [a[0] + ((ymax - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), ymax]],
  ];
  for (const [inside, cut] of planes) {
    if (!pts.length) break;
    const inp = pts;
    pts = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      const ia = inside(a), ib = inside(b);
      if (ib) {
        if (!ia) pts.push(cut(a, b));
        pts.push(b);
      } else if (ia) pts.push(cut(a, b));
    }
  }
  return pts;
}

function cellRange(grid, polys) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const rings of polys) for (const [x, y] of rings[0]) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const { x0, y0, dx, dy, width, height } = grid;
  const c = [(xmin - x0) / dx, (xmax - x0) / dx].sort((a, b) => a - b);
  const r = [(ymin - y0) / dy, (ymax - y0) / dy].sort((a, b) => a - b);
  return {
    c0: Math.max(0, Math.floor(c[0])), c1: Math.min(width - 1, Math.ceil(c[1])),
    r0: Math.max(0, Math.floor(r[0])), r1: Math.min(height - 1, Math.ceil(r[1])),
  };
}

export function rasterizeCentre(poly, grid) {
  const polys = ringsOf(poly);
  const { x0, y0, dx, dy, width, height } = grid;
  const out = new Float32Array(width * height);
  if (!polys.length) return out;
  const { c0, c1, r0, r1 } = cellRange(grid, polys);
  for (let r = r0; r <= r1; r++) {
    const y = y0 + (r + 0.5) * dy;
    for (let c = c0; c <= c1; c++) {
      const x = x0 + (c + 0.5) * dx;
      for (const rings of polys) if (pointInRings(x, y, rings)) { out[r * width + c] = 1; break; }
    }
  }
  return out;
}

export function rasterizeExact(poly, grid, { ArrayType = Float32Array } = {}) {
  const polys = ringsOf(poly);
  const { x0, y0, dx, dy, width, height } = grid;
  const out = new ArrayType(width * height);
  if (!polys.length) return out;
  const { c0, c1, r0, r1 } = cellRange(grid, polys);
  const cellA = Math.abs(dx * dy);
  for (let r = r0; r <= r1; r++) {
    const ya = y0 + r * dy, yb = ya + dy;
    for (let c = c0; c <= c1; c++) {
      const xa = x0 + c * dx, xb = xa + dx;
      const bx0 = Math.min(xa, xb), bx1 = Math.max(xa, xb), by0 = Math.min(ya, yb), by1 = Math.max(ya, yb);
      let a = 0;
      for (const rings of polys) {
        rings.forEach((ring, k) => {
          const part = Math.abs(signedArea(clipRingToRect(ring, bx0, by0, bx1, by1)));
          a += k === 0 ? part : -part;
        });
      }
      out[r * width + c] = Math.max(0, Math.min(1, a / cellA));
    }
  }
  return out;
}

export function polygonArea(poly) {
  let a = 0;
  for (const rings of ringsOf(poly)) rings.forEach((ring, k) => { a += (k === 0 ? 1 : -1) * Math.abs(signedArea(ring)); });
  return a;
}

export function affine(gt) {
  const [x0, dx, rx, y0, ry, dy] = gt;
  return (col, row) => [x0 + col * dx + row * rx, y0 + col * ry + row * dy];
}

export function invertGeoTransform(gt) {
  const [x0, dx, rx, y0, ry, dy] = gt;
  const det = dx * dy - rx * ry;
  if (!det) return null;
  const idx = dy / det, irx = -rx / det, iry = -ry / det, idy = dx / det;
  return [-x0 * idx - y0 * irx, idx, irx, -x0 * iry - y0 * idy, iry, idy];
}

export function affineInverse(gt) {
  const inv = invertGeoTransform(gt);
  if (!inv) return null;
  return affine(inv);
}

export function pixelCentre(gt, col, row) {
  return affine(gt)(col + 0.5, row + 0.5);
}

function summary(arr, skip) {
  let sum = 0, valid = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (skip && skip(arr[i], i)) continue;
    const v = arr[i];
    sum += v;
    valid++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { sum, valid, mean: valid ? sum / valid : NaN, min, max };
}

export function stats(arr, { nodata, mask, honour = true } = {}) {
  const hasNodata = nodata !== undefined && nodata !== null;
  const isMasked = (v, i) => v !== v || (hasNodata && v === nodata) || !!(mask && mask[i]);
  const h = summary(arr, isMasked);
  const all = summary(arr, null);
  const use = honour ? h : all;
  return { count: arr.length, valid: h.valid, masked: arr.length - h.valid, mean: use.mean, sum: use.sum, min: use.min, max: use.max, meanHonoured: h.mean, meanIgnored: all.mean };
}

export function normalizedDifference(a, b) {
  const s = a + b;
  return s ? (a - b) / s : NaN;
}

export function overviews(size, tile = 512) {
  const out = [];
  let s = size;
  while (s > tile) {
    s = Math.ceil(s / 2);
    out.push(s);
  }
  return out;
}

export function tileGrid(size, tile = 512) {
  const n = Math.ceil(size / tile);
  return { cols: n, rows: n, count: n * n };
}

export function chunkOf(index, spec) {
  if (typeof spec === "number") {
    const chunk = Math.floor(index / spec);
    return { chunk, offset: index - chunk * spec, start: chunk * spec, length: spec };
  }
  let start = 0;
  for (let k = 0; k < spec.length; k++) {
    if (index < start + spec[k]) return { chunk: k, offset: index - start, start, length: spec[k] };
    start += spec[k];
  }
  return null;
}

export function runningSums(lengths) {
  const out = [];
  let s = 0;
  for (const l of lengths) out.push((s += l));
  return out;
}

export function chunkCount(extent, spec) {
  return typeof spec === "number" ? Math.ceil(extent / spec) : spec.length;
}
