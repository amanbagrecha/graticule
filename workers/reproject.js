let mips = null;
let hill = null, hw = 0, hh = 0;

function downsample(src, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Uint8ClampedArray(w2 * h2 * 4);
  for (let y = 0; y < h2; y++) {
    const r0 = (2 * y) * w * 4, r1 = r0 + w * 4;
    for (let x = 0; x < w2; x++) {
      const i0 = r0 + x * 8, i1 = r1 + x * 8, o = (y * w2 + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = (src[i0 + c] + src[i0 + 4 + c] + src[i1 + c] + src[i1 + 4 + c] + 2) >> 2;
      out[o + 3] = 255;
    }
  }
  return out;
}

function init(m) {
  const { color, width, height } = m;
  mips = [{ data: color, w: width, h: height }];
  let cur = color, w = width, h = height;
  while (w > 256) {
    cur = downsample(cur, w, h); w >>= 1; h >>= 1;
    mips.push({ data: cur, w, h });
  }
  hill = m.hillshade; hw = m.hw; hh = m.hh;
}

function job(m) {
  const { id, w, y0, y1, step, gw, grid, exactIdx, exactLL, mip, shade } = m;
  const level = mips[Math.min(mip, mips.length - 1)];
  const src = level.data, sw = level.w, sh = level.h;
  const rows = y1 - y0;
  const out = new Uint8ClampedArray(w * rows * 4);
  const exactMap = new Map();
  for (let i = 0; i < exactIdx.length; i++) exactMap.set(exactIdx[i], i);
  const cellPx = step * step;
  const kx = sw / 360, ky = sh / 180;
  const hx = hw / 360, hy = hh / 180;
  const inv = 1 / step;
  const gh = Math.ceil(m.h / step) + 1;
  const mode = new Uint8Array((gw - 1) * (gh - 1));
  const vec = new Float32Array((gw - 1) * (gh - 1) * 12);
  const D = Math.PI / 180;
  for (let cy = 0; cy < gh - 1; cy++) for (let cx = 0; cx < gw - 1; cx++) {
    const cell = cy * (gw - 1) + cx;
    const idx = [(cy * gw + cx) * 2, (cy * gw + cx + 1) * 2, ((cy + 1) * gw + cx) * 2, ((cy + 1) * gw + cx + 1) * 2];
    let nan = 0, lo = Infinity, hi = -Infinity, pole = 0;
    for (const k of idx) { if (grid[k] !== grid[k]) nan++; else { if (grid[k] < lo) lo = grid[k]; if (grid[k] > hi) hi = grid[k]; if (Math.abs(grid[k + 1]) > pole) pole = Math.abs(grid[k + 1]); } }
    if (nan === 4) { mode[cell] = 2; continue; }
    if (nan === 0 && hi - lo < 90 && pole <= 85) { mode[cell] = 0; continue; }
    mode[cell] = 1;
    let ax = 0, ay = 0, az = 0;
    const v = [];
    for (const k of idx) {
      if (grid[k] !== grid[k]) { v.push(null); continue; }
      const la = grid[k + 1] * D, lo2 = grid[k] * D, c = Math.cos(la);
      const p = [c * Math.sin(lo2), Math.sin(la), c * Math.cos(lo2)];
      ax += p[0]; ay += p[1]; az += p[2]; v.push(p);
    }
    const l = Math.hypot(ax, ay, az) || 1;
    for (let q = 0; q < 4; q++) {
      const p = v[q] || [ax / l, ay / l, az / l];
      vec[cell * 12 + q * 3] = p[0]; vec[cell * 12 + q * 3 + 1] = p[1]; vec[cell * 12 + q * 3 + 2] = p[2];
    }
  }
  const R = 180 / Math.PI;
  for (let y = y0; y < y1; y++) {
    const cy = Math.floor(y * inv), fy = (y + 0.5) * inv - cy;
    const ly = y - cy * step;
    for (let x = 0; x < w; x++) {
      const cx = Math.floor(x * inv);
      const cell = cy * (gw - 1) + cx;
      let lon, lat;
      const ex = exactMap.get(cell);
      if (ex !== undefined) {
        const lx = x - cx * step;
        const k = (ex * cellPx + ly * step + lx) * 2;
        lon = exactLL[k]; lat = exactLL[k + 1];
      } else if (mode[cell] !== 0) {
        if (mode[cell] === 2) { lon = NaN; } else {
          const fx = (x + 0.5) * inv - cx, b = cell * 12;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          const vx = vec[b] * w00 + vec[b + 3] * w10 + vec[b + 6] * w01 + vec[b + 9] * w11;
          const vy = vec[b + 1] * w00 + vec[b + 4] * w10 + vec[b + 7] * w01 + vec[b + 10] * w11;
          const vz = vec[b + 2] * w00 + vec[b + 5] * w10 + vec[b + 8] * w01 + vec[b + 11] * w11;
          const l = Math.hypot(vx, vy, vz) || 1;
          lon = Math.atan2(vx, vz) * R; lat = Math.asin(Math.max(-1, Math.min(1, vy / l))) * R;
        }
      } else {
        const fx = (x + 0.5) * inv - cx;
        const a = (cy * gw + cx) * 2, b = a + 2, c = a + gw * 2, d = c + 2;
        const la = grid[a], lb = grid[b], lc = grid[c], ld = grid[d];
        if (la !== la || lb !== lb || lc !== lc || ld !== ld) { lon = NaN; } else {
          lon = (la + (lb - la) * fx) * (1 - fy) + (lc + (ld - lc) * fx) * fy;
          const pa = grid[a + 1], pb = grid[b + 1], pc = grid[c + 1], pd = grid[d + 1];
          lat = (pa + (pb - pa) * fx) * (1 - fy) + (pc + (pd - pc) * fx) * fy;
        }
      }
      const o = ((y - y0) * w + x) * 4;
      if (lon !== lon) { out[o + 3] = 0; continue; }
      let sx = (lon + 180) * kx - 0.5, sy = (90 - lat) * ky - 0.5;
      if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
      sx = ((sx % sw) + sw) % sw;
      const x0 = Math.floor(sx), y0s = Math.floor(sy);
      const x1 = x0 + 1 === sw ? 0 : x0 + 1, y1s = Math.min(y0s + 1, sh - 1);
      const tx = sx - x0, ty = sy - y0s;
      const i00 = (y0s * sw + x0) * 4, i10 = (y0s * sw + x1) * 4, i01 = (y1s * sw + x0) * 4, i11 = (y1s * sw + x1) * 4;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      let r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      let g = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      let bl = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      if (shade > 0) {
        const hxi = Math.min(Math.max(Math.round((lon + 180) * hx - 0.5), 0), hw - 1), hyi = Math.min(Math.max(Math.round((90 - lat) * hy - 0.5), 0), hh - 1);
        const f = 1 + shade * (hill[hyi * hw + hxi] / 128 - 1);
        r *= f; g *= f; bl *= f;
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255;
    }
  }
  self.postMessage({ id, y0, y1, w, data: out }, [out.buffer]);
}

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "init") { init(m); self.postMessage({ type: "ready" }); }
  else if (m.type === "job") job(m);
};
