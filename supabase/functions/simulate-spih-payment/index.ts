// Admin-only debug: flip QUOTED -> FUNDED, then invoke release-usdc.
// For htgc_mint orders: mint real HTG-C 1:1 from the HTG-C issuer
// directly to the destination wallet, opening a trustline first if needed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";

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
      .select("id, status, order_kind, htg_amount, reference_number, customer_id, destination_wallet_address, destination_stellar_address")
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
      // HTG-C mint on Stellar testnet — use the real HTG-C issuer, not the distributor.
      const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
      if (!htgcIssuerSecret) throw new Error("STELLAR_HTGC_ISSUER_SECRET not configured");

      // Resolve destination address + secret (need secret to add trustline if missing)
      let dest = (existing.destination_stellar_address ?? existing.destination_wallet_address) as string | null;
      let destSecret: string | null = null;
      if (dest) {
        const { data: w } = await admin
          .from("wallets")
          .select("stellar_secret")
          .eq("stellar_address", dest)
          .maybeSingle();
        destSecret = (w as { stellar_secret?: string } | null)?.stellar_secret ?? null;
      } else {
        const { data: w } = await admin
          .from("wallets")
          .select("stellar_address, stellar_secret")
          .eq("customer_id", existing.customer_id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        dest = (w as { stellar_address?: string } | null)?.stellar_address ?? null;
        destSecret = (w as { stellar_secret?: string } | null)?.stellar_secret ?? null;
      }
      if (!dest || !dest.startsWith("G")) throw new Error("No Stellar destination wallet for this mint");

      const server = new Horizon.Server(HORIZON);
      const issuer = Keypair.fromSecret(htgcIssuerSecret);
      if (issuer.publicKey() !== HTGC_ISSUER) throw new Error("STELLAR_HTGC_ISSUER_SECRET does not match HTGC_ISSUER");
      const htgc = new Asset("HTGC", HTGC_ISSUER);

      // Open HTG-C trustline if missing (requires destination wallet secret)
      const destAccount = await server.loadAccount(dest);
      const hasTrust = (destAccount.balances as any[]).some(
        (b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER
      );
      if (!hasTrust) {
        if (!destSecret) throw new Error("Destination wallet missing HTG-C trustline and no signing key available");
        const destKp = Keypair.fromSecret(destSecret);
        const trustTx = new TransactionBuilder(destAccount, {
          fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.changeTrust({ asset: htgc }))
          .setTimeout(60)
          .build();
        trustTx.sign(destKp);
        await server.submitTransaction(trustTx);
      }

      // Mint = payment from real issuer to destination
      const issuerAccount = await server.loadAccount(issuer.publicKey());
      const amount = Number(existing.htg_amount).toFixed(7);
      const mintTx = new TransactionBuilder(issuerAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.setTrustLineFlags({
          trustor: dest,
          asset: htgc,
          flags: { authorized: true },
        }))
        .addOperation(Operation.payment({ destination: dest, asset: htgc, amount }))
        .addMemo(Memo.text(String(existing.reference_number).slice(0, 28)))
        .setTimeout(60)
        .build();
      mintTx.sign(issuer);
      const mintResult = await server.submitTransaction(mintTx);
      const hash = (mintResult as { hash: string }).hash;

      const now = new Date().toISOString();
      const { error: cErr } = await admin
        .from("orders")
        .update({ status: "COMPLETED", funded_at: now, completed_at: now, stellar_tx_hash: hash, released_at: now })
        .eq("id", orderId)
        .eq("status", "QUOTED");
      if (cErr) throw cErr;
      return new Response(JSON.stringify({ ok: true, status: "COMPLETED", hash }), {
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
