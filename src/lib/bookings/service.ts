import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type {
  Database,
  PrinterRow,
  ProfileRow,
  ReservationRow,
  ReservationWithProfile,
} from '@/lib/supabase/types';
import {
  ADMIN_OVERRIDABLE_CODES,
  computeUsage,
  evaluateBooking,
  resolvePolicy,
  type BookingDecision,
  type BookingRequest,
  type ExistingReservation,
  type MemberProfile,
  type RuleViolation,
  type SchedulingPolicy,
} from '@/lib/scheduling';
import type { UsageReservation } from '@/lib/scheduling/usage';

import type { BookingInput, LateStartInput, RescheduleInput } from './schemas';

type Client = SupabaseClient<Database>;

const PROFILE_FIELDS = 'id, full_name, email, phone, avatar_url, color_index';
const PARTICIPANT_FIELDS =
  'user_id, created_at, profile:profiles!reservation_participants_user_id_fkey(id, full_name, email, phone)';


export interface SessionContext {
  userId: string;
  profile: ProfileRow;
}

/** Resolve the signed-in member, or null when there is no valid session. */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return { userId: user.id, profile };
}

export async function loadPolicy(client: Client): Promise<SchedulingPolicy> {
  const { data } = await client
    .from('policy_settings')
    .select('policy')
    .eq('id', true)
    .maybeSingle();

  return resolvePolicy((data?.policy ?? null) as Partial<SchedulingPolicy> | null);
}

export async function loadPrinters(
  client: Client,
  { includeRetired = false }: { includeRetired?: boolean } = {},
): Promise<PrinterRow[]> {
  let query = client.from('printers').select('*');
  if (!includeRetired) query = query.eq('is_active', true);
  const { data, error } = await query.order('sort_order', { ascending: true });

  if (error) throw new Error(`Could not load printers: ${error.message}`);
  return data ?? [];
}

/** Reservations overlapping [from, to), joined with their owner. */
export async function loadReservations(
  client: Client,
  from: Date,
  to: Date,
): Promise<ReservationWithProfile[]> {
  const { data, error } = await client
    .from('reservations')
    .select(
      `*, profile:profiles!reservations_user_id_fkey(${PROFILE_FIELDS}), participants:reservation_participants(${PARTICIPANT_FIELDS})`,
    )
    .lt('starts_at', to.toISOString())
    .gt('ends_at', from.toISOString())
    .order('starts_at', { ascending: true });

  if (error) throw new Error(`Could not load reservations: ${error.message}`);
  return (data ?? []) as unknown as ReservationWithProfile[];
}

function toExisting(row: ReservationRow): ExistingReservation {
  return {
    id: row.id,
    printerId: row.printer_id,
    userId: row.user_id,
    title: row.title,
    priority: row.priority,
    status: row.status,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
  };
}

function toUsageReservation(row: ReservationRow): UsageReservation {
  return {
    id: row.id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
    priority: row.priority,
    createdAt: new Date(row.created_at),
    cancelPenaltyMinutes: row.cancel_penalty_minutes ?? 0,
    overrunPenaltyMinutes: row.overrun_penalty_minutes ?? 0,
  };
}

