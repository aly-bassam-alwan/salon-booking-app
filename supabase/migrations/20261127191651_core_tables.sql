-- Barbers, services, working hours, time off, appointments (SPEC.md §4).

-- Generic "touch updated_at" trigger function.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------- barbers
create table public.barbers (
  id uuid primary key default gen_random_uuid(),
  -- Login account; null until the admin invites the barber.
  profile_id uuid unique references public.profiles (id) on delete set null,
  display_name text not null check (length(trim(display_name)) > 0),
  bio text,
  photo_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS helper: the barbers.id linked to the current user (null if none).
create function public.current_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.barbers where profile_id = (select auth.uid());
$$;

-- --------------------------------------------------------------- services
create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  duration_minutes int not null
    check (duration_minutes > 0 and duration_minutes % 30 = 0),
  -- Integer minor units of salon_settings.currency (cents for USD).
  price_minor int not null check (price_minor >= 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger services_set_updated_at
before update on public.services
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- working_hours
-- Weekly hours as LOCAL wall-clock times in the salon timezone (SPEC §3.8):
-- recurring rules must not shift when DST changes.
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday (extract(dow))
  start_time time not null,
  end_time time not null,
  constraint working_hours_order check (end_time > start_time),
  constraint working_hours_on_grid check (
    extract(second from start_time) = 0 and extract(minute from start_time) in (0, 30)
    and extract(second from end_time) = 0 and extract(minute from end_time) in (0, 30)
  ),
  constraint working_hours_one_per_day unique (barber_id, weekday)
);

-- ---------------------------------------------------------------- time_off
-- Breaks, days off, holidays. barber_id null = whole salon closed.
create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid references public.barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint time_off_order check (ends_at > starts_at),
  constraint time_off_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index time_off_barber_starts_idx on public.time_off (barber_id, starts_at);

-- ------------------------------------------------------------ appointments
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  -- Barbers are deactivated, not deleted, once they have bookings.
  barber_id uuid not null references public.barbers (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_duration_minutes int not null
    check (total_duration_minutes > 0 and total_duration_minutes % 30 = 0),
  total_price_minor int not null check (total_price_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'), -- snapshot at booking time
  status public.appointment_status not null default 'booked',
  customer_note text check (char_length(customer_note) <= 280),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,

  constraint appointments_time_order check (ends_at > starts_at),
  constraint appointments_duration_matches
    check (ends_at = starts_at + make_interval(mins => total_duration_minutes)),
  constraint appointments_cancel_consistency
    check ((status = 'cancelled') = (cancelled_at is not null)),

  -- THE double-booking guarantee: two *booked* appointments of the same
  -- barber can never overlap. Half-open ranges, so 10:00-10:30 and
  -- 10:30-11:00 are fine. Cancelled (and completed/no-show) rows are ignored.
  constraint appointments_no_barber_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked'),

  -- A customer can't hold two overlapping bookings either.
  constraint appointments_no_customer_overlap exclude using gist (
    customer_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'booked')
);

create index appointments_barber_starts_idx on public.appointments (barber_id, starts_at);
create index appointments_customer_starts_idx on public.appointments (customer_id, starts_at);

-- --------------------------------------------------- appointment_services
-- Services in a booking, with name/duration/price copied at booking time.
create table public.appointment_services (
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict,
  service_name text not null,
  duration_minutes int not null check (duration_minutes > 0 and duration_minutes % 30 = 0),
  price_minor int not null check (price_minor >= 0),
  position smallint not null check (position >= 1),
  primary key (appointment_id, service_id),
  constraint appointment_services_position_unique unique (appointment_id, position)
);

create index appointment_services_service_idx on public.appointment_services (service_id);
