import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY } from '../policy';
import { zonedWallTimeToDate } from '../time';
import { computeUsage, type UsageReservation } from '../usage';

const TZ = DEFAULT_POLICY.timeZone;
const at = (day: number, hour: number, minute = 0) =>
  zonedWallTimeToDate(2026, 3, day, hour, minute, TZ);

const NOW = at(2, 10);

function res(overrides: Partial<UsageReservation> & { id: string }): UsageReservation {
  return {
    startsAt: at(4, 10),
    endsAt: at(4, 13),
    status: 'scheduled',
    priority: 'fun',
    ...overrides,
  };
}

const base = { now: NOW, policy: DEFAULT_POLICY };

describe('computeUsage', () => {
  it('ignores cancelled and preempted reservations', () => {
    const usage = computeUsage(
      [
        res({ id: 'a', status: 'cancelled' }),
        res({ id: 'b', status: 'preempted' }),
        res({ id: 'c', status: 'scheduled' }),
      ],
      { ...base, slotStart: at(4, 14) },
    );
    expect(usage.workingWeekReservations).toBe(1);
  });

  it('counts only upcoming reservations as active', () => {
    const usage = computeUsage(
      [
        res({ id: 'past', startsAt: at(1, 10), endsAt: at(1, 13), status: 'completed' }),
        res({ id: 'future', startsAt: at(4, 10), endsAt: at(4, 13) }),
      ],
      { ...base, slotStart: at(5, 10) },
    );
    expect(usage.activeReservations).toBe(1);
  });

  it('excludes the reservation being edited', () => {
    const usage = computeUsage([res({ id: 'editing' })], {
      ...base,
      slotStart: at(4, 10),
      excludeReservationId: 'editing',
    });
    expect(usage.activeReservations).toBe(0);
    expect(usage.workingWeekReservations).toBe(0);
    expect(usage.monthWorkingMinutes).toBe(0);
  });

  // March 2026 opens on a Sunday: day 4 is a Wednesday, day 6 a Friday and
  // day 8 the Sunday that starts the following week.
  it('counts only daytime working-day prints in the working week', () => {
    const usage = computeUsage(
      [
        res({ id: 'workday', startsAt: at(4, 10), endsAt: at(4, 13) }),
        res({ id: 'night', startsAt: at(3, 20), endsAt: at(4, 6) }),
        res({ id: 'friday', startsAt: at(6, 10), endsAt: at(6, 13) }),
      ],
      { ...base, slotStart: at(5, 10) },
    );
    expect(usage.workingWeekReservations).toBe(1);
  });

  it('starts a fresh working week on Sunday', () => {
    const usage = computeUsage(
      [res({ id: 'lastweek', startsAt: at(4, 10), endsAt: at(4, 13) })],
      { ...base, slotStart: at(9, 10) },
    );
    expect(usage.workingWeekReservations).toBe(0);
  });

  it('charges only working-hours minutes to the monthly budget', () => {
    const usage = computeUsage(
      [
        // 15:00 -> 08:00 contributes its 15:00-17:00 daytime portion only.
        res({ id: 'evening', startsAt: at(4, 15), endsAt: at(5, 8) }),
        res({ id: 'weekend', startsAt: at(7, 9), endsAt: at(7, 15) }),
        res({ id: 'daytime', startsAt: at(9, 9), endsAt: at(9, 12) }),
      ],
      { ...base, slotStart: at(10, 10) },
    );
    expect(usage.monthWorkingMinutes).toBe(120 + 180);
  });

  it('keeps the monthly budget inside the calendar month', () => {
    const usage = computeUsage(
      [
        res({
          id: 'february',
          startsAt: zonedWallTimeToDate(2026, 2, 25, 9, 0, TZ),
          endsAt: zonedWallTimeToDate(2026, 2, 25, 12, 0, TZ),
        }),
        res({ id: 'march', startsAt: at(4, 9), endsAt: at(4, 12) }),
      ],
      { ...base, slotStart: at(10, 10) },
    );
    expect(usage.monthWorkingMinutes).toBe(180);
  });

  it('does not charge work prints against the working-week quota', () => {
    const usage = computeUsage(
      [res({ id: 'work', priority: 'standard' })],
      { ...base, slotStart: at(5, 10) },
    );
    expect(usage.workingWeekReservations).toBe(0);
  });

  it('does not charge urgent prints against the working-week quota', () => {
    const usage = computeUsage(
      [res({ id: 'urgent', priority: 'urgent' })],
      { ...base, slotStart: at(5, 10) },
    );
    expect(usage.workingWeekReservations).toBe(0);
  });

  it('does not charge work or urgent prints against the monthly budget', () => {
    const usage = computeUsage(
      [
        res({ id: 'work', priority: 'standard', startsAt: at(4, 9), endsAt: at(4, 12) }),
        res({ id: 'urgent', priority: 'urgent', startsAt: at(9, 9), endsAt: at(9, 12) }),
      ],
      { ...base, slotStart: at(10, 10) },
    );
    expect(usage.monthWorkingMinutes).toBe(0);
  });

  it('still counts work and urgent prints as active reservations', () => {
    const usage = computeUsage(
      [
        res({ id: 'work', priority: 'standard', startsAt: at(4, 10), endsAt: at(4, 13) }),
        res({ id: 'urgent', priority: 'urgent', startsAt: at(5, 10), endsAt: at(5, 13) }),
      ],
      { ...base, slotStart: at(4, 10) },
    );
    expect(usage.activeReservations).toBe(2);
  });
});
