const R_EARTH = 6371000;

function rasterizeMasks(W, H, rings) {
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const fill = (polys, style) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    for (const ring of polys) {
      for (let i = 0; i < ring.length; i++) {
        if (i === 0) ctx.moveTo(ring[i][0], ring[i][1]); else ctx.lineTo(ring[i][0], ring[i][1]);
      }
      ctx.closePath();
    }
    ctx.fill("evenodd");
  };
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  fill(rings.land, "#ff0000");
  fill(rings.antarctica, "#00ff00");
  fill(rings.greenland, "#0000ff");
  const a = ctx.getImageData(0, 0, W, H).data;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, W, H);
  fill(rings.lakes, "#ff0000");
  const l = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const land = new Uint8Array(n), ant = new Uint8Array(n), grl = new Uint8Array(n), lake = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    land[i] = a[i * 4]; ant[i] = a[i * 4 + 1]; grl[i] = a[i * 4 + 2]; lake[i] = l[i * 4];
  }
  return { land, ant, grl, lake };
}

function boxBlurWrap(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Uint8Array(W * H);
  const span = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + ((k + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = s / span;
      s += src[row + ((x + r + 1) % W)] - src[row + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(Math.max(k, 0), H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / span;
      s += tmp[Math.min(y + r + 1, H - 1) * W + x] - tmp[Math.max(y - r, 0) * W + x];
    }
  }
  return out;
}

function elevationSampler(etopo, ew, eh, W, H) {
  const cx0 = new Int32Array(W), cx1 = new Int32Array(W), fx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const c = Math.min((x + 0.5) * ((ew - 1) / W), ew - 1);
    cx0[x] = Math.floor(c); cx1[x] = Math.min(cx0[x] + 1, ew - 1); fx[x] = c - cx0[x];
  }
  const ry0 = new Int32Array(H), ry1 = new Int32Array(H), fy = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const r = Math.min((y + 0.5) * ((eh - 1) / H), eh - 1);
    ry0[y] = Math.floor(r); ry1[y] = Math.min(ry0[y] + 1, eh - 1); fy[y] = r - ry0[y];
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const r0 = ry0[y] * ew, r1 = ry1[y] * ew, gy = fy[y], row = y * W;
    for (let x = 0; x < W; x++) {
      const a = etopo[r0 + cx0[x]], b = etopo[r0 + cx1[x]], c = etopo[r1 + cx0[x]], d = etopo[r1 + cx1[x]];
      const gx = fx[x];
      out[row + x] = (a + (b - a) * gx) * (1 - gy) + (c + (d - c) * gx) * gy;
    }
  }
  return out;
}

function downsample2(src, W, H) {
  const w = W >> 1, h = H >> 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (2 * y) * W + 2 * x;
    out[y * w + x] = (src[i] + src[i + 1] + src[i + W] + src[i + W + 1] + 2) >> 2;
  }
  return out;
}

function relief(elev, W, H, land, z) {
  const hs = new Uint8Array(W * H), nm = new Uint8ClampedArray(W * H * 4);
  const az = (315 * Math.PI) / 180, zen = (45 * Math.PI) / 180;
  const cosZ = Math.cos(zen), sinZ = Math.sin(zen);
  const dy = (Math.PI * R_EARTH) / H;
  for (let y = 0; y < H; y++) {
    const lat = ((0.5 - (y + 0.5) / H) * Math.PI);
    const dx = Math.max((2 * Math.PI * R_EARTH * Math.cos(lat)) / W, 1000);
    const yN = Math.max(y - 1, 0) * W, yS = Math.min(y + 1, H - 1) * W, row = y * W;
    for (let x = 0; x < W; x++) {
      const i = row + x;
      if (land[i] < 96) { hs[i] = 128; nm[i * 4] = 128; nm[i * 4 + 1] = 128; nm[i * 4 + 2] = 255; nm[i * 4 + 3] = 255; continue; }
      const xw = (x - 1 + W) % W, xe = (x + 1) % W;
      const e = Math.max(elev[i], 0);
      const eW = Math.max(elev[row + xw], 0), eE = Math.max(elev[row + xe], 0);
      const eN = Math.max(elev[yN + x], 0), eS = Math.max(elev[yS + x], 0);
      const dzdx = ((eE - eW) / (2 * dx)) * z, dzdy = ((eN - eS) / (2 * dy)) * z;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let shade = cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(az - aspect);
      shade = (shade - cosZ) / cosZ;
      const soft = land[i] / 255;
      hs[i] = Math.max(0, Math.min(255, Math.round(128 + shade * 127 * soft)));
      const nx = -dzdx, ny = -dzdy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nm[i * 4] = Math.round((nx * inv * soft * 0.5 + 0.5) * 255);
      nm[i * 4 + 1] = Math.round((ny * inv * soft * 0.5 + 0.5) * 255);
      nm[i * 4 + 2] = Math.round((nz * inv * soft + (1 - soft)) * 255);
      nm[i * 4 + 3] = 255;
    }
  }
  return { hs, nm };
}

