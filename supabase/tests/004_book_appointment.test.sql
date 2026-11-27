-- book_appointment: computes the end time, enforces every booking rule, and
-- follows salon_settings (nothing hard-coded). Dates are computed relative to
-- now() in the salon timezone so the tests never go stale.
begin;
select plan(33);

-- ----------------------------------------------------------------- helpers
-- Salon-local date + wall-clock time -> real instant.
create function public.test_ts(d date, t time) returns timestamptz
language sql stable as $$
  select (d + t) at time zone (select timezone from public.salon_settings)
$$;

-- A Monday between 2 and 8 days from today (salon local): always inside the
-- 14-day window and far enough ahead for any lead time.
create function public.test_monday() returns date
language sql stable as $$
  select d::date
  from generate_series(
    (now() at time zone (select timezone from public.salon_settings))::date + 2,
    (now() at time zone (select timezone from public.salon_settings))::date + 8,
    interval '1 day') as d
  where extract(dow from d) = 1
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('c4000000-0000-4000-8000-000000000001', 'cust1@test.local'),
  ('c4000000-0000-4000-8000-000000000002', 'cust2@test.local');

insert into public.barbers (id, display_name, is_active) values
  ('b4000000-0000-4000-8000-000000000001', 'Mon-Sat barber', true),
  ('b4000000-0000-4000-8000-000000000002', 'Inactive barber', false),
  ('b4000000-0000-4000-8000-000000000003', 'Always-on barber', true);

-- Mon-Sat 09:00-19:00 for barber 1; every day 00:00-23:30 for barber 3.
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select 'b4000000-0000-4000-8000-000000000001'::uuid, d, time '09:00', time '19:00' from generate_series(1, 6) d
union all
select 'b4000000-0000-4000-8000-000000000003'::uuid, d, time '00:00', time '23:30' from generate_series(0, 6) d;

insert into public.services (id, name, duration_minutes, price_minor, is_active) values
  ('5e400000-0000-4000-8000-000000000001', 'Haircut',       30, 1500, true),
  ('5e400000-0000-4000-8000-000000000002', 'Beard',         30, 1000, true),
  ('5e400000-0000-4000-8000-000000000003', 'Hair coloring', 60, 3500, true),
  ('5e400000-0000-4000-8000-000000000004', 'Retired',       30,  500, false);

-- Break for barber 1 on Monday 13:00-14:00; salon closed all of Tuesday.
insert into public.time_off (barber_id, starts_at, ends_at, reason) values
  ('b4000000-0000-4000-8000-000000000001',
   public.test_ts(public.test_monday(), '13:00'), public.test_ts(public.test_monday(), '14:00'), 'Lunch'),
  (null,
   public.test_ts(public.test_monday() + 1, '00:00'), public.test_ts(public.test_monday() + 2, '00:00'), 'Holiday');

-- ======================================================== as customer 1
select set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 1-5: happy path, Haircut + Beard = 60 min, $25.00
select lives_ok(
  $$select public.book_appointment(
      'b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001', '5e400000-0000-4000-8000-000000000002']::uuid[],
      public.test_ts(public.test_monday(), '10:00'),
      '  first visit  ')$$,
  'books Haircut + Beard at 10:00');

select is(
  (select ends_at from public.appointments where customer_id = 'c4000000-0000-4000-8000-000000000001'),
  public.test_ts(public.test_monday(), '11:00'),
  'end time = start + sum of service durations (10:00 + 60 min = 11:00)');

select is(
  (select total_price_minor || ' ' || currency || ' ' || total_duration_minutes || ' ' || customer_note
   from public.appointments where customer_id = 'c4000000-0000-4000-8000-000000000001'),
  '2500 USD 60 first visit',
  'price, currency (from salon_settings), duration and trimmed note are stored');

select results_eq(
  $$select service_name, position::int, price_minor from public.appointment_services order by position$$,
  $$values ('Haircut', 1, 1500), ('Beard', 2, 1000)$$,
  'service snapshots are stored in the chosen order');

select is(
  (select status::text from public.appointments where customer_id = 'c4000000-0000-4000-8000-000000000001'),
  'booked', 'new appointment is booked');

-- 6: the same customer can't be in two places at once
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000003',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '10:30'))$$,
  'P0001', 'ALREADY_BOOKED', 'customer cannot book an overlapping slot with another barber');

reset role;

-- ======================================================== as customer 2
select set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

