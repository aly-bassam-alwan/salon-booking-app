/**
 * Supabase connection settings from the environment.
 *
 * Expo inlines EXPO_PUBLIC_* variables at build time, so they must be read
 * with literal `process.env.EXPO_PUBLIC_...` references (see `supabase.ts`).
 * Only the public anon key belongs here, never the service_role key.
 */
export function readSupabaseEnv(env: { url?: string; anonKey?: string }): {
  url: string;
  anonKey: string;
} {
  const hint = 'Copy .env.example to .env and fill in your Supabase project values.';

  if (!env.url) {
    throw new Error(`Missing EXPO_PUBLIC_SUPABASE_URL. ${hint}`);
  }
  if (!/^https?:\/\//.test(env.url)) {
    throw new Error(`EXPO_PUBLIC_SUPABASE_URL must start with http:// or https://. ${hint}`);
  }
  if (!env.anonKey) {
    throw new Error(`Missing EXPO_PUBLIC_SUPABASE_ANON_KEY. ${hint}`);
  }
  return { url: env.url, anonKey: env.anonKey };
}
