-- book_appointment with p_barber_id = null ("any available barber"):
-- free for the whole duration, fewest booked MINUTES that salon-local day
-- (cancelled and other days don't count), ties by sort_order then id.
-- Fixtures are arranged so that any other rule would pick a different barber.
begin;
select plan(12);

-- ----------------------------------------------------------------- helpers
create function public.test_ts(d date, t time) returns timestamptz
language sql stable as $$
  select (d + t) at time zone (select timezone from public.salon_settings)
$$;

create function public.test_monday() returns date
language sql stable as $$
  select d::date
  from generate_series(
    (now() at time zone (select timezone from public.salon_settings))::date + 2,
    (now() at time zone (select timezone from public.salon_settings))::date + 8,
    interval '1 day') as d
  where extract(dow from d) = 1
$$;

-- Make exactly these barbers the active ones (seed barbers would compete otherwise).
create function public.test_only_active(ids uuid[]) returns void
language sql as $$
  update public.barbers set is_active = (id = any (ids));
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('c7000000-0000-4000-8000-000000000001', 'customer@test.local'),
  ('c7000000-0000-4000-8000-0000000000f1', 'filler1@test.local'),
  ('c7000000-0000-4000-8000-0000000000f2', 'filler2@test.local'),
  ('c7000000-0000-4000-8000-0000000000f3', 'filler3@test.local');

insert into public.services (id, name, duration_minutes, price_minor) values
  ('5e700000-0000-4000-8000-000000000001', 'Haircut', 30, 1500),
  ('5e700000-0000-4000-8000-000000000002', 'Beard',   30, 1000);

-- Scenario A: free for the whole duration
--   a1 sort 1, 30 min booked (10:30-11:00): fewest minutes but NOT free 10:00-11:00
--   a2 sort 2, 120 min booked (15:00-17:00): free -> expected winner
--   a3 sort 0, works only 13:00-19:00             -> excluded
--   a4 sort 0, time off 10:00-11:00               -> excluded
--   a5 sort 0, inactive                            -> excluded
-- Scenario B: minutes, not count (2 x 60 vs 3 x 30)
--   m1 sort 1, lower id, 2 x 60 = 120 min
--   m2 sort 2, 3 x 30 = 90 min (+ a cancelled 120 min, + 180 min on Tuesday) -> expected winner
-- Scenario C: ties, all 0 min. Inserted as t1, t2, t3.
--   t1 sort 2, lowest id  | t2 sort 1, id ...c2 | t3 sort 1, id ...c1 -> expected winner
insert into public.barbers (id, display_name, sort_order, is_active) values
  ('b7000000-0000-4000-8000-0000000000a1', 'a1', 1, true),
  ('b7000000-0000-4000-8000-0000000000a2', 'a2', 2, true),
  ('b7000000-0000-4000-8000-0000000000a3', 'a3', 0, true),
  ('b7000000-0000-4000-8000-0000000000a4', 'a4', 0, true),
  ('b7000000-0000-4000-8000-0000000000a5', 'a5', 0, false),
  ('b7000000-0000-4000-8000-0000000000b1', 'm1', 1, true),
  ('b7000000-0000-4000-8000-0000000000b2', 'm2', 2, true),
  ('b7000000-0000-4000-8000-0000000000c0', 't1', 2, true),
  ('b7000000-0000-4000-8000-0000000000c2', 't2', 1, true),
  ('b7000000-0000-4000-8000-0000000000c1', 't3', 1, true);

-- Mon-Sat 09:00-19:00 for everyone except a3 (13:00-19:00)
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, d, case when b.display_name = 'a3' then time '13:00' else time '09:00' end, time '19:00'
from public.barbers b
cross join generate_series(1, 6) d
where b.id::text like 'b7000000%';

insert into public.time_off (barber_id, starts_at, ends_at, reason) values
  ('b7000000-0000-4000-8000-0000000000a4',
   public.test_ts(public.test_monday(), '10:00'), public.test_ts(public.test_monday(), '11:00'), 'Break');

insert into public.appointments
  (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency, status, cancelled_at)
select customer_id::uuid, barber_id::uuid,
       public.test_ts(public.test_monday() + day_offset, s), public.test_ts(public.test_monday() + day_offset, e),
       mins, 1500, 'USD', status::public.appointment_status, case when status = 'cancelled' then now() end
from (values
  -- scenario A
  ('c7000000-0000-4000-8000-0000000000f3', 'b7000000-0000-4000-8000-0000000000a1', 0, time '10:30', time '11:00',  30, 'booked'),
  ('c7000000-0000-4000-8000-0000000000f3', 'b7000000-0000-4000-8000-0000000000a2', 0, time '15:00', time '17:00', 120, 'booked'),
  -- scenario B: m1 2 x 60
  ('c7000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-0000000000b1', 0, time '09:00', time '10:00',  60, 'booked'),
  ('c7000000-0000-4000-8000-0000000000f1', 'b7000000-0000-4000-8000-0000000000b1', 0, time '10:00', time '11:00',  60, 'booked'),
  -- scenario B: m2 3 x 30, plus a cancelled 120 min and 180 min on Tuesday (neither counts)
  ('c7000000-0000-4000-8000-0000000000f2', 'b7000000-0000-4000-8000-0000000000b2', 0, time '09:00', time '09:30',  30, 'booked'),
  ('c7000000-0000-4000-8000-0000000000f2', 'b7000000-0000-4000-8000-0000000000b2', 0, time '09:30', time '10:00',  30, 'booked'),
  ('c7000000-0000-4000-8000-0000000000f2', 'b7000000-0000-4000-8000-0000000000b2', 0, time '10:00', time '10:30',  30, 'booked'),
  ('c7000000-0000-4000-8000-0000000000f2', 'b7000000-0000-4000-8000-0000000000b2', 0, time '16:00', time '18:00', 120, 'cancelled'),
  ('c7000000-0000-4000-8000-0000000000f2', 'b7000000-0000-4000-8000-0000000000b2', 1, time '09:00', time '12:00', 180, 'booked')
) as v (customer_id, barber_id, day_offset, s, e, mins, status);

-- Everything below runs as the customer; settings changes happen as owner.
select set_config('request.jwt.claims',
  '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- ================================== A: free for the whole duration
select public.test_only_active(array[
  'b7000000-0000-4000-8000-0000000000a1', 'b7000000-0000-4000-8000-0000000000a3',
  'b7000000-0000-4000-8000-0000000000a4']::uuid[]);
set local role authenticated;
select throws_ok(
  $$select public.book_appointment(null,
      array['5e700000-0000-4000-8000-000000000001', '5e700000-0000-4000-8000-000000000002']::uuid[],
      public.test_ts(public.test_monday(), '10:00'))$$,
  'P0001', 'SLOT_UNAVAILABLE',
  'nobody free for 10:00-11:00: a1 busy from 10:30, a3 starts at 13:00, a4 on time off (a5 inactive)');
reset role;

select public.test_only_active(array[
  'b7000000-0000-4000-8000-0000000000a1', 'b7000000-0000-4000-8000-0000000000a2',
  'b7000000-0000-4000-8000-0000000000a3', 'b7000000-0000-4000-8000-0000000000a4']::uuid[]);
set local role authenticated;
select is(
  (public.book_appointment(null,
     array['5e700000-0000-4000-8000-000000000001', '5e700000-0000-4000-8000-000000000002']::uuid[],
     public.test_ts(public.test_monday(), '10:00'))).barber_id,
  'b7000000-0000-4000-8000-0000000000a2'::uuid,
  'picks a2, the only barber free for the WHOLE 60 min, though a1 has fewer minutes');
select is(
  (select ends_at from public.appointments
   where customer_id = 'c7000000-0000-4000-8000-000000000001'
     and starts_at = public.test_ts(public.test_monday(), '10:00')),
  public.test_ts(public.test_monday(), '11:00'),
  'the auto-assigned booking still gets the end time from the service durations');
reset role;

-- ======================================== B: fewest MINUTES, not count
select public.test_only_active(array[
  'b7000000-0000-4000-8000-0000000000b1', 'b7000000-0000-4000-8000-0000000000b2']::uuid[]);
set local role authenticated;
select is(
  (public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
     public.test_ts(public.test_monday(), '14:00'))).barber_id,
  'b7000000-0000-4000-8000-0000000000b2'::uuid,
  'm2 (3 x 30 = 90 min) beats m1 (2 x 60 = 120 min): minutes decide, not count; cancelled and other days ignored');
reset role;

-- ============================================ C: ties -> sort_order -> id
select public.test_only_active(array[
  'b7000000-0000-4000-8000-0000000000c0', 'b7000000-0000-4000-8000-0000000000c1',
  'b7000000-0000-4000-8000-0000000000c2']::uuid[]);
set local role authenticated;
select is(
  (public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
     public.test_ts(public.test_monday(), '12:00'))).barber_id,
  'b7000000-0000-4000-8000-0000000000c1'::uuid,
  'tie at 0 min: lowest sort_order (t2, t3), then lowest id -> t3');
