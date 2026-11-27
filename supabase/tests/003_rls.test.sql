-- Row Level Security: each role sees and changes only what it should.
-- We switch into the real `authenticated` / `anon` roles with JWT claims set,
-- exactly like PostgREST does for app requests.
begin;
select plan(22);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-00000000000a', 'cust.a@test.local'),
  ('c0000000-0000-4000-8000-00000000000b', 'cust.b@test.local'),
  ('d0000000-0000-4000-8000-000000000001', 'barber@test.local'),
  ('e0000000-0000-4000-8000-000000000001', 'admin@test.local');

update public.profiles set role = 'barber' where id = 'd0000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin'  where id = 'e0000000-0000-4000-8000-000000000001';

insert into public.barbers (id, profile_id, display_name, is_active) values
  ('b3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Linked barber', true),
  ('b3000000-0000-4000-8000-000000000002', null, 'Other barber', true),
  ('b3000000-0000-4000-8000-000000000003', null, 'Retired barber', false);

insert into public.services (id, name, duration_minutes, price_minor, is_active) values
  ('5e300000-0000-4000-8000-000000000001', 'Active service', 30, 1000, true),
  ('5e300000-0000-4000-8000-000000000002', 'Hidden service', 30, 1000, false);

insert into public.working_hours (barber_id, weekday, start_time, end_time) values
  ('b3000000-0000-4000-8000-000000000001', 1, '09:00', '19:00'),
  ('b3000000-0000-4000-8000-000000000002', 1, '09:00', '19:00'),
  ('b3000000-0000-4000-8000-000000000003', 1, '09:00', '19:00'); -- inactive barber

-- Customer A with the linked barber; customer B with the other barber.
insert into public.appointments
  (id, customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
values
  ('a3000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-00000000000a',
   'b3000000-0000-4000-8000-000000000001', '2030-01-07 10:00+00', '2030-01-07 10:30+00', 30, 1000, 'USD'),
  ('a3000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000b',
   'b3000000-0000-4000-8000-000000000002', '2030-01-07 10:00+00', '2030-01-07 10:30+00', 30, 1000, 'USD');

insert into public.appointment_services
  (appointment_id, service_id, service_name, duration_minutes, price_minor, position)
values
  ('a3000000-0000-4000-8000-00000000000a', '5e300000-0000-4000-8000-000000000001', 'Active service', 30, 1000, 1),
  ('a3000000-0000-4000-8000-00000000000b', '5e300000-0000-4000-8000-000000000001', 'Active service', 30, 1000, 1);

-- ------------------------------------------------------- anon (signed out)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select is(
  (select count(*)::int from public.services where id::text like '5e300000%'),
  1, 'anon: reads active services only');
select is(
  (select count(*)::int from public.barbers where id::text like 'b3000000%'),
  2, 'anon: reads active barbers only');
select throws_ok('select * from public.appointments', '42501', null,
  'anon: cannot read appointments');
select throws_ok('select * from public.profiles', '42501', null,
  'anon: cannot read profiles');
select is(
  (select count(*)::int from public.working_hours where barber_id::text like 'b3000000%'), 2,
  'anon: reads working hours of active barbers only');

reset role;

-- --------------------------------------------------------------- customer A
select set_config('request.jwt.claims',
  '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  'select id from public.appointments',
  $$values ('a3000000-0000-4000-8000-00000000000a'::uuid)$$,
  'customer: sees only their own appointments');
select is(
  (select count(*)::int from public.appointment_services),
  1, 'customer: sees services only for their own appointments');
select results_eq(
  'select id from public.profiles',
  $$values ('c0000000-0000-4000-8000-00000000000a'::uuid)$$,
  'customer: sees only their own profile');
select is(
  (select count(*)::int from public.working_hours where barber_id::text like 'b3000000%'), 2,
  'customer: reads working hours of active barbers only (inactive hidden)');
select throws_ok(
  $$insert into public.working_hours (barber_id, weekday, start_time, end_time)
    values ('b3000000-0000-4000-8000-000000000002', 2, '09:00', '19:00')$$,
  '42501', null,
  'customer: cannot change working hours');

select throws_ok(
  $$insert into public.appointments (customer_id, barber_id, starts_at, ends_at, total_duration_minutes, total_price_minor, currency)
    values ('c0000000-0000-4000-8000-00000000000a', 'b3000000-0000-4000-8000-000000000002',
            '2030-01-08 10:00+00', '2030-01-08 10:30+00', 30, 1000, 'USD')$$,
  '42501', null,
  'customer: cannot insert appointments directly (must use book_appointment)');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = 'c0000000-0000-4000-8000-00000000000a'$$,
  '42501', null,
  'customer: cannot change their own role');
select lives_ok(
  $$update public.profiles set full_name = 'Alice' where id = 'c0000000-0000-4000-8000-00000000000a'$$,
  'customer: can update their own name');

-- These silently affect 0 rows (RLS), so the results are checked afterwards.
update public.appointments set status = 'no_show' where id = 'a3000000-0000-4000-8000-00000000000a';
update public.services set price_minor = 1 where id = '5e300000-0000-4000-8000-000000000001';

reset role;

select is(
  (select status::text from public.appointments where id = 'a3000000-0000-4000-8000-00000000000a'),
  'booked', 'customer: cannot change appointment status');
select is(
  (select price_minor from public.services where id = '5e300000-0000-4000-8000-000000000001'),
  1000, 'customer: cannot change service prices');
select is(
  (select full_name from public.profiles where id = 'c0000000-0000-4000-8000-00000000000a'),
  'Alice', 'customer: own name update was saved');

-- ------------------------------------------------------------------- barber
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  'select id from public.appointments',
  $$values ('a3000000-0000-4000-8000-00000000000a'::uuid)$$,
  'barber: sees only their own schedule');
select results_eq(
  'select id from public.profiles order by id',
  $$values ('c0000000-0000-4000-8000-00000000000a'::uuid), ('d0000000-0000-4000-8000-000000000001'::uuid)$$,
  'barber: sees own profile and their customers, not other customers');
select is(
  (select count(*)::int from public.working_hours where barber_id::text like 'b3000000%'), 2,
  'barber: reads working hours of active barbers like everyone else');

reset role;

-- -------------------------------------------------------------------- admin
select set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.appointments), 2,
  'admin: sees all appointments');
select lives_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('New service', 60, 3000)$$,
  'admin: can create services');
select lives_ok(
  $$update public.salon_settings set min_lead_minutes = 90$$,
  'admin: can edit salon settings');

reset role;

select * from finish();
rollback;
