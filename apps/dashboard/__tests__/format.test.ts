import { actor, ago, duration, pct, sheetNo } from '@/lib/format';

describe('format', () => {
  it('formats durations at each scale', () => {
    expect(duration(null)).toBe('—');
    expect(duration(42)).toBe('42s');
    expect(duration(234)).toBe('3m 54s');
    expect(duration(3 * 3600 + 5 * 60)).toBe('3h 05m');
  });

  it('formats ratios as whole percentages and keeps missing values visible', () => {
    expect(pct(0.853)).toBe('85%');
    expect(pct(0)).toBe('0%');
    expect(pct(undefined)).toBe('—');
  });

  it('reports recent times as "just now" and older ones relatively', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    expect(ago('2026-01-01T11:59:30Z', now)).toBe('just now');
    expect(ago('2026-01-01T11:50:00Z', now)).toMatch(/10 min/);
    expect(ago(null, now)).toBe('—');
  });

  it('derives the sheet number from the incident id', () => {
    expect(sheetNo('9988fa73-1bfe-4466')).toBe('SH-9988');
  });

  it('names actors without exposing raw ids for teammates', () => {
    expect(actor('system')).toBe('SRE.ai');
    expect(actor(null)).toBe('SRE.ai');
    expect(actor('slack:U123')).toBe('Slack U123');
    expect(actor('user:5f1c')).toBe('Teammate');
  });
});
