import { NextResponse } from 'next/server';

import { createPrinter, isAdmin } from '@/lib/admin/service';
import { printerInputSchema } from '@/lib/bookings/schemas';
import { getSessionContext } from '@/lib/bookings/service';

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  }

  const parsed = printerInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid printer details.' },
      { status: 400 },
    );
  }

  const result = await createPrinter(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ printer: result.data });
}
