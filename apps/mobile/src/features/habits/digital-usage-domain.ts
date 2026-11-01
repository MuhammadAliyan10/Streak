export type DigitalUsageStatus = 'below_so_far' | 'within_limit' | 'over_limit' | 'unknown';

export function digitalTrackingCapability(platform: string) {
  return {
    manual: true as const,
    automatic: false as const,
    reason:
      platform === 'android'
        ? 'Android Usage Access needs a native integration and explicit user authorization.'
        : platform === 'ios'
          ? 'iOS usage reports require Family Controls entitlement and keep report data sandboxed.'
          : 'Automatic device usage is unavailable on this platform.',
  };
}

/** A partial log is not a confirmed daily total, even when it is below the limit. */
export function digitalUsageStatus(input: {
  observed: number | null;
  limit: number;
  confirmed: boolean;
}): DigitalUsageStatus {
  if (input.observed === null || !Number.isFinite(input.observed)) return 'unknown';
  if (input.observed > input.limit) return 'over_limit';
  return input.confirmed ? 'within_limit' : 'below_so_far';
}

/** A confirmed total replaces increments for that day; it is never added to them. */
export function effectiveDigitalUsage(input: {
  dailyTotal: number | null;
  increments: readonly number[];
}): number | null {
  if (input.dailyTotal !== null) return input.dailyTotal;
  if (!input.increments.length) return null;
  return input.increments.reduce((sum, amount) => sum + amount, 0);
}

export function digitalUsageOutcome(value: number, limit: number) {
  return {
    status: value > limit ? ('over_limit' as const) : ('within_limit' as const),
    remaining: Math.max(0, limit - value),
    excess: Math.max(0, value - limit),
  };
}
