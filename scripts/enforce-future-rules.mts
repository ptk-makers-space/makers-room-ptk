// Cancels upcoming fun prints that break the current quota rules. Dry run unless --apply is passed.
// Run: npx tsx --env-file=.env.local scripts/enforce-future-rules.mts [--apply]
import { createClient } from '@supabase/supabase-js';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { resolvePolicy } from '../src/lib/scheduling/policy.ts';
import { classifySlot, formatMinutes } from '../src/lib/scheduling/rules.ts';
import { computeUsage, type UsageReservation } from '../src/lib/scheduling/usage.ts';

if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

const apply = process.argv.includes('--apply');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
const db = createClient(url, key, { auth: { persistSession: false } });

const now = new Date();
const { data: policyRow } = await db.from('policy_settings').select('policy').maybeSingle();
const policy = resolvePolicy(policyRow?.policy ?? null);

const since = new Date(now.getTime() - 70 * 24 * 60 * 60 * 1000).toISOString();
const { data: rows, error } = await db
  .from('reservations')
  .select('id, user_id, title, priority, status, starts_at, ends_at, created_at, cancel_penalty_minutes, overrun_penalty_minutes')
  .gte('starts_at', since);
if (error) throw new Error(error.message);

const { data: cancelEvents } = await db
  .from('reservation_events')
  .select('reservation_id, created_at, payload')
  .eq('event_type', 'cancelled')
  .gte('created_at', since);
const cancelledAt = new Map(
  (cancelEvents ?? [])
    .filter((e) => !(e.payload as { by_admin?: boolean } | null)?.by_admin)
    .map((e) => [e.reservation_id, new Date(e.created_at)]),
);

const { data: profiles } = await db.from('profiles').select('id, full_name, email, role');
const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

type Row = NonNullable<typeof rows>[number];
const toUsage = (r: Row): UsageReservation => {
  // A print cancelled after it started still used the printer, so count it.
  const ranThenCancelled =
    r.status === 'cancelled' && (cancelledAt.get(r.id)?.getTime() ?? 0) > new Date(r.starts_at).getTime();
  return {
    id: r.id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    status: ranThenCancelled ? 'completed' : r.status,
    priority: r.priority,
    createdAt: new Date(r.created_at),
    cancelPenaltyMinutes: r.cancel_penalty_minutes ?? 0,
    overrunPenaltyMinutes: r.overrun_penalty_minutes ?? 0,
  };
};

const byUser = new Map<string, Row[]>();
for (const r of rows ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);

const toCancel: { row: Row; reasons: string[] }[] = [];

for (const [userId, list] of byUser) {
  if (profileById.get(userId)?.role === 'admin') continue;

  const upcoming = list
    .filter((r) => r.status === 'scheduled' && r.priority === 'fun' && new Date(r.starts_at) > now)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const upcomingIds = new Set(upcoming.map((r) => r.id));
  const kept = list.filter((r) => !upcomingIds.has(r.id)).map(toUsage);

  // Earliest-booked prints keep their place; later ones are judged against them.
  for (const r of upcoming) {
    const startsAt = new Date(r.starts_at);
    const endsAt = new Date(r.ends_at);
    const bookedAt = new Date(r.created_at);
    const slot = classifySlot({ startsAt, endsAt }, policy, bookedAt);
    const usage = computeUsage(kept, { now: bookedAt, slotStart: startsAt, policy });
    const reasons: string[] = [];

    if (!slot.isOpenBooking) {
      if (slot.isWorkingDaytime && usage.workingWeekReservations >= policy.maxPrintsPerWorkingWeek) {
        reasons.push(`weekly daytime cap (${usage.workingWeekReservations}/${policy.maxPrintsPerWorkingWeek} already)`);
      }
      if (
        slot.workingDaytimeMinutes > 0 &&
        usage.monthWorkingMinutes + slot.workingDaytimeMinutes > policy.monthlyWorkingMinutesCap
      ) {
        reasons.push(
          `monthly cap (${formatMinutes(usage.monthWorkingMinutes)} used + ${formatMinutes(slot.workingDaytimeMinutes)} > ${formatMinutes(policy.monthlyWorkingMinutesCap)})`,
        );
      }
    }
    if (
      slot.isOvernight &&
      slot.leadTimeHours > policy.overnightOpenBookingHours &&
      usage.monthOvernightPrints >= policy.maxOvernightPrintsPerMonth
    ) {
      reasons.push(`night cap (${usage.monthOvernightPrints}/${policy.maxOvernightPrintsPerMonth} already)`);
    }

    if (reasons.length > 0) toCancel.push({ row: r, reasons });
    else kept.push(toUsage(r));
  }
}

const label = (id: string) => {
  const p = profileById.get(id);
  return p ? `${p.full_name ?? '?'} <${p.email}>` : id;
};
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: policy.timeZone,
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

console.log(`${apply ? 'APPLYING' : 'DRY RUN'}: ${toCancel.length} upcoming print(s) break the rules`);
console.table(
  toCancel.map(({ row, reasons }) => ({
    member: label(row.user_id),
    title: row.title,
    starts: fmt.format(new Date(row.starts_at)),
    ends: fmt.format(new Date(row.ends_at)),
    reasons: reasons.join('; '),
  })),
);

if (apply && toCancel.length > 0) {
  const ids = toCancel.map(({ row }) => row.id);
  const { data: cancelled, error: cancelError } = await db
    .from('reservations')
    .update({ status: 'cancelled', cancelled_at: now.toISOString() })
    .in('id', ids)
    .eq('status', 'scheduled')
    .select('id');
  if (cancelError) throw new Error(cancelError.message);

  const done = new Set((cancelled ?? []).map((r) => r.id));
  await db.from('reservation_events').insert(
    toCancel
      .filter(({ row }) => done.has(row.id))
      .map(({ row, reasons }) => ({
        reservation_id: row.id,
        actor_id: null,
        event_type: 'cancelled',
        payload: { by_admin: true, reason: 'rule_enforcement', violations: reasons },
      })),
  );
  console.log(`Cancelled ${done.size} print(s).`);
}
