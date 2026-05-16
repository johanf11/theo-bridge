// backfill-ledger — admin-only, idempotent one-shot historical ledger replay.
//
// ── Recommended rollout order ──────────────────────────────────────────────────
//   1. Deploy this function (LEDGER_GATE_ENABLED is unset / "0" — gate closed)
//   2. POST /backfill-ledger and inspect the returned backfill_report
//   3. Query trial balance:
//        SELECT code, balance FROM ledger_accounts ORDER BY code;
//      Residuals should be near-zero (< $1 on testnet due to rounding).
//   4. Confirm opening_equity_adjustment_usdc looks reasonable.
//   5. Set LEDGER_GATE_ENABLED=1 in Supabase edge function secrets.
//      Live posting begins immediately for new swaps.
//
// ── Idempotency ────────────────────────────────────────────────────────────────
//   Every entry uses a deterministic source_key (e.g. "backfill:order:<id>").
//   post_ledger_entries returns the existing tx id on collision — safe to re-run.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from "jsr:@supabase/supabase-js@2";
import { Horizon } from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorPublicKey } from "../_shared/stellar-signer.ts";
import { HTGC_ISSUER, TREASURY_PUBLIC } from "../_shared/stellar-assets.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

type BackfillReport = {
  orders:      number;
  payouts:     number;
  blend:       number;
  issuances:   number;
  opening_equity_adjustment_usdc: number;
  opening_equity_adjustment_htg:  number;
  errors:      string[];
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function resolveAccountId(
  admin: ReturnType<typeof createClient>,
  code: string,
  customerId?: string,
): Promise<string> {
  if (code === "CUSTOMER_USDC" && customerId) {
    const { data, error } = await admin.rpc("get_or_create_customer_usdc_account", {
      p_customer_id: customerId,
    });
    if (error) throw new Error(`get_or_create failed: ${error.message}`);
    return data as string;
  }
  const { data, error } = await admin
    .from("ledger_accounts")
    .select("id")
    .eq("code", code)
    .is("customer_id", null)
    .single();
  if (error || !data) throw new Error(`Account not found: ${code}`);
  return (data as { id: string }).id;
}

async function post(
  admin: ReturnType<typeof createClient>,
  sourceKey: string,
  description: string,
  rawEntries: Array<{ code: string; customerId?: string; amount: number; side: "DEBIT" | "CREDIT"; currency: "USDC" | "HTG" }>,
): Promise<void> {
  const entries = await Promise.all(
    rawEntries.map(async (e) => ({
      account_id: await resolveAccountId(admin, e.code, e.customerId),
      amount:     Math.round(e.amount * 1e7) / 1e7,
      side:       e.side,
      currency:   e.currency,
    })),
  );
  await admin.rpc("post_ledger_entries", {
    p_source_key:  sourceKey,
    p_description: description,
    p_posted_by:   null,
    p_entries:     JSON.stringify(entries),
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

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

    const url     = Deno.env.get("SUPABASE_URL")!;
    const anon    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER") ?? "";

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const report: BackfillReport = {
      orders: 0, payouts: 0, blend: 0, issuances: 0,
      opening_equity_adjustment_usdc: 0,
      opening_equity_adjustment_htg:  0,
      errors: [],
    };

    // ── 1. Orders ─────────────────────────────────────────────────────────────
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_kind, swap_direction, customer_id, htg_amount, usdc_amount, usdc_gross, fee_usdc, theo_fee_usdc, corridor_bps")
      .eq("status", "COMPLETED")
      .order("completed_at", { ascending: true });

    for (const o of orders ?? []) {
      const sourceKey = `backfill:order:${o.id}`;
      try {
        const usdcGross    = Number(o.usdc_gross   ?? o.usdc_amount ?? 0);
        const theoFeeUsdc  = Number(o.theo_fee_usdc ?? 0);
        const usdcNet      = usdcGross - Number(o.fee_usdc ?? 0);
        const htgAmount    = Math.round(Number(o.htg_amount ?? 0));

        if (o.order_kind === "htgc_usdc_swap" && o.swap_direction === "htgc_to_usdc") {
          await post(admin, sourceKey, `[backfill] HTG-C → USDC swap order ${o.id}`, [
            { code: "FX_CLEARING_HTG",  amount: htgAmount,   side: "DEBIT",  currency: "HTG",  customerId: undefined },
            { code: "HTGC_ISSUED",      amount: htgAmount,   side: "CREDIT", currency: "HTG"   },
            { code: "DISTRIBUTOR_USDC", amount: usdcGross,   side: "DEBIT",  currency: "USDC"  },
            { code: "CUSTOMER_USDC",    amount: usdcNet,     side: "CREDIT", currency: "USDC",  customerId: o.customer_id },
            { code: "FEE_REVENUE_USDC", amount: theoFeeUsdc, side: "CREDIT", currency: "USDC"  },
          ]);
        } else if (o.order_kind === "htgc_usdc_swap" && o.swap_direction === "usdc_to_htgc") {
          await post(admin, sourceKey, `[backfill] USDC → HTG-C swap order ${o.id}`, [
            { code: "TREASURY_USDC",    amount: usdcGross,   side: "DEBIT",  currency: "USDC"  },
            { code: "CUSTOMER_USDC",    amount: usdcNet,     side: "CREDIT", currency: "USDC",  customerId: o.customer_id },
            { code: "FEE_REVENUE_USDC", amount: theoFeeUsdc, side: "CREDIT", currency: "USDC"  },
            { code: "HTGC_ISSUED",      amount: htgAmount,   side: "DEBIT",  currency: "HTG"   },
            { code: "FX_CLEARING_HTG",  amount: htgAmount,   side: "CREDIT", currency: "HTG"   },
          ]);
        } else if (o.order_kind === "usdc_conversion") {
          // Legacy: treat as usdc_to_htgc with USDC entries only (HTG side unknown)
          await post(admin, sourceKey, `[backfill] USDC conversion order ${o.id}`, [
            { code: "OPENING_BALANCE_EQUITY", amount: usdcGross,   side: "DEBIT",  currency: "USDC" },
            { code: "CUSTOMER_USDC",          amount: usdcNet,     side: "CREDIT", currency: "USDC", customerId: o.customer_id },
            { code: "FEE_REVENUE_USDC",       amount: theoFeeUsdc, side: "CREDIT", currency: "USDC" },
          ]);
        }
        // htgc_mint and htgc_withdrawal handled separately (issuance events)
        report.orders++;
      } catch (e) {
        report.errors.push(`order:${o.id}: ${(e as Error).message}`);
      }
    }

    // ── 2. Payouts ────────────────────────────────────────────────────────────
    const { data: payouts } = await admin
      .from("payouts")
      .select("id, customer_id, amount_usdc")
      .eq("status", "COMPLETED")
      .order("created_at", { ascending: true });

    for (const p of payouts ?? []) {
      const sourceKey = `backfill:payout:${p.id}`;
      try {
        const amount = Number(p.amount_usdc);
        await post(admin, sourceKey, `[backfill] Payout ${p.id}`, [
          { code: "CUSTOMER_USDC",    amount, side: "DEBIT",  currency: "USDC", customerId: p.customer_id },
          { code: "DISTRIBUTOR_USDC", amount, side: "CREDIT", currency: "USDC" },
        ]);
        report.payouts++;
      } catch (e) {
        report.errors.push(`payout:${p.id}: ${(e as Error).message}`);
      }
    }

    // ── 3. Blend positions ────────────────────────────────────────────────────
    const { data: blendPos } = await admin
      .from("blend_positions")
      .select("id, amount_usdc")
      .order("created_at", { ascending: true });

    for (const b of blendPos ?? []) {
      const sourceKey = `backfill:blend:${b.id}`;
      try {
        const amount = Number(b.amount_usdc);
        await post(admin, sourceKey, `[backfill] Blend deposit ${b.id}`, [
          { code: "BLEND_DEPOSITS_USDC", amount, side: "DEBIT",  currency: "USDC" },
          { code: "DISTRIBUTOR_USDC",    amount, side: "CREDIT", currency: "USDC" },
        ]);
        report.blend++;
      } catch (e) {
        report.errors.push(`blend:${b.id}: ${(e as Error).message}`);
      }
    }

    // ── 4. HTGC issuance events (if table exists) ──────────────────────────────
    const { data: issuances, error: issuanceErr } = await admin
      .from("htgc_issuance_events")
      .select("id, amount, event_type")
      .order("created_at", { ascending: true });

    if (!issuanceErr) {
      for (const ev of issuances ?? []) {
        const sourceKey = `backfill:issuance:${ev.id}`;
        try {
          const amount = Math.round(Number(ev.amount));
          if (ev.event_type === "mint") {
            await post(admin, sourceKey, `[backfill] HTGC issuance ${ev.id}`, [
              { code: "OPENING_BALANCE_EQUITY", amount, side: "DEBIT",  currency: "HTG" },
              { code: "HTGC_ISSUED",            amount, side: "CREDIT", currency: "HTG" },
            ]);
          } else if (ev.event_type === "burn") {
            await post(admin, sourceKey, `[backfill] HTGC burn ${ev.id}`, [
              { code: "HTGC_ISSUED",            amount, side: "DEBIT",  currency: "HTG" },
              { code: "OPENING_BALANCE_EQUITY", amount, side: "CREDIT", currency: "HTG" },
            ]);
          }
          report.issuances++;
        } catch (e) {
          report.errors.push(`issuance:${ev.id}: ${(e as Error).message}`);
        }
      }
    }

    // ── 5. Residual delta: on-chain vs book, plug into OPENING_BALANCE_EQUITY ─
    const server = new Horizon.Server(HORIZON_URL);
    const distPubkey = distributorPublicKey();

    async function onChainUsdc(address: string): Promise<number> {
      try {
        const acct = await server.loadAccount(address);
        const bal = (acct.balances as HorizonBalance[]).find(
          (b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer,
        );
        return bal ? Number(bal.balance) : 0;
      } catch {
        return 0;
      }
    }

    async function onChainHtgcSupply(): Promise<number> {
      try {
        const res = await fetch(
          `${HORIZON_URL}/assets?asset_code=HTGC&asset_issuer=${HTGC_ISSUER}&limit=1`,
        );
        const j = await res.json() as { _embedded?: { records?: Array<{ amount?: string }> } };
        const raw = j._embedded?.records?.[0]?.amount;
        return raw ? Number(raw) : 0;
      } catch {
        return 0;
      }
    }

    const [distOnChain, treasuryOnChain, htgcSupplyOnChain] = await Promise.all([
      onChainUsdc(distPubkey),
      onChainUsdc(TREASURY_PUBLIC),
      onChainHtgcSupply(),
    ]);

    // Fetch book balances for the three chain-held accounts
    const { data: bookRows } = await admin
      .from("ledger_accounts")
      .select("code, balance")
      .in("code", ["DISTRIBUTOR_USDC", "TREASURY_USDC", "HTGC_ISSUED"])
      .is("customer_id", null);

    const book: Record<string, number> = {};
    for (const r of bookRows ?? []) book[(r as { code: string; balance: string }).code] = Number((r as { balance: string }).balance);

    const distDelta    = distOnChain    - (book["DISTRIBUTOR_USDC"] ?? 0);
    const treasDelta   = treasuryOnChain - (book["TREASURY_USDC"] ?? 0);
    const htgcDelta    = htgcSupplyOnChain - (book["HTGC_ISSUED"] ?? 0);
    const totalUsdcDelta = distDelta + treasDelta;

    if (Math.abs(totalUsdcDelta) > 0.0000001) {
      try {
        const amt = Math.abs(totalUsdcDelta);
        await post(admin, "backfill:equity:usdc", "[backfill] Opening equity adjustment — USDC", [
          {
            code: totalUsdcDelta > 0 ? "OPENING_BALANCE_EQUITY" : "DISTRIBUTOR_USDC",
            amount: amt, side: "DEBIT",  currency: "USDC",
          },
          {
            code: totalUsdcDelta > 0 ? "DISTRIBUTOR_USDC" : "OPENING_BALANCE_EQUITY",
            amount: amt, side: "CREDIT", currency: "USDC",
          },
        ]);
        report.opening_equity_adjustment_usdc = totalUsdcDelta;
      } catch (e) {
        report.errors.push(`equity:usdc: ${(e as Error).message}`);
      }
    }

    if (Math.abs(htgcDelta) > 0.0000001) {
      try {
        const amt = Math.round(Math.abs(htgcDelta));
        await post(admin, "backfill:equity:htg", "[backfill] Opening equity adjustment — HTG", [
          {
            code: htgcDelta > 0 ? "OPENING_BALANCE_EQUITY" : "HTGC_ISSUED",
            amount: amt, side: "DEBIT",  currency: "HTG",
          },
          {
            code: htgcDelta > 0 ? "HTGC_ISSUED" : "OPENING_BALANCE_EQUITY",
            amount: amt, side: "CREDIT", currency: "HTG",
          },
        ]);
        report.opening_equity_adjustment_htg = htgcDelta;
      } catch (e) {
        report.errors.push(`equity:htg: ${(e as Error).message}`);
      }
    }

    return json({ ok: true, backfill_report: report });

  } catch (e) {
    console.error("backfill-ledger error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
