import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../policy';
import { evaluateBooking } from '../rules';
import { zonedWallTimeToDate } from '../time';
import type {
  BookingContext,
  BookingRequest,
  ExistingReservation,
  MemberProfile,
  PrintPriority,
  UserUsage,
} from '../types';

const TZ = DEFAULT_POLICY.timeZone;
const PRINTER_A = 'printer-a';
const PRINTER_B = 'printer-b';

/** Jerusalem wall-clock time in March 2026. */
const at = (day: number, hour: number, minute = 0) =>
  zonedWallTimeToDate(2026, 3, day, hour, minute, TZ);

/** Monday 2 March 2026, 10:00 local. */
const NOW = at(2, 10);

function makeProfile(overrides: Partial<MemberProfile> = {}): MemberProfile {
  return {
    id: 'user-1',
    email: 'maker@example.com',
    phone: '+972-50-000-0000',
    fullName: 'Test Maker',
    role: 'member',
    isBlocked: false,
    ...overrides,
  };
}

/** A member who has not spent any quota yet. */
function makeUsage(overrides: Partial<UserUsage> = {}): UserUsage {
  return {
    activeReservations: 0,
    workingWeekReservations: 0,
    monthWorkingMinutes: 0,
    ...overrides,
  };
}

function makeReservation(overrides: Partial<ExistingReservation> = {}): ExistingReservation {
  return {
    id: 'res-existing',
    printerId: PRINTER_A,
    userId: 'other-user',
    title: 'Existing print',
    priority: 'fun',
    status: 'scheduled',
    startsAt: at(4, 10),
    endsAt: at(4, 13),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    printerId: PRINTER_A,
    userId: 'user-1',
    title: 'Bracket',
    priority: 'standard' as PrintPriority,
    startsAt: at(4, 10),
    endsAt: at(4, 13),
    ...overrides,
  };
}

function evaluate(
  request: Partial<BookingRequest> = {},
  context: Partial<BookingContext> = {},
) {
  return evaluateBooking(makeRequest(request), {
    now: NOW,
    policy: DEFAULT_POLICY,
    profile: makeProfile(),
    usage: makeUsage(),
    printerReservations: [],
    ...context,
  });
}

const codes = (result: ReturnType<typeof evaluate>) => result.violations.map((v) => v.code);

const GAP_POLICY = { ...DEFAULT_POLICY, bufferMinutes: 5 };

function evaluateWithGap(
  request: Partial<BookingRequest> = {},
  context: Partial<BookingContext> = {},
) {
  return evaluate(request, { policy: GAP_POLICY, ...context });
}

describe('contact details', () => {
  it('allows a well-formed daytime booking', () => {
    const result = evaluate();
    expect(result.violations).toEqual([]);
    expect(result.allowed).toBe(true);
  });

  it('requires a phone number', () => {
    const result = evaluate({}, { profile: makeProfile({ phone: null }) });
    expect(codes(result)).toContain('missing_phone');
    expect(result.allowed).toBe(false);
  });

  it('requires an email address', () => {
    const result = evaluate({}, { profile: makeProfile({ email: null }) });
    expect(codes(result)).toContain('missing_email');
  });

  it('blocks suspended members', () => {
    const result = evaluate({}, { profile: makeProfile({ isBlocked: true }) });
    expect(codes(result)).toContain('member_blocked');
  });
});

describe('slot sanity', () => {
  it('rejects an end before the start', () => {
    const result = evaluate({ startsAt: at(4, 13), endsAt: at(4, 10) });
    expect(codes(result)).toContain('invalid_range');
  });

  it('rejects bookings that are too short', () => {
    const result = evaluate({ startsAt: at(4, 10), endsAt: at(4, 10, 15) });
    expect(codes(result)).toContain('too_short');
  });

  it('rejects times that are off the 5-minute grid', () => {
    const result = evaluate({ startsAt: at(4, 10, 7), endsAt: at(4, 13) });
    expect(codes(result)).toContain('misaligned');
  });

  it('rejects slots in the past', () => {
    const result = evaluate({ startsAt: at(1, 10), endsAt: at(1, 13) });
    expect(codes(result)).toContain('in_the_past');
  });
});

