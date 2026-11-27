import { bookingErrorCode, bookingErrorMessage } from '../errors';

const settings = { minLeadMinutes: 60, bookingWindowDays: 14 };

describe('bookingErrorCode', () => {
  it('reads the code from a Supabase/PostgREST error message', () => {
    expect(bookingErrorCode({ message: 'PAST_CUTOFF' })).toBe('PAST_CUTOFF');
    expect(bookingErrorCode(new Error('SLOT_UNAVAILABLE'))).toBe('SLOT_UNAVAILABLE');
  });

  it('returns null for anything that is not a booking error code', () => {
    expect(
      bookingErrorCode({ message: 'duplicate key value violates unique constraint' }),
    ).toBeNull();
    expect(bookingErrorCode(null)).toBeNull();
    expect(bookingErrorCode('PAST_CUTOFF')).toBeNull();
  });
});

describe('bookingErrorMessage', () => {
  it('shows "Please call the salon to cancel." after the cancellation cutoff', () => {
    expect(bookingErrorMessage({ message: 'PAST_CUTOFF' }, settings)).toBe(
      'Please call the salon to cancel.',
    );
  });

  it.each([
    ['SLOT_UNAVAILABLE', 'Sorry, that time was just taken.'],
    ['ALREADY_BOOKED', 'You already have an appointment at that time.'],
    ['NOT_FOUND', 'That appointment could not be found.'],
    ['NOT_CANCELLABLE', 'This appointment can no longer be cancelled.'],
  ])('maps %s', (code, message) => {
    expect(bookingErrorMessage({ message: code }, settings)).toBe(message);
  });

  it('fills in values from salon settings instead of hard-coded numbers', () => {
    expect(bookingErrorMessage({ message: 'TOO_SOON' }, settings)).toBe(
      'Please book at least 60 minutes ahead.',
    );
    expect(
      bookingErrorMessage(
        { message: 'OUT_OF_WINDOW' },
        { minLeadMinutes: 90, bookingWindowDays: 7 },
      ),
    ).toBe('You can book up to 7 days ahead.');
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(bookingErrorMessage(new Error('network down'), settings)).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
