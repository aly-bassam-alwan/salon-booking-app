import { TZDate } from '@date-fns/tz';

import type { Barber } from '../availability';
import {
  fetchBusyTimes,
  fetchWorkingHours,
  getSlotsFromBusyTimes,
  toBusyIntervals,
  toWorkingHours,
  type BookingClient,
  type BusyTimeRow,
  type WorkingHoursRow,
} from '../busy-times';

const TZ = 'Asia/Beirut';
const MONDAY = '2030-01-07';
const EARLY = { now: new Date('2030-01-01T00:00:00Z'), minLeadMinutes: 0 };

function labels(slots: Date[]): string[] {
  return slots.map((slot) => {
    const local = new TZDate(slot.getTime(), TZ);
    return `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  });
}

// Rows exactly as Supabase returns them (Postgres time + ISO timestamptz strings).
const hoursRows: WorkingHoursRow[] = [
  { barber_id: 'barber-a', weekday: 1, start_time: '09:00:00', end_time: '12:00:00' },
  { barber_id: 'barber-b', weekday: 1, start_time: '09:00:00', end_time: '10:30:00' },
];
// 10:00-10:30 Beirut (UTC+2 in January) for barber A
const busyRows: BusyTimeRow[] = [
  {
    barber_id: 'barber-a',
    starts_at: '2030-01-07T08:00:00+00:00',
    ends_at: '2030-01-07T08:30:00+00:00',
  },
];

const barberA: Barber = { id: 'barber-a' };
const barberB: Barber = { id: 'barber-b' };

/** Minimal stand-in for the Supabase client: only rpc() and from().select(). */
function fakeClient(
  rpcResult: { data: unknown; error: { message: string } | null },
  selectResult: { data: unknown; error: { message: string } | null } = { data: [], error: null },
) {
  const select = jest.fn().mockResolvedValue(selectResult);
  const from = jest.fn(() => ({ select }));
  const rpc = jest.fn().mockResolvedValue(rpcResult);
  return { client: { rpc, from } as unknown as BookingClient, rpc, from, select };
}

describe('toBusyIntervals / toWorkingHours', () => {
  it('maps get_busy_times rows, keeping a null barber as a salon-wide block', () => {
    expect(
      toBusyIntervals([
        ...busyRows,
        {
          barber_id: null,
          starts_at: '2030-01-08T22:00:00+00:00',
          ends_at: '2030-01-09T22:00:00+00:00',
        },
      ]),
    ).toEqual([
      {
        barberId: 'barber-a',
        startsAt: '2030-01-07T08:00:00+00:00',
        endsAt: '2030-01-07T08:30:00+00:00',
      },
      {
        barberId: null,
        startsAt: '2030-01-08T22:00:00+00:00',
        endsAt: '2030-01-09T22:00:00+00:00',
      },
    ]);
  });

  it('maps working_hours rows', () => {
    expect(toWorkingHours(hoursRows.slice(0, 1))).toEqual([
      { barberId: 'barber-a', weekday: 1, startTime: '09:00:00', endTime: '12:00:00' },
    ]);
  });
});

describe('getSlotsFromBusyTimes', () => {
  const workingHours = toWorkingHours(hoursRows);
  const busy = toBusyIntervals(busyRows);

  function slots(
    duration: number,
    barber: Barber | readonly Barber[],
    extraBusy: BusyTimeRow[] = [],
  ) {
    return labels(
      getSlotsFromBusyTimes({
        date: MONDAY,
        barber,
        workingHours,
        busy: [...busy, ...toBusyIntervals(extraBusy)],
        totalDurationMinutes: duration,
        salonTimezone: TZ,
        options: EARLY,
      }),
    );
  }

  it('reproduces the worked example from busy-time rows (30 min)', () => {
    expect(slots(30, barberA)).toEqual(['09:00', '09:30', '10:30', '11:00', '11:30']);
  });

  it('reproduces the worked example from busy-time rows (60 min)', () => {
    expect(slots(60, barberA)).toEqual(['09:00', '10:30', '11:00']);
  });

  it('merges barbers for "any available barber"', () => {
    // A: 09:00 09:30 10:30 11:00 11:30   B: 09:00 09:30 10:00
    expect(slots(30, [barberA, barberB])).toEqual([
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
  });

  it('a salon-wide busy row (barber_id null) blocks every barber', () => {
    const closure: BusyTimeRow = {
      barber_id: null,
      starts_at: '2030-01-07T07:00:00+00:00', // 09:00-10:00 Beirut
      ends_at: '2030-01-07T08:00:00+00:00',
    };
    expect(slots(30, [barberA, barberB], [closure])).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });
});

describe('fetchBusyTimes', () => {
  it('calls the get_busy_times RPC with the date range and maps the rows', async () => {
    const { client, rpc } = fakeClient({ data: busyRows, error: null });
    await expect(fetchBusyTimes(client, { from: '2030-01-07', to: '2030-01-20' })).resolves.toEqual(
      toBusyIntervals(busyRows),
    );
    expect(rpc).toHaveBeenCalledWith('get_busy_times', {
      p_from: '2030-01-07',
      p_to: '2030-01-20',
    });
  });

  it('asks for the whole booking window when no range is given', async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    await fetchBusyTimes(client);
    expect(rpc).toHaveBeenCalledWith('get_busy_times', {});
  });

  it('treats a null result as no busy times', async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(fetchBusyTimes(client)).resolves.toEqual([]);
  });

  it('throws when the RPC fails', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied' } });
    await expect(fetchBusyTimes(client)).rejects.toThrow(
      'Could not load busy times: permission denied',
    );
  });
});

describe('fetchWorkingHours', () => {
  it('selects only the columns it needs from working_hours', async () => {
    const { client, from, select } = fakeClient(
      { data: null, error: null },
      { data: hoursRows, error: null },
    );
    await expect(fetchWorkingHours(client)).resolves.toEqual(toWorkingHours(hoursRows));
    expect(from).toHaveBeenCalledWith('working_hours');
    expect(select).toHaveBeenCalledWith('barber_id, weekday, start_time, end_time');
  });

  it('throws when the query fails', async () => {
    const { client } = fakeClient(
      { data: null, error: null },
      { data: null, error: { message: 'boom' } },
    );
    await expect(fetchWorkingHours(client)).rejects.toThrow('Could not load working hours: boom');
  });
});
