-- Printers can be parked for maintenance: still shown on the calendar with
-- their existing bookings, but closed to new ones.

alter table public.printers
  add column in_maintenance boolean not null default false;

insert into public.printers (name, model, sort_order, notes) values
  ('U1', 'Snapmaker U1', 1, 'Four-toolhead tool changer, fast multi-colour prints.')
on conflict (name) do nothing;

update public.printers
   set in_maintenance = true,
       sort_order     = 2
 where name = 'CR10';

-- Last line of defence behind the app check: no new bookings on a parked or
-- retired machine, whichever path the insert comes from.
create or replace function public.reject_unavailable_printer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.printers
     where id = new.printer_id
       and (in_maintenance or not is_active)
  ) then
    raise exception 'printer_unavailable'
      using hint = 'This printer is not taking bookings right now.';
  end if;
  return new;
end;
$$;

revoke execute on function public.reject_unavailable_printer() from public, anon, authenticated;

create trigger reservations_reject_unavailable_printer
  before insert on public.reservations
  for each row execute function public.reject_unavailable_printer();
