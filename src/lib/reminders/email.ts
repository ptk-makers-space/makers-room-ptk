import 'server-only';

import {
  getPrintReminderFrom,
  getPrintReminderTimeZone,
  getResendApiKey,
} from '@/lib/supabase/env';

import { buildPrintReminderMessage } from './message';

export interface ClaimedPrintReminder {
  reservation_id: string;
  user_id: string;
  reminder_type: '24h' | '1h';
  email: string;
  full_name: string | null;
  title: string;
  printer_name: string;
  starts_at: string;
  ends_at: string;
}

export async function sendPrintReminder(reminder: ClaimedPrintReminder): Promise<void> {
  const message = buildPrintReminderMessage({
    recipientName: reminder.full_name,
    title: reminder.title,
    printerName: reminder.printer_name,
    startsAt: new Date(reminder.starts_at),
    endsAt: new Date(reminder.ends_at),
    reminderType: reminder.reminder_type,
    timeZone: getPrintReminderTimeZone(),
  });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      'Content-Type': 'application/json',
      'Idempotency-Key':
        `print-reminder/${reminder.reservation_id}/${reminder.user_id}/${reminder.reminder_type}`,
    },
    body: JSON.stringify({
      from: getPrintReminderFrom(),
      to: [reminder.email],
      subject: message.subject,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Resend rejected the reminder (${response.status}): ${detail}`);
  }
}
