/** Constant-time string equality for secret comparisons (Bearer tokens, API keys). */
export function secretsEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }
  return crypto.timingSafeEqual(aBytes, bBytes);
}
