-- Schema: tables exist, RLS is on everywhere, CHECKs and settings validation.
begin;
select plan(17);

insert into public.barbers (id, display_name) values ('b1000000-0000-4000-8000-000000000001', 'Test barber');

select tables_are('public', array[
  'salon_settings', 'profiles', 'barbers', 'services', 'working_hours',
  'time_off', 'appointments', 'appointment_services'
], 'public schema has exactly the expected tables');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'RLS is enabled on every public table'
);

-- services.duration_minutes must be a positive multiple of 30
select throws_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('x', 0, 100)$$,
  '23514', null, 'duration 0 is rejected');
select throws_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('x', 45, 100)$$,
  '23514', null, 'duration 45 is rejected');
select throws_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('x', -30, 100)$$,
  '23514', null, 'duration -30 is rejected');
select lives_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('x', 30, 100), ('y', 60, 100), ('z', 90, 100)$$,
  'durations 30, 60 and 90 are accepted');
select throws_ok(
  $$insert into public.services (name, duration_minutes, price_minor) values ('x', 30, -1)$$,
  '23514', null, 'negative price is rejected');

-- working_hours must be on the 30-minute grid and end after start
select throws_ok(
  $$insert into public.working_hours (barber_id, weekday, start_time, end_time)
    values ('b1000000-0000-4000-8000-000000000001', 0, '09:15', '18:00')$$,
  '23514', null, 'working hours off the 30-minute grid are rejected');
select throws_ok(
  $$insert into public.working_hours (barber_id, weekday, start_time, end_time)
    values ('b1000000-0000-4000-8000-000000000001', 0, '18:00', '09:00')$$,
  '23514', null, 'working hours ending before they start are rejected');

-- salon_settings: exactly one row, validated values
select is((select count(*)::int from public.salon_settings), 1, 'salon_settings has exactly one row');
select throws_ok(
  $$insert into public.salon_settings (name, timezone, currency, booking_window_days, min_lead_minutes, cancellation_cutoff_minutes)
    values ('Second', 'Asia/Qatar', 'QAR', 14, 60, 120)$$,
  '23505', null, 'a second settings row is rejected');
select throws_ok(
  $$update public.salon_settings set timezone = 'Mars/Olympus_Mons'$$,
  '22023', 'Invalid timezone: Mars/Olympus_Mons', 'an invalid timezone is rejected');
select throws_ok(
  $$update public.salon_settings set currency = 'usd'$$,
  '23514', null, 'a lowercase currency code is rejected');
select throws_ok(
  $$update public.salon_settings set min_lead_minutes = -1$$,
  '23514', null, 'a negative lead time is rejected');
select throws_ok(
  $$update public.salon_settings set booking_window_days = 0$$,
  '23514', null, 'a zero-day booking window is rejected');
select lives_ok(
  $$update public.salon_settings set timezone = 'Asia/Qatar', currency = 'QAR'$$,
  'switching to another salon (Asia/Qatar, QAR) is accepted');
select is(
  (select timezone || ' ' || currency from public.salon_settings),
  'Asia/Qatar QAR',
  'settings row now holds the new salon values');

select * from finish();
rollback;
