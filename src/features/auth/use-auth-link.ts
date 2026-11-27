import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

import { parseAuthRedirect, type AuthRedirect } from './redirect';

const LINK_PARAMS = ['code', 'error', 'error_code', 'error_description'] as const;

/**
 * The auth result carried by the deep link that opened this screen.
 * Query params come from Expo Router; errors in the #fragment only appear in
 * the raw linking URL, so that is checked as a fallback.
 */
export function useAuthRedirect(): AuthRedirect {
  const params = useLocalSearchParams<Partial<Record<(typeof LINK_PARAMS)[number], string>>>();
  const linkingUrl = Linking.useLinkingURL();

  const query = new URLSearchParams();
  for (const name of LINK_PARAMS) {
    const value = params[name];
    if (typeof value === 'string' && value) query.set(name, value);
  }
  const fromParams = parseAuthRedirect(`app://link?${query.toString()}`);
  return fromParams.kind !== 'none' ? fromParams : parseAuthRedirect(linkingUrl);
}

export type CodeExchange =
  { status: 'pending' } | { status: 'ok' } | { status: 'error'; error: unknown };

/**
 * Exchange a PKCE code for a session, exactly once per code (codes are
 * single-use and React may run effects twice in development).
 */
export function useCodeExchange(code: string | null): CodeExchange {
  const [result, setResult] = useState<{ code: string; exchange: CodeExchange } | null>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!code || started.current === code) return;
    started.current = code;
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      setResult({ code, exchange: error ? { status: 'error', error } : { status: 'ok' } });
    });
  }, [code]);

  return result && result.code === code ? result.exchange : { status: 'pending' };
}
