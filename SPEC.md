# Salon Booking — App Specification

A barber salon appointment app for iOS and Android. Customers book one or more services with a barber at an available time. Barbers see their daily schedule. An admin manages services, barbers, working hours and blocked time.

> Status: **spec only, no code yet.** Sections marked *Assumption* are choices I made where the requirements left room. Change them before Phase 1 if they don't fit.

---

## 1. Scope

### In scope (v1)
- One salon, one timezone.
- Email + password auth for all roles.
- Customer booking flow: services → barber → date → time → confirm.
- "My appointments", with cancellation of upcoming ones.
- Barber daily schedule.
- Admin management of services, barbers, working hours and blocked time.
- Booking rules enforced in Postgres. Double-booking is impossible even if someone bypasses the app.

### Out of scope (v1, possible later)
- Payments / deposits
- Push / email / SMS reminders
- Rescheduling (for now: cancel, then rebook)
- Multiple salons / locations
- Per-barber service lists (in v1 every barber can do every service)
- Waitlists, reviews, loyalty
- Social login, magic links

---

## 2. Roles

| Role | Who | Can do |
|---|---|---|
| `customer` | Anyone who signs up | Book, view and cancel **their own** appointments |
| `barber` | Staff account made by admin | View **their own** schedule and appointment details |
| `admin` | Salon owner/manager | Everything: manage services, barbers, hours, blocked time, settings. Can see and cancel any appointment |

- Every new sign-up gets the `customer` role. Users can never change their own role.
- Only an admin can create barber accounts and promote people to admin.
- *Assumption:* one account has one role. An owner who also cuts hair gets the `admin` role, and their account is also linked to a `barbers` row, so they show up as a bookable barber and get the barber schedule tab.

---

## 3. Core Business Rules

### 3.1 Services and duration
- Services come from the database: name, duration, price, active flag, sort order.
- Duration must be a **positive multiple of 30 minutes** (enforced with a DB `CHECK`).
- A booking has **one or more** services. Total duration is the sum of their durations (Haircut 30 + Beard 30 = 60 min). Total price is the sum of their prices.
- Prices are stored as **integer minor units** (cents) to avoid floating-point errors. Currency is set in salon settings.
- At booking time, each service's name, duration and price are **copied onto the appointment**. Later edits to a service don't change past or existing bookings.
- Turning a service off (`is_active = false`) hides it from new bookings. Services are never hard-deleted once they've been used.

### 3.2 Booking window
- Customers can book from **today through today + 13 days** (14 calendar days), counted in the **salon's timezone**, not the device's.
- *Assumption:* minimum lead time is **60 minutes**. A slot starting sooner than now + lead time isn't shown. This is configurable in `salon_settings`.

### 3.3 Slot availability
Start times are offered on a **30-minute grid** in salon local time (09:00, 09:30, 10:00, …).

A start time `T` for barber `B` on date `D` with total duration `d` is **available** only if all of these hold:
1. `B` is active and has working hours for `D`'s weekday.
2. `T >= work_start` and `T + d <= work_end`, so the **whole appointment fits** inside working hours.
3. `[T, T + d)` doesn't overlap any **booked** appointment of `B`.
4. `[T, T + d)` doesn't overlap any **time-off block** of `B` (breaks, days off), or any salon-wide closure.
5. `T >= now + min_lead_time`.
6. `D` is inside the booking window.

Intervals are half-open `[start, end)`, so an appointment ending at 10:00 doesn't conflict with one starting at 10:00.

**"Any available barber":** a time is shown if **at least one** active barber can take it. At booking, the server picks the barber (see 3.5). The customer sees who it is on the success screen and in "My appointments".

### 3.4 Double-booking prevention (database level)
Two separate mechanisms:

1. **Postgres exclusion constraint** on `appointments`, which no app bug or race can get around:
   ```
   EXCLUDE USING gist (barber_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
     WHERE (status = 'booked')
   ```
   (needs the `btree_gist` extension). Two booked appointments for the same barber can never overlap. Cancelled appointments don't count, so cancelling frees the slot.
   A second, similar constraint on `customer_id` stops one customer from holding two overlapping appointments.

