import 'server-only';

import { computeUsage, formatMinutes, type SchedulingPolicy } from '@/lib/scheduling';
import type { UsageReservation } from '@/lib/scheduling/usage';
import type { ProfileRow, ReservationRow } from '@/lib/supabase/types';
import type { ViewerSummary } from '@/components/calendar-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build the header/summary view of the signed-in member, including how much of
 * each quota they have spent so far.
 */
export function buildViewerSummary(
  profile: ProfileRow,
  reservations: ReservationRow[],
  policy: SchedulingPolicy,
  now: Date = new Date(),
): ViewerSummary {
  const usageReservations: UsageReservation[] = reservations.map((row) => ({
    id: row.id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
    priority: row.priority,
  }));

  const usage = computeUsage(usageReservations, {
    now,
    // Quotas are reported for the week and month we are currently in.
    slotStart: now,
    policy,
  });

  const monthRemaining = Math.max(
    policy.monthlyWorkingMinutesCap - usage.monthWorkingMinutes,
    0,
  );

  return {
    id: profile.id,
    name: profile.full_name || profile.email || 'Member',
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    monthlyBudgetLabel: `${formatMinutes(monthRemaining)} of daytime budget left`,
    quotaExplanation:
      `Daytime fun prints this working week: ${usage.workingWeekReservations}/${policy.maxPrintsPerWorkingWeek} · ` +
      `working hours used this month on fun prints: ${formatMinutes(usage.monthWorkingMinutes)} of ${formatMinutes(
        policy.monthlyWorkingMinutesCap,
      )} · open bookings: ${usage.activeReservations}/${policy.maxActiveReservations}. ` +
      `Work and urgent prints are unlimited and never count towards these quotas. Nights and weekends do not count, and any free slot inside ${policy.openBookingHours}h is always yours to take.`,
  };
}

/**
 * Window of a member's history wide enough to report their quota usage: the
 * calendar month around today, plus room for bookings made further ahead.
 */
export function usageHistoryRange(now: Date = new Date()) {
  return {
    from: new Date(now.getTime() - 45 * DAY_MS),
    to: new Date(now.getTime() + 60 * DAY_MS),
  };
}
