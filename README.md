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

| Command                | What it does                                                 |
| ---------------------- | ------------------------------------------------------------ |
| `npm start`            | Start the Expo dev server                                    |
| `npm test`             | Run Jest tests                                               |
| `npm run lint`         | Lint with ESLint                                             |
| `npm run typecheck`    | TypeScript check                                             |
| `npm run format`       | Format with Prettier                                         |
| `npm run check`        | Lint + typecheck + format check + tests                      |
| `npm run db:start`     | Start local Supabase (needs Docker)                          |
| `npm run db:test`      | Run database (pgTAP) tests                                   |
| `npm run db:test:race` | Concurrency test: two customers booking "any barber" at once |
| `npm run dev:users`    | Create local customer / barber / admin test accounts         |

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

## Authentication

Email + password with Supabase Auth, using the **PKCE** flow. Email links bring back a one-time `?code=` instead of tokens. That code only works on the device that requested it, because the matching verifier is stored there.

### How the session is stored

`expo-secure-store` (iOS Keychain / Android Keystore) can reject values over about 2 KB, and Supabase sessions are often larger. So the session is **encrypted**:

- Each save generates a fresh AES-256-GCM key with `expo-crypto`.
- The 44-character key goes in SecureStore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: never backed up or moved to another device).
- The ciphertext goes in AsyncStorage.
- If anything doesn't decrypt (tampered data, missing or mismatched key), both entries are deleted and the user is simply signed out.

See `src/lib/encrypted-storage.ts`.

### Routes

| Route                                      | Who                |                                               |
| ------------------------------------------ | ------------------ | --------------------------------------------- |
| `/sign-in`, `/sign-up`, `/forgot-password` | signed out         |                                               |
| `/customer`, `/barber`, `/admin`           | by `profiles.role` | guarded with `Stack.Protected`                |
| `/reset-password`                          | anyone             | deep link from the password-reset email       |
| `/auth/callback`                           | anyone             | deep link from the sign-up confirmation email |

App scheme: `salonbookingapp` (`app.json`). For example, `salonbookingapp://reset-password`.

### Supabase dashboard settings (hosted project)

**Authentication → URL Configuration**

- **Site URL:** `salonbookingapp://`. If the dashboard doesn't accept a custom scheme, use any https page you own. The app always sends an explicit redirect, so this is only a fallback.
- **Redirect URLs:**
  - `salonbookingapp://**`: development builds and the store app.
  - `exp://**`: Expo Go, while developing only. **Remove before release.**

**Authentication → Sign In / Providers → Email**

- **Minimum password length:** 8 (the app and `supabase/config.jsonc` use 8 too).
- **Secure password change:** on.
- **Confirm email:** **OFF on the hosted project during development.** Email flows are tested locally with Mailpit instead (below).
- **Turn Confirm email ON, with custom SMTP, before real users.**

### Email sending limits

Until you configure **custom SMTP** (Authentication → Emails → SMTP Settings; e.g. Resend or Postmark), Supabase's built-in email service:

- sends **only to your organisation's team members' addresses**. Other addresses fail with `email_address_not_authorized`.
- sends **2 emails per hour for the whole project**. Sign-up confirmations and password resets share this. After that you get `429 over_email_send_rate_limit`.

With custom SMTP the limit starts at 30 emails/hour and can be raised under Authentication → Rate Limits.

**Locally there are no limits.** `supabase/config.jsonc` has email confirmation on, and every email lands in **Mailpit at http://127.0.0.1:54324**. Nothing is really sent.

### Local test accounts

```powershell
$env:DEV_USERS_PASSWORD = "choose-a-password"   # 8+ characters, never committed
npm run dev:users
```

This creates or updates `customer@dev.local`, `barber@dev.local` (linked to seed barber Karim) and `admin@dev.local` on the **local** stack only. It refuses any non-local URL.

### `.env` values

- **Hosted:** Project Settings → API (URL + anon key).
- **Local:** `npx supabase status -o env` (`API_URL`, `ANON_KEY`).
- **Phone on your Wi-Fi with the local stack:** use your PC's LAN IP, e.g. `http://192.168.1.20:54321`, because `127.0.0.1` on a phone is the phone itself. Allow the port through Windows Firewall.
- **Android emulator:** `http://10.0.2.2:54321`.

### Testing the email deep links on an iPhone (free, with Expo Go)

Expo Go is free and includes everything auth needs. There's no Apple Developer account, no Mac and no build.

1. Install **Expo Go** from the App Store. Put the phone and the PC on the same Wi-Fi.
2. In `.env`, point the app at a Supabase the phone can reach:
   - **Hosted project (simplest):** your `https://…supabase.co` URL and anon key. Reset emails go to your own (team) address, about 2 per hour.
   - **Local stack:** `http://<PC-LAN-IP>:54321`. See the note on email links below.
3. Start Expo **with a tunnel**:

   ```bash
   npx expo start --tunnel
   ```

   Scan the QR code with the iPhone camera.

   **Why `--tunnel` is required:** without it, Expo Go links look like `exp://192.168.x.x:8081/...`, and **Supabase refuses redirect URLs with an IP address**. It silently falls back to the Site URL, which Expo Go can't open. The tunnel gives a hostname (`exp://xxxx.exp.direct/...`), which `exp://**` allows.

4. In the app, tap **Forgot password?**, enter your email, and send the link.
5. On the iPhone, open the email and tap the link. Safari passes through Supabase, then opens Expo Go on the **Choose a new password** screen.
6. Set a new password. You're signed in and sent to your role's area.

**Using the local stack with a phone:** local emails (in Mailpit) link to `http://127.0.0.1:54321/...`, which a phone can't open. To make them use your LAN IP:

1. Temporarily set `"external_url": "http://<PC-LAN-IP>:54321/auth/v1"` under `auth` in `supabase/config.jsonc` (don't commit it).
2. Run `npm run db:stop` and `npm run db:start`.
3. Open Mailpit on the phone at `http://<PC-LAN-IP>:54324`.

**Store-like testing** of the real `salonbookingapp://` scheme on an iPhone needs an EAS development build. That requires the Apple Developer Program ($99/year), which you'll need for TestFlight and the App Store anyway. EAS builds in the cloud, so no Mac is needed.

## Status

🚧 In development, following the phases in SPEC.md (tracked as GitHub Issues).

## License

[MIT](LICENSE) © Aly Bassam Alwan
