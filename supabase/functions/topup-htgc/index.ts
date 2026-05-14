// Admin-only: issue HTGC from issuer to distributor to top up reserve.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { distributorPublicKey } from "../_shared/stellar-signer.ts";

const HORIZON = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: roles } = await admin.from("user_roles")
      .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roles) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      return json({ error: "invalid amount (1..100000000)" }, 400);
    }

    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!issuerSecret) return json({ error: "issuer secret missing" }, 500);
    const issuerKp = Keypair.fromSecret(issuerSecret);
    if (issuerKp.publicKey() !== HTGC_ISSUER) {
      return json({ error: "issuer secret does not match HTGC_ISSUER" }, 500);
    }

    const distPub = distributorPublicKey();
    const server = new Horizon.Server(HORIZON);
    const issuerAccount = await server.loadAccount(issuerKp.publicKey());
    const htgc = new Asset("HTGC", HTGC_ISSUER);

    const tx = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({
        destination: distPub,
        asset: htgc,
        amount: amount.toFixed(7),
      }))
      .addMemo(Memo.text("htgc-topup"))
      .setTimeout(60)
      .build();
    tx.sign(issuerKp);
    const res = await server.submitTransaction(tx);
    return json({ ok: true, hash: res.hash, amount, distributor: distPub });
  } catch (e) {
    const detail = (e as any)?.response?.data ?? String(e);
    return json({ error: "topup failed", detail }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
