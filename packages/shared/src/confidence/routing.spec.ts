import { ActionTier } from '../types';
import { mostConservativeTier, resolveThresholds, routeActionTier } from './routing';

describe('routeActionTier', () => {
  it('routes by the CLAUDE.md threshold table', () => {
    expect(routeActionTier(0.9)).toBe(ActionTier.AUTO);
    expect(routeActionTier(0.85)).toBe(ActionTier.DRAFT);
    expect(routeActionTier(0.6)).toBe(ActionTier.DRAFT);
    expect(routeActionTier(0.59)).toBe(ActionTier.ESCALATE);
    expect(routeActionTier(0)).toBe(ActionTier.ESCALATE);
  });

  it('always escalates when the service says so, regardless of confidence', () => {
    expect(routeActionTier(0.99, undefined, { alwaysEscalate: true })).toBe(ActionTier.ESCALATE);
  });

  it('downgrades AUTO to DRAFT when auto-execute is not enabled for the service', () => {
    expect(routeActionTier(0.99, undefined, { autoExecuteEnabled: false })).toBe(ActionTier.DRAFT);
  });

  it('honours tenant thresholds', () => {
    const thresholds = resolveThresholds(0.95, 0.7);
    expect(routeActionTier(0.9, thresholds)).toBe(ActionTier.DRAFT);
    expect(routeActionTier(0.65, thresholds)).toBe(ActionTier.ESCALATE);
  });

  it('falls back to defaults for an inverted threshold pair', () => {
    expect(resolveThresholds(0.5, 0.7)).toEqual({ auto: 0.85, draft: 0.6 });
  });
});

describe('mostConservativeTier', () => {
  it('picks the more cautious tier', () => {
    expect(mostConservativeTier(ActionTier.AUTO, ActionTier.DRAFT)).toBe(ActionTier.DRAFT);
    expect(mostConservativeTier(ActionTier.ESCALATE, ActionTier.AUTO)).toBe(ActionTier.ESCALATE);
    expect(mostConservativeTier(ActionTier.AUTO, ActionTier.AUTO)).toBe(ActionTier.AUTO);
  });
});
