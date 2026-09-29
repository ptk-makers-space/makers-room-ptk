-- Durable, idempotent email reminders for reservation owners and participants.

set search_path = public, extensions;

create table public.print_reminder_deliveries (
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  reminder_type  text not null check (reminder_type in ('24h', '1h')),
  status         text not null default 'sending'
                 check (status in ('sending', 'sent', 'failed')),
  attempts       integer not null default 1 check (attempts > 0),
  claimed_at     timestamptz not null default now(),
  sent_at        timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (reservation_id, user_id, reminder_type)
);

comment on table public.print_reminder_deliveries is
  'Delivery ledger for the 24-hour and 1-hour print reminder emails.';

create index print_reminder_deliveries_retry_idx
  on public.print_reminder_deliveries (status, claimed_at)
  where status in ('sending', 'failed');

create trigger print_reminder_deliveries_touch_updated_at
  before update on public.print_reminder_deliveries
  for each row execute function public.touch_updated_at();

alter table public.print_reminder_deliveries enable row level security;

revoke all on table public.print_reminder_deliveries
  from public, anon, authenticated;

grant select, insert, update on table public.print_reminder_deliveries
  to service_role;

create or replace function public.claim_print_reminders(
  p_now timestamptz default now(),
  p_limit integer default 25
)
returns table (
  reservation_id uuid,
  user_id uuid,
  reminder_type text,
  email text,
  full_name text,
  title text,
  printer_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with recipients as (
    select r.id as reservation_id, r.user_id
      from public.reservations r
     where r.status = 'scheduled'
       and r.starts_at > p_now
    union
    select r.id, rp.user_id
      from public.reservations r
      join public.reservation_participants rp on rp.reservation_id = r.id
     where r.status = 'scheduled'
       and r.starts_at > p_now
  ),
  newly_due as (
    select recipients.reservation_id, recipients.user_id, reminder.reminder_type
      from recipients
      join public.reservations r on r.id = recipients.reservation_id
      cross join (
        values
          ('24h'::text, interval '24 hours'),
          ('1h'::text, interval '1 hour')
      ) as reminder(reminder_type, lead_time)
     where r.starts_at <= p_now + reminder.lead_time
       and r.starts_at > p_now + reminder.lead_time - interval '10 minutes'
  ),
  retryable as (
    select d.reservation_id, d.user_id, d.reminder_type
      from public.print_reminder_deliveries d
      join public.reservations r on r.id = d.reservation_id
     where r.status = 'scheduled'
       and r.starts_at > p_now
       and (
         d.status = 'failed'
         or (d.status = 'sending' and d.claimed_at < p_now - interval '15 minutes')
       )
  ),
  candidates as (
    select due.reservation_id, due.user_id, due.reminder_type
      from (
        select * from newly_due
        union
        select * from retryable
      ) due
      join public.profiles p on p.id = due.user_id
     where btrim(p.email) <> ''
     order by due.reservation_id, due.user_id, due.reminder_type
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  ),
  claimed as (
    insert into public.print_reminder_deliveries as delivery (
      reservation_id,
      user_id,
      reminder_type,
      status,
      attempts,
      claimed_at,
      sent_at,
      last_error
    )
    select
      candidate.reservation_id,
      candidate.user_id,
      candidate.reminder_type,
      'sending',
      1,
      p_now,
      null,
      null
    from candidates candidate
    on conflict (reservation_id, user_id, reminder_type) do update
      set status = 'sending',
          attempts = delivery.attempts + 1,
          claimed_at = excluded.claimed_at,
          last_error = null
      where delivery.status = 'failed'
         or (
           delivery.status = 'sending'
           and delivery.claimed_at < p_now - interval '15 minutes'
         )
    returning
      delivery.reservation_id,
      delivery.user_id,
      delivery.reminder_type
  )
  select
    claimed.reservation_id,
    claimed.user_id,
    claimed.reminder_type,
    p.email,
    p.full_name,
    r.title,
    printer.name,
    r.starts_at,
    r.ends_at
  from claimed
  join public.reservations r on r.id = claimed.reservation_id
  join public.printers printer on printer.id = r.printer_id
  join public.profiles p on p.id = claimed.user_id;
$$;

revoke all on function public.claim_print_reminders(timestamptz, integer)
  from public, anon, authenticated;

grant execute on function public.claim_print_reminders(timestamptz, integer)
  to service_role;
