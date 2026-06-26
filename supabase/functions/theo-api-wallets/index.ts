// Public Theo API: GET /theo-api-wallets
// Returns every wallet the caller can pay from, with available balance:
//   - Each USDC wallet (live Horizon balance)
//   - A synthetic HTG-C entry (live Horizon HTGC balance, summed across wallets)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateApiKey } from "../_shared/api-key-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

type HBal = { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string };

async function loadBalances(address: string): Promise<{ usdc: number; htgc: number }> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
    if (!res.ok) return { usdc: 0, htgc: 0 };
    const j = await res.json();
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const bals: HBal[] = j.balances ?? [];
    const usdc = bals.find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const htgc = bals.find((b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER);
    return { usdc: usdc ? Number(usdc.balance) : 0, htgc: htgc ? Number(htgc.balance) : 0 };
  } catch {
    return { usdc: 0, htgc: 0 };
  }
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req, { wildcard: true });
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...headers, "Content-Type": "application/json" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = await authenticateApiKey(admin, req, "wallets:read");
  if ("error" in auth) return json({ error: auth.error }, auth.status);

  const { data: wallets } = await admin
    .from("wallets")
    .select("id, label, stellar_address")
    .eq("customer_id", auth.customer_id)
    .order("created_at", { ascending: true });

  const out: Array<{
    id: string;
    label: string;
    currency: "USDC" | "HTGC";
    available_balance: number;
    stellar_address: string;
  }> = [];

  let totalHtgc = 0;
  for (const w of wallets ?? []) {
    const bals = await loadBalances(w.stellar_address);
    totalHtgc += bals.htgc;
    out.push({
      id: w.id,
      label: w.label || "USDC Wallet",
      currency: "USDC",
      available_balance: bals.usdc,
      stellar_address: w.stellar_address,
    });
  }

  if ((wallets ?? []).length > 0) {
    out.push({
      id: `htgc:${auth.customer_id}`,
      label: "HTG Balance",
      currency: "HTGC",
      available_balance: totalHtgc,
      stellar_address: "",
    });
  }

  const totalUsdc = out
    .filter((w) => w.currency === "USDC")
    .reduce((s, w) => s + w.available_balance, 0);

  return json({
    wallets: out,
    totals: {
      usdc: totalUsdc,
      htgc: totalHtgc,
    },
    total_usdc: totalUsdc,
  });
});
