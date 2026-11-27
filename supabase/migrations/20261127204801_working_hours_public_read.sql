-- Working hours of ACTIVE barbers are public information (opening hours), and
-- the app needs them to compute available slots (getAvailableSlots).
-- Previously only the barber themselves and admins could read them.
-- Writes stay admin-only (policy "working_hours: admins manage").

grant select on public.working_hours to anon;

create policy "working_hours: everyone reads active barbers"
  on public.working_hours for select to anon, authenticated
  using (exists (
    select 1 from public.barbers b
    where b.id = working_hours.barber_id and b.is_active
  ));
