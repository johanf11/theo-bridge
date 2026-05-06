// Centralised signing helpers — the ONLY place in the codebase that reads
// STELLAR_DISTRIBUTOR_SECRET. All other edge functions must import from here.
//
// Migration path: replace signWithDistributor() body with an HTTP call to a
// signing microservice (AWS Lambda + CloudHSM) when moving to production.

import {
  Keypair,
  Transaction,
} from "npm:@stellar/stellar-sdk@12.3.0";

/** Sign a transaction with a customer wallet's stored secret. */
export function signWithSecret(tx: Transaction, secret: string): void {
  tx.sign(Keypair.fromSecret(secret));
}

/** Sign a transaction with the platform distributor key. */
export function signWithDistributor(tx: Transaction): void {
  const secret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
  if (!secret) throw new Error("STELLAR_DISTRIBUTOR_SECRET not configured");
  tx.sign(Keypair.fromSecret(secret));
}

/** Return the distributor's public key without exposing the secret elsewhere. */
export function distributorPublicKey(): string {
  const secret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
  if (!secret) throw new Error("STELLAR_DISTRIBUTOR_SECRET not configured");
  return Keypair.fromSecret(secret).publicKey();
}

/** Load the Horizon account for the distributor. */
export function distributorKeypair(): Keypair {
  const secret = Deno.env.get("STELLAR_DISTRIBUTOR_SECRET");
  if (!secret) throw new Error("STELLAR_DISTRIBUTOR_SECRET not configured");
  return Keypair.fromSecret(secret);
}
