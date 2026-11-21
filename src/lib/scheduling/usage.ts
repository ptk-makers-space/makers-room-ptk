import {
  overnightMinutes,
  startsInWorkingDaytime,
  workingDaytimeMinutes,
  zonedStartOfMonth,
  zonedStartOfNextMonth,
  zonedStartOfWeek,
} from './time';

import type { PrintPriority, ReservationStatus, SchedulingPolicy, UserUsage } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** A member's own reservation, as needed to derive usage statistics. */
export interface UsageReservation {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
  priority: PrintPriority;
  createdAt?: Date;
  /** Minutes charged for cancelling late; only set on cancelled rows. */
  cancelPenaltyMinutes?: number;
  /** Minutes charged because this print overran into the next booking. */
  overrunPenaltyMinutes?: number;
}

/** Statuses that count towards a member's usage. */
const COUNTED_STATUSES = new Set<ReservationStatus>([
  'scheduled',
  'in_progress',
  'completed',
]);

function counts(reservation: UsageReservation): boolean {
  return COUNTED_STATUSES.has(reservation.status);
}

/**
 * Daytime prints the member already holds in the Sun-Saturday calendar week
 * containing `slotStart`. Nights and weekends are excluded, so only prints
 * starting in working hours on a working day are counted.
 */
function workingWeekReservations(
  reservations: UsageReservation[],
  slotStart: Date,
  policy: SchedulingPolicy,
): number {
  const weekStart = zonedStartOfWeek(slotStart, policy.timeZone).getTime();
  const weekEnd = weekStart + WEEK_MS;

  return reservations.filter((reservation) => {
    const start = reservation.startsAt.getTime();
    if (start < weekStart || start >= weekEnd) return false;
    return startsInWorkingDaytime(
      reservation.startsAt,
      policy.primeTimeStartHour,
      policy.primeTimeEndHour,
      policy.workingDays,
      policy.timeZone,
    );
  }).length;
}

/**
 * Working-hours minutes the member has already booked inside the calendar
 * month containing `slotStart`. Only the daytime-on-a-working-day portion of
 * each print is charged to the monthly budget.
 */
function monthWorkingMinutes(
  reservations: UsageReservation[],
  slotStart: Date,
  policy: SchedulingPolicy,
): number {
  const monthStart = zonedStartOfMonth(slotStart, policy.timeZone);
  const monthEnd = zonedStartOfNextMonth(slotStart, policy.timeZone);

  return reservations.reduce((sum, reservation) => {
    // Clip to the month so a print spanning the boundary only spends the
    // budget of the month it actually runs in.
    const start = new Date(Math.max(reservation.startsAt.getTime(), monthStart.getTime()));
    const end = new Date(Math.min(reservation.endsAt.getTime(), monthEnd.getTime()));
    if (end.getTime() <= start.getTime()) return sum;

    return (
      sum +
      workingDaytimeMinutes(
        { start, end },
        policy.primeTimeStartHour,
        policy.primeTimeEndHour,
        policy.workingDays,
        policy.timeZone,
      )
    );
  }, 0);
}

/** Late-cancellation and overrun penalties charged to the month containing `slotStart`. */
function monthPenaltyMinutes(
  reservations: UsageReservation[],
  slotStart: Date,
  policy: SchedulingPolicy,
): number {
  const monthStart = zonedStartOfMonth(slotStart, policy.timeZone).getTime();
  const monthEnd = zonedStartOfNextMonth(slotStart, policy.timeZone).getTime();

  return reservations.reduce((sum, reservation) => {
    const start = reservation.startsAt.getTime();
    if (start < monthStart || start >= monthEnd) return sum;
    const cancel = reservation.status === 'cancelled' ? (reservation.cancelPenaltyMinutes ?? 0) : 0;
    return sum + cancel + (reservation.overrunPenaltyMinutes ?? 0);
  }, 0);
}

/**
 * Budget the member went into minus last month because of penalties. Only the
 * penalty-driven part carries over, so legitimate open-slot use never does.
 */
function carriedDeficitMinutes(
  quotaRelevant: UsageReservation[],
  all: UsageReservation[],
  slotStart: Date,
  policy: SchedulingPolicy,
): number {
  const lastMonth = new Date(zonedStartOfMonth(slotStart, policy.timeZone).getTime() - DAY_MS);
  const penalties = monthPenaltyMinutes(all, lastMonth, policy);
  if (penalties === 0) return 0;
  const used = monthWorkingMinutes(quotaRelevant, lastMonth, policy) + penalties;
  return Math.min(penalties, Math.max(0, used - policy.monthlyWorkingMinutesCap));
}

/**
 * Overnight prints starting in the month containing `slotStart`. Ones booked
 * inside the overnight open window were free and are not counted.
 */
function monthOvernightPrints(
  reservations: UsageReservation[],
  slotStart: Date,
  policy: SchedulingPolicy,
): number {
  const monthStart = zonedStartOfMonth(slotStart, policy.timeZone).getTime();
  const monthEnd = zonedStartOfNextMonth(slotStart, policy.timeZone).getTime();
  const openMs = policy.overnightOpenBookingHours * 60 * 60 * 1000;

  return reservations.filter((reservation) => {
    const start = reservation.startsAt.getTime();
    if (start < monthStart || start >= monthEnd) return false;
    if (reservation.createdAt && start - reservation.createdAt.getTime() <= openMs) return false;

    const total = (reservation.endsAt.getTime() - start) / 60_000;
    if (total <= 0) return false;
    const night = overnightMinutes(
      { start: reservation.startsAt, end: reservation.endsAt },
      policy.overnightStartHour,
      policy.overnightEndHour,
      policy.timeZone,
    );
    return night / total >= policy.overnightCoverageRatio;
  }).length;
}

/**
 * Turn a member's reservation history into the aggregates the rules engine
 * needs. `slotStart` is the start of the booking being evaluated.
 */
export function computeUsage(
  reservations: UsageReservation[],
  options: {
    now: Date;
    slotStart: Date;
    policy: SchedulingPolicy;
    /** Reservation being edited, excluded so it does not count against itself. */
    excludeReservationId?: string | null;
  },
): UserUsage {
  const { now, slotStart, policy, excludeReservationId } = options;

  const relevant = reservations.filter(
    (r) => counts(r) && r.id !== excludeReservationId,
  );

  // Work and urgent prints are unlimited and never touch the working-hours
  // quotas: only fun prints are charged against the weekly and monthly caps.
  const quotaRelevant = relevant.filter((r) => r.priority === 'fun');

  return {
    activeReservations: relevant.filter(
      (r) =>
        (r.status === 'scheduled' || r.status === 'in_progress') &&
        r.endsAt.getTime() > now.getTime(),
    ).length,
    workingWeekReservations: workingWeekReservations(quotaRelevant, slotStart, policy),
    monthWorkingMinutes:
      monthWorkingMinutes(quotaRelevant, slotStart, policy) +
      monthPenaltyMinutes(reservations, slotStart, policy) +
      carriedDeficitMinutes(quotaRelevant, reservations, slotStart, policy),
    monthOvernightPrints: monthOvernightPrints(quotaRelevant, slotStart, policy),
  };
}
