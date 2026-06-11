/**
 * scheduled-tx — Executes 3 real on-chain Stellar transactions daily for demo.
 *
 *   1. ONRAMP  : HTGC issuer mints HTG-C to Operations wallet (simulates SPIH
 *                receiving HTG cash and issuing HTG-C). Records usdc_conversion order.
 *   2. SWAP    : Operations wallet sends HTG-C → Distributor (leg 1).
 *                Distributor sends USDC → Operations wallet (leg 2).
 *                Records htgc_usdc_swap order.
 *   3. PAYOUT  : Operations wallet sends USDC → Caribe Foods Inc. (or first
 *                saved recipient). Records payout row.
 *
 * Authentication: CRON_SECRET header (set in Supabase Secrets).
 * Schedule: pg_cron daily at 10:00 UTC.
 *
 * Amounts vary ±15% daily via date seed so the chart looks organic.
 * All DB inserts use a reference_number that encodes the date — safe to re-run.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER, TREASURY_PUBLIC } from "../_shared/stellar-assets.ts";
import {
  signWithSecret,
  signWithDistributor,
  distributorPublicKey,
} from "../_shared/stellar-signer.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";
import { safePostLedger } from "../_shared/ledger.ts";

const HORIZON_URL  = "https://horizon-testnet.stellar.org";
const NETWORK      = Networks.TESTNET;
const corsHeaders  = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Seeded RNG (mulberry32) — deterministic per calendar date ────────────────
function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
function dateSeed(d: Date) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function vary(base: number, rng: () => number, pct = 0.15) {
  return Math.round(base * (1 - pct + rng() * pct * 2) * 1e7) / 1e7;
}

// ── Demo customer roster ─────────────────────────────────────────────────────
const DEMO_CUSTOMERS = [
  { name: "Caribbean Import Group S.A.", slug: "cig" },
  { name: "Mache Delma",                slug: "md"  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // ── Auth ─────────────────────────────────────────────────────────────────
  const cronHeader = req.headers.get("x-cron-secret");
  if (!cronHeader || cronHeader !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Config ───────────────────────────────────────────────────────────────
  const supabaseUrl   = Deno.env.get("SUPABASE_URL")!;
  const serviceKey    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const usdcIssuer    = Deno.env.get("STELLAR_USDC_ISSUER");
  const htgcIssuerSec = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
  if (!usdcIssuer)    return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);
  if (!htgcIssuerSec) return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured" }, 500);

  const admin  = createClient(supabaseUrl, serviceKey);
  const server = new Horizon.Server(HORIZON_URL);
  const htgc   = new Asset("HTGC", HTGC_ISSUER);
  const usdc   = new Asset("USDC", usdcIssuer);
  const distPub = distributorPublicKey();
  const issuerKp = Keypair.fromSecret(htgcIssuerSec);

  // Parse body — optional overrides for manual backfill
  // { "date": "2026-05-15" }                     → run all customers for that date
  // { "customer": "Mache Delma", "slug": "md" }  → run just that customer
  let targetDate = new Date();
  let customerOverride: { name: string; slug: string } | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.date)     targetDate = new Date(body.date);
    if (body?.customer) customerOverride = {
      name: body.customer,
      slug: ((body.slug as string | undefined) ?? body.customer).toLowerCase().replace(/[^a-z0-9]/g, ""),
    };
  } catch { /* no body */ }

  const customers = customerOverride ? [customerOverride] : DEMO_CUSTOMERS;
  const dateStr   = targetDate.toISOString().slice(0, 10);
  const allResults: Record<string, unknown> = { date: dateStr, customers: customers.map((c) => c.name) };

  // ── Run for each customer sequentially ──────────────────────────────────
  for (const { name: customerName, slug: customerSlug } of customers) {
    const rng     = seededRng(dateSeed(targetDate) + customerSlug.charCodeAt(0));
    const results: Record<string, unknown> = {};

  // ── Load customer ────────────────────────────────────────────────────────
  // Match company_name OR legal_name (tolerates renames), and take the oldest
  // row if duplicates exist. (.maybeSingle() returns NULL when >1 row matches,
  // which previously caused this customer to be silently skipped.)
  const { data: customerRows, error: custErr } = await admin
    .from("customers")
    .select("id, fee_bps, corridor_bps, user_id, company_name")
    .or(`company_name.eq.${customerName},legal_name.eq.${customerName}`)
    .order("created_at", { ascending: true });
  const customer = customerRows?.[0];
  if (!customer) {
    allResults[customerSlug] = { error: `Customer not found: ${customerName}`, lookupError: custErr?.message ?? null };
    continue;
  }
  if ((customerRows?.length ?? 0) > 1) {
    console.warn(`scheduled-tx: ${customerRows!.length} customer rows match "${customerName}" — using oldest (${customer.id})`);
  }

  // Stamp org member's user_id on all inserts so transactions appear as
  // initiated by that account in the dashboard.
  const { data: orgMember } = await admin
    .from("org_members")
    .select("user_id")
    .eq("customer_id", customer.id)
    .not("accepted_at", "is", null)
    .limit(1)
    .maybeSingle();
  const ownerUserId = orgMember?.user_id ?? customer.user_id ?? null;

  const feeBps = (customer.fee_bps ?? 130) + (customer.corridor_bps ?? 70);

  // Load wallets — pick one date-seeded so re-runs are consistent
  const { data: wallets } = await admin
    .from("wallets")
    .select("id, stellar_address, stellar_secret, label")
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: true });
  if (!wallets?.length) { allResults[customerSlug] = { error: `No wallets found for ${customerName}` }; continue; }

  const wallet = wallets[Math.floor(rng() * wallets.length)];
  if (!wallet.stellar_secret) { allResults[customerSlug] = { error: "Selected wallet has no signing key" }; continue; }

  // Load a recipient for payout
  const { data: recipients } = await admin
    .from("saved_recipients")
    .select("id, name, stellar_address")
    .eq("customer_id", customer.id)
    .limit(1)
    .maybeSingle();

  // Latest spot rate
  const { data: rateRow } = await admin
    .from("rate_snapshots")
    .select("spot_rate")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rate = Number(rateRow?.spot_rate) || 130.5;

  // Reference numbers — slug-scoped so multiple customers can run the same date
  const slugUp    = customerSlug.toUpperCase();
  const dateCompact = dateStr.replace(/-/g, "");
  const onrampRef = `THEO-CNV-SCHED-${slugUp}-${dateCompact}`;
  const swapRef   = `SWP-SCHED-${slugUp}-${dateCompact}`;
  const mintRef   = `THEO-CNV-MINT-${slugUp}-${dateCompact}`;

  // Idempotency: skip if today's scheduled-tx already ran for this customer
  const { data: existing } = await admin
    .from("orders")
    .select("id")
    .eq("reference_number", onrampRef)
    .maybeSingle();
  if (existing) { allResults[customerSlug] = { skipped: true, reason: "Already ran today" }; continue; }

  // ── Ensure wallet trustlines ─────────────────────────────────────────────
  await ensureWalletReady({
    server,
    address: wallet.stellar_address,
    secret:  wallet.stellar_secret,
    usdcIssuer,
    htgcIssuerSecret: htgcIssuerSec,
  });

  // ── STEP 1: ONRAMP ───────────────────────────────────────────────────────
  // Mint HTG-C from issuer → Operations wallet (simulates SPIH fiat deposit)
  const onrampHtgAmount = Math.round(vary(2_000_000, rng)); // ~2M HTG
  const onrampUsdcGross = Math.round((onrampHtgAmount / rate) * 1e7) / 1e7;
  const onrampFeeUsdc   = Math.round(onrampUsdcGross * (feeBps / 10_000) * 1e7) / 1e7;
  const onrampUsdcNet   = Math.round((onrampUsdcGross - onrampFeeUsdc) * 1e7) / 1e7;

  try {
    const issuerAccount = await server.loadAccount(issuerKp.publicKey());
    const mintTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.payment({
        destination: wallet.stellar_address,
        asset: htgc,
        amount: onrampHtgAmount.toFixed(7),
      }))
      .addMemo(Memo.text(onrampRef.slice(0, 28)))
      .setTimeout(60)
      .build();
    mintTx.sign(issuerKp);
    const mintResult = await server.submitTransaction(mintTx);
    const mintHash = (mintResult as { hash: string }).hash;

    const { error: onrampErr } = await admin.from("orders").insert({
      customer_id:      customer.id,
      wallet_id:        wallet.id,
      user_id:          ownerUserId,
      order_kind:       "usdc_conversion",
      status:           "COMPLETED",
      usdc_amount:      onrampUsdcNet,
      htg_amount:       onrampHtgAmount,
      usdc_gross:       onrampUsdcGross,
      fee_usdc:         onrampFeeUsdc,
      fee_bps:          feeBps,
      rate:             Math.round(rate * 1e4) / 1e4,
      reference_number: onrampRef,
      stellar_tx_hash:  mintHash,
      completed_at:     new Date().toISOString(),
    });
    if (onrampErr) console.error("onramp insert error:", onrampErr.message, onrampErr.details, onrampErr.hint);

    // Ledger: SPIH bank receives HTG cash; HTGC_ISSUED liability increases
    await safePostLedger(admin, `sched:onramp:${customerSlug}:${dateStr}`, {
      kind:        "SPIH_CASH_IN",
      description: `Scheduled onramp — SPIH cash-in ${onrampRef}`,
      sourceKey:   `sched:onramp:${customerSlug}:${dateStr}`,
      stellarTxHash: mintHash,
      entries: [
        { code: "SPIH_BANK_HTG", currency: "HTG", debit:  onrampHtgAmount },
        { code: "HTGC_ISSUED",   currency: "HTG", credit: onrampHtgAmount },
      ],
    });

    results.onramp = { ok: true, htgAmount: onrampHtgAmount, usdcNet: onrampUsdcNet, txHash: mintHash, dbErr: onrampErr?.message };
  } catch (e) {
    results.onramp = { ok: false, error: (e as Error).message };
    allResults[customerSlug] = { ...results, aborted: "onramp failed" }; continue;
  }

  // ── STEP 2: SWAP (HTG-C → USDC) ─────────────────────────────────────────
  const swapHtgAmount = Math.round(vary(1_000_000, rng)); // ~1M HTG-C
  const swapUsdcGross = Math.round((swapHtgAmount / rate) * 1e7) / 1e7;
  const swapFeeUsdc   = Math.round(swapUsdcGross * (feeBps / 10_000) * 1e7) / 1e7;
  const swapUsdcNet   = Math.round((swapUsdcGross - swapFeeUsdc) * 1e7) / 1e7;
  let swapHash1: string | null = null;
  let swapHash2: string | null = null;

  try {
    // Leg 1: Operations wallet → Distributor (HTG-C)
    const userAccount = await server.loadAccount(wallet.stellar_address);
    const leg1Tx = new TransactionBuilder(userAccount, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.payment({
        destination: distPub,
        asset: htgc,
        amount: swapHtgAmount.toFixed(7),
      }))
      .addMemo(Memo.text(swapRef.slice(0, 28)))
      .setTimeout(60)
      .build();
    signWithSecret(leg1Tx, wallet.stellar_secret);
    const r1 = await server.submitTransaction(leg1Tx);
    swapHash1 = (r1 as { hash: string }).hash;

    // Leg 2: Distributor → Operations wallet (USDC)
    const distAccount = await server.loadAccount(distPub);
    const leg2Tx = new TransactionBuilder(distAccount, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.payment({
        destination: wallet.stellar_address,
        asset: usdc,
        amount: swapUsdcNet.toFixed(7),
      }))
      .addMemo(Memo.text(swapRef.slice(0, 28)))
      .setTimeout(60)
      .build();
    signWithDistributor(leg2Tx);
    const r2 = await server.submitTransaction(leg2Tx);
    swapHash2 = (r2 as { hash: string }).hash;

    await admin.from("orders").insert({
      customer_id:                customer.id,
      wallet_id:                  wallet.id,
      user_id:                    ownerUserId,
      order_kind:                 "htgc_usdc_swap",
      status:                     "COMPLETED",
      swap_direction:             "htgc_to_usdc",
      usdc_amount:                swapUsdcNet,
      htg_amount:                 swapHtgAmount,
      usdc_gross:                 swapUsdcGross,
      fee_usdc:                   swapFeeUsdc,
      fee_bps:                    feeBps,
      rate:                       Math.round(rate * 1e4) / 1e4,
      reference_number:           swapRef,
      stellar_tx_hash:            swapHash1,
      destination_stellar_address: wallet.stellar_address,
      completed_at:               new Date().toISOString(),
    });

    // Ledger: HTG → USDC swap (mirrors execute-swap htgc_to_usdc pattern)
    // NOTE: No burn step here. Per the treasury model, HTGC returned from swaps
    // accumulates in the distributor buffer for re-use in on-ramp conversions.
    // Burns only occur in Phase 4 (HTG withdrawal) via the withdraw-htgc function,
    // or periodically via an admin burn operation.
    await safePostLedger(admin, `sched:swap:${customerSlug}:${dateStr}`, {
      kind:        "htgc_to_usdc_swap",
      description: `Scheduled swap HTG-C → USDC ${swapRef}`,
      sourceKey:   `sched:swap:${customerSlug}:${dateStr}`,
      stellarTxHash: swapHash2,
      entries: [
        // HTG side: bank pool records the inbound HTG backing; FX clearing tracks obligation
        { code: "SPIH_BANK_HTG",         currency: "HTG",  debit:  swapHtgAmount },
        { code: "FX_CLEARING_HTG",       currency: "HTG",  credit: swapHtgAmount },
        // USDC side: distributor pays out net; fee captured; gross = net + fee
        { code: "CUSTOMER_USDC_PAYABLE", currency: "USDC", debit:  swapUsdcGross, customerId: customer.id },
        { code: "DISTRIBUTOR_USDC",      currency: "USDC", credit: swapUsdcNet  },
        { code: "FEE_REVENUE_USDC",      currency: "USDC", credit: swapFeeUsdc  },
      ],
    });

    results.swap = { ok: true, htgAmount: swapHtgAmount, usdcNet: swapUsdcNet, leg1: swapHash1, leg2: swapHash2 };
  } catch (e) {
    results.swap = { ok: false, error: (e as Error).message };
    // Don't abort — payout might still work if wallet has USDC from before
  }

  // ── STEP 3: PAYOUT ───────────────────────────────────────────────────────
  if (recipients) {
    const payoutAmount = vary(10_000, rng, 0.2); // ~10K USDC ±20%
    const memos = ["Supplier Payment", "Invoice Settlement", "Monthly Transfer", "Trade Finance"];
    const memo  = memos[Math.floor(rng() * memos.length)];

    try {
      const walletAccount = await server.loadAccount(wallet.stellar_address);
      const payTx = new TransactionBuilder(walletAccount, { fee: BASE_FEE, networkPassphrase: NETWORK })
        .addOperation(Operation.payment({
          destination: recipients.stellar_address,
          asset: usdc,
          amount: payoutAmount.toFixed(7),
        }))
        .addMemo(Memo.text(memo.slice(0, 28)))
        .setTimeout(60)
        .build();
      signWithSecret(payTx, wallet.stellar_secret);
      const pr = await server.submitTransaction(payTx);
      const payHash = (pr as { hash: string }).hash;

      await admin.from("payouts").insert({
        customer_id:       customer.id,
        source_wallet_id:  wallet.id,
        user_id:           ownerUserId,
        recipient_name:    recipients.name,
        recipient_address: recipients.stellar_address,
        amount_usdc:       payoutAmount,
        status:            "COMPLETED",
        memo,
        stellar_tx_hash:   payHash,
      });

      // Ledger: USDC leaves distributor to external recipient
      await safePostLedger(admin, `sched:payout:${customerSlug}:${dateStr}`, {
        kind:        "PAYOUT_USDC",
        description: `Scheduled payout to ${recipients.name}`,
        sourceKey:   `sched:payout:${customerSlug}:${dateStr}`,
        stellarTxHash: payHash,
        entries: [
          { code: "CUSTOMER_USDC_PAYABLE",           currency: "USDC", debit:  payoutAmount, customerId: customer.id },
          { code: "EXTERNAL_COUNTERPARTY_FLOW_USDC", currency: "USDC", credit: payoutAmount },
        ],
      });

      results.payout = { ok: true, amount: payoutAmount, recipient: recipients.name, txHash: payHash };
    } catch (e) {
      results.payout = { ok: false, error: (e as Error).message };
    }
  } else {
    results.payout = { ok: false, reason: "No saved recipients configured" };
  }

  // ── STEP 4: USDC AUTO-MINT ─────────────────────────────────────────────
  // Distributor sends ~20K USDC to Operations wallet (simulates daily USDC
  // liquidity provision). Recorded as a usdc_conversion order.
  const mintUsdcAmount = vary(20_000, rng, 0.15); // ~20K USDC ±15%

  try {
    const distAccount2 = await server.loadAccount(distPub);
    const mintUsdcTx = new TransactionBuilder(distAccount2, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(Operation.payment({
        destination: wallet.stellar_address,
        asset: usdc,
        amount: mintUsdcAmount.toFixed(7),
      }))
      .addMemo(Memo.text(mintRef.slice(0, 28)))
      .setTimeout(60)
      .build();
    signWithDistributor(mintUsdcTx);
    const mintUsdcResult = await server.submitTransaction(mintUsdcTx);
    const mintUsdcHash = (mintUsdcResult as { hash: string }).hash;

    const { error: mintOrderErr } = await admin.from("orders").insert({
      customer_id:      customer.id,
      wallet_id:        wallet.id,
      user_id:          ownerUserId,
      order_kind:       "usdc_conversion",
      status:           "COMPLETED",
      usdc_amount:      mintUsdcAmount,
      htg_amount:       Math.round(mintUsdcAmount * rate),
      usdc_gross:       mintUsdcAmount,
      fee_usdc:         0,
      fee_bps:          0,
      rate:             Math.round(rate * 1e4) / 1e4,
      reference_number: mintRef,
      stellar_tx_hash:  mintUsdcHash,
      completed_at:     new Date().toISOString(),
    });
    if (mintOrderErr) {
      console.error("mint order insert error:", mintOrderErr.message, mintOrderErr.details, mintOrderErr.hint);
    }

    // Ledger: scheduled conversion — HTG received, USDC paid out atomically
    const mintHtgAmount = Math.round(mintUsdcAmount * rate);
    await safePostLedger(admin, `sched:usdcmint:${customerSlug}:${dateStr}`, {
      kind:        "SCHEDULED_CONVERSION",
      description: `Scheduled USDC conversion ${mintRef}`,
      sourceKey:   `sched:usdcmint:${customerSlug}:${dateStr}`,
      stellarTxHash: mintUsdcHash,
      entries: [
        { code: "CUSTOMER_HTG_PENDING", currency: "HTG",  debit:  mintHtgAmount, customerId: customer.id },
        { code: "FX_CLEARING_HTG",      currency: "HTG",  credit: mintHtgAmount },
        { code: "FX_CLEARING_USDC",     currency: "USDC", debit:  mintUsdcAmount },
        { code: "DISTRIBUTOR_USDC",     currency: "USDC", credit: mintUsdcAmount },
      ],
    });


    results.usdcMint = { ok: true, usdcAmount: mintUsdcAmount, txHash: mintUsdcHash };
  } catch (e) {
    results.usdcMint = { ok: false, error: (e as Error).message };
  }

    allResults[customerSlug] = results;
  } // end customer loop

  return json({ ok: true, ...allResults });
});
