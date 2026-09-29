import 'server-only';

import { loadPolicy, type SessionContext } from '@/lib/bookings/service';
import type {
  PolicyInput,
  PrinterInput,
  PrinterUpdate,
  RescheduleInput,
} from '@/lib/bookings/schemas';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json, PrinterRow } from '@/lib/supabase/types';

type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

export function isAdmin(session: SessionContext | null): session is SessionContext {
  return session?.profile.role === 'admin';
}

/** Merge the admin's changes over the stored rule overrides. */
export async function savePolicy(session: SessionContext, input: PolicyInput): Promise<Result> {
  const admin = createAdminClient();

  const { data: current, error: loadError } = await admin
    .from('policy_settings')
    .select('policy')
    .eq('id', true)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };

  const stored =
    current?.policy && typeof current.policy === 'object' && !Array.isArray(current.policy)
      ? current.policy
      : {};

  const { error } = await admin.from('policy_settings').upsert({
    id: true,
    policy: { ...stored, ...input } as Json,
    updated_by: session.userId,
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, data: undefined };
}

function printerMessage(error: { code?: string; message: string }): string {
  return error.code === '23505'
    ? 'A printer with that name already exists.'
    : error.message;
}

export async function createPrinter(input: PrinterInput): Promise<Result<PrinterRow>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('printers')
    .insert({
      name: input.name,
      model: input.model || null,
      notes: input.notes || null,
      sort_order: input.sortOrder ?? 0,
      in_maintenance: input.inMaintenance ?? false,
      is_active: input.isActive ?? true,
    })
    .select('*')
    .single();

  if (error) return { ok: false, message: printerMessage(error) };
  return { ok: true, data };
}

export async function updatePrinter(
  printerId: string,
  input: PrinterUpdate,
): Promise<Result<PrinterRow>> {
  const admin = createAdminClient();

  // Retiring hides the printer and its bookings from the calendar, so any
  // upcoming prints must be moved or cancelled first.
  if (input.isActive === false) {
    const { count, error: countError } = await admin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('printer_id', printerId)
      .in('status', ['scheduled', 'in_progress'])
      .gt('ends_at', new Date().toISOString());
    if (countError) return { ok: false, message: countError.message };
    if (count && count > 0) {
      return {
        ok: false,
        message: `This printer still has ${count} upcoming booking${count === 1 ? '' : 's'}. Move or cancel ${count === 1 ? 'it' : 'them'} first.`,
      };
    }
  }

  const { data, error } = await admin
    .from('printers')
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.model !== undefined && { model: input.model || null }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
      ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
      ...(input.inMaintenance !== undefined && { in_maintenance: input.inMaintenance }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    })
    .eq('id', printerId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, message: printerMessage(error) };
  if (!data) return { ok: false, message: 'That printer no longer exists.' };
  return { ok: true, data };
}

/**
 * Move a booking to another time or printer. Admins bypass the member quotas,
 * but never double-booking or the configured gap between prints.
 */
export async function rescheduleReservation(
  session: SessionContext,
  reservationId: string,
  input: RescheduleInput,
): Promise<Result> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, printer_id, starts_at, ends_at, status')
    .eq('id', reservationId)
    .maybeSingle();

  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };
  if (existing.status !== 'scheduled' && existing.status !== 'in_progress') {
    return { ok: false, message: 'Only scheduled or running prints can be moved.' };
  }

  if (input.printerId !== existing.printer_id) {
    const { data: printer, error: printerError } = await admin
      .from('printers')
      .select('is_active, in_maintenance')
      .eq('id', input.printerId)
      .maybeSingle();
    if (printerError) return { ok: false, message: printerError.message };
    if (!printer || !printer.is_active || printer.in_maintenance) {
      return { ok: false, message: 'That printer is not taking bookings right now.' };
    }
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const policy = await loadPolicy(admin);
  const bufferMs = policy.bufferMinutes * 60_000;

  const { data: clashes, error: clashError } = await admin
    .from('reservations')
    .select('title')
    .eq('printer_id', input.printerId)
    .in('status', ['scheduled', 'in_progress'])
    .neq('id', reservationId)
    .lt('starts_at', new Date(endsAt.getTime() + bufferMs).toISOString())
    .gt('ends_at', new Date(startsAt.getTime() - bufferMs).toISOString())
    .limit(1);

  if (clashError) return { ok: false, message: clashError.message };
  const clashMessage = (title: string) =>
    policy.bufferMinutes > 0
      ? `That clashes with "${title}", including the ${policy.bufferMinutes}-minute cleaning gap.`
      : `That clashes with "${title}".`;
  if (clashes && clashes.length > 0) return { ok: false, message: clashMessage(clashes[0].title) };

  const { error: updateError } = await admin
    .from('reservations')
    .update({
      printer_id: input.printerId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq('id', reservationId)
    .in('status', ['scheduled', 'in_progress']);

  if (updateError) {
    return {
      ok: false,
      message:
        updateError.code === '23P01' ? clashMessage('another booking') : updateError.message,
    };
  }

  // Reminders were timed for the old start; let the cron send fresh ones.
  if (new Date(existing.starts_at).getTime() !== startsAt.getTime()) {
    await admin.from('print_reminder_deliveries').delete().eq('reservation_id', reservationId);
  }

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'rescheduled',
    payload: {
      old_printer_id: existing.printer_id,
      old_starts_at: existing.starts_at,
      old_ends_at: existing.ends_at,
      new_printer_id: input.printerId,
      new_starts_at: startsAt.toISOString(),
      new_ends_at: endsAt.toISOString(),
    },
  });

  return { ok: true, data: undefined };
}
