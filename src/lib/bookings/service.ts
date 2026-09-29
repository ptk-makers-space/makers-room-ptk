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
  computeUsage,
  evaluateBooking,
  resolvePolicy,
  type BookingDecision,
  type BookingRequest,
  type ExistingReservation,
  type MemberProfile,
  type SchedulingPolicy,
} from '@/lib/scheduling';
import type { UsageReservation } from '@/lib/scheduling/usage';

import type { BookingInput } from './schemas';

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

  if (!decision.allowed) {
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

  return { ok: true, reservation: data as unknown as ReservationRow, decision };
}

/** Cancel a booking. Members may cancel their own; admins may cancel any. */
export async function cancelReservation(
  session: SessionContext,
  reservationId: string,
): Promise<{ ok: boolean; message?: string }> {
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from('reservations')
    .select('id, user_id, status')
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

  const { error } = await admin
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', reservationId)
    .eq('status', 'scheduled');

  if (error) return { ok: false, message: error.message };

  await admin.from('reservation_events').insert({
    reservation_id: reservationId,
    actor_id: session.userId,
    event_type: 'cancelled',
    payload: { by_admin: !isOwner },
  });

  return { ok: true };
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
