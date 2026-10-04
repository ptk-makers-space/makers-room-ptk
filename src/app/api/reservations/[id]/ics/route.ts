import { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/bookings/service';
import { buildReservationIcs, icsFileName } from '@/lib/ics';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Download a booking as an .ics file so a member can add it to their own
 * calendar. Reads through the caller's RLS-scoped client, so a member can
 * only fetch bookings they are already allowed to see on the schedule.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: reservation, error } = await supabase
    .from('reservations')
    .select(
      'id, title, notes, starts_at, ends_at, status, updated_at, printer:printers(name), profile:profiles!reservations_user_id_fkey(full_name, email)',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !reservation) {
    return NextResponse.json({ error: 'That booking was not found.' }, { status: 404 });
  }
  if (reservation.status === 'cancelled' || reservation.status === 'preempted') {
    return NextResponse.json(
      { error: 'That booking is no longer scheduled.' },
      { status: 410 },
    );
  }

  const startsAt = new Date(reservation.starts_at);
  const ics = buildReservationIcs({
    id: reservation.id,
    title: reservation.title,
    notes: reservation.notes,
    printerName: reservation.printer?.name ?? 'Printer',
    ownerName: reservation.profile?.full_name || reservation.profile?.email || null,
    startsAt,
    endsAt: new Date(reservation.ends_at),
    updatedAt: new Date(reservation.updated_at),
    url: `${new URL(request.url).origin}/my-prints`,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFileName(reservation.title, startsAt)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
