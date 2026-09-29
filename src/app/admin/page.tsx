import { redirect } from 'next/navigation';

import { PolicyForm } from '@/components/admin/policy-form';
import { PrinterManager } from '@/components/admin/printer-manager';
import { AppHeader } from '@/components/app-header';
import { isAdmin } from '@/lib/admin/service';
import { buildViewerSummary, usageHistoryRange } from '@/lib/bookings/viewer';
import { getSessionContext, loadPolicy, loadPrinters } from '@/lib/bookings/service';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Admin · MakersRoom PTK' };

export default async function AdminPage() {
  if (!isSupabaseConfigured()) redirect('/login');

  const session = await getSessionContext();
  if (!session) redirect('/login');
  if (!isAdmin(session)) redirect('/');

  const supabase = await createClient();
  const history = usageHistoryRange();

  const [policy, printers, { data: myReservations }] = await Promise.all([
    loadPolicy(supabase),
    loadPrinters(supabase, { includeRetired: true }),
    supabase
      .from('reservations')
      .select('*')
      .eq('user_id', session.userId)
      .gte('starts_at', history.from.toISOString())
      .lte('starts_at', history.to.toISOString()),
  ]);

  const viewer = buildViewerSummary(session.profile, myReservations ?? [], policy);

  return (
    <div className="min-h-dvh">
      <AppHeader viewer={viewer} active="admin" />

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Admin</h1>
          <p className="mt-1 text-sm text-slate-500">
            To move someone&apos;s print, open it on the schedule and choose “Change time”.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Printers</h2>
          <PrinterManager
            printers={printers.map((printer) => ({
              id: printer.id,
              name: printer.name,
              model: printer.model,
              notes: printer.notes,
              sortOrder: printer.sort_order,
              inMaintenance: printer.in_maintenance,
              isActive: printer.is_active,
            }))}
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Booking rules</h2>
          <PolicyForm policy={policy} />
        </section>
      </main>
    </div>
  );
}
