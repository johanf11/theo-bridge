/**
 * federation — SEP-0002 Stellar Federation Server
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md
 *
 * Resolves aliases like acra*theokingdom.com to their Stellar G... address.
 * This function is PUBLIC — no auth required.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DOMAIN = "theokingdom.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url  = new URL(req.url);
  const q    = url.searchParams.get("q")?.trim();
  const type = url.searchParams.get("type") ?? "name";

  if (!q) return json({ detail: "Missing required parameter: q" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── name lookup: alias*theokingdom.com → G... ────────────────────────────────
  if (type === "name") {
    const parts = q.split("*");
    if (parts.length !== 2 || parts[1] !== DOMAIN) {
      return json({ detail: "Federation address not found" }, 404);
    }
    const alias = parts[0].toLowerCase();

    const { data } = await admin
      .from("federation_addresses")
      .select("stellar_address, memo_type, memo")
      .eq("alias", alias)
      .maybeSingle();

    if (!data) return json({ detail: "Federation address not found" }, 404);

    const result: Record<string, string> = {
      stellar_address: data.stellar_address,
    };
    if (data.memo_type) result.stellar_memo_type = data.memo_type;
    if (data.memo)      result.stellar_memo      = data.memo;

    return json(result);
  }

  // ── id lookup: G... → alias*theokingdom.com ──────────────────────────────────
  if (type === "id") {
    const { data } = await admin
      .from("federation_addresses")
      .select("alias, memo_type, memo")
      .eq("stellar_address", q)
      .maybeSingle();

    // SEP-2 id lookups: always echo the address back so callers don't crash
    // on unknown wallets. Only attach federation_address if we have a mapping.
    const result: Record<string, string> = { stellar_address: q };
    if (data?.alias)     result.federation_address = `${data.alias}*${DOMAIN}`;
    if (data?.memo_type) result.stellar_memo_type  = data.memo_type;
    if (data?.memo)      result.stellar_memo       = data.memo;

    return json(result);
  }


  return json({ detail: `Unsupported type: ${type}` }, 400);
});