2. **All writes go through `SECURITY DEFINER` RPC functions.** Customers have **no** direct `INSERT`/`UPDATE` rights on `appointments`. `book_appointment()` checks every rule in 3.3 (working hours, time off, lead time, window, 30-min grid, active services) inside one transaction. It also takes a row lock on the barber (`SELECT … FROM barbers WHERE id = … FOR UPDATE`), so concurrent bookings and time-off inserts for the same barber run one at a time. A constraint can't do cross-table checks like "doesn't overlap a break", so this lock is what makes them safe too.

If two customers tap the same slot at once, one succeeds and the other gets a clean error (`23P01` exclusion violation, or a custom `SLOT_UNAVAILABLE`). The app shows "Sorry, that time was just taken" and reloads the slots.

### 3.5 Auto-assigning a barber ("Any available")
Among the barbers free for the whole interval, pick the one with the **fewest booked minutes that day**. Ties are broken by `barbers.sort_order`. This spreads work fairly and gives predictable results in tests. If the insert hits a conflict, try the next candidate before giving up.

### 3.6 Cancellation
- Customers can cancel their own **upcoming** `booked` appointments.
- *Assumption:* cancellation cutoff is **2 hours** before start (configurable). After that, the app says "please call the salon".
- Admins can cancel any appointment at any time.
- Cancelling sets `status = 'cancelled'` plus `cancelled_at` and `cancelled_by`. Rows are never deleted.

### 3.7 Blocked time vs. existing bookings
- If a new time-off block overlaps existing **booked** appointments, `add_time_off()` **rejects** it and returns the conflicting appointments. The admin can cancel them first, then add the block.
- Working-hours changes don't touch existing appointments. The admin screen warns if future bookings now fall outside the new hours.

### 3.8 Timezones
- **All timestamps** (`starts_at`, `ends_at`, `created_at`, time-off ranges) are `timestamptz`, stored in **UTC**.
- The salon's timezone is stored once as an IANA name (e.g. `Europe/Berlin`) in `salon_settings.timezone`. All display uses it, **whatever the device timezone** is. A customer travelling abroad still sees salon-local times.
- **The one deliberate exception:** weekly **working hours** are stored as local wall-clock `time` values (e.g. `09:00`–`18:00`) plus a weekday. They are recurring rules, not moments in time. Storing them in UTC would make them move by an hour at every DST change. The server turns them into concrete UTC instants for a given date with `(date + time) AT TIME ZONE salon_tz`.
- Slot generation and "what is today" both run on the server in the salon timezone, so the app and DB can't disagree.
- DST edge cases: local times that don't exist (spring-forward gap) are skipped. Ambiguous times (fall-back) use Postgres's standard resolution. Both are covered by tests.

---

## 4. Data Model (Supabase / Postgres)

Extensions: `btree_gist`. Postgres 13+ has `gen_random_uuid()` built in.

### Enums
- `user_role`: `customer | barber | admin`
- `appointment_status`: `booked | cancelled | completed | no_show`

### `salon_settings` (single row)
| Column | Type | Notes |
|---|---|---|
| `id` | `boolean` PK, default `true`, `CHECK (id)` | Forces a single row |
| `name` | `text` | |
| `timezone` | `text` | IANA tz, validated against `pg_timezone_names` |
| `currency` | `char(3)` | e.g. `EUR` |
| `slot_interval_minutes` | `int` | `30`, fixed in v1 |
| `booking_window_days` | `int` | `14` |
| `min_lead_minutes` | `int` | `60` |
| `cancellation_cutoff_minutes` | `int` | `120` |
| `updated_at` | `timestamptz` | |

### `profiles`
One row per auth user, created by a trigger on `auth.users` insert.
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK → `auth.users.id` | `ON DELETE CASCADE` |
| `full_name` | `text` | |
| `phone` | `text` null | Optional, so the salon can call |
| `role` | `user_role` | default `customer`. Users can't update it themselves (column privilege + RLS) |
| `created_at` | `timestamptz` | |

### `barbers`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `profile_id` | `uuid` null, unique → `profiles.id` | Login account. Null until the invite is accepted |
| `display_name` | `text` | |
| `bio` | `text` null | |
| `photo_url` | `text` null | Supabase Storage |
| `is_active` | `boolean` | Inactive barbers aren't bookable |
| `sort_order` | `int` | |
| `created_at` | `timestamptz` | |

