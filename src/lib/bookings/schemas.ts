import { z } from 'zod';

import { DEFAULT_POLICY } from '@/lib/scheduling';

/** Shared validation for anything that creates or previews a booking. */
export const bookingInputSchema = z
  .object({
    printerId: z.string().uuid('Pick a printer.'),
    title: z
      .string()
      .trim()
      .min(2, 'Give your print a short name.')
      .max(80, 'Keep the name under 80 characters.'),
    notes: z.string().trim().max(500).optional().nullable(),
    priority: z.enum(['urgent', 'standard', 'fun']),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    justification: z.string().trim().max(500).optional().nullable(),
    allowsJoiners: z.boolean().optional(),
    reservationId: z.string().uuid().optional().nullable(),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'The end time must be after the start time.',
    path: ['endsAt'],
  });

export type BookingInput = z.infer<typeof bookingInputSchema>;

export const profileInputSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Tell us your name.')
    .max(80, 'Keep it under 80 characters.'),
  phone: z
    .string()
    .trim()
    .regex(
      /^\+?[0-9 ()\-]{7,20}$/,
      'Enter a reachable phone number, e.g. +972 50 123 4567.',
    ),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Policy overrides an admin may save. Every field is optional. */
export const policyInputSchema = z
  .object({
    longPrintThresholdMinutes: z.number().int().min(30).max(24 * 60),
    overnightStartHour: z.number().int().min(0).max(23),
    overnightEndHour: z.number().int().min(0).max(23),
    primeTimeStartHour: z.number().int().min(0).max(23),
    primeTimeEndHour: z.number().int().min(1).max(24),
    openBookingHours: z.number().int().min(1).max(168),
    bufferMinutes: z.number().int().min(0).max(120),
    slotGranularityMinutes: z.number().int().min(1).max(60),
    minReservationMinutes: z.number().int().min(5).max(24 * 60),
    maxPrintsPerWorkingWeek: z.number().int().min(0).max(20),
    monthlyWorkingMinutesCap: z.number().int().min(0).max(200 * 60),
    maxActiveReservations: z.number().int().min(1).max(50),
    workingDays: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .partial();

export type PolicyInput = z.infer<typeof policyInputSchema>;

export const printerInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the printer a name.').max(40),
  model: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  inMaintenance: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const printerUpdateSchema = printerInputSchema.partial();

export type PrinterInput = z.infer<typeof printerInputSchema>;
export type PrinterUpdate = z.infer<typeof printerUpdateSchema>;

export const rescheduleInputSchema = z
  .object({
    printerId: z.string().uuid('Pick a printer.'),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: 'The end time must be after the start time.',
    path: ['endsAt'],
  });

export type RescheduleInput = z.infer<typeof rescheduleInputSchema>;

export const DEFAULT_TIME_ZONE = DEFAULT_POLICY.timeZone;
