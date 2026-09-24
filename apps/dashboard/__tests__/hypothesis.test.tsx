import { render, screen } from '@testing-library/react';
import { Hypothesis, evidenceRows } from '@/components/incident/diagnosis-view';
import type { Diagnosis } from '@/lib/types';

const poolLine = 'ERROR redis: connection pool exhausted (max=10), waited 5000ms';
const diagnosis: Diagnosis = {
  id: 'd1',
  // The inline tag quotes a shorter slice of the first evidence line.
  hypothesis: `The Redis pool is exhausted [SOURCE: logs, redis: connection pool exhausted (max=10)].`,
  confidence: 0.9,
  llmConfidence: 0.9,
  evidence: [
    { claim: 'Pool hit its limit', source: 'logs', reference: poolLine },
    {
      claim: 'Logins fail with 503',
      source: 'logs',
      reference: 'POST /login 503 upstream timeout',
    },
  ],
  recommendedAction: 'SCALE_SERVICE: add one task',
  actionTier: 'auto',
  reasoning: '',
  citationsPassed: true,
  citationFailureRate: 0,
  citationFailures: [],
  citationChecks: [],
  scoring: null,
  collectors: [],
  recentDeploy: null,
  similarIncidentIds: [],
  model: null,
  promptVersion: null,
  tokenUsage: null,
  latencyMs: null,
  createdAt: '2026-09-24T19:37:47Z',
};

describe('Hypothesis', () => {
  it('gives each evidence row exactly one balloon, even when the inline tag quotes a slice', () => {
    render(
      <Hypothesis
        diagnosis={diagnosis}
        rows={evidenceRows(diagnosis)}
        active={null}
        setActive={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button', { name: /^Evidence 1:/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Evidence 2:/ })).toHaveLength(1);
  });

  it('binds the balloons and the full stop to the last word so none wrap alone', () => {
    render(
      <Hypothesis
        diagnosis={diagnosis}
        rows={evidenceRows(diagnosis)}
        active={null}
        setActive={() => undefined}
      />,
    );
    const group = screen.getByRole('button', { name: /^Evidence 2:/ }).parentElement;
    expect(group).toHaveClass('whitespace-nowrap');
    expect(group?.textContent).toMatch(/^exhausted.*\.$/);
    expect(group?.querySelectorAll('button')).toHaveLength(2);
  });
});
