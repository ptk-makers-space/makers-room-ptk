import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/app-header';
import type { CalendarReservation } from '@/components/calendar-types';
import { WeekCalendar } from '@/components/week-calendar';
import { buildViewerSummary, usageHistoryRange } from '@/lib/bookings/viewer';
import {
  getSessionContext,
  loadPolicy,
  loadPrinters,
  loadReservations,
} from '@/lib/bookings/service';
import { buildWeekDays, formatRangeLabel, fromDateKey, toDateKey } from '@/lib/calendar';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import type { ReservationWithProfile } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

function toCalendarReservation(row: ReservationWithProfile): CalendarReservation {
  return {
    id: row.id,
    printerId: row.printer_id,
    userId: row.user_id,
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    ownerName: row.profile?.full_name || row.profile?.email || 'Member',
    ownerEmail: row.profile?.email ?? null,
    ownerPhone: row.profile?.phone ?? null,
    colorIndex: row.profile?.color_index ?? 0,
    allowsJoiners: row.allows_joiners,
    participants: (row.participants ?? []).map((participant) => ({
      userId: participant.user_id,
      name: participant.profile?.full_name || participant.profile?.email || 'Member',
      email: participant.profile?.email ?? null,
      phone: participant.profile?.phone ?? null,
    })),
  };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  if (!isSupabaseConfigured()) redirect('/login');

  const session = await getSessionContext();
  if (!session) redirect('/login');

  // Contact details are mandatory: a failed print needs a reachable owner.
  if (!session.profile.phone || !session.profile.full_name) redirect('/onboarding');

  const supabase = await createClient();
  const policy = await loadPolicy(supabase);

  const params = await searchParams;
  const reference = fromDateKey(params.week, policy.timeZone);
  const weekDays = buildWeekDays(reference, policy.timeZone);
  const weekStart = weekDays[0];
  const weekEnd = new Date(weekDays[6].getTime() + 24 * 60 * 60 * 1000);

  const history = usageHistoryRange();

  const [printers, reservations, myReservations] = await Promise.all([
    loadPrinters(supabase),
    loadReservations(supabase, weekStart, weekEnd),
    supabase
      .from('reservations')
      .select('*')
      .eq('user_id', session.userId)
      .gte('starts_at', history.from.toISOString())
      .lte('starts_at', history.to.toISOString()),
  ]);

  const viewer = buildViewerSummary(
    session.profile,
    myReservations.data ?? [],
    policy,
  );

  return (
    <div className="min-h-dvh">
      <AppHeader viewer={viewer} active="schedule" />

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold text-slate-900">
            {formatRangeLabel(weekDays, policy.timeZone)}
          </h1>
          <p className="text-sm text-slate-500">{viewer.quotaExplanation}</p>
        </div>

        {printers.length === 0 ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            No printers are set up yet. Run the SQL migrations in{' '}
            <code className="font-mono">supabase/migrations</code> to seed them.
          </p>
        ) : (
          <WeekCalendar
            weekStartKey={toDateKey(weekStart, policy.timeZone)}
            printers={printers.map((printer) => ({
              id: printer.id,
              name: printer.name,
              model: printer.model,
              notes: printer.notes,
              inMaintenance: printer.in_maintenance,
            }))}
            reservations={reservations.map(toCalendarReservation)}
            policy={policy}
            viewer={viewer}
          />
        )}
      </main>
    </div>
  );
}
