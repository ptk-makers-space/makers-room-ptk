import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAdmin, updatePrinter } from '@/lib/admin/service';
import { printerUpdateSchema } from '@/lib/bookings/schemas';
import { getSessionContext } from '@/lib/bookings/service';

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
    return NextResponse.json({ error: 'Unknown printer.' }, { status: 404 });
  }

  const parsed = printerUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid printer details.' },
      { status: 400 },
    );
  }

  const result = await updatePrinter(id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ printer: result.data });
}
