// Withdraw USDC from a Blend lending pool back to the customer wallet on Stellar testnet.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Address, Asset, Contract, Keypair, Networks, TransactionBuilder,
  nativeToScVal, rpc, xdr,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

// Blend RequestType: 3 = WithdrawCollateral
const REQUEST_WITHDRAW_COLLATERAL = 3;
// i128 max — used as "withdraw all"
const MAX_I128 = (BigInt(1) << BigInt(127)) - BigInt(1);

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
    const poolAddress = Deno.env.get("BLEND_POOL_ADDRESS");
    if (!usdcIssuer || !poolAddress) return json({ error: "Stellar/Blend not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);
    const { data: customer } = await admin.from("customers").select("id").eq("user_id", user.id).maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { walletId, amount } = body;
    if (!walletId) return json({ error: "walletId required" }, 400);

    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", walletId).eq("customer_id", customer.id).maybeSingle();
    if (!wallet?.stellar_secret) return json({ error: "Wallet not found or unsigned" }, 404);

    const { data: position } = await admin
      .from("blend_positions").select("id, deposited_usdc")
      .eq("wallet_id", walletId).eq("pool_address", poolAddress).maybeSingle();
    if (!position) return json({ error: "No Blend position for this wallet" }, 404);

    const isMax = amount === "max" || amount === undefined;
    const parsedAmount = isMax ? Number(position.deposited_usdc) : parseFloat(amount);
    if (!isMax && (!parsedAmount || parsedAmount <= 0)) return json({ error: "Valid amount required" }, 400);

    const sourceKp = Keypair.fromSecret(wallet.stellar_secret);
    const usdcContractId = new Asset("USDC", usdcIssuer).contractId(NETWORK);
    const amountStroops = isMax ? MAX_I128 : BigInt(Math.round(parsedAmount * 10_000_000));

    const server = new rpc.Server(SOROBAN_RPC, { allowHttp: false });
    const account = await server.getAccount(sourceKp.publicKey());
    const fromAddr = Address.fromString(sourceKp.publicKey());
    const poolContract = new Contract(poolAddress);

    const request = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: nativeToScVal("address", { type: "symbol" }),
        val: nativeToScVal(usdcContractId, { type: "address" }),
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("amount", { type: "symbol" }),
        val: nativeToScVal(amountStroops, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: nativeToScVal("request_type", { type: "symbol" }),
        val: nativeToScVal(REQUEST_WITHDRAW_COLLATERAL, { type: "u32" }),
      }),
    ]);

    const operation = poolContract.call(
      "submit",
      nativeToScVal(fromAddr, { type: "address" }),
      nativeToScVal(fromAddr, { type: "address" }),
      nativeToScVal(fromAddr, { type: "address" }),
      xdr.ScVal.scvVec([request]),
    );

    let tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: NETWORK })
      .addOperation(operation).setTimeout(60).build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) return json({ error: `Simulation failed: ${sim.error}` }, 502);
    tx = rpc.assembleTransaction(tx, sim).build();
    tx.sign(sourceKp);

    const send = await server.sendTransaction(tx);
    if (send.status === "ERROR") return json({ error: `Submit failed: ${JSON.stringify(send.errorResult)}` }, 502);

    let getResp = await server.getTransaction(send.hash);
    const start = Date.now();
    while (getResp.status === "NOT_FOUND" && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 1500));
      getResp = await server.getTransaction(send.hash);
    }
    if (getResp.status !== "SUCCESS") return json({ error: `Tx ${getResp.status}`, hash: send.hash }, 502);

    const now = new Date().toISOString();
    if (isMax) {
      await admin.from("blend_positions").delete().eq("id", position.id);
    } else {
      const remaining = Math.max(0, Number(position.deposited_usdc) - parsedAmount);
      if (remaining <= 0) {
        await admin.from("blend_positions").delete().eq("id", position.id);
      } else {
        await admin.from("blend_positions").update({
          deposited_usdc: remaining, last_tx_hash: send.hash, last_synced_at: now,
        }).eq("id", position.id);
      }
    }

    return json({ ok: true, hash: send.hash });
  } catch (e) {
    console.error("blend-withdraw error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
