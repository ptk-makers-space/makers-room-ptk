// Read-only audit: finds members whose real daytime fun-print usage exceeded the quotas.
// Run: node --experimental-strip-types --env-file=.env.local scripts/audit-quota-abuse.ts
import { createClient } from '@supabase/supabase-js';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { resolvePolicy } from '../src/lib/scheduling/policy.ts';
import {
  startsInWorkingDaytime,
  workingDaytimeMinutes,
  zonedStartOfMonth,
  zonedStartOfNextMonth,
  zonedStartOfWeek,
  getZonedParts,
} from '../src/lib/scheduling/time.ts';


if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped rows from a one-off audit
type Row = Record<string, any>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
const db = createClient(url, key, { auth: { persistSession: false } });

async function fetchAll(table: string, columns: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

const now = new Date();
const { data: policyRow } = await db.from('policy_settings').select('policy').maybeSingle();
const policy = resolvePolicy(policyRow?.policy ?? null);
const tz = policy.timeZone;
const openMs = policy.openBookingHours * 3600_000;

const [profiles, reservations, events, participants] = await Promise.all([
  fetchAll('profiles', 'id, email, full_name, phone, role'),
  fetchAll('reservations', 'id, user_id, priority, status, starts_at, ends_at, created_at, title'),
  fetchAll('reservation_events', 'reservation_id, actor_id, event_type, payload, created_at'),
  fetchAll('reservation_participants', 'reservation_id, user_id'),
]);

const profileById = new Map(profiles.map((p) => [p.id, p]));
const label = (id: string) => {
  const p = profileById.get(id);
  return p ? `${p.full_name ?? '?'} <${p.email}>` : id;
};

const cancelEvent = new Map<string, Row>();
for (const e of events) {
  if (e.event_type === 'cancelled') cancelEvent.set(e.reservation_id, e);
}

interface Ran {
  id: string;
  userId: string;
  start: Date;
  end: Date;
  openBooking: boolean;
  cancelledAfterStart: boolean;
  plannedEnd: Date;
  title: string;
}

// Interval each fun print actually occupied a printer, including prints cancelled after they began.
const ran: Ran[] = [];
for (const r of reservations) {
  if (r.priority !== 'fun') continue;
  const start = new Date(r.starts_at);
  const plannedEnd = new Date(r.ends_at);
  let end: Date | null = null;
  let cancelledAfterStart = false;

  if (['scheduled', 'in_progress', 'completed'].includes(r.status)) {
    if (start < now) end = plannedEnd < now ? plannedEnd : now;
  } else if (r.status === 'cancelled') {
    const ev = cancelEvent.get(r.id);
    if (ev && !ev.payload?.by_admin) {
      const at = new Date(ev.created_at);
      if (at > start) {
        end = at < plannedEnd ? at : plannedEnd;
        cancelledAfterStart = true;
      }
    }
  }
  if (!end || end <= start) continue;

  ran.push({
    id: r.id,
    userId: r.user_id,
    start,
    end,
    plannedEnd,
    openBooking: start.getTime() - new Date(r.created_at).getTime() <= openMs,
    cancelledAfterStart,
    title: r.title,
  });
}

const daytime = (start: Date, end: Date) =>
  workingDaytimeMinutes({ start, end }, policy.primeTimeStartHour, policy.primeTimeEndHour, policy.workingDays, tz);

const monthKey = (d: Date) => {
  const p = getZonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
};

// Split a print's daytime minutes across the months it touches.
function daytimeByMonth(start: Date, end: Date): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = zonedStartOfMonth(start, tz);
  while (cursor < end) {
    const next = zonedStartOfNextMonth(cursor, tz);
    const s = start > cursor ? start : cursor;
    const e = end < next ? end : next;
    if (e > s) {
      const m = daytime(s, e);
      if (m > 0) result.set(monthKey(cursor), (result.get(monthKey(cursor)) ?? 0) + m);
    }
    cursor = next;
  }
  return result;
}

interface MonthStats {
  total: number;
  quotaBound: number;
  viaCancel: number;
  cancelCount: number;
  joined: number;
}
const stats = new Map<string, Map<string, MonthStats>>();
const bucket = (userId: string, month: string) => {
  let byMonth = stats.get(userId);
  if (!byMonth) stats.set(userId, (byMonth = new Map()));
  let s = byMonth.get(month);
  if (!s) byMonth.set(month, (s = { total: 0, quotaBound: 0, viaCancel: 0, cancelCount: 0, joined: 0 }));
  return s;
};

const weekly = new Map<string, Ran[]>();
const ranById = new Map(ran.map((r) => [r.id, r]));

for (const r of ran) {
  for (const [month, minutes] of daytimeByMonth(r.start, r.end)) {
    const s = bucket(r.userId, month);
    s.total += minutes;
    if (!r.openBooking) s.quotaBound += minutes;
    if (r.cancelledAfterStart) {
      s.viaCancel += minutes;
      s.cancelCount += 1;
    }
  }
  const startsDaytime = startsInWorkingDaytime(
    r.start, policy.primeTimeStartHour, policy.primeTimeEndHour, policy.workingDays, tz,
  );
  if (startsDaytime && !r.openBooking) {
    const k = `${r.userId}|${zonedStartOfWeek(r.start, tz).toISOString()}`;
    weekly.set(k, [...(weekly.get(k) ?? []), r]);
  }
}

