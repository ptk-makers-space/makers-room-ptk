import { describe, expect, it } from 'vitest';

import { buildWeekDays, splitIntoDaySegments, toDateKey } from '@/lib/calendar';
import { zonedWallTimeToDate } from '@/lib/scheduling';

const TZ = 'Asia/Jerusalem';
const at = (day: number, hour: number, minute = 0) =>
  zonedWallTimeToDate(2026, 3, day, hour, minute, TZ);

describe('buildWeekDays', () => {
  it('returns seven local midnights starting on Sunday', () => {
    // 2026-03-04 is a Wednesday; its week starts Sunday 2026-03-01.
    const days = buildWeekDays(at(4, 15), TZ);
    expect(days).toHaveLength(7);
    expect(toDateKey(days[0], TZ)).toBe('2026-03-01');
    expect(toDateKey(days[6], TZ)).toBe('2026-03-07');
  });

  it('keeps a day that is already the week start', () => {
    const days = buildWeekDays(at(1, 9), TZ);
    expect(toDateKey(days[0], TZ)).toBe('2026-03-01');
  });

  it('spans the DST change without losing a day', () => {
    // Israel springs forward on 2026-03-27.
    const days = buildWeekDays(zonedWallTimeToDate(2026, 3, 28, 12, 0, TZ), TZ);
    expect(days.map((d) => toDateKey(d, TZ))).toEqual([
      '2026-03-22',
      '2026-03-23',
      '2026-03-24',
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
    ]);
  });
});

describe('splitIntoDaySegments', () => {
  const week = buildWeekDays(at(4, 12), TZ);
  const range = (item: { start: Date; end: Date }) => item;

  it('keeps a daytime print in a single column', () => {
    const segments = splitIntoDaySegments(
      [{ start: at(4, 10), end: at(4, 13) }],
      week,
      range,
      TZ,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].startMinutes).toBe(600);
    expect(segments[0].endMinutes).toBe(780);
    expect(segments[0].isStart).toBe(true);
    expect(segments[0].isEnd).toBe(true);
  });

  it('splits an overnight print across two columns', () => {
    const segments = splitIntoDaySegments(
      [{ start: at(4, 20), end: at(5, 6) }],
      week,
      range,
      TZ,
    );
    expect(segments).toHaveLength(2);

    const [first, second] = segments;
    expect(first.dayIndex + 1).toBe(second.dayIndex);
    expect(first.startMinutes).toBe(1200);
    expect(first.endMinutes).toBe(1440);
    expect(first.isStart).toBe(true);
    expect(first.isEnd).toBe(false);

    expect(second.startMinutes).toBe(0);
    expect(second.endMinutes).toBe(360);
    expect(second.isStart).toBe(false);
    expect(second.isEnd).toBe(true);
  });

  it('clips a print that starts before the visible week', () => {
    const segments = splitIntoDaySegments(
      [{ start: zonedWallTimeToDate(2026, 2, 28, 22, 0, TZ), end: at(1, 4) }],
      week,
      range,
      TZ,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].dayIndex).toBe(0);
    expect(segments[0].startMinutes).toBe(0);
    expect(segments[0].isStart).toBe(false);
  });

  it('places blocks by wall-clock time on the autumn DST day', () => {
    // Israel falls back on 2026-10-25, making it a 25-hour day.
    const oct = (hour: number) => zonedWallTimeToDate(2026, 10, 25, hour, 0, TZ);
    const segments = splitIntoDaySegments(
      [{ start: oct(8), end: oct(10) }],
      buildWeekDays(oct(12), TZ),
      range,
      TZ,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].startMinutes).toBe(480);
    expect(segments[0].endMinutes).toBe(600);
  });

  it('ignores prints outside the week', () => {
    const segments = splitIntoDaySegments(
      [{ start: at(20, 10), end: at(20, 12) }],
      week,
      range,
      TZ,
    );
    expect(segments).toEqual([]);
  });
});
