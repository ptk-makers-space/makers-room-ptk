import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAdmin, setMemberBlocked } from '@/lib/admin/service';
import { getSessionContext } from '@/lib/bookings/service';

const memberUpdateSchema = z.object({ isBlocked: z.boolean() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Unknown member.' }, { status: 404 });
  }

  const parsed = memberUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid member update.' }, { status: 400 });
  }

  const result = await setMemberBlocked(session, id, parsed.data.isBlocked);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json(result.data);
}
