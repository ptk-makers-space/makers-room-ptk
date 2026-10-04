import { describe, expect, it } from 'vitest';

import {
  buildReservationIcs,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
  toIcsUtc,
} from '@/lib/ics';

const event = {
  id: '6f1c2a9e-0000-4000-8000-000000000001',
  title: 'Benchy, v2; final',
  notes: 'PLA\nblack',
  printerName: 'Prusa MK4',
  ownerName: 'Dana',
  startsAt: new Date('2026-03-04T10:15:00.000Z'),
  endsAt: new Date('2026-03-04T13:45:00.000Z'),
  updatedAt: new Date('2026-03-01T08:00:00.000Z'),
  url: 'https://makers-room-ptk.vercel.app/my-prints',
};

describe('toIcsUtc', () => {
  it('emits the basic UTC form', () => {
    expect(toIcsUtc(new Date('2026-03-04T10:15:30.123Z'))).toBe('20260304T101530Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes reserved characters and newlines', () => {
    expect(escapeIcsText('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf');
  });
});

describe('foldIcsLine', () => {
  it('leaves short lines alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines at 75 octets with a leading space', () => {
    const folded = foldIcsLine(`DESCRIPTION:${'x'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toHaveLength(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(
      `DESCRIPTION:${'x'.repeat(200)}`,
    );
  });

  it('never splits a multi-byte character', () => {
    const hebrew = `SUMMARY:${'שלום '.repeat(30)}`;
    const folded = foldIcsLine(hebrew);
    const unfolded = folded.split('\r\n ').join('');
    expect(unfolded).toBe(hebrew);
    expect(folded).not.toContain('\uFFFD');
  });
});

describe('buildReservationIcs', () => {
  const ics = buildReservationIcs(event);

  it('is a complete VCALENDAR with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('carries the booking times in UTC', () => {
    expect(ics).toContain('DTSTART:20260304T101500Z');
    expect(ics).toContain('DTEND:20260304T134500Z');
    expect(ics).toContain('DTSTAMP:20260301T080000Z');
  });

  it('uses a stable UID so re-importing updates rather than duplicates', () => {
    expect(ics).toContain(`UID:reservation-${event.id}@makers-room-ptk`);
    expect(buildReservationIcs({ ...event, updatedAt: new Date() })).toContain(
      `UID:reservation-${event.id}@makers-room-ptk`,
    );
  });

  it('escapes the title and folds notes into the description', () => {
    expect(ics).toContain('SUMMARY:3D print: Benchy\\, v2\\; final');
    expect(ics).toContain('Printer: Prusa MK4\\nBooked by: Dana\\nNotes: PLA\\nblack');
    expect(ics).toContain('URL:https://makers-room-ptk.vercel.app/my-prints');
  });

  it('includes a one-hour display alarm', () => {
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H');
  });

  it('omits optional fields when absent', () => {
    const bare = buildReservationIcs({ ...event, notes: null, ownerName: null, url: null });
    expect(bare).not.toContain('URL:');
    expect(bare).not.toContain('Booked by');
    expect(bare).not.toContain('Notes:');
  });
});

describe('icsFileName', () => {
  it('slugifies the title and appends the start date', () => {
    expect(icsFileName('Benchy, v2; final', event.startsAt)).toBe(
      'print-benchy-v2-final-2026-03-04.ics',
    );
  });

  it('falls back when the title has no usable characters', () => {
    expect(icsFileName('!!!', event.startsAt)).toBe('print-booking-2026-03-04.ics');
  });
});
