import { IncidentSeverity } from '@sreai/shared';
import { CitationValidationResult } from '../citations/citation-validator';
import { ContextSection, ContextSource, DiagnosisContext } from '../context/context.types';
import { scoreConfidence } from './confidence-scorer';

function section(source: ContextSource, lines: string[] = []): ContextSection {
  return { source, status: lines.length ? 'ok' : 'empty', lines };
}

function context(
  overrides: Partial<DiagnosisContext> = {},
  logs = ['03:12 ERROR boom'],
): DiagnosisContext {
  return {
    incident: {
      id: 'i',
      tenantId: 't',
      title: 'HighCPU',
      description: null,
      severity: IncidentSeverity.P1,
      serviceName: 'auth',
      labels: {},
      detectedAt: new Date(),
      fingerprint: null,
    },
    sections: {
      logs: section('logs', logs),
      metrics: section('metrics'),
      deploy: section('deploy'),
      dependency: section('dependency'),
      similar_incident: section('similar_incident'),
    },
    recentDeploy: null,
    similarIncidents: [],
    pattern: null,
    ...overrides,
  };
}

const clean: CitationValidationResult = {
  checks: [],
  total: 4,
  invalid: 0,
  failureRate: 0,
  passed: true,
};

describe('scoreConfidence', () => {
  it('passes a clean score through unchanged', () => {
    expect(scoreConfidence(0.8, clean, context()).final).toBe(0.8);
  });

  it('penalises by citation failure rate', () => {
    const partial = { ...clean, invalid: 1, failureRate: 0.25 };
    expect(scoreConfidence(0.8, partial, context()).final).toBe(0.6);
  });

  it('boosts for deploy correlation, similar incidents and proven patterns, capped at 1', () => {
    const ctx = context({
      recentDeploy: {
        sha: 'a',
        author: 'x',
        message: 'm',
        committedAt: '',
        minutesBeforeAlert: 5,
        url: null,
        highSignalFiles: [],
      },
      similarIncidents: [
        {
          incidentId: 'p',
          title: 't',
          similarity: 0.9,
          mttrSeconds: 60,
          rootCause: null,
          actionTaken: null,
        },
      ],
      pattern: { actionType: 'restart_service', occurrences: 5, successes: 5 },
    });
    expect(scoreConfidence(0.7, clean, ctx).final).toBe(0.9);
    expect(scoreConfidence(0.95, clean, ctx).final).toBe(1);
  });

  it('ignores patterns without a track record', () => {
    const ctx = context({ pattern: { actionType: 'x', occurrences: 2, successes: 2 } });
    expect(scoreConfidence(0.7, clean, ctx).final).toBe(0.7);
  });

  it('penalises missing logs', () => {
    expect(scoreConfidence(0.8, clean, context({}, [])).final).toBe(0.56);
  });

  it('caps at 0.35 when citations fail — after every boost', () => {
    const failed = { ...clean, invalid: 3, failureRate: 0.2, passed: false };
    const ctx = context({
      similarIncidents: [
        {
          incidentId: 'p',
          title: 't',
          similarity: 0.9,
          mttrSeconds: 60,
          rootCause: null,
          actionTaken: null,
        },
      ],
    });
    const result = scoreConfidence(0.99, failed, ctx);
    expect(result.final).toBe(0.35);
    expect(result.capped).toBe(true);
  });

  it('never lets a hallucinating model reach auto-execute', () => {
    const allBad = { checks: [], total: 3, invalid: 3, failureRate: 1, passed: false };
    expect(scoreConfidence(1, allBad, context()).final).toBeLessThanOrEqual(0.35);
  });
});
