// Cross-chain USDC payout via Allbridge Core.
// Supports: Stellar USDC → Solana USDC, Stellar USDC → Base USDC.
//
// Two modes:
//   POST { mode: "quote", amount, destinationChain }
//     → { platformFee, bridgeFee, deliveredAmount }
//
//   POST { mode: "execute", sourceWalletId, recipientAddress, destinationChain,
//                           amount, recipientName }
//     → { ok, payoutId, txHash }
//
// Fee model (shown transparently in UI before user confirms):
//   platformFee   = amount × 0.0025  (Theo, 25 bps — goes to distributor)
//   bridgeFee     = Allbridge network fee (deducted on destination side)
//   delivered     = amount − platformFee − bridgeFee
//
// Required env vars:
//   STELLAR_USDC_ISSUER              — USDC asset issuer G-address on testnet
//   STELLAR_DISTRIBUTOR_SECRET       — Theo hot-wallet; receives platform fees
//   ALLBRIDGE_STELLAR_POOL_SOLANA    — Allbridge lock address on Stellar for SOL route
//   ALLBRIDGE_STELLAR_POOL_BASE      — Allbridge lock address on Stellar for Base route
//
// Integration notes (Allbridge Core):
//   - Pool addresses and fee API endpoint:
//       https://docs.allbridge.io/allbridge-core/how-to-transfer
//   - Stellar → Solana: recipient's 32-byte public key as Stellar hash memo
//   - Stellar → Base:   20-byte EVM address right-padded to 32 bytes, hash memo
//   - Before mainnet, replace estimateBridgeFee() with a live API call to
//       POST https://core.api.allbridgecoreapi.net/  (confirm exact path from docs)

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

const PLATFORM_FEE_BPS = 25; // 0.25%
const HORIZON_URL = "https://horizon-testnet.stellar.org";

type DestinationChain = "solana" | "base";

// Returns the Allbridge pool address on Stellar for the given destination chain.
function allbridgePoolAddress(chain: DestinationChain): string | undefined {
  const key = `ALLBRIDGE_STELLAR_POOL_${chain.toUpperCase()}`;
  return Deno.env.get(key);
}

// Encodes the destination address into a 32-byte Stellar hash memo for Allbridge routing.
// Solana: base58-decode the 32-byte public key directly.
// Base:   hex-decode the 20-byte EVM address and right-align in 32 bytes (offset 12).
//
// TODO: Confirm this encoding matches Allbridge Core's expected memo format before mainnet.
//   Reference: https://docs.allbridge.io/allbridge-core/how-to-transfer
function encodeDestinationMemo(address: string, chain: DestinationChain): Uint8Array {
  const buf = new Uint8Array(32);
  if (chain === "solana") {
    const decoded = base58Decode(address);
    buf.set(decoded.slice(0, 32));
  } else {
    // Base / EVM: 20-byte address right-aligned in 32 bytes
    const hex = address.replace(/^0x/, "").padStart(40, "0");
    const bytes = hexToBytes(hex);
    buf.set(bytes, 12);
  }
  return buf;
}

