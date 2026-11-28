import { router } from 'expo-router';
import { useEffect } from 'react';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';

import { authErrorMessage } from '../auth-errors';
import { useAuthRedirect, useCodeExchange } from '../use-auth-link';

/** Opened from the sign-up confirmation email: salonbookingapp://auth/callback?code=… */
export function AuthCallbackScreen() {
  const redirect = useAuthRedirect();
  const exchange = useCodeExchange(redirect.kind === 'code' ? redirect.code : null);

  useEffect(() => {
    // Signed in: go to the right area for the user's role.
    if (exchange.status === 'ok') router.replace('/');
  }, [exchange.status]);

  if (redirect.kind === 'code' && exchange.status !== 'error') {
    return (
      <FormScreen title="Confirming your email">
        <ThemedText accessibilityLiveRegion="polite">One moment…</ThemedText>
      </FormScreen>
    );
  }

  const message =
    exchange.status === 'error'
      ? authErrorMessage(exchange.error)
      : 'This confirmation link is invalid or has expired. Try signing in, or sign up again.';
  return (
    <FormScreen title="Confirming your email">
      <FormMessage tone="error">{message}</FormMessage>
      <Button title="Go to sign in" onPress={() => router.replace('/sign-in')} />
    </FormScreen>
  );
}
