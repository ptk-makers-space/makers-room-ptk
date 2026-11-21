-- Late cancellations are charged against the member's monthly daytime budget.
alter table public.reservations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_penalty_minutes integer not null default 0
    check (cancel_penalty_minutes >= 0);

comment on column public.reservations.cancel_penalty_minutes is
  'Minutes charged to the owner''s monthly budget for cancelling close to the start.';
