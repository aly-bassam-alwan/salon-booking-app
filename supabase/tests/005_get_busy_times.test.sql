-- get_busy_times: returns only (barber_id, starts_at, ends_at), excludes
-- cancelled bookings, and returns nothing outside the booking window.
begin;
select plan(21);

-- ----------------------------------------------------------------- helpers
create function public.test_today() returns date
language sql stable as $$
  select (now() at time zone (select timezone from public.salon_settings))::date
$$;

-- Salon-local (today + offset days) at wall-clock time -> real instant.
create function public.test_ts(day_offset int, t time) returns timestamptz
language sql stable as $$
  select ((public.test_today() + day_offset) + t) at time zone (select timezone from public.salon_settings)
$$;

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('c5000000-0000-4000-8000-00000000000a', 'alice@test.local', '{"full_name":"Alice Secretname"}'),
  ('c5000000-0000-4000-8000-00000000000b', 'bob@test.local', '{"full_name":"Bob"}');

insert into public.barbers (id, display_name) values
  ('b5000000-0000-4000-8000-000000000001', 'Barber 1'),
  ('b5000000-0000-4000-8000-000000000002', 'Barber 2');

insert into public.appointments
  (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency,
   customer_note, status, cancelled_at)
values
  -- Alice, day+2 10:00-10:30, with a private note
  ('c5000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-000000000001',
   public.test_ts(2, '10:00'), public.test_ts(2, '10:30'), 30, 1500, 'USD', 'SECRET NOTE from Alice', 'booked', null),
  -- Bob, day+2 11:00-11:30, CANCELLED
  ('c5000000-0000-4000-8000-00000000000b', 'b5000000-0000-4000-8000-000000000001',
   public.test_ts(2, '11:00'), public.test_ts(2, '11:30'), 30, 1500, 'USD', null, 'cancelled', now()),
  -- Alice, day+20: beyond the 14-day window
  ('c5000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-000000000001',
   public.test_ts(20, '10:00'), public.test_ts(20, '10:30'), 30, 1500, 'USD', null, 'booked', null),
  -- Alice, day-3: in the past
  ('c5000000-0000-4000-8000-00000000000a', 'b5000000-0000-4000-8000-000000000001',
   public.test_ts(-3, '10:00'), public.test_ts(-3, '10:30'), 30, 1500, 'USD', null, 'booked', null),
  -- Bob, day+5, barber 2
  ('c5000000-0000-4000-8000-00000000000b', 'b5000000-0000-4000-8000-000000000002',
   public.test_ts(5, '10:00'), public.test_ts(5, '10:30'), 30, 1500, 'USD', null, 'booked', null);

insert into public.time_off (barber_id, starts_at, ends_at, reason) values
  ('b5000000-0000-4000-8000-000000000001', public.test_ts(2, '13:00'), public.test_ts(2, '14:00'), 'Lunch'),
  (null, public.test_ts(3, '00:00'), public.test_ts(4, '00:00'), 'Public holiday'),
  -- long vacation from day-5 to day+30: must be clipped to the window
  ('b5000000-0000-4000-8000-000000000002', public.test_ts(-5, '00:00'), public.test_ts(30, '00:00'), 'Vacation');

-- ------------------------------------------------- definition and security
select is(
  pg_get_function_result('public.get_busy_times(date, date)'::regprocedure),
  'TABLE(barber_id uuid, starts_at timestamp with time zone, ends_at timestamp with time zone)',
  'returns exactly barber_id, starts_at, ends_at: no customer or appointment details');
select ok(
  (select prosecdef from pg_proc where oid = 'public.get_busy_times(date, date)'::regprocedure),
  'is SECURITY DEFINER');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.get_busy_times(date, date)'::regprocedure),
  'has a fixed, empty search_path');
select ok(
  not has_function_privilege('anon', 'public.get_busy_times(date, date)', 'execute'),
  'anon has no EXECUTE privilege');
select ok(
  has_function_privilege('authenticated', 'public.get_busy_times(date, date)', 'execute'),
  'authenticated has EXECUTE privilege');

