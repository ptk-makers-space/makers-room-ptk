export interface PrintReminderMessage {
  recipientName: string | null;
  title: string;
  printerName: string;
  startsAt: Date;
  endsAt: Date;
  reminderType: '24h' | '1h';
  timeZone: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildPrintReminderMessage(message: PrintReminderMessage): {
  subject: string;
  html: string;
} {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: message.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const lead = message.reminderType === '24h' ? '24 hours' : '1 hour';
  const greeting = message.recipientName?.trim()
    ? `Hi ${escapeHtml(message.recipientName.trim())},`
    : 'Hi,';

  return {
    subject: `Print reminder: ${message.title} starts in ${lead}`,
    html: [
      `<p>${greeting}</p>`,
      `<p>Your print <strong>${escapeHtml(message.title)}</strong> on ` +
        `<strong>${escapeHtml(message.printerName)}</strong> starts in ${lead}.</p>`,
      `<p><strong>Starts:</strong> ${escapeHtml(formatter.format(message.startsAt))}<br>` +
        `<strong>Ends:</strong> ${escapeHtml(formatter.format(message.endsAt))}</p>`,
      '<p>Please arrive in time to prepare the printer and your materials.</p>',
    ].join(''),
  };
}