-- 7-9: double booking
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '10:00'))$$,
  'P0001', 'SLOT_UNAVAILABLE', 'the same start time is already taken');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '10:30'))$$,
  'P0001', 'SLOT_UNAVAILABLE', 'a start inside an existing booking is taken');
select lives_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '11:00'))$$,
  'back-to-back booking right after the existing one is allowed');

-- 10-13: working hours
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001', '5e400000-0000-4000-8000-000000000002']::uuid[],
      public.test_ts(public.test_monday(), '18:30'))$$,
  'P0001', 'OUTSIDE_WORKING_HOURS', '60 min at 18:30 does not fit before 19:00');
select lives_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '18:30'))$$,
  '30 min at 18:30 fits exactly until 19:00');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '08:30'))$$,
  'P0001', 'OUTSIDE_WORKING_HOURS', 'before opening is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday() - 1, '10:00'))$$,
  'P0001', 'OUTSIDE_WORKING_HOURS', 'Sunday (no working hours) is rejected');

-- 14-17: time off
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '13:30'))$$,
  'P0001', 'SLOT_UNAVAILABLE', 'a slot during the barber''s break is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000003']::uuid[], public.test_ts(public.test_monday(), '12:30'))$$,
  'P0001', 'SLOT_UNAVAILABLE', '60 min at 12:30 runs into the 13:00 break');
select lives_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '12:30'))$$,
  '30 min at 12:30 ends exactly when the break starts');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday() + 1, '10:00'))$$,
  'P0001', 'SLOT_UNAVAILABLE', 'a salon-wide closure blocks every barber');

-- 18-19: lead time / past
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000003',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], date_trunc('hour', now()) + interval '30 minutes')$$,
  'P0001', 'TOO_SOON', 'a slot less than 60 minutes ahead is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000003',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], date_trunc('hour', now()) - interval '1 day')$$,
  'P0001', 'TOO_SOON', 'a slot in the past is rejected');

-- 20: booking window
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday() + 14, '10:00'))$$,
  'P0001', 'OUT_OF_WINDOW', 'a date beyond the 14-day window is rejected');

-- 21: 30-minute grid
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '10:15'))$$,
  'P0001', 'INVALID_TIME', 'a start off the 30-minute grid (10:15) is rejected');

-- 22-25: services
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000004']::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_SERVICES', 'an inactive service is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array[]::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_SERVICES', 'an empty service list is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001', '5e400000-0000-4000-8000-000000000001']::uuid[],
      public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_SERVICES', 'the same service twice is rejected');
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array[gen_random_uuid()], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_SERVICES', 'an unknown service is rejected');

-- 26-27: barber
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000002',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_BARBER', 'an inactive barber is rejected');
select throws_ok(
  $$select public.book_appointment(gen_random_uuid(),
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'INVALID_BARBER', 'an unknown barber is rejected');

reset role;

-- ================================= settings are read at call time (§3.9)
-- 28-29: booking window
update public.salon_settings set booking_window_days = 1;
set local role authenticated;
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'P0001', 'OUT_OF_WINDOW', 'booking_window_days = 1 makes next Monday unbookable');
reset role;
update public.salon_settings set booking_window_days = 14;
set local role authenticated;
select lives_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '15:00'))$$,
  'booking_window_days = 14 makes it bookable again');
reset role;

-- 30-31: lead time. The slot is 1-2 hours from now.
update public.salon_settings set min_lead_minutes = 180;
set local role authenticated;
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000003',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], date_trunc('hour', now()) + interval '2 hours')$$,
  'P0001', 'TOO_SOON', 'min_lead_minutes = 180 rejects a slot under 2 hours ahead');
reset role;
update public.salon_settings set min_lead_minutes = 60;
set local role authenticated;
select lives_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000003',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], date_trunc('hour', now()) + interval '2 hours')$$,
  'min_lead_minutes = 60 accepts the same slot');
reset role;

-- 32: the currency snapshot follows the settings too
update public.salon_settings set currency = 'QAR';
set local role authenticated;
select is(
  (public.book_appointment('b4000000-0000-4000-8000-000000000001',
     array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '16:00'))).currency::text,
  'QAR', 'the booking stores the currency from salon_settings');
reset role;

-- 33: signed-out users cannot call it at all
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.book_appointment('b4000000-0000-4000-8000-000000000001',
      array['5e400000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '17:00'))$$,
  '42501', null, 'anon cannot execute book_appointment');
reset role;

select * from finish();
rollback;
