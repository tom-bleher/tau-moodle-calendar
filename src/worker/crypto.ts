const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Generates a cryptographically secure URL-safe random token using Web Crypto.
 */
export function generateSecureToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const padLen = (4 - (b64url.length % 4)) % 4;
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(secret)
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts sensitive strings (such as the TAU Moodle authtoken URL) using AES-256-GCM.
 */
export async function encryptText(
  plaintext: string,
  secret: string
): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return `v1.${bytesToBase64Url(combined)}`;
}

/**
 * Decrypts strings encrypted with `encryptText`.
 */
export async function decryptText(
  payload: string,
  secret: string
): Promise<string> {
  if (!payload.startsWith("v1.")) {
    throw new Error("Unsupported encrypted payload format");
  }
  const combined = base64UrlToBytes(payload.slice(3));
  if (combined.length < 13) {
    throw new Error("Corrupted encrypted payload");
  }
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await deriveAesKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return textDecoder.decode(decrypted);
}

/**
 * Constant-time token comparison via SHA-256 hashing + Web Crypto timingSafeEqual (with constant-time XOR fallback).
 */
export async function timingSafeStringEqual(
  a: string,
  b: string
): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(a)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(b)),
  ]);
  const subtleWithTiming = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (
      x: ArrayBuffer | ArrayBufferView,
      y: ArrayBuffer | ArrayBufferView
    ) => boolean;
  };
  if (typeof subtleWithTiming.timingSafeEqual === "function") {
    return subtleWithTiming.timingSafeEqual(ha, hb);
  }
  const ba = new Uint8Array(ha);
  const bb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= ba[i] ^ bb[i];
  }
  return diff === 0;
}
