-- "Any available barber" for book_appointment (SPEC.md §3.5).
--
-- book_appointment keeps its signature. With p_barber_id = null the server
-- picks, among active barbers free for the WHOLE duration, the one with the
-- fewest booked MINUTES on that salon-local day (cancelled bookings don't
-- count). Ties: lowest sort_order, then lowest id. Fixed and predictable.
--
-- Concurrency: the "any" path locks every active barber row in id order
-- (FOR UPDATE) before choosing. Two simultaneous "any barber" bookings
-- therefore run one after the other, and the second sees the first one's
-- booking and picks someone else. The fixed lock order can't deadlock with
-- another "any" booking, and a specific-barber booking only ever locks one
-- barber row, so no lock cycle is possible. The exclusion constraints on
-- appointments remain the final guarantee.

-- Internal helpers live in a schema the API doesn't expose.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Why this barber can't take [p_start, p_end), or null if they can.
create function private.barber_unavailable_reason(
  p_barber public.barbers,
  p_start timestamptz,
  p_end timestamptz,
  p_settings public.salon_settings
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local_date date := (p_start at time zone p_settings.timezone)::date;
  v_hours public.working_hours;
begin
  if not p_barber.is_active then
    return 'INVALID_BARBER';
  end if;

  -- The whole appointment must fit in that weekday's working hours.
  -- (date + local time) AT TIME ZONE tz gives the real instant, DST-safe.
  select * into v_hours
  from public.working_hours
  where barber_id = p_barber.id and weekday = extract(dow from v_local_date);

  if not found
     or p_start < (v_local_date + v_hours.start_time) at time zone p_settings.timezone
     or p_end > (v_local_date + v_hours.end_time) at time zone p_settings.timezone
  then
    return 'OUTSIDE_WORKING_HOURS';
  end if;

  -- Barber's time off or a salon-wide closure.
  if exists (
    select 1 from public.time_off t
    where (t.barber_id = p_barber.id or t.barber_id is null)
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    return 'SLOT_UNAVAILABLE';
  end if;

  -- Another booked appointment of this barber.
  if exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber.id
      and a.status = 'booked'
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
  ) then
    return 'SLOT_UNAVAILABLE';
  end if;

  return null;
end;
$$;

revoke execute on function private.barber_unavailable_reason(public.barbers, timestamptz, timestamptz, public.salon_settings)
  from public, anon, authenticated;

create or replace function public.book_appointment(
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
  v_barber_id uuid;
  v_reason text;
  v_service_count int;
  v_duration int;
  v_price int;
  v_end timestamptz;
  v_local_start timestamp;
  v_local_date date;
  v_today date;
  v_day_start timestamptz;
  v_day_end timestamptz;
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

  v_end := p_start_time + make_interval(mins => v_duration);
  v_local_start := p_start_time at time zone v_settings.timezone;
  v_local_date := v_local_start::date;
  v_today := (now() at time zone v_settings.timezone)::date;

  -- 3. Start must be on the slot grid in salon local time (e.g. 10:00, 10:30).
  if extract(second from v_local_start) <> 0
     or (extract(hour from v_local_start)::int * 60 + extract(minute from v_local_start)::int)
        % v_settings.slot_interval_minutes <> 0
  then
    raise exception 'INVALID_TIME';
  end if;

  -- 4. Minimum lead time (also rejects the past).
  if p_start_time < now() + make_interval(mins => v_settings.min_lead_minutes) then
    raise exception 'TOO_SOON';
  end if;

  -- 5. Booking window: today .. today + (window - 1), salon local dates.
  if v_local_date > v_today + (v_settings.booking_window_days - 1) then
    raise exception 'OUT_OF_WINDOW';
  end if;

  -- 6. Barber.
  if p_barber_id is not null then
    -- Specific barber: lock that row, then report the precise reason.
    select * into v_barber from public.barbers where id = p_barber_id for update;
    if not found then
      raise exception 'INVALID_BARBER';
    end if;
    v_reason := private.barber_unavailable_reason(v_barber, p_start_time, v_end, v_settings);
    if v_reason is not null then
      raise exception '%', v_reason;
    end if;
    v_barber_id := p_barber_id;
  else
    -- Any available barber: lock all active barbers in a fixed order, so
    -- concurrent "any" bookings are serialised, then choose.
    perform 1 from public.barbers where is_active order by id for update;

    v_day_start := v_local_date::timestamp at time zone v_settings.timezone;
    v_day_end := (v_local_date + 1)::timestamp at time zone v_settings.timezone;

    select b.id into v_barber_id
    from public.barbers b
    where b.is_active
      and private.barber_unavailable_reason(b, p_start_time, v_end, v_settings) is null
    order by
      (select coalesce(sum(a.total_duration_minutes), 0)
       from public.appointments a
       where a.barber_id = b.id
         and a.status = 'booked'
         and a.starts_at >= v_day_start
         and a.starts_at < v_day_end),
      b.sort_order,
      b.id
    limit 1;

    if v_barber_id is null then
      raise exception 'SLOT_UNAVAILABLE';
    end if;
  end if;

  -- 7. Insert. The exclusion constraints remain the final guarantee.
  begin
    insert into public.appointments (
      customer_id, barber_id, starts_at, ends_at,
      total_duration_minutes, total_price_minor, currency, customer_note
    ) values (
      v_uid, v_barber_id, p_start_time, v_end,
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
  'Creates a booking for the current user (p_barber_id null = any available barber). The only way to insert appointments.';
