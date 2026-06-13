import { createClient } from "jsr:@supabase/supabase-js@2";
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE } from "npm:@stellar/stellar-sdk@12.3.0";
import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER")!;
  const usdcIssuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
  const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(url, service);
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!role) return json({ error: "Admin only" }, 403);

  const { walletId } = await req.json();
  if (!walletId) return json({ error: "walletId required" }, 400);

  const { data: wallet } = await admin.from("wallets").select("stellar_address, stellar_secret").eq("id", walletId).maybeSingle();
  if (!wallet) return json({ error: "Wallet not found" }, 404);

  const server = new Horizon.Server("https://horizon-testnet.stellar.org");

  // Step 1: ensure trustlines exist + HTGC authorized
  const ready = await ensureWalletReady({
    server, address: wallet.stellar_address, secret: wallet.stellar_secret,
    usdcIssuer, htgcIssuerSecret, network: "TESTNET",
  });
  if (!ready.ok) return json({ error: ready.error }, 502);

  // Step 2: explicitly authorize USDC trustline via issuer
  const healed = [...ready.healed];
  if (usdcIssuerSecret) {
    try {
      const usdc = new Asset("USDC", usdcIssuer);
      const issuerKp = Keypair.fromSecret(usdcIssuerSecret);
      const issuerAccount = await server.loadAccount(issuerKp.publicKey());
      const tx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.setTrustLineFlags({
          trustor: wallet.stellar_address,
          asset: usdc,
          flags: { authorized: true },
        }))
        .setTimeout(60).build();
      tx.sign(issuerKp);
      await server.submitTransaction(tx);
      healed.push("auth:USDC");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((e as { response: { data: unknown } }).response.data)
        : (e as Error).message;
      // If already authorized, that's fine
      if (!msg.includes("op_already_exists") && !msg.includes("op_success")) {
        console.warn("USDC auth warning:", msg);
      }
    }
  }

  return json({ ok: true, healed });
});
