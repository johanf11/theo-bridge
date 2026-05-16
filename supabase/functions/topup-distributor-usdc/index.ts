// Admin-only: mint testnet USDC from the issuer to the distributor wallet.
// Used to keep the distributor liquid enough to settle USDC payouts on swaps.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { distributorPublicKey } from "../_shared/stellar-signer.ts";
import { safePostLedger } from "../_shared/ledger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_AMOUNT = 500_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);
    if (!issuerSecret) return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured" }, 500);

    // Verify caller is admin
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);
    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const amount = Number((body as { amount?: number }).amount ?? DEFAULT_AMOUNT);
    if (!amount || amount <= 0 || amount > 10_000_000) return json({ error: "Invalid amount" }, 400);

    const issuerKp = Keypair.fromSecret(issuerSecret);
    if (issuerKp.publicKey() !== usdcIssuer) {
      return json({
        error: `Issuer secret pubkey ${issuerKp.publicKey()} does not match STELLAR_USDC_ISSUER ${usdcIssuer}`,
      }, 500);
    }

    const distAddress = distributorPublicKey();
    const server = new Horizon.Server(HORIZON_URL);
    const usdc = new Asset("USDC", usdcIssuer);

    try {
      const issuerAccount = await server.loadAccount(issuerKp.publicKey());
      const tx = new TransactionBuilder(issuerAccount, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: distAddress,
          asset: usdc,
          amount: amount.toFixed(7),
        }))
        .setTimeout(60)
        .build();
      tx.sign(issuerKp);
      const r = await server.submitTransaction(tx);
      const hash = (r as { hash: string }).hash;

      // Ledger: treasury → distributor (asset transfer between Theo accounts).
      await safePostLedger(admin, "topup-distributor-usdc", {
        kind: "DISTRIBUTOR_TOPUP",
        description: `Distributor USDC top-up ${amount}`,
        postedBy: user.id,
        sourceKey: `topup-distributor-usdc:${hash}`,
        entries: [
          { code: "DISTRIBUTOR_USDC", currency: "USDC", debit:  amount },
          { code: "TREASURY_USDC",    currency: "USDC", credit: amount },
        ],
      }, { stellarTxHash: hash });

      return json({ ok: true, hash, amount, distributor: distAddress });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      return json({ error: `Mint failed: ${msg}` }, 502);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