### `services`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | |
| `description` | `text` null | |
| `duration_minutes` | `int` | `CHECK (duration_minutes > 0 AND duration_minutes % 30 = 0)` |
| `price_cents` | `int` | `CHECK (price_cents >= 0)` |
| `is_active` | `boolean` | |
| `sort_order` | `int` | |
| `created_at`, `updated_at` | `timestamptz` | |

### `working_hours`
Weekly recurring hours per barber, in **salon local time** (see 3.8).
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `barber_id` | `uuid` → `barbers.id` | |
| `weekday` | `smallint` | `0`=Sunday … `6`=Saturday (matches Postgres `extract(dow)`) |
| `start_time` | `time` | |
| `end_time` | `time` | `CHECK (end_time > start_time)` |

`UNIQUE (barber_id, weekday)`: one shift per day in v1. Lunch breaks are handled as time off. No row for a weekday means the barber doesn't work that day.

### `time_off`
Blocked time: breaks, days off, holidays.
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `barber_id` | `uuid` null → `barbers.id` | **Null = salon-wide closure** (public holiday) |
| `starts_at` | `timestamptz` | UTC |
| `ends_at` | `timestamptz` | `CHECK (ends_at > starts_at)` |
| `reason` | `text` null | "Lunch", "Vacation", … (internal only) |
| `created_by` | `uuid` → `profiles.id` | |
| `created_at` | `timestamptz` | |

Exclusion constraint so one barber's blocks can't overlap each other (keeps the data clean).

*Assumption:* recurring daily breaks (e.g. lunch 13:00–13:30 every day) are added by the admin UI as **a batch of individual rows** ("repeat on these weekdays until date X"). This keeps the DB model simple. A real `recurring_breaks` table can come later.

### `appointments`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `customer_id` | `uuid` → `profiles.id` | |
| `barber_id` | `uuid` → `barbers.id` | |
| `starts_at` | `timestamptz` | UTC |
| `ends_at` | `timestamptz` | `= starts_at + total_duration` |
| `total_duration_minutes` | `int` | Snapshot |
| `total_price_cents` | `int` | Snapshot |
| `status` | `appointment_status` | default `booked` |
| `customer_note` | `text` null | Optional, max ~280 chars |
| `created_at` | `timestamptz` | |
| `cancelled_at` | `timestamptz` null | |
| `cancelled_by` | `uuid` null → `profiles.id` | |

Constraints:
- `CHECK (ends_at > starts_at)`
- `CHECK (ends_at = starts_at + make_interval(mins => total_duration_minutes))`
- `EXCLUDE … barber_id WITH =, tstzrange(starts_at, ends_at) WITH && WHERE (status = 'booked')`
- `EXCLUDE … customer_id WITH =, tstzrange(starts_at, ends_at) WITH && WHERE (status = 'booked')`
- Indexes: `(barber_id, starts_at)`, `(customer_id, starts_at)`

### `appointment_services`
The services in a booking, with values copied at booking time.
| Column | Type | Notes |
|---|---|---|
| `appointment_id` | `uuid` → `appointments.id` | `ON DELETE CASCADE` |
| `service_id` | `uuid` → `services.id` | |
| `service_name` | `text` | Snapshot |
| `duration_minutes` | `int` | Snapshot |
| `price_cents` | `int` | Snapshot |
| `position` | `smallint` | Order in which they're performed |

PK `(appointment_id, service_id)`. A service can appear once per booking.

### Relationships (summary)
```
auth.users 1─1 profiles 1─0..1 barbers
profiles   1─* appointments (as customer)
barbers    1─* appointments, working_hours, time_off
appointments 1─* appointment_services *─1 services
```

---

## 5. Server API (Postgres RPC functions)

Everything the app does that involves rules goes through these. Plain table reads are used only where RLS makes them safe.

