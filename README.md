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

## Status

🚧 In development, following the phases in SPEC.md (tracked as GitHub Issues).

## License

[MIT](LICENSE) © Aly Bassam Alwan
