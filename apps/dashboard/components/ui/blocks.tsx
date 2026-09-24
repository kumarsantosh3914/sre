import type { ReactNode } from 'react';
import { cx } from './cx';

export interface Cell {
  label: string;
  value: ReactNode;
  className?: string;
}

// The drawing's title block: ruled cells, lettered labels, values at
// reading size. Used for every at-a-glance summary instead of stat cards.
export function TitleBlock({ cells, className }: { cells: Cell[]; className?: string }) {
  return (
    <dl
      className={cx(
        'grid border-l border-t rule-strong',
        'grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]',
        className,
      )}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cx(
            'flex min-w-0 flex-col gap-1 border-b border-r rule-strong px-3 py-2',
            // An odd last cell spans the phone's two columns instead of
            // leaving a half-open row.
            cells.length % 2 === 1 && i === cells.length - 1 && 'col-span-2 sm:col-span-1',
            c.className,
          )}
        >
          <dt className="lettering">{c.label}</dt>
          <dd className="truncate text-md font-medium text-ink">{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Section heading inside a sheet: a rule with the title set into it.
export function SheetHeading({
  title,
  aside,
  id,
}: {
  title: string;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4 border-b rule-strong pb-2">
      <h2 id={id} className="text-md font-semibold tracking-[-0.01em] text-ink">
        {title}
      </h2>
      {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
    </div>
  );
}

export function PageTitle({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1
          className="text-2xl font-semibold tracking-[-0.025em] text-ink"
          style={{ textWrap: 'balance' }}
        >
          {title}
        </h1>
        {description ? <p className="measure text-base text-ink-2">{description}</p> : null}
        {meta ? <div className="mt-1 flex flex-wrap items-center gap-3">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'block rounded-sm bg-ink/10 animate-[skeleton_1.6s_ease-in-out_infinite]',
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b rule py-3">
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

// Empty states teach: what this place is for and the one thing to do next.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border border-dashed rule-strong px-5 py-6">
      <p className="text-md font-semibold text-ink">{title}</p>
      <div className="measure text-base text-ink-2">{children}</div>
      {action}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border border-fault/50 bg-fault/[0.06] px-4 py-3 text-base text-ink"
    >
      <span className="font-semibold text-fault">Couldn’t load this.</span>
      <span className="text-ink-2">{message}</span>
      {retry ? (
        <button type="button" onClick={retry} className="text-sm font-medium text-ink underline">
          Try again
        </button>
      ) : null}
    </div>
  );
}
