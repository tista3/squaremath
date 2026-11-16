// OWNER: core-puzzle agent. English colour naming helpers.

/** Kid-friendly named colours (English). Names are data (shown on printed legends), not UI strings. */
export const CRAYONS: { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Light gray', hex: '#d3d3d3' },
  { name: 'Gray', hex: '#9e9e9e' },
  { name: 'Dark gray', hex: '#555555' },
  { name: 'Black', hex: '#000000' },
  { name: 'Red', hex: '#e53935' },
  { name: 'Dark red', hex: '#b71c1c' },
  { name: 'Coral', hex: '#ff7f50' },
  { name: 'Orange', hex: '#fb8c00' },
  { name: 'Peach', hex: '#ffcc99' },
  { name: 'Yellow', hex: '#ffeb3b' },
  { name: 'Light yellow', hex: '#fff59d' },
  { name: 'Cream', hex: '#fff8dc' },
  { name: 'Gold', hex: '#d4a017' },
  { name: 'Lime', hex: '#a5d610' },
  { name: 'Light green', hex: '#9ccc65' },
  { name: 'Green', hex: '#2e9e3e' },
  { name: 'Dark green', hex: '#1b5e20' },
  { name: 'Olive', hex: '#808000' },
  { name: 'Mint', hex: '#a8e6cf' },
  { name: 'Teal', hex: '#00897b' },
  { name: 'Turquoise', hex: '#40e0d0' },
  { name: 'Sky blue', hex: '#4fc3f7' },
  { name: 'Light blue', hex: '#add8e6' },
  { name: 'Blue', hex: '#1e88e5' },
  { name: 'Royal blue', hex: '#2453f0' },
  { name: 'Indigo', hex: '#3f51b5' },
  { name: 'Blue gray', hex: '#607d8b' },
  { name: 'Navy', hex: '#1a237e' },
  { name: 'Purple', hex: '#8e24aa' },
  { name: 'Violet', hex: '#9c51e0' },
  { name: 'Lilac', hex: '#c8a2c8' },
  { name: 'Lavender', hex: '#c5cae9' },
  { name: 'Pink', hex: '#f48fb1' },
  { name: 'Light pink', hex: '#fce4ec' },
  { name: 'Hot pink', hex: '#e91e63' },
  { name: 'Magenta', hex: '#e040fb' },
  { name: 'Brown', hex: '#8d6e63' },
  { name: 'Chestnut', hex: '#8d5524' },
  { name: 'Light brown', hex: '#b5835a' },
  { name: 'Dark brown', hex: '#4e342e' },
  { name: 'Beige', hex: '#f5deb3' },
  { name: 'Tan', hex: '#d2b48c' },
];

type Lab = readonly [number, number, number];

const CRAYON_LABS: { name: string; lab: Lab }[] = CRAYONS.map((c) => ({ name: c.name, lab: hexToLab(c.hex) }));

/** Nearest crayon name to a hex colour (CIEDE2000 distance in CIELAB). Invalid input is treated as black. */
export function nearestColorName(hex: string): string {
  const lab = hexToLab(normalizeHex(hex) ?? '#000000');
  let best = CRAYON_LABS[0];
  let bestDist = Infinity;
  for (const c of CRAYON_LABS) {
    const d = deltaE2000(lab, c.lab);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.name;
}

/** Accepts '#abc', 'abc', '#aabbcc', 'AABBCC'; returns lowercase '#aabbcc' or null if invalid. */
export function normalizeHex(input: string): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  return null;
}

/** Readable text colour on top of the given background (higher WCAG contrast wins). Invalid input → black text. */
export function textColorFor(hex: string): '#000000' | '#ffffff' {
  const norm = normalizeHex(hex);
  if (!norm) return '#000000';
  const [r, g, b] = hexToLinearRgb(norm);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrastBlack = (lum + 0.05) / 0.05;
  const contrastWhite = 1.05 / (lum + 0.05);
  return contrastBlack >= contrastWhite ? '#000000' : '#ffffff';
}

/** sRGB '#rrggbb' → linear-light channels in [0,1]. */
function hexToLinearRgb(hex: string): [number, number, number] {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

/** '#rrggbb' → CIELAB (D65). */
function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToLinearRgb(hex);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference (Sharma et al. 2005); handles the blue/purple region far better than CIE76. */
function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const pow7 = (x: number) => x ** 7;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(pow7(cBar) / (pow7(cBar) + pow7(25))));
  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  let dhp = h2p - h1p;
  if (c1p * c2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dLp = l2 - l1;
  const dCp = c2p - c1p;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * rad);

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;
  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hBarP /= 2;
    else hBarP = h1p + h2p < 360 ? (hBarP + 360) / 2 : (hBarP - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * rad) +
    0.24 * Math.cos(2 * hBarP * rad) +
    0.32 * Math.cos((3 * hBarP + 6) * rad) -
    0.2 * Math.cos((4 * hBarP - 63) * rad);
  const sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt =
    -2 *
    Math.sqrt(pow7(cBarP) / (pow7(cBarP) + pow7(25))) *
    Math.sin(60 * Math.exp(-(((hBarP - 275) / 25) ** 2)) * rad);
  const tl = dLp / sl;
  const tc = dCp / sc;
  const th = dHp / sh;
  return Math.sqrt(tl * tl + tc * tc + th * th + rt * tc * th);
}

/** Near-white colours that look like blank paper: empty boxes of such a background need no colouring. */
export function isPaperColor(hex: string): boolean {
  const norm = normalizeHex(hex);
  if (!norm) return false;
  return [1, 3, 5].every((i) => parseInt(norm.slice(i, i + 2), 16) >= 0xf0);
}

/** Every crayon name ranked by CIEDE2000 distance to `hex` (nearest first; ties keep CRAYONS order).
 * Invalid input is treated as black. ranked[0].name === nearestColorName(hex). */
export function rankedColorNames(hex: string): { name: string; hex: string; distance: number }[] {
  const lab = hexToLab(normalizeHex(hex) ?? '#000000');
  return CRAYONS.map((c, i) => ({ name: c.name, hex: c.hex, distance: deltaE2000(lab, CRAYON_LABS[i].lab), i }))
    .sort((a, b) => a.distance - b.distance || a.i - b.i)
    .map(({ name, hex: h, distance }) => ({ name, hex: h, distance }));
}

/** CIEDE2000 difference between two hex colours (invalid input is treated as black). */
export function colorDifference(hexA: string, hexB: string): number {
  return deltaE2000(hexToLab(normalizeHex(hexA) ?? '#000000'), hexToLab(normalizeHex(hexB) ?? '#000000'));
}

/** CIEDE2000 difference between two CIELAB colours ([L, a, b]). */
export function deltaE(labA: readonly [number, number, number], labB: readonly [number, number, number]): number {
  return deltaE2000(labA, labB);
}
