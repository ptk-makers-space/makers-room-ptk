/**
 * Domain types for the MakersRoom PTK 3D-printer queue.
 *
 * The scheduling engine is intentionally free of any database or React
 * dependency so that every booking rule can be unit tested in isolation.
 */

/** Why a print is being queued. Drives pre-emption. */
export type PrintPriority = 'urgent' | 'standard' | 'fun';

export type ReservationStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'preempted';

export interface SchedulingPolicy {
  /** IANA timezone the physical makerspace lives in. */
  timeZone: string;

  /** Bookings must align to this many minutes. */
  slotGranularityMinutes: number;
  minReservationMinutes: number;
  /** Gap that must be left between two prints on a machine, for cleaning. */
  bufferMinutes: number;

  /**
   * Prints longer than this are suggested (never forced) to run overnight.
   * There is no cap on how long a print may be.
   */
  longPrintThresholdMinutes: number;

  /** Overnight window, e.g. 19:00 -> 08:00 local time. */
  overnightStartHour: number;
  overnightEndHour: number;
  /** Fraction of a print that must fall inside the overnight window. */
  overnightCoverageRatio: number;

  /** Prime time (daytime) window used for the working-hours quotas. */
  primeTimeStartHour: number;
  primeTimeEndHour: number;

  /**
   * Local days that count as working days (0 = Sunday .. 6 = Saturday).
   * Only prints that run during working hours on these days count towards the
   * working-week and monthly caps; nights and weekends are free capacity.
   */
  workingDays: number[];
  /** Max daytime prints a member may hold in one Sun-Thu working week. */
  maxPrintsPerWorkingWeek: number;
  /** Cap on daytime working-hours minutes within a calendar month. */
  monthlyWorkingMinutesCap: number;
  /** Cap on simultaneously held future reservations. */
  maxActiveReservations: number;

  /**
   * Inside this many hours before start, any free slot is open to anyone:
   * quota limits are waived so slots never go to waste.
   */
  openBookingHours: number;

  /** Max overnight fun prints a member may book per calendar month. */
  maxOvernightPrintsPerMonth: number;
  /** Inside this many hours before start, a free overnight slot skips the night cap. */
  overnightOpenBookingHours: number;

  /** Cancelling this close to the start charges part of the slot to the monthly budget. */
  lateCancelHours: number;
  /** Share of the slot length charged for a late cancellation (0.5 = half). */
  lateCancelPenaltyRatio: number;

  /** Urgent work is unlimited, but must say why. */
  urgentRequiresJustification: boolean;

  /** Which priorities each priority is allowed to bump. */
  preemptibleBy: Record<PrintPriority, PrintPriority[]>;
  /** Whether a print that already started may be bumped. */
  allowPreemptInProgress: boolean;
}

export interface ExistingReservation {
  id: string;
  printerId: string;
  userId: string;
  title: string;
  priority: PrintPriority;
  status: ReservationStatus;
  startsAt: Date;
  endsAt: Date;
}

/** Aggregated usage for the member making the request. */
export interface UserUsage {
  /** Currently held reservations that have not finished yet. */
  activeReservations: number;
  /** Daytime prints already held in the Sun-Thu week containing the slot. */
  workingWeekReservations: number;
  /** Daytime working-hours minutes used in the calendar month of the slot. */
  monthWorkingMinutes: number;
  /** Overnight fun prints held in the calendar month of the slot. */
  monthOvernightPrints: number;
}

export interface MemberProfile {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  role: 'member' | 'admin';
  isBlocked: boolean;
}

export interface BookingRequest {
  printerId: string;
  userId: string;
  title: string;
  priority: PrintPriority;
  startsAt: Date;
  endsAt: Date;
  justification?: string | null;
  /** Owner is happy for other members to join this print session. */
  allowsJoiners?: boolean;
  /** Set when editing an existing booking so it does not conflict with itself. */
  reservationId?: string | null;
}

export interface BookingContext {
  now: Date;
  policy: SchedulingPolicy;
  profile: MemberProfile;
  usage: UserUsage;
  /** Reservations on the requested printer that could overlap. */
  printerReservations: ExistingReservation[];
}

export type RuleSeverity = 'error' | 'warning';

export interface RuleViolation {
  code: string;
  message: string;
  severity: RuleSeverity;
}

export interface SlotClassification {
  durationMinutes: number;
  overnightMinutes: number;
  overnightRatio: number;
  isOvernight: boolean;
  isLongPrint: boolean;
  isPrimeTime: boolean;
  /** Minutes of the slot that fall in working hours on a working day. */
  workingDaytimeMinutes: number;
  /** True when the slot starts in working hours on a working day. */
  isWorkingDaytime: boolean;
  /** Hours from `now` until the slot starts. */
  leadTimeHours: number;
  /** True when the slot is inside the open (free-for-all) window. */
  isOpenBooking: boolean;
}

export interface BookingDecision {
  allowed: boolean;
  classification: SlotClassification;
  violations: RuleViolation[];
  warnings: RuleViolation[];
  /** True when every violation is a quota an admin may knowingly approve past. */
  overridable: boolean;
  /** The member's usage the decision was made against, for budget previews. */
  usage: UserUsage;
  /** Existing reservations that would be bumped if this booking proceeds. */
  preemptions: ExistingReservation[];
}
