import Link from 'next/link';

import { formatMinutes } from '@/lib/scheduling';

import type { ViewerSummary } from './calendar-types';

export function AppHeader({
  viewer,
  active,
}: {
  viewer: ViewerSummary;
  active: 'schedule' | 'my-prints' | 'rules' | 'admin';
}) {
  const initials = viewer.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const { budget } = viewer;
  const leftRatio =
    budget.capMinutes > 0 ? Math.max(budget.remainingMinutes, 0) / budget.capMinutes : 0;
  const tone =
    leftRatio > 0.5
      ? { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', bar: 'bg-emerald-500' }
      : leftRatio > 0.2
        ? { box: 'border-amber-200 bg-amber-50 text-amber-900', bar: 'bg-amber-500' }
        : { box: 'border-rose-200 bg-rose-50 text-rose-900', bar: 'bg-rose-500' };

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm">
            🖨️
          </span>
          <span className="text-sm font-semibold text-slate-900">MakersRoom PTK</span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          <NavLink href="/" active={active === 'schedule'}>
            Schedule
          </NavLink>
          <NavLink href="/my-prints" active={active === 'my-prints'}>
            My prints
          </NavLink>
          <NavLink href="/rules" active={active === 'rules'}>
            Rules
          </NavLink>
          {viewer.role === 'admin' ? (
            <NavLink href="/admin" active={active === 'admin'}>
              Admin
            </NavLink>
          ) : null}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/my-prints"
            title={viewer.quotaExplanation}
            className={`flex flex-col gap-1 rounded-lg border px-3 py-1.5 ${tone.box}`}
          >
            <span className="flex items-baseline gap-2 text-xs">
              <span>☀️ Daytime budget</span>
              <span className="text-sm font-semibold">
                {budget.remainingMinutes < 0
                  ? `${formatMinutes(-budget.remainingMinutes)} in minus`
                  : `${formatMinutes(budget.remainingMinutes)} left`}
              </span>
              <span className="opacity-70">of {formatMinutes(budget.capMinutes)}</span>
              <span className="opacity-70">
                · 🌙 {Math.max(budget.nightsCap - budget.nightsUsed, 0)}/{budget.nightsCap} nights
              </span>
            </span>
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-white/70">
              <span
                className={`block h-full rounded-full ${tone.bar}`}
                style={{ width: `${Math.round(leftRatio * 100)}%` }}
              />
            </span>
          </Link>
          <Link
            href="/onboarding"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700"
            title={`${viewer.name} · edit contact details`}
          >
            {initials || '?'}
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-sm text-slate-500 transition hover:text-slate-900"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
      {viewer.isBlocked ? (
        <p role="alert" className="bg-rose-50 px-4 py-2 text-center text-sm text-rose-700">
          Your account is suspended, so you cannot book, move or join prints. Contact a
          makerspace admin to have the ban lifted.
        </p>
      ) : null}
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 font-medium transition ${
        active ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {children}
    </Link>
  );
}
