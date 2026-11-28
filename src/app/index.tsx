import { Redirect } from 'expo-router';

import { Button, FormMessage, FormScreen } from '@/components/form';
import { useAuth } from '@/features/auth/auth-provider';
import { homeHrefForRole } from '@/features/auth/routing';

/** Entry point: send everyone to the right place. */
export default function Index() {
  const { session, role, retryRole, signOut } = useAuth();

  if (!session) return <Redirect href="/sign-in" />;
  if (role) return <Redirect href={homeHrefForRole(role)} />;

  // Signed in, but the profile/role couldn't be loaded (e.g. offline).
  return (
    <FormScreen title="Something went wrong">
      <FormMessage tone="error">
        We couldn&apos;t load your account. Check your connection.
      </FormMessage>
      <Button title="Try again" onPress={retryRole} />
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </FormScreen>
  );
}
