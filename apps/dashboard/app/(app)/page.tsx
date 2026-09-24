'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';
import { IncidentRegister } from '@/components/incident/incident-register';
import {
  EmptyState,
  ErrorNote,
  PageTitle,
  SheetHeading,
  SkeletonRows,
  TitleBlock,
} from '@/components/ui/blocks';
import { duration, pct } from '@/lib/format';
import type { Analytics, Integration, Page, IncidentSummary } from '@/lib/types';

function Register({
  title,
  query,
  empty,
  more,
}: {
  title: string;
  query: string;
  empty: React.ReactNode;
  more?: string;
}) {
  const { data, error, mutate } = useSWR<Page<IncidentSummary>>(`/incidents?${query}`);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <SheetHeading
        title={title}
        aside={
          data && data.total > data.items.length && more ? (
            <Link
              href={more}
              className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
            >
              All {data.total} <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Link>
          ) : data ? (
            <span className="text-sm text-ink-3">{data.total}</span>
          ) : null
        }
      />
      {error ? (
        <ErrorNote error={error} retry={() => void mutate()} />
      ) : !data ? (
        <SkeletonRows rows={3} />
      ) : data.items.length === 0 ? (
        <p className="py-3 text-base text-ink-3">{empty}</p>
      ) : (
        <IncidentRegister incidents={data.items} />
      )}
    </section>
  );
}

// The board: the drawing register of every sheet that's open, sorted by
// who needs to act — you first, then SRE.ai, then what just closed.
export default function BoardPage() {
  const { data: workspace } = useSWR<{ name: string }>('/settings');
  const { data: analytics } = useSWR<Analytics>('/analytics/overview?days=7');
  const { data: integrations } = useSWR<Integration[]>('/integrations');
  const setUp = integrations === undefined || integrations.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageTitle
        title="Board"
        description="Every open incident sheet, ordered by who needs to act."
      />

      {!setUp ? (
        <EmptyState
          title="No alerts can reach SRE.ai yet"
          action={
            <Link
              href="/onboarding"
              className="inline-flex h-9 items-center gap-2 rounded border border-ink bg-ink px-3.5 text-sm font-medium text-sheet hover:bg-ink/90"
            >
              Connect your first alert source <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          }
        >
          Point Prometheus, Grafana, Sentry or CloudWatch at SRE.ai and send a test alert — you’ll
          watch it get diagnosed with cited evidence in about a minute.
        </EmptyState>
      ) : null}

      <TitleBlock
        cells={[
          { label: 'Workspace', value: workspace?.name ?? '—' },
          { label: 'Open now', value: analytics ? analytics.totals.open : '—' },
          { label: 'Incidents · 7d', value: analytics ? analytics.totals.incidents : '—' },
          {
            label: 'Avg time to resolve · 7d',
            value: analytics ? duration(analytics.totals.avgMttrSeconds) : '—',
          },
          {
            label: 'Fixed without a human · 7d',
            value: analytics ? pct(analytics.autoResolve.rate) : '—',
          },
          {
            label: 'Citations verified · 7d',
            value: analytics ? pct(analytics.citationPassRate) : '—',
          },
        ]}
      />

      <Register
        title="Needs you"
        query="status=escalated&pageSize=10"
        more="/incidents?status=escalated"
        empty="Nothing is waiting on a human. Approvals and escalations land here first."
      />
      <Register
        title="SRE.ai is on it"
        query="status=detecting,diagnosing,acting&pageSize=10"
        more="/incidents?status=detecting,diagnosing,acting"
        empty="No incidents in progress."
      />
      <Register
        title="Recently resolved"
        query="status=resolved&pageSize=6"
        more="/incidents?status=resolved"
        empty="No resolved incidents yet."
      />
    </div>
  );
}
