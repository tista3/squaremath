// OWNER: render-export agent. Text measurement without a DOM.
//
// The sheet SVG is built as a string (also in tests / workers), so text cannot be measured with canvas.
// Instead we use the Helvetica advance widths from the standard AFM files: Arial (Windows) and
// Liberation Sans (Linux) share them, and the vector PDF uses the built-in Helvetica, so preview, print
// and PDF all agree. Unknown glyphs fall back to conservative averages.

/** Helvetica advance widths in 1/1000 em for the printable ASCII range 32..126. */
// prettier-ignore
const REGULAR_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, // A-M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // N-Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, // a-m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // n-z
  334, 260, 334, 584, // { | } ~
];

/** Helvetica-Bold advance widths in 1/1000 em for the printable ASCII range 32..126. */
// prettier-ignore
const BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889,
  611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500,
  389, 280, 389, 584,
];

/** Non-ASCII glyphs that appear on sheets (operators, dashes, punctuation); same width in both weights. */
const SYMBOLS: Record<string, number> = {
  ' ': 278, // no-break space
  '–': 556,
  '—': 1000,
  '−': 584, // minus sign (Arial; the PDF draws it as an en dash)
  '×': 584,
  '÷': 584,
  '·': 278,
  '…': 1000,
  '‘': 222,
  '’': 222,
  '“': 333,
  '”': 333,
};

/** Fallbacks for glyphs we have no metrics for (Latin letters average ≈ 0.55 em, so these are generous). */
const FALLBACK_REGULAR = 600;
const FALLBACK_BOLD = 650;
const WIDE = 1000;
/** Real fonts and renderers differ slightly (hinting, Segoe UI fallback): keep a small margin. */
export const TEXT_SAFETY = 1.03;

/** CJK, Hangul, full-width forms and emoji take a full em. */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  );
}

function knownWidth(ch: string, bold: boolean): number | undefined {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 32 && cp <= 126) return (bold ? BOLD_ASCII : REGULAR_ASCII)[cp - 32];
  return SYMBOLS[ch];
}

/** Advance width of one character in 1/1000 em (accented letters use their base letter). */
export function glyphWidth(ch: string, bold = false): number {
  const known = knownWidth(ch, bold);
  if (known !== undefined) return known;
  const base = ch.normalize('NFD')[0];
  if (base !== ch) {
    const baseWidth = knownWidth(base, bold);
    if (baseWidth !== undefined) return baseWidth;
  }
  if (isWide(ch.codePointAt(0) ?? 0)) return WIDE;
  // Combining marks and zero-width characters do not advance.
  if (/\p{M}|\p{Cf}/u.test(ch)) return 0;
  return bold ? FALLBACK_BOLD : FALLBACK_REGULAR;
}

/** Exact advance width of `text` at font size `fs` (same unit as fs), e.g. to place runs one after another. */
export function advanceWidth(text: string, fs: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += glyphWidth(ch, bold);
  return (units / 1000) * fs;
}

/** Width of `text` at font size `fs` including the safety margin: use this for fitting text into a space. */
export function textWidth(text: string, fs: number, bold = false): number {
  return advanceWidth(text, fs, bold) * TEXT_SAFETY;
}
