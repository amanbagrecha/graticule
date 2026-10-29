export function grid(numRows = 2160) {
  const binsPerRow = new Int32Array(numRows);
  const basebin = new Float64Array(numRows);
  const rowHeight = 180 / numRows;
  const latOfRow = (r) => -90 + (r + 0.5) * rowHeight;
  let next = 1;
  for (let r = 0; r < numRows; r++) {
    binsPerRow[r] = Math.floor(2 * numRows * Math.cos((latOfRow(r) * Math.PI) / 180) + 0.5);
    basebin[r] = next;
    next += binsPerRow[r];
  }
  return { numRows, binsPerRow, basebin, total: next - 1, rowHeight, latOfRow };
}

export function rowOfLat(g, lat) {
  return Math.max(0, Math.min(g.numRows - 1, Math.floor(((lat + 90) * g.numRows) / 180)));
}

export function binInfo(g, lon, lat) {
  const row = rowOfLat(g, lat);
  const n = g.binsPerRow[row];
  const L = ((lon + 180) % 360 + 360) % 360;
  const col = Math.max(0, Math.min(n - 1, Math.floor((L * n) / 360)));
  return { bin: g.basebin[row] + col, row, col, binsInRow: n };
}

export function binFromLatLon(g, lon, lat) {
  return binInfo(g, lon, lat).bin;
}

export function rowOfBin(g, bin) {
  let lo = 0, hi = g.numRows - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.basebin[mid] <= bin) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function binToBounds(g, bin) {
  if (bin < 1 || bin > g.total) return null;
  const row = rowOfBin(g, bin);
  const col = bin - g.basebin[row];
  const n = g.binsPerRow[row];
  const south = -90 + row * g.rowHeight;
  return { row, col, binsInRow: n, west: -180 + (col * 360) / n, east: -180 + ((col + 1) * 360) / n, south, north: south + g.rowHeight };
}

export function binArea(g, row, R = 6371.0088) {
  const s = (-90 + row * g.rowHeight) * Math.PI / 180;
  const n = s + (g.rowHeight * Math.PI) / 180;
  return (2 * Math.PI * R * R * (Math.sin(n) - Math.sin(s))) / g.binsPerRow[row];
}
