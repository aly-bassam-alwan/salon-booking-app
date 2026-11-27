# Salon Booking App — project notes for Claude

Barber salon appointment app (iOS + Android). Full product spec: **[SPEC.md](SPEC.md)**. Expo-specific rules: **[AGENTS.md](AGENTS.md)** (read it — Expo APIs change every SDK; check versioned docs, don't trust memory).

## Stack

- React Native + **Expo SDK 58**, **TypeScript** (strict)
- **Expo Router** (file-based routing, typed routes) — routes live in `src/app/`
- **Supabase** — Auth, Postgres, Storage, Edge Functions (from Phase 1)
- TanStack Query, react-hook-form + zod, date-fns + tz (added when needed, via `npx expo install`)
- Testing: **Jest** (`jest-expo` preset) + **React Native Testing Library**; pgTAP for the database (Phase 1+)
- Linting/formatting: **ESLint** (`eslint-config-expo`) + **Prettier**

## Folder structure

```
src/
  app/           # Expo Router routes ONLY (every file = a screen; no tests/helpers here)
  components/    # Reusable UI components
  constants/     # Theme, spacing, fonts
  hooks/         # Shared hooks
  lib/           # Non-UI logic (supabase client, time/format helpers, error mapping)
  __tests__/     # Screen-level tests (unit tests may sit next to code in __tests__/ folders)
assets/          # Images, icons, splash
supabase/        # config.jsonc, migrations/, tests/ (pgTAP), seed.sql; functions/ later
SPEC.md          # Product spec + phased build plan
```

Import alias: `@/*` → `src/*`.

## Commands

```bash
npm start              # Expo dev server (npm run android / ios / web)
npm test               # Jest
npm run test:watch     # Jest in watch mode
npm run lint           # ESLint (expo lint)
npm run format         # Prettier write
npm run format:check   # Prettier check
npm run typecheck      # tsc --noEmit
npm run check          # lint + typecheck + format:check + test

# Supabase (local stack needs Docker running)
npm run db:start       # start local Supabase (first run downloads images)
npm run db:stop        # stop it
npm run db:reset       # re-apply migrations + seed.sql
npm run db:test        # pgTAP tests in supabase/tests
npm run db:types       # regenerate src/types/database.ts after schema changes
```

Before saying a task is done: `npm run check` must pass, plus `npm run db:test` when anything in `supabase/` changed. CI (`.github/workflows/ci.yml`) runs both on every PR.

## Conventions

- Install packages with `npx expo install <pkg>` (SDK-compatible versions), not plain `npm install`.
- Never commit `.env`; only `.env.example`. App uses only the Supabase **anon** key; the service-role key lives only in Edge Function secrets.
- All timestamps stored in UTC; always display in the **salon timezone** (from `salon_settings`), never the device timezone.
- Booking rules are enforced in Postgres (exclusion constraints + RPC functions); the app never inserts appointments directly.
- Prices are integer **minor units** of the salon currency (`price_minor`); format with `Intl.NumberFormat`. Service durations are multiples of 30 min.
- **Never hard-code salon settings** (timezone, currency, lead time, cancellation cutoff, booking window). They live in the single-row `salon_settings` table, are enforced in DB functions, and the app reads them via `get_salon_settings()`.
- One branch + PR per phase/issue; small commits; never commit directly to `main`.
