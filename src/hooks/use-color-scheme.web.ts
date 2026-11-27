import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const subscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * The server snapshot returns false and the client snapshot true, so the first (server) render
 * uses 'light' and the client switches to the real scheme after hydration.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
