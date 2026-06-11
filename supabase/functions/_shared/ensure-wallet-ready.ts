// Self-healing wallet readiness check.
// Guarantees a Theo-owned Stellar wallet has authorized trustlines for every
// supported asset (USDC, HTGC) before any transfer/swap/payout runs.
//
// Usage from any edge function:
//   import { ensureWalletReady } from "../_shared/ensure-wallet-ready.ts";
//   const ready = await ensureWalletReady({ server, address, secret });
//   if (!ready.ok) return json({ error: ready.error }, 502);
//
// Idempotent: skips ops that are already in the correct state. Safe to call
// on every transfer — adds ~1 Horizon round trip when everything is healthy.
import {
  Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE,
} from "npm:@stellar/stellar-sdk@12.3.0";
import { HTGC_ISSUER } from "./stellar-assets.ts";

export type EnsureResult =
  | { ok: true; healed: string[] }
  | { ok: false; error: string };

type Balance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
};

const stellarErrMsg = (e: unknown): string => {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  return data ? JSON.stringify(data) : (e as Error).message;
};

export async function ensureWalletReady(opts: {
  server: Horizon.Server;
  address: string;
  secret: string;          // wallet's signing key (we own it)
  usdcIssuer: string;
  htgcIssuerSecret?: string; // optional — required only if HTGC trustline needs auth
  usdcIssuerSecret?: string; // optional — required only if USDC trustline needs auth
  network?: "TESTNET" | "PUBLIC";
}): Promise<EnsureResult> {
  const network = opts.network ?? "TESTNET";
  const passphrase = network === "PUBLIC" ? Networks.PUBLIC : Networks.TESTNET;
  const healed: string[] = [];

  let account;
  try {
    account = await opts.server.loadAccount(opts.address);
  } catch (e) {
    return { ok: false, error: `Wallet not found on Stellar: ${stellarErrMsg(e)}` };
  }

  const usdc = new Asset("USDC", opts.usdcIssuer);
  const htgc = new Asset("HTGC", HTGC_ISSUER);
  const required: { asset: Asset; needsAuth: boolean }[] = [
    { asset: usdc, needsAuth: false },
    { asset: htgc, needsAuth: true },
  ];

  const balances = account.balances as Balance[];
  const findTrust = (a: Asset) => balances.find((b) =>
    b.asset_type !== "native" && b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer()
  );

  // 1) Establish missing trustlines (signed by wallet).
  const missing = required.filter((r) => !findTrust(r.asset)).map((r) => r.asset);
  if (missing.length > 0) {
    try {
      const kp = Keypair.fromSecret(opts.secret);
      const builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase });
      for (const a of missing) builder.addOperation(Operation.changeTrust({ asset: a }));
      const tx = builder.setTimeout(60).build();
      tx.sign(kp);
      await opts.server.submitTransaction(tx);
      for (const a of missing) healed.push(`trustline:${a.getCode()}`);
      // Reload to see new trustlines for the auth step.
      account = await opts.server.loadAccount(opts.address);
    } catch (e) {
      return { ok: false, error: `Trustline setup failed: ${stellarErrMsg(e)}` };
    }
  }

  // 2) Authorize HTGC trustline if not yet authorized (signed by HTGC issuer).
  const htgcTrust = findTrustOnAccount(account.balances as Balance[], htgc);
  const htgcAuthorized = htgcTrust?.is_authorized === true;
  if (!htgcAuthorized) {
    if (!opts.htgcIssuerSecret) {
      return { ok: false, error: "HTGC trustline not authorized and STELLAR_HTGC_ISSUER_SECRET not provided" };
    }
    try {
      const issuerKp = Keypair.fromSecret(opts.htgcIssuerSecret);
      if (issuerKp.publicKey() !== HTGC_ISSUER) {
        return { ok: false, error: `STELLAR_HTGC_ISSUER_SECRET pubkey ${issuerKp.publicKey()} != HTGC_ISSUER ${HTGC_ISSUER}` };
      }
      const issuerAccount = await opts.server.loadAccount(issuerKp.publicKey());
      const authTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: passphrase })
        .addOperation(Operation.setTrustLineFlags({
          trustor: opts.address,
          asset: htgc,
          flags: { authorized: true },
        }))
        .setTimeout(60)
        .build();
      authTx.sign(issuerKp);
      await opts.server.submitTransaction(authTx);
      healed.push("auth:HTGC");
    } catch (e) {
      return { ok: false, error: `HTGC trustline authorization failed: ${stellarErrMsg(e)}` };
    }
  }

  // 3) Authorize USDC trustline if not yet authorized (signed by USDC issuer).
  const usdcTrust = findTrustOnAccount(account.balances as Balance[], usdc);
  const usdcAuthorized = usdcTrust?.is_authorized === true;
  if (!usdcAuthorized && opts.usdcIssuerSecret) {
    try {
      const usdcIssuerKp = Keypair.fromSecret(opts.usdcIssuerSecret);
      const issuerAccount = await opts.server.loadAccount(usdcIssuerKp.publicKey());
      const authTx = new TransactionBuilder(issuerAccount, { fee: BASE_FEE, networkPassphrase: passphrase })
        .addOperation(Operation.setTrustLineFlags({
          trustor: opts.address,
          asset: usdc,
          flags: { authorized: true },
        }))
        .setTimeout(60)
        .build();
      authTx.sign(usdcIssuerKp);
      await opts.server.submitTransaction(authTx);
      healed.push("auth:USDC");
    } catch (e) {
      return { ok: false, error: `USDC trustline authorization failed: ${stellarErrMsg(e)}` };
    }
  }

  return { ok: true, healed };
}

function findTrustOnAccount(balances: Balance[], a: Asset): Balance | undefined {
  return balances.find((b) =>
    b.asset_type !== "native" && b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer()
  );
}
