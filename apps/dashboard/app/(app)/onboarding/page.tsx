'use client';

import { ArrowRight, Check, Radio } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { IntegrationRow } from '@/components/integrations/integration-row';
import { KeyReveal } from '@/components/integrations/key-reveal';
import { PageTitle } from '@/components/ui/blocks';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Field, Input } from '@/components/ui/field';
import { StatusStamp } from '@/components/ui/marks';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { canConfigure, useAuth } from '@/lib/auth';
import { defOf } from '@/lib/integrations';
import { useRealtime } from '@/lib/realtime';
import type {
  ApiKey,
  CreatedApiKey,
  Integration,
  IncidentStatus,
  Page,
  IncidentSummary,
  Service,
  TestResult,
} from '@/lib/types';

const SOURCES = [
  {
    type: 'prometheus',
    name: 'Prometheus Alertmanager',
    note: 'Most common for services on Kubernetes or ECS.',
  },
  { type: 'grafana', name: 'Grafana alerting', note: 'If your alert rules live in Grafana.' },
  { type: 'sentry', name: 'Sentry', note: 'Error spikes and issue alerts.' },
  { type: 'cloudwatch', name: 'AWS CloudWatch', note: 'Alarms delivered through SNS.' },
  { type: 'generic', name: 'Anything else', note: 'Any tool that can POST JSON.' },
];

const STEPS = [
  'Account',
  'First service',
  'Alert source',
  'Webhook key',
  'Test alert',
  'Slack',
] as const;

