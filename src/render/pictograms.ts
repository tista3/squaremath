// Original black & white pictograms for simple mode, drawn to stay recognisable in a 7 mm square.
//
// Each one lives on a 24×24 canvas as `line` (outlines) and/or `fill` (solid ink), written with absolute
// M L H V Q C Z plus "E cx cy rx ry" for an ellipse. They are flattened to M/L/Z so the sheet SVG, the
// vector PDF (which has no curves), the solve canvas and the React icons all draw exactly the same thing.
import type { PictogramId } from '../core/symbols';

/** Edge of the drawing canvas. */
export const PICTO_BOX = 24;
/** Outline width on that canvas. */
export const PICTO_STROKE = 1.6;

interface Drawing {
  line?: string;
  fill?: string;
}

const DRAWINGS: Record<PictogramId, Drawing> = {
  // shapes
  circle: { line: 'E12 12 9.5 9.5' },
  square: { line: 'M3 3H21V21H3Z' },
  triangle: { line: 'M12 2.5L22 20.5H2Z' },
  star: { line: 'M12 2L15 8.7L22 9.4L16.8 14.2L18.2 21.3L12 17.6L5.8 21.3L7.2 14.2L2 9.4L9 8.7Z' },
  heart: { line: 'M12 21C3 15 1.5 10 2.5 6.5C4 2 10 2 12 7C14 2 20 2 21.5 6.5C22.5 10 21 15 12 21Z' },
  diamond: { line: 'M12 1.5L20 12L12 22.5L4 12Z' },
  plus: { line: 'M9 2.5H15V9H21.5V15H15V21.5H9V15H2.5V9H9Z' },
  hexagon: { line: 'M7 3H17L22.5 12L17 21H7L1.5 12Z' },
  arrow: { line: 'M2 9H12V4L22 12L12 20V15H2Z' },
  zigzag: { line: 'M2 9L7 4L12 9L17 4L22 9M2 19L7 14L12 19L17 14L22 19' },
  target: { line: 'E12 12 9.5 9.5', fill: 'E12 12 4 4' },
  arch: { line: 'M2 19V16C2 2 22 2 22 16V19H16V16C16 10 8 10 8 16V19Z' },

  // animals
  cat: {
    line: 'M4 12V3L9 6.5H15L20 3V12C20 24 4 24 4 12ZM1 14L6 15M23 14L18 15M12 16V17.5M10 19L12 17.5L14 19',
    fill: 'E9 11.5 1.3 1.6E15 11.5 1.3 1.6M10.3 14.5H13.7L12 16.5Z',
  },
  dog: {
    line: 'M6 8C6 1 18 1 18 8V15C18 24 6 24 6 15ZM12 16.5V19M9.5 19.5Q12 21 14.5 19.5',
    fill: 'M7 4C3 3 0 8 1.5 14C4 16 6 12 7 4ZM17 4C21 3 24 8 22.5 14C20 16 18 12 17 4ZE9.5 10.5 1.3 1.5E14.5 10.5 1.3 1.5E12 15 2.4 1.8',
  },
  rabbit: {
    line: 'M9 10C4 5 4 0.5 7 1C10 1 10.5 6 11 9.5M13 9.5C13.5 6 14 1 17 1C20 0.5 20 5 15 10E12 16 7.5 6.8M12 18V20',
    fill: 'E9 14.5 1.3 1.6E15 14.5 1.3 1.6E12 17.8 1.6 1.2',
  },
  bear: {
    line: 'E12 13.5 8.5 8E12 17 4 3',
    fill: 'E4.5 5.5 3.3 3.3E19.5 5.5 3.3 3.3E8.5 11 1.3 1.5E15.5 11 1.3 1.5E12 16 2 1.4',
  },
  pig: {
    line: 'M4.5 9L3 2.5L9 5.5M15 5.5L21 2.5L19.5 9E12 13.5 9 8.5E12 16 4.8 3.4',
    fill: 'E10.2 16 1 1.5E13.8 16 1 1.5E8 10 1.2 1.3E16 10 1.2 1.3',
  },
  owl: {
    line: 'M4 2L9 5H15L20 2V15C20 24 4 24 4 15ZE8.5 10 3.4 3.4E15.5 10 3.4 3.4',
    fill: 'E8.5 10 1.5 1.5E15.5 10 1.5 1.5M10 14.5H14L12 18Z',
  },
  fish: { line: 'M17 12C12 3 5 4 1.5 12C5 20 12 21 17 12ZM17 12L22.5 6V18ZM10 8Q12.5 12 10 16', fill: 'E6 10.5 1.4 1.4' },
  bird: {
    line: 'M2 11L7 13C6 3 16 1 17 9C18 21 5 21 2 11ZM9 18L8 22M13 18L14 22',
    fill: 'M17 7L22.5 9L17 11ZE13.5 7.5 1.3 1.3M7 12C10 11 13 12 14 14C11 17 8 16 7 12Z',
  },
  butterfly: {
    line: 'M11 10C7 1 1 2 2 7C2 11 6 12 8 12C3 13 2 19 6 20.5C9 21.5 11 16 11 14M13 10C17 1 23 2 22 7C22 11 18 12 16 12C21 13 22 19 18 20.5C15 21.5 13 16 13 14M11 7L9 3M13 7L15 3',
    fill: 'E12 13 1.7 6.5E5.8 7 1.5 1.5E18.2 7 1.5 1.5',
  },
  snail: {
    line: 'E9.5 10.5 7.5 7.5M9.5 10.5C9.5 7.5 13.5 7.5 13.5 11C13.5 15.5 5.5 15.5 5.5 10C5.5 7 8 5.5 10 5.5M6 17L1.5 21H18C22 21 22 16 21 10M17 18C19 17 18.5 13 18.5 10M21 10L22.5 5M18.5 10L18 5',
    fill: 'E22.5 4.5 1.3 1.3E18 4.5 1.3 1.3',
  },
  turtle: {
    line: 'M2 16C2 3 17 3 17 16ZE20 12.5 3 3M4 16V20H7V16M12 16V20H15V16M6.5 16L8 11H11L12.5 16M8 11L6 8M11 11L13 8',
    fill: 'E20.8 11.8 1 1',
  },
  spider: {
    line: 'M9 11L4 5L1.5 9M15 11L20 5L22.5 9M8 13L3 11L1 15M16 13L21 11L23 15M8 15L3 16L2 20M16 15L21 16L22 20M9 17L6 19V22M15 17L18 19V22',
    fill: 'E12 14 5 5.5E12 7.5 3 2.7',
  },

  // nature
  sun: { line: 'E12 12 5.5 5.5M12 1V4M12 20V23M1 12H4M20 12H23M4.2 4.2L6.3 6.3M17.7 17.7L19.8 19.8M19.8 4.2L17.7 6.3M6.3 17.7L4.2 19.8' },
  moon: { fill: 'M16 2C0 1 0 23 16 22C6 18 6 6 16 2Z' },
  cloud: { line: 'M6 19C0 19 0 10 6 11C5 4 15 2 16 9C24 7 25 19 18 19Z' },
  rainbow: { line: 'M1.5 19C1.5 1 22.5 1 22.5 19M5.5 19C5.5 6.5 18.5 6.5 18.5 19M9.5 19C9.5 12 14.5 12 14.5 19' },
  drop: { fill: 'M12 1.5C16 8 19.5 12 19.5 16C19.5 25 4.5 25 4.5 16C4.5 12 8 8 12 1.5Z' },
  snowflake: {
    line: 'M12 1.5V22.5M3 6.8L21 17.2M21 6.8L3 17.2M9 3L12 6L15 3M9 21L12 18L15 21M3 11L7 9.2L6.5 5M21 11L17 9.2L17.5 5M3 13L7 14.8L6.5 19M21 13L17 14.8L17.5 19',
  },
  flower: { line: 'E12 5 3.4 3.5E5.5 9.8 3.5 3.4E18.5 9.8 3.5 3.4E8 17.8 3.4 3.5E16 17.8 3.4 3.5', fill: 'E12 12 3.2 3.2' },
  tree: { line: 'M12 1.5L18 8H15L20 13.5H16.5L22 19H2L7.5 13.5H4L9 8H6Z', fill: 'M10 19H14V23H10Z' },
  leaf: { line: 'M5 19C0 7 10 2 21 3C22 14 17 24 5 19ZM2 22L15 9M9 15V10M11 13H16' },
  mushroom: { line: 'M2 12C2 -1 22 -1 22 12ZM8.5 12L7.5 21.5H16.5L15.5 12', fill: 'E8 7.5 2 2E15.5 6 1.6 1.6E17.5 9.8 1.2 1' },
  lightning: { fill: 'M14 1L4 14H10.5L8 23L20 9H13Z' },
  mountain: { line: 'M1 21L9 4L14 14.5L17 9L23 21Z', fill: 'M9 4L12.2 10.8L9 9L6 10.5Z' },

  // food
  apple: {
    line: 'M12 7C6 3 1.5 8 2.5 14C3.5 21 8 24 12 21C16 24 20.5 21 21.5 14C22.5 8 18 3 12 7ZM12 7V2',
    fill: 'M13 4C14 0 19 0 20 2C18 5 15 5 13 4Z',
  },
  pear: {
    line: 'M12 5C8 5 9 10 6.5 13C2 18 6 22.5 12 22.5C18 22.5 22 18 17.5 13C15 10 16 5 12 5ZM12 5L13 1',
    fill: 'M13.5 3.5C15 0.5 19 0.5 20 2.5C18 5 15 5 13.5 3.5Z',
  },
  cherries: { line: 'M6 14C7 8 10 5 14 2C14 7 16 10 18 14', fill: 'E6 18 4.5 4.5E18 18 4.5 4.5M14 2C17 0 21 1 22 4C19 6 16 5 14 2Z' },
  banana: { line: 'M17 3H20C25 16 12 26 2 19V16C10 19 18 14 17 3ZM4 18C13 21 21 14 19 6', fill: 'M16.5 1H20.5V4H16.5Z' },
  carrot: { line: 'M2 22L9 8C12 5 19 12 16 15ZM7 12L10 14M5 16L8 18M14 9L15 2M15 10L21 4M16 11L22.5 10' },
  strawberry: {
    line: 'M12 22.5C3 18 0 11 4 7C7 4.5 17 4.5 20 7C24 11 21 18 12 22.5Z',
    fill: 'M5 6L10 5L12 1L14 5L19 6L14 8L12 11L10 8ZE7 12 1.1 1.3E17 12 1.1 1.3E9.5 16 1.1 1.3E14.5 16 1.1 1.3E12 19.3 1 1.2',
  },
  icecream: { line: 'M6 12C1 2 10 0 12 2C14 0 23 2 18 12Z', fill: 'M5.5 13.5H18.5L12 23.5Z' },
  cupcake: { line: 'M4 12C1 7 7 6 8 6C8 3 16 3 16 6C17 6 23 7 20 12ZM5 12L7 22H17L19 12M10 15V19M14 15V19', fill: 'E12 2.5 2 2' },
  pizza: { line: 'M3 6L12 23L21 6M2 6C7 1 17 1 22 6C17 4 7 4 2 6Z', fill: 'E9 9 1.8 1.8E15 10 1.8 1.8E12 15.5 1.8 1.8' },
  sweet: { line: 'E12 12 5.5 5.5M6.5 12L1.5 7V17ZM17.5 12L22.5 7V17ZM10 7C14 10 14 14 10 17' },
  cheese: { line: 'M2 11L16 4L22 11V20H2ZM2 11H22', fill: 'E7 15.5 2 2E15.5 16.5 1.6 1.6E14 8 1.8 1.1' },
  egg: { line: 'M9 2.5C14 0 16 6 19 7C24 9 22 16 18 17C15 18 15 23 9 22C3 21 5 16 3 13C0 9 4 5 9 2.5Z', fill: 'E11.5 12 4.2 4.2' },

  // things that go
  car: {
    line: 'M1.5 17V12L5.5 11L8 6H16L19 11L22.5 12V17ZM5.5 11H19M12 6V11',
    fill: 'E6.5 17.5 3 3E17.5 17.5 3 3',
  },
  bus: {
    line: 'M1.5 18V4H20L22.5 11V18ZM1.5 11H22.5M7 4V11M12.5 4V11M17.5 4V11',
    fill: 'E6.5 18.5 2.8 2.8E17.5 18.5 2.8 2.8',
  },
  train: {
    line: 'M3 17V3H11V17M11 9H20V17H3M5.5 6H8.5V10H5.5Z',
    fill: 'M15.5 9L14.5 3.5H19.5L18.5 9ZM20 13L23.5 18H20ZE6.5 19 3 3E13 20 2 2E18 20 2 2',
  },
  plane: { fill: 'M12 1C14 1 14.5 4 14.5 8L23 13V16L14.5 13.5V18L18 21V23L12 21.5L6 23V21L9.5 18V13.5L1 16V13L9.5 8C9.5 4 10 1 12 1Z' },
  boat: { line: 'M12 16V2M12 3L20.5 13H12M10 6L4 13H10Z', fill: 'M1.5 16H22.5L18.5 22H5.5Z' },
  rocket: {
    line: 'M12 1C5 6 6 14 8 18H16C18 14 19 6 12 1ZM7 11L3 16V20L8 17M17 11L21 16V20L16 17',
    fill: 'E12 9 2.3 2.3M9.5 19H14.5L12 23.5Z',
  },
  bicycle: { line: 'E5.5 17 4.5 4.5E18.5 17 4.5 4.5M5.5 17L9 9H16.5L11.5 17ZM11.5 17L8 6M6 6H10M18.5 17L15.5 5H19' },
  tractor: {
    line: 'M4 11V3H12L14 11H21.5V17H13M18.5 11V5M8 3V10E7.5 16.5 6 6',
    fill: 'E7.5 16.5 2.5 2.5E19.5 19 3 3',
  },
  balloon: {
    line: 'M9 16C-2 8 4 1 12 1C20 1 26 8 15 16ZM12 1C8 5 8 11 11 16M12 1C16 5 16 11 13 16M9 16L10 20M15 16L14 20',
    fill: 'M9 19.5H15V23.5H9Z',
  },
  helicopter: {
    line: 'M3 3H21M12 3V8M8 12L2 10V7M8 9C15 5 22 9 21 15C18 19 9 18 8 12ZM11 18V21M18 18V21M8 21H22',
    fill: 'M15 9C18 9 20 11 20 14H15Z',
  },
  truck: {
    line: 'M1.5 17V4H14V17ZM14 8H19L22.5 12V17H14M16.5 8V12H22',
    fill: 'E6 18.5 2.8 2.8E18 18.5 2.8 2.8',
  },
  submarine: {
    line: 'E14 15 9 6.5M10 9V5H15V9M12.5 5V1.5H17M5 15L1.5 11V19Z',
    fill: 'E10 15 1.8 1.8E15 15 1.8 1.8E19.5 15 1.3 1.3',
  },
};

