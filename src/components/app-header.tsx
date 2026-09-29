import Link from 'next/link';

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
          <span
            title={viewer.quotaExplanation}
            className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 sm:inline"
          >
            {viewer.monthlyBudgetLabel}
          </span>
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
