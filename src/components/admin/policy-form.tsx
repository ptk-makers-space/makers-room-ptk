'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { SchedulingPolicy } from '@/lib/scheduling';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type NumberField = {
  key: keyof SchedulingPolicy;
  label: string;
  hint?: string;
  /** Shown in hours, stored in minutes. */
  hours?: boolean;
  min: number;
  max: number;
  step?: number;
};

const SECTIONS: { title: string; fields: NumberField[] }[] = [
  {
    title: 'Quotas',
    fields: [
      { key: 'maxPrintsPerWorkingWeek', label: 'Daytime prints per working week', min: 0, max: 20 },
      {
        key: 'monthlyWorkingMinutesCap',
        label: 'Monthly working-hours cap',
        hint: 'hours',
        hours: true,
        min: 0,
        max: 200,
        step: 0.5,
      },
      { key: 'maxActiveReservations', label: 'Upcoming bookings held at once', min: 1, max: 50 },
      {
        key: 'openBookingHours',
        label: 'Quotas waived this close to start',
        hint: 'hours',
        min: 1,
        max: 168,
      },
    ],
  },
  {
    title: 'Time windows',
    fields: [
      { key: 'primeTimeStartHour', label: 'Working hours start', hint: 'hour, 0–23', min: 0, max: 23 },
      { key: 'primeTimeEndHour', label: 'Working hours end', hint: 'hour, 1–24', min: 1, max: 24 },
      { key: 'overnightStartHour', label: 'Overnight window start', hint: 'hour, 0–23', min: 0, max: 23 },
      { key: 'overnightEndHour', label: 'Overnight window end', hint: 'hour, 0–23', min: 0, max: 23 },
      {
        key: 'longPrintThresholdMinutes',
        label: 'Suggest overnight for prints longer than',
        hint: 'hours',
        hours: true,
        min: 0.5,
        max: 24,
        step: 0.5,
      },
    ],
  },
  {
    title: 'Slots',
    fields: [
      { key: 'bufferMinutes', label: 'Cleaning gap between prints', hint: 'minutes, 0 = none', min: 0, max: 120 },
      { key: 'slotGranularityMinutes', label: 'Start-time step', hint: 'minutes', min: 1, max: 60 },
      { key: 'minReservationMinutes', label: 'Shortest booking', hint: 'minutes', min: 5, max: 1440 },
    ],
  },
];

export function PolicyForm({ policy }: { policy: SchedulingPolicy }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        const raw = policy[field.key] as number;
        initial[field.key] = String(field.hours ? raw / 60 : raw);
      }
    }
    return initial;
  });
  const [workingDays, setWorkingDays] = useState<number[]>(policy.workingDays);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleDay(day: number) {
    setWorkingDays((days) =>
      days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort(),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSaved(false);

    const payload: Record<string, number | number[]> = { workingDays };
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        const number = Number(values[field.key]);
        payload[field.key] = Math.round(field.hours ? number * 60 : number);
      }
    }

    try {
      const response = await fetch('/api/admin/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const fieldErrors = body.issues?.fieldErrors as Record<string, string[]> | undefined;
        const first = fieldErrors && Object.entries(fieldErrors)[0];
        setError(first ? `${first[0]}: ${first[1][0]}` : body.error ?? 'Could not save the rules.');
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Network error.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {SECTIONS.map((section) => (
        <fieldset key={section.title}>
          <legend className="mb-2 text-sm font-semibold text-slate-900">{section.title}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  {field.label}
                  {field.hint ? <span className="text-slate-400"> · {field.hint}</span> : null}
                </span>
                <input
                  type="number"
                  required
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  value={values[field.key]}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-slate-900">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((name, day) => (
            <label
              key={name}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                workingDays.includes(day)
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-600'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={workingDays.includes(day)}
                onChange={() => toggleDay(day)}
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-emerald-600">Rules saved. They apply immediately.</p> : null}

      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isSaving ? 'Saving…' : 'Save rules'}
      </button>
    </form>
  );
}