describe('print length and the overnight rule', () => {
  it('allows a short daytime print', () => {
    const result = evaluate({ startsAt: at(4, 10), endsAt: at(4, 13) });
    expect(result.allowed).toBe(true);
    expect(result.classification.isOvernight).toBe(false);
    expect(result.classification.isLongPrint).toBe(false);
  });

  it('suggests the overnight window for a long daytime print', () => {
    // 6h during the day: allowed, but nudged towards the night.
    const result = evaluate({ startsAt: at(4, 10), endsAt: at(4, 16) });
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('consider_overnight');
  });

  it('allows the same long print overnight without the suggestion', () => {
    // 20:00 -> 06:00 is a 10h job fully inside the overnight window.
    const result = evaluate({ startsAt: at(4, 20), endsAt: at(5, 6) });
    expect(result.violations).toEqual([]);
    expect(result.classification.isOvernight).toBe(true);
    expect(result.classification.isLongPrint).toBe(true);
    expect(result.warnings.map((w) => w.code)).not.toContain('consider_overnight');
    expect(result.warnings.map((w) => w.code)).toContain('overnight_unattended');
  });

  it('puts no ceiling on how long a print may run', () => {
    // 18:00 -> 09:00 is 15h: fine, nothing caps the length any more.
    const result = evaluate({ startsAt: at(4, 18), endsAt: at(5, 9) });
    expect(result.allowed).toBe(true);
  });

  it('suggests the night for a long print that merely clips the window', () => {
    // 07:00 -> 21:00 is 14h but only ~21% overnight.
    const result = evaluate({ startsAt: at(4, 7), endsAt: at(4, 21) });
    expect(result.classification.isOvernight).toBe(false);
    expect(result.warnings.map((w) => w.code)).toContain('consider_overnight');
  });

  it('leaves short overnight prints alone', () => {
    const result = evaluate({ startsAt: at(4, 20), endsAt: at(4, 21) });
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((w) => w.code)).not.toContain('consider_overnight');
  });
});

describe('urgent jobs and pre-emption', () => {
  const urgent = {
    priority: 'urgent' as PrintPriority,
    justification: 'Customer demo tomorrow morning',
  };

  it('bumps a fun print', () => {
    const existing = makeReservation({ priority: 'fun' });
    const result = evaluate(urgent, { printerReservations: [existing] });

    expect(result.allowed).toBe(true);
    expect(result.preemptions).toHaveLength(1);
    expect(result.preemptions[0].id).toBe(existing.id);
    expect(result.warnings.map((w) => w.code)).toContain('will_preempt');
  });

  it('does not bump another work print', () => {
    const result = evaluate(urgent, {
      printerReservations: [makeReservation({ priority: 'standard' })],
    });
    expect(codes(result)).toContain('slot_taken');
    expect(result.preemptions).toEqual([]);
  });

  it('does not bump another urgent print', () => {
    const result = evaluate(urgent, {
      printerReservations: [makeReservation({ priority: 'urgent' })],
    });
    expect(codes(result)).toContain('slot_taken');
  });

  it('never bumps a print that is already running', () => {
    const result = evaluate(urgent, {
      printerReservations: [makeReservation({ priority: 'fun', status: 'in_progress' })],
    });
    expect(codes(result)).toContain('in_progress_conflict');
    expect(result.preemptions).toEqual([]);
  });

  it('does not let a fun print bump anything', () => {
    const result = evaluate(
      { priority: 'fun' },
      { printerReservations: [makeReservation({ priority: 'fun' })] },
    );
    expect(codes(result)).toContain('slot_taken');
  });

  it('requires a justification note', () => {
    const result = evaluate({ priority: 'urgent' });
    expect(codes(result)).toContain('urgent_needs_justification');
  });

  it('never limits how many urgent prints you may book', () => {
    const result = evaluate(urgent, {
      printerReservations: [
        makeReservation({ id: 'earlier', startsAt: at(4, 2), endsAt: at(4, 5) }),
      ],
    });
    expect(result.allowed).toBe(true);
  });

  it('ignores cancelled and already-preempted reservations', () => {
    const result = evaluate(
      {},
      {
        printerReservations: [
          makeReservation({ id: 'a', status: 'cancelled' }),
          makeReservation({ id: 'b', status: 'preempted' }),
        ],
      },
    );
    expect(result.allowed).toBe(true);
  });
});

