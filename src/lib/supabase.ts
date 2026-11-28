import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from '@/types/database';

import { readSupabaseEnv } from './env';
import { expoEncryptedStorage } from './expo-encrypted-storage';

// Literal references so Expo inlines them at build time.
const { url, anonKey } = readSupabaseEnv({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    // Encrypted: AES key in SecureStore, ciphertext in AsyncStorage (2 KB limit).
    storage: expoEncryptedStorage,
    persistSession: true,
    autoRefreshToken: true,
    // Deep links are handled explicitly by the reset-password / auth/callback screens.
    detectSessionInUrl: false,
    // Email links return a one-time ?code= instead of tokens in the URL. The
    // code is useless without the verifier stored on this device.
    flowType: 'pkce',
  },
});

// Refresh tokens only while the app is in the foreground (Supabase RN guidance).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