function toMemberProfile(profile: ProfileRow): MemberProfile {
  return {
    id: profile.id,
    email: profile.email || null,
    phone: profile.phone,
    fullName: profile.full_name,
    role: profile.role,
    isBlocked: profile.is_blocked,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run the full rule set for a prospective booking.
 *
 * Shared by the live preview in the booking dialog and by the create endpoint,
 * so what the member sees is exactly what is enforced.
 */
export async function evaluateRequest(
  client: Client,
  session: SessionContext,
  input: BookingInput,
  now: Date = new Date(),
): Promise<{ decision: BookingDecision; policy: SchedulingPolicy }> {
  const policy = await loadPolicy(client);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  // Anything that could overlap the requested slot on the chosen printer, plus
  // any neighbours close enough to eat into an admin-configured gap.
  const bufferMs = policy.bufferMinutes * 60_000;
  const { data: conflictRows, error: conflictError } = await client
    .from('reservations')
    .select('*')
    .eq('printer_id', input.printerId)
    .in('status', ['scheduled', 'in_progress'])
    .lt('starts_at', new Date(endsAt.getTime() + bufferMs).toISOString())
    .gt('ends_at', new Date(startsAt.getTime() - bufferMs).toISOString());

  if (conflictError) {
    throw new Error(`Could not check the printer schedule: ${conflictError.message}`);
  }

  // The member's own history, wide enough to cover the whole calendar month
  // the slot falls in, in either direction.
  const historyFrom = new Date(
    Math.min(now.getTime(), startsAt.getTime()) - 45 * DAY_MS,
  );
  const historyTo = new Date(
    Math.max(now.getTime(), endsAt.getTime()) + 45 * DAY_MS,
  );

  const { data: historyRows, error: historyError } = await client
    .from('reservations')
    .select('*')
    .eq('user_id', session.userId)
    .gte('starts_at', historyFrom.toISOString())
    .lte('starts_at', historyTo.toISOString());

  if (historyError) {
    throw new Error(`Could not load your booking history: ${historyError.message}`);
  }

  const usage = computeUsage((historyRows ?? []).map(toUsageReservation), {
    now,
    slotStart: startsAt,
    policy,
    excludeReservationId: input.reservationId ?? null,
  });

  const request: BookingRequest = {
    printerId: input.printerId,
    userId: session.userId,
    title: input.title,
    priority: input.priority,
    startsAt,
    endsAt,
    justification: input.justification ?? null,
    allowsJoiners: input.allowsJoiners ?? false,
    reservationId: input.reservationId ?? null,
  };

  const decision = evaluateBooking(request, {
    now,
    policy,
    profile: toMemberProfile(session.profile),
    usage,
    printerReservations: (conflictRows ?? []).map(toExisting),
  });

  const { data: printer, error: printerError } = await client
    .from('printers')
    .select('is_active, in_maintenance')
    .eq('id', input.printerId)
    .maybeSingle();

  if (printerError) {
    throw new Error(`Could not load the printer: ${printerError.message}`);
  }

  if (!printer || !printer.is_active || printer.in_maintenance) {
    return {
      decision: {
        ...decision,
        allowed: false,
        overridable: false,
        violations: [
          {
            code: 'printer_unavailable',
            message: 'This printer is in maintenance and is not taking new bookings.',
            severity: 'error',
          },
          ...decision.violations,
        ],
      },
      policy,
    };
  }

  return { decision, policy };
}

export type CreateResult =
  | { ok: true; reservation: ReservationRow; decision: BookingDecision }
  | { ok: false; decision: BookingDecision | null; message: string };

/**
 * Validate and persist a booking.
 *
 * Validation runs against the caller's RLS-scoped client, then the write goes
 * through the service role, which is the only role allowed to touch the
 * reservations table.
 */
export async function createReservation(
  session: SessionContext,
  input: BookingInput,
  now: Date = new Date(),
): Promise<CreateResult> {
  const userClient = await createClient();
  const { decision } = await evaluateRequest(userClient, session, input, now);

  // Admins may break quota rules, but only after explicitly approving the warning.
  const isOverride =
    !decision.allowed &&
    decision.overridable &&
    session.profile.role === 'admin' &&
    input.approveRuleOverride === true;

  if (!decision.allowed && !isOverride) {
    return {
      ok: false,
      decision,
      message: decision.violations[0]?.message ?? 'This slot is not available.',
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('book_reservation', {
    p_printer_id: input.printerId,
    p_user_id: session.userId,
    p_title: input.title,
    p_notes: input.notes ?? null,
    p_priority: input.priority,
    p_starts_at: new Date(input.startsAt).toISOString(),
    p_ends_at: new Date(input.endsAt).toISOString(),
    p_justification: input.justification ?? null,
    p_preempt_ids: decision.preemptions.map((p) => p.id),
    p_allows_joiners: input.allowsJoiners ?? false,
  });

  if (error) {
    // Someone booked the same slot between validation and insert.
    const raced =
      error.code === '23P01' || error.message.includes('preemption_conflict');
    const unavailable = error.message.includes('printer_unavailable');
    return {
      ok: false,
      decision,
      message: raced
        ? 'Someone just booked this slot. Refresh the calendar and try again.'
        : unavailable
          ? 'This printer is in maintenance and is not taking new bookings.'
          : `Could not save the booking: ${error.message}`,
    };
  }

  const reservation = data as unknown as ReservationRow;
  if (isOverride) {
    await admin.from('reservation_events').insert({
      reservation_id: reservation.id,
      actor_id: session.userId,
      event_type: 'rule_override',
      payload: { violations: decision.violations.map((v) => v.code) },
    });
  }

  return { ok: true, reservation, decision };
}

/**
 * Check a member may move their own booking to the new slot. Unlike an admin
 * move, the full rule set (quotas, gaps, suspension) applies, and the new slot
 * must be free outright rather than bumping anyone. Once a print has started
 * its time is locked; a late start is reported through `reportLateStart`.
 */
export async function checkOwnReschedule(
  session: SessionContext,
  reservationId: string,
  input: RescheduleInput,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select(
      'id, user_id, status, printer_id, starts_at, ends_at, title, notes, priority, justification, allows_joiners',
    )
    .eq('id', reservationId)
    .maybeSingle();

  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };
  if (existing.user_id !== session.userId) {
    return { ok: false, message: 'You can only change your own bookings.' };
  }
  if (existing.status !== 'scheduled' && existing.status !== 'in_progress') {
    return { ok: false, message: 'Only upcoming or running prints can be changed.' };
  }

  const hasStarted =
    existing.status === 'in_progress' || new Date(existing.starts_at).getTime() <= now.getTime();
  if (hasStarted) {
    return {
      ok: false,
      message:
        'A print that has started cannot be changed. If it started late because the previous print ran over, use "Started late".',
    };
  }

  const userClient = await createClient();
  const { decision } = await evaluateRequest(
    userClient,
    session,
    {
      printerId: input.printerId,
      title: existing.title,
      notes: existing.notes,
      priority: existing.priority,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      justification: existing.justification,
      allowsJoiners: existing.allows_joiners,
      reservationId,
    },
    now,
  );

  if (decision.violations.length > 0) {
    return { ok: false, message: decision.violations[0].message };
  }
  if (decision.preemptions.length > 0) {
    return { ok: false, message: 'That slot is already booked. Pick a free time.' };
  }
  return { ok: true };
}

/**
 * Cancel a booking. Members may cancel their own before it starts; a late
 * cancellation charges part of the slot to their monthly budget. Admins may
 * cancel any booking at any time, free of charge.
 */
export async function cancelReservation(
  session: SessionContext,
  reservationId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; message?: string; penaltyMinutes?: number }> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, status, priority, starts_at, ends_at')
    .eq('id', reservationId)
    .maybeSingle();

  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };

  const isOwner = existing.user_id === session.userId;
  const isAdmin = session.profile.role === 'admin';
  if (!isOwner && !isAdmin) {
    return { ok: false, message: 'You can only cancel your own bookings.' };
  }
  if (existing.status !== 'scheduled') {
    return { ok: false, message: 'Only a scheduled print can be cancelled.' };
  }

  const startsAt = new Date(existing.starts_at).getTime();
  if (!isAdmin && startsAt <= now.getTime()) {
    return {
      ok: false,
      message: 'This print has already started and can no longer be cancelled. Ask an admin if it failed.',
    };
  }

  let penaltyMinutes = 0;
  if (!isAdmin && existing.priority === 'fun') {
    const policy = await loadPolicy(admin);
    if (startsAt - now.getTime() <= policy.lateCancelHours * 60 * 60 * 1000) {
      const slotMinutes = (new Date(existing.ends_at).getTime() - startsAt) / 60_000;
      penaltyMinutes = Math.round(slotMinutes * policy.lateCancelPenaltyRatio);
    }
  }

  const { error } = await admin
    .from('reservations')
    .update({
      status: 'cancelled',
      cancelled_at: now.toISOString(),
      cancel_penalty_minutes: penaltyMinutes,
    })
    .eq('id', reservationId)
    .eq('status', 'scheduled');

  if (error) return { ok: false, message: error.message };

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'cancelled',
    payload: { by_admin: !isOwner, penalty_minutes: penaltyMinutes },
  });

  return { ok: true, penaltyMinutes };
}

