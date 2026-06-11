// backfill-ledger — admin-only, idempotent one-shot historical ledger replay.
//
// ── Recommended rollout order ──────────────────────────────────────────────────
//   1. Confirm the ledger schema migrations are applied (Phase 1 + Phase 2).
//   2. POST /backfill-ledger (admin auth required) — inspect the backfill_report.
//   3. Open /admin/ledger → Trial Balance should show totals balanced (Σdebit = Σcredit)
//      per currency. Residuals < $1 on testnet are acceptable.
//   4. Wire execute-swap / admin-rectify-htgc with LEDGER_GATE_ENABLED if desired,
//      or rely on always-on posting (current default — no gate in Lovable build).
// ──────────────────────────────────────────────────────────────────────────────
//
// Idempotency: every call uses a deterministic source_key (e.g. "backfill:order:<id>").
// post_ledger_entries returns the existing tx id on collision — safe to re-run.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { Horizon } from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorPublicKey } from "../_shared/stellar-signer.ts";
import { HTGC_ISSUER, TREASURY_PUBLIC } from "../_shared/stellar-assets.ts";
import { postLedger } from "../_shared/ledger.ts";
import type { LedgerPost } from "../_shared/ledger.ts";

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
  orders:    number;
  payouts:   number;
  blend:     number;
  issuances: number;
  equity_adjustment_dist:  number;
  equity_adjustment_treas: number;
  equity_adjustment_htg:   number;
  errors:    string[];
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function safePost(
  admin: ReturnType<typeof createClient>,
  post: LedgerPost,
  errors: string[],
): Promise<void> {
  try {
    await postLedger(admin, post);
  } catch (e) {
    errors.push(`${post.sourceKey}: ${(e as Error).message}`);
  }
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
    const url     = Deno.env.get("SUPABASE_URL")!;
    const anon    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER") ?? "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Service-role bypass: ONLY an exact match against the real service-role
    // secret is trusted. We must NOT decode a JWT and trust its `role`/`ref`
    // claims without verifying the signature — the project ref is public, so a
    // forged token could otherwise grant admin access to this ledger-rewriting
    // function. Non-secret callers fall through to the authenticated admin check.
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const isService = token === service;

    if (!isService) {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: ue } = await userClient.auth.getUser();
      if (ue || !user) return json({ error: "Unauthorized" }, 401);

      const { data: roleRow } = await admin
        .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);
    }



    const report: BackfillReport = {
      orders: 0, payouts: 0, blend: 0, issuances: 0,
      equity_adjustment_dist:  0,
      equity_adjustment_treas: 0,
      equity_adjustment_htg:   0,
      errors: [],
    };

    // ── 1. Orders ─────────────────────────────────────────────────────────────
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_kind, swap_direction, customer_id, htg_amount, usdc_amount, usdc_gross, fee_usdc, theo_fee_usdc, corridor_bps, stellar_tx_hash")
      .eq("status", "COMPLETED")
      .order("completed_at", { ascending: true });

    for (const o of orders ?? []) {
      const sourceKey = `backfill:order:${o.id}`;
      try {
        const usdcGross   = Number(o.usdc_gross   ?? o.usdc_amount ?? 0);
        const totalFeeUsdc = Number(o.fee_usdc ?? 0);
        const usdcNet     = usdcGross - Number(o.fee_usdc ?? 0);
        const htgAmount   = Math.round(Number(o.htg_amount ?? 0));

        const custEntry = (amount: number, credit: boolean) =>
          ({ code: "CUSTOMER_USDC_PAYABLE", currency: "USDC" as const, ...(credit ? { credit: amount } : { debit: amount }), ...(o.customer_id ? { customerId: o.customer_id } : {}) });

        const feeEntry = totalFeeUsdc > 0
          ? [{ code: "FEE_REVENUE_USDC", currency: "USDC" as const, credit: totalFeeUsdc }]
          : [];

        if (o.order_kind === "htgc_usdc_swap" && o.swap_direction === "htgc_to_usdc") {
          await safePost(admin, {
            orderId: o.id, kind: "htgc_to_usdc_swap", sourceKey,
            description: `[backfill] HTG-C → USDC swap order ${o.id}`,
            entries: [
              { code: "HTGC_ISSUED",      currency: "HTG",  debit:  htgAmount },
              { code: "FX_CLEARING_HTG",  currency: "HTG",  credit: htgAmount },
              { code: "FX_CLEARING_USDC", currency: "USDC", debit:  usdcGross },
              { code: "DISTRIBUTOR_USDC", currency: "USDC", credit: usdcNet   },
              ...feeEntry,
            ],
          }, report.errors);
        } else if (o.order_kind === "htgc_usdc_swap" && o.swap_direction === "usdc_to_htgc") {
          await safePost(admin, {
            orderId: o.id, kind: "usdc_to_htgc_swap", sourceKey,
            description: `[backfill] USDC → HTG-C swap order ${o.id}`,
            entries: [
              { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  usdcGross },
              { code: "FX_CLEARING_USDC", currency: "USDC", credit: usdcNet   },
              ...feeEntry,
              { code: "FX_CLEARING_HTG",  currency: "HTG",  debit:  htgAmount },
              { code: "HTGC_ISSUED",      currency: "HTG",  credit: htgAmount },
            ],
          }, report.errors);

        } else if (o.order_kind === "usdc_conversion") {
          // Legacy: USDC-only entries; HTG side unknown — plug into equity
          await safePost(admin, {
            orderId: o.id, kind: "usdc_conversion_legacy", sourceKey,
            description: `[backfill] USDC conversion order ${o.id}`,
            entries: [
              { code: "OPENING_BALANCE_USDC", currency: "USDC", debit: usdcGross },
              custEntry(usdcNet, true),
              ...feeEntry,
            ],
          }, report.errors);
        }

        report.orders++;
      } catch (e) {
        report.errors.push(`order:${o.id}: ${(e as Error).message}`);
      }
    }

    // ── 2. Payouts ────────────────────────────────────────────────────────────
    // Intentionally NOT backfilled. Theo is non-custodial: external USDC payouts
    // move the customer's own wallet funds, which already left Theo's books at the
    // on-ramp USDC_PAYOUT. Posting them here would double-debit CUSTOMER_USDC_PAYABLE
    // (and double-count DISTRIBUTOR_USDC), driving the payable negative. These
    // payouts are tracked in the `payouts` table, not the double-entry ledger.

    // ── 3. Blend positions ────────────────────────────────────────────────────
    const { data: blendPos } = await admin
      .from("blend_positions")
      .select("id, amount_usdc")
      .order("created_at", { ascending: true });

    for (const b of blendPos ?? []) {
      const sourceKey = `backfill:blend:${b.id}`;
      try {
        const amount = Number(b.amount_usdc);
        await safePost(admin, {
          kind: "blend_deposit", sourceKey,
          description: `[backfill] Blend deposit ${b.id}`,
          entries: [
            { code: "BLEND_DEPOSITS_USDC", currency: "USDC", debit:  amount },
            { code: "DISTRIBUTOR_USDC",    currency: "USDC", credit: amount },
          ],
        }, report.errors);
        report.blend++;
      } catch (e) {
        report.errors.push(`blend:${b.id}: ${(e as Error).message}`);
      }
    }

    // ── 4. HTGC issuance events (if table exists) ─────────────────────────────
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
            await safePost(admin, {
              kind: "htgc_issuance_backfill", sourceKey,
              description: `[backfill] HTGC issuance ${ev.id}`,
              entries: [
                { code: "OPENING_BALANCE_HTG", currency: "HTG", debit:  amount },
                { code: "HTGC_ISSUED",         currency: "HTG", credit: amount },
              ],
            }, report.errors);
          } else if (ev.event_type === "burn") {
            await safePost(admin, {
              kind: "htgc_burn_backfill", sourceKey,
              description: `[backfill] HTGC burn ${ev.id}`,
              entries: [
                { code: "HTGC_ISSUED",         currency: "HTG", debit:  amount },
                { code: "OPENING_BALANCE_HTG", currency: "HTG", credit: amount },
              ],
            }, report.errors);
          }
          report.issuances++;
        } catch (e) {
          report.errors.push(`issuance:${ev.id}: ${(e as Error).message}`);
        }
      }
    }

    // ── 5. Residual delta: on-chain vs book, plug into equity ─────────────────
    const server = new Horizon.Server(HORIZON_URL);
    const distPubkey = distributorPublicKey();

    async function onChainUsdc(address: string): Promise<number> {
      try {
        const acct = await server.loadAccount(address);
        const bal = (acct.balances as HorizonBalance[]).find(
          (b) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer,
        );
        return bal ? Number(bal.balance) : 0;
      } catch { return 0; }
    }

    async function onChainHtgcSupply(): Promise<number> {
      try {
        const res = await fetch(`${HORIZON_URL}/assets?asset_code=HTGC&asset_issuer=${HTGC_ISSUER}&limit=1`);
        const j = await res.json() as { _embedded?: { records?: Array<{ amount?: string }> } };
        return Number(j._embedded?.records?.[0]?.amount ?? 0);
      } catch { return 0; }
    }

    const [distOnChain, treasuryOnChain, htgcSupplyOnChain] = await Promise.all([
      onChainUsdc(distPubkey),
      onChainUsdc(TREASURY_PUBLIC),
      onChainHtgcSupply(),
    ]);

    // Compute book balances for chain-held accounts
    const { data: bookRows } = await admin
      .from("ledger_accounts")
      .select("code, id")
      .in("code", ["DISTRIBUTOR_USDC", "TREASURY_USDC", "HTGC_ISSUED"]);
    const { data: entryTotals } = await admin
      .from("ledger_entries")
      .select("account_id, debit, credit");

    const book: Record<string, number> = {};
    for (const r of bookRows ?? []) {
      const acctId = (r as { code: string; id: string }).id;
      const code   = (r as { code: string; id: string }).code;
      const rows   = (entryTotals ?? []).filter((e) => (e as { account_id: string }).account_id === acctId);
      const debit  = rows.reduce((s, e) => s + Number((e as { debit: string }).debit),  0);
      const credit = rows.reduce((s, e) => s + Number((e as { credit: string }).credit), 0);
      book[code] = debit - credit; // ASSET normal balance
    }

    const distDelta  = distOnChain    - (book["DISTRIBUTOR_USDC"] ?? 0);
    const treasDelta = treasuryOnChain - (book["TREASURY_USDC"]   ?? 0);
    const htgcDelta  = htgcSupplyOnChain - (-(book["HTGC_ISSUED"] ?? 0)); // LIABILITY: credit > debit

    if (Math.abs(distDelta) > 0.0000001) {
      const amt = Math.abs(distDelta);
      await safePost(admin, {
        kind: "equity_adjustment_usdc", sourceKey: "backfill:equity:dist",
        description: "[backfill] Opening equity adjustment — Distributor USDC",
        entries: distDelta > 0
          ? [
              { code: "DISTRIBUTOR_USDC",     currency: "USDC", debit:  amt },
              { code: "OPENING_BALANCE_USDC", currency: "USDC", credit: amt },
            ]
          : [
              { code: "OPENING_BALANCE_USDC", currency: "USDC", debit:  amt },
              { code: "DISTRIBUTOR_USDC",     currency: "USDC", credit: amt },
            ],
      }, report.errors);
      report.equity_adjustment_dist = distDelta;
    }

    if (Math.abs(treasDelta) > 0.0000001) {
      const amt = Math.abs(treasDelta);
      await safePost(admin, {
        kind: "equity_adjustment_usdc", sourceKey: "backfill:equity:treas",
        description: "[backfill] Opening equity adjustment — Treasury USDC",
        entries: treasDelta > 0
          ? [
              { code: "TREASURY_USDC",        currency: "USDC", debit:  amt },
              { code: "OPENING_BALANCE_USDC", currency: "USDC", credit: amt },
            ]
          : [
              { code: "OPENING_BALANCE_USDC", currency: "USDC", debit:  amt },
              { code: "TREASURY_USDC",        currency: "USDC", credit: amt },
            ],
      }, report.errors);
      report.equity_adjustment_treas = treasDelta;
    }

    if (Math.abs(htgcDelta) > 0.0000001) {
      const amt = Math.round(Math.abs(htgcDelta));
      await safePost(admin, {
        kind: "equity_adjustment_htg", sourceKey: "backfill:equity:htg",
        description: "[backfill] Opening equity adjustment — HTG",
        entries: htgcDelta > 0
          ? [
              { code: "OPENING_BALANCE_HTG", currency: "HTG", debit:  amt },
              { code: "HTGC_ISSUED",         currency: "HTG", credit: amt },
            ]
          : [
              { code: "HTGC_ISSUED",         currency: "HTG", debit:  amt },
              { code: "OPENING_BALANCE_HTG", currency: "HTG", credit: amt },
            ],
      }, report.errors);
      report.equity_adjustment_htg = htgcDelta;
    }

    return json({ ok: true, backfill_report: report });

  } catch (e) {
    console.error("backfill-ledger error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
