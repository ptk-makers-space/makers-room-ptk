-- Drop the mandatory 5-minute cleaning gap: back-to-back bookings are allowed.
-- The database now only blocks true overlaps; any gap is an app-level policy.

set search_path = public, extensions;

alter table public.reservations
  drop constraint if exists reservations_no_overlap;

alter table public.reservations
  add constraint reservations_no_overlap
  exclude using gist (
    printer_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('scheduled', 'in_progress'));

drop function if exists public.reservation_block(timestamptz, timestamptz);

update public.policy_settings set policy = policy - 'bufferMinutes';
