import { NextResponse } from 'next/server';

import {
  type ClaimedPrintReminder,
  sendPrintReminder,
} from '@/lib/reminders/email';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCronSecret } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${getCronSecret()}`;
}

async function recordResult(
  reminder: ClaimedPrintReminder,
  result: { sent: true } | { sent: false; error: string },
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('print_reminder_deliveries')
    .update(
      result.sent
        ? { status: 'sent', sent_at: new Date().toISOString(), last_error: null }
        : { status: 'failed', last_error: result.error.slice(0, 1000) },
    )
    .eq('reservation_id', reminder.reservation_id)
    .eq('user_id', reminder.user_id)
    .eq('reminder_type', reminder.reminder_type)
    .eq('status', 'sending');

  if (error) {
    throw new Error(`Could not record reminder delivery: ${error.message}`);
  }
}

async function deliver(reminder: ClaimedPrintReminder): Promise<boolean> {
  try {
    await sendPrintReminder(reminder);
    await recordResult(reminder, { sent: true });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reminder error.';
    await recordResult(reminder, { sent: false, error: message });
    console.error('Print reminder delivery failed', {
      reservationId: reminder.reservation_id,
      userId: reminder.user_id,
      reminderType: reminder.reminder_type,
      error: message,
    });
    return false;
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('claim_print_reminders', {
      p_now: new Date().toISOString(),
      p_limit: 25,
    });
    if (error) {
      throw new Error(`Could not claim print reminders: ${error.message}`);
    }

    const reminders = (data ?? []) as ClaimedPrintReminder[];
    let sent = 0;
    for (let index = 0; index < reminders.length; index += 2) {
      const results = await Promise.all(reminders.slice(index, index + 2).map(deliver));
      sent += results.filter(Boolean).length;
    }

    const failed = reminders.length - sent;
    return NextResponse.json(
      { claimed: reminders.length, sent, failed },
      { status: failed > 0 ? 500 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected reminder error.';
    console.error('Print reminder cron failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
