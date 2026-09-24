'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ConfidenceGauge } from '@/components/incident/confidence-gauge';
import { ErrorNote, PageTitle, SheetHeading, Skeleton } from '@/components/ui/blocks';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { canConfigure, useAuth } from '@/lib/auth';
import type { Role, SilenceWindow, TeamMember, TenantSettings } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function timezones(): string[] {
  try {
    // Browsers leave "UTC" (the server default) out of this list; without it
    // the select would silently show the first zone instead.
    return ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];
  } catch {
    return ['UTC'];
  }
}

function browserZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const { user } = useAuth();
  const canEdit = canConfigure(user);
  const toast = useToast();
  const { data, error, mutate } = useSWR<{ name: string; slug: string; settings: TenantSettings }>(
    '/settings',
  );
  const { data: team, mutate: mutateTeam } = useSWR<TeamMember[]>('/team');
  const [draft, setDraft] = useState<TenantSettings | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(timezones, []);
  const localZone = useMemo(browserZone, []);

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  if (error) return <ErrorNote error={error} retry={() => void mutate()} />;
  if (!draft || !data) return <Skeleton className="h-96 w-full" />;

  const auto = draft.autoThreshold ?? 0.85;
  const draftT = draft.draftThreshold ?? 0.6;
  const set = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]): void =>
    setDraft({ ...draft, [key]: value });
  const setWindow = (i: number, patch: Partial<SilenceWindow>): void =>
    set(
      'silenceWindows',
      draft.silenceWindows.map((w, j) => (j === i ? { ...w, ...patch } : w)),
    );

  const save = async (): Promise<void> => {
    setBusy(true);
    setErrors([]);
    try {
      const saved = await api<TenantSettings>('/settings', {
        method: 'PATCH',
        json: { settings: draft },
      });
      setDraft(saved);
      void mutate();
      toast('ok', 'Settings saved.');
    } catch (err) {
      setErrors(
        err instanceof ApiError && err.details.length
          ? err.details
          : [err instanceof Error ? err.message : 'Couldn’t save.'],
      );
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: TeamMember, role: Role): Promise<void> => {
    try {
      await api(`/team/${member.id}/role`, { method: 'PATCH', json: { role } });
      toast('ok', `${member.email} is now ${role}.`);
      void mutateTeam();
    } catch (err) {
      toast('fault', err instanceof Error ? err.message : 'Couldn’t change the role.');
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  return (
    <div className="flex flex-col gap-10">
      <PageTitle
        title="Settings"
        description={`Workspace ${data.name}. These rules decide when SRE.ai acts on its own, when it asks, and when it wakes someone up.`}
        actions={
          canEdit ? (
            <Button variant="ink" loading={busy} disabled={!dirty} onClick={() => void save()}>
              Save changes
            </Button>
          ) : undefined
        }
      />
      {errors.length ? (
        <ul
          role="alert"
          className="flex flex-col gap-1 border border-fault/50 px-4 py-3 text-sm text-fault"
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="thresholds" className="flex flex-col gap-4">
        <SheetHeading id="thresholds" title="Confidence thresholds" />
        <p className="measure text-base text-ink-2">
          Confidence is SRE.ai’s verified score — after citation checks — not the model’s own claim.
          Above the auto line, safe fixes run on services with auto-execute on; between the lines,
          SRE.ai asks in Slack; below, it pages a human.
        </p>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Auto-execute above" hint="Default 85%">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={1}
                  max={100}
                  disabled={!canEdit}
                  value={Math.round(auto * 100)}
                  onChange={(e) => set('autoThreshold', Number(e.target.value) / 100)}
                />
              )}
            </Field>
            <Field label="Ask for approval above" hint="Default 60%">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={99}
                  disabled={!canEdit}
                  value={Math.round(draftT * 100)}
                  onChange={(e) => set('draftThreshold', Number(e.target.value) / 100)}
                />
              )}
            </Field>
          </div>
          <div aria-hidden className="pointer-events-none">
            <ConfidenceGauge
              confidence={0.72}
              llmConfidence={null}
              auto={auto}
              draft={draftT}
              citationsPassed
              capped={false}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="paging" className="flex flex-col gap-4">
        <SheetHeading id="paging" title="Quiet hours" />
        <p className="measure text-base text-ink-2">
          During quiet hours SRE.ai still diagnoses and posts to Slack, but only pages on-call for
          P1 incidents.
        </p>
        <Field label="Workspace timezone" className="max-w-xs">
          {(p) => (
            <Select
              {...p}
              disabled={!canEdit}
              value={draft.timezone}
              onChange={(e) => set('timezone', e.target.value)}
            >
              {(zones.includes(draft.timezone) ? zones : [draft.timezone, ...zones]).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </Select>
          )}
        </Field>
        {canEdit && localZone && localZone !== draft.timezone ? (
          <Button
            size="sm"
            variant="quiet"
            className="w-fit"
            onClick={() => set('timezone', localZone)}
          >
            Use this device’s timezone ({localZone})
          </Button>
        ) : null}
        <ul className="flex flex-col gap-3">
          {draft.silenceWindows.map((w, i) => (
            <li key={i} className="flex flex-wrap items-end gap-3 border-b rule pb-3">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="lettering mb-1.5">Days</legend>
                <div className="flex gap-1">
                  {DAYS.map((d, day) => {
                    const on = w.days.includes(day);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        disabled={!canEdit}
                        onClick={() =>
                          setWindow(i, {
                            days: on ? w.days.filter((x) => x !== day) : [...w.days, day].sort(),
                          })
                        }
                        className={cx(
                          'h-8 w-10 rounded-sm border text-sm',
                          on
                            ? 'border-ink bg-ink text-sheet'
                            : 'rule-strong text-ink-2 hover:text-ink',
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              <Field label="From" className="w-28">
                {(p) => (
                  <Input
                    {...p}
                    type="time"
                    disabled={!canEdit}
                    value={w.start}
                    onChange={(e) => setWindow(i, { start: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Until" className="w-28">
                {(p) => (
                  <Input
                    {...p}
                    type="time"
                    disabled={!canEdit}
                    value={w.end}
                    onChange={(e) => setWindow(i, { end: e.target.value })}
                  />
                )}
              </Field>
              {canEdit ? (
                <Button
                  variant="quiet"
                  aria-label="Remove quiet hours window"
                  icon={<Trash2 aria-hidden className="h-4 w-4" />}
                  onClick={() =>
                    set(
                      'silenceWindows',
                      draft.silenceWindows.filter((_, j) => j !== i),
                    )
                  }
                />
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div>
            <Button
              icon={<Plus aria-hidden className="h-4 w-4" />}
              onClick={() =>
                set('silenceWindows', [
                  ...draft.silenceWindows,
                  { days: [1, 2, 3, 4, 5], start: '22:00', end: '07:00' },
                ])
              }
            >
              Add quiet hours
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="digest" className="flex flex-col gap-4">
        <SheetHeading id="digest" title="Daily digest" />
        <Toggle
          label="Send a digest every morning at 9:00"
          description="Yesterday’s incidents, what SRE.ai fixed on its own, and the MTTR trend — by email and in Slack."
          checked={draft.digestEnabled}
          disabled={!canEdit}
          onChange={(v) => set('digestEnabled', v)}
        />
        <Field
          label="Recipients"
          hint="One email per line. Leave empty to send to owners and admins."
          className="max-w-md"
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              disabled={!canEdit || !draft.digestEnabled}
              value={draft.digestRecipients.join('\n')}
              onChange={(e) => set('digestRecipients', e.target.value.split(/\s+/).filter(Boolean))}
            />
          )}
        </Field>
      </section>

      <section aria-labelledby="team" className="flex flex-col gap-2">
        <SheetHeading id="team" title="Team" />
        {!team ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <ul className="flex flex-col">
            {team.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b rule py-3"
              >
                <span className="text-base text-ink">
                  {m.email}
                  {m.id === user?.id ? <span className="text-ink-3"> (you)</span> : null}
                </span>
                {user?.role === 'owner' && m.id !== user.id ? (
                  <label className="flex items-center gap-2">
                    <span className="sr-only">Role for {m.email}</span>
                    <Select
                      value={m.role}
                      onChange={(e) => void changeRole(m, e.target.value as Role)}
                      className="w-32"
                    >
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </Select>
                  </label>
                ) : (
                  <span className="lettering">{m.role}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
