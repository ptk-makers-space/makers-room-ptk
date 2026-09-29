-- When an admin moves a booking, its reminder ledger rows are cleared so the
-- cron sends fresh 24h/1h reminders for the new start time.
grant delete on table public.print_reminder_deliveries to service_role;
