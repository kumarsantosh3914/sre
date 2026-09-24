import { SOURCE_LABEL } from '@/lib/format';
import type { CollectorReport, Scoring } from '@/lib/types';
import { cx } from '../ui/cx';

const STATUS: Record<CollectorReport['status'], { label: string; tone: string }> = {
  ok: { label: 'Collected', tone: 'text-ok' },
  empty: { label: 'Nothing found', tone: 'text-ink-2' },
  not_configured: { label: 'Not connected', tone: 'text-ink-3' },
  error: { label: 'Failed', tone: 'text-fault' },
  timeout: { label: 'Timed out', tone: 'text-fault' },
};

// What SRE.ai looked at before diagnosing — missing context is as
// important to the reader as the context that was there.
export function CollectorReportTable({ collectors }: { collectors: CollectorReport[] }) {
  return (
    <ul className="flex flex-col">
      {collectors.map((c) => (
        <li
          key={c.source}
          className="grid grid-cols-[7.5rem_1fr_auto] items-baseline gap-3 border-b rule py-2"
        >
          <span className="text-base text-ink">{SOURCE_LABEL[c.source] ?? c.source}</span>
          <span className="min-w-0 truncate text-sm text-ink-3" title={c.note}>
            {c.status === 'ok' ? `${c.lines} line${c.lines === 1 ? '' : 's'}` : (c.note ?? '')}
          </span>
          <span className={cx('text-sm font-medium', STATUS[c.status].tone)}>
            {STATUS[c.status].label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ScoringBreakdown({ scoring }: { scoring: Scoring }) {
  return (
    <table className="w-full border-collapse text-left">
      <tbody>
        <tr className="border-b rule">
          <td className="py-2 text-base text-ink">Model’s own confidence</td>
          <td className="py-2 text-right font-mono text-sm text-ink">
            {Math.round(scoring.llmConfidence * 100)}%
          </td>
        </tr>
        {scoring.adjustments.map((a) => (
          <tr key={a.reason} className="border-b rule">
            <td className="py-2 text-sm text-ink-2">{a.reason}</td>
            <td className="py-2 text-right font-mono text-xs text-ink-2">{a.effect}</td>
          </tr>
        ))}
        <tr>
          <td className="py-2 text-base font-semibold text-ink">Verified confidence</td>
          <td className="py-2 text-right font-mono text-sm font-semibold text-ink">
            {Math.round(scoring.final * 100)}%
          </td>
        </tr>
      </tbody>
    </table>
  );
}
