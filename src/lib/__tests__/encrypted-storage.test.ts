import { webcrypto } from 'node:crypto';

import {
  createEncryptedStorage,
  type Cipher,
  type KeyValueStore,
  type SecretStore,
} from '../encrypted-storage';

// ------------------------------------------------------------ test doubles
/** In-memory AsyncStorage stand-in. */
function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => void data.set(key, value),
    removeItem: async (key) => void data.delete(key),
  };
  return { store, data };
}

/** In-memory SecureStore stand-in that, like iOS, rejects values over 2048 bytes. */
function memorySecrets() {
  const data = new Map<string, string>();
  const secrets: SecretStore = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      if (value.length > 2048) throw new Error('SecureStore: value too large');
      if (!/^[\w.-]+$/.test(key)) throw new Error(`SecureStore: invalid key "${key}"`);
      data.set(key, value);
    },
    delete: async (key) => void data.delete(key),
  };
  return { secrets, data };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/** Real AES-256-GCM (Node webcrypto), same format as expo-crypto: iv(12) | ciphertext | tag(16). */
const nodeCipher: Cipher = {
  async generateKey() {
    return b64(webcrypto.getRandomValues(new Uint8Array(32)));
  },
  async encrypt(plaintextBase64, keyBase64) {
    const key = await webcrypto.subtle.importKey('raw', unb64(keyBase64), 'AES-GCM', false, [
      'encrypt',
    ]);
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, unb64(plaintextBase64)),
    );
    return b64(new Uint8Array([...iv, ...sealed]));
  },
  async decrypt(combinedBase64, keyBase64) {
    const key = await webcrypto.subtle.importKey('raw', unb64(keyBase64), 'AES-GCM', false, [
      'decrypt',
    ]);
    const combined = unb64(combinedBase64);
    const plain = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, 12) },
      key,
      combined.slice(12),
    );
    return b64(new Uint8Array(plain));
  },
};

function setup() {
  const kv = memoryStore();
  const sec = memorySecrets();
  const storage = createEncryptedStorage({
    store: kv.store,
    secrets: sec.secrets,
    cipher: nodeCipher,
  });
  return { storage, kv, sec };
}

/** A realistic large Supabase session (> 2 KB). */
function bigSession(): string {
  return JSON.stringify({
    access_token: 'eyJ' + 'a'.repeat(1200) + '.' + 'b'.repeat(1500) + '.' + 'c'.repeat(342),
    refresh_token: 'r'.repeat(40),
    expires_at: 2_000_000_000,
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'customer@example.com',
      user_metadata: { full_name: 'علي بسام', phone: '+961 70 000 000' },
      app_metadata: { provider: 'email', providers: ['email'] },
      identities: Array.from({ length: 5 }, (_, i) => ({ id: String(i), provider: 'email' })),
    },
  });
}

const KEY = 'sb-127-auth-token';

// ------------------------------------------------------------------ tests
describe('createEncryptedStorage', () => {
  it('round-trips a session larger than 2 KB, including non-ASCII text', async () => {
    const { storage } = setup();
    const session = bigSession();
    expect(session.length).toBeGreaterThan(2048);

    await storage.setItem(KEY, session);
    await expect(storage.getItem(KEY)).resolves.toBe(session);
  });

  it('keeps only a small key in SecureStore and only ciphertext in AsyncStorage', async () => {
    const { storage, kv, sec } = setup();
    const session = bigSession();
    await storage.setItem(KEY, session);

    const secretValues = [...sec.data.values()];
    expect(secretValues).toHaveLength(1);
    expect(secretValues[0].length).toBeLessThan(100); // a 256-bit key in base64

    const stored = kv.data.get(KEY)!;
    expect(stored).toBeDefined();
    expect(stored).not.toContain('access_token');
    expect(stored).not.toContain('customer@example.com');
  });

  it('uses a fresh key for every write', async () => {
    const { storage, sec } = setup();
    await storage.setItem(KEY, 'first');
    const firstKey = [...sec.data.values()][0];
    await storage.setItem(KEY, 'second');
    const secondKey = [...sec.data.values()][0];

    expect(secondKey).not.toBe(firstKey);
    await expect(storage.getItem(KEY)).resolves.toBe('second');
  });

  it('returns null when nothing is stored', async () => {
    const { storage } = setup();
    await expect(storage.getItem(KEY)).resolves.toBeNull();
  });

  it('treats tampered ciphertext as signed out and clears both stores', async () => {
    const { storage, kv, sec } = setup();
    await storage.setItem(KEY, bigSession());

    const stored = kv.data.get(KEY)!;
    const bytes = Buffer.from(stored, 'base64');
    bytes[20] ^= 0xff; // flip bits in the ciphertext
    kv.data.set(KEY, bytes.toString('base64'));

    await expect(storage.getItem(KEY)).resolves.toBeNull();
    expect(kv.data.size).toBe(0);
    expect(sec.data.size).toBe(0);
  });

  it('treats a missing key (e.g. keychain reset) as signed out and clears the ciphertext', async () => {
    const { storage, kv, sec } = setup();
    await storage.setItem(KEY, bigSession());
    sec.data.clear();

    await expect(storage.getItem(KEY)).resolves.toBeNull();
    expect(kv.data.size).toBe(0);
  });

  it('treats a mismatched key (interrupted write) as signed out', async () => {
    const { storage, kv, sec } = setup();
    await storage.setItem(KEY, 'session A');
    const keyName = [...sec.data.keys()][0];
    sec.data.set(keyName, await nodeCipher.generateKey()); // key no longer matches

    await expect(storage.getItem(KEY)).resolves.toBeNull();
    expect(kv.data.size).toBe(0);
    expect(sec.data.size).toBe(0);
  });

  it('removeItem clears both the ciphertext and the key', async () => {
    const { storage, kv, sec } = setup();
    await storage.setItem(KEY, bigSession());
    await storage.removeItem(KEY);

    expect(kv.data.size).toBe(0);
    expect(sec.data.size).toBe(0);
    await expect(storage.getItem(KEY)).resolves.toBeNull();
  });

  it('keeps separate entries apart (session and PKCE code verifier)', async () => {
    const { storage } = setup();
    await storage.setItem(KEY, 'session');
    await storage.setItem(`${KEY}-code-verifier`, 'verifier');

    await expect(storage.getItem(KEY)).resolves.toBe('session');
    await expect(storage.getItem(`${KEY}-code-verifier`)).resolves.toBe('verifier');
  });

  it('uses a SecureStore-safe key name even if the storage key has other characters', async () => {
    const { storage } = setup();
    // SecureStore keys may only contain letters, digits, ".", "-" and "_".
    await expect(storage.setItem('sb:my project/auth token', 'value')).resolves.toBeUndefined();
    await expect(storage.getItem('sb:my project/auth token')).resolves.toBe('value');
  });
});
