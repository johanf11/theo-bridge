// Sweep USDC from a customer wallet into the yield treasury (the distributor account).
// Yield itself is simulated/accrued off-chain at a configurable APY split (gross vs net).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorPublicKey, signWithSecret } from "../_shared/stellar-signer.ts";
// Internal Blend sweeps are not subject to external single-payment caps; only wallet balance constrains them.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";

// Yield config — single source of truth for the demo.
// Gross 9.00%, customer-facing 7.00%, platform fee 2.00% (200 bps).
const GROSS_APY = 0.09;
const NET_APY = 0.07;
const FEE_BPS = 200;

// Synthetic "pool" identifier so we can keep the existing schema (pool_address column).
const TREASURY_POOL_ID = "theo-yield-v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    let treasuryAddress: string;
    try { treasuryAddress = distributorPublicKey(); }
    catch (e) { return json({ error: (e as Error).message }, 500); }

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: customer } = await admin
      .from("customers").select("id").eq("user_id", user.id).maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { sourceWalletId, amount } = body;
    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);
    // No external single-tx cap on internal Blend sweeps — wallet balance is the only limit.

    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", sourceWalletId).eq("customer_id", customer.id).maybeSingle();
    if (!wallet) return json({ error: "Source wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    // Submit on-chain USDC transfer: customer wallet → treasury.
    const server = new Horizon.Server(HORIZON_URL);
    const sourceKp = Keypair.fromSecret(wallet.stellar_secret);
    const sourceAccount = await server.loadAccount(sourceKp.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: treasuryAddress, asset: usdc, amount: parsedAmount.toFixed(7),
      }))
      .addMemo(Memo.text("theo-yield-sweep"))
      .setTimeout(60)
      .build();
    signWithSecret(tx, wallet.stellar_secret);

    let hash: string;
    try {
      const result = await server.submitTransaction(tx);
      hash = (result as { hash: string }).hash;
    } catch (stellarErr: unknown) {
      const msg = (stellarErr as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((stellarErr as { response: { data: unknown } }).response.data)
        : (stellarErr as Error).message;
      return json({ error: String(msg) }, 502);
    }

    // Upsert position. If one already exists, blend the deposit_at to a weighted avg
    // so the new principal accrues from "now" but the existing pile keeps its head start.
    // Simpler & honest: keep existing accrued separately by recording it into deposited_usdc.
    const { data: existing } = await admin
      .from("blend_positions")
      .select("id, deposited_usdc, deposited_at, net_apy")
      .eq("wallet_id", wallet.id).eq("pool_address", TREASURY_POOL_ID).maybeSingle();

    const now = new Date();
    if (existing) {
      // Capitalize accrued yield so far into principal, then add the new deposit and reset clock.
      const elapsedSec = (now.getTime() - new Date(existing.deposited_at).getTime()) / 1000;
      const years = elapsedSec / (365 * 24 * 3600);
      const accrued = Number(existing.deposited_usdc) * (Math.exp(Number(existing.net_apy) * years) - 1);
      const newPrincipal = Number(existing.deposited_usdc) + accrued + parsedAmount;
      await admin.from("blend_positions").update({
        deposited_usdc: newPrincipal,
        deposited_at: now.toISOString(),
        last_tx_hash: hash,
        last_synced_at: now.toISOString(),
        gross_apy: GROSS_APY,
        net_apy: NET_APY,
        fee_bps: FEE_BPS,
      }).eq("id", existing.id);
    } else {
      await admin.from("blend_positions").insert({
        customer_id: customer.id,
        wallet_id: wallet.id,
        pool_address: TREASURY_POOL_ID,
        reserve_asset: "USDC",
        deposited_usdc: parsedAmount,
        deposited_at: now.toISOString(),
        last_tx_hash: hash,
        last_synced_at: now.toISOString(),
        gross_apy: GROSS_APY,
        net_apy: NET_APY,
        fee_bps: FEE_BPS,
      });
    }

    return json({ ok: true, hash });
  } catch (e) {
    console.error("blend-sweep error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
