// Withdraw USDC from the yield treasury back to the customer wallet.
// Returns principal + accrued net yield (computed from elapsed time × net APY).
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { blendTreasuryKeypair, signWithBlendTreasury } from "../_shared/stellar-signer.ts";
import { resolveCustomerId } from "../_shared/resolve-customer.ts";
import { safePostLedger } from "../_shared/ledger.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const TREASURY_POOL_ID = "theo-yield-v1";

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
    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({ error: "Customer not found" }, 404);
    const customer = { id: customerId };

    // Enforce org-level permission (Viewer role cannot withdraw from Blend)
    const { checkOrgPermission } = await import("../_shared/resolve-customer.ts");
    const permErr = await checkOrgPermission(admin, user.id, "payout_send");
    if (permErr) return json({ error: permErr }, 403);

    const body = await req.json().catch(() => ({}));
    const { walletId, amount } = body;
    if (!walletId) return json({ error: "walletId required" }, 400);

    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address")
      .eq("id", walletId).eq("customer_id", customer.id).maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);

    const { data: position } = await admin
      .from("blend_positions")
      .select("id, customer_id, wallet_id, deposited_usdc, deposited_at, net_apy")
      .eq("wallet_id", walletId).eq("pool_address", TREASURY_POOL_ID).maybeSingle();
    if (!position) return json({ error: "No yield position for this wallet" }, 404);

    // Compute accrued yield since deposit (continuous compounding).
    const principal = Number(position.deposited_usdc);
    const netApy = Number(position.net_apy);
    const elapsedSec = (Date.now() - new Date(position.deposited_at).getTime()) / 1000;
    const years = elapsedSec / (365 * 24 * 3600);
    const accrued = principal * (Math.exp(netApy * years) - 1);
    const totalAvailable = principal + accrued;

    const isMax = amount === "max" || amount === undefined;
    const requested = isMax ? totalAvailable : parseFloat(amount);
    if (!isMax && (!requested || requested <= 0)) return json({ error: "Valid amount required" }, 400);
    if (requested > totalAvailable + 0.0000001) {
      return json({ error: `Requested ${requested.toFixed(2)} exceeds available ${totalAvailable.toFixed(2)}` }, 400);
    }
    const payoutAmount = Math.min(requested, totalAvailable);

    // On-chain: treasury → customer wallet.
    const server = new Horizon.Server(HORIZON_URL);
    const treasuryKp = blendTreasuryKeypair();
    const treasuryAccount = await server.loadAccount(treasuryKp.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);

    const tx = new TransactionBuilder(treasuryAccount, {
      fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: wallet.stellar_address, asset: usdc, amount: payoutAmount.toFixed(7),
      }))
      .addMemo(Memo.text("theo-yield-withdraw"))
      .setTimeout(60).build();
    signWithBlendTreasury(tx);

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

    // Update or delete position.
    const remaining = totalAvailable - payoutAmount;
    const now = new Date().toISOString();
    if (remaining < 0.01) {
      await admin.from("blend_positions").delete().eq("id", position.id);
    } else {
      await admin.from("blend_positions").update({
        deposited_usdc: remaining,
        deposited_at: now, // restart accrual clock on the remainder
        last_tx_hash: hash,
        last_synced_at: now,
      }).eq("id", position.id);
    }

    await admin.from("payouts").insert({
      customer_id: position.customer_id,
      recipient_name: "Blend Protocol Withdrawal",
      recipient_address: wallet.stellar_address,
      amount_usdc: payoutAmount,
      status: "COMPLETED",
      memo: "blend-withdraw",
      stellar_tx_hash: hash,
      source_wallet_id: position.wallet_id,
      completed_at: now,
      created_at: now,
    });

    // Ledger: principal back to customer + yield split between customer and Theo fee.
    try {
      const principalReturned = Math.min(principal, payoutAmount);
      const yieldReturned = Math.max(0, payoutAmount - principalReturned);
      const BLEND_PLATFORM_FEE_BPS = 200;
      const netApyBps = Math.round(netApy * 10000);
      const theoYieldFee = netApyBps > 0 && yieldReturned > 0
        ? yieldReturned * (BLEND_PLATFORM_FEE_BPS / netApyBps)
        : 0;
      // Ledger: Blend custody → customer wallet.
      // Dr CUSTOMER_BLEND_PAYABLE (Blend liability discharged) / Cr BLEND_DEPOSITS_USDC (asset down).
      // Yield credited as BLEND_YIELD_USDC revenue; Theo's platform fee stays in TREASURY_USDC.
      const cid = position.customer_id;
      const entries: Array<{ code: string; currency: "USDC"; debit?: number; credit?: number; customerId?: string }> = [
        { code: "CUSTOMER_BLEND_PAYABLE", currency: "USDC", debit:  payoutAmount,      customerId: cid },
        { code: "BLEND_DEPOSITS_USDC",    currency: "USDC", credit: principalReturned },
      ];
      if (yieldReturned > 0) {
        entries.push({ code: "BLEND_YIELD_USDC",  currency: "USDC", credit: yieldReturned, customerId: cid });
      }
      if (theoYieldFee > 0) {
        entries.push({ code: "TREASURY_USDC",     currency: "USDC", debit:  theoYieldFee });
        entries.push({ code: "FEE_REVENUE_USDC",  currency: "USDC", credit: theoYieldFee });
      }
      await safePostLedger(admin, "blend-withdraw", {
        kind: "BLEND_WITHDRAW",
        description: `Yield withdrawal ${payoutAmount.toFixed(2)} USDC (net yield ${yieldReturned.toFixed(4)}, Theo fee ${theoYieldFee.toFixed(4)})`,
        sourceKey: `blend-withdraw:${hash}`,
        entries,
      }, { stellarTxHash: hash });
    } catch (e) { console.error("blend-withdraw ledger post failed", e); }

    return json({ ok: true, hash, withdrawn: payoutAmount, accrued });
  } catch (e) {
    console.error("blend-withdraw error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
