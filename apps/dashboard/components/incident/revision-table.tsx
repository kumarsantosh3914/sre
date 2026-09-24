import { actor, stamp } from '@/lib/format';
import type { AuditEvent } from '@/lib/types';

const LABELS: Record<string, string> = {
  'incident.created': 'Alert received — incident opened',
  'incident.storm_opened': 'Alert storm — alerts grouped into this incident',
  'incident.status_changed': 'Status changed',
  'diagnosis.completed': 'Diagnosis completed',
  'diagnosis.failed': 'Automated diagnosis failed',
  'action.started': 'Action started',
  'action.approval_requested': 'Approval requested',
  'action.approved': 'Action approved',
  'action.rejected': 'Action rejected',
  'action.expired': 'Approval expired',
  'action.executed': 'Action executed',
  'action.failed': 'Action failed',
  'action.refused': 'Action refused',
  'action.rolled_back': 'Action rolled back',
  'action.rollback_failed': 'Rollback failed',
  'action.rollback_refused': 'Rollback refused',
  'incident.escalated': 'Escalated to on-call',
  'incident.resolved': 'Resolved',
  'escalation.undeliverable': 'Escalation could not be delivered',
};

function detail(e: AuditEvent): string | null {
  const m = e.metadata;
  if (typeof m.reason === 'string') return m.reason;
  if (typeof m.description === 'string') return m.description;
  if (typeof m.error === 'string') return m.error;
  if (e.event === 'diagnosis.completed' && e.after) {
    const c = e.after.confidence;
    return typeof c === 'number'
      ? `Confidence ${Math.round(c * 100)}%, tier ${String(e.after.tier)}`
      : null;
  }
  if (e.after && typeof e.after.status === 'string' && e.event === 'incident.status_changed')
    return `→ ${e.after.status}`;
  if (typeof m.via === 'string') return m.via;
  return null;
}

// The drawing's revision table: every change to this incident, in order,
// with who made it. Straight from the append-only audit log.
export function RevisionTable({
  events,
  names = {},
}: {
  events: AuditEvent[];
  names?: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b rule-strong">
            <th scope="col" className="lettering w-12 py-2 pr-3 font-medium">
              Rev
            </th>
            <th scope="col" className="lettering hidden w-40 py-2 pr-3 font-medium sm:table-cell">
              When
            </th>
            <th scope="col" className="lettering py-2 pr-3 font-medium">
              Change
            </th>
            <th scope="col" className="lettering hidden w-28 py-2 font-medium sm:table-cell">
              By
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => {
            const d = detail(e);
            const by =
              e.actorType === 'system'
                ? 'SRE.ai'
                : actor(`${e.actorType}:${e.actorId ?? ''}`, names);
            return (
              <tr key={e.id} className="border-b rule align-top">
                <td className="py-2.5 pr-3 font-mono text-xs text-ink-3">
                  {String.fromCharCode(65 + (i % 26))}
                  {i >= 26 ? Math.floor(i / 26) : ''}
                </td>
                <td className="hidden py-2.5 pr-3 text-sm tabular-nums text-ink-2 sm:table-cell">
                  {stamp(e.at)}
                </td>
                <td className="py-2.5 pr-3 text-base text-ink">
                  {LABELS[e.event] ?? e.event}
                  {d ? <span className="block break-words text-sm text-ink-2">{d}</span> : null}
                  {/* Phone: when and who fold under the change instead of their own columns. */}
                  <span className="block text-xs tabular-nums text-ink-3 sm:hidden">
                    {stamp(e.at)} · {by}
                  </span>
                </td>
                <td className="hidden py-2.5 text-sm text-ink-2 sm:table-cell">{by}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
