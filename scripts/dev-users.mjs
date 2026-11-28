// Create (or update) three LOCAL test accounts: a customer, a barber and an admin.
//
//   PowerShell:  $env:DEV_USERS_PASSWORD = "<choose one, 8+ chars>"; npm run dev:users
//   bash:        DEV_USERS_PASSWORD='<choose one>' npm run dev:users
//
// Optional: DEV_CUSTOMER_EMAIL, DEV_BARBER_EMAIL, DEV_ADMIN_EMAIL
// (defaults: customer@dev.local, barber@dev.local, admin@dev.local).
//
// Only ever talks to the local Supabase stack (reads its URL/keys from
// `supabase status`), and refuses anything that isn't 127.0.0.1/localhost.
// No passwords are stored in the repo; you choose one each time.

import { execSync } from 'node:child_process';

import postgres from 'postgres';

// The barber account is linked to this seed barber (supabase/seed.sql: "Karim").
const SEED_BARBER_ID = 'b0000000-0000-4000-8000-000000000001';

function fail(message) {
  console.error(`dev:users: ${message}`);
  process.exit(1);
}

const password = process.env.DEV_USERS_PASSWORD;
if (!password || password.length < 8) {
  fail('set DEV_USERS_PASSWORD to a password of at least 8 characters (see the top of this file).');
}

const accounts = [
  {
    role: 'customer',
    name: 'Dev Customer',
    email: process.env.DEV_CUSTOMER_EMAIL || 'customer@dev.local',
  },
  { role: 'barber', name: 'Dev Barber', email: process.env.DEV_BARBER_EMAIL || 'barber@dev.local' },
  { role: 'admin', name: 'Dev Admin', email: process.env.DEV_ADMIN_EMAIL || 'admin@dev.local' },
];

let status;
try {
  status = Object.fromEntries(
    execSync('npx supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
} catch {
  fail('could not read `supabase status`. Is the local stack running? (npm run db:start)');
}

const { API_URL: apiUrl, SERVICE_ROLE_KEY: serviceKey, DB_URL: dbUrl } = status;
const isLocal = (url) => /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(url ?? '');
if (!isLocal(apiUrl) || !isLocal(dbUrl) || !serviceKey) {
  fail('refusing to run: this script only works against the local Supabase stack.');
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function adminApi(path, init = {}) {
  const res = await fetch(`${apiUrl}/auth/v1/admin${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${path}: ${res.status} ${body.msg ?? body.message ?? ''}`,
    );
  return body;
}

async function upsertUser({ email, name }) {
  const { users } = await adminApi('/users?per_page=1000');
  const existing = users.find((u) => u.email === email);
  const attrs = { password, email_confirm: true, user_metadata: { full_name: name } };
  if (existing) {
    await adminApi(`/users/${existing.id}`, { method: 'PUT', body: JSON.stringify(attrs) });
    return { id: existing.id, created: false };
  }
  const user = await adminApi('/users', {
    method: 'POST',
    body: JSON.stringify({ email, ...attrs }),
  });
  return { id: user.id, created: true };
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
try {
  for (const account of accounts) {
    const { id, created } = await upsertUser(account);
    await sql`update public.profiles set role = ${account.role}, full_name = ${account.name} where id = ${id}`;
    if (account.role === 'barber') {
      await sql`update public.barbers set profile_id = null where profile_id = ${id}`;
      const linked =
        await sql`update public.barbers set profile_id = ${id} where id = ${SEED_BARBER_ID} returning display_name`;
      account.note = linked.length
        ? `linked to seed barber "${linked[0].display_name}"`
        : 'seed barber not found (run npm run db:reset)';
    }
    console.log(
      `${created ? 'created' : 'updated'}  ${account.role.padEnd(8)} ${account.email}${account.note ? `  (${account.note})` : ''}`,
    );
  }
  console.log('\nSign in with these emails and the password you set in DEV_USERS_PASSWORD.');
} catch (error) {
  console.error('dev:users failed:', error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
