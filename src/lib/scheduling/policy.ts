import type { SchedulingPolicy } from './types';

/**
 * House rules for MakersRoom PTK.
 *
 * Every value here is also stored in the `policy_settings` table so admins can
 * tune the rules without a redeploy; this object is the fallback/default and
 * the single source of truth for the shape of a policy.
 */
export const DEFAULT_POLICY: SchedulingPolicy = {
  timeZone: 'Asia/Jerusalem',

  slotGranularityMinutes: 5,
  minReservationMinutes: 30,
  // Back-to-back bookings are allowed; admins may add a gap from the admin page.
  bufferMinutes: 0,

  // Prints are never capped for length. Past this we suggest running overnight,
  // which is also free of the daytime quotas.
  longPrintThresholdMinutes: 5 * 60,

  overnightStartHour: 17,
  overnightEndHour: 8,
  overnightCoverageRatio: 0.7,

  primeTimeStartHour: 8,
  primeTimeEndHour: 17,

  // Sunday .. Thursday. Friday, Saturday and every night are free capacity.
  workingDays: [0, 1, 2, 3, 4],
  maxPrintsPerWorkingWeek: 1,
  monthlyWorkingMinutesCap: 10 * 60,
  maxActiveReservations: 5,

  openBookingHours: 24,

  urgentRequiresJustification: true,

  // Urgent work jobs bump hobby prints, never other work.
  preemptibleBy: {
    urgent: ['fun'],
    standard: [],
    fun: [],
  },
  allowPreemptInProgress: false,
};

export const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent work',
  standard: 'Work',
  fun: 'Fun',
};

/** Merge a partial policy (e.g. from the DB) over the defaults. */
export function resolvePolicy(overrides?: Partial<SchedulingPolicy> | null): SchedulingPolicy {
  if (!overrides) return DEFAULT_POLICY;
  return {
    ...DEFAULT_POLICY,
    ...overrides,
    preemptibleBy: { ...DEFAULT_POLICY.preemptibleBy, ...(overrides.preemptibleBy ?? {}) },
  };
}
