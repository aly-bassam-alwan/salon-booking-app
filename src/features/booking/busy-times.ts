import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import {
  getAvailableSlots,
  getAvailableSlotsAnyBarber,
  type AvailabilityOptions,
  type Barber,
  type BusyInterval,
  type WorkingHours,
} from './availability';

/**
 * Connects the database to getAvailableSlots.
 *
 * Customers can't read other people's appointments (RLS), so the app loads:
 *   - anonymous busy intervals from the `get_busy_times` RPC, and
 *   - working hours of active barbers (publicly readable),
 * and computes slots locally. `book_appointment` re-checks every rule on the
 * server, so the database stays the authority.
 */

/** The parts of the Supabase client this module uses (easy to fake in tests). */
export type BookingClient = Pick<SupabaseClient<Database>, 'rpc' | 'from'>;

/**
 * A `get_busy_times` row. `barber_id` is null for a salon-wide closure.
 * (The generated types say `string`, since Postgres can't declare nullability
 * for function results, so we spell it out here.)
 */
export type BusyTimeRow = { barber_id: string | null; starts_at: string; ends_at: string };

export type WorkingHoursRow = Pick<
  Database['public']['Tables']['working_hours']['Row'],
  'barber_id' | 'weekday' | 'start_time' | 'end_time'
>;

export function toBusyIntervals(rows: readonly BusyTimeRow[]): BusyInterval[] {
  return rows.map((row) => ({
    barberId: row.barber_id ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
}

export function toWorkingHours(rows: readonly WorkingHoursRow[]): WorkingHours[] {
  return rows.map((row) => ({
    barberId: row.barber_id,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

/**
 * Busy intervals within the booking window. `from`/`to` are salon-local dates
 * ("YYYY-MM-DD"); the server clips them to the window. Omit both for the whole window.
 */
export async function fetchBusyTimes(
  client: BookingClient,
  range: { from?: string; to?: string } = {},
): Promise<BusyInterval[]> {
  const args: { p_from?: string; p_to?: string } = {};
  if (range.from) args.p_from = range.from;
  if (range.to) args.p_to = range.to;

  const { data, error } = await client.rpc('get_busy_times', args);
  if (error) throw new Error(`Could not load busy times: ${error.message}`);
  return toBusyIntervals((data ?? []) as BusyTimeRow[]);
}

/** Working hours of all active barbers (RLS hides inactive ones). */
export async function fetchWorkingHours(client: BookingClient): Promise<WorkingHours[]> {
  const { data, error } = await client
    .from('working_hours')
    .select('barber_id, weekday, start_time, end_time');
  if (error) throw new Error(`Could not load working hours: ${error.message}`);
  return toWorkingHours(data ?? []);
}

/**
 * Available start times from data loaded with fetchBusyTimes/fetchWorkingHours.
 * Pass one barber, or the list of active barbers for "Any available barber".
 */
export function getSlotsFromBusyTimes(params: {
  date: string;
  barber: Barber | readonly Barber[];
  workingHours: readonly WorkingHours[];
  busy: readonly BusyInterval[];
  totalDurationMinutes: number;
  salonTimezone: string;
  options: AvailabilityOptions;
}): Date[] {
  const { date, barber, workingHours, busy, totalDurationMinutes, salonTimezone, options } = params;
  // Busy intervals already exclude cancelled appointments and carry no status,
  // so they go in the "blocked periods" argument; no separate appointments.
  return isBarberList(barber)
    ? getAvailableSlotsAnyBarber(
        date,
        barber,
        workingHours,
        busy,
        [],
        totalDurationMinutes,
        salonTimezone,
        options,
      )
    : getAvailableSlots(
        date,
        barber,
        workingHours,
        busy,
        [],
        totalDurationMinutes,
        salonTimezone,
        options,
      );
}

function isBarberList(barber: Barber | readonly Barber[]): barber is readonly Barber[] {
  return Array.isArray(barber);
}
