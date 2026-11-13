import { describe, expect, it } from 'vitest';
import { sortLegendForDisplay } from './legendOrder';

const legend = [
  { colorId: 'white', min: 7, max: 10, values: [8, 10] },
  { colorId: 'red', min: 3, max: 6, values: [3, 5] },
  { colorId: 'pink', min: 0, max: 2, values: [11, 12] },
];

describe('sortLegendForDisplay', () => {
  it('orders ranges by their lower bound', () => {
    expect(sortLegendForDisplay(legend, 'range').map((e) => e.colorId)).toEqual(['pink', 'red', 'white']);
  });

  it('orders exact values by the smallest value', () => {
    expect(sortLegendForDisplay(legend, 'value').map((e) => e.colorId)).toEqual(['red', 'white', 'pink']);
  });

  it('does not change the input', () => {
    sortLegendForDisplay(legend, 'range');
    expect(legend[0].colorId).toBe('white');
  });
});