function grade(c, luma) {
  let v = luma + (c - luma) * 0.85;
  v *= 0.933;
  const d = 1 - v / 255;
  v += 0.06 * 255 * d * d;
  return v;
}

self.onmessage = (ev) => {
  const m = ev.data;
  const t0 = performance.now();
  const { W, H, etopo, ew, eh, lutOcean, lutLand, rings } = m;
  const n = W * H;
  const masks = rasterizeMasks(W, H, rings);
  const elev = elevationSampler(etopo, ew, eh, W, H);
  const near = boxBlurWrap(masks.land, W, H, 3);
  const color = new Uint8ClampedArray(n * 4);
  const ice = m.ice, shelf = m.shelf, lake = m.lake;
  const sat = m.satellite;
  const maxD = lutOcean.length / 3 - 1, maxH = lutLand.length / 3 - 1;
  for (let i = 0; i < n; i++) {
    const e = elev[i];
    const cov = masks.land[i] / 255;
    const d = Math.min(Math.max(Math.round(-e), 0), maxD) * 3;
    let or = lutOcean[d], og = lutOcean[d + 1], ob = lutOcean[d + 2];
    if (cov < 1) {
      const rim = Math.min(near[i] / 255, 1) * 0.06;
      if (rim > 0) { or += (255 - or) * rim; og += (255 - og) * rim; ob += (255 - ob) * rim; }
    }
    let lr, lg, lb;
    if (sat) {
      const j = i * 4;
      const luma = 0.2126 * sat[j] + 0.7152 * sat[j + 1] + 0.0722 * sat[j + 2];
      lr = grade(sat[j], luma); lg = grade(sat[j + 1], luma); lb = grade(sat[j + 2], luma);
    } else if (masks.ant[i] > 127) {
      if (e > 0) { lr = ice[0]; lg = ice[1]; lb = ice[2]; } else { lr = shelf[0]; lg = shelf[1]; lb = shelf[2]; }
    } else if (e >= 5500 || (masks.grl[i] > 127 && e >= 1200)) {
      const f = e >= 5500 ? Math.min((e - 5500) / 300, 1) : Math.min((e - 1200) / 300, 1);
      const h = Math.min(Math.max(Math.round(e), 0), maxH) * 3;
      lr = lutLand[h] + (ice[0] - lutLand[h]) * f; lg = lutLand[h + 1] + (ice[1] - lutLand[h + 1]) * f; lb = lutLand[h + 2] + (ice[2] - lutLand[h + 2]) * f;
    } else {
      const h = Math.min(Math.max(Math.round(e), 0), maxH) * 3;
      lr = lutLand[h]; lg = lutLand[h + 1]; lb = lutLand[h + 2];
    }
    let r = or + (lr - or) * cov, g = og + (lg - og) * cov, b = ob + (lb - ob) * cov;
    const lk = masks.lake[i] / 255;
    if (lk > 0) { r += (lake[0] - r) * lk; g += (lake[1] - g) * lk; b += (lake[2] - b) * lk; }
    const j = i * 4;
    color[j] = r; color[j + 1] = g; color[j + 2] = b; color[j + 3] = 255;
  }
  const w2 = W >> 1, h2 = H >> 1;
  const land2 = downsample2(masks.land, W, H);
  const lake2 = downsample2(masks.lake, W, H);
  for (let i = 0; i < w2 * h2; i++) land2[i] = Math.max(0, land2[i] - lake2[i]);
  const elev2 = elevationSampler(etopo, ew, eh, w2, h2);
  const { hs, nm } = relief(elev2, w2, h2, land2, m.zFactor || 6);
  const ms = performance.now() - t0;
  self.postMessage({ color, mask: land2, hillshade: hs, normal: nm, W, H, ms }, [color.buffer, land2.buffer, hs.buffer, nm.buffer]);
};
