import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { signWithSecret } from "../_shared/stellar-signer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    // Auth — verify caller
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Get customer record
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const { sourceWalletId, recipientAddress, recipientName, amount, memo } = body;

    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    if (!recipientAddress?.startsWith("G")) return json({ error: "Valid Stellar recipient address required" }, 400);
    if (!recipientName?.trim()) return json({ error: "recipientName required" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);
    try { assertWithinLimits(parsedAmount, "Payout amount"); }
    catch (e) { return json({ error: (e as Error).message }, 400); }

    // Load source wallet (must belong to this customer)
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret, label")
      .eq("id", sourceWalletId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Source wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    // Create payout record (PENDING)
    const { data: payout, error: payErr } = await admin
      .from("payouts")
      .insert({
        customer_id: customer.id,
        source_wallet_id: wallet.id,
        recipient_name: recipientName.trim(),
        recipient_address: recipientAddress.trim(),
        amount_usdc: parsedAmount,
        memo: memo?.trim() || null,
        status: "PENDING",
      })
      .select("id")
      .single();
    if (payErr) throw payErr;

    // Build and submit Stellar payment
    const server = new Horizon.Server(HORIZON_URL);
    const sourceKp = Keypair.fromSecret(wallet.stellar_secret);
    const sourceAccount = await server.loadAccount(sourceKp.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);

    // ── Pre-flight: ensure recipient has a USDC trust line ────────────────────
    // Check Horizon first (cheap read). If missing, try to auto-heal if the
    // recipient is a Theo-managed wallet. Otherwise surface a clear error.
    try {
      const recipientAccount = await server.loadAccount(recipientAddress.trim());
      const hasTrust = (recipientAccount.balances as { asset_type: string; asset_code?: string; asset_issuer?: string }[])
        .some((b) => b.asset_type !== "native" && b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);

      if (!hasTrust) {
        // Look up the recipient in our wallets table — if we own it, we can fix it
        const { data: recipientWallet } = await admin
          .from("wallets")
          .select("stellar_secret")
          .eq("stellar_address", recipientAddress.trim())
          .maybeSingle();

        if (recipientWallet?.stellar_secret) {
          // Theo-managed wallet — auto-establish trust line silently
          const ready = await ensureWalletReady({
            server,
            address: recipientAddress.trim(),
            secret: recipientWallet.stellar_secret,
            usdcIssuer,
          });
          if (!ready.ok) {
            await admin.from("payouts").update({ status: "FAILED", failure_reason: ready.error }).eq("id", payout.id);
            return json({ error: `Could not establish USDC trust line for recipient: ${ready.error}` }, 502);
          }
        } else {
          // External wallet — we can't sign for them
          await admin.from("payouts").update({
            status: "FAILED",
            failure_reason: "Recipient has no USDC trust line",
          }).eq("id", payout.id);
          return json({
            error: "Recipient wallet has not enabled USDC. Ask them to add USDC to their Stellar wallet before you can send.",
          }, 422);
        }
      }
    } catch (horizonErr: unknown) {
      // loadAccount failed → recipient account doesn't exist on Stellar at all
      const msg = (horizonErr as { response?: { status?: number } })?.response?.status === 404
        ? "Recipient Stellar account does not exist. It needs to be funded with at least 1 XLM first."
        : `Could not verify recipient account: ${(horizonErr as Error).message}`;
      await admin.from("payouts").update({ status: "FAILED", failure_reason: msg }).eq("id", payout.id);
      return json({ error: msg }, 422);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const txBuilder = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    }).addOperation(
      Operation.payment({
        destination: recipientAddress.trim(),
        asset: usdc,
        amount: parsedAmount.toFixed(7),
      })
    );

    if (memo?.trim()) {
      txBuilder.addMemo(Memo.text(memo.trim().slice(0, 28)));
    }

    const tx = txBuilder.setTimeout(60).build();
    signWithSecret(tx, wallet.stellar_secret);

    let hash: string;
    try {
      const result = await server.submitTransaction(tx);
      hash = (result as { hash: string }).hash;
    } catch (stellarErr: unknown) {
      const data = (stellarErr as { response?: { data?: unknown } })?.response?.data as
        | { extras?: { result_codes?: { operations?: string[]; transaction?: string } } }
        | undefined;
      const opCodes = data?.extras?.result_codes?.operations ?? [];
      const msg = data ? JSON.stringify(data) : (stellarErr as Error).message;

      // Friendlier handling for the most common recipient-side failure.
      if (opCodes.includes("op_no_trust")) {
        const friendly =
          "Recipient wallet has not enabled USDC. Ask them to add a USDC trustline on their Stellar wallet before you can send.";
        await admin.from("payouts").update({
          status: "FAILED",
          failure_reason: friendly,
        }).eq("id", payout.id);
        return json({ error: friendly }, 422);
      }

      await admin.from("payouts").update({
        status: "FAILED",
        failure_reason: String(msg).slice(0, 1000),
      }).eq("id", payout.id);

      return json({ error: String(msg) }, 502);
    }

    // Mark COMPLETED
    await admin.from("payouts").update({
      status: "COMPLETED",
      stellar_tx_hash: hash,
      completed_at: new Date().toISOString(),
    }).eq("id", payout.id);

    return json({ ok: true, payoutId: payout.id, hash });

  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
