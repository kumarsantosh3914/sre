import { Logger as WinstonLogger } from 'winston';
import { NestStructuredLogger } from './structured-logger.service';

describe('NestStructuredLogger', () => {
  const log = jest.fn();
  const logger = new NestStructuredLogger({ log } as unknown as WinstonLogger);

  beforeEach(() => log.mockReset());

  it('flattens meta objects to top level and keeps the context name', () => {
    logger.log('Processing incident', { tenantId: 't1', incidentId: 'i1' }, 'IncidentService');
    expect(log).toHaveBeenCalledWith('info', 'Processing incident', {
      tenantId: 't1',
      incidentId: 'i1',
      context: 'IncidentService',
    });
  });

  it('turns Errors into error/stack fields', () => {
    logger.error('Failed', new Error('boom'), 'Worker');
    const [, , meta] = log.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(meta.error).toBe('boom');
    expect(meta.stack).toEqual(expect.any(String));
    expect(meta.context).toBe('Worker');
  });

  it('handles Nest-style error(message, stack, context)', () => {
    logger.error('Failed', 'stack-trace', 'Bootstrap');
    expect(log).toHaveBeenCalledWith('error', 'Failed', {
      stack: 'stack-trace',
      context: 'Bootstrap',
    });
  });
});
