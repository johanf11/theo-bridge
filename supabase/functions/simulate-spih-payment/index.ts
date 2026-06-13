// Admin-only debug: flip QUOTED -> FUNDED, then invoke release-usdc.
// For htgc_mint orders: mint real HTG-C 1:1 from the HTG-C issuer
// directly to the destination wallet, opening a trustline first if needed.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "../_shared/stellar-assets.ts";
import { postLedger } from "../_shared/ledger.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { hmacVerifyHex } from "../_shared/hmac.ts";

const HORIZON = "https://horizon-testnet.stellar.org";

// Best-effort Telegram sender. No-ops if the bot token isn't configured, and
// never throws — a notification failure must not affect order processing.
async function sendTelegram(method: string, payload: object) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("sendTelegram failed", e);
  }
}

// Notify the admin chat that an order was confirmed from the web Admin Debug
// (NOT via the Telegram "Confirm Payment Received" button). This tells whoever
// watches the chat that the order is already handled, so nobody taps Confirm
// and triggers a harmless "Order not in QUOTED state" error on a stale message.
async function notifyManualAdminConfirm(
  admin: ReturnType<typeof createClient>,
  opts: { reference: string; htgAmount: number; outcome: string; userId: string | null },
) {
  const chatId = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID");
  if (!chatId) return;

  let who = opts.userId ?? "unknown admin";
  if (opts.userId) {
    try {
      const { data } = await admin.auth.admin.getUserById(opts.userId);
      if (data?.user?.email) who = data.user.email;
    } catch { /* best-effort — fall back to the user id */ }
  }

  const htg = Number(opts.htgAmount).toLocaleString("en-US", { maximumFractionDigits: 0 });
  await sendTelegram("sendMessage", {
    chat_id: chatId,
    parse_mode: "Markdown",
    text: `⚙️ *Confirmed via Admin Debug*\n\n` +
      `Reference: \`${opts.reference}\`\n` +
      `HTG: *${htg} HTG*\n` +
      `Result: ${opts.outcome}\n` +
      `By: ${who}\n\n` +
      `Processed from the web admin — *do not tap Confirm* on the order message above.`,
  });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token === service;

    // Parse the body once — both auth paths need orderId.
    const reqBody = await req.json().catch(() => ({}));
    const orderId = reqBody.orderId ?? reqBody.order_id;
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let userId: string | null = null;
    if (isServiceRole) {
      // Service-role callers must bind the call to a specific orderId via HMAC.
      // Prevents a leaked SUPABASE_SERVICE_ROLE_KEY (or Telegram webhook secret)
      // from being combined with arbitrary order_ids to confirm orders.
      const signature = req.headers.get("X-Order-Signature");
      const hmacSecret = Deno.env.get("SPIH_CONFIRM_HMAC_SECRET");
      if (!signature || !hmacSecret) {
        return new Response(JSON.stringify({ error: "Missing signature" }), {
          status: 401, headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      const ok = await hmacVerifyHex(hmacSecret, String(orderId), signature);
      if (!ok) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403, headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    } else {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
      const { data: u, error: ue } = await userClient.auth.getUser();
      if (ue || !u.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      userId = u.user.id;

      const adminCheck = createClient(url, service);
      const { data: roleRow } = await adminCheck
        .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(url, service);

    // Look up the order to branch on kind
    const { data: existing, error: exErr } = await admin
      .from("orders")
      .select("id, status, order_kind, htg_amount, reference_number, customer_id, destination_wallet_address, destination_stellar_address")
      .eq("id", orderId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing || existing.status !== "QUOTED") {
      return new Response(JSON.stringify({ error: "Order not in QUOTED state" }), {
        status: 409, headers: { ...headers, "Content-Type": "application/json" },
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

      // Ledger: HTG cash received from customer backs the newly minted HTG-C supply.
      // Mint completes atomically — credit HTGC_ISSUED (outstanding float), not CUSTOMER_HTG_PENDING.
      // Dr SPIH_BANK_HTG (HTG in reserve increases) / Cr HTGC_ISSUED (outstanding float increases).
      try {
        const htg = Number(existing.htg_amount);
        await postLedger(admin, {
          orderId,
          kind: "HTGC_MINT",
          description: `HTG-C mint for order ${existing.reference_number}`,
          postedBy: userId ?? undefined,
          sourceKey: `spih_mint:${orderId}`,
          stellarTxHash: hash,
          entries: [
            { code: "SPIH_BANK_HTG", currency: "HTG", debit:  htg },
            { code: "HTGC_ISSUED",   currency: "HTG", credit: htg, customerId: existing.customer_id ?? undefined },
          ],
        });
      } catch (le) {
        console.error("ledger HTGC_MINT failed", le);
      }

      // Manual admin-debug confirm → tell the Telegram chat it's already handled.
      if (!isServiceRole) {
        await notifyManualAdminConfirm(admin, {
          reference: String(existing.reference_number),
          htgAmount: Number(existing.htg_amount),
          outcome: "HTG-C delivered",
          userId,
        });
      }

      return new Response(JSON.stringify({ ok: true, status: "COMPLETED", hash }), {
        status: 200, headers: { ...headers, "Content-Type": "application/json" },
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
        status: 409, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Ledger: HTG enters SPIH bank (asset); we owe customer the HTG (liability).
    try {
      const htg = Number(existing.htg_amount);
      await postLedger(admin, {
        orderId,
        kind: "SPIH_CASH_IN",
        description: `SPIH cash-in for order ${existing.reference_number}`,
        postedBy: userId ?? undefined,
        entries: [
          { code: "SPIH_BANK_HTG",        currency: "HTG", debit:  htg },
          { code: "CUSTOMER_HTG_PENDING", currency: "HTG", credit: htg, customerId: existing.customer_id ?? undefined },
        ],
      });
    } catch (le) {
      console.error("ledger SPIH_CASH_IN failed", le);
    }

    // Invoke release-usdc with the caller's auth header (it requires an admin JWT).
    // Awaited so failures surface immediately and the order doesn't get stuck in FUNDED.
    try {
      const releaseRes = await fetch(`${url}/functions/v1/release-usdc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
        },
        body: JSON.stringify({ orderId }),
      });
      if (!releaseRes.ok) {
        const text = await releaseRes.text();
        console.error("release-usdc failed", releaseRes.status, text);
        // release-usdc itself marks the order FAILED on error; surface the message.
        return new Response(JSON.stringify({ error: `release-usdc failed: ${text}` }), {
          status: 502, headers: { ...headers, "Content-Type": "application/json" },
        });
      }
      const releaseJson = await releaseRes.json().catch(() => ({}));

      // Manual admin-debug confirm → tell the Telegram chat it's already handled.
      if (!isServiceRole) {
        await notifyManualAdminConfirm(admin, {
          reference: String(existing.reference_number),
          htgAmount: Number(existing.htg_amount),
          outcome: "USDC released to customer",
          userId,
        });
      }

      return new Response(JSON.stringify({ ok: true, status: "COMPLETED", ...releaseJson }), {
        status: 200, headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("release-usdc invoke error", e);
      await admin.from("orders")
        .update({ status: "FAILED", failure_reason: `release-usdc invoke error: ${(e as Error).message}`.slice(0, 1000) })
        .eq("id", orderId);
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 502, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, status: "FUNDED" }), {
      status: 200, headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("simulate-spih-payment error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
