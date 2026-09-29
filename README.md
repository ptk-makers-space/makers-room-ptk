# MakersRoom PTK — 3D printer queue

A booking app for the workshop's two 3D printers. Members sign in with Google,
pick a slot on a shared weekly calendar, and the app enforces the house rules so
the machines stay busy and no single person can monopolise them.

**Live: https://makers-room-ptk.vercel.app**

- **Stack:** Next.js 15 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Auth) · Vercel
- **Auth:** Google OAuth via Supabase
- **Tests:** Vitest — 84 unit tests covering the scheduling rules
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) — forks and pull requests welcome
- **Licence:** [MIT](LICENSE)

---

## The rules it enforces

| Rule | Behaviour |
| --- | --- |
| **Two printers** | Each booking is tied to one machine. A database exclusion constraint makes double-booking impossible, even under a race. |
| **5-minute cleaning gap** | Consecutive prints on a machine must leave a 5-minute gap: a print ending at 12:00 frees the machine from 12:05. Times are picked on a 5-minute grid, and the gap is enforced by the same exclusion constraint. |
| **Join me** | A booking can be opened up so other members join the same session and print their parts alongside. Joining creates no reservation, so it costs the joiner nothing from their weekly or monthly quota. |
| **No length cap** | A print may run as long as it needs, day or night. What is rationed is *working-hours* machine time, not the length of a job. |
| **Long prints: a suggestion, not a rule** | Prints over 5h get a nudge to start in the overnight window (17:00–08:00). Nothing blocks a long daytime print, but night hours cost no quota, so moving it there keeps your working-week print free for something else. |
| **Urgent work beats fun prints** | Bookings are `fun`, `standard` (work) or `urgent`. An urgent job takes over a slot held by a *fun* print, and the owner's email and phone are surfaced so they can be told. Urgent never bumps other work, and never bumps a print that has already started. |
| **Urgent is unlimited** | There is no cap on urgent bookings. The only requirement is a one-line reason, so whoever gets bumped understands why. |
| **Work and urgent are unlimited** | Only `fun` prints are rationed by the working-week and monthly quotas below. `standard` (work) and `urgent` prints never count against those quotas and are never blocked by them. |
| **One daytime print per working week** | Only one *fun* print may start during working hours (08:00–17:00, Sun–Thu) in any calendar week. Nights and weekends do not count, so long jobs are pushed to the cheap capacity. |
| **10 working hours per month** | A member may spend at most 10h of working-hours machine time per calendar month on *fun* prints. Only the part of a print that runs 08:00–17:00 on Sun–Thu is charged, so overnight and weekend prints are free. |
| **Open bookings** | At most 5 upcoming bookings may be held at once, so nobody can claim a long row of slots in advance. There is no limit on how far ahead you may book. |
| **Free slots open to everyone** | Within 24h of the start time every quota is waived — if a slot is still empty, anyone can take it. An idle printer helps nobody. |
| **Contact details** | Every member has an email and a phone number on file, shown to signed-in members so a failed or bumped print can be chased up. |
| **Email reminders** | Reservation owners and members who joined a print receive reminders 24 hours and 1 hour before it starts. |

Every number above lives in `policy_settings` and can be tuned without a
redeploy. The defaults are in
[`src/lib/scheduling/policy.ts`](src/lib/scheduling/policy.ts).

---

## How it fits together

```
src/lib/scheduling/    Pure, dependency-free rules engine (fully unit tested)
  types.ts             Domain types
  time.ts              Timezone + overnight-window maths (DST safe)
  policy.ts            Default house rules
  usage.ts             Reservation history -> working-week / monthly aggregates
  rules.ts             evaluateBooking() - the single source of truth

src/lib/bookings/      Glue between the engine and the database
src/lib/supabase/      Browser / server / service-role clients
src/app/               Routes, pages and API endpoints
supabase/migrations/   SQL schema, RLS policies and the atomic booking function
```

**The rules are enforced on the server.** Members have no `INSERT` or `UPDATE`
rights on `reservations`; every booking goes through `/api/reservations`, which
runs `evaluateBooking` and only then writes using the service role. Calling the
Supabase REST API directly cannot bypass a single rule.

The booking dialog calls `/api/bookings/preview`, which runs the *same* engine,
so what a member sees while picking a time is exactly what gets enforced.

---

## Local setup

### 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run, in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_book_reservation.sql`
   - `supabase/migrations/0003_harden_security.sql`
   - `supabase/migrations/0004_join_and_buffer.sql`
   - `supabase/migrations/0005_print_reminders.sql`
   - `supabase/migrations/0003_harden_security.sql`
   - `supabase/migrations/0004_join_and_buffer.sql`

   This creates the tables, row level security policies, the two printers, the
   shared-session ("join me") table, the 5-minute cleaning gap constraint and
   the atomic `book_reservation` function.

