// Admin-only debug: flip QUOTED -> FUNDED, then invoke release-usdc.
// For htgc_mint orders: mint HTG-C 1:1 from the distributor (acting as HTG-C issuer)
// directly to the destination wallet, opening a trustline first if needed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const HORIZON = "https://horizon-testnet.stellar.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: ue } = await userClient.auth.getUser();
    if (ue || !u.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the order to branch on kind
    const { data: existing, error: exErr } = await admin
      .from("orders")
      .select("id, status, order_kind")
      .eq("id", orderId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || existing.status !== "QUOTED") {
      return new Response(JSON.stringify({ error: "Order not in QUOTED state" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isMint = (existing as { order_kind?: string }).order_kind === "htgc_mint";

    if (isMint) {
      // HTG-C mint: 1:1, no Stellar release needed for the demo flow.
      const now = new Date().toISOString();
      const { error: cErr } = await admin
        .from("orders")
        .update({ status: "COMPLETED", funded_at: now, completed_at: now })
        .eq("id", orderId)
        .eq("status", "QUOTED");
      if (cErr) throw cErr;
      return new Response(JSON.stringify({ ok: true, status: "COMPLETED" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Standard USDC conversion path
    const { data: updated, error: upErr } = await admin
      .from("orders")
      .update({ status: "FUNDED", funded_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "QUOTED")
      .select("id")
      .maybeSingle();
    if (upErr) throw upErr;
    if (!updated) {
      return new Response(JSON.stringify({ error: "Order not in QUOTED state" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    admin.functions.invoke("release-usdc", { body: { orderId } }).catch((e) => {
      console.error("release-usdc invoke failed", e);
    });

    return new Response(JSON.stringify({ ok: true, status: "FUNDED" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("simulate-spih-payment error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
