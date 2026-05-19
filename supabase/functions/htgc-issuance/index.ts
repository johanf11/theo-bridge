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
import { safePostLedger } from "../_shared/ledger.ts";

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

      // Ledger: HTG received into SPIH pool backs the newly minted HTG-C supply.
      // Dr SPIH_BANK_HTG (HTG in reserve) / Cr HTGC_ISSUED (supply increases).
      await safePostLedger(admin, "htgc-issuance:mint", {
        kind: "HTGC_MINT",
        description: `Mint ${parsedAmount} HTG-C → ${destinationAddress}`,
        postedBy: user.id,
        sourceKey: `htgc_issuance:mint:${hash}`,
        entries: [
          { code: "SPIH_BANK_HTG", currency: "HTG", debit:  parsedAmount },
          { code: "HTGC_ISSUED",   currency: "HTG", credit: parsedAmount },
        ],
      }, { stellarTxHash: hash });

      return json({ ok: true, action: "mint", amount: parsedAmount, hash });

    } else {
      // ── BURN: issuer claws back HTG-C from source wallet ────────────────────
      // Using Operation.clawback — the issuer signs (no need for wallet secret).
      // Asset must have clawback enabled on the trustline (auth_clawback_enabled).
      const { sourceAddress } = body;
      if (!sourceAddress?.startsWith("G")) return json({ error: "Valid sourceAddress required" }, 400);

      // Issuer account signs the clawback tx
      const issuerAccount = await server.loadAccount(htgcIssuer);

      const tx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.clawback({
          asset: htgc,
          from: sourceAddress,
          amount: parsedAmount.toFixed(7),
        }))
        .setTimeout(60);

      if (memo?.trim()) tx.addMemo(Memo.text(memo.trim().slice(0, 28)));
      const built = tx.build();
      built.sign(issuerKp);

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

      // Ledger: burn reduces outstanding HTG-C supply; HTG leaves SPIH pool (bank pays out).
      // Dr HTGC_ISSUED (liability decreases) / Cr SPIH_BANK_HTG (asset decreases).
      await safePostLedger(admin, "htgc-issuance:burn", {
        kind: "HTGC_BURN",
        description: `Burn ${parsedAmount} HTG-C from ${sourceAddress}`,
        postedBy: user.id,
        sourceKey: `htgc_issuance:burn:${hash}`,
        entries: [
          { code: "HTGC_ISSUED",   currency: "HTG", debit:  parsedAmount },
          { code: "SPIH_BANK_HTG", currency: "HTG", credit: parsedAmount },
        ],
      }, { stellarTxHash: hash });

      return json({ ok: true, action: "burn", amount: parsedAmount, hash });
    }

  } catch (e: unknown) {
    const data = (e as { response?: { data?: unknown } })?.response?.data;
    const msg = data ? JSON.stringify(data) : (e as Error).message;
    console.error("[htgc-issuance] error:", msg, "stack:", (e as Error)?.stack);
    return json({ error: msg }, 502);
  }
});
