import { NextResponse } from 'next/server';

import { lateStartInputSchema } from '@/lib/bookings/schemas';
import { getSessionContext, reportLateStart } from '@/lib/bookings/service';

/** Shift a running print that started late because the previous print overran. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const parsed = lateStartInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid times.' },
      { status: 400 },
    );
  }

  const { id } = await params;
  const result = await reportLateStart(session, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json(result);
}