// Estimate the Allbridge network fee for a given gross send amount.
// Currently uses a hardcoded 0.3% estimate (typical Allbridge Core rate).
//
// TODO: Replace with a live call to the Allbridge Core fee API before mainnet.
//   The fee varies with pool liquidity and destination chain gas costs.
async function estimateBridgeFee(sendAmount: number, _chain: DestinationChain): Promise<number> {
  // Allbridge deducts ~0.3% of the amount arriving at their pool.
  const ALLBRIDGE_FEE_RATE = 0.003;
  return round7(sendAmount * ALLBRIDGE_FEE_RATE);
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

// Minimal base58 decoder (Solana public key format).
function base58Decode(input: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const charMap = new Map(ALPHABET.split("").map((c, i) => [c, BigInt(i)]));
  let n = 0n;
  for (const char of input) {
    n = n * 58n + (charMap.get(char) ?? 0n);
  }
  const hex = n.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const { mode, sourceWalletId, recipientAddress, destinationChain, amount, recipientName } = body;

    if (!["solana", "base"].includes(destinationChain as string)) {
      return json({ error: "destinationChain must be 'solana' or 'base'" }, 400);
    }
    const chain = destinationChain as DestinationChain;

    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Invalid amount" }, 400);

    // Fee breakdown (same calculation for both quote and execute)
    const platformFee = round7(parsedAmount * (PLATFORM_FEE_BPS / 10000));
    const amountToPool = round7(parsedAmount - platformFee);
    const bridgeFee = await estimateBridgeFee(amountToPool, chain);
    const deliveredAmount = round7(amountToPool - bridgeFee);

    if (deliveredAmount <= 0) {
      return json({ error: "Amount too small to cover fees" }, 400);
    }

    // ── Quote mode ──────────────────────────────────────────────────────────
    if (mode === "quote") {
      return json({ platformFee, bridgeFee, deliveredAmount });
    }

    // ── Execute mode ────────────────────────────────────────────────────────
    if (mode !== "execute") {
      return json({ error: "mode must be 'quote' or 'execute'" }, 400);
    }

    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    if (!recipientAddress?.trim()) return json({ error: "recipientAddress required" }, 400);
    if (!recipientName?.trim()) return json({ error: "recipientName required" }, 400);

    const poolAddress = allbridgePoolAddress(chain);
    if (!poolAddress) {
      return json({
        error: `ALLBRIDGE_STELLAR_POOL_${chain.toUpperCase()} not configured`,
      }, 500);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    // Wallet must belong to this customer
    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", sourceWalletId)
      .eq("customer_id", customer.id)
      .maybeSingle();
    if (!wallet) return json({ error: "Source wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    // Insert BRIDGING row before submitting — gives visibility if Stellar tx fails
    const { data: payout, error: payErr } = await admin
      .from("payouts")
      .insert({
        customer_id: customer.id,
        source_wallet_id: wallet.id,
        recipient_name: recipientName.trim(),
        recipient_address: recipientAddress.trim(),
        amount_usdc: parsedAmount,
        asset_code: "USDC",
        memo: `bridge-${chain}`,
        status: "BRIDGING",
        destination_chain: chain,
        platform_fee_usdc: platformFee,
        bridge_fee_usdc: bridgeFee,
      })
      .select("id")
      .single();
    if (payErr) throw payErr;

    // Build Stellar transaction:
    //   1. Send (amount - platformFee) to Allbridge pool address
    //   2. Hash memo encodes the recipient address on the destination chain
    const server = new Horizon.Server(HORIZON_URL);
    const sourceKp = Keypair.fromSecret(wallet.stellar_secret);
    const sourceAccount = await server.loadAccount(sourceKp.publicKey());
    const usdc = new Asset("USDC", usdcIssuer);
    const memoBytes = encodeDestinationMemo(recipientAddress.trim(), chain);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: poolAddress,
          asset: usdc,
          amount: amountToPool.toFixed(7),
        })
      )
      .addMemo(Memo.hash(Buffer.from(memoBytes)))
      .setTimeout(60)
      .build();
    tx.sign(sourceKp);

    let hash: string;
    try {
      const result = await server.submitTransaction(tx);
      hash = (result as { hash: string }).hash;
    } catch (stellarErr: unknown) {
      const msg = (stellarErr as { response?: { data?: unknown } })?.response?.data
        ? JSON.stringify((stellarErr as { response: { data: unknown } }).response.data)
        : (stellarErr as Error).message;

      await admin.from("payouts").update({
        status: "FAILED",
        failure_reason: String(msg).slice(0, 1000),
      }).eq("id", payout.id);

      return json({ error: String(msg) }, 502);
    }

    // Stellar leg complete. Allbridge delivery on destination chain is async (1-3 min).
    // Status stays BRIDGING until a webhook or polling confirms destination delivery.
    // For MVP: mark COMPLETED immediately since we have no Allbridge webhook yet.
    // TODO: Add webhook handler or polling job to confirm destination-chain delivery.
    await admin.from("payouts").update({
      status: "COMPLETED",
      stellar_tx_hash: hash,
      completed_at: new Date().toISOString(),
    }).eq("id", payout.id);

    return json({ ok: true, payoutId: payout.id, hash });

  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
