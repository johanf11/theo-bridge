// Bearer API-key auth for the public Theo API (Odoo plugin, etc.).
// Hashes the presented key, looks it up in public.api_keys, rejects if
// missing/revoked, and returns the owning customer_id + scopes.
//
// This is a NEW shared helper added with explicit approval. It does not
// modify any existing _shared file.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface ApiKeyAuthResult {
  customer_id: string;
  scopes: string[];
  key_id: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Authenticate a request using an `Authorization: Bearer theo_live_…` header.
 *
 * @returns `{ customer_id, scopes }` on success, or an Error with .status if invalid.
 */
export async function authenticateApiKey(
  admin: SupabaseClient,
  req: Request,
  requiredScope?: string,
): Promise<ApiKeyAuthResult | { error: string; status: number }> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return { error: "Missing API key. Use Authorization: Bearer theo_live_…", status: 401 };
  }
  const raw = header.slice(7).trim();
  if (!raw.startsWith("theo_live_") || raw.length < 20) {
    return { error: "Invalid API key format", status: 401 };
  }

  const hashed = await sha256Hex(raw);
  const { data: key } = await admin
    .from("api_keys")
    .select("id, customer_id, scopes, revoked_at")
    .eq("hashed_key", hashed)
    .maybeSingle();

  if (!key || key.revoked_at) {
    return { error: "Invalid or revoked API key", status: 401 };
  }

  const scopes = (key.scopes ?? []) as string[];
  if (requiredScope && !scopes.includes(requiredScope)) {
    return { error: `API key missing required scope: ${requiredScope}`, status: 403 };
  }

  // Best-effort last_used_at bump (don't block on errors)
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => {});

  return {
    customer_id: key.customer_id as string,
    scopes,
    key_id: key.id as string,
  };
}

export async function hashApiKey(raw: string): Promise<string> {
  return sha256Hex(raw);
}

/** Generates a fresh API key: theo_live_ + 32 hex chars. */
export function generateApiKey(): { raw: string; prefix: string; last_four: string } {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = `theo_live_${hex}`;
  return {
    raw,
    prefix: raw.slice(0, 14), // theo_live_xxxx
    last_four: raw.slice(-4),
  };
}
