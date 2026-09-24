import { IncidentSeverity } from '@sreai/shared';
import { isInSilenceWindow, shouldPage } from './silence';

describe('silence windows', () => {
  const nights = [{ days: [1, 2, 3, 4, 5], start: '22:00', end: '07:00' }];

  it('handles windows that cross midnight in the tenant timezone', () => {
    // Tue 23:30 IST (18:00 UTC) — inside Tuesday's window.
    expect(isInSilenceWindow(new Date('2026-09-15T18:00:00Z'), 'Asia/Kolkata', nights)).toBe(true);
    // Wed 03:00 IST — after midnight, belongs to Tuesday's window.
    expect(isInSilenceWindow(new Date('2026-09-15T21:30:00Z'), 'Asia/Kolkata', nights)).toBe(true);
    // Wed 12:00 IST — outside.
    expect(isInSilenceWindow(new Date('2026-09-16T06:30:00Z'), 'Asia/Kolkata', nights)).toBe(false);
    // Sat 01:00 IST — Friday's window covers it.
    expect(isInSilenceWindow(new Date('2026-09-18T19:30:00Z'), 'Asia/Kolkata', nights)).toBe(true);
    // Sun 01:00 IST — Saturday isn't in the window.
    expect(isInSilenceWindow(new Date('2026-09-19T19:30:00Z'), 'Asia/Kolkata', nights)).toBe(false);
  });

  it('always pages for P1', () => {
    const at = new Date('2026-09-15T18:00:00Z');
    expect(shouldPage(IncidentSeverity.P1, at, 'Asia/Kolkata', nights)).toBe(true);
    expect(shouldPage(IncidentSeverity.P2, at, 'Asia/Kolkata', nights)).toBe(false);
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(isInSilenceWindow(new Date('2026-09-15T23:00:00Z'), 'Not/AZone', nights)).toBe(true);
  });
});
