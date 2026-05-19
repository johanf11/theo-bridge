// Real on-chain HTG-C ↔ USDC swap on Stellar testnet.
// Two-leg flow:
//   leg 1: user wallet sends source asset to distributor (signed by stored wallet secret)
//   leg 2: distributor sends destination asset back to user (signed by STELLAR_DISTRIBUTOR_SECRET)
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorPublicKey, signWithDistributor, signWithSecret } from "../_shared/stellar-signer.ts";
import { resolveCustomerId } from "../_shared/resolve-customer.ts";
import { assertWithinLimits } from "../_shared/tx-limits.ts";
import { HTGC_ISSUER, TREASURY_PUBLIC } from "../_shared/stellar-assets.ts";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";
import { safePostLedger } from "../_shared/ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";
type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

const realHtgcBalance = (balances: HorizonBalance[]) => {
  const bal = balances.find(
    (b) => b.asset_type !== "native" && b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER,
  );
  return bal ? Number(bal.balance) : 0;
};

const loadRealHtgcBalance = async (server: Horizon.Server, address: string) => {
  const account = await server.loadAccount(address);
  return realHtgcBalance(account.balances as HorizonBalance[]);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRealHtgcDebit = async (server: Horizon.Server, address: string, before: number, amount: number) => {
  const minExpected = before - amount;
  let latest = before;
  for (let i = 0; i < 6; i++) {
    latest = await loadRealHtgcBalance(server, address);
    if (latest <= minExpected + 0.000001) return { ok: true, latest };
    await sleep(750);
  }
  return { ok: false, latest };
};

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
    const {
      data: { user },
      error: ue,
    } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Customer
    const customerId = await resolveCustomerId(admin, user.id);
    if (!customerId) return json({ error: "Customer not found" }, 404);
    const { data: customer } = await admin
      .from("customers")
      .select("id, fee_bps, corridor_bps")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);
    const theoBps = (customer as { fee_bps?: number | null }).fee_bps ?? 130;
    const corrBps = (customer as { corridor_bps?: number | null }).corridor_bps ?? 70;
    const totalBps = theoBps + corrBps;

    // Body
    const body = await req.json().catch(() => ({}));
    const { wallet_id, amount, direction } = body as {
      wallet_id?: string;
      amount?: number;
      direction?: "htgc_to_usdc" | "usdc_to_htgc";
    };
    if (!wallet_id) return json({ error: "wallet_id required" }, 400);
    if (direction !== "htgc_to_usdc" && direction !== "usdc_to_htgc") {
      return json({ error: "direction must be 'htgc_to_usdc' or 'usdc_to_htgc'" }, 400);
    }
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);
    // Limits are denominated in USDC; convert when source is HTGC.

    // Wallet (must belong to caller, must have signing key)
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", wallet_id)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Wallet has no signing key" }, 400);

    // Latest spot rate
    const { data: rateRow } = await admin
      .from("rate_snapshots")
      .select("spot_rate")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const rate = Number(rateRow?.spot_rate);
    if (!rate || rate <= 0) return json({ error: "No spot rate available" }, 500);

    // Compute legs — use helper so STELLAR_DISTRIBUTOR_SECRET stays in stellar-signer.ts
    const distPubkey = distributorPublicKey();
    const usdc = new Asset("USDC", usdcIssuer);
    const htgc = new Asset("HTGC", HTGC_ISSUER);

    let sourceAsset: Asset;
    let destAsset: Asset;
    let sourceAmount: number;
    let destAmount: number;
    let htgAmount: number;
    let usdcAmount: number;

    if (direction === "htgc_to_usdc") {
      sourceAsset = htgc;
      destAsset = usdc;
      sourceAmount = parsedAmount;
      destAmount = parsedAmount / rate;
      htgAmount = parsedAmount;
      usdcAmount = destAmount;
    } else {
      sourceAsset = usdc;
      destAsset = htgc;
      sourceAmount = parsedAmount;
      destAmount = parsedAmount * rate;
      usdcAmount = parsedAmount;
      htgAmount = destAmount;
    }

    try {
      assertWithinLimits(usdcAmount, "Swap amount");
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }

    const usdcGross = Math.round(usdcAmount * 1e7) / 1e7;
    const feeUsdc = Math.round(usdcGross * (totalBps / 10_000) * 1e7) / 1e7;
    const theoFeeUsdc = Math.round(usdcGross * (theoBps / 10_000) * 1e7) / 1e7;
    const usdcNet = Math.round((usdcGross - feeUsdc) * 1e7) / 1e7;
    // HTG has no cents — convert net USDC once and round to whole gourdes.
    const htgNet = Math.round(usdcNet * rate);
    const leg2Amount = direction === "htgc_to_usdc" ? usdcNet : htgNet;
    // Persisted htg_amount must be NET of fees for usdc_to_htgc; for htgc_to_usdc
    // the user supplied gross HTGC so htgAmount stays as-is.
    if (direction === "usdc_to_htgc") {
      htgAmount = htgNet;
    }

    const server = new Horizon.Server(HORIZON_URL);
    const userKp = Keypair.fromSecret(wallet.stellar_secret);
    let htgcBalanceBeforeLeg1: number | null = null;

    // Self-heal user wallet — guarantees USDC + HTGC trustlines exist and are
    // authorized before any payment runs. Idempotent.
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET") ?? undefined;
    const usdcIssuerSecretEnv = Deno.env.get("STELLAR_USDC_ISSUER_SECRET") ?? undefined;
    {
      const ready = await ensureWalletReady({
        server,
        address: wallet.stellar_address,
        secret: wallet.stellar_secret,
        usdcIssuer,
        htgcIssuerSecret,
        usdcIssuerSecret: usdcIssuerSecretEnv,
      });
      if (!ready.ok) return json({ error: `Wallet not ready: ${ready.error}` }, 502);
    }

    // If swapping HTGC → USDC, ensure the user wallet holds enough HTGC issued by HTGC_ISSUER.
    // If short, mint the shortfall from the HTGC issuer (testnet only, simulates upstream funding).
    if (direction === "htgc_to_usdc") {
      try {
        const have = await loadRealHtgcBalance(server, wallet.stellar_address);
        const shortfall = sourceAmount - have;
        if (shortfall > 0) {
          if (!htgcIssuerSecret) {
            return json(
              {
                error: `Wallet has ${have} HTGC from issuer ${HTGC_ISSUER}, needs ${sourceAmount}. STELLAR_HTGC_ISSUER_SECRET not configured.`,
              },
              400,
            );
          }
          const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
          const issuerAccount = await server.loadAccount(issuerKp.publicKey());
          const mintTx = new TransactionBuilder(issuerAccount, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              Operation.payment({
                destination: wallet.stellar_address,
                asset: htgc,
                amount: shortfall.toFixed(7),
              }),
            )
            .setTimeout(60)
            .build();
          mintTx.sign(issuerKp);
          await server.submitTransaction(mintTx);
        }
        htgcBalanceBeforeLeg1 = await loadRealHtgcBalance(server, wallet.stellar_address);
      } catch (mintErr: unknown) {
        const msg = (mintErr as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((mintErr as { response: { data: unknown } }).response.data)
          : (mintErr as Error).message;
        return json({ error: `HTGC pre-funding failed: ${msg}` }, 502);
      }
    }

    // If swapping USDC → HTGC, ensure the user wallet holds enough USDC.
    // Mint shortfall from the USDC issuer (testnet only).
    if (direction === "usdc_to_htgc") {
      try {
        const acct = await server.loadAccount(wallet.stellar_address);
        const usdcBal = (acct.balances as HorizonBalance[]).find(
          (b) => b.asset_type !== "native" && b.asset_code === "USDC" && b.asset_issuer === usdcIssuer,
        );
        const have = usdcBal ? Number(usdcBal.balance) : 0;
        const shortfall = sourceAmount - have;
        if (shortfall > 0) {
          const usdcIssuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
          if (!usdcIssuerSecret) {
            return json(
              { error: `Wallet has ${have} USDC, needs ${sourceAmount}. STELLAR_USDC_ISSUER_SECRET not configured.` },
              400,
            );
          }
          const issuerKp = Keypair.fromSecret(usdcIssuerSecret);
          const issuerAccount = await server.loadAccount(issuerKp.publicKey());
          const mintTx = new TransactionBuilder(issuerAccount, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              Operation.payment({
                destination: wallet.stellar_address,
                asset: usdc,
                amount: shortfall.toFixed(7),
              }),
            )
            .setTimeout(60)
            .build();
          mintTx.sign(issuerKp);
          await server.submitTransaction(mintTx);
        }
      } catch (mintErr: unknown) {
        const msg = (mintErr as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((mintErr as { response: { data: unknown } }).response.data)
          : (mintErr as Error).message;
        return json({ error: `USDC pre-funding failed: ${msg}` }, 502);
      }
    }

    const reference = `SWP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // ── LEG 1: user → distributor ──────────────────────────────────────────
    // Leg 1 destination: USDC inbound → Treasury; HTGC inbound → Distributor
    const leg1Destination = direction === "usdc_to_htgc" ? TREASURY_PUBLIC : distPubkey;
    let leg1Hash: string;
    try {
      const userAccount = await server.loadAccount(userKp.publicKey());
      const tx1 = new TransactionBuilder(userAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: leg1Destination,
            asset: sourceAsset,
            amount: sourceAmount.toFixed(7),
          }),
        )
        .addMemo(Memo.text(reference.slice(0, 28)))
        .setTimeout(60)
        .build();
      signWithSecret(tx1, wallet.stellar_secret);
      const r1 = await server.submitTransaction(tx1);
      leg1Hash = (r1 as { hash: string }).hash;
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      return json({ error: `Leg 1 (user → distributor) failed: ${msg}` }, 502);
    }

    if (direction === "htgc_to_usdc") {
      const before = htgcBalanceBeforeLeg1 ?? (await loadRealHtgcBalance(server, wallet.stellar_address));
      const debit = await waitForRealHtgcDebit(server, wallet.stellar_address, before, sourceAmount);
      if (!debit.ok) {
        return json(
          {
            error: `Leg 1 safety check failed: real HTGC balance did not decrease by ${sourceAmount.toFixed(7)}. USDC payout aborted.`,
            leg1Hash,
            before,
            after: debit.latest,
            issuer: HTGC_ISSUER,
          },
          502,
        );
      }
    }

    // ── LEG 2: deliver destination asset to user ───────────────────────────
    // usdc_to_htgc: HTGC issuer mints HTG-C directly (unlimited supply)
    // htgc_to_usdc: Distributor sends USDC to the user
    let leg2Hash: string | null = null;
    let leg2Error: string | null = null;
    try {
      let tx2;
      if (direction === "usdc_to_htgc") {
        const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
        if (!htgcIssuerSecret) throw new Error("STELLAR_HTGC_ISSUER_SECRET not configured");
        const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
        const issuerAccount = await server.loadAccount(issuerKp.publicKey());
        tx2 = new TransactionBuilder(issuerAccount, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: wallet.stellar_address,
              asset: htgc,
              amount: leg2Amount.toFixed(7),
            }),
          )
          .addMemo(Memo.text(reference.slice(0, 28)))
          .setTimeout(60)
          .build();
        tx2.sign(issuerKp);
      } else {
        const distAccount = await server.loadAccount(distPubkey);
        tx2 = new TransactionBuilder(distAccount, {
          fee: BASE_FEE,
          networkPassphrase: Networks.TESTNET,
        })
          .addOperation(
            Operation.payment({
              destination: wallet.stellar_address,
              asset: usdc,
              amount: leg2Amount.toFixed(7),
            }),
          )
          .addMemo(Memo.text(reference.slice(0, 28)))
          .setTimeout(60)
          .build();
        signWithDistributor(tx2);
      }
      const r2 = await server.submitTransaction(tx2);
      leg2Hash = (r2 as { hash: string }).hash;
    } catch (e: unknown) {
      leg2Error = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
    }

    // ── COMPENSATING REFUND: if leg 2 failed, return leg-1 funds to user ───
    let refundHash: string | null = null;
    let refundError: string | null = null;
    if (leg2Hash === null) {
      try {
        // Refund originates from whichever account received Leg 1 funds.
        // usdc_to_htgc → Treasury (signed with STELLAR_TREASURY_SECRET)
        // htgc_to_usdc → Distributor (signed with STELLAR_DISTRIBUTOR_SECRET)
        const refundMemo = `${reference}-RFND`.slice(0, 28);
        let txR;
        if (direction === "usdc_to_htgc") {
          const treasurySecret = Deno.env.get("STELLAR_TREASURY_SECRET");
          if (!treasurySecret) throw new Error("STELLAR_TREASURY_SECRET not configured");
          const treasuryKp = Keypair.fromSecret(treasurySecret);
          const treasuryAccount = await server.loadAccount(TREASURY_PUBLIC);
          txR = new TransactionBuilder(treasuryAccount, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              Operation.payment({
                destination: wallet.stellar_address,
                asset: sourceAsset,
                amount: sourceAmount.toFixed(7),
              }),
            )
            .addMemo(Memo.text(refundMemo))
            .setTimeout(60)
            .build();
          txR.sign(treasuryKp);
        } else {
          const distAccount = await server.loadAccount(distPubkey);
          txR = new TransactionBuilder(distAccount, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
          })
            .addOperation(
              Operation.payment({
                destination: wallet.stellar_address,
                asset: sourceAsset,
                amount: sourceAmount.toFixed(7),
              }),
            )
            .addMemo(Memo.text(refundMemo))
            .setTimeout(60)
            .build();
          signWithDistributor(txR);
        }
        const rR = await server.submitTransaction(txR);
        refundHash = (rR as { hash: string }).hash;
        console.log(`Auto-refund OK ${reference}: ${refundHash}`);
      } catch (e: unknown) {
        refundError = (e as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((e as { response: { data: unknown } }).response.data)
          : (e as Error).message;
        console.error(`AUTO-REFUND FAILED ${reference}:`, refundError);
      }
    }

    // Persist order
    const completed = leg2Hash !== null;
    const now = new Date().toISOString();
    let failureReason: string | null = null;
    if (!completed) {
      if (refundHash) {
        failureReason = `Leg 2 failed: ${leg2Error?.slice(0, 600)}. Auto-refunded leg 1 to user wallet in tx ${refundHash}.`;
      } else {
        failureReason = `Leg 2 failed: ${leg2Error?.slice(0, 500)}. AUTO-REFUND ALSO FAILED: ${refundError?.slice(0, 300)}. MANUAL INTERVENTION REQUIRED — funds held at distributor.`;
      }
    }
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .insert({
        customer_id: customer.id,
        order_kind: "htgc_usdc_swap",
        swap_direction: direction,
        status: completed ? "COMPLETED" : "FAILED",
        htg_amount: htgAmount,
        usdc_amount: direction === "htgc_to_usdc" ? usdcNet : usdcAmount,
        usdc_gross: usdcGross,
        fee_usdc: feeUsdc,
        theo_fee_usdc: theoFeeUsdc,
        fee_bps: totalBps,
        theo_fee_bps: theoBps,
        corridor_bps: corrBps,
        rate,
        spot_rate: rate,
        reference_number: reference,
        destination_stellar_address: wallet.stellar_address,
        destination_wallet_address: wallet.stellar_address,
        stellar_tx_hash: leg2Hash ?? refundHash ?? leg1Hash,
        quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
        funded_at: now,
        released_at: completed ? now : null,
        completed_at: completed ? now : null,
        failure_reason: failureReason,
      })
      .select("id")
      .single();
    if (orderErr) {
      return json(
        { error: `Swap submitted on-chain but failed to persist: ${orderErr.message}`, leg1Hash, leg2Hash, refundHash },
        500,
      );
    }

    // ── LEDGER POSTING ──────────────────────────────────────────────────────
    // Only post on success; failed/refunded swaps produce no journal entry.
    if (completed) {
      if (direction === "htgc_to_usdc") {
        await safePostLedger(admin, "execute-swap", {
          orderId:     order.id,
          kind:        "htgc_to_usdc_swap",
          description: `HTG-C → USDC swap ${reference}`,
          postedBy:    user.id,
          sourceKey:   `swap:${order.id}`,
          entries: [
            // HTG side: deposit lands in SPIH pool; FX clearing tracks the obligation
            { code: "SPIH_BANK_HTG",           currency: "HTG",  debit:  htgAmount },
            { code: "FX_CLEARING_HTG",          currency: "HTG",  credit: htgAmount },
            // USDC side: Dr gross = Cr net + Cr fee
            { code: "DISTRIBUTOR_USDC",         currency: "USDC", credit: usdcNet                          },
            { code: "CUSTOMER_USDC_PAYABLE",    currency: "USDC", debit:  usdcGross, customerId: customer.id },
            { code: "FEE_REVENUE_USDC",         currency: "USDC", credit: feeUsdc                           },
          ],
        }, { stellarTxHash: leg2Hash });
      } else {
        // usdc_to_htgc: customer receives HTGC backed by HTG leaving the SPIH pool
        await safePostLedger(admin, "execute-swap", {
          orderId:     order.id,
          kind:        "usdc_to_htgc_swap",
          description: `USDC → HTG-C swap ${reference}`,
          postedBy:    user.id,
          sourceKey:   `swap:${order.id}`,
          entries: [
            // USDC side (balanced: usdcNet + feeUsdc = usdcGross)
            { code: "TREASURY_USDC",            currency: "USDC", debit:  usdcGross                          },
            { code: "CUSTOMER_USDC_PAYABLE",    currency: "USDC", credit: usdcNet,   customerId: customer.id },
            { code: "FEE_REVENUE_USDC",         currency: "USDC", credit: feeUsdc                            },
            // HTG side: FX clearing discharged; HTG leaves SPIH pool
            { code: "FX_CLEARING_HTG",          currency: "HTG",  debit:  htgNet   },
            { code: "SPIH_BANK_HTG",            currency: "HTG",  credit: htgNet   },
          ],
        }, { stellarTxHash: leg2Hash });
      }
    }

    if (!completed) {
      if (refundHash) {
        return json(
          {
            error: `Swap couldn't complete — your funds were returned to your wallet.`,
            orderId: order.id,
            leg1Hash,
            refundHash,
            refunded: true,
            detail: leg2Error,
          },
          502,
        );
      }
      return json(
        {
          error: `Swap failed and auto-refund also failed. Theo support has been notified — funds are held at the distributor and will be returned manually.`,
          orderId: order.id,
          leg1Hash,
          refundFailed: true,
          detail: `leg2: ${leg2Error}; refund: ${refundError}`,
        },
        502,
      );
    }

    return json({ ok: true, orderId: order.id, hash: leg2Hash, reference });
  } catch (e) {
    console.error("execute-swap error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