| Function | Caller | Purpose |
|---|---|---|
| `get_booking_window()` | any signed-in user | Returns the list of bookable dates (salon-local) and the salon timezone |
| `get_available_slots(service_ids uuid[], barber_id uuid \| null, date date)` | customer | Returns available start times (`timestamptz[]`) using the rules in 3.3. With `barber_id = null`, returns the union over all barbers. Exposes **no** information about other customers |
| `book_appointment(service_ids uuid[], barber_id uuid \| null, starts_at timestamptz, note text)` | customer | Checks everything again, locks, picks a barber if needed, inserts the appointment and its service rows. Returns the appointment |
| `cancel_appointment(appointment_id uuid)` | customer (own, before cutoff) / admin (any) | Sets status to cancelled |
| `get_barber_schedule(date date)` | barber (own) / admin (any barber via param) | Day view: appointments with customer name, phone and services, plus time-off blocks |
| `add_time_off(barber_id, starts_at, ends_at, reason)` | admin | Locks the barber and rejects the block if it overlaps bookings (3.7) |
| `set_working_hours(barber_id, rows jsonb)` | admin | Replaces the barber's weekly hours in one transaction |

**Edge Function** (needs the Supabase service-role key, so it can't run on the device):
- `admin-invite-barber`: checks that the caller is an admin, calls `auth.admin.inviteUserByEmail`, creates/links `profiles` (role `barber`) and `barbers.profile_id`.

Errors come back as stable codes (`SLOT_UNAVAILABLE`, `OUTSIDE_WORKING_HOURS`, `PAST_CUTOFF`, `OUT_OF_WINDOW`, `INVALID_SERVICES`, `NOT_ALLOWED`) that the app maps to friendly messages.

---

## 6. Security (Row Level Security)

RLS is **enabled on every table**. A summary of policies:

| Table | customer | barber | admin |
|---|---|---|---|
| `salon_settings` | read | read | read/write |
| `profiles` | read/update **own** (not `role`) | read own + customers on own appointments | all |
| `services` | read active | read | all |
| `barbers` | read active (public fields) | read | all |
| `working_hours` | — (only through RPC) | read own | all |
| `time_off` | — (only through RPC) | read own | all |
| `appointments` | read **own**. No direct insert/update | read own (as barber) | all |
| `appointment_services` | read for own appointments | read for own appointments | all |

Other rules:
- The app ships only the Supabase **anon** key. The service-role key lives only in Edge Function secrets.
- `.env` holds `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. It's git-ignored, and a `.env.example` is committed.
- `SECURITY DEFINER` functions set `search_path = ''` and check `auth.uid()` and role themselves.
- Supabase Auth: email confirmation on, minimum password length 8, sensible rate limits.
- Session stored with `expo-secure-store` (not plain AsyncStorage).

---

## 7. Screens (Expo Router)

Navigation is role-based. After login, the root layout reads `profiles.role` and redirects to the matching route group.

```
app/
  _layout.tsx                 # Providers (auth, query client), role-based redirect
  (auth)/
    sign-in.tsx
    sign-up.tsx
    forgot-password.tsx
  (customer)/
    _layout.tsx               # Tabs: Book · My appointments · Profile
    book/
      _layout.tsx             # Stack; booking draft kept in context/store
      index.tsx               # 1. Choose services
      barber.tsx              # 2. Choose barber / "Any available"
      time.tsx                # 3. Date strip (14 days) + time-slot grid
      confirm.tsx             # 4. Summary + Book button
      success.tsx             # 5. Booked! (shows assigned barber)
    appointments/
      index.tsx               # Upcoming / Past segmented list
      [id].tsx                # Detail + Cancel
    profile.tsx               # Name, phone, sign out
  (barber)/
    _layout.tsx               # Tabs: Schedule · Profile
    schedule.tsx              # Day timeline, prev/next day, defaults to today
    appointment/[id].tsx      # Customer name/phone, services, note
    profile.tsx
  (admin)/
    _layout.tsx               # Tabs: Today · Services · Barbers · Settings
    today.tsx                 # All barbers' schedules for a day
    services/index.tsx        # List, reorder, active toggle
    services/[id].tsx         # Create/edit (duration picker in 30-min steps)
    barbers/index.tsx
    barbers/[id].tsx          # Profile, active toggle, invite login
    barbers/[id]/hours.tsx    # Weekly hours editor (per weekday on/off + start/end)
    barbers/[id]/time-off.tsx # List + add block (single, full day, or repeating)
    settings.tsx              # Salon name, timezone, lead time, cutoff
```

### Screen details

**Choose services:** checkable list (name, duration, price). A sticky footer shows "2 services · 60 min · €35" and a **Next** button, disabled until at least one service is picked.

**Choose barber:** an "Any available barber" card at the top, then barber cards (photo, name).

**Date & time:** a horizontal strip of 14 days (today first, salon timezone; days with no slots greyed out). Below it, a grid of time buttons in 30-min steps from `get_available_slots`. Loading skeleton while fetching. Empty state: "No times left on this day. Try another date." Changing the date refetches.

**Confirm:** services (each with duration/price), barber (or "Any available, assigned on booking"), date, start–end time, total duration, total price, optional note, **Book** button. The button is disabled while the request runs to avoid double taps. On `SLOT_UNAVAILABLE`, go back to the time screen with a toast and refreshed slots.

**My appointments:** segmented Upcoming / Past. Upcoming = `booked` with `starts_at >= now`, soonest first. Past = everything else, newest first, with a status badge (Completed / Cancelled / No-show). Pull to refresh.

**Appointment detail (customer):** full summary. **Cancel** button with a confirmation dialog, shown only when the appointment is still cancellable (before cutoff). Otherwise shows the cutoff message.

**Barber schedule:** vertical timeline of the selected day inside working hours. Appointments as blocks (time, customer, services), time-off as hatched blocks. Header with ‹ date › and a "Today" shortcut.

**Admin – working hours:** 7 rows (Mon–Sun), each with an on/off switch and start/end pickers in 30-min steps. Saved atomically with `set_working_hours`.

**Admin – time off:** pick barber (or "Whole salon"), date range, start/end time or "all day", reason, optional "repeat weekly on [days] until [date]". Shows conflicts if any.

Every screen has loading, empty and error states and works with large text / screen readers (labels on all time buttons, e.g. "10:30, available").

---

## 8. Tech Stack

| Concern | Choice |
|---|---|
| App | React Native + **Expo** (latest SDK), **TypeScript** strict mode |
| Navigation | **Expo Router** (file-based, typed routes) |
| Backend | **Supabase**: Auth, Postgres, Storage (barber photos), Edge Functions |
| Data fetching | `@supabase/supabase-js` + **TanStack Query** (caching, refetch, loading states) |
| Forms / validation | `react-hook-form` + `zod` |
| Dates / timezones | `date-fns` + `@date-fns/tz` (or `date-fns-tz`), always formatting in the salon tz |
| Types | `supabase gen types typescript` → `src/types/database.ts` |
| Local dev | **Supabase CLI** (local Postgres in Docker), migrations in `supabase/migrations`, seed in `supabase/seed.sql` |
| Testing | **pgTAP** (`supabase test db`) for schema, RLS, constraints, RPCs. **Jest + React Native Testing Library** for app logic and components. **Maestro** for a happy-path E2E booking flow (later phase) |
| Quality | ESLint, Prettier, `tsc --noEmit`, GitHub Actions CI |
| Builds | **EAS Build** (dev client, preview APK/IPA) |

Folder layout (planned):
```
app/                 # Expo Router routes (above)
src/
  components/        # UI building blocks (Button, SlotGrid, ServiceRow…)
  features/          # booking/, appointments/, schedule/, admin/  (hooks + logic)
  lib/               # supabase client, time helpers, error mapping
  types/             # generated DB types
supabase/
  migrations/
  functions/admin-invite-barber/
  tests/             # pgTAP
  seed.sql
```

---

## 9. Testing Strategy

The database is the source of truth, so most of the important tests live there.

**pgTAP (DB):**
- Duration `CHECK` rejects 0, 45, -30. Accepts 30, 60, 90.
- Exclusion constraint: an overlapping booked insert for the same barber fails. Back-to-back (`10:00–10:30` then `10:30–11:00`) succeeds. An overlap with a *cancelled* appointment succeeds.
- `get_available_slots`:
  - a 60-min booking isn't offered at 17:30 when the shift ends at 18:00
  - the slot right before a break is offered only if the full duration fits
  - nothing offered on a day with no working hours, on a time-off day, or outside the 14-day window
  - "Any barber" returns the union
  - DST transition days produce correct UTC instants
- `book_appointment`: rejects outside hours, overlapping a break, in the past, off-grid (10:15), with inactive services. Copies service values correctly. Picks the least-booked barber for "Any".
- `cancel_appointment`: owner before cutoff OK. After cutoff rejected. Another customer rejected. Admin always OK.
- RLS: customer A can't read customer B's appointments. Customer can't insert into `appointments` directly. Customer can't change own `role`.

**Jest (app):** duration/price totals, salon-tz formatting, error-code → message mapping, booking-draft state, slot grid rendering and selection, confirm screen content.

**E2E (Maestro, later):** sign up → book Haircut + Beard → see it in Upcoming → cancel.

Tests are run before every "done", and in CI on every PR.

---

## 10. Build Plan (Phases)

Each phase is a branch + PR with small commits, and ends with its tests passing.

### Phase 0: Project setup
- `git init`, `main` branch, `.gitignore` (incl. `.env`), `.env.example`, README skeleton.
- Expo app (TypeScript, Expo Router), ESLint/Prettier, path aliases.
- Supabase CLI project, local stack running, Jest configured, CI workflow (lint, typecheck, tests).
- **Done when:** app boots on iOS simulator / Android emulator, CI is green.

### Phase 1: Database schema & security
- Migrations: enums, all tables, `CHECK`s, exclusion constraints, indexes, `profiles` trigger.
- RLS policies for every table.
- Seed data: settings, 4 services from the brief, 2–3 barbers with hours, some time off, sample customers.
- pgTAP tests for constraints and RLS.
- **Done when:** `supabase db reset && supabase test db` passes.

### Phase 2: Availability & booking logic (the core)
- `get_booking_window`, `get_available_slots`, `book_appointment`, `cancel_appointment`.
- Barber row locking, "any barber" assignment, error codes.
- Full pgTAP coverage incl. DST and concurrency (two sessions booking the same slot).
- Generate TypeScript types.
- **Done when:** every rule in section 3 has a passing test.

### Phase 3: Auth & app shell
- Supabase client with secure-store session, auth context.
- Sign up / sign in / forgot password screens with validation.
- Role-based redirect into `(customer)`, `(barber)`, `(admin)` groups. Tab layouts with placeholders.
- **Done when:** each seeded role lands in the right area. Sign-out works.

### Phase 4: Customer booking flow
- Services → barber → date/time → confirm → success, with shared booking-draft state.
- Slot grid using the RPC, loading/empty/error states, "slot just taken" handling.
- Component tests for each step.
- **Done when:** a real booking can be made on device and shows up in the DB.

### Phase 5: My appointments
- Upcoming/Past lists, detail screen, cancel with confirmation and cutoff handling.
- **Done when:** cancelling frees the slot (it reappears in the time grid).

### Phase 6: Barber schedule
- Day timeline with appointments and time off, day navigation, appointment detail.
- **Done when:** a barber sees exactly their own bookings for the selected day.

### Phase 7: Admin
- Services CRUD (30-min duration picker, price input, active toggle, reorder).
- Barbers CRUD + `admin-invite-barber` Edge Function.
- Working-hours editor, time-off manager (single/all-day/repeating, conflict display).
- Admin "Today" overview and salon settings.
- **Done when:** the admin can set up a new barber from scratch and they become bookable.

### Phase 8: Polish & portfolio readiness
- Visual design pass (theme, dark mode), accessibility audit, haptics, empty-state illustrations.
- Maestro E2E happy path.
- README with screenshots/GIF, architecture diagram, "how double-booking is prevented" section, local setup steps.
- EAS preview builds for iOS & Android.

### Later (optional)
Push reminders (Expo Notifications + scheduled Edge Function), reschedule, per-barber services, recurring-break table, deposits via Stripe (test mode).

---

## 11. Open Questions

1. **Lead time & cancellation cutoff:** OK with 60 min and 2 h as defaults?
2. **Per-barber services:** fine that every barber does every service in v1?
3. **Customer phone number:** required at sign-up, or optional?
4. **Admin on mobile only,** or is a simple web admin (Expo web) wanted later?
5. **Salon timezone & currency** for the seed data?
6. **Marking appointments completed / no-show:** should barbers do this, or only admins? (Could also be automatic: `booked` + past → shown as completed.)
