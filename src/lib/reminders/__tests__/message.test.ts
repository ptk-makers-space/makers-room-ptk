import { describe, expect, it } from 'vitest';

import { buildPrintReminderMessage } from '../message';

describe('buildPrintReminderMessage', () => {
  it('describes a 24-hour reminder in the configured timezone', () => {
    const message = buildPrintReminderMessage({
      recipientName: 'Ada',
      title: 'Prototype enclosure',
      printerName: 'Prusa MK4',
      startsAt: new Date('2026-09-18T12:00:00.000Z'),
      endsAt: new Date('2026-09-18T14:00:00.000Z'),
      reminderType: '24h',
      timeZone: 'Asia/Jerusalem',
    });

    expect(message.subject).toBe(
      'Print reminder: Prototype enclosure starts in 24 hours',
    );
    expect(message.html).toContain('15:00 GMT+3');
    expect(message.html).toContain('17:00 GMT+3');
  });

  it('escapes member-controlled values in the HTML email', () => {
    const message = buildPrintReminderMessage({
      recipientName: '<Ada>',
      title: '<img src=x>',
      printerName: 'A&B',
      startsAt: new Date('2026-09-18T12:00:00.000Z'),
      endsAt: new Date('2026-09-18T13:00:00.000Z'),
      reminderType: '1h',
      timeZone: 'UTC',
    });

    expect(message.html).toContain('Hi &lt;Ada&gt;');
    expect(message.html).toContain('&lt;img src=x&gt;');
    expect(message.html).toContain('A&amp;B');
    expect(message.html).not.toContain('<img src=x>');
  });
});
