import {
  addMinutes,
  durationMinutes,
  getZonedParts,
  hoursBetween,
  intervalsOverlap,
  isAlignedToGranularity,
  overnightMinutes,
  startsInPrimeTime,
  startsInWorkingDaytime,
  workingDaytimeMinutes,
  type Interval,
} from './time';
import type {
  BookingContext,
  BookingDecision,
  BookingRequest,
  ExistingReservation,
  RuleViolation,
  SchedulingPolicy,
  SlotClassification,
} from './types';

/** Statuses that still occupy time on a printer. */
const BLOCKING_STATUSES = new Set(['scheduled', 'in_progress']);

function error(code: string, message: string): RuleViolation {
  return { code, message, severity: 'error' };
}

function warn(code: string, message: string): RuleViolation {
  return { code, message, severity: 'warning' };
}

export function formatMinutes(total: number): string {
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Local `HH:MM` for a rule message. */
function formatClock(date: Date, timeZone: string): string {
  const { hour, minute } = getZonedParts(date, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * True when `interval` sits closer than `bufferMinutes` to `neighbour`,
 * measured from whichever edges face each other.
 */
function isWithinBuffer(
  interval: Interval,
  neighbour: { startsAt: Date; endsAt: Date },
  bufferMinutes: number,
): boolean {
  return intervalsOverlap(
    { start: interval.start, end: addMinutes(interval.end, bufferMinutes) },
    { start: neighbour.startsAt, end: addMinutes(neighbour.endsAt, bufferMinutes) },
  );
}

/**
 * Describe the requested slot: how long it is, how much of it lands overnight,
 * and whether it falls inside the open (free-for-all) window.
 */
export function classifySlot(
  request: Pick<BookingRequest, 'startsAt' | 'endsAt'>,
  policy: SchedulingPolicy,
  now: Date,
): SlotClassification {
  const interval = { start: request.startsAt, end: request.endsAt };
  const total = durationMinutes(interval);
  const overnight =
    total > 0
      ? overnightMinutes(interval, policy.overnightStartHour, policy.overnightEndHour, policy.timeZone)
      : 0;
  const ratio = total > 0 ? overnight / total : 0;
  const leadTimeHours = hoursBetween(now, request.startsAt);

  return {
    durationMinutes: total,
    overnightMinutes: overnight,
    overnightRatio: ratio,
    isOvernight: ratio >= policy.overnightCoverageRatio,
    isLongPrint: total > policy.longPrintThresholdMinutes,
    isPrimeTime: startsInPrimeTime(
      request.startsAt,
      policy.primeTimeStartHour,
      policy.primeTimeEndHour,
      policy.timeZone,
    ),
    workingDaytimeMinutes:
      total > 0
        ? workingDaytimeMinutes(
            interval,
            policy.primeTimeStartHour,
            policy.primeTimeEndHour,
            policy.workingDays,
            policy.timeZone,
          )
        : 0,
    isWorkingDaytime: startsInWorkingDaytime(
      request.startsAt,
      policy.primeTimeStartHour,
      policy.primeTimeEndHour,
      policy.workingDays,
      policy.timeZone,
    ),
    leadTimeHours,
    isOpenBooking: leadTimeHours <= policy.openBookingHours,
  };
}

/**
 * Evaluate a booking request against every house rule.
 *
 * Returns the full picture rather than throwing, so the UI can show all the
 * reasons a slot is unavailable at once, plus any prints that would be bumped.
 */
export function evaluateBooking(
  request: BookingRequest,
  context: BookingContext,
): BookingDecision {
  const { policy, profile, usage, now } = context;
  const violations: RuleViolation[] = [];
  const warnings: RuleViolation[] = [];

  const classification = classifySlot(request, policy, now);
  const { durationMinutes: minutes, isOpenBooking } = classification;

  // --- Member eligibility -------------------------------------------------
  if (profile.isBlocked) {
    violations.push(
      error('member_blocked', 'Your account is suspended. Contact a makerspace admin.'),
    );
  }
  if (!profile.email) {
    violations.push(error('missing_email', 'Add an email address to your profile first.'));
  }
  if (!profile.phone) {
    violations.push(
      error(
        'missing_phone',
        'Add a phone number to your profile so we can reach you if a print fails.',
      ),
    );
  }
  if (!request.title.trim()) {
    violations.push(error('missing_title', 'Give your print a short name.'));
  }

  // --- Slot sanity --------------------------------------------------------
  if (minutes <= 0) {
    violations.push(error('invalid_range', 'The end time must be after the start time.'));
  }
  if (minutes > 0 && minutes < policy.minReservationMinutes) {
    violations.push(
      error(
        'too_short',
        `Minimum booking is ${formatMinutes(policy.minReservationMinutes)}.`,
      ),
    );
  }
  if (
    !isAlignedToGranularity(request.startsAt, policy.slotGranularityMinutes, policy.timeZone) ||
    !isAlignedToGranularity(request.endsAt, policy.slotGranularityMinutes, policy.timeZone)
  ) {
    violations.push(
      error(
        'misaligned',
        `Bookings must start and end on ${policy.slotGranularityMinutes}-minute boundaries.`,
      ),
    );
  }
  if (request.startsAt.getTime() <= now.getTime()) {
    violations.push(error('in_the_past', 'Pick a slot that starts in the future.'));
  }

  // --- Print length -------------------------------------------------------
  // There is no cap on how long a print may be: a long job is simply nudged
  // towards the night, where it also costs nothing from the daytime quotas.
  if (minutes > 0 && classification.isLongPrint) {
    if (classification.isOvernight) {
      warnings.push(
        warn(
          'overnight_unattended',
          'Long overnight print: make sure the bed is clear and filament is loaded before you leave.',
        ),
      );
    } else {
      warnings.push(
        warn(
          'consider_overnight',
          `This print runs for ${formatMinutes(
            minutes,
          )}. Prints over ${formatMinutes(policy.longPrintThresholdMinutes)} are best started in the overnight window (${policy.overnightStartHour}:00–${policy.overnightEndHour}:00): the machine is free anyway, and night hours do not use your daytime quota, so your working-week print stays available.`,
        ),
      );
    }
  }

  // --- Urgent work --------------------------------------------------------
  // Urgent is unlimited; it only has to say why, so the bumped owner knows.
  if (request.priority === 'urgent') {
    if (policy.urgentRequiresJustification && !request.justification?.trim()) {
      violations.push(
        error(
          'urgent_needs_justification',
          'Urgent prints need a short note explaining the deadline.',
        ),
      );
    }
  }

  // --- Quota limits -------------------------------------------------------
  // Inside the open window every free slot is fair game, so these are skipped.
  if (isOpenBooking) {
    warnings.push(
      warn(
        'open_booking',
        `This slot starts within ${policy.openBookingHours}h, so it is open to any member regardless of quota.`,
      ),
    );
  } else {
    if (usage.activeReservations >= policy.maxActiveReservations) {
      violations.push(
        error(
          'too_many_active',
          `You already hold ${usage.activeReservations} upcoming prints; the limit is ${policy.maxActiveReservations}.`,
        ),
      );
    }

    // Working-week and monthly budgets only charge for daytime Sun-Thu use:
    // nights and weekends stay free so the machines keep running. Work and
    // urgent prints are unlimited and never subject to these caps — only
    // fun prints are rationed.
    if (
      request.priority === 'fun' &&
      classification.isWorkingDaytime &&
      usage.workingWeekReservations >= policy.maxPrintsPerWorkingWeek
    ) {
      violations.push(
        error(
          'working_week_print_cap',
          `Daytime prints are limited to ${policy.maxPrintsPerWorkingWeek} per working week (Sun–Thu) and you already have ${usage.workingWeekReservations} this week. Nights and weekends do not count — book one of those instead.`,
        ),
      );
    }

    const monthMinutes = classification.workingDaytimeMinutes;
    if (
      request.priority === 'fun' &&
      monthMinutes > 0 &&
      usage.monthWorkingMinutes + monthMinutes > policy.monthlyWorkingMinutesCap
    ) {
      violations.push(
        error(
          'monthly_cap',
          `This would put you at ${formatMinutes(
            usage.monthWorkingMinutes + monthMinutes,
          )} of working-hours printing this month; the limit is ${formatMinutes(
            policy.monthlyWorkingMinutesCap,
          )}. Nights and weekends do not count towards it.`,
        ),
      );
    }
  }

  // --- Conflicts and pre-emption -----------------------------------------
  const preemptions: ExistingReservation[] = [];
  const requested = { start: request.startsAt, end: request.endsAt };

  const neighbours = context.printerReservations.filter(
    (reservation) =>
      reservation.printerId === request.printerId &&
      reservation.id !== request.reservationId &&
      BLOCKING_STATUSES.has(reservation.status),
  );

  const conflicts = neighbours.filter((reservation) =>
    intervalsOverlap(requested, {
      start: reservation.startsAt,
      end: reservation.endsAt,
    }),
  );

  const canPreempt = policy.preemptibleBy[request.priority] ?? [];

  for (const conflict of conflicts) {
    if (conflict.userId === request.userId) {
      violations.push(
        error(
          'self_conflict',
          `This overlaps your own booking "${conflict.title}". Cancel or edit that one instead.`,
        ),
      );
      continue;
    }

    if (!canPreempt.includes(conflict.priority)) {
      violations.push(
        error(
          'slot_taken',
          `This printer is already booked for "${conflict.title}". Pick another time or the second printer.`,
        ),
      );
      continue;
    }

    const hasStarted =
      conflict.status === 'in_progress' || conflict.startsAt.getTime() <= now.getTime();
    if (hasStarted && !policy.allowPreemptInProgress) {
      violations.push(
        error(
          'in_progress_conflict',
          `"${conflict.title}" is already running and cannot be bumped. Book after it finishes.`,
        ),
      );
      continue;
    }

    preemptions.push(conflict);
  }

  if (preemptions.length > 0) {
    warnings.push(
      warn(
        'will_preempt',
        `This urgent job will bump ${preemptions.length} fun print${
          preemptions.length === 1 ? '' : 's'
        }. We will email and text the owner${preemptions.length === 1 ? '' : 's'} automatically.`,
      ),
    );
  }

  // --- Cleaning gap between prints ---------------------------------------
  // Bookings that merely sit too close (rather than overlapping) get their own
  // message: the fix is to shift by a few minutes, not to pick another day.
  // Overlapping rows are skipped — they already reported slot_taken, or are
  // being bumped and so free the machine entirely.
  if (policy.bufferMinutes > 0 && minutes > 0) {
    const overlapping = new Set(conflicts.map((conflict) => conflict.id));

    for (const neighbour of neighbours) {
      if (overlapping.has(neighbour.id)) continue;
      if (!isWithinBuffer(requested, neighbour, policy.bufferMinutes)) continue;

      const isBefore = neighbour.endsAt.getTime() <= request.startsAt.getTime();
      violations.push(
        error(
          'buffer_gap',
          isBefore
            ? `Leave ${policy.bufferMinutes} minutes to clear the bed after "${neighbour.title}". Start at ${formatClock(
                addMinutes(neighbour.endsAt, policy.bufferMinutes),
                policy.timeZone,
              )} or later.`
            : `Leave ${policy.bufferMinutes} minutes before "${neighbour.title}" starts. End by ${formatClock(
                addMinutes(neighbour.startsAt, -policy.bufferMinutes),
                policy.timeZone,
              )} or pick another slot.`,
        ),
      );
    }
  }

  return {
    allowed: violations.length === 0,
    classification,
    violations,
    warnings,
    preemptions,
  };
}
