import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { advanceWidth, glyphWidth, TEXT_SAFETY, textWidth } from './textMetrics';

describe('glyphWidth', () => {
  it('agrees with the Helvetica metrics bundled in jsPDF (which are rounded to 10 units)', () => {
    const doc = new jsPDF({ unit: 'mm' });
    const chars = [...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), '–', '÷', '·', 'é'];
    for (const bold of [false, true]) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      for (const ch of chars) {
        const pdfWidth = doc.getStringUnitWidth(ch) * 1000;
        expect(Math.abs(glyphWidth(ch, bold) - pdfWidth), `${ch} bold=${bold}`).toBeLessThanOrEqual(7);
      }
    }
  });

  it('uses base letters for accents, a full em for CJK and nothing for combining marks', () => {
    expect(glyphWidth('ů')).toBe(glyphWidth('u'));
    expect(glyphWidth('猫')).toBe(1000);
    expect(glyphWidth('́')).toBe(0);
  });
});

describe('textWidth', () => {
  it('scales with font size and includes the safety margin', () => {
    expect(advanceWidth('10', 4)).toBeCloseTo(2 * 0.556 * 4);
    expect(textWidth('10', 4)).toBeCloseTo(2 * 0.556 * 4 * TEXT_SAFETY);
    expect(textWidth('White', 10, true)).toBeGreaterThan(textWidth('White', 10));
  });

  it('measures commas and spaces narrower than digits', () => {
    expect(textWidth('1, 2', 1)).toBeLessThan(textWidth('1234', 1));
  });
});
