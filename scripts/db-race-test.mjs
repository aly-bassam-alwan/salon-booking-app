// Race test for "any available barber" (SPEC.md §3.5).
//
// pgTAP runs in a single session, so it can't simulate two customers booking
// at the same moment. This script opens two REAL connections to the local
// Supabase database and checks that:
//   1. Customer B's "any barber" booking waits for customer A's transaction
//      (the barber-row locks), and then gets the OTHER free barber.
//   2. With only one barber free, B gets SLOT_UNAVAILABLE (no double booking).
//
// Uses committed fixtures with fixed ids, cleaned up before and after.
// Run with: npm run db:test:race   (local stack must be running)

import postgres from 'postgres';

// Default local Supabase database (CLI default credentials, local only).
const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const ID = {
  custA: 'f8000000-0000-4000-8000-00000000000a',
  custB: 'f8000000-0000-4000-8000-00000000000b',
  barber1: 'f8000000-0000-4000-8000-0000000000b1',
  barber2: 'f8000000-0000-4000-8000-0000000000b2',
  service: 'f8000000-0000-4000-8000-0000000000c1',
};

const sql = postgres(DB_URL, { max: 4, onnotice: () => {} });
let failures = 0;

function check(condition, message) {
  console.log(`${condition ? 'ok    ' : 'FAILED'}  ${message}`);
  if (!condition) failures += 1;
}

async function cleanup() {
  await sql`delete from public.appointments where barber_id in (${ID.barber1}, ${ID.barber2})`;
  await sql`delete from public.time_off where barber_id in (${ID.barber1}, ${ID.barber2})`;
  await sql`delete from public.barbers where id in (${ID.barber1}, ${ID.barber2})`;
  await sql`delete from public.services where id = ${ID.service}`;
  await sql`delete from auth.users where id in (${ID.custA}, ${ID.custB})`;
}

async function setup() {
  await sql`insert into auth.users (id, email) values
    (${ID.custA}, 'race.a@test.local'), (${ID.custB}, 'race.b@test.local')`;
  await sql`insert into public.barbers (id, display_name, sort_order) values
    (${ID.barber1}, 'Race barber 1', 1), (${ID.barber2}, 'Race barber 2', 2)`;
  // Sundays only, so the seed barbers (Mon-Sat) never compete.
  await sql`insert into public.working_hours (barber_id, weekday, start_time, end_time) values
    (${ID.barber1}, 0, '09:00', '19:00'), (${ID.barber2}, 0, '09:00', '19:00')`;
  await sql`insert into public.services (id, name, duration_minutes, price_minor) values
    (${ID.service}, 'Race haircut', 30, 1500)`;
}

/** A Sunday 2-8 days ahead (salon-local) at the given wall-clock time, as an instant. */
async function sundayAt(time) {
  const [{ ts }] = await sql`
    select ((d::date + ${time}::time) at time zone s.timezone) as ts
    from public.salon_settings s,
         generate_series((now() at time zone s.timezone)::date + 2,
                         (now() at time zone s.timezone)::date + 8, interval '1 day') d
    where extract(dow from d) = 0`;
  return ts;
}

/** Start a transaction as `userId` on a dedicated connection. */
async function sessionAs(userId) {
  const conn = await sql.reserve();
  await conn`begin`;
  await conn`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
  await conn`set local role authenticated`;
  const [{ pid }] = await conn`select pg_backend_pid() as pid`;
  return { conn, pid };
}

function bookAnyBarber(conn, startsAt) {
  return conn`select barber_id from public.book_appointment(null, ${[ID.service]}::uuid[], ${startsAt})`.then(
    (rows) => ({ barberId: rows[0].barber_id }),
    (error) => ({ error: error.message }),
  );
}

async function isWaitingOnLock(pid) {
  const [row] = await sql`select wait_event_type from pg_stat_activity where pid = ${pid}`;
  return row?.wait_event_type === 'Lock';
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function race(label, startsAt, expect) {
  console.log(`\n${label}`);
  const a = await sessionAs(ID.custA);
  const b = await sessionAs(ID.custB);
  try {
    const resultA = await bookAnyBarber(a.conn, startsAt);
    check(resultA.barberId === ID.barber1, `A gets barber 1 (got ${JSON.stringify(resultA)})`);

    const pendingB = bookAnyBarber(b.conn, startsAt); // A's transaction is still open
    await pause(500);
    check(
      await isWaitingOnLock(b.pid),
      'B waits for A (blocked on a lock, not running in parallel)',
    );

    await a.conn`commit`;
    const resultB = await pendingB;
    expect(resultB);
    await b.conn`commit`.catch(() => b.conn`rollback`);
  } finally {
    await a.conn`rollback`.catch(() => {});
    await b.conn`rollback`.catch(() => {});
    a.conn.release();
    b.conn.release();
  }
}

try {
  await cleanup();
  await setup();

  await race('Race 1: two free barbers', await sundayAt('10:00'), (resultB) =>
    check(
      resultB.barberId === ID.barber2,
      `B then gets the OTHER free barber, barber 2 (got ${JSON.stringify(resultB)})`,
    ),
  );

  // Barber 2 is off at 14:00, so only barber 1 can take it.
  const at14 = await sundayAt('14:00');
  await sql`insert into public.time_off (barber_id, starts_at, ends_at, reason)
            values (${ID.barber2}, ${at14}, ${at14}::timestamptz + interval '1 hour', 'Race test')`;
  await race('Race 2: one free barber', at14, (resultB) =>
    check(
      resultB.error === 'SLOT_UNAVAILABLE',
      `B gets SLOT_UNAVAILABLE (got ${JSON.stringify(resultB)})`,
    ),
  );

  const [{ count }] = await sql`
    select count(*)::int as count from public.appointments a1
    join public.appointments a2 on a1.barber_id = a2.barber_id and a1.id < a2.id
     and a1.status = 'booked' and a2.status = 'booked'
     and tstzrange(a1.starts_at, a1.ends_at) && tstzrange(a2.starts_at, a2.ends_at)
    where a1.barber_id in (${ID.barber1}, ${ID.barber2})`;
  check(count === 0, 'no barber ended up double-booked');
} catch (error) {
  failures += 1;
  console.error('Race test crashed:', error);
} finally {
  await cleanup().catch((error) => console.error('Cleanup failed:', error));
  await sql.end();
}

console.log(failures === 0 ? '\nRace test: PASS' : `\nRace test: FAIL (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);
