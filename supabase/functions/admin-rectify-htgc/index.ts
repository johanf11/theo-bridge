// Admin-only: burn phantom HTGC (issued by distributor) from a customer wallet
// and mint the equivalent real HTGC (issued by the canonical HTGC_ISSUER).
//
// Call once per wallet that holds phantom HTGC from early testing.
// Body: { walletId: string }
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { signWithSecret } from "../_shared/stellar-signer.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
    if (!htgcIssuerSecret) return json({ error: "STELLAR_HTGC_ISSUER_SECRET not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) return json({ error: "Forbidden — admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const { walletId } = body as { walletId?: string };
    if (!walletId) return json({ error: "walletId required" }, 400);

    const { data: wallet } = await admin
      .from("wallets")
      .select("stellar_address, stellar_secret")
      .eq("id", walletId)
      .maybeSingle();
    if (!wallet) return json({ error: "Wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Wallet has no signing key" }, 400);

    const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
    if (issuerKp.publicKey() !== HTGC_ISSUER) {
      return json({ error: `STELLAR_HTGC_ISSUER_SECRET public key (${issuerKp.publicKey()}) does not match HTGC_ISSUER (${HTGC_ISSUER})` }, 500);
    }

    const walletKp = Keypair.fromSecret(wallet.stellar_secret);
    const server = new Horizon.Server(HORIZON_URL);

    // Inspect wallet balances
    const walletAccount = await server.loadAccount(wallet.stellar_address);
    type HorizonBalance = { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string };
    const bals = walletAccount.balances as HorizonBalance[];

    // Real HTGC (from issuer)
    const realHtgc = bals.find(
      (b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER
    );
    // Phantom HTGC (from distributor or any other key that is not the real issuer)
    const phantomHtgc = bals.find(
      (b) => b.asset_code === "HTGC" && b.asset_issuer !== HTGC_ISSUER
    );

    const realBalance = realHtgc ? Number(realHtgc.balance) : 0;
    const phantomBalance = phantomHtgc ? Number(phantomHtgc.balance) : 0;
    const phantomIssuer = phantomHtgc?.asset_issuer ?? null;

    const steps: string[] = [];

    if (phantomBalance === 0 && realBalance > 0) {
      return json({ ok: true, message: "Wallet already holds only real HTGC — nothing to fix", realBalance, phantomBalance });
    }

    // Step 1: burn phantom HTGC — send back to the phantom issuer (distributor)
    let burnHash: string | null = null;
    if (phantomBalance > 0 && phantomIssuer) {
      const phantomAsset = new Asset("HTGC", phantomIssuer);
      const walletAcct = await server.loadAccount(walletKp.publicKey());
      const burnTx = new TransactionBuilder(walletAcct, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.payment({
          destination: phantomIssuer,
          asset: phantomAsset,
          amount: phantomBalance.toFixed(7),
        }))
        .setTimeout(60)
        .build();
      signWithSecret(burnTx, wallet.stellar_secret);
      const r = await server.submitTransaction(burnTx);
      burnHash = (r as { hash: string }).hash;
      steps.push(`Burned ${phantomBalance} phantom HTGC (issuer ${phantomIssuer}) — tx ${burnHash}`);
    }

    // Step 1b: close phantom trustline (requires balance = 0)
    if (phantomIssuer) {
      try {
        const phantomAsset = new Asset("HTGC", phantomIssuer);
        const walletAcct = await server.loadAccount(walletKp.publicKey());
        const closeTx = new TransactionBuilder(walletAcct, {
          fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
        })
          .addOperation(Operation.changeTrust({ asset: phantomAsset, limit: "0" }))
          .setTimeout(60)
          .build();
        signWithSecret(closeTx, wallet.stellar_secret);
        await server.submitTransaction(closeTx);
        steps.push(`Closed phantom HTGC trustline (issuer ${phantomIssuer})`);
      } catch (e: unknown) {
        steps.push(`Could not close phantom trustline: ${(e as Error).message}`);
      }
    }

    // Step 2: ensure real HTGC trustline exists
    const hasRealTrust = bals.some(
      (b) => b.asset_code === "HTGC" && b.asset_issuer === HTGC_ISSUER
    );
    const realHtgcAsset = new Asset("HTGC", HTGC_ISSUER);

    if (!hasRealTrust) {
      const walletAcct = await server.loadAccount(walletKp.publicKey());
      const trustTx = new TransactionBuilder(walletAcct, {
        fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset: realHtgcAsset }))
        .setTimeout(60)
        .build();
      signWithSecret(trustTx, wallet.stellar_secret);
      await server.submitTransaction(trustTx);
      steps.push("Opened real HTGC trustline");
    }

    // Step 3: mint real HTGC from issuer — amount = phantom burned (or re-mint what was already real if 0)
    const mintAmount = phantomBalance > 0 ? phantomBalance : realBalance;
    if (mintAmount <= 0) {
      return json({ ok: true, message: "No HTGC to rectify (both phantom and real are 0)", steps });
    }

    const issuerAcct = await server.loadAccount(issuerKp.publicKey());
    const mintTx = new TransactionBuilder(issuerAcct, {
      fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.setTrustLineFlags({
        trustor: wallet.stellar_address,
        asset: realHtgcAsset,
        flags: { authorized: true },
      }))
      .addOperation(Operation.payment({
        destination: wallet.stellar_address,
        asset: realHtgcAsset,
        amount: mintAmount.toFixed(7),
      }))
      .setTimeout(60)
      .build();
    mintTx.sign(issuerKp);
    const r2 = await server.submitTransaction(mintTx);
    const mintHash = (r2 as { hash: string }).hash;
    steps.push(`Minted ${mintAmount} real HTGC from issuer ${HTGC_ISSUER} — tx ${mintHash}`);

    return json({ ok: true, steps, burnHash, mintHash, mintAmount });
  } catch (e) {
    console.error("admin-rectify-htgc error", e);
    const msg = (e as { response?: { data?: unknown } })?.response?.data
      ? JSON.stringify((e as { response: { data: unknown } }).response.data)
      : (e as Error).message;
    return json({ error: msg }, 500);
  }
});
