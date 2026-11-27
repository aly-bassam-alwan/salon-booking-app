/**
 * Friendly messages for the stable error codes raised by the booking
 * functions in Postgres (book_appointment, cancel_appointment). See SPEC.md §5.
 * Numbers in messages come from salon_settings, never from constants here.
 */

export const BOOKING_ERROR_CODES = [
  'SLOT_UNAVAILABLE',
  'OUTSIDE_WORKING_HOURS',
  'TOO_SOON',
  'OUT_OF_WINDOW',
  'PAST_CUTOFF',
  'INVALID_SERVICES',
  'INVALID_BARBER',
  'INVALID_TIME',
  'ALREADY_BOOKED',
  'NOT_FOUND',
  'NOT_CANCELLABLE',
  'NOT_ALLOWED',
] as const;

export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];

/** The salon_settings values used in messages. */
export type MessageSettings = { minLeadMinutes: number; bookingWindowDays: number };

const MESSAGES: Record<BookingErrorCode, (s: MessageSettings) => string> = {
  SLOT_UNAVAILABLE: () => 'Sorry, that time was just taken.',
  OUTSIDE_WORKING_HOURS: () => 'That time is outside opening hours.',
  TOO_SOON: (s) => `Please book at least ${s.minLeadMinutes} minutes ahead.`,
  OUT_OF_WINDOW: (s) => `You can book up to ${s.bookingWindowDays} days ahead.`,
  PAST_CUTOFF: () => 'Please call the salon to cancel.',
  INVALID_SERVICES: () => 'One of the selected services is no longer available.',
  INVALID_BARBER: () => 'That barber is not available for booking.',
  INVALID_TIME: () => 'Please pick one of the offered times.',
  ALREADY_BOOKED: () => 'You already have an appointment at that time.',
  NOT_FOUND: () => 'That appointment could not be found.',
  NOT_CANCELLABLE: () => 'This appointment can no longer be cancelled.',
  NOT_ALLOWED: () => "You don't have permission to do that.",
};

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** The booking error code in a Supabase/PostgREST error, or null. */
export function bookingErrorCode(error: unknown): BookingErrorCode | null {
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const message = (error as { message: unknown }).message;
  return BOOKING_ERROR_CODES.find((code) => code === message) ?? null;
}

/** A message to show the user for an error from a booking function. */
export function bookingErrorMessage(error: unknown, settings: MessageSettings): string {
  const code = bookingErrorCode(error);
  return code ? MESSAGES[code](settings) : GENERIC_MESSAGE;
}
