// Theo Quote Engine
// POST /create-quote { usdc_amount }
// Creates a new order in QUOTED state with 15-min expiry.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FORWARD_PREMIUM = 2;
const MARGIN = 3;
const MIN_USDC = 1000;
const MAX_USDC = 50000;
const QUOTE_TTL_MIN = 15;

function generateReference(): string {
  // THEO-XXXXXX (uppercase alphanumeric, no ambiguous chars)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) s += chars[b % chars.length];
  return `THEO-${s}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const usdc = Number(body.usdc_amount);
    if (!Number.isFinite(usdc) || usdc < MIN_USDC || usdc > MAX_USDC) {
      return new Response(
        JSON.stringify({ error: `usdc_amount must be between ${MIN_USDC} and ${MAX_USDC}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Service-role client for trusted writes
    const admin = createClient(supabaseUrl, serviceKey);

    // Find customer
    const { data: customer, error: custErr } = await admin
      .from("customers")
      .select("id, kyb_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (custErr) throw custErr;
    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer profile not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (customer.kyb_status !== "APPROVED") {
      return new Response(JSON.stringify({ error: "KYB approval required before requesting quotes" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Latest spot rate
    const { data: rate } = await admin
      .from("rate_snapshots")
      .select("spot_rate")
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const spot = Number(rate?.spot_rate ?? 130);
    const customerRate = spot + FORWARD_PREMIUM + MARGIN;
    const htgRequired = Math.round(usdc * customerRate * 100) / 100;
    const referenceNumber = generateReference();
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MIN * 60 * 1000).toISOString();

    const { data: order, error: insErr } = await admin
      .from("orders")
      .insert({
        customer_id: customer.id,
        status: "QUOTED",
        htg_amount: htgRequired,
        usdc_amount: usdc,
        rate: customerRate,
        spot_rate: spot,
        forward_premium: FORWARD_PREMIUM,
        margin: MARGIN,
        reference_number: referenceNumber,
        quote_expires_at: expiresAt,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    return new Response(
      JSON.stringify({
        quote_id: order.id,
        htg_required: htgRequired,
        usdc_amount: usdc,
        rate: customerRate,
        spot_rate: spot,
        reference_number: referenceNumber,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("create-quote error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
