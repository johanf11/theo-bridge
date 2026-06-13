// One-off admin tool: send USDC from the platform distributor account
// back to a Theo-owned wallet (e.g. Operations) to recover funds stuck after
// a failed swap leg-2.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorKeypair, signWithDistributor } from "../_shared/stellar-signer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { safePostLedger } from "../_shared/ledger.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
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
    try { assertWithinLimits(amt, "Refund amount"); }
    catch (e) { return json({ error: (e as Error).message }, 400); }

    const server = new Horizon.Server(HORIZON_URL);
    const kp = distributorKeypair();
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
    signWithDistributor(tx);
    const res = await server.submitTransaction(tx);

    // Ledger: distributor → external (manual refund). Net effect: USDC leaves Theo.
    await safePostLedger(admin, "admin-refund-distributor", {
      kind: "DISTRIBUTOR_REFUND",
      description: `Manual distributor refund to ${destinationAddress}`,
      postedBy: user.id,
      sourceKey: `admin-refund-distributor:${res.hash}`,
      entries: [
        { code: "EXTERNAL_COUNTERPARTY_FLOW_USDC", currency: "USDC", debit:  amt },
        { code: "DISTRIBUTOR_USDC",   currency: "USDC", credit: amt },
      ],
    }, { stellarTxHash: res.hash });

    return json({ success: true, txHash: res.hash, amount: amt, destination: destinationAddress });
  } catch (e: any) {
    const detail = e?.response?.data?.extras?.result_codes ?? e?.message ?? String(e);
    console.error("admin-refund-distributor error:", detail);
    return json({ error: "Refund failed", detail }, 500);
  }
});
