'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { EmptyState, ErrorNote, PageTitle, SkeletonRows } from '@/components/ui/blocks';
import { ago } from '@/lib/format';
import type { RunbookSummary } from '@/lib/types';

export default function RunbooksPage() {
  const { data, error, mutate } = useSWR<RunbookSummary[]>('/runbooks');
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Runbooks"
        description="Written by SRE.ai after the same fix has resolved the same alert three times — only what the incident history shows, nothing guessed."
      />
      {error ? (
        <ErrorNote error={error} retry={() => void mutate()} />
      ) : !data ? (
        <SkeletonRows rows={4} />
      ) : data.length === 0 ? (
        <EmptyState title="No runbooks yet">
          Each resolved incident teaches SRE.ai which fix works for which alert. After the third
          identical, successful resolution, a runbook appears here and is attached to every future
          escalation for that alert.
        </EmptyState>
      ) : (
        <ul className="flex flex-col border-t rule-strong">
          {data.map((r) => (
            <li
              key={r.id}
              className="relative flex flex-wrap items-baseline justify-between gap-3 border-b rule py-4 hover:bg-ink/[0.04]"
            >
              <div className="min-w-0">
                <Link
                  href={`/runbooks/${r.id}`}
                  className="text-md font-medium text-ink after:absolute after:inset-0"
                >
                  {r.title}
                </Link>
                <p className="text-sm text-ink-3">
                  {r.service ?? 'any service'} · from {r.incidentCount} incidents · rev {r.version}
                </p>
              </div>
              <span className="text-sm text-ink-2">updated {ago(r.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
