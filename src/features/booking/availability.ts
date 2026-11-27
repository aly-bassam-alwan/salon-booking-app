import { TZDate } from '@date-fns/tz';

/**
 * Slot availability (SPEC.md §3.3), as a pure function: no clock, no network.
 *
 * A start time is offered only if the WHOLE appointment [start, start + duration)
 * fits inside the barber's working hours for that weekday and doesn't overlap a
 * booked appointment, the barber's time off or a salon-wide closure, and starts
 * at or after `now + minLeadMinutes`.
 *
 * These are the same rules `book_appointment` enforces in Postgres. The database
 * stays the authority; this function decides what the app offers.
 *
 * All intervals are half-open, so a booking ending at 10:00 doesn't block 10:00.
 */

export type AppointmentStatus = 'booked' | 'cancelled' | 'completed' | 'no_show';

/** A moment in time: a Date, or an ISO 8601 string as returned by Supabase. */
export type Instant = Date | string;

export type Barber = {
  id: string;
  /** Inactive barbers are not bookable. Defaults to active. */
  isActive?: boolean;
};

/** Weekly hours in salon-local wall-clock time (like the `working_hours` table). */
export type WorkingHours = {
  barberId: string;
  /** 0 = Sunday ... 6 = Saturday (same as Postgres `extract(dow)`). */
  weekday: number;
  /** "HH:mm" or "HH:mm:ss" (Postgres `time`). */
  startTime: string;
  endTime: string;
};

export type TimeOff = {
  /** null = the whole salon is closed. */
  barberId: string | null;
  startsAt: Instant;
  endsAt: Instant;
};

export type ExistingAppointment = {
  barberId: string;
  startsAt: Instant;
  endsAt: Instant;
  status: AppointmentStatus;
};

export type AvailabilityOptions = {
  /** Current time. Passed in so the function stays pure and testable. */
  now: Date;
  /** `salon_settings.min_lead_minutes`. Defaults to 0 (only past times excluded). */
  minLeadMinutes?: number;
  /** `salon_settings.slot_interval_minutes`. Defaults to 30 (fixed in v1 by a DB check). */
  slotIntervalMinutes?: number;
};

const MINUTE_MS = 60_000;

/**
 * Available start times for one barber on one salon-local date.
 *
 * @param date  Salon-local calendar date, "YYYY-MM-DD".
 * @returns     Start instants (UTC `Date`s), ascending.
 */
export function getAvailableSlots(
  date: string,
  barber: Barber,
  workingHours: readonly WorkingHours[],
  timeOff: readonly TimeOff[],
  existingAppointments: readonly ExistingAppointment[],
  totalDurationMinutes: number,
  salonTimezone: string,
  options: AvailabilityOptions,
): Date[] {
  const intervalMinutes = options.slotIntervalMinutes ?? 30;
  assertDuration(totalDurationMinutes, intervalMinutes);
  assertTimeZone(salonTimezone);
  const day = parseLocalDate(date);

  if (barber.isActive === false) return [];

  const hours = workingHours.find((h) => h.barberId === barber.id && h.weekday === day.weekday);
  if (!hours) return [];

  const open = localInstant(day, hours.startTime, salonTimezone);
  const close = localInstant(day, hours.endTime, salonTimezone);
  const earliest = options.now.getTime() + (options.minLeadMinutes ?? 0) * MINUTE_MS;
  const durationMs = totalDurationMinutes * MINUTE_MS;
  const stepMs = intervalMinutes * MINUTE_MS;

  // Only "booked" blocks a slot, matching the DB exclusion constraint.
  const busy: [start: number, end: number][] = [
    ...existingAppointments
      .filter((a) => a.barberId === barber.id && a.status === 'booked')
      .map((a) => toRange(a.startsAt, a.endsAt)),
    ...timeOff
      .filter((t) => t.barberId === null || t.barberId === barber.id)
      .map((t) => toRange(t.startsAt, t.endsAt)),
  ];

  const slots: Date[] = [];
  for (let start = open; start + durationMs <= close; start += stepMs) {
    if (start < earliest) continue;
    const end = start + durationMs;
    const overlaps = busy.some(([busyStart, busyEnd]) => start < busyEnd && busyStart < end);
    if (!overlaps) slots.push(new Date(start));
  }
  return slots;
}

/**
 * "Any available barber": a start time is offered if at least one barber can
 * take the whole appointment. Which barber gets it is decided by the server
 * at booking time (SPEC.md §3.5).
 */
export function getAvailableSlotsAnyBarber(
  date: string,
  barbers: readonly Barber[],
  workingHours: readonly WorkingHours[],
  timeOff: readonly TimeOff[],
  existingAppointments: readonly ExistingAppointment[],
  totalDurationMinutes: number,
  salonTimezone: string,
  options: AvailabilityOptions,
): Date[] {
  const starts = new Set<number>();
  for (const barber of barbers) {
    const slots = getAvailableSlots(
      date,
      barber,
      workingHours,
      timeOff,
      existingAppointments,
      totalDurationMinutes,
      salonTimezone,
      options,
    );
    for (const slot of slots) starts.add(slot.getTime());
  }
  return [...starts].sort((a, b) => a - b).map((ms) => new Date(ms));
}

// ---------------------------------------------------------------- helpers

type LocalDate = { year: number; month: number; day: number; weekday: number };

function parseLocalDate(date: string): LocalDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`Invalid date (expected YYYY-MM-DD): "${date}"`);
  const [year, month, day] = match.slice(1).map(Number);
  // Weekday of a calendar date doesn't depend on the timezone.
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date: "${date}"`);
  }
  return { year, month, day, weekday: utc.getUTCDay() };
}

/** Salon-local date + "HH:mm[:ss]" -> epoch milliseconds. */
function localInstant(day: LocalDate, time: string, timeZone: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match) throw new RangeError(`Invalid time (expected HH:mm or HH:mm:ss): "${time}"`);
  const [hours, minutes, seconds = 0] = match.slice(1).map((part) => Number(part ?? 0));
  return new TZDate(day.year, day.month - 1, day.day, hours, minutes, seconds, timeZone).getTime();
}

function toRange(startsAt: Instant, endsAt: Instant): [number, number] {
  return [toMillis(startsAt), toMillis(endsAt)];
}

function toMillis(value: Instant): number {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: "${String(value)}"`);
  return ms;
}

function assertDuration(minutes: number, intervalMinutes: number): void {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes % intervalMinutes !== 0) {
    throw new RangeError(
      `Duration must be a positive multiple of ${intervalMinutes} minutes, got ${minutes}`,
    );
  }
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new RangeError(`Invalid timezone: "${timeZone}"`);
  }
}
