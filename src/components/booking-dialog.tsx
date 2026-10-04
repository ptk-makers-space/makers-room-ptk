'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  classifySlot,
  formatMinutes,
  zonedWallTimeToDate,
  type BookingDecision,
  type PrintPriority,
  type SchedulingPolicy,
} from '@/lib/scheduling';

import type { CalendarPrinter } from './calendar-types';

interface BookingDialogProps {
  open: boolean;
  onClose: () => void;
  printers: CalendarPrinter[];
  policy: SchedulingPolicy;
  /** Pre-filled from the slot the member clicked. */
  initial: { printerId: string; dateKey: string; startTime: string };
}

const DURATION_CHOICES = [
  30, 60, 90, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 960,
  1080, 1200, 1320, 1440,
];

function timeOptions(granularity: number): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += granularity) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    const minute = String(minutes % 60).padStart(2, '0');
    options.push(`${hour}:${minute}`);
  }
  return options;
}

/** Combine a `YYYY-MM-DD` key and `HH:MM` into an instant in the shop's timezone. */
export function toInstant(dateKey: string, time: string, timeZone: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  return zonedWallTimeToDate(
    Number(dateMatch[1]),
    Number(dateMatch[2]),
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    timeZone,
  );
}

export function BookingDialog({
  open,
  onClose,
  printers,
  policy,
  initial,
}: BookingDialogProps) {
  const router = useRouter();
  const [printerId, setPrinterId] = useState(initial.printerId);
  const [dateKey, setDateKey] = useState(initial.dateKey);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [duration, setDuration] = useState(120);
  const [priority, setPriority] = useState<PrintPriority>('fun');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [justification, setJustification] = useState('');
  const [allowsJoiners, setAllowsJoiners] = useState(false);

  const [decision, setDecision] = useState<BookingDecision | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  /** Set once the booking is saved; the dialog then offers the calendar file. */
  const [booked, setBooked] = useState<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    printerName: string;
  } | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset to the clicked slot whenever the dialog reopens.
  useEffect(() => {
    if (!open) return;
    setPrinterId(initial.printerId);
    setDateKey(initial.dateKey);
    setStartTime(initial.startTime);
    setServerError(null);
    setDecision(null);
    setAllowsJoiners(false);
    setBooked(null);
  }, [open, initial.printerId, initial.dateKey, initial.startTime]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const range = useMemo(() => {
    const start = toInstant(dateKey, startTime, policy.timeZone);
    if (!start) return null;
    return { start, end: new Date(start.getTime() + duration * 60_000) };
  }, [dateKey, startTime, duration, policy.timeZone]);

  // Local preview so the overnight/duration rules show up instantly, before
  // the server round-trip confirms quotas and conflicts.
  const localClassification = useMemo(
    () => (range ? classifySlot({ startsAt: range.start, endsAt: range.end }, policy, new Date()) : null),
    [range, policy],
  );

  const payload = useMemo(() => {
    if (!range) return null;
    return {
      printerId,
      title: title.trim() || 'Untitled print',
      notes: notes.trim() || null,
      priority,
      startsAt: range.start.toISOString(),
      endsAt: range.end.toISOString(),
      justification: justification.trim() || null,
      allowsJoiners,
    };
  }, [range, printerId, title, notes, priority, justification, allowsJoiners]);

  // Ask the server to run the full rule set as the member edits.
  useEffect(() => {
    if (!open || !payload || booked) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsChecking(true);
      try {
        const response = await fetch('/api/bookings/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const body = await response.json();
        setDecision(response.ok ? body.decision : null);
      } catch {
        // Aborted or offline: keep the last good decision.
      } finally {
        setIsChecking(false);
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, payload, booked]);

  const submit = useCallback(async () => {
    if (!payload) return;
    setIsSaving(true);
    setServerError(null);
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        setServerError(body.error ?? 'Could not book that slot.');
        if (body.decision) setDecision(body.decision);
        return;
      }
      const reservation = body.reservation as {
        id: string;
        title: string;
        starts_at: string;
        ends_at: string;
        printer_id: string;
      };
      // Keep the dialog open so the member can grab the calendar file; the
      // schedule behind it refreshes straight away.
      setBooked({
        id: reservation.id,
        title: reservation.title,
        startsAt: reservation.starts_at,
        endsAt: reservation.ends_at,
        printerName:
          printers.find((printer) => printer.id === reservation.printer_id)?.name ?? '',
      });
      router.refresh();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Network error.');
    } finally {
      setIsSaving(false);
    }
  }, [payload, printers, router]);

  if (!open) return null;

  if (booked) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Print booked"
          className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        >
          <h2 className="text-base font-semibold text-slate-900">✅ Your print is booked</h2>
          <p className="mt-2 text-sm text-slate-600">
            <strong className="text-slate-900">{booked.title}</strong> on {booked.printerName}
            <br />
            {new Intl.DateTimeFormat('en-GB', {
              timeZone: policy.timeZone,
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(booked.startsAt))}
            {' – '}
            {new Intl.DateTimeFormat('en-GB', {
              timeZone: policy.timeZone,
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(booked.endsAt))}
          </p>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Want a reminder?</p>
            <p className="mt-1 text-xs text-slate-500">
              Download the calendar file and open it to add this print to Google, Outlook or
              Apple Calendar. It includes a reminder one hour before the start.
            </p>
            <a
              href={`/api/reservations/${booked.id}/ics`}
              download
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              📅 Add to my calendar
            </a>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const blockers = decision?.violations ?? [];
  const canSubmit =
    !isSaving && !isChecking && Boolean(title.trim()) && decision?.allowed === true;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Book a print"
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Book a print</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <Field label="What are you printing?">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Bracket v3"
              maxLength={80}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Printer">
              <select
                value={printerId}
                onChange={(event) => setPrinterId(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                {printers.map((printer) => (
                  <option key={printer.id} value={printer.id}>
                    {printer.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Type">
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as PrintPriority)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                <option value="fun">Fun / personal</option>
                <option value="standard">Work</option>
                <option value="urgent">Urgent work</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={dateKey}
                onChange={(event) => setDateKey(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </Field>
            <Field label="Start">
              <select
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                {timeOptions(policy.slotGranularityMinutes).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Length">
              <select
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              >
                {DURATION_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {priority === 'urgent' ? (
            <Field label="Why is this urgent?">
              <input
                value={justification}
                onChange={(event) => setJustification(event.target.value)}
                placeholder="Customer demo on Thursday"
                maxLength={200}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
              />
            </Field>
          ) : null}

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Material, colour, anything the next person should know."
              className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </Field>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
            <input
              type="checkbox"
              checked={allowsJoiners}
              onChange={(event) => setAllowsJoiners(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-900">Let others join me</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Other members can add their parts to this session. Joining costs them
                nothing from their own weekly or monthly quota.
              </span>
            </span>
          </label>

          {localClassification ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Chip>{formatMinutes(localClassification.durationMinutes)}</Chip>
              <Chip>
                {localClassification.isOvernight ? '🌙 Overnight' : '☀️ Daytime'}
              </Chip>
              {localClassification.isLongPrint ? <Chip>Long print</Chip> : null}
              {localClassification.isOpenBooking ? <Chip>Open slot</Chip> : null}
            </div>
          ) : null}

          {blockers.length > 0 ? (
            <ul className="space-y-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {blockers.map((violation) => (
                <li key={violation.code}>{violation.message}</li>
              ))}
            </ul>
          ) : null}

          {decision && decision.warnings.length > 0 ? (
            <ul className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {decision.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          ) : null}

          {decision && decision.preemptions.length > 0 ? (
            <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
              <p className="font-medium">This will bump:</p>
              <ul className="mt-1 space-y-1">
                {decision.preemptions.map((preemption) => (
                  <li key={preemption.id}>· {preemption.title}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {serverError ? (
            <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              {serverError}
            </p>
          ) : null}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4">
          <span className="text-xs text-slate-500">
            {isChecking ? 'Checking the rules…' : decision?.allowed ? 'Slot is free' : ''}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? 'Booking…' : 'Book slot'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
      {children}
    </span>
  );
}