type Point = [number, number];

/** A flattened subpath on the 24×24 canvas. */
export interface Subpath {
  points: Point[];
  closed: boolean;
}

export interface Pictogram {
  line: Subpath[];
  fill: Subpath[];
}

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, E: 4, Z: 0 };
const CURVE_STEPS = 8;

function ellipse(cx: number, cy: number, rx: number, ry: number): Subpath {
  // Small dots need far fewer corners than big circles, which keeps 40×40 sheets light.
  const steps = Math.max(rx, ry) < 3 ? 10 : 24;
  const points = Array.from({ length: steps }, (_, i): Point => {
    const a = (i / steps) * 2 * Math.PI;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
  return { points, closed: true };
}

function flatten(data: string): Subpath[] {
  const out: Subpath[] = [];
  let points: Point[] = [];
  for (const [, cmd, rest] of data.matchAll(/([A-Z])([^A-Z]*)/g)) {
    const a = (rest.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    if (a.length !== ARG_COUNT[cmd]) throw new Error(`Bad pictogram command "${cmd}${rest}"`);
    if (cmd === 'E') {
      out.push(ellipse(a[0], a[1], a[2], a[3]));
      continue;
    }
    if (cmd === 'M') {
      points = [[a[0], a[1]]];
      out.push({ points, closed: false });
      continue;
    }
    if (cmd === 'Z') {
      out[out.length - 1].closed = true;
      continue;
    }
    const [x, y] = points[points.length - 1];
    if (cmd === 'L') points.push([a[0], a[1]]);
    else if (cmd === 'H') points.push([a[0], y]);
    else if (cmd === 'V') points.push([x, a[0]]);
    else {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        if (cmd === 'Q') {
          points.push([u * u * x + 2 * u * t * a[0] + t * t * a[2], u * u * y + 2 * u * t * a[1] + t * t * a[3]]);
        } else {
          points.push([
            u ** 3 * x + 3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t ** 3 * a[4],
            u ** 3 * y + 3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t ** 3 * a[5],
          ]);
        }
      }
    }
  }
  return out;
}

const flattened = new Map<PictogramId, Pictogram>();

export function getPictogram(id: PictogramId): Pictogram {
  let picture = flattened.get(id);
  if (!picture) {
    const { line = '', fill = '' } = DRAWINGS[id];
    picture = { line: flatten(line), fill: flatten(fill) };
    flattened.set(id, picture);
  }
  return picture;
}

/** SVG path data (absolute M, L, Z only) of subpaths scaled by `scale` and moved to (x, y). */
export function pictogramPath(subpaths: readonly Subpath[], x = 0, y = 0, scale = 1): string {
  const coord = (v: number) => Math.round(v * 100) / 100;
  return subpaths
    .map(({ points, closed }) => {
      const d = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${coord(x + px * scale)} ${coord(y + py * scale)}`).join('');
      return closed ? `${d}Z` : d;
    })
    .join('');
}
