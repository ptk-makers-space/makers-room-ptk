-- Minutes charged to a print's owner for overrunning into the next member's slot.
alter table public.reservations
  add column if not exists overrun_penalty_minutes integer not null default 0
    check (overrun_penalty_minutes >= 0);

comment on column public.reservations.overrun_penalty_minutes is
  'Minutes charged to the owner''s monthly budget because this print delayed the next booking.';
