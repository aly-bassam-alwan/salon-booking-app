# Salon Booking App

A barber salon appointment app for iOS and Android, built with **Expo (React Native + TypeScript)**, **Expo Router** and **Supabase**.

Customers pick one or more services, a barber (or "any available"), a date and a free time slot. Barbers see their daily schedule. Admins manage services, barbers, working hours and time off. Double-booking is impossible, enforced by a Postgres exclusion constraint.

See **[SPEC.md](SPEC.md)** for the full specification and build plan.

## Getting started

```bash
npm install
cp .env.example .env   # fill in your Supabase URL and anon key
npm start
```

## Scripts

| Command             | What it does                            |
| ------------------- | --------------------------------------- |
| `npm start`         | Start the Expo dev server               |
| `npm test`          | Run Jest tests                          |
| `npm run lint`      | Lint with ESLint                        |
| `npm run typecheck` | TypeScript check                        |
| `npm run format`    | Format with Prettier                    |
| `npm run check`     | Lint + typecheck + format check + tests |
| `npm run db:start`  | Start local Supabase (needs Docker)     |
| `npm run db:test`   | Run database (pgTAP) tests              |

## Database

Schema, security and booking rules live in `supabase/migrations/`:

| Migration              | What it adds                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `extensions_and_enums` | `btree_gist`, role and status enums                                                                                         |
| `salon_settings`       | Single-row config (timezone, currency, lead time, cutoff, window). This salon: Asia/Beirut, USD                             |
| `profiles`             | One profile per user, created on sign-up (role = customer)                                                                  |
| `core_tables`          | Barbers, services, working hours, time off, appointments, and **exclusion constraints that make double-booking impossible** |
| `rls`                  | Row Level Security on every table                                                                                           |
| `book_appointment`     | The only way to create a booking                                                                                            |

Locally, `npm run db:reset` applies everything plus `supabase/seed.sql` (3 barbers, 4 services, Mon–Sat 09:00–19:00), and `npm run db:test` runs the pgTAP tests.

### Deploying the database to your Supabase project

> **Supabase CLI v3:** `db push` targets the **local** database by default. Add `--remote` to push to your hosted project.

1. Log in and link the project. Your project ref is in the dashboard URL: `supabase.com/dashboard/project/<ref>`. `link` asks for the database password.
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
2. Preview what will run, then apply:
   ```bash
   npx supabase db push --remote --dry-run
   npx supabase db push --remote
   ```
   This applies only the migrations the project has not run yet. Each one is recorded in `supabase_migrations.schema_migrations`.
3. _Optional, demo/dev projects only:_ load the sample barbers and services with `npx supabase db push --remote --include-seed`, or paste `supabase/seed.sql` into the dashboard SQL editor.
4. Sign up once in the app, then make yourself admin in the SQL editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
5. Copy the project URL and **anon** key (Settings → API) into `.env`. Never put the service_role key in the app.

Future schema changes: `npx supabase migration new <name>`, write the SQL, run `npm run db:reset && npm run db:test` locally, then repeat step 2.

## Status

🚧 In development, following the phases in SPEC.md (tracked as GitHub Issues).

## License

[MIT](LICENSE) © Aly Bassam Alwan
