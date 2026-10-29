export const ui = {
  bg0: "#f1ede4", bg: "#faf8f3", bg2: "#faf8f3", panel: "#ffffff", panel2: "#f1ede5", raised: "#ffffff",
  line: "#e3ded3", line2: "#cdc6b7",
  ink: "#1a1917", ink2: "#3f3c37", ink3: "#6b665e", ink4: "#a29c91",
  brass: "#b85217", brassInk: "#ffffff", brassSoft: "rgba(184,82,23,.12)",
  signal: "#1d63a8", signalSoft: "rgba(29,99,168,.10)",
  ok: "#2f7d4f", warn: "#b7791f", err: "#b42335", violet: "#7046a6", sun: "#e3a20b", scrim: "rgba(40,34,24,.32)",
  halo: "#faf8f3"
};

export const ocean = [[0, "#d4e4ec"], [-50, "#d0e1e9"], [-200, "#cadde6"], [-1000, "#c4d9e3"], [-3000, "#bfd5e0"], [-6000, "#bad1dd"], [-11000, "#b2cad8"]];
export const land = [[0, "#ebe5d5"], [150, "#e7e0cd"], [400, "#e1d8c1"], [900, "#d8ccb0"], [1600, "#cdbf9f"], [2600, "#c4b596"], [4000, "#dcd4c4"], [6000, "#f2eee6"]];
export const ice = "#fbfaf7";
export const iceShelf = "#eef3f5";
export const lake = "#cfe0e8";
export const iceTint = "#bcd6ea";
export const atmosphere = { outer: "#3a362f", rim: "#ffffff", specular: "#ffffff", nightTint: "#ffd9a0" };
export const light = { key: "#ffffff", keyIntensity: 1.0, keyDir: [-0.55, 0.45, 0.70], sky: "#ffffff", ground: "#d9d1c1", fillIntensity: 2.3, sunIntensity: 1.15, night: 0.56, cityLights: 0 };