describe('printer isolation', () => {
  it('treats the two printers independently', () => {
    const result = evaluate(
      { printerId: PRINTER_B },
      { printerReservations: [makeReservation({ printerId: PRINTER_A })] },
    );
    expect(result.allowed).toBe(true);
  });

  it('blocks double-booking yourself', () => {
    const result = evaluate(
      {},
      { printerReservations: [makeReservation({ userId: 'user-1', title: 'My other print' })] },
    );
    expect(codes(result)).toContain('self_conflict');
  });

  it('skips its own row when editing an existing booking', () => {
    const existing = makeReservation({ id: 'res-1', userId: 'user-1' });
    const result = evaluate(
      { reservationId: 'res-1' },
      { printerReservations: [existing] },
    );
    expect(result.allowed).toBe(true);
  });
});

describe('cleaning gap between prints', () => {
  it('allows back-to-back bookings by default', () => {
    const result = evaluate(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 7), endsAt: at(4, 10), title: 'Earlier' }),
          makeReservation({ id: 'res-later', startsAt: at(4, 13), endsAt: at(4, 16) }),
        ],
      },
    );
    expect(codes(result)).not.toContain('buffer_gap');
    expect(result.allowed).toBe(true);
  });

  it('rejects a booking that starts the moment another ends', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 7), endsAt: at(4, 10), title: 'Earlier' }),
        ],
      },
    );
    expect(codes(result)).toContain('buffer_gap');
  });

  it('allows a booking that starts exactly one gap later', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 7), endsAt: at(4, 9, 55) }),
        ],
      },
    );
    expect(codes(result)).not.toContain('buffer_gap');
    expect(result.allowed).toBe(true);
  });

  it('rejects a booking that ends too close to the next print', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 13, 3), endsAt: at(4, 16), title: 'Later' }),
        ],
      },
    );
    expect(codes(result)).toContain('buffer_gap');
  });

  it('allows a booking that ends exactly one gap before the next print', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 13, 5), endsAt: at(4, 16) }),
        ],
      },
    );
    expect(result.allowed).toBe(true);
  });

  it('applies the gap to your own back-to-back prints', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ userId: 'user-1', startsAt: at(4, 7), endsAt: at(4, 10) }),
        ],
      },
    );
    expect(codes(result)).toContain('buffer_gap');
  });

  it('needs no gap from a print on the other machine', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ printerId: PRINTER_B, startsAt: at(4, 7), endsAt: at(4, 10) }),
        ],
      },
    );
    expect(result.allowed).toBe(true);
  });

  it('needs no gap from a cancelled print', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 7), endsAt: at(4, 10), status: 'cancelled' }),
        ],
      },
    );
    expect(result.allowed).toBe(true);
  });

  it('does not double-report a gap for a slot that is simply taken', () => {
    const result = evaluateWithGap(
      {},
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 11), endsAt: at(4, 12), priority: 'standard' }),
        ],
      },
    );
    expect(codes(result)).toContain('slot_taken');
    expect(codes(result)).not.toContain('buffer_gap');
  });

  it('asks for no gap from the print it is bumping', () => {
    const result = evaluateWithGap(
      { priority: 'urgent', justification: 'Demo tomorrow' },
      {
        printerReservations: [
          makeReservation({ startsAt: at(4, 10), endsAt: at(4, 13), priority: 'fun' }),
        ],
      },
    );
    expect(codes(result)).not.toContain('buffer_gap');
    expect(result.preemptions).toHaveLength(1);
    expect(result.allowed).toBe(true);
  });
});

describe('the open 24h window', () => {
  it('lets anyone take a free slot inside the window', () => {
    const result = evaluate(
      { startsAt: at(2, 19), endsAt: at(2, 22) },
      {
        usage: makeUsage({
          workingWeekReservations: 5,
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap,
          activeReservations: 9,
        }),
      },
    );
    expect(result.classification.isOpenBooking).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain('open_booking');
  });

  it('books any date in the future without a horizon limit', () => {
    const result = evaluate({ startsAt: at(120, 10), endsAt: at(120, 13) });
    expect(result.allowed).toBe(true);
  });

  it('still refuses a taken slot inside the 24h window', () => {
    const result = evaluate(
      { startsAt: at(2, 19), endsAt: at(2, 22) },
      {
        printerReservations: [
          makeReservation({ startsAt: at(2, 19), endsAt: at(2, 22), priority: 'standard' }),
        ],
      },
    );
    expect(codes(result)).toContain('slot_taken');
  });

  it('still enforces the cleaning gap inside the 24h window', () => {
    const result = evaluateWithGap(
      { startsAt: at(2, 19), endsAt: at(2, 22) },
      {
        printerReservations: [
          makeReservation({ startsAt: at(2, 15), endsAt: at(2, 19) }),
        ],
      },
    );
    expect(codes(result)).toContain('buffer_gap');
  });
});

