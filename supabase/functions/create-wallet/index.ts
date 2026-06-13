import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { corsHeaders } from "../_shared/cors.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const label = String(body.label ?? "").trim().slice(0, 60) || "New account";

    // Find caller's customer record (filter explicitly — admins can see all rows)
    const userId = user.id;
    let { data: customer, error: custErr } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();

    if (custErr) throw custErr;

    if (!customer) {
      const metadata = user.user_metadata ?? {};
      const fallbackEmail = user.email ?? `${userId}@theo.local`;
      const { data: createdCustomer, error: createCustErr } = await admin
        .from("customers")
        .insert({
          user_id: userId,
          company_name: String(metadata.company_name ?? metadata.full_name ?? metadata.name ?? fallbackEmail),
          email: fallbackEmail,
          phone: typeof metadata.phone === "string" ? metadata.phone : null,
        })
        .select("id")
        .single();

      if (createCustErr || !createdCustomer) {
        return new Response(JSON.stringify({ error: createCustErr?.message ?? "Customer profile could not be created" }), {
          status: 500,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      customer = createdCustomer;
    }

    if (!customer) {
      return new Response(JSON.stringify({ error: "Customer profile unavailable" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const issuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!issuer) {
      return new Response(JSON.stringify({ error: "Stellar config missing" }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // 1. Generate keypair
    const kp = Keypair.random();
    const publicKey = kp.publicKey();
    const secret = kp.secret();

    // 2. Friendbot fund
    const fb = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
    if (!fb.ok) {
      const txt = await fb.text();
      return new Response(JSON.stringify({ error: "Friendbot funding failed", detail: txt }), {
        status: 502,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // 3. Establish trustlines (USDC + HTG-C) — signed by the new account itself.
    const server = new Horizon.Server(HORIZON_URL);
    const usdc = new Asset("USDC", issuer);
    const htgc = new Asset("HTGC", HTGC_ISSUER);

    async function trust(asset: Asset) {
      const acct = await server.loadAccount(publicKey);
      const tx = new TransactionBuilder(acct, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset }))
        .setTimeout(60)
        .build();
      tx.sign(kp);
      await server.submitTransaction(tx);
    }

    // Submit independently so one failure doesn't block the other.
    const trustResults: { asset: string; ok: boolean; error?: string }[] = [];
    for (const [code, asset] of [["USDC", usdc], ["HTGC", htgc]] as const) {
      try {
        await trust(asset);
        trustResults.push({ asset: code, ok: true });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: unknown } })?.response?.data
          ? JSON.stringify((err as { response: { data: unknown } }).response.data)
          : (err as Error).message;
        trustResults.push({ asset: code, ok: false, error: String(msg).slice(0, 500) });
        console.error(`trustline ${code} failed for ${publicKey}`, msg);
      }
    }

    // The HTGC issuer requires authorization on each trustline before the wallet can
    // receive HTGC. Authorize the new wallet's HTGC trustline using the issuer secret.
    const htgcOk = trustResults.find((r) => r.asset === "HTGC")?.ok;
    if (htgcOk) {
      const htgcIssuerSecret = Deno.env.get("STELLAR_HTGC_ISSUER_SECRET");
      if (htgcIssuerSecret) {
        try {
          const issuerKp = Keypair.fromSecret(htgcIssuerSecret);
          if (issuerKp.publicKey() === HTGC_ISSUER) {
            const issuerAcct = await server.loadAccount(issuerKp.publicKey());
            const authTx = new TransactionBuilder(issuerAcct, {
              fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
            })
              .addOperation(Operation.setTrustLineFlags({
                trustor: publicKey,
                asset: htgc,
                flags: { authorized: true },
              }))
              .setTimeout(60)
              .build();
            authTx.sign(issuerKp);
            await server.submitTransaction(authTx);
          } else {
            console.error(`STELLAR_HTGC_ISSUER_SECRET pubkey ${issuerKp.publicKey()} != HTGC_ISSUER ${HTGC_ISSUER}`);
          }
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: unknown } })?.response?.data
            ? JSON.stringify((err as { response: { data: unknown } }).response.data)
            : (err as Error).message;
          console.error(`HTGC trustline authorization failed for ${publicKey}`, msg);
        }
      }
    }

    // The USDC issuer also has AUTH_REQUIRED — authorize the new wallet's USDC
    // trustline using the USDC issuer secret. Without this, payments fail with op_not_authorized.
    const usdcOk = trustResults.find((r) => r.asset === "USDC")?.ok;
    if (usdcOk) {
      const usdcIssuerSecret = Deno.env.get("STELLAR_USDC_ISSUER_SECRET");
      if (usdcIssuerSecret) {
        try {
          const issuerKp = Keypair.fromSecret(usdcIssuerSecret);
          const issuerAcct = await server.loadAccount(issuerKp.publicKey());
          const authTx = new TransactionBuilder(issuerAcct, {
            fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
          })
            .addOperation(Operation.setTrustLineFlags({
              trustor: publicKey,
              asset: usdc,
              flags: { authorized: true },
            }))
            .setTimeout(60)
            .build();
          authTx.sign(issuerKp);
          await server.submitTransaction(authTx);
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: unknown } })?.response?.data
            ? JSON.stringify((err as { response: { data: unknown } }).response.data)
            : (err as Error).message;
          console.error(`USDC trustline authorization failed for ${publicKey}`, msg);
        }
      }
    }

    // 4. Persist (service role bypasses RLS; trustworthy because user verified above)
    const { data: inserted, error: insErr } = await admin
      .from("wallets")
      .insert({
        customer_id: customer.id,
        label,
        stellar_address: publicKey,
        stellar_secret: secret,
        wallet_type: "CUSTOMER",
        currency: "USDC",
        network: "Stellar",
      })
      .select("id, label, stellar_address")
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ wallet: inserted, public_key: publicKey, trustlines: trustResults }),
      { headers: { ...headers, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});
