-- One profile per auth user. Created automatically on sign-up.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  phone text,
  -- Every sign-up is a customer. Users can never change their own role
  -- (no UPDATE grant on this column, see the RLS migration).
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

alter table public.salon_settings
  add constraint salon_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles (id) on delete set null;

-- Create the profile when a user signs up. Name/phone may come from sign-up
-- metadata; the role is NEVER taken from metadata (the client controls it).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS helper: is the current user an admin?
-- SECURITY DEFINER so policies can call it without recursing into the
-- profiles policies themselves.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Trigger functions are not meant to be called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.salon_settings_before_write() from public, anon, authenticated;
