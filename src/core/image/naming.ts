// OWNER: image-core agent. Unique English names for a converted palette.
import { rankedColorNames } from '../colors';
import { hexToLab } from './color';

/** A crayon name counts as a good fit up to this CIEDE2000 distance. */
const GOOD_FIT = 16;

/**
 * Unique names for `hexes` (same order). The best-fitting colour/name pairs are assigned first, so the
 * purest red gets "Red" and a second red gets the next-best crayon ("Dark red", "Coral"...). Colours left
 * without a good free crayon name get "Light …"/"Dark …" (by lightness against the crayon), then "Pale …"/
 * "Deep …" — for the nearest three crayons in turn — and only then a number. Names in `reserved` (compared case-insensitively) are never used.
 */
export function uniqueColorNames(hexes: string[], reserved: string[] = []): string[] {
  const taken = new Set(reserved.map((r) => r.toLowerCase()));
  const names: (string | null)[] = hexes.map(() => null);
  const ranked = hexes.map((hex) => rankedColorNames(hex).filter((r) => !taken.has(r.name.toLowerCase())));
  const pairs: { i: number; name: string; d: number }[] = [];
  ranked.forEach((list, i) => {
    for (const r of list) if (r.distance <= GOOD_FIT) pairs.push({ i, name: r.name, d: r.distance });
  });
  pairs.sort((a, b) => a.d - b.d || a.i - b.i);
  for (const p of pairs) {
    if (names[p.i] !== null || taken.has(p.name.toLowerCase())) continue;
    names[p.i] = p.name;
    taken.add(p.name.toLowerCase());
  }
  hexes.forEach((hex, i) => {
    if (names[i] !== null) return;
    const lighter = (crayonHex: string) => hexToLab(hex)[0] >= hexToLab(crayonHex)[0];
    const candidates: string[] = [];
    const bases = ranked[i].slice(0, 3);
    if (bases.length === 0) bases.push({ name: 'Colour', hex, distance: 0 });
    for (const base of bases) {
      const up = lighter(base.hex);
      const stem = base.name.replace(/^(Light|Dark) /, '');
      const lower = stem.charAt(0).toLowerCase() + stem.slice(1);
      candidates.push(
        up ? `Light ${lower}` : `Dark ${lower}`,
        up ? `Pale ${lower}` : `Deep ${lower}`,
        stem,
        up ? `Dark ${lower}` : `Light ${lower}`,
      );
    }
    for (let k = 2; k < 100; k++) candidates.push(`${bases[0].name} ${k}`);
    const name = candidates.find((c) => !taken.has(c.toLowerCase())) ?? `Colour ${i + 1}`;
    names[i] = name;
    taken.add(name.toLowerCase());
  });
  return names as string[];
}
