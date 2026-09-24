import { ActionType } from '@sreai/shared';
import { classifyRecommendedAction, pickCachePattern } from './action-planner';

describe('classifyRecommendedAction', () => {
  it('trusts the verb prefix the prompt asks for', () => {
    expect(classifyRecommendedAction('RESTART_SERVICE: restart auth-service').type).toBe(
      ActionType.RESTART_SERVICE,
    );
    expect(classifyRecommendedAction('SCALE_SERVICE: add one task').type).toBe(
      ActionType.SCALE_SERVICE,
    );
    expect(classifyRecommendedAction('FLUSH_CACHE: session:*').type).toBe(ActionType.FLUSH_CACHE);
    expect(classifyRecommendedAction('REDEPLOY: re-run the deploy workflow').type).toBe(
      ActionType.REDEPLOY,
    );
  });

  it('treats INVESTIGATE as non-executable', () => {
    expect(
      classifyRecommendedAction('INVESTIGATE: check the payments provider status page'),
    ).toEqual({
      type: null,
      reason: 'diagnosis recommends manual investigation',
    });
  });

  it('falls back to unambiguous keywords only', () => {
    expect(classifyRecommendedAction('Restart the auth service pods').type).toBe(
      ActionType.RESTART_SERVICE,
    );
    expect(
      classifyRecommendedAction('Restart the service and then roll back the deploy').type,
    ).toBeNull();
    expect(classifyRecommendedAction('Drop the users table').type).toBeNull();
  });
});

describe('pickCachePattern', () => {
  it('only ever returns an allowlisted pattern', () => {
    const metadata = { cacheFlushPatterns: ['session:*', 'feature-flags:*'] };
    expect(pickCachePattern('FLUSH_CACHE: clear feature-flags:*', metadata)).toBe(
      'feature-flags:*',
    );
    expect(pickCachePattern('FLUSH_CACHE: clear *', metadata)).toBeNull();
    expect(pickCachePattern('FLUSH_CACHE: clear it', { cacheFlushPatterns: ['session:*'] })).toBe(
      'session:*',
    );
    expect(pickCachePattern('FLUSH_CACHE: clear it', {})).toBeNull();
  });
});
