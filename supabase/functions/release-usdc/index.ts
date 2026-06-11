// Release USDC on Stellar testnet. FUNDED -> RELEASING -> COMPLETED|FAILED.
// If the distributor's USDC balance is below the order amount, the issuer
// automatically mints the shortfall to the distributor first.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorKeypair, signWithDistributor } from "../_shared/stellar-signer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { safePostLedger } from "../_shared/ledger.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, service);

  // ── AuthN/AuthZ: require a valid JWT and admin role (or service role) ─
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  // Only accept the actual service role key string. Never trust an unverified
  // JWT payload — Supabase verifies real JWTs via auth.getUser() below.
  const isServiceRole = token === service;

  if (!isServiceRole) {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let orderId: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    orderId = body.orderId;
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) throw new Error("STELLAR_USDC_ISSUER not configured");
    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET"); // also controls USDC on testnet


    // Lock: FUNDED -> RELEASING
    const { data: locked, error: lockErr } = await admin
      .from("orders")
      .update({ status: "RELEASING" })
      .eq("id", orderId)
      .eq("status", "FUNDED")
      .select("id, usdc_amount, htg_amount, fee_usdc, usdc_gross, reference_number, customer_id, destination_wallet_address, destination_stellar_address")
      .maybeSingle();
    if (lockErr) throw lockErr;
    if (!locked) {
      return new Response(JSON.stringify({ error: "Order not in FUNDED state" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build & submit Stellar payment
    const server = new Horizon.Server(HORIZON);
    const distributor = distributorKeypair();

    // Resolve destination: order-level override first, then customer's primary wallet
    let dest = (locked.destination_stellar_address ?? locked.destination_wallet_address) as string | null;
    if (!dest) {
      const { data: customer, error: cErr } = await admin
        .from("customers")
        .select("stellar_wallet_address")
        .eq("id", locked.customer_id)
        .maybeSingle();
      if (cErr) throw cErr;
      dest = customer?.stellar_wallet_address ?? null;
    }
    if (!dest || !dest.startsWith("G")) throw new Error("No Stellar destination wallet for this order");
    if (dest === distributor.publicKey()) throw new Error("Destination cannot be the distributor account");

    const usdcAmount = Number(locked.usdc_amount);
    assertWithinLimits(usdcAmount, "USDC release");

    const sourceAccount = await server.loadAccount(distributor.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);

    // ── Pre-flight ledger reconciliation gate ───────────────────────────
    // Compare book DISTRIBUTOR_USDC balance vs live Horizon balance.
    // Hard-block payout on drift > 0.01 USDC when LEDGER_GATE_ENABLED=true.
    const gateEnabled = (Deno.env.get("LEDGER_GATE_ENABLED") ?? "false").toLowerCase() === "true";
    {
      const usdcBalRaw = (sourceAccount.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
        .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
      const chainBal = parseFloat(usdcBalRaw?.balance ?? "0");
      const { data: bookRow } = await admin
        .from("ledger_entries")
        .select("debit, credit, ledger_accounts!inner(code)")
        .eq("ledger_accounts.code", "DISTRIBUTOR_USDC");
      const bookBal = (bookRow ?? []).reduce(
        (sum: number, r: { debit: number; credit: number }) => sum + Number(r.debit) - Number(r.credit),
        0,
      );
      const drift = Math.abs(bookBal - chainBal);
      if (drift > 0.01) {
        const msg = `Ledger drift on DISTRIBUTOR_USDC: book=${bookBal.toFixed(7)} chain=${chainBal.toFixed(7)} delta=${drift.toFixed(7)}`;
        console.warn(`[release-usdc gate] ${msg} (enabled=${gateEnabled})`);
        if (gateEnabled) {
          await admin.from("ledger_posting_failures").insert({
            source: "release-usdc:gate",
            reason: msg,
            payload: { orderId, bookBal, chainBal },
            order_id: orderId,
          });
          await admin.from("orders").update({ status: "FUNDED" }).eq("id", orderId);
          return new Response(JSON.stringify({ error: msg, code: "LEDGER_DRIFT" }), {
            status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // Auto-top-up: if distributor USDC balance < order amount, mint shortfall from issuer
    const usdcBal = (sourceAccount.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>)
      .find((b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer);
    const currentBal = parseFloat(usdcBal?.balance ?? "0");
    const needed = usdcAmount;
    
    if (currentBal < needed) {
      if (!issuerSecret) throw new Error("Distributor USDC insufficient and STELLAR_HTGC_ISSUER_SECRET not set");
      const topUp = (needed - currentBal).toFixed(7); // mint exact shortfall — no buffer
      const issuerKp = Keypair.fromSecret(issuerSecret);
      const issuerAcct = await server.loadAccount(issuerKp.publicKey());
      const mintTx = new TransactionBuilder(issuerAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({ destination: distributor.publicKey(), asset: usdc, amount: topUp }))
        .setTimeout(60)
        .build();
      mintTx.sign(issuerKp);
      await server.submitTransaction(mintTx);
      console.log(`Auto-minted ${topUp} USDC to distributor (was ${currentBal}, needed ${needed})`);
      // Reload distributor account so sequence number is fresh for the next tx
      const refreshed = await server.loadAccount(distributor.publicKey());
      Object.assign(sourceAccount, refreshed);

      // Ledger: mint = external supply increase
      await safePostLedger(admin, "release-usdc:auto-mint", {
        kind: "DISTRIBUTOR_AUTO_MINT",
        description: `Auto-mint ${topUp} USDC to distributor for order ${locked.reference_number}`,
        sourceKey: `release-usdc-mint:${orderId}`,
        entries: [
          { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  Number(topUp) },
          { code: "TREASURY_USDC",    currency: "USDC", credit: Number(topUp) },
        ],
      });
    }

    // Self-heal destination wallet: ensure USDC trustline exists AND is authorized.
    // USDC issuer has AUTH_REQUIRED — without this, payment fails with op_not_authorized.
    {
      const { data: destWallet } = await admin
        .from("wallets")
        .select("stellar_secret")
        .eq("stellar_address", dest)
        .maybeSingle();
      if (destWallet?.stellar_secret) {
        const ready = await ensureWalletReady({
          server,
          address: dest,
          secret: destWallet.stellar_secret,
          usdcIssuer,
          htgcIssuerSecret: Deno.env.get("STELLAR_HTGC_ISSUER_SECRET") ?? undefined,
          usdcIssuerSecret: Deno.env.get("STELLAR_USDC_ISSUER_SECRET") ?? undefined,
        });
        if (!ready.ok) throw new Error(`Destination wallet not ready: ${ready.error}`);
      }
    }

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination: dest, asset: usdc, amount: usdcAmount.toFixed(7) }))
      .addMemo(Memo.text(locked.reference_number.slice(0, 28)))
      .setTimeout(60)
      .build();
    signWithDistributor(tx);

    const result = await server.submitTransaction(tx);
    const hash = (result as { hash: string }).hash;

    const now = new Date().toISOString();
    await admin
      .from("orders")
      .update({ status: "COMPLETED", stellar_tx_hash: hash, released_at: now, completed_at: now, destination_stellar_address: dest })
      .eq("id", orderId);

    // ── Ledger postings ───────────────────────────────────────────────
    let fxTxId: string | null = null;
    let payTxId: string | null = null;
    const failures: string[] = [];
    try {
      const htg    = Number(locked.htg_amount);
      const net    = Number(locked.usdc_amount);
      const fee    = Number(locked.fee_usdc ?? 0);
      const gross  = net + fee;   // always exactly net + fee — do NOT use usdc_gross
      const customerId = locked.customer_id ?? undefined;

      const fxEntries: ({ code: string; currency: "HTG" | "USDC"; debit?: number; credit?: number; customerId?: string })[] = [
        { code: "CUSTOMER_HTG_PENDING",  currency: "HTG",  debit:  htg,   customerId },
        { code: "FX_CLEARING_HTG",       currency: "HTG",  credit: htg },
        { code: "FX_CLEARING_USDC",      currency: "USDC", debit:  gross },
        { code: "CUSTOMER_USDC_PAYABLE", currency: "USDC", credit: net,   customerId },
      ];
      if (fee > 0) fxEntries.push({ code: "FEE_REVENUE_USDC", currency: "USDC", credit: fee });

      const postedBy = isServiceRole ? null : ((globalThis as any).__releaseUsdcUserId ?? null);

      const fxRes = await safePostLedger(admin, "release-usdc:fx", {
        orderId,
        kind: "FX_CONVERSION",
        description: `HTG→USDC conversion for order ${locked.reference_number}`,
        postedBy,
        sourceKey: `orders:${orderId}:FX_CONVERSION`,
        entries: fxEntries,
      }, { stellarTxHash: hash });
      fxTxId = fxRes.txId;

      const payRes = await safePostLedger(admin, "release-usdc:payout", {
        orderId,
        kind: "USDC_PAYOUT",
        description: `USDC released for order ${locked.reference_number}`,
        postedBy,
        sourceKey: `orders:${orderId}:USDC_PAYOUT`,
        entries: [
          { code: "CUSTOMER_USDC_PAYABLE", currency: "USDC", debit:  net, customerId },
          { code: "DISTRIBUTOR_USDC",      currency: "USDC", credit: net             },
        ],
      }, { stellarTxHash: hash });
      payTxId = payRes.txId;

      if (fxRes.error || payRes.error) {
        console.error("[release-usdc] ledger posting failed", {
          fxErr: fxRes.error, payErr: payRes.error,
          fxFailure: fxRes.failureId, payFailure: payRes.failureId,
          orderId,
        });
      }
      if (fxRes.failureId) failures.push(fxRes.failureId);
      if (payRes.failureId) failures.push(payRes.failureId);
    } catch (le) {
      console.error("ledger postings failed (order still COMPLETED)", le);
    }

    return new Response(JSON.stringify({
      ok: true,
      hash,
      ledger: {
        fx: fxTxId,
        payout: payTxId,
        failures,
      },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("release-usdc error", e);
    const msg = (e as { response?: { data?: { extras?: unknown } }; message?: string })?.response?.data
      ? JSON.stringify((e as { response: { data: unknown } }).response.data)
      : (e as Error).message;
    if (orderId) {
      await admin.from("orders")
        .update({ status: "FAILED", failure_reason: String(msg).slice(0, 1000) })
        .eq("id", orderId);
    }
    return new Response(JSON.stringify({ error: String(msg) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
