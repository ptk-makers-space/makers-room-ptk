import type { PrintPriority, ReservationStatus } from '@/lib/scheduling';

export interface CalendarParticipant {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Reservation shape passed from server components to the calendar. */
export interface CalendarReservation {
  id: string;
  printerId: string;
  userId: string;
  title: string;
  notes: string | null;
  priority: PrintPriority;
  status: ReservationStatus;
  /** ISO strings so the object survives the server/client boundary. */
  startsAt: string;
  endsAt: string;
  ownerName: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  colorIndex: number;
  /** Owner is happy for other members to join this session. */
  allowsJoiners: boolean;
  participants: CalendarParticipant[];
}

export interface CalendarPrinter {
  id: string;
  name: string;
  model: string | null;
  notes: string | null;
  /** Shown on the calendar but closed to new bookings. */
  inMaintenance: boolean;
}

export interface ViewerSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: 'member' | 'admin';
  /** Short badge text, e.g. "6h 30m of daytime budget left". */
  monthlyBudgetLabel: string;
  /** Full quota breakdown shown as a tooltip and on the summary pages. */
  quotaExplanation: string;
}

export const PRIORITY_STYLES: Record<
  PrintPriority,
  { label: string; badge: string; dot: string }
> = {
  urgent: {
    label: 'Urgent work',
    badge: 'bg-rose-100 text-rose-700 ring-rose-200',
    dot: 'bg-rose-500',
  },
  standard: {
    label: 'Work',
    badge: 'bg-sky-100 text-sky-700 ring-sky-200',
    dot: 'bg-sky-500',
  },
  fun: {
    label: 'Fun',
    badge: 'bg-violet-100 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
  },
};
