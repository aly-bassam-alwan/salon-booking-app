-- Smoke test: the local database is up, pgTAP works, and the timezones
-- we store in salon_settings are known to Postgres.
begin;
select plan(3);

select ok(
  exists (select 1 from pg_available_extensions where name = 'btree_gist'),
  'btree_gist extension is available (needed for exclusion constraints)'
);
select ok(
  exists (select 1 from pg_timezone_names where name = 'Asia/Beirut'),
  'Asia/Beirut is a valid timezone'
);
select ok(
  exists (select 1 from pg_timezone_names where name = 'Asia/Qatar'),
  'Asia/Qatar is a valid timezone'
);

select * from finish();
rollback;
