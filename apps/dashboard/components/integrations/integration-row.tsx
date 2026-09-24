'use client';

import { CircleAlert, CircleCheck, CircleDashed, PlugZap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { ago } from '@/lib/format';
import { flatConfig, toPayload, type IntegrationDef } from '@/lib/integrations';
import type { Integration, TestResult } from '@/lib/types';
import { Button } from '../ui/button';
import { cx } from '../ui/cx';
import { Field, Input } from '../ui/field';
import { useToast } from '../ui/toast';

function Status({ integration }: { integration: Integration | undefined }) {
  if (!integration) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-ink-3">
        <CircleDashed aria-hidden className="h-4 w-4" /> Not connected
      </span>
    );
  }
  if (integration.lastError) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-fault">
        <CircleAlert aria-hidden className="h-4 w-4" /> Test failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-sm text-ok">
      <CircleCheck aria-hidden className="h-4 w-4" />
      {integration.lastTestedAt ? `Tested ${ago(integration.lastTestedAt)}` : 'Connected'}
    </span>
  );
}

// One integration as a ruled row that opens in place into its form — no
// modal: configuring is the task, not an interruption.
export function IntegrationRow({
  def,
  integration,
  canEdit,
  onChanged,
  defaultOpen,
}: {
  def: IntegrationDef;
  integration: Integration | undefined;
  canEdit: boolean;
  onChanged: () => void;
  defaultOpen?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [values, setValues] = useState<Record<string, string>>(() =>
    flatConfig(integration?.config ?? {}),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy('save');
    setErrors([]);
    const payload = toPayload(def, values);
    try {
      if (integration) {
        await api(`/integrations/${integration.id}`, {
          method: 'PATCH',
          json: {
            config: payload.config,
            ...(Object.keys(payload.credentials).length
              ? { credentials: payload.credentials }
              : {}),
          },
        });
      } else {
        await api('/integrations', { method: 'POST', json: { type: def.type, ...payload } });
      }
      toast('ok', `${def.name} saved.`);
      setValues((v) =>
        Object.fromEntries(
          Object.entries(v).filter(([k]) => def.fields.find((f) => f.key === k)?.kind === 'config'),
        ),
      );
      onChanged();
      setOpen(false);
    } catch (err) {
      setErrors(
        err instanceof ApiError && err.details.length
          ? err.details
          : [err instanceof Error ? err.message : 'Couldn’t save.'],
      );
    } finally {
      setBusy(null);
    }
  };

  const runTest = async (): Promise<void> => {
    if (!integration) return;
    setBusy('test');
    try {
      const result = await api<TestResult>(`/integrations/${integration.id}/test`, {
        method: 'POST',
      });
      setTest(result);
      onChanged();
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : 'Test failed.' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (
      !integration ||
      !window.confirm(`Disconnect ${def.name}? SRE.ai will stop using it immediately.`)
    )
      return;
    setBusy('remove');
    try {
      await api(`/integrations/${integration.id}`, { method: 'DELETE' });
      toast('ok', `${def.name} disconnected.`);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const formId = `form-${def.type}`;
  return (
    <li className="border-b rule">
      <div className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-md font-medium text-ink">{def.name}</p>
          <p className="text-sm text-ink-2">{def.summary}</p>
        </div>
        <Status integration={integration} />
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {integration ? (
            <Button
              size="sm"
              onClick={() => void runTest()}
              loading={busy === 'test'}
              icon={<PlugZap aria-hidden className="h-4 w-4" />}
              disabled={!canEdit}
            >
              Test
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="sm"
              variant={integration ? 'quiet' : 'ink'}
              aria-expanded={open}
              aria-controls={formId}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Close' : integration ? 'Edit' : 'Connect'}
            </Button>
          ) : null}
        </div>
      </div>

      {test ? (
        <p
          role="status"
          className={cx(
            'mb-4 flex items-start gap-2 border px-3 py-2 text-sm',
            test.ok ? 'border-ok/50 text-ink' : 'border-fault/50 text-ink',
          )}
        >
          {test.ok ? (
            <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
          ) : (
            <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fault" />
          )}
          {test.message}
        </p>
      ) : null}
      {integration?.lastError && !test ? (
        <p className="mb-4 text-sm text-fault">Last test: {integration.lastError}</p>
      ) : null}

      {open ? (
        <form
          id={formId}
          onSubmit={(e) => void save(e)}
          className="mb-5 flex flex-col gap-4 border-l rule-strong pl-4 sm:ml-1"
        >
          {def.fields.length === 0 ? (
            <p className="text-base text-ink-2">
              Nothing to configure — connect it, then point the source at your webhook URL (see
              Webhook keys above).
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {def.fields.map((f) => (
                <Field
                  key={f.key}
                  label={`${f.label}${f.required ? '' : ' (optional)'}`}
                  hint={
                    f.kind === 'credential' && integration?.credentialFields.includes(f.key)
                      ? 'Saved and encrypted. Leave blank to keep it.'
                      : f.hint
                  }
                >
                  {(p) => (
                    <Input
                      {...p}
                      type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                      autoComplete="off"
                      placeholder={
                        f.kind === 'credential' && integration?.credentialFields.includes(f.key)
                          ? '••••••••••••'
                          : f.placeholder
                      }
                      required={
                        Boolean(f.required) &&
                        !(f.kind === 'credential' && integration?.credentialFields.includes(f.key))
                      }
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      className={f.kind === 'credential' ? 'font-mono text-xs' : undefined}
                    />
                  )}
                </Field>
              ))}
            </div>
          )}
          {errors.length ? (
            <ul role="alert" className="flex flex-col gap-1 text-sm text-fault">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="ink" loading={busy === 'save'}>
              {integration ? 'Save changes' : `Connect ${def.name}`}
            </Button>
            {integration ? (
              <Button variant="danger" onClick={() => void remove()} loading={busy === 'remove'}>
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
    </li>
  );
}
