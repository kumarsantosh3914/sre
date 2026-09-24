'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { Markdown } from '@/components/markdown';
import { ErrorNote, Skeleton } from '@/components/ui/blocks';
import { stamp } from '@/lib/format';
import type { Runbook } from '@/lib/types';

export default function RunbookPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, mutate } = useSWR<Runbook>(`/runbooks/${id}`);
  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/runbooks"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" /> Runbooks
      </Link>
      {error ? (
        <ErrorNote error={error} retry={() => void mutate()} />
      ) : !data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <article className="sheet registered p-5 sm:p-10">
          <p className="mb-4 text-sm text-ink-3">
            Revision {data.version} · updated {stamp(data.updatedAt)} · from{' '}
            {data.incidentIds.length} incidents
          </p>
          <Markdown source={data.markdown} />
        </article>
      )}
    </div>
  );
}
