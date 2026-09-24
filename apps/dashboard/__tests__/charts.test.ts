import { niceCountMax, niceDurationMax, niceMax } from '@/components/charts/chart-frame';

describe('axis scales', () => {
  it('keeps count axes even so the half tick is a whole number', () => {
    for (const n of [1, 2, 3, 5, 7, 9, 13, 47, 380]) {
      const max = niceCountMax(n);
      expect(max).toBeGreaterThanOrEqual(n);
      expect(Number.isInteger(max / 2)).toBe(true);
    }
  });

  it('snaps durations to maxima whose half is a round duration', () => {
    expect(niceDurationMax(45)).toBe(60);
    expect(niceDurationMax(234)).toBe(240);
    expect(niceDurationMax(3000)).toBe(3600);
  });

  it('rounds general maxima up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
  });
});