const PREVIOUS_PRINT_WINDOW_MS = 24 * 60 * 60 * 1000;

type AdminClient = ReturnType<typeof createAdminClient>;
type PreviousPrint = { id: string; ends_at: string; overrun_penalty_minutes: number; ownerName: string };

/** Another member's print that ran right before `reservation` on the same printer. */
async function findPreviousPrint(
  admin: AdminClient,
  reservation: { id: string; user_id: string; printer_id: string; starts_at: string },
): Promise<{ ok: true; previous: PreviousPrint } | { ok: false; message: string }> {
  const start = new Date(reservation.starts_at).getTime();
  const { data, error } = await admin
    .from('reservations')
    .select('id, user_id, ends_at, overrun_penalty_minutes, profile:profiles!reservations_user_id_fkey(full_name, email)')
    .eq('printer_id', reservation.printer_id)
    .in('status', ['scheduled', 'in_progress', 'completed'])
    .neq('id', reservation.id)
    .lte('ends_at', reservation.starts_at)
    .gt('ends_at', new Date(start - PREVIOUS_PRINT_WINDOW_MS).toISOString())
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!data) {
    return { ok: false, message: 'There was no print before yours on this printer to blame.' };
  }
  if (data.user_id === reservation.user_id) {
    return { ok: false, message: 'The print before this one was your own.' };
  }
  const profile = data.profile as unknown as { full_name: string | null; email: string } | null;
  return {
    ok: true,
    previous: {
      id: data.id,
      ends_at: data.ends_at,
      overrun_penalty_minutes: data.overrun_penalty_minutes ?? 0,
      ownerName: profile?.full_name || profile?.email || 'the previous member',
    },
  };
}