// Daytime minutes of other members' fun prints this member joined.
const sharedPairs = new Map<string, number>();
for (const p of participants) {
  const r = ranById.get(p.reservation_id);
  if (!r || r.userId === p.user_id) continue;
  for (const [month, minutes] of daytimeByMonth(r.start, r.end)) {
    bucket(p.user_id, month).joined += minutes;
  }
  const pair = `${r.userId}|${p.user_id}`;
  sharedPairs.set(pair, (sharedPairs.get(pair) ?? 0) + 1);
}

const cap = policy.monthlyWorkingMinutesCap;
const h = (m: number) => (m / 60).toFixed(1);

console.log(`Policy: ${cap / 60}h fun daytime/month, ${policy.maxPrintsPerWorkingWeek} daytime fun print/week, ` +
  `working hours ${policy.primeTimeStartHour}:00-${policy.primeTimeEndHour}:00 days ${policy.workingDays.join(',')} (${tz}), ` +
  `open-booking waiver ${policy.openBookingHours}h`);

console.log('\n=== 1. Monthly daytime fun-print time over the cap (actual run time) ===');
const overCap: Row[] = [];
for (const [userId, byMonth] of stats) {
  for (const [month, s] of byMonth) {
    if (s.total > cap || s.quotaBound > cap || s.total + s.joined > cap) {
      overCap.push({
        member: label(userId),
        month,
        totalH: h(s.total),
        quotaBoundH: h(s.quotaBound),
        overByH: h(Math.max(0, s.total - cap)),
        cancelledAfterStart: s.cancelCount,
        viaCancelH: h(s.viaCancel),
        joinedOthersH: h(s.joined),
        ownPlusJoinedH: h(s.total + s.joined),
      });
    }
  }
}
overCap.sort((a, b) => Number(b.ownPlusJoinedH) - Number(a.ownPlusJoinedH));
console.table(overCap);

console.log('\n=== 2. Prints cancelled AFTER they started (frees quota for a print that already ran) ===');
const cancels = ran
  .filter((r) => r.cancelledAfterStart)
  .map((r) => ({
    member: label(r.userId),
    title: r.title,
    start: r.start.toISOString(),
    plannedEnd: r.plannedEnd.toISOString(),
    cancelledAt: r.end.toISOString(),
    daytimeMinRan: Math.round(daytime(r.start, r.end)),
  }))
  .sort((a, b) => a.member.localeCompare(b.member));
console.table(cancels);

console.log(`\n=== 3. Weeks with more than ${policy.maxPrintsPerWorkingWeek} quota-bound daytime fun print(s) ===`);
const weekViolations: Row[] = [];
for (const [k, list] of weekly) {
  if (list.length <= policy.maxPrintsPerWorkingWeek) continue;
  const [userId, weekStart] = k.split('|');
  weekViolations.push({
    member: label(userId),
    weekOf: weekStart.slice(0, 10),
    prints: list.length,
    cancelledAfterStart: list.filter((r) => r.cancelledAfterStart).length,
  });
}
console.table(weekViolations);

console.log('\n=== 4. Possible proxy accounts (member repeatedly joins another member\'s fun prints) ===');
const pairs = [...sharedPairs]
  .filter(([, n]) => n >= 2)
  .map(([k, n]) => {
    const [owner, joiner] = k.split('|');
    return { bookedBy: label(owner), joinedBy: label(joiner), sharedFunPrints: n };
  })
  .sort((a, b) => b.sharedFunPrints - a.sharedFunPrints);
console.table(pairs);

console.log('\n=== 5. Profiles sharing a phone number or name (possible duplicate accounts) ===');
const groups = new Map<string, Row[]>();
for (const p of profiles) {
  const phone = (p.phone ?? '').replace(/\D/g, '').slice(-9);
  const name = (p.full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (phone.length >= 7) groups.set(`phone:${phone}`, [...(groups.get(`phone:${phone}`) ?? []), p]);
  if (name) groups.set(`name:${name}`, [...(groups.get(`name:${name}`) ?? []), p]);
}
const dupes = [...groups]
  .filter(([, list]) => list.length > 1)
  .map(([k, list]) => {
    // Combined monthly usage of all accounts in the group, to catch splitting quota across accounts.
    const combined = new Map<string, number>();
    for (const p of list) {
      for (const [month, s] of stats.get(p.id) ?? []) {
        combined.set(month, (combined.get(month) ?? 0) + s.total);
      }
    }
    const overMonths = [...combined]
      .filter(([, m]) => m > cap)
      .map(([month, m]) => `${month}:${h(m)}h`)
      .join(' ');
    return {
      matchOn: k.split(':')[0],
      accounts: list
        .map((p) => {
          const totalMin = [...(stats.get(p.id)?.values() ?? [])].reduce((sum, s) => sum + s.total, 0);
          return `${label(p.id)} [${h(totalMin)}h]`;
        })
        .join(' | '),
      combinedOverCap: overMonths || '-',
    };
  });
console.table(dupes);
