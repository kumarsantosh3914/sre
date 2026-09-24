'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import { EmptyState, ErrorNote, PageTitle, SkeletonRows } from '@/components/ui/blocks';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Field, Input, Textarea, Toggle } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { canConfigure, useAuth } from '@/lib/auth';
import { ago } from '@/lib/format';
import type { Service } from '@/lib/types';

const HEALTH: Record<Service['health'], { label: string; tone: string; mark: string }> = {
  healthy: { label: 'Healthy', tone: 'text-ok', mark: 'border-ok bg-ok' },
  degraded: { label: 'Degraded', tone: 'text-ink', mark: 'border-ink bg-transparent' },
  down: { label: 'Down (P1 open)', tone: 'text-signal', mark: 'border-signal bg-signal' },
};

const METADATA_EXAMPLE = `{
  "owner": "@platform",
  "repo": "acme/auth-service",
  "healthCheckUrl": "https://auth.acme.com/health",
  "dependencies": [{ "name": "payments", "healthUrl": "https://payments.acme.com/health" }],
  "logGroup": "/ecs/auth-service",
  "ecs": { "cluster": "prod", "service": "auth-service", "maxTasks": 6 },
  "redeploy": { "workflow": "deploy.yml", "ref": "main" },
  "cacheFlushPatterns": ["session:*"]
}`;

function ServiceRow({
  service,
  canEdit,
  onChanged,
}: {
  service: Service;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [metadata, setMetadata] = useState(() => JSON.stringify(service.metadata, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>, ok: string): Promise<boolean> => {
    setBusy(true);
    setErrors([]);
    try {
      await api(`/services/${service.id}`, { method: 'PATCH', json: body });
      toast('ok', ok);
      onChanged();
      return true;
    } catch (err) {
      setErrors(
        err instanceof ApiError && err.details.length
          ? err.details
          : [err instanceof Error ? err.message : 'Couldn’t save.'],
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveMetadata = (): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(metadata || '{}');
    } catch {
      setErrors(['Metadata must be valid JSON.']);
      return;
    }
    void patch({ metadata: parsed }, `${service.name} updated.`);
  };

  const health = HEALTH[service.health];
  return (
    <li className="border-b rule">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 py-4 md:grid-cols-[minmax(0,1.4fr)_10rem_minmax(0,1.6fr)_auto]">
        <div className="min-w-0">
          <p className="truncate text-md font-medium text-ink">{service.name}</p>
          <p className="text-sm text-ink-3">
            {service.openIncidents} open · last incident{' '}
            {service.lastIncidentAt ? ago(service.lastIncidentAt) : 'never'}
          </p>
        </div>
        <span className={cx('flex items-center gap-2 text-sm font-medium', health.tone)}>
          <span aria-hidden className={cx('h-2.5 w-2.5 rounded-[1px] border', health.mark)} />
          {health.label}
        </span>
        <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2 md:col-span-1">
          <Toggle
            label="Auto-execute"
            description="Safe fixes run without asking"
            checked={service.autoExecuteEnabled}
            disabled={!canEdit || busy}
            onChange={(v) =>
              void patch(
                { autoExecuteEnabled: v },
                v
                  ? `Auto-execute on for ${service.name}.`
                  : `${service.name} now asks before acting.`,
              )
            }
          />
          <Toggle
            label="Always escalate"
            description="Page a human, whatever the confidence"
            checked={service.alwaysEscalate}
            disabled={!canEdit || busy}
            onChange={(v) =>
              void patch(
                { alwaysEscalate: v },
                v
                  ? `${service.name} always escalates.`
                  : `${service.name} follows confidence routing.`,
              )
            }
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} configuration for ${service.name}`}
          className="col-start-2 row-start-1 flex h-8 w-8 items-center justify-center rounded text-ink-2 hover:bg-ink/[0.06] md:col-start-4"
        >
          <ChevronDown
            aria-hidden
            className={cx('h-4 w-4 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </div>
      {open ? (
        <div className="mb-5 grid gap-4 border-l rule-strong pl-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field
            label="Service configuration (JSON)"
            hint="Tells SRE.ai where this service’s logs, health checks, repo and ECS service live — and caps what it may do."
            error={errors.length ? errors.join(' · ') : null}
          >
            {(p) => (
              <Textarea
                {...p}
                rows={14}
                spellCheck={false}
                disabled={!canEdit}
                className="font-mono text-xs"
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-col gap-2">
            <p className="lettering">Example</p>
            <pre className="overflow-x-auto border rule-strong bg-panel/60 p-3 font-mono text-xs text-ink-2">
              {METADATA_EXAMPLE}
            </pre>
            <p className="text-sm text-ink-3">
              Scale-out needs <code className="font-mono text-xs">ecs.maxTasks</code>; cache flushes
              are limited to <code className="font-mono text-xs">cacheFlushPatterns</code>.
            </p>
          </div>
          {canEdit ? (
            <div>
              <Button variant="ink" loading={busy} onClick={saveMetadata}>
                Save configuration
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function ServicesPage() {
  const { user } = useAuth();
  const canEdit = canConfigure(user);
  const toast = useToast();
  const { data, error, mutate } = useSWR<Service[]>('/services');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setBusy(true);
    setFormError(null);
    try {
      await api('/services', { method: 'POST', json: { name: name.trim().toLowerCase() } });
      toast('ok', `${name} added.`);
      setName('');
      void mutate();
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.details.length
          ? err.details.join(' ')
          : err instanceof Error
            ? err.message
            : 'Couldn’t add it.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Services"
        description="Everything that sends alerts. Services appear automatically when their first alert arrives; the switches decide how far SRE.ai may go on its own."
      />
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Field label="Add a service" error={formError} className="w-full sm:w-72">
            {(p) => (
              <Input
                {...p}
                placeholder="payment-service"
                value={name}
                onChange={(e) => setName(e.target.value)}
                pattern="[a-z0-9._-]+"
              />
            )}
          </Field>
          <Button type="submit" variant="ink" loading={busy} disabled={!name.trim()}>
            Add service
          </Button>
        </form>
      ) : null}
      {error ? (
        <ErrorNote error={error} retry={() => void mutate()} />
      ) : !data ? (
        <SkeletonRows rows={4} />
      ) : data.length === 0 ? (
        <EmptyState title="No services yet">
          Services are created from the <code className="font-mono text-xs">service</code> label of
          incoming alerts. Send a test alert from Integrations, or add one here to configure it
          ahead of time.
        </EmptyState>
      ) : (
        <ul className="flex flex-col border-t rule-strong">
          {data.map((s) => (
            <ServiceRow key={s.id} service={s} canEdit={canEdit} onChanged={() => void mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}