/** Charge the previous print's owner for the time their overrun cost the next member. */
async function chargeOverrun(
  admin: AdminClient,
  previous: PreviousPrint,
  delayedReservationId: string,
  actorId: string,
  minutes: number,
): Promise<string | null> {
  const { error } = await admin
    .from('reservations')
    .update({ overrun_penalty_minutes: previous.overrun_penalty_minutes + minutes })
    .eq('id', previous.id);
  if (error) return error.message;

  await admin.from('reservation_events').insert({
    reservation_id: previous.id,
    actor_id: actorId,
    event_type: 'overran',
    payload: { delayed_reservation_id: delayedReservationId, penalty_minutes: minutes },
  });
  return null;
}

/**
 * The owner of a running print reports it started late because the previous
 * print on the printer had not finished. They pick the real start and a new
 * end; running longer than booked must still be free and within quota. The
 * delay is charged to the previous print's owner, whose budget may go negative
 * and carry into next month.
 */
export async function reportLateStart(
  session: SessionContext,
  reservationId: string,
  input: LateStartInput,
  now: Date = new Date(),
): Promise<
  | { ok: true; delayMinutes: number; blamedOwnerName: string }
  | { ok: false; message: string }
> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, printer_id, status, starts_at, ends_at, title, notes, priority, justification, allows_joiners')
    .eq('id', reservationId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };
  if (existing.user_id !== session.userId) {
    return { ok: false, message: 'Only the owner can report a late start.' };
  }
  if (existing.status !== 'scheduled' && existing.status !== 'in_progress') {
    return { ok: false, message: 'Only a running print can report a late start.' };
  }

  const oldStart = new Date(existing.starts_at).getTime();
  const oldEnd = new Date(existing.ends_at).getTime();
  const newStart = new Date(input.startsAt).getTime();
  const newEnd = new Date(input.endsAt).getTime();

  if (oldStart > now.getTime()) {
    return { ok: false, message: 'This print has not started yet. Change its time instead.' };
  }
  if (oldEnd <= now.getTime()) {
    return { ok: false, message: 'This print has already finished.' };
  }
  if (newStart <= oldStart) {
    return { ok: false, message: 'The actual start must be later than the booked start.' };
  }
  if (newStart > now.getTime()) {
    return { ok: false, message: 'The actual start cannot be in the future.' };
  }
  const delayMs = newStart - oldStart;
  if (newEnd <= now.getTime()) {
    return { ok: false, message: 'The new end must be in the future.' };
  }

  const { count: alreadyReported } = await admin
    .from('reservation_events')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId)
    .eq('event_type', 'late_start');
  if (alreadyReported && alreadyReported > 0) {
    return { ok: false, message: 'A late start was already reported for this print.' };
  }

  const found = await findPreviousPrint(admin, existing);
  if (!found.ok) return found;
  const { previous } = found;

  // Running longer than booked takes extra machine time, so it must be free and within quota.
  if (newEnd - newStart > oldEnd - oldStart) {
    const { decision } = await evaluateRequest(
      await createClient(),
      session,
      {
        printerId: existing.printer_id,
        title: existing.title,
        notes: existing.notes,
        priority: existing.priority,
        startsAt: new Date(newStart).toISOString(),
        endsAt: new Date(newEnd).toISOString(),
        justification: existing.justification,
        allowsJoiners: existing.allows_joiners,
        reservationId,
      },
      now,
    );
    const blocking = decision.violations.filter((violation) => violation.code !== 'in_the_past');
    if (blocking.length > 0) return { ok: false, message: blocking[0].message };
  }

  const { error: updateError } = await admin
    .from('reservations')
    .update({ starts_at: new Date(newStart).toISOString(), ends_at: new Date(newEnd).toISOString() })
    .eq('id', reservationId)
    .in('status', ['scheduled', 'in_progress']);
  if (updateError) {
    return {
      ok: false,
      message:
        updateError.code === '23P01'
          ? 'That time clashes with the next booking. Pick an earlier end, or cancel your print without a penalty.'
          : updateError.message,
    };
  }

  const delayMinutes = Math.round(delayMs / 60_000);
  const chargeError = await chargeOverrun(admin, previous, reservationId, session.userId, delayMinutes);
  if (chargeError) return { ok: false, message: chargeError };

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'late_start',
    payload: {
      blamed_reservation_id: previous.id,
      delay_minutes: delayMinutes,
      old_starts_at: existing.starts_at,
      old_ends_at: existing.ends_at,
      new_starts_at: new Date(newStart).toISOString(),
      new_ends_at: new Date(newEnd).toISOString(),
    },
  });

  return { ok: true, delayMinutes, blamedOwnerName: previous.ownerName };
}

