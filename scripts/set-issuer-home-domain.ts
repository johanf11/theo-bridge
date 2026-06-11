/**
 * set-issuer-home-domain.ts
 *
 * One-time script: sets home_domain = "theokingdom.com" on the HTGC issuer
 * account so that StellarExpert (and wallets) can discover the stellar.toml.
 *
 * Run:
 *   STELLAR_HTGC_ISSUER_SECRET=S... bun run scripts/set-issuer-home-domain.ts
 *
 * Verify after:
 *   https://stellar.expert/explorer/testnet/account/GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT
 *   → should show home_domain: theokingdom.com
 */

import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON_URL      = "https://horizon-testnet.stellar.org";
const HOME_DOMAIN      = "theokingdom.com";
const ISSUER_PUBLIC    = "GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT";

async function main() {
  const secret = process.env.STELLAR_HTGC_ISSUER_SECRET;
  if (!secret) {
    console.error("❌  Set STELLAR_HTGC_ISSUER_SECRET env var before running.");
    process.exit(1);
  }

  const issuerKeypair = Keypair.fromSecret(secret);
  if (issuerKeypair.publicKey() !== ISSUER_PUBLIC) {
    console.error("❌  Secret key does not match the expected issuer public key.");
    process.exit(1);
  }

  const server  = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(ISSUER_PUBLIC);

  console.log(`Current home_domain: "${account.home_domain ?? "(not set)}"`);

  if (account.home_domain === HOME_DOMAIN) {
    console.log("✅  home_domain already set correctly. Nothing to do.");
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.setOptions({ homeDomain: HOME_DOMAIN }))
    .setTimeout(30)
    .build();

  tx.sign(issuerKeypair);

  console.log(`Setting home_domain → "${HOME_DOMAIN}" …`);
  const result = await server.submitTransaction(tx);
  console.log("✅  Done! TX hash:", result.hash);
  console.log(
    `\nView on StellarExpert:\nhttps://stellar.expert/explorer/testnet/asset/HTGC-${ISSUER_PUBLIC}`
  );
}

main().catch((err) => {
  console.error("❌  Error:", err?.response?.data ?? err.message ?? err);
  process.exit(1);
});
