import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

import type { UserRole } from './routing';

/** The parts of the Supabase client the provider uses (easy to fake in tests). */
type AuthClient = Pick<typeof supabase, 'auth' | 'from'>;

type AuthContextValue = {
  /** True until the stored session (and, if signed in, the role) is known. */
  isLoading: boolean;
  session: Session | null;
  /** The user's role from `profiles`, or null if it couldn't be loaded. */
  role: UserRole | null;
  roleError: boolean;
  retryRole: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}

type RoleEntry = { userId: string; role: UserRole | null; error: boolean };

export function AuthProvider({
  children,
  client = supabase,
}: {
  children: ReactNode;
  client?: AuthClient;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [roleEntry, setRoleEntry] = useState<RoleEntry | null>(null);
  const [roleAttempt, setRoleAttempt] = useState(0);

  // Restore the stored session, then follow sign-in / sign-out / refresh events.
  useEffect(() => {
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoaded(true);
    });
    // Don't call other Supabase methods inside this callback (Supabase guidance);
    // the role is loaded by the effect below instead.
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionLoaded(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const userId = session?.user.id ?? null;

  // Load the role for the signed-in user. RLS lets users read their own profile.
  useEffect(() => {
    if (!userId) return;
    let active = true;
    client
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        setRoleEntry({ userId, role: error ? null : data.role, error: Boolean(error) });
      });
    return () => {
      active = false;
    };
  }, [client, userId, roleAttempt]);

  // Only trust a role that belongs to the current user (avoids a stale role
  // flashing after switching accounts).
  const current = roleEntry && roleEntry.userId === userId ? roleEntry : null;

  const retryRole = useCallback(() => {
    setRoleEntry(null);
    setRoleAttempt((n) => n + 1);
  }, []);

  const signOut = useCallback(async () => {
    // "local": sign out on this device only.
    await client.auth.signOut({ scope: 'local' });
  }, [client]);

  const value: AuthContextValue = {
    isLoading: !sessionLoaded || (userId !== null && current === null),
    session,
    role: current?.role ?? null,
    roleError: current?.error ?? false,
    retryRole,
    signOut,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
