// Admin-only one-shot: walk every wallet with a stored secret and ensure
// it has trustlines for both USDC and HTG-C. Idempotent — skips wallets
// that already trust the asset.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...headers, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) return json({ error: "Stellar config missing" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    // Admin gate
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Admin only" }, 403);

    const assets: { code: string; asset: Asset }[] = [
      { code: "USDC", asset: new Asset("USDC", usdcIssuer) },
      { code: "HTGC", asset: new Asset("HTGC", HTGC_ISSUER) },
    ];

    const { data: wallets, error: wErr } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .not("stellar_secret", "is", null);
    if (wErr) throw wErr;

    const server = new Horizon.Server(HORIZON_URL);
    let checked = 0;
    let usdcAdded = 0;
    let htgcAdded = 0;
    const errors: { walletId: string; asset: string; error: string }[] = [];

    for (const w of wallets ?? []) {
      checked++;
      let acct;
      try {
        acct = await server.loadAccount(w.stellar_address);
      } catch (e) {
        errors.push({ walletId: w.id, asset: "ACCOUNT", error: (e as Error).message.slice(0, 300) });
        continue;
      }

      for (const { code, asset } of assets) {
        const has = acct.balances.some((b: { asset_type: string; asset_code?: string; asset_issuer?: string }) =>
          b.asset_type !== "native" && b.asset_code === code && b.asset_issuer === asset.getIssuer()
        );
        if (has) continue;

        try {
          const fresh = await server.loadAccount(w.stellar_address);
          const kp = Keypair.fromSecret(w.stellar_secret as string);
          const tx = new TransactionBuilder(fresh, {
            fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
          })
            .addOperation(Operation.changeTrust({ asset }))
            .setTimeout(60)
            .build();
          tx.sign(kp);
          await server.submitTransaction(tx);
          if (code === "USDC") usdcAdded++;
          else htgcAdded++;
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: unknown } })?.response?.data
            ? JSON.stringify((err as { response: { data: unknown } }).response.data)
            : (err as Error).message;
          errors.push({ walletId: w.id, asset: code, error: String(msg).slice(0, 300) });
        }
      }
    }

    return json({ ok: true, checked, usdcAdded, htgcAdded, errors });
  } catch (e) {
    console.error("backfill-trustlines error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
