'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../ui/cx';

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export interface LegendItem {
  label: string;
  color: string;
}

// Every chart: title, one-line subtitle, legend when there are 2+
// series, and a table view so no value is gated behind hover or colour.
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={cx('flex min-w-0 flex-col gap-3', className)}>
      <figcaption className="flex flex-wrap items-start justify-between gap-2 border-b rule-strong pb-2">
        <div>
          <p className="text-md font-semibold text-ink">{title}</p>
          {subtitle ? <p className="text-sm text-ink-3">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((t) => !t)}
          aria-pressed={asTable}
          className="text-sm text-ink-2 underline hover:text-ink"
        >
          {asTable ? 'Show chart' : 'Show table'}
        </button>
      </figcaption>
      {legend && legend.length > 1 && !asTable ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-sm text-ink-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ background: l.color }}
              />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {asTable ? <div className="overflow-x-auto">{table}</div> : children}
    </figure>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b rule-strong">
          {head.map((h, i) => (
            <th
              key={h}
              scope="col"
              className={cx('lettering py-1.5 pr-3 font-medium', i > 0 && 'text-right')}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b rule">
            {r.map((c, j) => (
              <td
                key={j}
                className={cx(
                  'py-1.5 pr-3 text-sm tabular-nums',
                  j === 0 ? 'text-ink' : 'text-right text-ink-2',
                )}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border rule-strong bg-sheet px-2.5 py-1.5 text-sm text-ink shadow-[0_6px_18px_-8px_rgb(0_0_0/0.45)]"
      style={{ left, top: y - 10 }}
    >
      {children}
    </div>
  );
}

export const SERIES = {
  p1: 'rgb(var(--series-1))',
  p2: 'rgb(var(--series-2))',
  p3: 'rgb(var(--series-3))',
};

// Axes tick at 0, half and max, so a count axis needs an even max or the
// half tick lands on a fraction (and rounds into a duplicate label).
export function niceCountMax(max: number): number {
  if (max <= 2) return 2;
  if (max <= 4) return 4;
  if (max <= 6) return 6;
  if (max <= 10) return 10;
  return niceMax(max);
}

// Seconds: maxima whose half is also a round duration (1m/30s … 2d/1d).
const DURATION_STEPS = [60, 120, 240, 600, 1200, 1800, 3600, 7200, 14400, 28800, 86400, 172800];

export function niceDurationMax(seconds: number): number {
  return DURATION_STEPS.find((s) => s >= seconds) ?? niceMax(seconds);
}

export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
