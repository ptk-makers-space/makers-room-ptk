import { NextResponse } from 'next/server';

import { isAdmin, savePolicy } from '@/lib/admin/service';
import { policyInputSchema } from '@/lib/bookings/schemas';
import { getSessionContext } from '@/lib/bookings/service';

export async function PUT(request: Request) {
  const session = await getSessionContext();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  }

  const parsed = policyInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid rule values.', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await savePolicy(session, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
