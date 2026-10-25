'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AdminMember {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin';
  isBlocked: boolean;
}

export function MemberManager({
  members,
  currentUserId,
}: {
  members: AdminMember[];
  currentUserId: string;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = members.filter(
    (member) =>
      member.isBlocked ||
      (needle !== '' &&
        (member.name.toLowerCase().includes(needle) ||
          member.email.toLowerCase().includes(needle))),
  );

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search members by name or email"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
      />
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">
          {needle ? 'No members match.' : 'No one is banned. Search to find a member.'}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {visible.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberRow({ member, isSelf }: { member: AdminMember; isSelf: boolean }) {
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !member.isBlocked;
    if (
      next &&
      !window.confirm(
        `Ban ${member.name}? Their upcoming prints will be cancelled and they will not be able to book until an admin lifts the ban.`,
      )
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isBlocked: next }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? 'Something went wrong.');
        return;
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error.');
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{member.name}</span>
          {member.role === 'admin' ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              Admin
            </span>
          ) : null}
          {member.isBlocked ? (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
              Banned
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-slate-500">{member.email}</p>
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </div>
      {isSelf || (member.role === 'admin' && !member.isBlocked) ? null : (
        <button
          type="button"
          disabled={isBusy}
          onClick={toggle}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            member.isBlocked
              ? 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              : 'border border-rose-200 text-rose-600 hover:bg-rose-50'
          }`}
        >
          {member.isBlocked ? 'Lift ban' : 'Ban'}
        </button>
      )}
    </li>
  );
}
