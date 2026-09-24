import { DigestStats } from './digest.builder';
import { localDateAndHour } from './digest.scheduler';
import { escapeHtml, mttrTrend, renderDigest } from './digest.template';

const stats: DigestStats = {
  windowStart: new Date('2026-09-14T03:30:00Z'),
  windowEnd: new Date('2026-09-15T03:30:00Z'),
  opened: { total: 4, p1: 1, p2: 2, p3: 1 },
  resolved: 3,
  autoExecuted: 2,
  escalations: 1,
  avgMttrSeconds: 240,
  previousAvgMttrSeconds: 480,
  openNow: 1,
  topRecurring: { title: 'HighCPU <b>', occurrences: 3 },
};

describe('digest', () => {
  it('renders subject, stats and an MTTR trend, escaping incident text', () => {
    const digest = renderDigest('Acme', stats, 'https://app.sre.ai');
    expect(digest.subject).toBe('SRE.ai daily digest — 4 incidents, 3 resolved');
    expect(digest.text).toContain('Average time to resolve: 4 min ↓ 50% vs the day before');
    expect(digest.html).toContain('HighCPU &lt;b&gt;');
    expect(digest.html).not.toContain('<b>');
  });

  it('calls out quiet days', () => {
    expect(
      renderDigest('Acme', { ...stats, opened: { total: 0, p1: 0, p2: 0, p3: 0 } }).subject,
    ).toContain('quiet day');
  });

  it('handles missing MTTR baselines', () => {
    expect(mttrTrend({ ...stats, previousAvgMttrSeconds: null })).toBe('');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('computes the local date and hour in the tenant timezone', () => {
    expect(localDateAndHour(new Date('2026-09-15T03:35:00Z'), 'Asia/Kolkata')).toEqual({
      date: '2026-09-15',
      hour: 9,
    });
    expect(localDateAndHour(new Date('2026-09-15T03:35:00Z'), 'America/Los_Angeles')).toEqual({
      date: '2026-09-14',
      hour: 20,
    });
    expect(localDateAndHour(new Date('2026-09-15T03:35:00Z'), 'Bad/Zone')).toEqual({
      date: '2026-09-15',
      hour: 3,
    });
  });
});
