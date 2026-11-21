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
    createdAt: new Date(row.created_at),
    cancelPenaltyMinutes: row.cancel_penalty_minutes ?? 0,
    overrunPenaltyMinutes: row.overrun_penalty_minutes ?? 0,
  }));

  const usage = computeUsage(usageReservations, {
    now,
    // Quotas are reported for the week and month we are currently in.
    slotStart: now,
    policy,
  });

  // May go negative when penalties exceed the budget; the deficit carries into next month.
  const monthRemaining = policy.monthlyWorkingMinutesCap - usage.monthWorkingMinutes;

  return {
    id: profile.id,
    name: profile.full_name || profile.email || 'Member',
    email: profile.email,
    phone: profile.phone,
    role: profile.role,
    isBlocked: profile.is_blocked,
    budget: {
      usedMinutes: usage.monthWorkingMinutes,
      capMinutes: policy.monthlyWorkingMinutesCap,
      remainingMinutes: monthRemaining,
      nightsUsed: usage.monthOvernightPrints,
      nightsCap: policy.maxOvernightPrintsPerMonth,
    },
    quotaExplanation:
      `Daytime fun prints this working week: ${usage.workingWeekReservations}/${policy.maxPrintsPerWorkingWeek} · ` +
      `working hours used this month on fun prints: ${formatMinutes(usage.monthWorkingMinutes)} of ${formatMinutes(
        policy.monthlyWorkingMinutesCap,
      )} · overnight fun prints this month: ${usage.monthOvernightPrints}/${policy.maxOvernightPrintsPerMonth} · open bookings: ${usage.activeReservations}/${policy.maxActiveReservations}. ` +
      `Work and urgent prints are unlimited and never count towards these quotas. Weekends do not count, any free slot inside ${policy.openBookingHours}h is always yours to take, and a free night slot inside ${policy.overnightOpenBookingHours}h skips the night limit. ` +
      `Cancelling a fun print within ${policy.lateCancelHours}h of its start costs ${Math.round(policy.lateCancelPenaltyRatio * 100)}% of its length from your monthly budget, and a print that has started cannot be cancelled.`,
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
