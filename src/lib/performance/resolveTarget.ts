import type { PerformanceTarget, TargetKind } from './types';

function asTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export function isTargetEffective(target: PerformanceTarget, at: string | Date = new Date()): boolean {
  const atTime = asTime(at);
  if (atTime === null) return false;
  const fromTime = asTime(target.effectiveFrom) ?? Number.NEGATIVE_INFINITY;
  const toTime = asTime(target.effectiveTo) ?? Number.POSITIVE_INFINITY;
  return fromTime <= atTime && atTime < toTime;
}

export function resolveTarget(
  targets: PerformanceTarget[],
  options: {
    metricId: string;
    targetKind?: TargetKind;
    campaignId?: string | null;
    at?: string | Date;
  }
): PerformanceTarget | null {
  const effectiveTargets = targets
    .filter((target) => target.metricId === options.metricId)
    .filter((target) => !options.targetKind || target.targetKind === options.targetKind)
    .filter((target) => isTargetEffective(target, options.at ?? new Date()))
    .sort((left, right) => {
      const leftFrom = asTime(left.effectiveFrom) ?? 0;
      const rightFrom = asTime(right.effectiveFrom) ?? 0;
      return rightFrom - leftFrom;
    });

  if (options.campaignId) {
    const campaignOverride = effectiveTargets.find((target) => target.campaignId === options.campaignId);
    if (campaignOverride) return campaignOverride;
  }

  return effectiveTargets.find((target) => !target.campaignId) ?? null;
}
