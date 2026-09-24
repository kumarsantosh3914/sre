import { DigestStats } from './digest.builder';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function minutes(seconds: number | null): string {
  return seconds === null ? '—' : `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function mttrTrend(stats: DigestStats): string {
  const { avgMttrSeconds: now, previousAvgMttrSeconds: before } = stats;
  if (now === null || before === null || before === 0) return '';
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return 'flat vs the day before';
  return `${change < 0 ? '↓' : '↑'} ${Math.abs(change)}% vs the day before`;
}

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
}

// Plain, table-based HTML with inline styles: renders the same in Gmail,
// Outlook and on a phone.
export function renderDigest(
  tenantName: string,
  stats: DigestStats,
  dashboardUrl?: string,
): DigestContent {
  const quiet = stats.opened.total === 0;
  const subject = quiet
    ? `SRE.ai daily digest — a quiet day for ${tenantName}`
    : `SRE.ai daily digest — ${stats.opened.total} incident${stats.opened.total === 1 ? '' : 's'}, ${stats.resolved} resolved`;

  const rows: [string, string][] = [
    [
      'Incidents opened',
      `${stats.opened.total} (P1 ${stats.opened.p1} · P2 ${stats.opened.p2} · P3 ${stats.opened.p3})`,
    ],
    ['Resolved', String(stats.resolved)],
    ['Fixed automatically', String(stats.autoExecuted)],
    ['Escalated to a human', String(stats.escalations)],
    ['Average time to resolve', `${minutes(stats.avgMttrSeconds)} ${mttrTrend(stats)}`.trim()],
    ['Still open', String(stats.openNow)],
  ];
  if (stats.topRecurring) {
    rows.push([
      'Top recurring issue',
      `${stats.topRecurring.title} (${stats.topRecurring.occurrences}× this week)`,
    ]);
  }

  const text = [
    subject,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(dashboardUrl ? ['', `Open the dashboard: ${dashboardUrl}`] : []),
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2024">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e3e6ea">
<tr><td style="padding:24px 24px 8px"><div style="font-size:13px;color:#60646c">SRE.ai · ${escapeHtml(tenantName)}</div>
<h1 style="margin:6px 0 0;font-size:20px;line-height:1.3">${quiet ? 'A quiet day.' : 'Your last 24 hours'}</h1></td></tr>
<tr><td style="padding:8px 24px 16px"><table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:10px 0;border-bottom:1px solid #eef0f2;color:#60646c">${escapeHtml(k)}</td><td style="padding:10px 0;border-bottom:1px solid #eef0f2;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`,
  )
  .join('\n')}
</table></td></tr>
${dashboardUrl ? `<tr><td style="padding:0 24px 24px"><a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#1c2024;color:#ffffff;border-radius:6px;text-decoration:none;font-size:14px">Open dashboard</a></td></tr>` : ''}
</table></body></html>`;

  return { subject, text, html };
}
