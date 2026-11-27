-- Extensions and enum types used across the schema.

-- btree_gist lets an exclusion constraint combine "=" on a uuid column with
-- "&&" (overlaps) on a time range. That is what makes double-booking impossible.
create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum ('customer', 'barber', 'admin');

create type public.appointment_status as enum ('booked', 'cancelled', 'completed', 'no_show');
