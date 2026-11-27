-- Local development / demo seed data. Runs after migrations on `supabase db reset`.
-- NOT applied to the hosted project unless you explicitly pass --include-seed.
-- salon_settings is NOT here: it is created by the migrations (it's config).
--
-- No auth users are seeded on purpose (no known passwords in a public repo).
-- Barbers get a login later via the admin "invite barber" flow (Phase 7).

-- Barbers (fixed ids for predictable local testing).
insert into public.barbers (id, display_name, bio, sort_order) values
  ('b0000000-0000-4000-8000-000000000001', 'Karim', 'Classic cuts and hot-towel shaves.', 1),
  ('b0000000-0000-4000-8000-000000000002', 'Omar',  'Fades and modern styles.',           2),
  ('b0000000-0000-4000-8000-000000000003', 'Rami',  'Beard sculpting and colouring.',     3);

-- Services from SPEC.md. Prices are in minor units of salon_settings.currency
-- (USD -> cents): 1500 = $15.00.
insert into public.services (id, name, duration_minutes, price_minor, sort_order) values
  ('5e000000-0000-4000-8000-000000000001', 'Haircut',       30, 1500, 1),
  ('5e000000-0000-4000-8000-000000000002', 'Beard',         30, 1000, 2),
  ('5e000000-0000-4000-8000-000000000003', 'Kids haircut',  30, 1000, 3),
  ('5e000000-0000-4000-8000-000000000004', 'Hair coloring', 60, 3500, 4);

-- Working hours: Monday (1) to Saturday (6), 09:00-19:00 salon local time,
-- for every barber. Sunday (0) has no row = closed.
insert into public.working_hours (barber_id, weekday, start_time, end_time)
select b.id, d.weekday, time '09:00', time '19:00'
from public.barbers b
cross join generate_series(1, 6) as d (weekday);
