# Stellar / Horizon Query Reference

Useful curl commands and Horizon endpoints for inspecting live chain state on testnet. All reads go directly to Horizon — no MCP needed, no secrets required.

**Base URL:** `https://horizon-testnet.stellar.org`

---

## Key addresses

```
DISTRIBUTOR  GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X
ISSUER       GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT
```

---

## Account state

### Full account info (balances + trustlines + flags)
```bash
curl -s https://horizon-testnet.stellar.org/accounts/GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X | jq .
```

### Balances only
```bash
curl -s https://horizon-testnet.stellar.org/accounts/GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X \
  | jq '.balances[] | {asset: (.asset_code // "XLM"), balance, limit: .limit}'
```

### Check if a trustline exists for a specific asset
```bash
curl -s https://horizon-testnet.stellar.org/accounts/<WALLET_ADDRESS> \
  | jq '.balances[] | select(.asset_code == "USDC")'
```

---

## Transactions

### Recent transactions for an account (latest 10)
```bash
curl -s "https://horizon-testnet.stellar.org/accounts/GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X/transactions?limit=10&order=desc" \
  | jq '.\_embedded.records[] | {id, created_at, memo, successful}'
```

### Single transaction by hash
```bash
curl -s https://horizon-testnet.stellar.org/transactions/<TX_HASH> \
  | jq '{id, created_at, memo, fee_charged, successful}'
```

### Operations inside a transaction
```bash
curl -s https://horizon-testnet.stellar.org/transactions/<TX_HASH>/operations \
  | jq '.\_embedded.records[] | {type, amount, asset_code, from, to}'
```

---

## Payments

### Recent payments sent/received by an account
```bash
curl -s "https://horizon-testnet.stellar.org/accounts/<WALLET_ADDRESS>/payments?limit=20&order=desc" \
  | jq '.\_embedded.records[] | {type, amount, asset_code, from, to, created_at}'
```

### Filter payments by asset (USDC only)
```bash
curl -s "https://horizon-testnet.stellar.org/accounts/<WALLET_ADDRESS>/payments?limit=50&order=desc" \
  | jq '.\_embedded.records[] | select(.asset_code == "USDC") | {amount, from, to, created_at}'
```

---

## Assets (HTG-C and USDC)

### All accounts holding HTG-C (issued by Theo issuer)
```bash
curl -s "https://horizon-testnet.stellar.org/assets?asset_code=HTGC&asset_issuer=GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT" \
  | jq '.\_embedded.records[] | {asset_code, asset_issuer, amount, num_accounts}'
```

### Total HTG-C in circulation
```bash
curl -s "https://horizon-testnet.stellar.org/assets?asset_code=HTGC&asset_issuer=GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT" \
  | jq '.\_embedded.records[0] | {amount, num_accounts, clawback_enabled}'
```

### Total USDC in circulation (custom testnet USDC)
```bash
curl -s "https://horizon-testnet.stellar.org/assets?asset_code=USDC&asset_issuer=GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT" \
  | jq '.\_embedded.records[0] | {amount, num_accounts}'
```

---

## Ledger

### Current ledger (confirms Horizon is live)
```bash
curl -s https://horizon-testnet.stellar.org/ledgers?limit=1&order=desc \
  | jq '.\_embedded.records[0] | {sequence, closed_at, transaction_count, successful_transaction_count}'
```

---

## Debugging a specific order

When an order is stuck or a transaction fails, run these in sequence:

```bash
# 1. Check the distributor's current balances
curl -s https://horizon-testnet.stellar.org/accounts/GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X \
  | jq '.balances[] | {asset: (.asset_code // "XLM"), balance}'

# 2. Find recent transactions by memo (reference number)
curl -s "https://horizon-testnet.stellar.org/accounts/GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X/transactions?limit=20&order=desc" \
  | jq '.\_embedded.records[] | select(.memo == "CNV-XXXXXXXX") | {id, created_at, successful}'

# 3. Inspect the operations of that transaction
curl -s https://horizon-testnet.stellar.org/transactions/<TX_HASH>/operations \
  | jq '.\_embedded.records[]'
```

---

## Stellar Expert (visual explorer)

For visual inspection, paste any address or tx hash into:

```
https://stellar.expert/explorer/testnet/tx/<TX_HASH>
https://stellar.expert/explorer/testnet/account/<ADDRESS>
```

Switch to `public` in the URL for mainnet once migrated.

---

## In TypeScript (edge functions / frontend)

For reads inside edge functions or `src/lib/`, use `fetch` directly:

```ts
const HORIZON = "https://horizon-testnet.stellar.org";

// Account balances
const res = await fetch(`${HORIZON}/accounts/${address}`);
const account = await res.json();
const usdcBalance = account.balances.find(
  (b: { asset_code?: string }) => b.asset_code === "USDC"
)?.balance ?? "0";

// Transaction detail
const tx = await fetch(`${HORIZON}/transactions/${txHash}`).then(r => r.json());
console.log(tx.created_at, tx.memo, tx.successful);
```

Never import `StellarSdk.Server` on the client side for simple reads — a plain `fetch` is lighter and sufficient.
