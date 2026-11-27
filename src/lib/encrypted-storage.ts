/**
 * Encrypted storage for the Supabase session.
 *
 * Why: SecureStore (iOS Keychain / Android Keystore) is the safe place for
 * secrets, but some platforms reject values over ~2048 bytes, and a Supabase
 * session (access token + user JSON) is often larger. So:
 *   - on every write a fresh AES-256-GCM key is generated,
 *   - the value is encrypted and the ciphertext goes to AsyncStorage,
 *   - only the small key (44 chars, base64) goes to SecureStore.
 *
 * GCM is authenticated: tampered data, or a key that doesn't match (e.g. an
 * interrupted write or a keychain reset), fails to decrypt. In that case both
 * entries are removed and `null` is returned, so the user is simply signed
 * out. A corrupt session is never returned and the app never crashes.
 *
 * Dependencies are injected so this logic is unit-tested with real AES-GCM;
 * `expo-encrypted-storage.ts` wires in the Expo modules.
 */

/** AsyncStorage-like store for the ciphertext. */
export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** SecureStore-like store for the encryption key. */
export type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

/** AES-GCM with base64 in and out. Ciphertext is "combined": iv | ciphertext | tag. */
export type Cipher = {
  generateKey(): Promise<string>;
  encrypt(plaintextBase64: string, keyBase64: string): Promise<string>;
  decrypt(combinedBase64: string, keyBase64: string): Promise<string>;
};

/** The storage interface supabase-js expects (`auth.storage`). */
export type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createEncryptedStorage(deps: {
  store: KeyValueStore;
  secrets: SecretStore;
  cipher: Cipher;
}): AuthStorage {
  const { store, secrets, cipher } = deps;

  async function clear(key: string): Promise<void> {
    await Promise.all([store.removeItem(key), secrets.delete(secretKeyName(key))]);
  }

  return {
    async getItem(key) {
      const ciphertext = await store.getItem(key);
      if (ciphertext === null) return null;

      const encryptionKey = await secrets.get(secretKeyName(key));
      if (encryptionKey === null) {
        await clear(key);
        return null;
      }

      try {
        return base64ToUtf8(await cipher.decrypt(ciphertext, encryptionKey));
      } catch {
        // Tampered, corrupt or mismatched: treat as signed out.
        await clear(key);
        return null;
      }
    },

    async setItem(key, value) {
      const encryptionKey = await cipher.generateKey();
      const ciphertext = await cipher.encrypt(utf8ToBase64(value), encryptionKey);
      await secrets.set(secretKeyName(key), encryptionKey);
      await store.setItem(key, ciphertext);
    },

    async removeItem(key) {
      await clear(key);
    },
  };
}

/** SecureStore keys may only contain letters, digits, ".", "-" and "_". */
function secretKeyName(storageKey: string): string {
  return `${storageKey.replace(/[^\w.-]/g, '_')}.key`;
}

/** UTF-8 safe text -> base64 (btoa alone only handles Latin-1). */
function utf8ToBase64(text: string): string {
  const binary = encodeURIComponent(text).replace(/%([0-9A-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(binary);
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  let percentEncoded = '';
  for (let i = 0; i < binary.length; i += 1) {
    percentEncoded += `%${binary.charCodeAt(i).toString(16).padStart(2, '0')}`;
  }
  return decodeURIComponent(percentEncoded);
}
