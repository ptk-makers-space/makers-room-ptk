-- Vercel Hobby only allows daily crons, but reminders need a 5-minute tick.
-- Supabase calls the endpoint instead. It reads two Vault secrets, which must
-- be created in the dashboard (Project Settings -> Vault):
--   app_url     e.g. https://makers-room-ptk.vercel.app   (no trailing slash)
--   cron_secret the same value as CRON_SECRET in Vercel

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'print-reminders',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url')
           || '/api/cron/print-reminders',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
