'use client';

import { ArrowLeft, Download, Rocket } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { ActionPanel } from '@/components/incident/action-panel';
import { CollectorReportTable, ScoringBreakdown } from '@/components/incident/collectors';
import { ConfidenceGauge } from '@/components/incident/confidence-gauge';
import {
  EvidenceSchedule,
  Hypothesis,
  LeaderLine,
  useEvidence,
} from '@/components/incident/diagnosis-view';
import { IncidentRegister } from '@/components/incident/incident-register';
import { RevisionTable } from '@/components/incident/revision-table';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { ErrorNote, SheetHeading, Skeleton, TitleBlock } from '@/components/ui/blocks';
import { SeverityMark, StatusStamp } from '@/components/ui/marks';
import { download } from '@/lib/api';
import { ACTION_LABEL, TIER_LABEL, actor, ago, duration, sheetNo, stamp } from '@/lib/format';
import type {
  AuditEvent,
  Diagnosis,
  IncidentDetail,
  Postmortem,
  TeamMember,
  TenantSettings,
} from '@/lib/types';

const GRID = 'grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] xl:gap-x-12';
// Right column on a laptop; straight after the verdict on a phone, so an
// approval or rollback is never a long scroll away from a Slack link.
const ASIDE = 'lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start';

function ElapsedClock({ from, until }: { from: string; until: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const end = until ? new Date(until).getTime() : now;
  return (
    <span className="font-mono tabular-nums">
      {duration(Math.max(0, Math.round((end - new Date(from).getTime()) / 1000)))}
    </span>
  );
}

function DiagnosisSheet({
  diagnosis,
  settings,
  aside,
}: {
  diagnosis: Diagnosis;
  settings: TenantSettings | undefined;
  aside: ReactNode;
}) {
  const evidence = useEvidence(diagnosis);
  const sheet = useRef<HTMLDivElement>(null);
  const [showReasoning, setShowReasoning] = useState(false);
  const verb = diagnosis.recommendedAction.match(/^([A-Z_]+)\s*:\s*/);
  return (
    <div ref={sheet} className={`relative ${GRID} lg:grid-rows-[auto_1fr]`}>
      <section
        aria-labelledby="root-cause"
        className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1"
      >
        <SheetHeading id="root-cause" title="Root cause" />
        <Hypothesis
          diagnosis={diagnosis}
          rows={evidence.rows}
          active={evidence.active}
          setActive={evidence.setActive}
        />
        <ConfidenceGauge
          confidence={diagnosis.confidence}
          llmConfidence={diagnosis.llmConfidence}
          auto={settings?.autoThreshold ?? 0.85}
          draft={settings?.draftThreshold ?? 0.6}
          citationsPassed={diagnosis.citationsPassed}
          capped={Boolean(diagnosis.scoring?.capped)}
        />
        <div className="grid gap-x-8 gap-y-3 border-t rule-strong pt-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="lettering">Recommended</span>
            <p className="text-base text-ink">
              {verb ? (
                <span className="mr-1.5 font-semibold">
                  {verb[1]
                    .replace(/_/g, ' ')
                    .toLowerCase()
                    .replace(/^\w/, (c) => c.toUpperCase())}
                  :
                </span>
              ) : null}
              {verb
                ? diagnosis.recommendedAction.slice(verb[0].length)
                : diagnosis.recommendedAction}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="lettering">Routed as</span>
            <p className="text-base text-ink">{TIER_LABEL[diagnosis.actionTier]}</p>
          </div>
        </div>
        {diagnosis.recentDeploy ? (
          <p className="flex items-start gap-2 border border-dashed rule-strong px-3 py-2 text-sm text-ink-2">
            <Rocket aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
            <span>
              Deploy {diagnosis.recentDeploy.minutesBeforeAlert} min before the alert: “
              {diagnosis.recentDeploy.message}” by {diagnosis.recentDeploy.author}
              {diagnosis.recentDeploy.url ? (
                <>
                  {' '}
                  ·{' '}
                  <a
                    href={diagnosis.recentDeploy.url}
                    className="underline"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {diagnosis.recentDeploy.sha.slice(0, 7)}
                  </a>
                </>
              ) : null}
            </span>
          </p>
        ) : null}
        <div>
          <button
            type="button"
            className="text-sm font-medium text-ink-2 underline hover:text-ink"
            onClick={() => setShowReasoning((v) => !v)}
            aria-expanded={showReasoning}
          >
            {showReasoning ? 'Hide the reasoning' : 'Show the model’s reasoning'}
          </button>
          {showReasoning ? (
            <p className="measure mt-2 text-base text-ink-2">{diagnosis.reasoning}</p>
          ) : null}
        </div>
      </section>

      <aside aria-label="Actions" className={ASIDE}>
        {aside}
      </aside>

      <section
        aria-labelledby="evidence"
        className="flex min-w-0 flex-col gap-2 lg:col-start-1 lg:row-start-2"
      >
        <SheetHeading
          id="evidence"
          title="Evidence schedule"
          aside={
            <span className="text-sm text-ink-3">
              {evidence.rows.filter((r) => r.verified).length} of {evidence.rows.length} verified
              verbatim
            </span>
          }
        />
        <EvidenceSchedule
          rows={evidence.rows}
          active={evidence.active}
          setActive={evidence.setActive}
        />
      </section>
      <LeaderLine container={sheet} active={evidence.active} />
    </div>
  );
}

function Diagnosing() {
  return (
    <section aria-live="polite" className="flex flex-col gap-4">
      <SheetHeading title="Root cause" />
      <p className="measure text-lg text-ink-2">
        SRE.ai is reading logs, metrics, recent deploys and dependency health, and checking past
        incidents. The diagnosis appears here the moment it’s verified.
      </p>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <Skeleton className="mt-4 h-12 w-full" />
    </section>
  );
}

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: incident, error, mutate, isLoading } = useSWR<IncidentDetail>(`/incidents/${id}`);
  const { data: timeline, mutate: mutateTimeline } = useSWR<AuditEvent[]>(
    `/incidents/${id}/timeline`,
  );
  const { data: settingsRes } = useSWR<{ settings: TenantSettings }>('/settings');
  const { data: team } = useSWR<TeamMember[]>('/team');
  const names = Object.fromEntries((team ?? []).map((m) => [m.id, m.email]));
  const { data: postmortem } = useSWR<Postmortem>(
    incident?.hasPostmortem ? `/incidents/${id}/postmortem` : null,
  );

  useEffect(() => {
    if (incident) document.title = `${incident.title} · SRE.ai`;
  }, [incident]);

  if (error) return <ErrorNote error={error} retry={() => void mutate()} />;
  if (isLoading || !incident) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Loading incident">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const refresh = (): void => {
    void mutate();
    void mutateTimeline();
  };

  return (
    // Bottom room on phones for the pinned decision bar.
    <article className="flex flex-col gap-8 pb-20 lg:pb-0">
      <div className="flex flex-col gap-3">
        <Link
          href="/incidents"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
        >
          <ArrowLeft aria-hidden className="h-4 w-4" /> Incidents
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <SeverityMark severity={incident.severity} className="mt-1.5" />
          <h1
            className="min-w-0 flex-1 text-2xl font-semibold tracking-[-0.025em] text-ink"
            style={{ textWrap: 'balance' }}
          >
            {incident.title}
          </h1>
        </div>
        {incident.parentIncidentId ? (
          <p className="text-sm text-ink-2">
            Grouped into an alert storm —{' '}
            <Link href={`/incidents/${incident.parentIncidentId}`} className="underline">
              open the storm incident
            </Link>
            .
          </p>
        ) : null}
      </div>

      <TitleBlock
        cells={[
          {
            label: 'Sheet',
            value: <span className="font-mono text-base">{sheetNo(incident.id)}</span>,
          },
          { label: 'Status', value: <StatusStamp status={incident.status} /> },
          { label: 'Service', value: incident.service?.name ?? '—' },
          { label: 'Source', value: <span className="capitalize">{incident.alertSource}</span> },
          {
            label: 'Detected',
            value: <span title={stamp(incident.detectedAt)}>{ago(incident.detectedAt)}</span>,
          },
          {
            label: incident.resolvedAt ? 'Time to resolve' : 'Open for',
            value: <ElapsedClock from={incident.detectedAt} until={incident.resolvedAt} />,
          },
          { label: 'Alerts', value: incident.alertCount },
        ]}
      />

      {incident.diagnosis ? (
        <DiagnosisSheet
          diagnosis={incident.diagnosis}
          settings={settingsRes?.settings}
          aside={<ActionPanel incident={incident} names={names} onChanged={refresh} />}
        />
      ) : (
        <div className={GRID}>
          <div className="min-w-0">
            <Diagnosing />
          </div>
          <aside aria-label="Actions" className={ASIDE}>
            <ActionPanel incident={incident} names={names} onChanged={refresh} />
          </aside>
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)] xl:gap-12">
        <section aria-labelledby="revisions" className="flex min-w-0 flex-col gap-2">
          <SheetHeading
            id="revisions"
            title="Revision history"
            aside={
              <Button
                size="sm"
                variant="quiet"
                icon={<Download aria-hidden className="h-4 w-4" />}
                onClick={() =>
                  void download(
                    `/incidents/${incident.id}/audit?format=csv`,
                    `incident-${incident.id}-audit.csv`,
                  )
                }
              >
                Export CSV
              </Button>
            }
          />
          {timeline ? (
            <RevisionTable events={timeline} names={names} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </section>

        <div className="flex flex-col gap-8">
          {incident.diagnosis ? (
            <section aria-labelledby="context" className="flex flex-col gap-2">
              <SheetHeading id="context" title="What SRE.ai looked at" />
              <CollectorReportTable collectors={incident.diagnosis.collectors} />
              {incident.diagnosis.scoring ? (
                <div className="mt-3">
                  <ScoringBreakdown scoring={incident.diagnosis.scoring} />
                </div>
              ) : null}
              <p className="text-sm text-ink-3">
                {incident.diagnosis.model ?? 'model'} · prompt{' '}
                {incident.diagnosis.promptVersion ?? '—'}
                {incident.diagnosis.latencyMs
                  ? ` · ${(incident.diagnosis.latencyMs / 1000).toFixed(1)}s`
                  : ''}
              </p>
            </section>
          ) : null}

          {incident.actions.length ? (
            <section aria-labelledby="actions-log" className="flex flex-col gap-2">
              <SheetHeading id="actions-log" title="Actions" />
              <ul className="flex flex-col">
                {incident.actions.map((a) => (
                  <li key={a.id} className="flex flex-col gap-0.5 border-b rule py-2.5">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-base text-ink">
                        {ACTION_LABEL[a.actionType] ?? a.actionType}
                      </span>
                      <span className="lettering">{a.status.replace('_', ' ')}</span>
                    </span>
                    <span className="text-sm text-ink-2">{a.description}</span>
                    <span className="text-xs text-ink-3">
                      {TIER_LABEL[a.tier]} · {actor(a.decidedBy ?? a.requestedBy, names)} ·{' '}
                      {ago(a.executedAt ?? a.createdAt)}
                      {a.error ? ` · ${a.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      {incident.similarIncidents.length ? (
        <section aria-labelledby="similar" className="flex flex-col gap-2">
          <SheetHeading id="similar" title="Seen before" />
          <IncidentRegister incidents={incident.similarIncidents} compact />
        </section>
      ) : null}

      {incident.groupedIncidents.length ? (
        <section aria-labelledby="grouped" className="flex flex-col gap-2">
          <SheetHeading
            id="grouped"
            title={`Grouped into this storm (${incident.groupedIncidents.length})`}
          />
          <IncidentRegister incidents={incident.groupedIncidents} compact />
        </section>
      ) : null}

      {postmortem ? (
        <section
          id="postmortem"
          aria-labelledby="postmortem-title"
          className="sheet registered flex flex-col gap-2 p-5 sm:p-8"
        >
          <SheetHeading
            id="postmortem-title"
            title="Post-mortem"
            aside={
              <Button
                size="sm"
                variant="quiet"
                icon={<Download aria-hidden className="h-4 w-4" />}
                onClick={() =>
                  void download(
                    `/incidents/${incident.id}/postmortem?format=markdown`,
                    `postmortem-${incident.id}.md`,
                  )
                }
              >
                Markdown
              </Button>
            }
          />
          <Markdown source={postmortem.markdown} />
        </section>
      ) : null}

      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-ink-2 hover:text-ink">
          Raw alert and labels
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {incident.description ? (
            <p className="measure text-base text-ink-2">{incident.description}</p>
          ) : null}
          <pre className="overflow-x-auto border rule-strong bg-panel/60 p-3 font-mono text-xs text-ink-2">
            {JSON.stringify({ labels: incident.labels, alert: incident.sourceAlert }, null, 2)}
          </pre>
        </div>
      </details>
    </article>
  );
}
