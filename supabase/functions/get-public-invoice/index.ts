// Public invoice fetcher — returns only fields safe to expose on a shareable link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  try {
    const { id } = await req.json();
    if (!id || typeof id !== "string") {
      return new Response(JSON.stringify({ error: "Missing invoice id" }), {
        status: 400,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await admin
      .from("invoices")
      .select(
        "id, invoice_number, client_name, currency, line_items, discount_type, discount_value, subtotal, total, due_date, note, status, paid_at, created_at, payment_wallet_id, wallets(label, stellar_address)"
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return new Response(JSON.stringify({ error: "Invoice not found" }), {
        status: 404,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ invoice: data }), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
