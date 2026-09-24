import { DiagnosisOutput } from '@sreai/shared';
import { RenderedContext } from '../context/context-renderer';
import { CitationValidator, cleanReference, extractInlineCitations } from './citation-validator';

const context: RenderedContext = {
  prompt: '',
  sections: {
    logs: [
      '03:12:01 ERROR redis: connection pool exhausted (max=10)',
      '03:12:02 ERROR   request failed: timeout acquiring connection',
    ],
    metrics: ['cpu: peak 94.0 at 03:12 UTC; baseline 30.1; latest 91.2'],
    deploy: ['commit a1b2c3d by alice (8 min before alert): "reduce redis pool size"'],
    dependency: ['payments-service: unhealthy (timeout after 3000ms)'],
    similar_incident: [],
  },
};

function output(
  evidence: DiagnosisOutput['evidence'],
  hypothesis = 'Redis pool exhaustion after deploy.',
): DiagnosisOutput {
  return {
    hypothesis,
    confidence: 0.9,
    evidence,
    recommended_action: 'REDEPLOY: roll back a1b2c3d',
    action_tier: 'draft',
    reasoning: 'Pool errors started right after the pool size change.',
  };
}

describe('CitationValidator', () => {
  const validator = new CitationValidator();

  it('passes references that appear verbatim in the named section', () => {
    const result = validator.validate(
      output([
        {
          claim: 'Pool exhausted',
          source: 'logs',
          reference: 'redis: connection pool exhausted (max=10)',
        },
        { claim: 'Deploy changed pool', source: 'deploy', reference: '"reduce redis pool size"' },
      ]),
      context,
    );
    expect(result).toMatchObject({ total: 2, invalid: 0, failureRate: 0, passed: true });
  });

  it('tolerates whitespace reflow and echoed line labels, nothing else', () => {
    const result = validator.validate(
      output([
        {
          claim: 'x',
          source: 'logs',
          reference: '[L2] request failed: timeout acquiring connection',
        },
        { claim: 'y', source: 'logs', reference: 'REQUEST FAILED: timeout acquiring connection' },
      ]),
      context,
    );
    expect(result.checks.map((c) => c.valid)).toEqual([true, false]);
  });

  it('flags hallucinated references, wrong sources and trivially short quotes', () => {
    const result = validator.validate(
      output([
        { claim: 'Disk full', source: 'logs', reference: 'No space left on device' },
        { claim: 'CPU high', source: 'logs', reference: 'cpu: peak 94.0 at 03:12 UTC' },
        { claim: 'errors', source: 'logs', reference: 'ERROR' },
      ]),
      context,
    );
    expect(result.checks.map((c) => c.reason)).toEqual([
      'not_found',
      'source_mismatch',
      'too_short',
    ]);
    expect(result.checks[1].foundIn).toBe('metrics');
    expect(result.passed).toBe(false);
  });

  it('fails when more than 30% of citations are invalid, passes at exactly 30% or below', () => {
    const good = { claim: 'g', source: 'logs' as const, reference: 'connection pool exhausted' };
    const bad = { claim: 'b', source: 'logs' as const, reference: 'totally invented log line' };
    // 3 of 10 invalid = 30% → still passes (cap applies only above 30%).
    expect(
      validator.validate(output([...Array(7).fill(good), ...Array(3).fill(bad)]), context).passed,
    ).toBe(true);
    // 2 of 3 invalid ≈ 67% → fails.
    expect(validator.validate(output([good, bad, bad]), context).passed).toBe(false);
  });

  it('also validates inline [SOURCE: …] tags in the hypothesis', () => {
    const result = validator.validate(
      output(
        [{ claim: 'g', source: 'logs', reference: 'connection pool exhausted' }],
        'Pool exhausted [SOURCE: logs, connection pool exhausted] after a bad deploy [SOURCE: deploy, force-pushed to main by bob]',
      ),
      context,
    );
    expect(result.total).toBe(3);
    expect(result.invalid).toBe(1);
    expect(result.checks.find((c) => !c.valid)?.origin).toBe('inline');
  });

  it('treats a source outside the enum as invalid', () => {
    const bad = {
      claim: 'x',
      source: 'intuition',
      reference: 'connection pool exhausted',
    } as unknown as DiagnosisOutput['evidence'][number];
    expect(validator.validate(output([bad]), context).checks[0].reason).toBe('unknown_source');
  });
});

describe('helpers', () => {
  it('cleans references', () => {
    expect(cleanReference('  "[L3] foo   bar"  ')).toBe('foo bar');
    expect(cleanReference('[L3] "foo bar"')).toBe('foo bar');
  });

  it('extracts inline tags', () => {
    expect(
      extractInlineCitations('a [SOURCE: metrics, cpu: peak 94.0] b [source: logs, x y z]'),
    ).toEqual([
      { source: 'metrics', reference: 'cpu: peak 94.0' },
      { source: 'logs', reference: 'x y z' },
    ]);
  });
});
