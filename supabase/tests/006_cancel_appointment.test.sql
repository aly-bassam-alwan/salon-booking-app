-- cancel_appointment: who may cancel, the cutoff boundary, never deleting,
-- and freeing the slot. now() is fixed for the whole test transaction, so
-- boundary times like "now + cutoff - 1 second" are exact.
begin;
select plan(19);

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

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('c6000000-0000-4000-8000-00000000000a', 'cust.a@test.local'),
  ('c6000000-0000-4000-8000-00000000000b', 'cust.b@test.local'),
  ('c6000000-0000-4000-8000-000000000001', 'cx1@test.local'),
  ('c6000000-0000-4000-8000-000000000002', 'cx2@test.local'),
  ('c6000000-0000-4000-8000-000000000003', 'cx3@test.local'),
  ('d6000000-0000-4000-8000-000000000001', 'barber1@test.local'),
  ('e6000000-0000-4000-8000-000000000001', 'admin@test.local');

update public.profiles set role = 'barber' where id = 'd6000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin'  where id = 'e6000000-0000-4000-8000-000000000001';

insert into public.barbers (id, profile_id, display_name) values
  ('b6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001', 'Barber 1 (has login)'),
  ('b6000000-0000-4000-8000-000000000002', null, 'Barber 2'),
  ('b6000000-0000-4000-8000-0000000000f1', null, 'Boundary barber 1'),
  ('b6000000-0000-4000-8000-0000000000f2', null, 'Boundary barber 2'),
  ('b6000000-0000-4000-8000-0000000000f3', null, 'Boundary barber 3');

insert into public.working_hours (barber_id, weekday, start_time, end_time)
select 'b6000000-0000-4000-8000-000000000001'::uuid, d, time '09:00', time '19:00' from generate_series(1, 6) d;

insert into public.services (id, name, duration_minutes, price_minor) values
  ('5e600000-0000-4000-8000-000000000001', 'Haircut', 30, 1500);

-- Direct inserts (as owner) so we can place appointments at exact instants.
insert into public.appointments
  (id, customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency, status)
values
  -- A, next Monday 10:00 with barber 1 (a real bookable slot)
  ('a6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-00000000000a', 'b6000000-0000-4000-8000-000000000001',
   public.test_ts(public.test_monday(), '10:00'), public.test_ts(public.test_monday(), '10:30'), 30, 1500, 'USD', 'booked'),
  -- A, 3 hours from now, barber 2
  ('a6000000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-00000000000a', 'b6000000-0000-4000-8000-000000000002',
   now() + interval '3 hours', now() + interval '3 hours 30 minutes', 30, 1500, 'USD', 'booked'),
  -- A, 10 minutes from now, barber 1 (inside the cutoff)
  ('a6000000-0000-4000-8000-000000000003', 'c6000000-0000-4000-8000-00000000000a', 'b6000000-0000-4000-8000-000000000001',
   now() + interval '10 minutes', now() + interval '40 minutes', 30, 1500, 'USD', 'booked'),
  -- B, 20 minutes from now, barber 2 (inside the cutoff)
  ('a6000000-0000-4000-8000-000000000004', 'c6000000-0000-4000-8000-00000000000b', 'b6000000-0000-4000-8000-000000000002',
   now() + interval '20 minutes', now() + interval '50 minutes', 30, 1500, 'USD', 'booked'),
  -- B, yesterday, completed
  ('a6000000-0000-4000-8000-000000000005', 'c6000000-0000-4000-8000-00000000000b', 'b6000000-0000-4000-8000-000000000002',
   now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', 30, 1500, 'USD', 'completed'),
  -- Cutoff boundary (default cutoff = 120 min): 1 s before, exactly at, 1 s after
  ('a6000000-0000-4000-8000-0000000000f1', 'c6000000-0000-4000-8000-000000000001', 'b6000000-0000-4000-8000-0000000000f1',
   now() + interval '120 minutes 1 second', now() + interval '150 minutes 1 second', 30, 1500, 'USD', 'booked'),
  ('a6000000-0000-4000-8000-0000000000f2', 'c6000000-0000-4000-8000-000000000002', 'b6000000-0000-4000-8000-0000000000f2',
   now() + interval '120 minutes', now() + interval '150 minutes', 30, 1500, 'USD', 'booked'),
  ('a6000000-0000-4000-8000-0000000000f3', 'c6000000-0000-4000-8000-000000000003', 'b6000000-0000-4000-8000-0000000000f3',
   now() + interval '119 minutes 59 seconds', now() + interval '149 minutes 59 seconds', 30, 1500, 'USD', 'booked');

-- ============================================================ customer A
select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000001')$$,
  'customer cancels their own booking well before the cutoff');
