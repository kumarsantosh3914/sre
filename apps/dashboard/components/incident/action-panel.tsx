'use client';

import { ArrowRight, CircleCheck, Play, RotateCcw, ShieldAlert, TimerReset } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ACTION_LABEL, TIER_LABEL, actor, duration } from '@/lib/format';
import type { Action, ActionType, IncidentDetail } from '@/lib/types';
import { Button } from '../ui/button';
import { cx } from '../ui/cx';
import { Field, Select, Textarea } from '../ui/field';
import { useToast } from '../ui/toast';

const REVERSIBLE = new Set(['scale_service']);
const EXECUTABLE: readonly ActionType[] = [
  'restart_service',
  'scale_service',
  'flush_cache',
  'redeploy',
];

function executable(value: string | undefined): ActionType | null {
  return EXECUTABLE.find((t) => t === value) ?? null;
}
const ROLLBACK_WINDOW_MS = 60 * 60 * 1000;

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function Cell({
  title,
  children,
  tone,
  id,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'signal';
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cx('sheet registered scroll-mt-20', tone === 'signal' && 'border-signal')}
    >
      <div className="flex items-center justify-between border-b rule-strong px-4 py-2">
        <h2 className="lettering">{title}</h2>
      </div>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

// The loudest thing on the sheet: what needs a human, and the one control
// that does it. Everything else about the incident is supporting evidence.
export function ActionPanel({
  incident,
  names = {},
  onChanged,
}: {
  incident: IncidentDetail;
  names?: Record<string, string>;
  onChanged: () => void;
}) {
  const toast = useToast();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [manual, setManual] = useState<string>('');
  const [note, setNote] = useState('');

  const pending =
    incident.actions.find((a) => a.status === 'pending' && a.tier === 'draft') ?? null;
  const reversible =
    [...incident.actions]
      .reverse()
      .find(
        (a) =>
          a.status === 'executed' &&
          REVERSIBLE.has(a.actionType) &&
          a.executedAt !== null &&
          now - new Date(a.executedAt).getTime() < ROLLBACK_WINDOW_MS,
      ) ?? null;
  const lastExecuted =
    [...incident.actions]
      .reverse()
      .find((a) => a.status === 'executed' && a.actionType !== 'escalate') ?? null;

  // Why SRE.ai stepped back, in its own words from the escalation record.
  const escalation =
    [...incident.actions].reverse().find((a) => a.actionType === 'escalate') ?? null;
  const why = escalation
    ? escalation.description
        .replace(/^Escalated to on-call:\s*/i, '')
        .replace(/^\w/, (c) => c.toUpperCase())
    : null;
  const recommended = incident.diagnosis?.recommendedAction
    .match(/^([A-Z_]+)\s*:/)?.[1]
    .toLowerCase();
  const runnable = executable(recommended);

  const run = async (key: string, path: string, body: object, ok: string): Promise<void> => {
    setBusy(key);
    try {
      await api(path, { method: 'POST', json: body });
      toast('ok', ok);
      onChanged();
    } catch (err) {
      toast('fault', err instanceof Error ? err.message : 'That didn’t go through.');
    } finally {
      setBusy(null);
    }
  };

  if (incident.status === 'resolved') {
    return (
      <Cell title="Resolution">
        <p className="flex items-center gap-2 text-md text-ink">
          <CircleCheck aria-hidden className="h-5 w-5 text-ok" /> Resolved in{' '}
          {duration(incident.mttrSeconds)}
        </p>
        {lastExecuted ? (
          <p className="text-base text-ink-2">Fixed by: {lastExecuted.description}</p>
        ) : null}
        {incident.resolutionNote ? (
          <p className="text-base text-ink-2">Note: {incident.resolutionNote}</p>
        ) : null}
        {incident.hasPostmortem ? (
          <Link href="#postmortem" className="text-base font-medium text-ink underline">
            Read the post-mortem
          </Link>
        ) : (
          <p className="text-sm text-ink-3">The post-mortem is being written.</p>
        )}
      </Cell>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {pending ? (
        <Cell id="decide" title="Needs your approval" tone="signal">
          <PendingAction action={pending} now={now} />
          {rejecting ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  'reject',
                  `/incidents/${incident.id}/actions/${pending.id}/reject`,
                  { reason: reason || undefined },
                  'Rejected — the incident has been escalated to on-call.',
                );
              }}
            >
              <Field
                label="Why reject? (optional)"
                hint="Rejecting pages the on-call engineer with the full context."
              >
                {(p) => (
                  <Textarea
                    {...p}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" loading={busy === 'reject'}>
                  Reject and escalate
                </Button>
                <Button variant="quiet" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="signal"
                size="lg"
                className="flex-1"
                loading={busy === 'approve'}
                onClick={() =>
                  void run(
                    'approve',
                    `/incidents/${incident.id}/actions/${pending.id}/approve`,
                    {},
                    'Approved — SRE.ai is running it now.',
                  )
                }
              >
                Approve · {ACTION_LABEL[pending.actionType]}
              </Button>
              <Button variant="line" size="lg" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          )}
        </Cell>
      ) : null}

      {reversible ? (
        <Cell
          id={pending ? undefined : 'decide'}
          title="Auto-executed"
          tone={pending ? undefined : 'signal'}
        >
          <p className="text-base text-ink">{reversible.description}</p>
          <p className="flex items-center gap-1.5 text-sm text-ink-2">
            <TimerReset aria-hidden className="h-4 w-4" />
            Rollback available for{' '}
            {duration(
              Math.max(
                0,
                Math.round(
                  (ROLLBACK_WINDOW_MS -
                    (now - new Date(reversible.executedAt as string).getTime())) /
                    1000,
                ),
              ),
            )}
          </p>
          {confirmRollback ? (
            <div className="flex flex-col gap-2 border border-dashed border-signal/60 p-3">
              <p className="text-sm text-ink">
                This reverts the action and hands the incident to a human.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="signal"
                  loading={busy === 'rollback'}
                  icon={<RotateCcw aria-hidden className="h-4 w-4" />}
                  onClick={() =>
                    void run(
                      'rollback',
                      `/incidents/${incident.id}/actions/${reversible.id}/rollback`,
                      {},
                      'Rolling back — you now own this incident.',
                    )
                  }
                >
                  Roll back now
                </Button>
                <Button variant="quiet" onClick={() => setConfirmRollback(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant={pending ? 'line' : 'signal'}
              size="lg"
              icon={<RotateCcw aria-hidden className="h-4 w-4" />}
              onClick={() => setConfirmRollback(true)}
            >
              Roll back
            </Button>
          )}
        </Cell>
      ) : null}

      {!pending && !reversible ? (
        <Cell
          title={incident.status === 'escalated' ? 'Handed to you' : 'In progress'}
          tone={incident.status === 'escalated' ? 'signal' : undefined}
        >
          {incident.status === 'escalated' ? (
            <div className="flex flex-col gap-1">
              <p className="text-md font-medium text-ink">
                SRE.ai stopped short of acting on its own.
              </p>
              {why ? (
                <p className="text-base text-ink-2">
                  <span className="font-medium text-ink">Why: </span>
                  {why}
                </p>
              ) : null}
              {why && /not configured/i.test(why) && incident.service ? (
                <Link
                  href="/services"
                  className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink underline"
                >
                  Configure {incident.service.name}{' '}
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="text-base text-ink-2">
              {incident.diagnosis
                ? `Routed as: ${TIER_LABEL[incident.diagnosis.actionTier]}. Nothing is waiting on you right now.`
                : 'SRE.ai is still collecting context. Nothing is waiting on you yet.'}
            </p>
          )}
          {incident.status === 'escalated' && runnable ? (
            <div className="flex flex-col gap-1.5">
              <Button
                variant="signal"
                size="lg"
                loading={busy === 'recommended'}
                icon={<Play aria-hidden className="h-4 w-4" />}
                onClick={() =>
                  void run(
                    'recommended',
                    `/incidents/${incident.id}/actions`,
                    { actionType: runnable },
                    'Queued — SRE.ai will run the pre-checks first.',
                  )
                }
              >
                Run recommended · {ACTION_LABEL[runnable]}
              </Button>
              <p className="text-sm text-ink-3">
                Pre-checks still apply; the run is logged with your name.
              </p>
            </div>
          ) : null}
          {lastExecuted ? (
            <p className="text-sm text-ink-2">
              Last action: {lastExecuted.description} ({actor(lastExecuted.requestedBy, names)})
            </p>
          ) : null}
        </Cell>
      ) : null}

      {pending || reversible ? (
        <DecisionBar label={pending ? 'Needs your approval' : 'Rollback available'} />
      ) : null}

      <Cell title="Take over">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!manual) return;
            void run(
              'manual',
              `/incidents/${incident.id}/actions`,
              { actionType: manual, note: note || undefined },
              manual === 'escalate'
                ? 'Escalated to on-call.'
                : 'Queued — SRE.ai will run the pre-checks first.',
            ).then(() => setManual(''));
          }}
        >
          <Field
            label="Run an action"
            hint="Pre-checks still apply. Every run is logged with your name."
          >
            {(p) => (
              <Select {...p} value={manual} onChange={(e) => setManual(e.target.value)}>
                <option value="">Choose…</option>
                <option value="restart_service">Restart service</option>
                <option value="scale_service">Scale out by one task</option>
                <option value="flush_cache">Flush allowlisted cache pattern</option>
                <option value="redeploy">Re-run deploy workflow</option>
                <option value="escalate">Page on-call now</option>
              </Select>
            )}
          </Field>
          {manual ? (
            <Button
              type="submit"
              variant={manual === 'escalate' ? 'signal' : 'ink'}
              loading={busy === 'manual'}
              icon={
                manual === 'escalate' ? <ShieldAlert aria-hidden className="h-4 w-4" /> : undefined
              }
            >
              {manual === 'escalate' ? 'Page on-call' : 'Run it'}
            </Button>
          ) : null}
        </form>
        <form
          className="flex flex-col gap-3 border-t rule pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'resolve',
              `/incidents/${incident.id}/resolve`,
              { note: note || undefined },
              'Marked resolved. The post-mortem is on its way.',
            );
          }}
        >
          <Field label="Resolution note">
            {(p) => (
              <Textarea
                {...p}
                rows={2}
                placeholder="What fixed it?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" variant="line" loading={busy === 'resolve'}>
            Mark resolved
          </Button>
        </form>
      </Cell>
    </div>
  );
}

// Phone only: while the decision cell is off screen, a bar pinned to the
// bottom jumps straight to it — a Slack link never ends in a hunt.
function DecisionBar({ label }: { label: string }) {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const cell = document.getElementById('decide');
    if (!cell) return;
    const io = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting));
    io.observe(cell);
    return () => io.disconnect();
  }, []);
  if (hidden) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-signal bg-sheet px-4 py-3 lg:hidden">
      <a
        href="#decide"
        className="flex min-h-11 w-full items-center justify-center gap-2 border border-signal bg-signal px-4 text-base font-semibold text-signal-ink"
      >
        {label} — review
      </a>
    </div>
  );
}

function PendingAction({ action, now }: { action: Action; now: number }) {
  const left = action.expiresAt
    ? Math.max(0, Math.round((new Date(action.expiresAt).getTime() - now) / 1000))
    : null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-md font-medium text-ink">{action.description}</p>
      {left !== null ? (
        <p className="text-sm text-ink-2">
          Escalates automatically in <span className="font-mono text-ink">{duration(left)}</span> if
          nobody decides.
        </p>
      ) : null}
    </div>
  );
}
