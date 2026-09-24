'use client';

import useSWR from 'swr';
import { ApiKeysPanel } from '@/components/integrations/api-keys-panel';
import { IntegrationRow } from '@/components/integrations/integration-row';
import { ErrorNote, PageTitle, SheetHeading, SkeletonRows } from '@/components/ui/blocks';
import { canConfigure, useAuth } from '@/lib/auth';
import { GROUPS, INTEGRATIONS, type Group } from '@/lib/integrations';
import type { Integration } from '@/lib/types';

export default function IntegrationsPage() {
  const { user } = useAuth();
  const canEdit = canConfigure(user);
  const { data, error, mutate } = useSWR<Integration[]>('/integrations');

  return (
    <div className="flex flex-col gap-10">
      <PageTitle
        title="Integrations"
        description="Connect alert sources, give SRE.ai the context it needs to diagnose, and choose where it asks for help."
      />

      {canEdit ? (
        <section aria-labelledby="keys" className="flex flex-col gap-3">
          <SheetHeading id="keys" title="Webhook keys" />
          <p className="measure text-base text-ink-2">
            Alert sources authenticate with a key. Create one per tool so you can rotate or revoke
            them independently.
          </p>
          <ApiKeysPanel />
        </section>
      ) : null}

      {error ? <ErrorNote error={error} retry={() => void mutate()} /> : null}
      {(Object.keys(GROUPS) as Group[]).map((group) => (
        <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
          <SheetHeading id={`group-${group}`} title={GROUPS[group].title} />
          <p className="measure text-base text-ink-2">{GROUPS[group].description}</p>
          {!data ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="flex flex-col">
              {INTEGRATIONS.filter((d) => d.group === group).map((def) => (
                <IntegrationRow
                  key={def.type}
                  def={def}
                  integration={data.find((i) => i.type === def.type)}
                  canEdit={canEdit}
                  onChanged={() => void mutate()}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
