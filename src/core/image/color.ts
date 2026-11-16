// OWNER: image-core agent. Fast colour-space helpers for the photo pipeline (sRGB ↔ linear ↔ CIELAB, D65).

/** sRGB byte → linear-light [0,1]. */
export const SRGB_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

export function linearToSrgbByte(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

function fLab(t: number): number {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

function fLabInv(t: number): number {
  const t3 = t * t * t;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
}

/** Linear RGB → Lab, written into out[o..o+2]. */
export function linearToLab(r: number, g: number, b: number, out: Float32Array | number[], o = 0): void {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const fx = fLab(x);
  const fy = fLab(y);
  const fz = fLab(z);
  out[o] = 116 * fy - 16;
  out[o + 1] = 500 * (fx - fy);
  out[o + 2] = 200 * (fy - fz);
}

/** Lab → linear RGB (unclamped). */
export function labToLinear(l: number, a: number, bb: number): [number, number, number] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const x = fLabInv(fx) * 0.95047;
  const y = fLabInv(fy);
  const z = fLabInv(fz) * 1.08883;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

export function rgbBytesToLab(r: number, g: number, b: number): [number, number, number] {
  const out: number[] = [0, 0, 0];
  linearToLab(SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b], out);
  return [out[0], out[1], out[2]];
}

/** Lab → sRGB bytes, clamped into the gamut. */
export function labToRgbBytes(l: number, a: number, b: number): [number, number, number] {
  const [r, g, bl] = labToLinear(l, a, b);
  return [linearToSrgbByte(r), linearToSrgbByte(g), linearToSrgbByte(bl)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbBytesToLab(r, g, b);
}

export function labToHex(l: number, a: number, b: number): string {
  const [r, g, bl] = labToRgbBytes(l, a, b);
  return rgbToHex(r, g, bl);
}

/** Squared CIE76 distance between Lab triples stored in flat arrays. */
export function dist2(p: ArrayLike<number>, i: number, q: ArrayLike<number>, j: number): number {
  const dl = p[i] - q[j];
  const da = p[i + 1] - q[j + 1];
  const db = p[i + 2] - q[j + 2];
  return dl * dl + da * da + db * db;
}
