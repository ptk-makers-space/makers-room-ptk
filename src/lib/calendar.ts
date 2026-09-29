import {
  getZonedParts,
  overlapMinutes,
  zonedStartOfDay,
  zonedWallTimeToDate,
} from '@/lib/scheduling';

const DAY_MINUTES = 24 * 60;

/** Local midnight for each of the 7 days in the week containing `reference`. */
export function buildWeekDays(
  reference: Date,
  timeZone: string,
  weekStartsOn: number = 0,
): Date[] {
  const startOfReference = zonedStartOfDay(reference, timeZone);
  // getUTCDay on a local-midnight instant is unreliable across offsets, so
  // derive the weekday from the zoned calendar date instead.
  const parts = getZonedParts(startOfReference, timeZone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const delta = (weekday - weekStartsOn + 7) % 7;

  return Array.from({ length: 7 }, (_, index) =>
    zonedWallTimeToDate(parts.year, parts.month, parts.day - delta + index, 0, 0, timeZone),
  );
}

export function addWeeks(reference: Date, weeks: number, timeZone: string): Date {
  const parts = getZonedParts(reference, timeZone);
  return zonedWallTimeToDate(
    parts.year,
    parts.month,
    parts.day + weeks * 7,
    0,
    0,
    timeZone,
  );
}

export interface DaySegment<T> {
  item: T;
  dayIndex: number;
  /** Minutes from local midnight on that day. */
  startMinutes: number;
  endMinutes: number;
  /** False when the block continues from the previous day. */
  isStart: boolean;
  /** False when the block continues into the next day. */
  isEnd: boolean;
}

/**
 * Split bookings into per-day pieces so an overnight print renders as a block
 * in each day column it touches.
 */
export function splitIntoDaySegments<T>(
  items: T[],
  weekDays: Date[],
  getRange: (item: T) => { start: Date; end: Date },
  timeZone: string,
): DaySegment<T>[] {
  const segments: DaySegment<T>[] = [];

  weekDays.forEach((dayStart, dayIndex) => {
    const parts = getZonedParts(dayStart, timeZone);
    const dayEnd = zonedWallTimeToDate(
      parts.year,
      parts.month,
      parts.day + 1,
      0,
      0,
      timeZone,
    );

    for (const item of items) {
      const range = getRange(item);
      if (overlapMinutes(range, { start: dayStart, end: dayEnd }) <= 0) continue;

      const clippedStart = Math.max(range.start.getTime(), dayStart.getTime());
      const clippedEnd = Math.min(range.end.getTime(), dayEnd.getTime());

      segments.push({
        item,
        dayIndex,
        startMinutes: (clippedStart - dayStart.getTime()) / 60_000,
        endMinutes: (clippedEnd - dayStart.getTime()) / 60_000,
        isStart: clippedStart === range.start.getTime(),
        isEnd: clippedEnd === range.end.getTime(),
      });
    }
  });

  return segments;
}

/** Percentage offsets used to position a block inside a day column. */
export function segmentGeometry(segment: DaySegment<unknown>) {
  const top = (segment.startMinutes / DAY_MINUTES) * 100;
  const height = ((segment.endMinutes - segment.startMinutes) / DAY_MINUTES) * 100;
  return { top, height };
}

export function formatDayHeading(day: Date, timeZone: string): { weekday: string; date: string } {
  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone }).format(day),
    date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone }).format(day),
  };
}

/** Minutes elapsed since local midnight for `date` in `timeZone` (0–1440). */
export function minutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  return parts.hour * 60 + parts.minute + parts.second / 60;
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date);
}

export function formatRangeLabel(days: Date[], timeZone: string): string {
  if (days.length === 0) return '';
  const first = days[0];
  const last = days[days.length - 1];
  const fmt = (date: Date, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone,
    }).format(date);
  return `${fmt(first, false)} – ${fmt(last, true)}`;
}

/** `YYYY-MM-DD` in the facility timezone, used for week links. */
export function toDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parse a `YYYY-MM-DD` key back into local midnight. */
export function fromDateKey(key: string | undefined, timeZone: string): Date {
  if (!key) return new Date();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return new Date();
  return zonedWallTimeToDate(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    12,
    0,
    timeZone,
  );
}
