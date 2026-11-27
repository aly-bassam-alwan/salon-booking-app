-- cancel_appointment: the only way to cancel a booking (SPEC.md §3.6).
--
-- Who may cancel:
--   * admin:    any appointment, any time
--   * barber:   their own appointments (barber_id = current_barber_id()), any time
--   * customer: their own, until salon_settings.cancellation_cutoff_minutes
--               before the start ("up to": exactly at the cutoff is allowed).
--               Later -> PAST_CUTOFF, shown as "Please call the salon to cancel."
--   * anyone else, or an unknown id -> NOT_FOUND (same error, so other
--     people's bookings can't be probed).
--
-- Cancelling never deletes: it sets status = 'cancelled', cancelled_at and
-- cancelled_by. The double-booking exclusion constraint only covers booked
-- rows, so the slot is free again immediately.
--
-- Errors (SQLSTATE P0001, code as message): NOT_ALLOWED, NOT_FOUND,
-- NOT_CANCELLABLE, PAST_CUTOFF.

create function public.cancel_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_appt public.appointments;
  v_settings public.salon_settings;
  v_is_admin boolean;
  v_is_barber boolean;
begin
  if v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Lock the row so a concurrent cancel/booking change can't interleave.
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  v_is_admin := public.is_admin();
  v_is_barber := coalesce(v_appt.barber_id = public.current_barber_id(), false);

  -- Authorise BEFORE revealing anything about the appointment.
  if not (v_is_admin or v_is_barber or v_appt.customer_id = v_uid) then
    raise exception 'NOT_FOUND';
  end if;

  if v_appt.status <> 'booked' then
    raise exception 'NOT_CANCELLABLE';
  end if;

  -- Customers only: the cutoff from salon_settings, read at call time.
  if not (v_is_admin or v_is_barber) then
    select * into strict v_settings from public.salon_settings;
    if now() > v_appt.starts_at - make_interval(mins => v_settings.cancellation_cutoff_minutes) then
      raise exception 'PAST_CUTOFF';
    end if;
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid
  where id = v_appt.id
  returning * into v_appt;

  return v_appt;
end;
$$;

comment on function public.cancel_appointment(uuid) is
  'Cancels a booking (never deletes). Customers until the cutoff; own barber and admins any time.';

revoke execute on function public.cancel_appointment(uuid) from public, anon;
grant execute on function public.cancel_appointment(uuid) to authenticated;
