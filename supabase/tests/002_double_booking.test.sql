-- Double-booking is impossible at database level: exclusion constraints on
-- appointments, tested with direct inserts (bypassing book_appointment) to
-- show the constraint itself is the guarantee.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'c1@test.local'),
  ('c0000000-0000-4000-8000-000000000002', 'c2@test.local'),
  ('c0000000-0000-4000-8000-000000000003', 'c3@test.local');

insert into public.barbers (id, display_name) values
  ('b2000000-0000-4000-8000-000000000001', 'Barber 1'),
  ('b2000000-0000-4000-8000-000000000002', 'Barber 2');

-- Shorthand: c1/c2/c3 customers, b1/b2 barbers, all on 2030-01-07 (UTC).
-- 10:00-10:30 for barber 1 / customer 1.
insert into public.appointments
  (id, customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
values
  ('a0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   '2030-01-07 10:00+00', '2030-01-07 10:30+00', 30, 1500, 'USD');

select throws_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001',
            '2030-01-07 10:00+00', '2030-01-07 11:00+00', 60, 2500, 'USD')$$,
  '23P01', null,
  'an overlapping booking for the same barber is rejected (same start)');

select throws_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001',
            '2030-01-07 09:30+00', '2030-01-07 10:30+00', 60, 2500, 'USD')$$,
  '23P01', null,
  'a booking that runs into an existing one is rejected (partial overlap)');

select lives_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001',
            '2030-01-07 10:30+00', '2030-01-07 11:00+00', 30, 1500, 'USD')$$,
  'back-to-back bookings (10:00-10:30 then 10:30-11:00) are allowed');

select lives_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000003', 'b2000000-0000-4000-8000-000000000002',
            '2030-01-07 10:00+00', '2030-01-07 10:30+00', 30, 1500, 'USD')$$,
  'the same time with a different barber is allowed');

select lives_ok(
  $$insert into public.appointments (id, customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency, status, cancelled_at)
    values ('a0000000-0000-4000-8000-000000000009',
            'c0000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000001',
            '2030-01-07 10:00+00', '2030-01-07 10:30+00', 30, 1500, 'USD', 'cancelled', now())$$,
  'a cancelled appointment does not block the slot');

select throws_ok(
  $$update public.appointments set status = 'booked', cancelled_at = null
    where id = 'a0000000-0000-4000-8000-000000000009'$$,
  '23P01', null,
  're-activating a cancelled appointment into a taken slot is rejected');

update public.appointments set status = 'cancelled', cancelled_at = now()
where id = 'a0000000-0000-4000-8000-000000000001';

select lives_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
            '2030-01-07 09:30+00', '2030-01-07 10:30+00', 60, 2500, 'USD')$$,
  'cancelling an appointment frees its slot');

select throws_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002',
            '2030-01-07 10:30+00', '2030-01-07 11:00+00', 30, 1500, 'USD')$$,
  '23P01', null,
  'a customer cannot hold two overlapping bookings (even with different barbers)');

select throws_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002',
            '2030-01-07 12:00+00', '2030-01-07 12:45+00', 30, 1500, 'USD')$$,
  '23514', null,
  'ends_at must equal starts_at + total_duration_minutes');

select * from finish();
rollback;
