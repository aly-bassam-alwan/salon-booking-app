-- get_busy_times: anonymous busy intervals for computing availability.
--
-- Customers can't read other customers' appointments or raw time off (RLS),
-- but the app needs to know when barbers are busy. This function returns
-- ONLY (barber_id, starts_at, ends_at):
--   * booked appointments (cancelled / completed / no-show are not busy,
--     matching the double-booking constraint and getAvailableSlots), and
--   * time off: barber breaks and salon-wide closures (barber_id = null).
-- No appointment id, customer, note, price, status or reason is exposed, and
-- the two sources are indistinguishable.
--
-- Scraping protection: results are limited to the booking window from
-- salon_settings (salon-local today .. today + booking_window_days - 1).
-- A requested range is clipped to the window; a range fully outside returns
-- nothing. Returned intervals are clipped to the window as well, so a long
-- vacation doesn't reveal dates beyond it. Null arguments = whole window.

create function public.get_busy_times(
  p_from date default null,
  p_to date default null
)
returns table (barber_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_settings public.salon_settings;
  v_today date;
  v_last date;
  v_from date;
  v_to date;
  v_start timestamptz;
  v_end timestamptz;
begin
  select * into strict v_settings from public.salon_settings;

  v_today := (now() at time zone v_settings.timezone)::date;
  v_last := v_today + (v_settings.booking_window_days - 1);
  v_from := greatest(coalesce(p_from, v_today), v_today);
  v_to := least(coalesce(p_to, v_last), v_last);

  if v_from > v_to then
    return; -- requested range is entirely outside the booking window
  end if;

  -- Salon-local midnight of v_from .. midnight after v_to, as real instants.
  v_start := v_from::timestamp at time zone v_settings.timezone;
  v_end := (v_to + 1)::timestamp at time zone v_settings.timezone;

  return query
  select busy.barber_id,
         greatest(busy.starts_at, v_start),
         least(busy.ends_at, v_end)
  from (
    select a.barber_id, a.starts_at, a.ends_at
    from public.appointments a
    where a.status = 'booked'
    union all
    select t.barber_id, t.starts_at, t.ends_at
    from public.time_off t
  ) as busy
  where busy.starts_at < v_end and busy.ends_at > v_start
  order by 2, 3, 1;
end;
$$;

comment on function public.get_busy_times(date, date) is
  'Anonymous busy intervals (barber_id, starts_at, ends_at) within the booking window.';

-- Signed-in users only. (Supabase grants EXECUTE to anon by default.)
revoke execute on function public.get_busy_times(date, date) from public, anon;
grant execute on function public.get_busy_times(date, date) to authenticated;