function StepList({
  current,
  done,
  go,
}: {
  current: number;
  done: boolean[];
  go: (i: number) => void;
}) {
  return (
    <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:border-l lg:rule-strong">
      {STEPS.map((label, i) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => go(i)}
            aria-current={current === i ? 'step' : undefined}
            className={cx(
              'relative flex w-full items-center gap-3 whitespace-nowrap px-3 py-2 text-left text-base transition-colors duration-150 lg:-ml-px lg:border-l lg:pl-4',
              current === i
                ? 'border-signal font-semibold text-ink lg:border-l-2'
                : 'border-transparent text-ink-2 hover:text-ink',
            )}
          >
            <span
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-bold tabular-nums',
                done[i]
                  ? 'border-ok bg-ok text-sheet'
                  : current === i
                    ? 'border-signal text-signal'
                    : 'border-ink/40 text-ink-3',
              )}
            >
              {done[i] ? <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            {label}
            {done[i] ? <span className="sr-only">(done)</span> : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

function Stage({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="stage-title">
      <div className="flex flex-col gap-1.5">
        <h2 id="stage-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">
          {title}
        </h2>
        <p className="measure text-base text-ink-2">{lede}</p>
      </div>
      {children}
    </section>
  );
}

// Follows the test alert through the real pipeline, live over the socket:
// opened → diagnosing → diagnosed, then links to its sheet.
function TestAlertWatch({ integration }: { integration: Integration }) {
  const { subscribe } = useRealtime();
  const [sent, setSent] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [status, setStatus] = useState<IncidentStatus | null>(null);
  const [diagnosed, setDiagnosed] = useState(false);
  const { data: latest } = useSWR<Page<IncidentSummary>>(
    sent?.ok && !incidentId ? '/incidents?search=SRE.ai%20test%20alert&pageSize=1' : null,
    {
      refreshInterval: 2000,
    },
  );

  useEffect(() => {
    const found = latest?.items[0];
    if (found && sent?.ok && new Date(found.detectedAt).getTime() > Date.now() - 5 * 60_000) {
      setIncidentId(found.id);
      setStatus(found.status);
    }
  }, [latest, sent]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'incident.created' && !incidentId && sent?.ok)
          setIncidentId(event.incidentId);
        if (event.incidentId !== incidentId && event.type !== 'incident.created') return;
        if (event.status) setStatus(event.status);
        if (event.type === 'diagnosis.completed') setDiagnosed(true);
      }),
    [subscribe, incidentId, sent],
  );

  const send = async (): Promise<void> => {
    setBusy(true);
    setIncidentId(null);
    setStatus(null);
    setDiagnosed(false);
    try {
      setSent(await api<TestResult>(`/integrations/${integration.id}/test`, { method: 'POST' }));
    } catch (err) {
      setSent({
        ok: false,
        message: err instanceof Error ? err.message : 'Couldn’t send the test alert.',
      });
    } finally {
      setBusy(false);
    }
  };

  const steps: { label: string; on: boolean }[] = [
    { label: 'Alert accepted', on: Boolean(sent?.ok) },
    { label: 'Incident opened', on: Boolean(incidentId) },
    {
      label: 'Collecting context and diagnosing',
      on: status === 'diagnosing' || diagnosed || status === 'acting' || status === 'escalated',
    },
    {
      label: 'Diagnosis verified and routed',
      on: diagnosed || status === 'acting' || status === 'escalated' || status === 'resolved',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button
          variant="ink"
          size="lg"
          loading={busy}
          onClick={() => void send()}
          icon={<Radio aria-hidden className="h-4 w-4" />}
        >
          {sent ? 'Send another test alert' : 'Send a test alert'}
        </Button>
      </div>
      {sent && !sent.ok ? (
        <p role="alert" className="text-sm text-fault">
          {sent.message}
        </p>
      ) : null}
      {sent?.ok ? (
        <ol className="flex flex-col border-l rule-strong" aria-live="polite">
          {steps.map((s) => (
            <li
              key={s.label}
              className={cx(
                '-ml-px flex items-center gap-3 border-l py-2 pl-4 text-base',
                s.on ? 'border-ok text-ink' : 'border-transparent text-ink-3',
              )}
            >
              <span
                className={cx('h-2 w-2 rounded-full', s.on ? 'bg-ok' : 'bg-ink/25')}
                aria-hidden
              />
              {s.label}
              {s.label.startsWith('Incident') && status ? <StatusStamp status={status} /> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {incidentId ? (
        <Link
          href={`/incidents/${incidentId}`}
          className="inline-flex w-fit items-center gap-2 text-base font-medium text-ink underline"
        >
          Open the incident sheet <ArrowRight aria-hidden className="h-4 w-4" />
        </Link>
      ) : null}
      <p className="text-sm text-ink-3">
        Test alerts are labelled as tests: SRE.ai diagnoses them end to end but never pages anyone
        or touches your infrastructure.
      </p>
    </div>
  );
}

export default function OnboardingPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: services, mutate: mutateServices } = useSWR<Service[]>('/services');
  const { data: integrations, mutate: mutateIntegrations } = useSWR<Integration[]>('/integrations');
  const { data: keys, mutate: mutateKeys } = useSWR<ApiKey[]>(
    canConfigure(user) ? '/api-keys' : null,
  );
  const { data: incidents } = useSWR<Page<IncidentSummary>>('/incidents?pageSize=1');
  const [step, setStep] = useState<number | null>(null);
  const [source, setSource] = useState('prometheus');
  const [serviceName, setServiceName] = useState('');
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [busy, setBusy] = useState(false);

  const alertIntegration = integrations?.find((i) =>
    ['prometheus', 'grafana', 'sentry', 'cloudwatch', 'generic'].includes(i.type),
  );
  const done = useMemo(
    () => [
      true,
      Boolean(services?.length),
      Boolean(alertIntegration),
      Boolean(keys?.length) || Boolean(created),
      Boolean(incidents?.total),
      Boolean(integrations?.some((i) => i.type === 'slack')),
    ],
    [services, alertIntegration, keys, created, incidents, integrations],
  );
  const firstOpen = done.findIndex((d) => !d);
  const current = step ?? (firstOpen === -1 ? STEPS.length - 1 : firstOpen);

  useEffect(() => {
    if (alertIntegration) setSource(alertIntegration.type);
  }, [alertIntegration]);

  const addService = async (): Promise<void> => {
    setBusy(true);
    setServiceError(null);
    try {
      await api('/services', { method: 'POST', json: { name: serviceName.trim().toLowerCase() } });
      await mutateServices();
      setStep(2);
    } catch (err) {
      setServiceError(
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

  const chooseSource = async (): Promise<void> => {
    const def = defOf(source);
    if (!def) return;
    if (def.fields.some((f) => f.required)) return; // configured through the inline form below
    setBusy(true);
    try {
      const config =
        source === 'generic'
          ? {
              fieldMapping: {
                title: 'title',
                service: 'service',
                severity: 'severity',
                status: 'status',
              },
            }
          : {};
      await api('/integrations', {
        method: 'POST',
        json: { type: source, config, credentials: {} },
      });
      await mutateIntegrations();
      setStep(3);
    } catch (err) {
      toast('fault', err instanceof Error ? err.message : 'Couldn’t connect it.');
    } finally {
      setBusy(false);
    }
  };

  const createKey = async (): Promise<void> => {
    setBusy(true);
    try {
      setCreated(
        await api<CreatedApiKey>('/api-keys', {
          method: 'POST',
          json: { name: `${source}-${new Date().getFullYear()}` },
        }),
      );
      void mutateKeys();
    } finally {
      setBusy(false);
    }
  };

  const sourceDef = defOf(source);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Set up SRE.ai"
        description="Six steps to your first cited diagnosis. Most teams are done in under ten minutes."
      />
      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <StepList current={current} done={done} go={setStep} />
        <div className="sheet registered min-w-0 p-5 sm:p-8">
          {current === 0 ? (
            <Stage title="You’re in" lede={`Signed in as ${user?.email}. Your workspace is ready.`}>
              <div>
                <Button variant="ink" onClick={() => setStep(1)}>
                  Continue
                </Button>
              </div>
            </Stage>
          ) : null}

          {current === 1 ? (
            <Stage
              title="Name your first service"
              lede="The service that pages you most. SRE.ai also creates services automatically from the service label on incoming alerts."
            >
              {services?.length ? (
                <p className="text-base text-ink">
                  You have {services.length} service{services.length === 1 ? '' : 's'}:{' '}
                  {services.map((s) => s.name).join(', ')}.
                </p>
              ) : null}
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addService();
                }}
              >
                <Field
                  label="Service name"
                  hint="Lowercase, like the service label in your alerts."
                  error={serviceError}
                  className="w-full sm:w-72"
                >
                  {(p) => (
                    <Input
                      {...p}
                      placeholder="auth-service"
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                    />
                  )}
                </Field>
                <Button type="submit" variant="ink" loading={busy} disabled={!serviceName.trim()}>
                  Add service
                </Button>
                {services?.length ? (
                  <Button variant="quiet" onClick={() => setStep(2)}>
                    Skip
                  </Button>
                ) : null}
              </form>
            </Stage>
          ) : null}

          {current === 2 ? (
            <Stage
              title="Where do your alerts come from?"
              lede="Pick the tool that fires your alerts today. You can add more later."
            >
              <fieldset className="flex flex-col">
                <legend className="sr-only">Alert source</legend>
                {SOURCES.map((s) => (
                  <label
                    key={s.type}
                    className={cx(
                      'flex cursor-pointer items-start gap-3 border-b rule px-2 py-3 transition-colors duration-150 hover:bg-ink/[0.04]',
                      source === s.type && 'bg-ink/[0.05]',
                    )}
                  >
                    <input
                      type="radio"
                      name="source"
                      value={s.type}
                      checked={source === s.type}
                      onChange={() => setSource(s.type)}
                      className="mt-1 accent-[rgb(var(--signal))]"
                    />
                    <span className="flex flex-col">
                      <span className="text-base font-medium text-ink">{s.name}</span>
                      <span className="text-sm text-ink-2">{s.note}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {sourceDef && sourceDef.fields.some((f) => f.required) ? (
                <ul>
                  <IntegrationRow
                    key={source}
                    def={sourceDef}
                    integration={integrations?.find((i) => i.type === source)}
                    canEdit={canConfigure(user)}
                    onChanged={() => {
                      void mutateIntegrations();
                      setStep(3);
                    }}
                    defaultOpen
                  />
                </ul>
              ) : (
                <div>
                  <Button
                    variant="ink"
                    loading={busy}
                    onClick={() =>
                      void (integrations?.some((i) => i.type === source)
                        ? setStep(3)
                        : chooseSource())
                    }
                  >
                    Use {sourceDef?.name}
                  </Button>
                </div>
              )}
            </Stage>
          ) : null}

          {current === 3 ? (
            <Stage
              title="Point it at SRE.ai"
              lede="Create a webhook key, then paste the snippet into your alerting tool. The key is shown once."
            >
              {created ? (
                <KeyReveal created={created} initialSource={source} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="ink" loading={busy} onClick={() => void createKey()}>
                    Create webhook key
                  </Button>
                  {keys?.length ? (
                    <span className="text-sm text-ink-3">
                      You already have {keys.length} key(s) — you can reuse one.
                    </span>
                  ) : null}
                </div>
              )}
              <div>
                <Button
                  variant="line"
                  onClick={() => setStep(4)}
                  disabled={!created && !keys?.length}
                >
                  I’ve pasted it — next
                </Button>
              </div>
            </Stage>
          ) : null}

          {current === 4 ? (
            <Stage
              title="Watch a test alert get diagnosed"
              lede="SRE.ai sends a synthetic alert through the real pipeline. You’ll see it open, get diagnosed with cited evidence, and get routed — live."
            >
              {alertIntegration ? (
                <TestAlertWatch integration={alertIntegration} />
              ) : (
                <p className="text-base text-ink-2">Connect an alert source first.</p>
              )}
            </Stage>
          ) : null}

          {current === 5 ? (
            <Stage
              title="Get told in Slack"
              lede="Incident threads, approvals with one-click buttons, and the morning digest. PagerDuty is optional — add it in Integrations."
            >
              {defOf('slack') ? (
                <ul>
                  <IntegrationRow
                    def={defOf('slack')!}
                    integration={integrations?.find((i) => i.type === 'slack')}
                    canEdit={canConfigure(user)}
                    onChanged={() => void mutateIntegrations()}
                    defaultOpen={!integrations?.some((i) => i.type === 'slack')}
                  />
                </ul>
              ) : null}
              <div>
                <Link
                  href="/"
                  className="inline-flex h-11 items-center gap-2 rounded border border-ink bg-ink px-5 text-base font-medium text-sheet hover:bg-ink/90"
                >
                  Go to the board <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </div>
            </Stage>
          ) : null}
        </div>
      </div>
    </div>
  );
}
