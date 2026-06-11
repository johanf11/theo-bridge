import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { signWithSecret } from "../_shared/stellar-signer.ts";
import { resolveCustomerId } from "../_shared/resolve-customer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";

type StellarBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
};

const recipientNoTrustMessage = "Recipient wallet has not enabled USDC. Ask them to add a USDC trustline on their Stellar wallet before you can send.";
const recipientUnauthorizedMessage = "Recipient's USDC trustline is not authorized by the issuer yet. The recipient must complete issuer authorization before they can receive USDC.";

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

    // Get customer record — org member takes priority over own row
    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({ error: "Customer not found" }, 404);
    const customer = { id: customerId };

    // Enforce org-level permission (Viewer role cannot send payouts)
    const { checkOrgPermission } = await import("../_shared/resolve-customer.ts");
    const permErr = await checkOrgPermission(admin, user.id, "payout_send");
    if (permErr) return json({ error: permErr }, 403);

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

    // Validate the optional memo by TYPE — never silently truncate or coerce.
    // A wrong-type or cut memo can misroute funds to an exchange irreversibly.
    const memoVal  = (memo ?? "").toString().trim();
    // Require an explicit memoType when a memo is present. Defaulting to "text"
    // would silently misroute a numeric exchange destination tag if the caller
    // omits memoType — funds sent with the wrong type are irreversible.
    if (memoVal && body.memoType == null) {
      return json({ error: "memoType is required when memo is provided. Use 'text' or 'id'." }, 400);
    }
    const memoType = (body.memoType ?? "text").toString().toLowerCase();
    if (memoVal) {
      if (memoType === "id") {
        if (!/^\d+$/.test(memoVal)) return json({ error: "Number (ID) memo must be digits only." }, 400);
        try { if (BigInt(memoVal) > 18446744073709551615n) return json({ error: "Number (ID) memo exceeds the maximum (2^64 − 1)." }, 400); }
        catch { return json({ error: "Invalid Number (ID) memo." }, 400); }
      } else if (memoType === "text") {
        if (new TextEncoder().encode(memoVal).length > 28) {
          return json({ error: "Text memo exceeds 28 bytes. Shorten it, or use a Number (ID) memo if your recipient gave you a number." }, 400);
        }
      } else {
        return json({ error: `Unsupported memo type: ${memoType}` }, 400);
      }
    }

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
        memo: memoVal || null,
        memo_type: memoVal ? memoType : null,
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
      let recipientAccount = await server.loadAccount(recipientAddress.trim());
      const findUsdcTrust = () => (recipientAccount.balances as StellarBalance[])
        .find((b) => b.asset_type !== "native" && b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
      let usdcTrust = findUsdcTrust();

      if (!usdcTrust) {
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
            htgcIssuerSecret: Deno.env.get("STELLAR_HTGC_ISSUER_SECRET") ?? undefined,
            usdcIssuerSecret: Deno.env.get("STELLAR_USDC_ISSUER_SECRET") ?? undefined,
          });
          if (!ready.ok) {
            await admin.from("payouts").update({ status: "FAILED", failure_reason: ready.error }).eq("id", payout.id);
            return json({ error: `Could not establish USDC trust line for recipient: ${ready.error}` }, 502);
          }
          recipientAccount = await server.loadAccount(recipientAddress.trim());
          usdcTrust = findUsdcTrust();
        } else {
          // External wallet — we can't sign for them
          await admin.from("payouts").update({
            status: "FAILED",
            failure_reason: "Recipient has no USDC trust line",
          }).eq("id", payout.id);
          return json({
            ok: false,
            code: "recipient_no_usdc_trustline",
            error: recipientNoTrustMessage,
          });
        }
      }

      if (usdcTrust?.is_authorized === false) {
        // Trust line exists but not yet authorized — Theo auto-authorizes as USDC issuer
        const usdcIssuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
        if (!usdcIssuerSecret) {
          await admin.from("payouts").update({ status: "FAILED", failure_reason: recipientUnauthorizedMessage }).eq("id", payout.id);
          return json({ error: "Recipient USDC trust line is pending authorization. Contact Theo support." }, 422);
        }
        try {
          const issuerKp = Keypair.fromSecret(usdcIssuerSecret);
          const issuerAccount = await server.loadAccount(issuerKp.publicKey());
          const authTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
            .addOperation(Operation.setTrustLineFlags({
              trustor: recipientAddress.trim(),
              asset: usdc,
              flags: { authorized: true },
            }))
            .setTimeout(60)
            .build();
          authTx.sign(issuerKp);
          await server.submitTransaction(authTx);
        } catch (authErr: unknown) {
          const msg = `USDC trust line authorization failed: ${(authErr as Error).message}`;
          await admin.from("payouts").update({ status: "FAILED", failure_reason: msg }).eq("id", payout.id);
          return json({ error: msg }, 502);
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

    // Build the on-chain memo with the correct TYPE (validated above).
    if (memoVal) {
      txBuilder.addMemo(memoType === "id" ? Memo.id(memoVal) : Memo.text(memoVal));
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

      // Friendlier handling for the most common failures.
      if (opCodes.includes("op_no_trust") || opCodes.includes("op_not_authorized")) {
        const friendly = opCodes.includes("op_no_trust")
          ? recipientNoTrustMessage
          : recipientUnauthorizedMessage;
        await admin.from("payouts").update({
          status: "FAILED",
          failure_reason: friendly,
        }).eq("id", payout.id);
        return json({
          ok: false,
          code: opCodes.includes("op_no_trust") ? "recipient_no_usdc_trustline" : "recipient_usdc_trustline_not_authorized",
          error: friendly,
        });
      }

      if (opCodes.includes("op_underfunded")) {
        const friendly = `Insufficient USDC balance in source wallet to send ${parsedAmount} USDC.`;
        await admin.from("payouts").update({
          status: "FAILED",
          failure_reason: friendly,
        }).eq("id", payout.id);
        return json({
          ok: false,
          code: "source_wallet_underfunded",
          error: friendly,
        });
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

    // No double-entry ledger posting here.
    //
    // Theo is non-custodial: USDC sent via this path leaves the *customer's own*
    // Stellar wallet, and the corresponding liability was already discharged on
    // the on-ramp USDC_PAYOUT (Dr CUSTOMER_USDC_PAYABLE / Cr DISTRIBUTOR_USDC).
    // These funds are off Theo's books, so an external send must NOT touch
    // CUSTOMER_USDC_PAYABLE, DISTRIBUTOR_USDC, or any internal account — doing so
    // double-debits the payable and drives it negative.
    //
    // No fee is charged on Stellar USDC payments, so there is no fee-revenue
    // posting either. (Wire payments and cross-mints charge fees on a different
    // path and will post fee revenue there.)
    //
    // The transaction is still tracked: the `payouts` row above records status,
    // amount, recipient, and stellar_tx_hash for reporting/audit.

    return json({ ok: true, payoutId: payout.id, hash });

  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
