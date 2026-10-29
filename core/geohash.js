const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const LOOKUP = Object.fromEntries([...BASE32].map((c, i) => [c, i]));

export const alphabet = BASE32;

export function encode(lon, lat, len = 9) {
  let w = -180, e = 180, s = -90, n = 90;
  let hash = "", bits = 0, ch = 0, even = true;
  while (hash.length < len) {
    if (even) {
      const mid = (w + e) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; w = mid; } else { ch <<= 1; e = mid; }
    } else {
      const mid = (s + n) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; s = mid; } else { ch <<= 1; n = mid; }
    }
    even = !even;
    if (++bits === 5) { hash += BASE32[ch]; bits = 0; ch = 0; }
  }
  return hash;
}

export function steps(hash) {
  let w = -180, e = 180, s = -90, n = 90, even = true;
  const out = [];
  for (const c of hash.toLowerCase()) {
    const v = LOOKUP[c];
    if (v === undefined) throw new Error("invalid geohash character " + c);
    for (let b = 4; b >= 0; b--) {
      const bit = (v >> b) & 1;
      if (even) {
        const mid = (w + e) / 2;
        if (bit) w = mid; else e = mid;
      } else {
        const mid = (s + n) / 2;
        if (bit) s = mid; else n = mid;
      }
      out.push({ bit, axis: even ? "lon" : "lat", box: { west: w, south: s, east: e, north: n } });
      even = !even;
    }
  }
  return out;
}

export function bounds(hash) {
  if (!hash) return { west: -180, south: -90, east: 180, north: 90 };
  const st = steps(hash);
  return st[st.length - 1].box;
}

export function decode(hash) {
  const b = bounds(hash);
  return { lon: (b.west + b.east) / 2, lat: (b.south + b.north) / 2, error: { lon: (b.east - b.west) / 2, lat: (b.north - b.south) / 2 }, bounds: b };
}

export function neighbours(hash) {
  const b = bounds(hash);
  const dlon = b.east - b.west, dlat = b.north - b.south;
  const lon = (b.west + b.east) / 2, lat = (b.south + b.north) / 2;
  const at = (dx, dy) => {
    const la = lat + dy * dlat;
    if (la > 90 || la < -90) return null;
    let lo = lon + dx * dlon;
    lo = ((lo + 540) % 360) - 180;
    return encode(lo, la, hash.length);
  };
  return { n: at(0, 1), ne: at(1, 1), e: at(1, 0), se: at(1, -1), s: at(0, -1), sw: at(-1, -1), w: at(-1, 0), nw: at(-1, 1) };
}

export function cellSize(len) {
  const bits = 5 * len;
  const lonBits = Math.ceil(bits / 2), latBits = Math.floor(bits / 2);
  return { lon: 360 / 2 ** lonBits, lat: 180 / 2 ** latBits };
}
