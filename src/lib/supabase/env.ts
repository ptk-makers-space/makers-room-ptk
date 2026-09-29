/**
 * Environment access with clear failure messages.
 *
 * Misconfigured deployments are the most common way this app breaks, so we
 * fail loudly and name the exact variable that is missing.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing environment variable ${name}. See .env.example and README.md for setup.`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export function getSupabaseAnonKey(): string {
  return required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Server-only. Bypasses RLS, so it must never reach the browser bundle. */
export function getSupabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getCronSecret(): string {
  return required('CRON_SECRET', process.env.CRON_SECRET);
}

export function getResendApiKey(): string {
  return required('RESEND_API_KEY', process.env.RESEND_API_KEY);
}

export function getPrintReminderFrom(): string {
  return required('PRINT_REMINDER_FROM', process.env.PRINT_REMINDER_FROM);
}

export function getPrintReminderTimeZone(): string {
  return process.env.PRINT_REMINDER_TIME_ZONE?.trim() || 'Asia/Jerusalem';
}

/** True when the Supabase environment is fully configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
