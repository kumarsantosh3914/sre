import {
  getTraceContext,
  runWithTraceContext,
  sanitizeTraceId,
  updateTraceContext,
} from './trace-context';

describe('trace context', () => {
  it('is undefined outside a run', () => {
    expect(getTraceContext()).toBeUndefined();
  });

  it('propagates through awaits and can be enriched', async () => {
    await runWithTraceContext({ traceId: 'trace-123456' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      updateTraceContext({ tenantId: 't1' });
      await Promise.resolve();
      expect(getTraceContext()).toEqual({ traceId: 'trace-123456', tenantId: 't1' });
    });
  });

  it('isolates concurrent runs', async () => {
    const seen: string[] = [];
    await Promise.all(
      ['aaaaaaaa', 'bbbbbbbb'].map((id) =>
        runWithTraceContext({ traceId: id }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          seen.push(getTraceContext()?.traceId ?? '');
        }),
      ),
    );
    expect(seen.sort()).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });

  it('only trusts well-formed upstream trace ids', () => {
    expect(sanitizeTraceId('abc-DEF_12345')).toBe('abc-DEF_12345');
    expect(sanitizeTraceId('bad id\nwith newline')).not.toContain('\n');
    expect(sanitizeTraceId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
