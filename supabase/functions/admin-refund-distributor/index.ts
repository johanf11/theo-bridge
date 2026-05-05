// One-off admin tool: send USDC from the platform distributor account
// back to a Theo-owned wallet (e.g. Operations) to recover funds stuck after
// a failed swap leg-2.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const distributorSecret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!distributorSecret) return json({ error: "STELLAR_DISTRIBUTOR_SECRET not configured" }, 500);
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const { destinationAddress, amount, memo } = body as { destinationAddress?: string; amount?: string | number; memo?: string };
    if (!destinationAddress || !destinationAddress.startsWith("G")) return json({ error: "destinationAddress required" }, 400);
    const amt = parseFloat(String(amount));
    if (!amt || amt <= 0) return json({ error: "Valid amount required" }, 400);

    const server = new Horizon.Server(HORIZON_URL);
    const kp = Keypair.fromSecret(distributorSecret);
    const account = await server.loadAccount(kp.publicKey());

    const usdc = new Asset("USDC", usdcIssuer);
    const bal = (account.balances as any[]).find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer
    );
    if (!bal || parseFloat(bal.balance) < amt) {
      return json({ error: `Distributor USDC balance ${bal?.balance ?? 0} insufficient for ${amt}` }, 400);
    }

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: destinationAddress, asset: usdc, amount: amt.toFixed(7) }))
      .addMemo(Memo.text((memo ?? "refund").slice(0, 28)))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    const res = await server.submitTransaction(tx);

    return json({ success: true, txHash: res.hash, amount: amt, destination: destinationAddress });
  } catch (e: any) {
    const detail = e?.response?.data?.extras?.result_codes ?? e?.message ?? String(e);
    console.error("admin-refund-distributor error:", detail);
    return json({ error: "Refund failed", detail }, 500);
  }
});
