'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AdminPrinter {
  id: string;
  name: string;
  model: string | null;
  notes: string | null;
  sortOrder: number;
  inMaintenance: boolean;
  isActive: boolean;
}

async function send(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return payload.error ?? 'Something went wrong.';
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Network error.';
  }
}

export function PrinterManager({ printers }: { printers: AdminPrinter[] }) {
  const active = printers.filter((printer) => printer.isActive);
  const retired = printers.filter((printer) => !printer.isActive);

  return (
    <div className="space-y-4">
      {active.map((printer) => (
        <PrinterRow key={printer.id} printer={printer} />
      ))}

      {retired.length > 0 ? (
        <div className="space-y-2">
          <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Removed
          </h3>
          {retired.map((printer) => (
            <PrinterRow key={printer.id} printer={printer} />
          ))}
        </div>
      ) : null}

      <NewPrinterForm nextSortOrder={printers.length} />
    </div>
  );
}

function PrinterRow({ printer }: { printer: AdminPrinter }) {
  const router = useRouter();
  const [name, setName] = useState(printer.name);
  const [model, setModel] = useState(printer.model ?? '');
  const [notes, setNotes] = useState(printer.notes ?? '');
  const [sortOrder, setSortOrder] = useState(String(printer.sortOrder));
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty =
    name !== printer.name ||
    model !== (printer.model ?? '') ||
    notes !== (printer.notes ?? '') ||
    sortOrder !== String(printer.sortOrder);

  async function update(changes: Record<string, unknown>) {
    setIsBusy(true);
    setError(null);
    const failure = await send(`/api/admin/printers/${printer.id}`, 'PATCH', changes);
    setIsBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    router.refresh();
  }

  const status = !printer.isActive
    ? { label: 'Removed', className: 'bg-slate-100 text-slate-500' }
    : printer.inMaintenance
      ? { label: 'In maintenance', className: 'bg-amber-100 text-amber-700' }
      : { label: 'Available', className: 'bg-emerald-100 text-emerald-700' };

  return (
    <div
      className={`rounded-xl border p-4 ${
        printer.isActive ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900">{printer.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
            {status.label}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {printer.isActive ? (
            <>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => update({ inMaintenance: !printer.inMaintenance })}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {printer.inMaintenance ? 'Back in service' : 'Put in maintenance'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  if (window.confirm(`Remove ${printer.name}? It will disappear from the calendar.`)) {
                    void update({ isActive: false });
                  }
                }}
                className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50"
              >
                Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => update({ isActive: true })}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Restore
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_5rem]">
        <TextInput label="Name" value={name} onChange={setName} maxLength={40} />
        <TextInput label="Model" value={model} onChange={setModel} maxLength={80} />
        <TextInput label="Order" value={sortOrder} onChange={setSortOrder} type="number" />
        <div className="sm:col-span-3">
          <TextInput label="Notes shown to members" value={notes} onChange={setNotes} maxLength={300} />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {isDirty ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={isBusy || !name.trim()}
            onClick={() =>
              update({ name, model, notes, sortOrder: Number(sortOrder) || 0 })
            }
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Save changes
          </button>
          <button
            type="button"
            onClick={() => {
              setName(printer.name);
              setModel(printer.model ?? '');
              setNotes(printer.notes ?? '');
              setSortOrder(String(printer.sortOrder));
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
          >
            Discard
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewPrinterForm({ nextSortOrder }: { nextSortOrder: number }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [notes, setNotes] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    const failure = await send('/api/admin/printers', 'POST', {
      name,
      model,
      notes,
      sortOrder: nextSortOrder,
    });
    setIsBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setName('');
    setModel('');
    setNotes('');
    router.refresh();
  }

  return (
    <form onSubmit={add} className="rounded-xl border border-dashed border-slate-300 p-4">
      <h3 className="text-sm font-semibold text-slate-900">Add a printer</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextInput label="Name" value={name} onChange={setName} maxLength={40} required />
        <TextInput label="Model" value={model} onChange={setModel} maxLength={80} />
        <div className="sm:col-span-2">
          <TextInput label="Notes shown to members" value={notes} onChange={setNotes} maxLength={300} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isBusy || !name.trim()}
        className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isBusy ? 'Adding…' : 'Add printer'}
      </button>
    </form>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  maxLength,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        required={required}
        min={type === 'number' ? 0 : undefined}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900"
      />
    </label>
  );
}
