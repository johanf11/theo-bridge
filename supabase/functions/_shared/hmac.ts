// HMAC-SHA256 helpers (Web Crypto — Deno, not node:crypto).
import { secretsEqual } from "./secret-compare.ts";

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function hmacSignHex(secret: string, message: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

export async function hmacVerifyHex(secret: string, message: string, signature: string): Promise<boolean> {
  const expected = await hmacSignHex(secret, message);
  return secretsEqual(expected, signature);
}
