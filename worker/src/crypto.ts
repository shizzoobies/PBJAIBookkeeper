// AES-GCM encryption for OAuth tokens at rest.
// Key material = base64(32 bytes) in the TOKEN_ENC_KEY secret.
// Decryption happens only in-Worker, in memory.

const IV_BYTES = 12;

// Per-isolate cache of the imported (non-extractable) key.
let cachedKey: CryptoKey | null = null;
let cachedKeyMaterial: string | null = null;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getKey(base64Key: string): Promise<CryptoKey> {
  if (cachedKey && cachedKeyMaterial === base64Key) return cachedKey;
  const raw = base64ToBytes(base64Key);
  if (raw.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must decode to 32 bytes (got ${raw.length}). Generate with: openssl rand -base64 32`,
    );
  }
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  cachedKey = key;
  cachedKeyMaterial = base64Key;
  return key;
}

export async function encryptToken(plaintext: string, base64Key: string): Promise<string> {
  const key = await getKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return bytesToBase64(combined);
}

export async function decryptToken(payload: string, base64Key: string): Promise<string> {
  const key = await getKey(base64Key);
  const combined = base64ToBytes(payload);
  const iv = combined.subarray(0, IV_BYTES);
  const ciphertext = combined.subarray(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
