import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { createEncryptedStorage } from './encrypted-storage';

/**
 * Wires the encrypted session storage to real device storage:
 * AsyncStorage for ciphertext, SecureStore for the key, expo-crypto AES-GCM.
 * The logic itself lives in (and is tested via) `encrypted-storage.ts`.
 */

// Never synced to iCloud/backups and never moved to another device.
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoEncryptedStorage = createEncryptedStorage({
  store: {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  },
  secrets: {
    get: (key) => SecureStore.getItemAsync(key, SECURE_OPTIONS),
    set: (key, value) => SecureStore.setItemAsync(key, value, SECURE_OPTIONS),
    delete: (key) => SecureStore.deleteItemAsync(key, SECURE_OPTIONS),
  },
  cipher: {
    async generateKey() {
      const key = await AESEncryptionKey.generate(256);
      return key.encoded('base64');
    },
    async encrypt(plaintextBase64, keyBase64) {
      const key = await AESEncryptionKey.import(keyBase64, 'base64');
      const sealed = await aesEncryptAsync(plaintextBase64, key);
      return sealed.combined('base64');
    },
    async decrypt(combinedBase64, keyBase64) {
      const key = await AESEncryptionKey.import(keyBase64, 'base64');
      return aesDecryptAsync(AESSealedData.fromCombined(combinedBase64), key, { output: 'base64' });
    },
  },
});
