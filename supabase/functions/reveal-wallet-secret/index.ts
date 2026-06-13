// Reveal a wallet's stellar_secret to its owner, on-demand.
// Direct column SELECT is revoked from client roles; this function is the
// only path to retrieve a secret outside service_role contexts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const walletId = typeof body?.walletId === "string" ? body.walletId : null;
    if (!walletId) return json({ error: "walletId required" }, 400);

    const admin = createClient(url, service);

    // Confirm caller owns a customer record
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    // Wallet must belong to caller
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_secret")
      .eq("id", walletId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "No signing key stored for this wallet" }, 404);

    // Audit hook (lightweight log; full audit table can replace this later)
    console.log(`reveal-wallet-secret: user=${user.id} wallet=${walletId}`);

    return json({ secret: wallet.stellar_secret });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