select is(
  (select status || ' ' || (cancelled_by = 'c6000000-0000-4000-8000-00000000000a')::text || ' ' || (cancelled_at is not null)::text
   from public.appointments where id = 'a6000000-0000-4000-8000-000000000001'),
  'cancelled true true',
  'status, cancelled_by and cancelled_at are set');
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000001')$$,
  'P0001', 'NOT_CANCELLABLE', 'an already cancelled booking cannot be cancelled again');

reset role;
select is(
  (select count(*)::int from public.appointments where id = 'a6000000-0000-4000-8000-000000000001'),
  1, 'the cancelled row still exists (never deleted)');

-- ============================================================ customer B
select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.book_appointment('b6000000-0000-4000-8000-000000000001',
      array['5e600000-0000-4000-8000-000000000001']::uuid[], public.test_ts(public.test_monday(), '10:00'))$$,
  'the cancelled slot is free: another customer can book it');
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000002')$$,
  'P0001', 'NOT_FOUND', 'a customer cannot cancel someone else''s booking (looks like it does not exist)');
select throws_ok(
  $$select public.cancel_appointment(gen_random_uuid())$$,
  'P0001', 'NOT_FOUND', 'an unknown appointment id is NOT_FOUND');
reset role;

-- ====================================== cutoff boundary (cutoff = 120 min)
select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-0000000000f1')$$,
  'just before the cutoff (start = now + 120 min + 1 s) is allowed');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-0000000000f2')$$,
  'exactly at the cutoff (start = now + 120 min) is allowed ("up to")');
reset role;

select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-0000000000f3')$$,
  'P0001', 'PAST_CUTOFF', 'just after the cutoff (start = now + 120 min - 1 s) is PAST_CUTOFF');
reset role;

-- ===================================== the cutoff comes from salon_settings
update public.salon_settings set cancellation_cutoff_minutes = 0;
set local role authenticated; -- still customer cx3
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-0000000000f3')$$,
  'with cutoff = 0, the "just after" booking can be cancelled');
reset role;

update public.salon_settings set cancellation_cutoff_minutes = 1440;
select set_config('request.jwt.claims',
  '{"sub":"c6000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000002')$$,
  'P0001', 'PAST_CUTOFF', 'with cutoff = 24 h, a booking 3 hours ahead is PAST_CUTOFF');
reset role;

update public.salon_settings set cancellation_cutoff_minutes = 120;
set local role authenticated; -- still customer A
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000002')$$,
  'back to cutoff = 2 h, the same booking can be cancelled');
reset role;

-- ================================================================== barber
select set_config('request.jwt.claims',
  '{"sub":"d6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000003')$$,
  'a barber cancels their own appointment inside the cutoff (10 min ahead)');
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000004')$$,
  'P0001', 'NOT_FOUND', 'a barber cannot cancel another barber''s appointment');
reset role;

-- =================================================================== admin
select set_config('request.jwt.claims',
  '{"sub":"e6000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000004')$$,
  'an admin cancels any appointment inside the cutoff (20 min ahead)');
select is(
  (select cancelled_by from public.appointments where id = 'a6000000-0000-4000-8000-000000000004'),
  'e6000000-0000-4000-8000-000000000001'::uuid,
  'cancelled_by records the admin');
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000005')$$,
  'P0001', 'NOT_CANCELLABLE', 'a completed appointment cannot be cancelled');
reset role;

-- ============================================================== signed out
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select public.cancel_appointment('a6000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'anon cannot execute cancel_appointment');
reset role;

select * from finish();
rollback;
