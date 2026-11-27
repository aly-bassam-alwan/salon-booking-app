import { useState } from 'react';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';

import { useAuth } from '../auth-provider';

/** Account tab for every role: who is signed in, and sign out. */
export function AccountScreen() {
  const { session, role, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSignOut() {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError('Could not sign out. Please try again.');
      setBusy(false);
    }
  }

  return (
    <FormScreen title="Account">
      <ThemedText>{session?.user.email}</ThemedText>
      {role ? <ThemedText themeColor="textSecondary">Signed in as {role}</ThemedText> : null}
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button title="Sign out" variant="secondary" onPress={onSignOut} loading={busy} />
    </FormScreen>
  );
}
