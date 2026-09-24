import { CircleCheck, CircleDashed, Radar, Siren, Wrench, type LucideIcon } from 'lucide-react';
import { STATUS_LABEL } from '@/lib/format';
import type { IncidentStatus, Severity } from '@/lib/types';
import { cx } from './cx';

const STATUS: Record<IncidentStatus, { icon: LucideIcon; tone: string }> = {
  detecting: { icon: CircleDashed, tone: 'text-ink-2 border-ink-2/50' },
  diagnosing: { icon: Radar, tone: 'text-cyan border-cyan/60' },
  acting: { icon: Wrench, tone: 'text-cyan border-cyan/60' },
  escalated: { icon: Siren, tone: 'text-signal border-signal/70' },
  resolved: { icon: CircleCheck, tone: 'text-ok border-ok/60' },
};

// A rubber stamp: icon + word in a ruled box. State is never colour alone.
export function StatusStamp({ status, className }: { status: IncidentStatus; className?: string }) {
  const { icon: Icon, tone } = STATUS[status];
  const live = status === 'detecting' || status === 'diagnosing';
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1.5 rounded-sm border px-1.5 text-xs font-semibold uppercase tracking-[0.05em] condensed',
        tone,
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cx('h-3.5 w-3.5', live && 'animate-[spin_3s_linear_infinite]')}
        strokeWidth={2}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

// Severity: P1 is a filled signal block (it pages people), P2 an outlined
// block, P3 a hairline — readable in monochrome.
export function SeverityMark({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-sm px-1.5 text-xs font-bold tracking-[0.04em] condensed',
        severity === 'p1' && 'bg-signal text-signal-ink',
        severity === 'p2' && 'border-2 border-ink/70 text-ink',
        severity === 'p3' && 'border border-dashed border-ink/50 text-ink-2',
        className,
      )}
      aria-label={`Severity ${severity.toUpperCase()}`}
    >
      {severity.toUpperCase()}
    </span>
  );
}

export function LiveDot({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3" role="status">
      <span
        aria-hidden
        className={cx(
          'h-1.5 w-1.5 rounded-full',
          connected ? 'bg-ok shadow-[0_0_0_3px_rgb(var(--ok)/0.2)]' : 'bg-ink-3',
        )}
      />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  );
}