/**
 * Cancel without a penalty because the previous print overran into this slot.
 * Allowed once the previous print's booked time is over, even after this
 * print's own start. The previous owner is charged the time lost so far.
 */
export async function cancelForOverrun(
  session: SessionContext,
  reservationId: string,
  now: Date = new Date(),
): Promise<
  | { ok: true; chargedMinutes: number; blamedOwnerName: string }
  | { ok: false; message: string }
> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, printer_id, status, starts_at, ends_at')
    .eq('id', reservationId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };
  if (existing.user_id !== session.userId) {
    return { ok: false, message: 'You can only cancel your own bookings.' };
  }
  if (existing.status !== 'scheduled' && existing.status !== 'in_progress') {
    return { ok: false, message: 'Only an upcoming or running print can be cancelled.' };
  }
  const start = new Date(existing.starts_at).getTime();
  const end = new Date(existing.ends_at).getTime();
  if (end <= now.getTime()) return { ok: false, message: 'This print has already finished.' };

  const { count: alreadyReported } = await admin
    .from('reservation_events')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId)
    .eq('event_type', 'late_start');
  if (alreadyReported && alreadyReported > 0) {
    return { ok: false, message: 'You already shifted this print for a late start.' };
  }

  const found = await findPreviousPrint(admin, existing);
  if (!found.ok) return found;
  const { previous } = found;
  if (new Date(previous.ends_at).getTime() > now.getTime()) {
    return { ok: false, message: 'The previous print is still within its booked time.' };
  }

  const { error: updateError } = await admin
    .from('reservations')
    .update({ status: 'cancelled', cancelled_at: now.toISOString(), cancel_penalty_minutes: 0 })
    .eq('id', reservationId)
    .in('status', ['scheduled', 'in_progress']);
  if (updateError) return { ok: false, message: updateError.message };

  const chargedMinutes = Math.max(0, Math.round((Math.min(now.getTime(), end) - start) / 60_000));
  if (chargedMinutes > 0) {
    const chargeError = await chargeOverrun(admin, previous, reservationId, session.userId, chargedMinutes);
    if (chargeError) return { ok: false, message: chargeError };
  }

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'cancelled',
    payload: {
      by_admin: false,
      penalty_minutes: 0,
      reason: 'previous_overran',
      blamed_reservation_id: previous.id,
    },
  });

  return { ok: true, chargedMinutes, blamedOwnerName: previous.ownerName };
}

