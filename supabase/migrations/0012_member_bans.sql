-- Bans are enforced through profiles.is_blocked, so members must not be able to
-- clear it (or promote themselves via role) with a direct REST update on their
-- own row. Limit what the "members update own profile" policy can touch to the
-- contact details the app actually lets them edit.
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, phone) on table public.profiles to authenticated;
