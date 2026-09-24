import { IncidentSeverity } from '../types';
import {
  capRawPayload,
  computeAlertFingerprint,
  mapSeverity,
  normalizeServiceName,
  normalizeTitleForFingerprint,
} from './alert-normalization';

describe('alert normalization', () => {
  it('normalises service names', () => {
    expect(normalizeServiceName('  Auth Service ')).toBe('auth-service');
    expect(normalizeServiceName('payments_api.v2')).toBe('payments_api.v2');
    expect(normalizeServiceName('')).toBe('unknown-service');
    expect(normalizeServiceName(undefined)).toBe('unknown-service');
  });

  it('strips volatile tokens from titles', () => {
    expect(normalizeTitleForFingerprint('Error rate 5.3% on req 8f3a9b2c1d')).toBe(
      normalizeTitleForFingerprint('Error rate 6.1% on req 91bc77aa00'),
    );
    expect(normalizeTitleForFingerprint('HighCPU')).not.toBe(
      normalizeTitleForFingerprint('HighMemory'),
    );
  });

  it('fingerprints per tenant + service + title', () => {
    const a = computeAlertFingerprint('t1', 'auth-service', 'HighCPU');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAlertFingerprint('t1', 'Auth Service', 'highcpu')).toBe(a);
    expect(computeAlertFingerprint('t2', 'auth-service', 'HighCPU')).not.toBe(a);
    expect(computeAlertFingerprint('t1', 'billing', 'HighCPU')).not.toBe(a);
  });

  it('maps severities', () => {
    expect(mapSeverity('critical')).toBe(IncidentSeverity.P1);
    expect(mapSeverity('WARNING')).toBe(IncidentSeverity.P2);
    expect(mapSeverity('info')).toBe(IncidentSeverity.P3);
    expect(mapSeverity(undefined)).toBe(IncidentSeverity.P3);
  });

  it('caps oversized raw payloads', () => {
    expect(capRawPayload({ a: 1 }, 100)).toEqual({ a: 1 });
    const capped = capRawPayload({ big: 'x'.repeat(1000) }, 100);
    expect(capped.truncated).toBe(true);
  });
});
