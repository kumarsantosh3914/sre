import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { ago, duration, pct, sheetNo } from '@/lib/format';
import type { IncidentSummary } from '@/lib/types';
import { cx } from '../ui/cx';
import { SeverityMark, StatusStamp } from '../ui/marks';

// The drawing register: one row per incident sheet. Rows are links; the
// whole row is the target, the title is the accessible name.
export function IncidentRegister({
  incidents,
  compact,
}: {
  incidents: IncidentSummary[];
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead className="sr-only sm:not-sr-only">
          <tr className="border-b rule-strong">
            <th scope="col" className="lettering w-14 py-2 pr-3 font-medium">
              Sev
            </th>
            <th scope="col" className="lettering py-2 pr-3 font-medium">
              Incident
            </th>
            <th scope="col" className="lettering hidden w-36 py-2 pr-3 font-medium md:table-cell">
              Status
            </th>
            {!compact ? (
              <th scope="col" className="lettering hidden w-28 py-2 pr-3 font-medium lg:table-cell">
                Confidence
              </th>
            ) : null}
            <th scope="col" className="lettering w-28 py-2 text-right font-medium">
              {compact ? 'Opened' : 'Opened / MTTR'}
            </th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr
              key={i.id}
              className="group relative border-b rule transition-colors duration-150 hover:bg-ink/[0.04]"
            >
              <td className="py-3 pr-3 align-top">
                <SeverityMark severity={i.severity} />
              </td>
              <td className="min-w-0 py-3 pr-3 align-top">
                <Link
                  href={`/incidents/${i.id}`}
                  className="font-medium text-ink after:absolute after:inset-0 focus-visible:outline-none group-focus-within:underline"
                >
                  {i.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
                  <span className="font-mono text-xs">{sheetNo(i.id)}</span>
                  <span>{i.service?.name ?? 'unknown service'}</span>
                  {i.alertCount > 1 ? <span>{i.alertCount} alerts</span> : null}
                  <StatusStamp status={i.status} className="md:hidden" />
                </div>
              </td>
              <td className="hidden py-3 pr-3 align-top md:table-cell">
                <StatusStamp status={i.status} />
              </td>
              {!compact ? (
                <td className="hidden py-3 pr-3 align-top lg:table-cell">
                  {i.diagnosis ? (
                    <span
                      className={cx(
                        'inline-flex items-center gap-1 font-mono text-sm',
                        i.diagnosis.citationsPassed ? 'text-ink' : 'text-fault',
                      )}
                    >
                      {pct(i.diagnosis.confidence)}
                      {i.diagnosis.citationsPassed ? null : (
                        <>
                          <CircleAlert aria-hidden className="h-3.5 w-3.5" />
                          <span className="sr-only">citations failed verification</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-ink-3">—</span>
                  )}
                </td>
              ) : null}
              <td className="py-3 text-right align-top text-sm tabular-nums text-ink-2">
                <span className="block">{ago(i.detectedAt)}</span>
                {!compact && i.mttrSeconds !== null ? (
                  <span className="block text-ink-3">{duration(i.mttrSeconds)}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