export const lines = {
  coast: "rgba(74,66,54,.62)", border: "rgba(74,66,54,.28)", river: "rgba(64,124,166,.5)",
  gratMinor: "rgba(60,52,40,.07)", gratMajor: "rgba(60,52,40,.15)", equator: "rgba(60,52,40,.38)",
  tropic: "rgba(60,52,40,.26)", outline: "rgba(40,36,30,.62)", outlineGlow: "rgba(0,0,0,0)"
};

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(rgb) {
  return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function css(rgb, a = 1) { return a >= 1 ? rgbToHex(rgb) : `rgba(${rgb.map((v) => Math.round(v)).join(",")},${a})`; }

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function srgbToOklab(rgb) {
  const r = toLinear(rgb[0] / 255), g = toLinear(rgb[1] / 255), b = toLinear(rgb[2] / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}
export function oklabToSrgb(lab) {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return [toSrgb(clamp(r)) * 255, toSrgb(clamp(g)) * 255, toSrgb(clamp(b)) * 255];
}
export function mixOklab(rgbA, rgbB, t) {
  const a = srgbToOklab(rgbA), b = srgbToOklab(rgbB);
  return oklabToSrgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

function rampStops(ramp) { return ramp.map(([v, hex]) => [v, srgbToOklab(hexToRgb(hex))]); }
const oceanStops = rampStops(ocean);
const landStops = rampStops(land);
const iceRgb = hexToRgb(ice);
const iceShelfRgb = hexToRgb(iceShelf);

function sampleStops(stops, v, descending) {
  const n = stops.length;
  if (descending ? v >= stops[0][0] : v <= stops[0][0]) return stops[0][1];
  if (descending ? v <= stops[n - 1][0] : v >= stops[n - 1][0]) return stops[n - 1][1];
  for (let i = 1; i < n; i++) {
    const [v0, c0] = stops[i - 1], [v1, c1] = stops[i];
    const inside = descending ? v <= v0 && v >= v1 : v >= v0 && v <= v1;
    if (inside) {
      const t = (v - v0) / (v1 - v0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[n - 1][1];
}

export function elevationColor(m, { ice = false, shelf = false } = {}) {
  if (shelf) return iceShelfRgb.slice();
  if (ice) return iceRgb.slice();
  if (m < 0) return oklabToSrgb(sampleStops(oceanStops, m, true));
  return oklabToSrgb(sampleStops(landStops, m, false));
}

export function oceanLUT(maxDepth = 11000) {
  const out = new Uint8Array((maxDepth + 1) * 3);
  for (let d = 0; d <= maxDepth; d++) {
    const c = oklabToSrgb(sampleStops(oceanStops, -d, true));
    out[d * 3] = Math.round(c[0]); out[d * 3 + 1] = Math.round(c[1]); out[d * 3 + 2] = Math.round(c[2]);
  }
  return out;
}
export function landLUT(maxHeight = 9000) {
  const out = new Uint8Array((maxHeight + 1) * 3);
  for (let h = 0; h <= maxHeight; h++) {
    const c = oklabToSrgb(sampleStops(landStops, h, false));
    out[h * 3] = Math.round(c[0]); out[h * 3 + 1] = Math.round(c[1]); out[h * 3 + 2] = Math.round(c[2]);
  }
  return out;
}

function glslStops(name, stops) {
  const vals = stops.map(([v]) => v.toFixed(1)).join(", ");
  const labs = stops.map(([, c]) => `vec3(${c.map((x) => x.toFixed(5)).join(", ")})`).join(",\n    ");
  return `const float ${name}V[${stops.length}] = float[${stops.length}](${vals});\n  const vec3 ${name}L[${stops.length}] = vec3[${stops.length}](\n    ${labs}\n  );`;
}

export const glsl = `
  ${glslStops("gOcean", oceanStops)}
  ${glslStops("gLand", landStops)}
  const vec3 gIceLab = vec3(${srgbToOklab(iceRgb).map((x) => x.toFixed(5)).join(", ")});
  vec3 gOklabToLinear(vec3 lab) {
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return clamp(vec3(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s), 0.0, 1.0);
  }
  vec3 gLinearToSrgb(vec3 c) {
    return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 elevationColor(float m, float iceMask) {
    vec3 lab;
    if (m < 0.0) {
      lab = gOceanL[0];
      for (int i = 1; i < ${oceanStops.length}; i++) {
        float t = clamp((m - gOceanV[i - 1]) / (gOceanV[i] - gOceanV[i - 1]), 0.0, 1.0);
        lab = mix(lab, gOceanL[i], t);
      }
    } else {
      lab = gLandL[0];
      for (int i = 1; i < ${landStops.length}; i++) {
        float t = clamp((m - gLandV[i - 1]) / (gLandV[i] - gLandV[i - 1]), 0.0, 1.0);
        lab = mix(lab, gLandL[i], t);
      }
    }
    lab = mix(lab, gIceLab, clamp(iceMask, 0.0, 1.0));
    return gLinearToSrgb(gOklabToLinear(lab));
  }
`;

const divBlue = hexToRgb("#2b65ad"), divNavy = hexToRgb("#f4f1ea"), divBrass = hexToRgb("#b85217");
const seqNavy = hexToRgb("#f1ede4"), seqSignal = hexToRgb("#1d63a8");

export function divergingRGB(t) {
  const v = Math.max(-1, Math.min(1, t));
  return v < 0 ? mixOklab(divNavy, divBlue, -v) : mixOklab(divNavy, divBrass, v);
}
export function sequentialRGB(t) { return mixOklab(seqNavy, seqSignal, Math.max(0, Math.min(1, t))); }
export const diverging = (t) => rgbToHex(divergingRGB(t));
export const sequential = (t) => rgbToHex(sequentialRGB(t));

export function deltaE(rgbA, rgbB) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lab = (rgb) => {
    const r = toLinear(rgb[0] / 255), g = toLinear(rgb[1] / 255), b = toLinear(rgb[2] / 255);
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const a = lab(rgbA), b = lab(rgbB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
