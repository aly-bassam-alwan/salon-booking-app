import { TZDate } from '@date-fns/tz';

import {
  getAvailableSlots,
  getAvailableSlotsAnyBarber,
  type Barber,
  type ExistingAppointment,
  type TimeOff,
  type WorkingHours,
} from '../availability';

// ---------------------------------------------------------------- helpers
const TZ = 'Asia/Beirut';
const MONDAY = '2030-01-07'; // a Monday (weekday 1)
const SUNDAY = '2030-01-06';

/** Salon-local wall-clock time on `date` -> real instant. */
function at(date: string, hhmm: string, tz = TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(new TZDate(y, m - 1, d, h, min, tz).getTime());
}

/** Format slots as salon-local "HH:mm" labels for readable assertions. */
function labels(slots: Date[], tz = TZ): string[] {
  return slots.map((slot) => {
    const local = new TZDate(slot.getTime(), tz);
    const hh = String(local.getHours()).padStart(2, '0');
    const mm = String(local.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  });
}

const barberA: Barber = { id: 'barber-a', isActive: true };
const barberB: Barber = { id: 'barber-b', isActive: true };

function hours(barberId: string, start: string, end: string, weekday = 1): WorkingHours {
  return { barberId, weekday, startTime: start, endTime: end };
}

function booking(
  barberId: string,
  start: string,
  end: string,
  status: ExistingAppointment['status'] = 'booked',
  date = MONDAY,
): ExistingAppointment {
  return { barberId, startsAt: at(date, start), endsAt: at(date, end), status };
}

function off(barberId: string | null, start: string, end: string, date = MONDAY): TimeOff {
  return { barberId, startsAt: at(date, start), endsAt: at(date, end) };
}

// Well before the test day, so "past" filtering doesn't interfere.
const EARLY = { now: at('2030-01-01', '08:00'), minLeadMinutes: 0 };

/** Shorthand for a single-barber call with barber A, 09:00-12:00. */
function slotsFor(
  duration: number,
  {
    appointments = [] as ExistingAppointment[],
    timeOff = [] as TimeOff[],
    workingHours = [hours('barber-a', '09:00', '12:00')],
    options = EARLY,
    date = MONDAY,
    barber = barberA,
  } = {},
): string[] {
  return labels(
    getAvailableSlots(date, barber, workingHours, timeOff, appointments, duration, TZ, options),
  );
}

// ------------------------------------------------------------------ tests
describe('getAvailableSlots', () => {
  describe('worked example: works 9:00-12:00, booked 10:00-10:30', () => {
    const appointments = [booking('barber-a', '10:00', '10:30')];

    it('30-min slots are 9:00, 9:30, 10:30, 11:00, 11:30', () => {
      expect(slotsFor(30, { appointments })).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
    });

    it('60-min slots are 9:00, 10:30, 11:00', () => {
      expect(slotsFor(60, { appointments })).toEqual(['09:00', '10:30', '11:00']);
    });
  });

  it('offers a 30-min service in every free half hour', () => {
    expect(slotsFor(30)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('needs two consecutive free blocks for a 60-min service (hair + beard)', () => {
    // Free 30-min blocks: 09:00, 10:00, 10:30, 11:30. Only 10:00-11:00 is two in a row.
    const appointments = [
      booking('barber-a', '09:30', '10:00'),
      booking('barber-a', '11:00', '11:30'),
    ];
    expect(slotsFor(30, { appointments })).toEqual(['09:00', '10:00', '10:30', '11:30']);
    expect(slotsFor(60, { appointments })).toEqual(['10:00']);
  });

  it('excludes slots that would end after closing time', () => {
    expect(slotsFor(60)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
    expect(slotsFor(90)).toEqual(['09:00', '09:30', '10:00', '10:30']);
    expect(slotsFor(240)).toEqual([]); // longer than the whole shift
  });

  it('allows a slot that ends exactly at closing time', () => {
    expect(slotsFor(60)).toContain('11:00'); // 11:00-12:00
  });

  describe('existing bookings', () => {
    it('excludes slots overlapping a booking, including partial overlaps', () => {
      const appointments = [booking('barber-a', '10:00', '11:00')];
      expect(slotsFor(30, { appointments })).toEqual(['09:00', '09:30', '11:00', '11:30']);
      // 09:30-10:30 would run into the booking
      expect(slotsFor(60, { appointments })).toEqual(['09:00', '11:00']);
    });

    it("ignores other barbers' bookings", () => {
      const appointments = [booking('barber-b', '10:00', '11:00')];
      expect(slotsFor(30, { appointments })).toHaveLength(6);
    });

    it("cancelled appointments don't block slots", () => {
      const appointments = [booking('barber-a', '10:00', '10:30', 'cancelled')];
      expect(slotsFor(30, { appointments })).toEqual([
        '09:00',
        '09:30',
        '10:00',
        '10:30',
        '11:00',
        '11:30',
      ]);
    });

    it.each(['completed', 'no_show'] as const)(
      'only "booked" blocks a slot, like the DB constraint (%s does not)',
      (status) => {
        const appointments = [booking('barber-a', '10:00', '10:30', status)];
        expect(slotsFor(30, { appointments })).toHaveLength(6);
      },
    );
  });

  describe('time off', () => {
    it("excludes slots overlapping the barber's time off", () => {
      const timeOff = [off('barber-a', '10:00', '11:00')];
      expect(slotsFor(30, { timeOff })).toEqual(['09:00', '09:30', '11:00', '11:30']);
      expect(slotsFor(60, { timeOff })).toEqual(['09:00', '11:00']);
    });

    it('excludes slots during a salon-wide closure (barberId null)', () => {
      const timeOff = [off(null, '09:00', '11:00')];
      expect(slotsFor(30, { timeOff })).toEqual(['11:00', '11:30']);
    });

    it("ignores another barber's time off", () => {
      const timeOff = [off('barber-b', '09:00', '12:00')];
      expect(slotsFor(30, { timeOff })).toHaveLength(6);
    });
  });

  describe('past times and lead time', () => {
    it('excludes past times today', () => {
      const options = { now: at(MONDAY, '10:10'), minLeadMinutes: 0 };
      expect(slotsFor(30, { options })).toEqual(['10:30', '11:00', '11:30']);
    });

    it('includes a slot starting exactly at now + lead time (same rule as the DB)', () => {
      const options = { now: at(MONDAY, '10:30'), minLeadMinutes: 0 };
      expect(slotsFor(30, { options })).toEqual(['10:30', '11:00', '11:30']);
    });

    it('applies the minimum lead time from salon settings', () => {
      const options = { now: at(MONDAY, '10:10'), minLeadMinutes: 60 };
      expect(slotsFor(30, { options })).toEqual(['11:30']);
    });

    it('returns nothing for a day that is already over', () => {
      const options = { now: at('2030-01-08', '08:00'), minLeadMinutes: 0 };
      expect(slotsFor(30, { options })).toEqual([]);
    });
  });

  describe('working hours and barber', () => {
    it('returns nothing on a day without working hours', () => {
      expect(slotsFor(30, { date: SUNDAY })).toEqual([]);
    });

    it("uses the barber's hours for that weekday only", () => {
      const workingHours = [
        hours('barber-a', '09:00', '10:00', 1),
        hours('barber-a', '14:00', '15:00', 0),
      ];
      expect(slotsFor(30, { workingHours })).toEqual(['09:00', '09:30']);
      expect(slotsFor(30, { workingHours, date: SUNDAY })).toEqual(['14:00', '14:30']);
    });

    it("ignores another barber's working hours", () => {
      expect(slotsFor(30, { workingHours: [hours('barber-b', '09:00', '12:00')] })).toEqual([]);
    });

    it('returns nothing for an inactive barber', () => {
      expect(slotsFor(30, { barber: { id: 'barber-a', isActive: false } })).toEqual([]);
    });
  });

  describe('timezones and input formats', () => {
    it('returns real UTC instants for salon-local times (not device time)', () => {
      const slots = getAvailableSlots(
        MONDAY,
        barberA,
        [hours('barber-a', '09:00', '10:00')],
        [],
        [],
        30,
        TZ,
        EARLY,
      );
      // Beirut is UTC+2 in January
      expect(slots.map((s) => s.toISOString())).toEqual([
        '2030-01-07T07:00:00.000Z',
        '2030-01-07T07:30:00.000Z',
      ]);
    });

    it('the same wall-clock hours give different instants in another salon timezone', () => {
      const slots = getAvailableSlots(
        MONDAY,
        barberA,
        [hours('barber-a', '09:00', '10:00')],
        [],
        [],
        30,
        'Asia/Qatar', // UTC+3, no DST
        EARLY,
      );
      expect(slots.map((s) => s.toISOString())).toEqual([
        '2030-01-07T06:00:00.000Z',
        '2030-01-07T06:30:00.000Z',
      ]);
    });

    it('accepts Postgres-style values from Supabase (HH:mm:ss times, ISO timestamp strings)', () => {
      const slots = getAvailableSlots(
        MONDAY,
        barberA,
        [{ barberId: 'barber-a', weekday: 1, startTime: '09:00:00', endTime: '12:00:00' }],
        [],
        [
          {
            barberId: 'barber-a',
            startsAt: '2030-01-07T08:00:00+00:00', // 10:00 Beirut
            endsAt: '2030-01-07T08:30:00+00:00',
            status: 'booked',
          },
        ],
        30,
        TZ,
        EARLY,
      );
      expect(labels(slots)).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
    });
  });

  describe('invalid input', () => {
    it.each([0, -30, 45, 12.5, Number.NaN])('rejects duration %p', (duration) => {
      expect(() => slotsFor(duration)).toThrow(RangeError);
    });

    it('rejects an invalid timezone', () => {
      expect(() =>
        getAvailableSlots(MONDAY, barberA, [], [], [], 30, 'Mars/Olympus_Mons', EARLY),
      ).toThrow(RangeError);
    });

    it.each(['2030-02-30', '07/01/2030', ''])('rejects invalid date %p', (date) => {
      expect(() => slotsFor(30, { date })).toThrow(RangeError);
    });
  });
});

describe('getAvailableSlotsAnyBarber', () => {
  // A: 09:00-12:00 with a booking 10:00-11:00. B: 09:00-10:30, free.
  const workingHours = [hours('barber-a', '09:00', '12:00'), hours('barber-b', '09:00', '10:30')];
  const appointments = [booking('barber-a', '10:00', '11:00')];

  function anySlots(duration: number, barbers: Barber[] = [barberA, barberB]): string[] {
    return labels(
      getAvailableSlotsAnyBarber(
        MONDAY,
        barbers,
        workingHours,
        [],
        appointments,
        duration,
        TZ,
        EARLY,
      ),
    );
  }

  it('merges slots across barbers, sorted and without duplicates', () => {
    // A: 09:00 09:30 11:00 11:30   B: 09:00 09:30 10:00
    expect(anySlots(30)).toEqual(['09:00', '09:30', '10:00', '11:00', '11:30']);
  });

  it('merges 60-min slots where at least one barber has the full duration free', () => {
    // A: 09:00 11:00   B: 09:00 09:30
    expect(anySlots(60)).toEqual(['09:00', '09:30', '11:00']);
  });

  it('skips inactive barbers', () => {
    expect(anySlots(30, [barberA, { id: 'barber-b', isActive: false }])).toEqual([
      '09:00',
      '09:30',
      '11:00',
      '11:30',
    ]);
  });

  it('returns nothing when there are no barbers', () => {
    expect(anySlots(30, [])).toEqual([]);
  });
});