select is(
  (public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
     public.test_ts(public.test_monday(), '12:30'))).barber_id,
  'b7000000-0000-4000-8000-0000000000c2'::uuid,
  'the next booking goes to t2, now the least-booked barber with the lowest sort_order');

-- ========================================== D: nobody free
select throws_ok(
  $$select public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
      public.test_ts(public.test_monday(), '08:30'))$$,
  'P0001', 'SLOT_UNAVAILABLE', 'nobody works at 08:30 -> SLOT_UNAVAILABLE');

-- ==================================== common rules still apply with null
select throws_ok(
  $$select public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
      date_trunc('hour', now()) + interval '30 minutes')$$,
  'P0001', 'TOO_SOON', 'lead time applies to any-barber bookings');
select throws_ok(
  $$select public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
      public.test_ts(public.test_monday(), '10:15'))$$,
  'P0001', 'INVALID_TIME', 'the 30-minute grid applies to any-barber bookings');
select throws_ok(
  $$select public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
      public.test_ts(public.test_monday() + 14, '10:00'))$$,
  'P0001', 'OUT_OF_WINDOW', 'the booking window applies to any-barber bookings');
select throws_ok(
  $$select public.book_appointment(null, array[]::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_SERVICES', 'service validation applies to any-barber bookings');
select throws_ok(
  $$select public.book_appointment(null, array['5e700000-0000-4000-8000-000000000001']::uuid[],
      public.test_ts(public.test_monday(), '10:30'))$$,
  'P0001', 'ALREADY_BOOKED', 'a customer already booked 10:00-11:00 cannot also take 10:30 with another barber');
reset role;

select * from finish();
rollback;