/**
 * Quota rules an admin move would break for the booking's owner. Admins may
 * still go ahead, but only after approving these warnings.
 */
export async function adminRescheduleQuotaWarnings(
  reservationId: string,
  input: RescheduleInput,
  now: Date = new Date(),
): Promise<{ ok: true; warnings: RuleViolation[] } | { ok: false; message: string }> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, title, notes, priority, justification, allows_joiners')
    .eq('id', reservationId)
    .maybeSingle();
  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That booking no longer exists.' };

  const { data: owner, error: ownerError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', existing.user_id)
    .maybeSingle();
  if (ownerError) return { ok: false, message: ownerError.message };
  if (!owner) return { ok: true, warnings: [] };

  const { decision } = await evaluateRequest(
    admin,
    { userId: owner.id, profile: owner },
    {
      printerId: input.printerId,
      title: existing.title,
      notes: existing.notes,
      priority: existing.priority,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      justification: existing.justification,
      allowsJoiners: existing.allows_joiners,
      reservationId,
    },
    now,
  );

  return {
    ok: true,
    warnings: decision.violations.filter((v) => ADMIN_OVERRIDABLE_CODES.has(v.code)),
  };
}


/**
 * Join someone else's print session.
 *
 * A joiner shares the owner's slot rather than booking their own, so this
 * deliberately creates no reservation and costs the joiner no quota.
 */
export async function joinReservation(
  session: SessionContext,
  reservationId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; message?: string }> {
  if (session.profile.is_blocked) {
    return { ok: false, message: 'Your account is suspended. Contact a makerspace admin.' };
  }

  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, status, ends_at, allows_joiners')
    .eq('id', reservationId)
    .maybeSingle();

  if (loadError) return { ok: false, message: loadError.message };
  if (!existing) return { ok: false, message: 'That print session no longer exists.' };

  if (existing.user_id === session.userId) {
    return { ok: false, message: 'This is your own print session.' };
  }
  if (!existing.allows_joiners) {
    return { ok: false, message: 'The owner has not opened this session to joiners.' };
  }
  if (existing.status !== 'scheduled' && existing.status !== 'in_progress') {
    return { ok: false, message: 'That print session is no longer running.' };
  }
  if (new Date(existing.ends_at).getTime() <= now.getTime()) {
    return { ok: false, message: 'That print session has already finished.' };
  }

  const { error } = await admin
    .from('reservation_participants')
    .upsert(
      { reservation_id: reservationId, user_id: session.userId },
      { onConflict: 'reservation_id,user_id', ignoreDuplicates: true },
    );

  if (error) return { ok: false, message: error.message };

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'joined',
    payload: {},
  });

  return { ok: true };
}

/** Step back out of a shared print session. */
export async function leaveReservation(
  session: SessionContext,
  reservationId: string,
): Promise<{ ok: boolean; message?: string }> {
  const admin = createAdminClient();

  const { error } = await admin
    .from('reservation_participants')
    .delete()
    .eq('reservation_id', reservationId)
    .eq('user_id', session.userId);

  if (error) return { ok: false, message: error.message };

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'left',
    payload: {},
  });

  return { ok: true };
}