### 2. Turn on Google sign-in

1. In Google Cloud Console create an **OAuth 2.0 Client ID** (type: *Web application*).
2. Add this authorised redirect URI — the project ref is in your Supabase URL:

   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

3. In Supabase → **Authentication → Providers → Google**, enable it and paste the
   client ID and secret.
4. In Supabase → **Authentication → URL Configuration**, set:
   - **Site URL** → `http://localhost:3000` for local work, your Vercel URL in production
   - **Redirect URLs** → add `http://localhost:3000/**` and `https://<your-app>.vercel.app/**`

### 3. Configure and run

```bash
cp .env.example .env.local   # then fill in the Supabase values
npm install
npm run dev
```

Open <http://localhost:3000>. The first sign-in creates your member profile
automatically; you'll be asked for a phone number before your first booking.

To make yourself an admin:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

---

## Access and moderation

Sign-up is deliberately **open**: anyone who reaches the URL and has a Google
account can join and book. For a small makerspace that beats maintaining an
invite list, and it matches how the room already works.

The lever for abuse is reactive rather than preventative. To suspend someone:

```sql
update public.profiles set is_blocked = true where email = 'them@example.com';
```

A blocked member can still sign in and read the calendar, but every booking is
refused with a clear message. Reverse it by setting the flag back to `false`.

If the workshop outgrows this, the natural next steps are restricting sign-in to
one email domain, or adding an `approved` flag that an admin flips before a
member's first booking.

---

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project** and import the repo. The framework is
   detected automatically; no build settings need changing.
3. Add the environment variables from `.env.example` to
   **Settings → Environment Variables** (Production, Preview and Development).

   > `SUPABASE_SERVICE_ROLE_KEY` must **not** have the `NEXT_PUBLIC_` prefix —
   > that prefix is what would ship it to the browser.

4. Deploy, then return to Supabase → **Authentication → URL Configuration** and
   add the live Vercel URL to **Site URL** and **Redirect URLs**.

### Reminder email setup

1. Create a [Resend](https://resend.com/) account, verify the sending domain,
   and create an API key.
2. Set `RESEND_API_KEY` and `PRINT_REMINDER_FROM` in Vercel.
3. Generate a long random `CRON_SECRET` and set it in Vercel. Vercel includes
   it automatically in the authorization header when invoking cron routes.
4. Apply `supabase/migrations/0005_print_reminders.sql` before the next deploy.

Vercel invokes `/api/cron/print-reminders` every five minutes. The endpoint
claims due reminders in Supabase before sending them, records failures for
retry, and uses a stable Resend idempotency key to prevent duplicate mail.
The five-minute schedule requires a Vercel plan that supports sub-daily cron
jobs.

Anyone with the link can reach the app, but they must sign in with Google to see
or book anything. `/rules` is readable without an account.

---

## Contributing

Contributions are welcome — fork the repo, create a branch, and open a pull
request. Full guidance is in [CONTRIBUTING.md](CONTRIBUTING.md).

Worth knowing before you start: **the scheduling rules can be worked on with no
setup at all.** The engine in `src/lib/scheduling/` is pure TypeScript with no
database or React dependency, so `npm install && npm test` is the entire loop
for any change to booking behaviour.

```bash
git clone https://github.com/<your-username>/makers-room-ptk.git
cd makers-room-ptk
npm install
npm test          # no database or config needed
npm run verify    # typecheck + lint + tests, run this before pushing
```

Running the full app additionally needs your own free Supabase project — see
[Local setup](#local-setup) above. Please don't point development at the live
makerspace database.

---

## Commands

```bash
npm run dev        # development server
npm run build      # production build
npm run test       # unit tests
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run verify     # typecheck + lint + test
```

---

## Notes and trade-offs

- **Contact details are visible to all signed-in members.** That is deliberate —
  the brief calls for members to be able to reach each other about prints. If the
  workshop grows, restrict `phone` to admins and to members directly affected by
  a bump.
- **Pre-emption notifies via the UI and the audit log**, not yet by email or SMS.
  Every bump is recorded in `reservation_events` along with the bumped member's
  contact details, so wiring in Resend or Twilio is a small, self-contained
  addition.
- **Timezone** is fixed to `Asia/Jerusalem` in the policy. Overnight and
  prime-time windows are evaluated in that local time and handle DST correctly.
- **`in_progress` status** is set manually or by a future printer integration;
  the rules already refuse to bump a print once it is running.
