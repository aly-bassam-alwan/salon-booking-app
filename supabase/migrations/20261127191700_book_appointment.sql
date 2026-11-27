-- book_appointment: the ONLY way to create a booking (SPEC.md §3.3, §3.4, §5).
--
-- Runs in a single transaction (one function call). It:
--   1. validates the caller, services and barber,
--   2. computes ends_at from the sum of service durations,
--   3. enforces the 30-min grid, lead time, booking window, working hours and
--      time off, reading all salon-specific values from salon_settings,
--   4. inserts the appointment and its service rows with price snapshots.
-- The exclusion constraints on appointments remain the final guarantee
-- against double-booking, even under concurrency.
--
-- Errors are raised as SQLSTATE P0001 with a stable code as the message
-- (SLOT_UNAVAILABLE, OUTSIDE_WORKING_HOURS, TOO_SOON, OUT_OF_WINDOW,
-- INVALID_TIME, INVALID_SERVICES, INVALID_BARBER, ALREADY_BOOKED, NOT_ALLOWED)
-- so the app can map them to friendly messages.
--
-- "Any available barber" (p_barber_id = null) is added in Phase 2.

create function public.book_appointment(
  p_barber_id uuid,
  p_service_ids uuid[],
  p_start_time timestamptz,
  p_note text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.salon_settings;
  v_barber public.barbers;
  v_service_count int;
  v_duration int;
  v_price int;
  v_end timestamptz;
  v_local_start timestamp;
  v_local_date date;
  v_today date;
  v_hours public.working_hours;
  v_work_start timestamptz;
  v_work_end timestamptz;
  v_appt public.appointments;
  v_constraint text;
begin
  -- 1. Caller must be signed in and have a profile.
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into strict v_settings from public.salon_settings;

  -- 2. Services: at least one, no duplicates, all exist and are active.
  if p_service_ids is null
     or cardinality(p_service_ids) = 0
     or cardinality(p_service_ids) <> (select count(distinct s) from unnest(p_service_ids) s)
  then
    raise exception 'INVALID_SERVICES';
  end if;

  select count(*), sum(duration_minutes), sum(price_minor)
    into v_service_count, v_duration, v_price
  from public.services
  where id = any (p_service_ids) and is_active;

  if v_service_count <> cardinality(p_service_ids) then
    raise exception 'INVALID_SERVICES';
  end if;

  if p_start_time is null then
    raise exception 'INVALID_TIME';
  end if;

  -- 3. Lock the barber row. Concurrent bookings (and, later, time-off
  --    changes) for the same barber run one at a time from here on.
  select * into v_barber from public.barbers where id = p_barber_id for update;
  if not found or not v_barber.is_active then
    raise exception 'INVALID_BARBER';
  end if;

  v_end := p_start_time + make_interval(mins => v_duration);
  v_local_start := p_start_time at time zone v_settings.timezone;
  v_local_date := v_local_start::date;
  v_today := (now() at time zone v_settings.timezone)::date;

  -- 4. Start must be on the slot grid in salon local time (e.g. 10:00, 10:30).
  if extract(second from v_local_start) <> 0
     or (extract(hour from v_local_start)::int * 60 + extract(minute from v_local_start)::int)
        % v_settings.slot_interval_minutes <> 0
  then
    raise exception 'INVALID_TIME';
  end if;

  -- 5. Minimum lead time (also rejects the past).
  if p_start_time < now() + make_interval(mins => v_settings.min_lead_minutes) then
    raise exception 'TOO_SOON';
  end if;

  -- 6. Booking window: today .. today + (window - 1), salon local dates.
  if v_local_date > v_today + (v_settings.booking_window_days - 1) then
    raise exception 'OUT_OF_WINDOW';
  end if;

  -- 7. The whole appointment must fit in that weekday's working hours.
  --    (date + local time) AT TIME ZONE tz gives the real instant, DST-safe.
  select * into v_hours
  from public.working_hours
  where barber_id = p_barber_id and weekday = extract(dow from v_local_date);

  if not found then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  v_work_start := (v_local_date + v_hours.start_time) at time zone v_settings.timezone;
  v_work_end := (v_local_date + v_hours.end_time) at time zone v_settings.timezone;

  if p_start_time < v_work_start or v_end > v_work_end then
    raise exception 'OUTSIDE_WORKING_HOURS';
  end if;

  -- 8. No overlap with the barber's time off or a salon-wide closure.
  if exists (
    select 1 from public.time_off t
    where (t.barber_id = p_barber_id or t.barber_id is null)
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start_time, v_end, '[)')
  ) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- 9. Insert. The exclusion constraints catch overlapping bookings.
  begin
    insert into public.appointments (
      customer_id, barber_id, starts_at, ends_at,
      total_duration_minutes, total_price_minor, currency, customer_note
    ) values (
      v_uid, p_barber_id, p_start_time, v_end,
      v_duration, v_price, v_settings.currency, nullif(trim(p_note), '')
    )
    returning * into v_appt;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'appointments_no_customer_overlap' then
      raise exception 'ALREADY_BOOKED';
    end if;
    raise exception 'SLOT_UNAVAILABLE';
  end;

  insert into public.appointment_services
    (appointment_id, service_id, service_name, duration_minutes, price_minor, position)
  select v_appt.id, s.id, s.name, s.duration_minutes, s.price_minor, u.ord::smallint
  from unnest(p_service_ids) with ordinality as u (service_id, ord)
  join public.services s on s.id = u.service_id;

  return v_appt;
end;
$$;

comment on function public.book_appointment(uuid, uuid[], timestamptz, text) is
  'Creates a booking for the current user. The only way to insert appointments.';

-- Signed-in users only. (Supabase grants EXECUTE to anon by default.)
revoke execute on function public.book_appointment(uuid, uuid[], timestamptz, text)
  from public, anon;
grant execute on function public.book_appointment(uuid, uuid[], timestamptz, text)
  to authenticated;
