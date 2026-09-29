import { NextResponse } from 'next/server';

import { isAdmin, rescheduleReservation } from '@/lib/admin/service';
import { rescheduleInputSchema } from '@/lib/bookings/schemas';
import { cancelReservation, getSessionContext } from '@/lib/bookings/service';

/** Admin only: move a booking to a different time or printer. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Only admins can move bookings.' }, { status: 403 });
  }

  const parsed = rescheduleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid times.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await rescheduleReservation(session, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Cancel a booking, freeing the slot for anyone else to claim. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { id } = await params;
  const result = await cancelReservation(session, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
