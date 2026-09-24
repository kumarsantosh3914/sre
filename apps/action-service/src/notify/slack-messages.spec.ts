import { Diagnosis, Incident } from '@sreai/database';
import { IncidentSeverity } from '@sreai/shared';
import { escalationMessage, escapeMrkdwn } from './slack-messages';

describe('slack messages', () => {
  it('escapes customer-controlled text so it cannot inject links or mentions', () => {
    expect(escapeMrkdwn('<!channel> <https://evil|click> & more')).toBe(
      '&lt;!channel&gt; &lt;https://evil|click&gt; &amp; more',
    );
  });

  it('builds a context packet with hypothesis, evidence and similar incidents', () => {
    const incident = {
      id: 'i1',
      title: 'HighCPU <!here>',
      severity: IncidentSeverity.P1,
      description: 'CPU > 90%',
    } as Incident;
    const diagnosis = {
      hypothesis: 'Pool exhaustion',
      confidence: 0.42,
      citationsPassed: true,
      recommendedAction: 'INVESTIGATE: check redis',
      evidence: [{ claim: 'pool', source: 'logs', reference: 'pool exhausted' }],
    } as unknown as Diagnosis;
    const message = escalationMessage(
      { incident, serviceName: 'auth', dashboardUrl: 'https://app.sre.ai' },
      {
        reason: 'Low confidence (42%)',
        diagnosis,
        similar: [
          { title: 'HighCPU last week', mttrSeconds: 240, actionTaken: 'Restart ECS service' },
        ],
        runbookTitle: 'Runbook: HighCPU',
        enrichment: { owner: '@platform' },
      },
    );
    const text = JSON.stringify(message.blocks);
    expect(text).toContain('Pool exhaustion');
    expect(text).toContain('Confidence *42%*');
    expect(text).toContain('HighCPU last week');
    expect(text).toContain('Owner: @platform');
    expect(text).toContain('https://app.sre.ai/incidents/i1');
    expect(text).not.toContain('<!here>');
  });
});
