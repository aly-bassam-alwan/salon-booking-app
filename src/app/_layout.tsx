import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/features/auth/auth-provider';

// Keep the splash screen up until the stored session (and role) is known,
// so users never see a flash of the sign-in screen.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

/**
 * Role-based access (SPEC §7). A guard that is false makes its screens
 * unreachable; navigating there goes to `index`, which redirects to the
 * right place. The database (RLS) is still the real security boundary.
 */
function RootNavigator() {
  const { isLoading, session, role } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hide();
  }, [isLoading]);

  if (isLoading) return null;

  const signedIn = session !== null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && role === 'customer'}>
        <Stack.Screen name="customer" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === 'barber'}>
        <Stack.Screen name="barber" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && role === 'admin'}>
        <Stack.Screen name="admin" />
      </Stack.Protected>

      {/* Deep links from emails: reachable signed in or out. */}
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}