describe('volume quotas', () => {
  it('limits how many upcoming prints a member may hold', () => {
    const result = evaluate(
      {},
      {
        usage: makeUsage({
          activeReservations: DEFAULT_POLICY.maxActiveReservations,
        }),
      },
    );
    expect(codes(result)).toContain('too_many_active');
  });

  it('allows a member who is one under the open-booking cap', () => {
    const result = evaluate(
      {},
      {
        usage: makeUsage({
          activeReservations: DEFAULT_POLICY.maxActiveReservations - 1,
        }),
      },
    );
    expect(codes(result)).not.toContain('too_many_active');
    expect(result.allowed).toBe(true);
  });
});

/**
 * March 2026 starts on a Sunday, so day 4 is a Wednesday (working day) and
 * day 6 is a Friday (weekend).
 */
describe('working-week and monthly budgets', () => {
  it('allows the first daytime print of the working week', () => {
    const result = evaluate({}, { usage: makeUsage({ workingWeekReservations: 0 }) });
    expect(codes(result)).not.toContain('working_week_print_cap');
    expect(result.allowed).toBe(true);
  });

  it('rejects a second daytime print in the same working week', () => {
    const result = evaluate({}, { usage: makeUsage({ workingWeekReservations: 1 }) });
    expect(codes(result)).toContain('working_week_print_cap');
  });

  it('does not count a night print against the working-week limit', () => {
    const result = evaluate(
      { startsAt: at(4, 20), endsAt: at(5, 6) },
      { usage: makeUsage({ workingWeekReservations: 1 }) },
    );
    expect(result.classification.isWorkingDaytime).toBe(false);
    expect(codes(result)).not.toContain('working_week_print_cap');
    expect(result.allowed).toBe(true);
  });

  it('does not count a weekend print against the working-week limit', () => {
    const result = evaluate(
      { startsAt: at(6, 10), endsAt: at(6, 13) },
      { usage: makeUsage({ workingWeekReservations: 1 }) },
    );
    expect(result.classification.isWorkingDaytime).toBe(false);
    expect(codes(result)).not.toContain('working_week_print_cap');
    expect(result.allowed).toBe(true);
  });

  it('enforces the monthly working-hours cap', () => {
    const result = evaluate(
      {},
      {
        usage: makeUsage({
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap - 60,
        }),
      },
    );
    expect(codes(result)).toContain('monthly_cap');
  });

  it('allows a daytime print that exactly fills the monthly budget', () => {
    const result = evaluate(
      {},
      {
        usage: makeUsage({
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap - 180,
        }),
      },
    );
    expect(codes(result)).not.toContain('monthly_cap');
    expect(result.allowed).toBe(true);
  });

  it('charges only the daytime part of a print to the monthly budget', () => {
    const result = evaluate(
      // 15:00 -> 08:00 next day: only 15:00-17:00 is working-hours time.
      { startsAt: at(4, 15), endsAt: at(5, 8) },
      {
        usage: makeUsage({
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap - 180,
        }),
      },
    );
    expect(result.classification.workingDaytimeMinutes).toBe(120);
    expect(codes(result)).not.toContain('monthly_cap');
  });

  it('ignores a fully overnight print for the monthly budget', () => {
    const result = evaluate(
      { startsAt: at(4, 20), endsAt: at(5, 6) },
      {
        usage: makeUsage({
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap,
        }),
      },
    );
    expect(result.classification.workingDaytimeMinutes).toBe(0);
    expect(codes(result)).not.toContain('monthly_cap');
    expect(result.allowed).toBe(true);
  });

  it('waives both budgets inside the open window', () => {
    const result = evaluate(
      { startsAt: at(3, 9), endsAt: at(3, 12) },
      {
        usage: makeUsage({
          workingWeekReservations: 5,
          monthWorkingMinutes: DEFAULT_POLICY.monthlyWorkingMinutesCap,
        }),
      },
    );
    expect(result.classification.isOpenBooking).toBe(true);
    expect(result.allowed).toBe(true);
  });
});
