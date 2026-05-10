/**
 * htgc-issuance — admin-only edge function for HTG-C mint and burn operations.
 *
 * POST body:
 *   { action: "mint", destinationAddress: string, amount: number, memo?: string }
 *   { action: "burn", sourceAddress: string, sourceSecret: string, amount: number, memo?: string }
 *
 * Mint: issuer → destination wallet  (increases circulation)
 * Burn: source wallet → issuer       (decreases circulation, issuer cannot hold own asset so it destroys the tokens)
 *
 * Required env vars:
 *   STELLAR_HTGC_ISSUER_SECRET   — HTG-C issuer signing key
 *   STELLAR_HTGC_ISSUER          — HTG-C issuer public key (optional, derived from secret if absent)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks,
  Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth: must be an authenticated admin ─────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url     = Deno.env.get("SUPABASE_URL")!;
    const anon    = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    // Check admin role
    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleRow?.role !== "admin") return json({ error: "Admin access required" }, 403);

    // ── Env ──────────────────────────────────────────────────────────────────
    const issuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!issuerSecret) return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured" }, 500);

    const issuerKp = Keypair.fromSecret(issuerSecret);
    const htgcIssuer = issuerKp.publicKey();
    const htgc = new Asset("HTGC", htgcIssuer);
    const server = new Horizon.Server(HORIZON_URL);

    // ── Parse body ───────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action, amount, memo } = body;

    if (!["mint", "burn"].includes(action)) return json({ error: "action must be 'mint' or 'burn'" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);

    if (action === "mint") {
      // ── MINT: issuer → destination wallet ──────────────────────────────────
      const { destinationAddress } = body;
      if (!destinationAddress?.startsWith("G")) return json({ error: "Valid destinationAddress required" }, 400);

      // Verify destination has HTGC trust line
      const destAccount = await server.loadAccount(destinationAddress).catch(() => null);
      if (!destAccount) return json({ error: "Destination account not found on Stellar" }, 422);

      const hasTrust = (destAccount.balances as Array<{ asset_code?: string; asset_issuer?: string }>)
        .some((b) => b.asset_code === "HTGC" && b.asset_issuer === htgcIssuer);
      if (!hasTrust) return json({ error: "Destination wallet has no HTGC trust line" }, 422);

      const issuerAccount = await server.loadAccount(htgcIssuer);
      const tx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({
          destination: destinationAddress,
          asset: htgc,
          amount: parsedAmount.toFixed(7),
        }))
        .setTimeout(60);

      if (memo?.trim()) tx.addMemo(Memo.text(memo.trim().slice(0, 28)));
      const built = tx.build();
      built.sign(issuerKp);

      const result = await server.submitTransaction(built);
      const hash = (result as { hash: string }).hash;

      // Log to issuance_events if table exists (best-effort)
      await admin.from("htgc_issuance_events").insert({
        action: "MINT",
        amount: parsedAmount,
        destination_address: destinationAddress,
        stellar_tx_hash: hash,
        memo: memo?.trim() || null,
        performed_by: user.id,
      }).then(() => {}).catch(() => {});

      return json({ ok: true, action: "mint", amount: parsedAmount, hash });

    } else {
      // ── BURN: source wallet → issuer ────────────────────────────────────────
      // The source must sign — we look up the secret from the wallets table
      const { sourceAddress } = body;
      if (!sourceAddress?.startsWith("G")) return json({ error: "Valid sourceAddress required" }, 400);

      const { data: walletRow } = await admin
        .from("wallets")
        .select("stellar_secret")
        .eq("stellar_address", sourceAddress)
        .maybeSingle();
      if (!walletRow?.stellar_secret) return json({ error: "Source wallet not found or has no signing key" }, 404);

      const sourceKp = Keypair.fromSecret(walletRow.stellar_secret);
      const sourceAccount = await server.loadAccount(sourceKp.publicKey());

      const tx = new TransactionBuilder(sourceAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.payment({
          destination: htgcIssuer,
          asset: htgc,
          amount: parsedAmount.toFixed(7),
        }))
        .setTimeout(60);

      if (memo?.trim()) tx.addMemo(Memo.text(memo.trim().slice(0, 28)));
      const built = tx.build();
      built.sign(sourceKp);

      const result = await server.submitTransaction(built);
      const hash = (result as { hash: string }).hash;

      await admin.from("htgc_issuance_events").insert({
        action: "BURN",
        amount: parsedAmount,
        source_address: sourceAddress,
        stellar_tx_hash: hash,
        memo: memo?.trim() || null,
        performed_by: user.id,
      }).then(() => {}).catch(() => {});

      return json({ ok: true, action: "burn", amount: parsedAmount, hash });
    }

  } catch (e: unknown) {
    const data = (e as { response?: { data?: unknown } })?.response?.data;
    const msg = data ? JSON.stringify(data) : (e as Error).message;
    return json({ error: msg }, 502);
  }
});
