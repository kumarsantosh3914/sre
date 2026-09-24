import { AuditLog } from '@sreai/database';
import { AuditActorType } from '@sreai/shared';
import { actorLabel, mdText } from './postmortem.template';

function event(actorType: AuditActorType, actorId: string | null): AuditLog {
  return Object.assign(new AuditLog(), { actorType, actorId });
}

describe('postmortem template', () => {
  it('names actors the way the dashboard does', () => {
    const names = { 'u-1': 'dev@acme.test' };
    expect(actorLabel(event(AuditActorType.SYSTEM, null), names)).toBe('SRE.ai');
    expect(actorLabel(event(AuditActorType.USER, 'u-1'), names)).toBe('dev@acme.test');
    expect(actorLabel(event(AuditActorType.USER, 'u-2'), names)).toBe('Teammate');
    expect(actorLabel(event(AuditActorType.SLACK, 'U42'), names)).toBe('Slack U42');
  });

  it('keeps customer text from breaking the timeline table or injecting HTML', () => {
    expect(mdText('a | b <script>\nnext')).toBe('a \\| b &lt;script&gt; next');
  });
});
