// Theo Quote Engine
// POST /create-quote { usdc_amount }
// Creates a new order in QUOTED state with 15-min expiry.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { resolveCustomerId, checkOrgPermission } from "../_shared/resolve-customer.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Margin is now captured via customer fee_bps, not rate inflation.
const FORWARD_PREMIUM = 0;
const MARGIN = 0;
const MAX_USDC_NET = 50000;   // max USDC the customer receives (net of fees)
const MAX_USDC     = 52000;   // gross ceiling — covers up to ~3.8% fee on 50K net
const QUOTE_TTL_MIN = 15;

const ORDER_KIND_CODE: Record<string, string> = {
  usdc_conversion:  "CNV",  // HTG → USDC auto-convert
  htgc_deposit:     "DEP",  // HTG deposit, keep as HTG-C
  htgc_to_usdc:     "BUY",  // HTG-C → USDC swap
  usdc_to_htgc:     "SEL",  // USDC → HTG-C swap
  htgc_usdc_swap:   "BUY",  // legacy swap kind → BUY
  withdrawal:       "WDR",  // withdrawal to bank
  wire:             "WIR",  // global wire
  payment:          "PAY",  // single payment
  disbursement:     "DSB",  // bulk payroll / disbursement
  p2p:              "P2P",  // wallet-to-wallet transfer
};

function generateReference(orderKind: string): string {
  // THEO-[TYPE]-XXXXXX (uppercase alphanumeric, no ambiguous chars)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  const typeCode = ORDER_KIND_CODE[orderKind] ?? "TXN";
  return `THEO-${typeCode}-${s}`;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Caller-scoped client to identify the user via RLS
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const orderKind: "usdc_conversion" | "htgc_mint" =
      body.order_kind === "htgc_mint" ? "htgc_mint" : "usdc_conversion";

    let usdc = 0;
    let htgMint = 0;
    if (orderKind === "usdc_conversion") {
      usdc = Number(body.usdc_amount);
      if (!Number.isFinite(usdc) || usdc <= 0 || usdc > MAX_USDC) {
        return new Response(
          JSON.stringify({ error: `Enter an amount between 1,000 and ${MAX_USDC_NET.toLocaleString()} USDC` }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
    } else {
      htgMint = Number(body.htg_amount);
      if (!Number.isFinite(htgMint) || htgMint < 1) {
        return new Response(
          JSON.stringify({ error: "htg_amount must be a positive number" }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
    }
    const destinationWalletRaw = body.destinationWalletAddress ?? body.destination_wallet_address;
    const destinationWallet = typeof destinationWalletRaw === "string"
      ? destinationWalletRaw.trim()
      : "";
    if (destinationWallet && (!destinationWallet.startsWith("G") || destinationWallet.length < 50)) {
      return new Response(
        JSON.stringify({ error: "Invalid destination_wallet_address" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // Service-role client for trusted writes
    const admin = createClient(supabaseUrl, serviceKey);

    // Find customer (own row, or org membership)
    const effectiveCustomerId = await resolveCustomerId(admin, userId);
    if (!effectiveCustomerId) {
      return new Response(JSON.stringify({ error: "Customer profile not found" }), {
        status: 404, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Enforce org-level convert permission (org owners always pass)
    const permErr = await checkOrgPermission(admin, userId, "convert");
    if (permErr) {
      return new Response(JSON.stringify({ error: permErr }), {
        status: 403, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    const { data: customer, error: custErr } = await admin
      .from("customers")
      .select("id, kyb_status, fee_bps, corridor_bps")
      .eq("id", effectiveCustomerId)
      .maybeSingle();
    if (custErr) throw custErr;
    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer profile not found" }), {
        status: 404, headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    if (customer.kyb_status !== "APPROVED" && orderKind === "usdc_conversion") {
      return new Response(JSON.stringify({ error: "KYB approval required before requesting quotes" }), {
        status: 403, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const referenceNumber = generateReference(orderKind);
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MIN * 60 * 1000).toISOString();

    let htgRequired = 0;
    let customerRate: number | null = null;
    let spot: number | null = null;

    // Fee computation (usdc_conversion only)
    const theoBps    = (customer as { fee_bps?: number | null }).fee_bps      ?? 130;
    const corrBps    = (customer as { corridor_bps?: number | null }).corridor_bps ?? 70;
    const totalBps   = theoBps + corrBps;
    let usdcGross: number | null = null;
    let feeUsdc: number | null = null;
    let theoFeeUsdc: number | null = null;
    let usdcNet = usdc; // what the customer receives (net of fees)

    if (orderKind === "usdc_conversion") {
      const { data: rate } = await admin
        .from("rate_snapshots")
        .select("spot_rate")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      spot = Number(rate?.spot_rate ?? 130);
      customerRate = spot + FORWARD_PREMIUM + MARGIN;
      // usdc_amount from the client is the gross amount; net = gross - fee
      usdcGross    = usdc;
      feeUsdc      = Math.round(usdcGross * (totalBps / 10_000) * 1e7) / 1e7;
      theoFeeUsdc  = Math.round(usdcGross * (theoBps  / 10_000) * 1e7) / 1e7;
      usdcNet      = Math.round((usdcGross - feeUsdc) * 1e7) / 1e7;
      if (usdcNet > MAX_USDC_NET) {
        return new Response(
          JSON.stringify({ error: `Enter an amount between 1,000 and ${MAX_USDC_NET.toLocaleString()} USDC` }),
          { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
      htgRequired  = Math.round(usdcNet * customerRate * 100) / 100;
    } else {
      // HTG-C mint: 1:1, no rate, no fee
      htgRequired = Math.round(htgMint * 100) / 100;
    }

    const insertPayload: Record<string, unknown> = {
      customer_id: customer.id,
      status: "QUOTED",
      htg_amount: htgRequired,
      forward_premium: FORWARD_PREMIUM,
      margin: MARGIN,
      reference_number: referenceNumber,
      quote_expires_at: expiresAt,
      destination_wallet_address: destinationWallet || null,
      destination_stellar_address: destinationWallet || null,
      order_kind: orderKind,
    };
    if (orderKind === "usdc_conversion") {
      insertPayload.usdc_amount  = usdcNet;
      insertPayload.usdc_gross   = usdcGross;
      insertPayload.fee_bps      = totalBps;
      insertPayload.theo_fee_bps = theoBps;
      insertPayload.corridor_bps = corrBps;
      insertPayload.fee_usdc     = feeUsdc;
      insertPayload.theo_fee_usdc = theoFeeUsdc;
      insertPayload.rate         = customerRate;
      insertPayload.spot_rate    = spot;
    }

    const { data: order, error: insErr } = await admin
      .from("orders")
      .insert(insertPayload)
      .select()
      .single();
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        quote_id: order.id,
        htg_required: htgRequired,
        usdc_amount: usdcNet,
        usdc_gross: usdcGross,
        fee_usdc: feeUsdc,
        fee_bps: totalBps,
        theo_fee_bps: theoBps,
        rate: customerRate,
        spot_rate: spot,
        reference_number: referenceNumber,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("create-quote error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
