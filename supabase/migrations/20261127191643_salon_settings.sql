-- Single-row table holding every salon-specific setting (SPEC.md §3.9).
-- Nothing here is hard-coded in app code or in function bodies: the booking
-- functions read this row at call time, so an admin can change it later and
-- the same app can be reused for another salon (e.g. Asia/Qatar + QAR).

create table public.salon_settings (
  -- "id boolean primary key check (id)" allows exactly one row (id = true).
  id boolean primary key default true check (id),
  name text not null check (length(trim(name)) > 0),
  phone text,
  timezone text not null, -- IANA name, validated by trigger below
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'), -- ISO 4217 code
  slot_interval_minutes int not null default 30 check (slot_interval_minutes = 30),
  booking_window_days int not null check (booking_window_days between 1 and 90),
  min_lead_minutes int not null check (min_lead_minutes between 0 and 1440),
  cancellation_cutoff_minutes int not null check (cancellation_cutoff_minutes between 0 and 10080),
  updated_at timestamptz not null default now(),
  updated_by uuid -- FK to profiles is added in the profiles migration
);

comment on table public.salon_settings is
  'Single row of salon-wide configuration. Read by booking functions at call time.';

-- Validate the timezone (a CHECK constraint cannot query pg_timezone_names)
-- and stamp who/when changed the row.
create function public.salon_settings_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Invalid timezone: %', new.timezone using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger salon_settings_before_write
before insert or update on public.salon_settings
for each row execute function public.salon_settings_before_write();

-- This salon's configuration, inserted as data (not code). Applied to every
-- environment, including the hosted project, because it is part of the schema.
insert into public.salon_settings
  (name, timezone, currency, booking_window_days, min_lead_minutes, cancellation_cutoff_minutes)
values
  ('Barber Salon', 'Asia/Beirut', 'USD', 14, 60, 120);