-- ================================================= as Bob (another customer)
select set_config('request.jwt.claims',
  '{"sub":"c5000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

-- No customer details
select results_eq(
  $$select barber_id, starts_at, ends_at from public.get_busy_times(public.test_today() + 2, public.test_today() + 2)
    where barber_id = 'b5000000-0000-4000-8000-000000000001'$$,
  $$values ('b5000000-0000-4000-8000-000000000001'::uuid, public.test_ts(2, '10:00'), public.test_ts(2, '10:30')),
           ('b5000000-0000-4000-8000-000000000001'::uuid, public.test_ts(2, '13:00'), public.test_ts(2, '14:00'))$$,
  'Alice''s booking is visible to Bob only as (barber, start, end), alongside the lunch break');
select is(
  (select count(*)::int from public.get_busy_times()), 5,
  'default range returns the 5 busy intervals inside the window');
select is(
  (select count(*)::int from public.get_busy_times() as r
   where row_to_json(r)::text ~* 'c5000000-0000-4000-8000-00000000000a|secret|alice|lunch|vacation|holiday|1500|USD'),
  0, 'no row contains a customer id, name, note, time-off reason or price');
select is(
  (select count(*)::int from public.appointments
   where customer_id = 'c5000000-0000-4000-8000-00000000000a'),
  0, 'Bob still cannot read Alice''s appointments directly');

-- Cancelled bookings are excluded
select is(
  (select count(*)::int from public.get_busy_times() where starts_at = public.test_ts(2, '11:00')),
  0, 'the cancelled 11:00 booking is not busy');

-- Dates outside the window return nothing
select is(
  (select count(*)::int from public.get_busy_times(public.test_today() + 20, public.test_today() + 20)),
  0, 'a date beyond the booking window returns nothing');
select is(
  (select count(*)::int from public.get_busy_times(public.test_today() - 3, public.test_today() - 3)),
  0, 'a past date returns nothing');
select is(
  (select count(*)::int from public.get_busy_times(public.test_today() - 10, public.test_today() - 1)),
  0, 'a range entirely before today returns nothing');
select is(
  (select count(*)::int from public.get_busy_times(public.test_today() + 14, public.test_today() + 60)),
  0, 'a range entirely after the window returns nothing');
select is(
  (select count(*)::int from public.get_busy_times()
   where starts_at in (public.test_ts(20, '10:00'), public.test_ts(-3, '10:00'))),
  0, 'the default range excludes past and beyond-window bookings');

-- Clipping
select results_eq(
  $$select barber_id, starts_at, ends_at from public.get_busy_times(public.test_today() - 10, public.test_today() + 2)
    where barber_id = 'b5000000-0000-4000-8000-000000000002'$$,
  $$values ('b5000000-0000-4000-8000-000000000002'::uuid, public.test_ts(0, '00:00'), public.test_ts(3, '00:00'))$$,
  'a half-overlapping range is clipped to today, and the vacation is clipped to the range');
select results_eq(
  $$select barber_id, starts_at, ends_at from public.get_busy_times() where barber_id = 'b5000000-0000-4000-8000-000000000002'
    and starts_at = public.test_ts(0, '00:00')$$,
  $$values ('b5000000-0000-4000-8000-000000000002'::uuid, public.test_ts(0, '00:00'), public.test_ts(14, '00:00'))$$,
  'a long vacation is clipped to the window, so dates beyond it are not revealed');

-- Time off is included, incl. salon-wide closures
select results_eq(
  $$select barber_id, starts_at, ends_at from public.get_busy_times() where barber_id is null$$,
  $$values (null::uuid, public.test_ts(3, '00:00'), public.test_ts(4, '00:00'))$$,
  'a salon-wide closure is returned with barber_id null');

reset role;

-- ==================================== the window follows salon_settings
update public.salon_settings set booking_window_days = 3;

set local role authenticated;
select is(
  (select count(*)::int from public.get_busy_times() where starts_at = public.test_ts(5, '10:00')),
  0, 'with booking_window_days = 3, a booking 5 days out is no longer returned');
select is(
  (select count(*)::int from public.get_busy_times() where starts_at = public.test_ts(2, '10:00')),
  1, 'with booking_window_days = 3, a booking 2 days out is still returned');
reset role;

-- =========================================================== signed out
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  'select * from public.get_busy_times()', '42501', null,
  'anon cannot execute get_busy_times');
reset role;

select * from finish();
rollback;
