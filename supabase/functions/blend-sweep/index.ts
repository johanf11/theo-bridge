// Sweep USDC from a customer wallet into the Blend lending pool on Stellar testnet.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  Account, Address, Asset, Contract, Keypair, Networks, TransactionBuilder,
  nativeToScVal, rpc, scValToNative, xdr,
} from "npm:@stellar/stellar-sdk@12.3.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const NETWORK = Networks.TESTNET;

// Blend RequestType enum: 2 = SupplyCollateral
const REQUEST_SUPPLY_COLLATERAL = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const usdcIssuer = Deno.env.get("STELLAR_USDC_ISSUER");
    const poolAddress = Deno.env.get("BLEND_POOL_ADDRESS");
    if (!usdcIssuer) return json({ error: "STELLAR_USDC_ISSUER not configured" }, 500);
    if (!poolAddress) return json({ error: "BLEND_POOL_ADDRESS not configured" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: ue } = await userClient.auth.getUser();
    if (ue || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(url, service);

    const { data: customer } = await admin
      .from("customers").select("id").eq("user_id", user.id).maybeSingle();
    if (!customer) return json({ error: "Customer not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { sourceWalletId, amount } = body;
    if (!sourceWalletId) return json({ error: "sourceWalletId required" }, 400);
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) return json({ error: "Valid amount required" }, 400);

    const { data: wallet } = await admin
      .from("wallets")
      .select("id, stellar_address, stellar_secret")
      .eq("id", sourceWalletId).eq("customer_id", customer.id).maybeSingle();
    if (!wallet) return json({ error: "Source wallet not found" }, 404);
    if (!wallet.stellar_secret) return json({ error: "Source wallet has no signing key" }, 400);

    const sourceKp = Keypair.fromSecret(wallet.stellar_secret);
    const usdcAsset = new Asset("USDC", usdcIssuer);
    const usdcContractId = usdcAsset.contractId(NETWORK);

    // Stroops: Stellar uses 7-decimal fixed point
    const amountStroops = BigInt(Math.round(parsedAmount * 10_000_000));

    const server = new rpc.Server(SOROBAN_RPC, { allowHttp: false });
    const account = await server.getAccount(sourceKp.publicKey());

    const fromAddr = Address.fromString(sourceKp.publicKey());
    const poolContract = new Contract(poolAddress);

    // Build the Request struct: { request_type: u32, address: Address, amount: i128 }
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
        val: nativeToScVal(REQUEST_SUPPLY_COLLATERAL, { type: "u32" }),
      }),
    ]);

    const operation = poolContract.call(
      "submit",
      nativeToScVal(fromAddr, { type: "address" }), // from
      nativeToScVal(fromAddr, { type: "address" }), // spender
      nativeToScVal(fromAddr, { type: "address" }), // to
      xdr.ScVal.scvVec([request]),                  // requests: Vec<Request>
    );

    let tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: NETWORK })
      .addOperation(operation)
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      return json({ error: `Simulation failed: ${sim.error}` }, 502);
    }

    tx = rpc.assembleTransaction(tx, sim).build();
    tx.sign(sourceKp);

    const send = await server.sendTransaction(tx);
    if (send.status === "ERROR") {
      return json({ error: `Submit failed: ${JSON.stringify(send.errorResult)}` }, 502);
    }

    // Poll for completion
    let getResp = await server.getTransaction(send.hash);
    const start = Date.now();
    while (getResp.status === "NOT_FOUND" && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 1500));
      getResp = await server.getTransaction(send.hash);
    }
    if (getResp.status !== "SUCCESS") {
      return json({ error: `Tx ${getResp.status}`, hash: send.hash }, 502);
    }

    // Upsert position
    const { data: existing } = await admin
      .from("blend_positions")
      .select("id, deposited_usdc")
      .eq("wallet_id", wallet.id).eq("pool_address", poolAddress).maybeSingle();

    const now = new Date().toISOString();
    if (existing) {
      await admin.from("blend_positions").update({
        deposited_usdc: Number(existing.deposited_usdc) + parsedAmount,
        last_tx_hash: send.hash, last_synced_at: now,
      }).eq("id", existing.id);
    } else {
      await admin.from("blend_positions").insert({
        customer_id: customer.id, wallet_id: wallet.id,
        pool_address: poolAddress, reserve_asset: "USDC",
        deposited_usdc: parsedAmount, last_tx_hash: send.hash, last_synced_at: now,
      });
    }

    return json({ ok: true, hash: send.hash });
  } catch (e) {
    console.error("blend-sweep error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
