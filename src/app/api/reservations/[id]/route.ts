import { NextResponse } from 'next/server';

import { isAdmin, rescheduleReservation } from '@/lib/admin/service';
import { rescheduleInputSchema } from '@/lib/bookings/schemas';
import {
  adminRescheduleQuotaWarnings,
  cancelReservation,
  checkOwnReschedule,
  getSessionContext,
} from '@/lib/bookings/service';

/** Move a booking. Owners go through the member rules; admins must approve breaking quotas. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const parsed = rescheduleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid times.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  let overriddenRules: string[] = [];
  if (!isAdmin(session)) {
    const check = await checkOwnReschedule(session, id, parsed.data);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
  } else {
    const check = await adminRescheduleQuotaWarnings(id, parsed.data);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });
    if (check.warnings.length > 0 && parsed.data.approveRuleOverride !== true) {
      return NextResponse.json(
        {
          error: 'This move breaks the house rules for the booking owner.',
          requiresApproval: true,
          warnings: check.warnings,
        },
        { status: 409 },
      );
    }
    overriddenRules = check.warnings.map((warning) => warning.code);
  }
  const result = await rescheduleReservation(session, id, parsed.data, overriddenRules);
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
  return NextResponse.json({ ok: true, penaltyMinutes: result.penaltyMinutes ?? 0 });
}
