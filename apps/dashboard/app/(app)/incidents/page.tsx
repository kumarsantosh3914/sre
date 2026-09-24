'use client';

import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import useSWR from 'swr';
import { IncidentRegister } from '@/components/incident/incident-register';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, PageTitle, SkeletonRows } from '@/components/ui/blocks';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/field';
import { STATUS_LABEL } from '@/lib/format';
import type { IncidentStatus, Page, IncidentSummary, Severity } from '@/lib/types';

const STATUSES: IncidentStatus[] = ['detecting', 'diagnosing', 'acting', 'escalated', 'resolved'];
const SEVERITIES: Severity[] = ['p1', 'p2', 'p3'];

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'h-8 rounded-sm border px-2.5 text-sm transition-colors duration-150',
        on
          ? 'border-ink bg-ink text-sheet'
          : 'rule-strong text-ink-2 hover:bg-ink/[0.06] hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

function IncidentsList() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = (params.get('status') ?? '').split(',').filter(Boolean) as IncidentStatus[];
  const severity = (params.get('severity') ?? '').split(',').filter(Boolean) as Severity[];
  const page = Number(params.get('page') ?? '1');
  const [search, setSearch] = useState(params.get('search') ?? '');

  const update = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== search) update({ search: search || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggle = <T extends string>(list: T[], value: T): string | null => {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    return next.length ? next.join(',') : null;
  };

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status.length) query.set('status', status.join(','));
  if (severity.length) query.set('severity', severity.join(','));
  if (params.get('search')) query.set('search', params.get('search') as string);
  const { data, error, mutate } = useSWR<Page<IncidentSummary>>(`/incidents?${query.toString()}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title="Incidents"
        description="Every incident sheet, newest first. Storm-grouped alerts are folded into their storm."
      />

      <div className="flex flex-col gap-3 border-b rule-strong pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <Chip
              key={s}
              on={status.includes(s)}
              onClick={() => update({ status: toggle(status, s) })}
            >
              {STATUS_LABEL[s]}
            </Chip>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px bg-ink/20" />
          {SEVERITIES.map((s) => (
            <Chip
              key={s}
              on={severity.includes(s)}
              onClick={() => update({ severity: toggle(severity, s) })}
            >
              {s.toUpperCase()}
            </Chip>
          ))}
        </div>
        <label className="relative w-full lg:w-72">
          <span className="sr-only">Search incident titles</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-3"
          />
          <Input
            type="search"
            placeholder="Search titles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </label>
      </div>

      {error ? (
        <ErrorNote error={error} retry={() => void mutate()} />
      ) : !data ? (
        <SkeletonRows rows={8} />
      ) : data.items.length === 0 ? (
        status.length || severity.length || params.get('search') ? (
          <EmptyState
            title="No incidents match these filters"
            action={
              <Button
                onClick={() => {
                  setSearch('');
                  router.replace(pathname);
                }}
              >
                Clear filters
              </Button>
            }
          >
            Try fewer filters, or search a different part of the alert title.
          </EmptyState>
        ) : (
          <EmptyState title="No incidents yet">
            When an alert fires, its sheet appears here with a cited diagnosis. Send a test alert
            from Integrations to see one now.
          </EmptyState>
        )
      ) : (
        <>
          <IncidentRegister incidents={data.items} />
          <nav aria-label="Pagination" className="flex items-center justify-between">
            <p className="text-sm text-ink-3">
              {data.total} incident{data.total === 1 ? '' : 's'} · page {page} of {pages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
                icon={<ChevronLeft aria-hidden className="h-4 w-4" />}
              >
                Newer
              </Button>
              <Button
                size="sm"
                disabled={page >= pages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Older <ChevronRight aria-hidden className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense>
      <IncidentsList />
    </Suspense>
  );
}
