/**
 * Build an RFC 5545 iCalendar file for a single print booking.
 *
 * Pure and dependency-free so it can be unit tested without the database.
 * Times are emitted in UTC, which every calendar client converts to the
 * viewer's own zone, so no VTIMEZONE block is needed.
 */

export interface ReservationCalendarEvent {
  id: string;
  title: string;
  notes: string | null;
  printerName: string;
  ownerName: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Last modification time of the booking, used for DTSTAMP / SEQUENCE. */
  updatedAt: Date;
  /** Absolute link back to the app, e.g. https://makers-room-ptk.vercel.app/my-prints */
  url: string | null;
}

/** 20260304T121500Z — the UTC "basic" form that iCalendar requires. */
export function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Escape commas, semicolons, backslashes and newlines per RFC 5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line to 75 octets per RFC 5545 §3.1 (continuation = CRLF + space). */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    // Never split a multi-byte UTF-8 sequence: back up to a boundary byte.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    chunks.push(decoder.decode(bytes.subarray(offset, end)));
    offset = end;
    limit = 74; // the leading space on continuation lines counts toward 75
  }
  return chunks.join('\r\n ');
}

export function buildReservationIcs(event: ReservationCalendarEvent): string {
  const description = [
    `Printer: ${event.printerName}`,
    event.ownerName ? `Booked by: ${event.ownerName}` : null,
    event.notes?.trim() ? `Notes: ${event.notes.trim()}` : null,
    event.url,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MakersRoom PTK//Print booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:reservation-${event.id}@makers-room-ptk`,
    `DTSTAMP:${toIcsUtc(event.updatedAt)}`,
    `SEQUENCE:${Math.floor(event.updatedAt.getTime() / 1000)}`,
    `DTSTART:${toIcsUtc(event.startsAt)}`,
    `DTEND:${toIcsUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(`3D print: ${event.title}`)}`,
    `LOCATION:${escapeIcsText(`MakersRoom PTK · ${event.printerName}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    event.url ? `URL:${event.url}` : null,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT1H',
    `DESCRIPTION:${escapeIcsText(`Your print "${event.title}" starts in 1 hour`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter((line): line is string => line !== null);

  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * A safe, descriptive download name such as `print-benchy-2026-03-04.ics`.
 *
 * ASCII only: this goes into an HTTP header, which rejects anything else
 * (a Hebrew title would otherwise crash the response).
 */
export function icsFileName(title: string, startsAt: Date): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const day = startsAt.toISOString().slice(0, 10);
  return `print-${slug || 'booking'}-${day}.ics`;
}
