'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { ChartFrame, DataTable, SERIES, niceDurationMax } from '@/components/charts/chart-frame';
import { HBars, Histogram, LineChart, StackedColumns } from '@/components/charts/charts';
import {
  EmptyState,
  ErrorNote,
  PageTitle,
  SheetHeading,
  Skeleton,
  TitleBlock,
} from '@/components/ui/blocks';
import { cx } from '@/components/ui/cx';
import { TIER_LABEL, duration, pct } from '@/lib/format';
import type { Analytics, TenantSettings } from '@/lib/types';

const WINDOWS = [7, 30, 90];

// Fill missing days so time axes are continuous (a quiet day is data).
function days(windowDays: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function AnalyticsPage() {
  const [window, setWindow] = useState(30);
  const { data, error, mutate } = useSWR<Analytics>(`/analytics/overview?days=${window}`);
  const { data: settings } = useSWR<{ settings: TenantSettings }>('/settings');
  const auto = settings?.settings.autoThreshold ?? 0.85;
  const draft = settings?.settings.draftThreshold ?? 0.6;

  const range = (
    <div role="group" aria-label="Time range" className="flex border rule-strong">
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={window === w}
          onClick={() => setWindow(w)}
          className={cx(
            'h-8 px-3 text-sm',
            window === w ? 'bg-ink text-sheet' : 'text-ink-2 hover:text-ink',
          )}
        >
          {w} days
        </button>
      ))}
    </div>
  );

  if (error) return <ErrorNote error={error} retry={() => void mutate()} />;

  const severityRows = data
    ? days(window).map((d) => {
        const r = data.incidentsBySeverity.find((x) => x.day === d);
        return { x: d, p1: r?.p1 ?? 0, p2: r?.p2 ?? 0, p3: r?.p3 ?? 0 };
      })
    : [];
  const mttrPoints = data ? data.mttrTrend.map((r) => ({ x: r.day, y: r.avgMttrSeconds })) : [];

  return (
    <div className="flex flex-col gap-8">
      <PageTitle
        title="Analytics"
        description="Is SRE.ai actually making incidents shorter — and can you trust its diagnoses?"
        actions={range}
      />

      {!data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : data.totals.incidents === 0 ? (
        <EmptyState title={`No incidents in the last ${window} days`}>
          Analytics fill in as incidents are diagnosed and resolved. A quiet stretch is good news.
        </EmptyState>
      ) : (
        <>
          <TitleBlock
            cells={[
              { label: 'Incidents', value: data.totals.incidents },
              { label: 'Avg time to resolve', value: duration(data.totals.avgMttrSeconds) },
              {
                label: 'Fixed without a human',
                value: data.autoResolve.resolved
                  ? `${pct(data.autoResolve.rate)} · ${data.autoResolve.autoResolved}/${data.autoResolve.resolved}`
                  : '—',
              },
              { label: 'Citations verified', value: pct(data.citationPassRate) },
              { label: 'Escalated', value: data.totals.escalated },
              { label: 'Still open', value: data.totals.open },
            ]}
          />

          <div className="grid gap-8 xl:grid-cols-2">
            <ChartFrame
              title="Time to resolve"
              subtitle="Average MTTR of incidents resolved each day"
              table={
                <DataTable
                  head={['Day', 'Avg MTTR', 'Resolved']}
                  rows={data.mttrTrend.map((r) => [r.day, duration(r.avgMttrSeconds), r.resolved])}
                />
              }
            >
              {mttrPoints.length ? (
                <LineChart
                  points={mttrPoints}
                  format={(v) => duration(Math.round(v))}
                  scale={niceDurationMax}
                  label="Average time to resolve per day"
                />
              ) : (
                <p className="py-8 text-base text-ink-3">No resolutions in this window yet.</p>
              )}
            </ChartFrame>

            <ChartFrame
              title="Incidents by severity"
              subtitle="Opened per day; storms count once"
              legend={[
                { label: 'P1', color: SERIES.p1 },
                { label: 'P2', color: SERIES.p2 },
                { label: 'P3', color: SERIES.p3 },
              ]}
              table={
                <DataTable
                  head={['Day', 'P1', 'P2', 'P3']}
                  rows={severityRows
                    .filter((r) => r.p1 + r.p2 + r.p3 > 0)
                    .map((r) => [r.x, r.p1, r.p2, r.p3])}
                />
              }
            >
              <StackedColumns rows={severityRows} />
            </ChartFrame>

            <ChartFrame
              title="Diagnosis confidence"
              subtitle="Verified confidence of each diagnosis, against your routing thresholds"
              table={
                <DataTable
                  head={['Confidence', 'Diagnoses']}
                  rows={[
                    ...data.confidenceDistribution.map((b) => [b.bucket, b.count]),
                    ...data.tierCounts.map((t) => [TIER_LABEL[t.tier], t.count]),
                  ]}
                />
              }
            >
              <Histogram
                buckets={data.confidenceDistribution}
                markers={[
                  { at: draft, label: `Draft ${Math.round(draft * 100)}` },
                  { at: auto, label: `Auto ${Math.round(auto * 100)}` },
                ]}
              />
              <p className="text-sm text-ink-2">
                {data.tierCounts.map((t) => `${TIER_LABEL[t.tier]}: ${t.count}`).join(' · ') ||
                  'No diagnoses yet.'}
              </p>
            </ChartFrame>

            <ChartFrame
              title="Time to resolve by service"
              subtitle="Average, slowest first"
              table={
                <DataTable
                  head={['Service', 'Avg', 'Median', 'Incidents']}
                  rows={data.mttrByService.map((r) => [
                    r.service,
                    duration(r.avgMttrSeconds),
                    duration(r.medianMttrSeconds),
                    r.incidents,
                  ])}
                />
              }
            >
              {data.mttrByService.length ? (
                <HBars
                  rows={data.mttrByService.slice(0, 8).map((r) => ({
                    label: r.service,
                    value: r.avgMttrSeconds,
                    note: `${r.incidents} resolved`,
                  }))}
                  format={(v) => duration(v)}
                />
              ) : (
                <p className="py-8 text-base text-ink-3">No resolutions in this window yet.</p>
              )}
            </ChartFrame>
          </div>

          <section aria-labelledby="recurring" className="flex flex-col gap-2">
            <SheetHeading id="recurring" title="Recurring incidents" />
            {data.topRecurring.length ? (
              <DataTable
                head={['Alert', 'Service', 'Times', 'Avg MTTR']}
                rows={data.topRecurring.map((r) => [
                  r.title,
                  r.service ?? '—',
                  r.occurrences,
                  duration(r.avgMttrSeconds),
                ])}
              />
            ) : (
              <p className="text-base text-ink-3">
                Nothing has fired more than once in this window.
              </p>
            )}
            <p className="text-sm text-ink-3">
              Recurring alerts are where runbooks and prevention work pay off first.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
