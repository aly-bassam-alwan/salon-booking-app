-- Row Level Security for every table (SPEC.md §6).
--
-- Supabase's default privileges give anon/authenticated ALL on new tables,
-- so we first revoke everything and then grant back only what each role
-- needs. Grants decide WHICH operations/columns are possible; policies decide
-- WHICH ROWS. Both must allow an action.
--
-- Key rules:
--  * Nobody can INSERT appointments directly; booking goes only through
--    public.book_appointment() (SECURITY DEFINER).
--  * Users can update only their own name/phone, never their role.
--  * services and barbers are readable by everyone (including signed-out).

alter table public.salon_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.barbers enable row level security;
alter table public.services enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;

revoke all on
  public.salon_settings, public.profiles, public.barbers, public.services,
  public.working_hours, public.time_off, public.appointments, public.appointment_services
from anon, authenticated;

-- ---------------------------------------------------------- salon_settings
grant select on public.salon_settings to authenticated;
grant update (name, phone, timezone, currency, booking_window_days,
              min_lead_minutes, cancellation_cutoff_minutes)
  on public.salon_settings to authenticated;

create policy "settings: signed-in users can read"
  on public.salon_settings for select to authenticated
  using (true);

create policy "settings: admins can update"
  on public.salon_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ----------------------------------------------------------------- profiles
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "profiles: read own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: barbers read their customers"
  on public.profiles for select to authenticated
  using (exists (
    select 1 from public.appointments a
    where a.customer_id = profiles.id
      and a.barber_id = (select public.current_barber_id())
  ));

create policy "profiles: admins read all"
  on public.profiles for select to authenticated
  using ((select public.is_admin()));

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "profiles: admins update all"
  on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------------ barbers
grant select on public.barbers to anon, authenticated;
grant insert, update, delete on public.barbers to authenticated;

create policy "barbers: everyone reads active"
  on public.barbers for select to anon, authenticated
  using (is_active);

create policy "barbers: barber reads own"
  on public.barbers for select to authenticated
  using (profile_id = (select auth.uid()));

create policy "barbers: admins read all"
  on public.barbers for select to authenticated
  using ((select public.is_admin()));

create policy "barbers: admins insert"
  on public.barbers for insert to authenticated
  with check ((select public.is_admin()));

create policy "barbers: admins update"
  on public.barbers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "barbers: admins delete"
  on public.barbers for delete to authenticated
  using ((select public.is_admin()));

-- ----------------------------------------------------------------- services
grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;

create policy "services: everyone reads active"
  on public.services for select to anon, authenticated
  using (is_active);

create policy "services: admins read all"
  on public.services for select to authenticated
  using ((select public.is_admin()));

create policy "services: admins insert"
  on public.services for insert to authenticated
  with check ((select public.is_admin()));

create policy "services: admins update"
  on public.services for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "services: admins delete"
  on public.services for delete to authenticated
  using ((select public.is_admin()));

-- ------------------------------------------------------------ working_hours
-- Customers get availability through functions, not raw schedules.
grant select, insert, update, delete on public.working_hours to authenticated;

create policy "working_hours: barber reads own"
  on public.working_hours for select to authenticated
  using (barber_id = (select public.current_barber_id()));

create policy "working_hours: admins manage"
  on public.working_hours for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ----------------------------------------------------------------- time_off
grant select, insert, update, delete on public.time_off to authenticated;

create policy "time_off: barber reads own and salon-wide"
  on public.time_off for select to authenticated
  using (barber_id is null or barber_id = (select public.current_barber_id()));

create policy "time_off: admins manage"
  on public.time_off for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------- appointments
-- SELECT only, plus status-related columns for admins. No INSERT/DELETE grant
-- at all: creating a booking is only possible through book_appointment().
grant select on public.appointments to authenticated;
grant update (status, cancelled_at, cancelled_by) on public.appointments to authenticated;

create policy "appointments: customer reads own"
  on public.appointments for select to authenticated
  using (customer_id = (select auth.uid()));

create policy "appointments: barber reads own schedule"
  on public.appointments for select to authenticated
  using (barber_id = (select public.current_barber_id()));

create policy "appointments: admins read all"
  on public.appointments for select to authenticated
  using ((select public.is_admin()));

create policy "appointments: admins update status"
  on public.appointments for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ----------------------------------------------------- appointment_services
-- Visible exactly when the parent appointment is visible (the subquery is
-- itself filtered by the appointments policies above).
grant select on public.appointment_services to authenticated;

create policy "appointment_services: visible with their appointment"
  on public.appointment_services for select to authenticated
  using (exists (
    select 1 from public.appointments a where a.id = appointment_services.appointment_id
  ));
