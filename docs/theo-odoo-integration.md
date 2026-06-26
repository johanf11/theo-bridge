# Theo ↔ Odoo Integration — Pass-down

Everything the `theo_payment` Odoo 17 module author needs to wire up against the
Theo public API. This doc is the contract; the plugin ships separately.

---

## 1. Overview

Importers pre-fund their HTG balance with Theo (HTG bank deposit → HTG-C credit).
From an Odoo vendor bill they click **Pay with Theo**. The plugin sends the
vendor's **bank/wire/local payment details** plus the bill amount to Theo.
Theo debits the importer's USDC or HTG-C balance, then sends **USDC on-chain to
the Owlting off-ramp Stellar address** (`OWLTING_OFFRAMP_STELLAR_ADDRESS`).
Beneficiary metadata is stored on the order for Owlting fiat payout (mainnet).
On success Theo returns a Stellar transaction hash; Odoo marks the bill paid.

```
Importer (Odoo)     theo_payment plugin        Theo API              Stellar/Owlting
       │                    │                      │                        │
       │ Pay with Theo      │                      │                        │
       │───────────────────>│ POST /theo-api-quote │                        │
       │  (bank details)    │─────────────────────>│ store beneficiary      │
       │                    │ POST /theo-api-pay   │                        │
       │                    │─────────────────────>│ USDC → Owlting off-ramp│
       │                    │  { stellar_tx_hash } │<───────────────────────│
       │ bill marked Paid   │<─────────────────────│                        │
       │                    │                      │     fiat → vendor bank │
       │                    │                      │     (Owlting, mainnet) │
```

---

## 2. Prerequisites

- Theo org with `kyb_status = APPROVED`.
- Org **owner** account (only owners can mint API keys).
- At least one funded wallet (USDC and/or HTG-C balance).
- Odoo 17 self-hosted, developer mode enabled, outbound HTTPS allowed.
- Off-ramp Stellar destination configured on the Theo backend. Theo resolves it
  via `app_settings.owlting_omnibus_address` (preferred) and falls back to the
  `OWLTING_OFFRAMP_STELLAR_ADDRESS` env. The plugin does NOT need to know which
  source is used — every quote response returns `off_ramp.stellar_address`.
  If neither is set, all rails return `503 { code: "destination_not_configured" }`.

---

## 3. Generate an API key

1. Sign in to Theo as the org owner.
2. **Settings → API & Integrations → Generate API key**.
3. Name it (e.g. `Odoo prod`) and copy the key — it is shown **once**.
4. Key format: `theo_live_` + 32 hex chars.
5. Default scopes: `payments:write, wallets:read, balance:read, quotes:write`.
6. Revoke at any time from the same screen. Rotating = revoke old + generate new.

Store the key in Odoo via `ir.config_parameter` (e.g. `theo_payment.api_key`),
never in source.

---

## 4. Endpoint base URL

Production / demo:

```
https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1
```

Auth header on every request:

```
Authorization: Bearer theo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

- Do **not** send a separate `apikey` header — only `Authorization`.
- CORS is wide-open on the four `theo-api-*` endpoints, so Odoo's server-side
  HTTP client works without any extra config.
- The base URL should be a plugin setting (`theo_payment.base_url`) so dev/test
  envs can point elsewhere.

---

## 5. API reference

### 5.1 `GET /theo-api-ping` — Test connection

```bash
curl -X GET "$BASE/theo-api-ping" \
  -H "Authorization: Bearer $THEO_KEY"
```

Response:

```json
{ "ok": true, "customer": { "id": "uuid", "company_name": "Acme Imports SA" } }
```

### 5.2 `GET /theo-api-wallets` — List source wallets

```bash
curl -X GET "$BASE/theo-api-wallets" \
  -H "Authorization: Bearer $THEO_KEY"
```

Response:

```json
{
  "wallets": [
    {
      "id": "9e0a…",
      "label": "Operating USDC",
      "currency": "USDC",
      "available_balance": 4821.55,
      "stellar_address": "GABC…"
    },
    {
      "id": "htgc:6187f305-188a-41ab-8e76-81dc2efa6a93",
      "label": "HTG Balance",
      "currency": "HTGC",
      "available_balance": 1850000,
      "stellar_address": ""
    }
  ]
}
```

- USDC wallets: balances are live from Stellar Horizon.
- The HTG-C synthetic wallet always uses id format `htgc:<customer_id>`. Pass it
  back as `source_wallet_id` to debit the importer's HTG balance.

### 5.3 `POST /theo-api-quote` — Quote a payment

```bash
curl -X POST "$BASE/theo-api-quote" \
  -H "Authorization: Bearer $THEO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_wallet_id": "htgc:6187f305-188a-41ab-8e76-81dc2efa6a93",
    "amount_usd": 1500,
    "invoice_ref": "BILL/2026/0001",
    "settlement": {
      "rail": "wire",
      "currency": "USD",
      "beneficiary": {
        "name": "Miami Foods Distribution LLC",
        "bank_name": "Sunshine State Bank",
        "account_number": "US64SUNS0001234567890",
        "swift": "SUNSUS33",
        "country": "US"
      },
      "external_ref": "BILL/2026/0001"
    }
  }'
```

Response:

```json
{
  "quote_id": "1c3…",
  "reference_number": "THEO-ODO-7K2QF9",
  "expires_at": "2026-06-25T18:32:11.000Z",
  "source_currency": "HTGC",
  "source_wallet_id": "htgc:6187…",
  "amount_usd": 1500,
  "fee_usd": 30,
  "total_debit_usd": 1530,
  "debit_htgc": 198450,
  "rate": 129.7,
  "settlement": {
    "rail": "wire",
    "currency": "USD",
    "beneficiary": { "name": "Miami Foods Distribution LLC", "bank_name": "…" },
    "external_ref": "BILL/2026/0001"
  },
  "off_ramp": {
    "provider": "owlting",
    "stellar_address": "GOWLTING…"
  }
}
```

Notes:

- Quote TTL is **15 minutes**. After `expires_at` you must re-quote.
- **`settlement.rail`**: `wire`, `local`, `usdc`, or `ach` with matching beneficiary fields.
- On-chain USDC always goes to **`OWLTING_OFFRAMP_STELLAR_ADDRESS`**, not the vendor.
- Legacy `supplier.stellar_address` is still accepted but deprecated.
- `external_ref` / `invoice_ref` flows into the Stellar memo (28-byte cap).
- For USDC source wallets `source_currency = "USDC"`, `debit_htgc = null`,
  `rate = 1`.
- **No fixed maximum** on `amount_usd`. Odoo vendor bills can be $100K, $1M, $2M+ — bound only by distributor USDC liquidity at pay time. HTG-C sourced quotes require a $1,000 minimum (dust protection). Set `ODOO_QUOTE_MAX_USD` env on the backend only as an emergency ops throttle.
- Pay-time oversize failures return **`402 insufficient_balance`**, not a product cap.

### 5.4 `POST /theo-api-pay` — Execute the payment

```bash
curl -X POST "$BASE/theo-api-pay" \
  -H "Authorization: Bearer $THEO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "quote_id": "1c3…",
    "external_invoice_ref": "BILL/2026/0001"
  }'
```

Response:

```json
{
  "ok": true,
  "reference_number": "THEO-ODO-7K2QF9",
  "stellar_tx_hash": "db8068b17694aa8657ed8aa54c2d07c2fac38830bde4568eb53f60097f9ee443",
  "status": "COMPLETED"
}
```

Idempotency: a `quote_id` can only be paid once (subsequent calls return 409).
Store `stellar_tx_hash` and `reference_number` on the `account.move` so the
treasurer has a verifiable on-chain receipt.

---

## 6. Error codes

Every non-2xx response is JSON with `{ error: string, code?: string }`. **Always
parse the body even on 5xx** — the plugin must never gate the wizard popup on
`response.ok`. Surface `code` + `error` in the dialog so failures are visible
instead of swallowed.

| HTTP | `code`                       | Meaning                                            | Plugin behavior                                          |
|------|------------------------------|----------------------------------------------------|----------------------------------------------------------|
| 400  | `invalid_settlement` / —     | Bad request (missing field, bad address, amount=0) | Surface validation error to the user                     |
| 401  | —                            | Missing/invalid/revoked API key                    | Block, prompt admin to regenerate the key                |
| 403  | `kyb_required` / —           | KYB not approved, missing scope, or quote not yours| Surface as "Contact Theo support"                        |
| 404  | —                            | Quote, wallet, or customer not found               | Re-fetch wallets, re-quote                               |
| 409  | `quote_already_used`         | Quote already paid                                 | Treat as success if `stellar_tx_hash` known              |
| 410  | `quote_expired`              | Quote expired (>15 min)                            | Auto re-quote, ask user to confirm new rate              |
| 500  | —                            | Server error (no rate snapshot, etc.)              | Retry once after 5s, then surface error                  |
| 502  | `on_chain_failed`            | On-chain payment failed                            | Mark bill `payment_failed`, alert ops                    |
| 503  | `destination_not_configured` | Owlting off-ramp address missing on backend        | Show "Theo not provisioned" — do not retry automatically |


---

## 7. Odoo module expectations (`theo_payment`)

This repo does **not** ship the Odoo module. The plugin author should deliver:

- **Settings model** (`res.config.settings` extension):
  - `theo_payment.api_key` (encrypted `ir.config_parameter`)
  - `theo_payment.base_url`
  - `theo_payment.default_wallet_id`
  - "Test connection" button → calls `/theo-api-ping`
- **Wizard** on `account.move` (action: `Pay with Theo`):
  1. Calls `/theo-api-wallets`, renders a wallet picker with live balances.
  2. Defaults `amount_usd` to the bill total (converted to USD if needed).
  3. Reads supplier Stellar address from partner field
     `x_theo_stellar_address`.
  4. Calls `/theo-api-quote` → shows debit amount, fee, rate, expiry countdown.
  5. **Confirm** → calls `/theo-api-pay` → records `stellar_tx_hash` and
     `reference_number` on the move, posts an `account.payment` with
     `payment_method = theo`, marks bill paid.
- **System parameter** `theo_payment.environment` (`test` | `live`) toggling
  the base URL.
- **Logs**: log request/response **without** the Authorization header or the
  raw API key.

---

## 8. Demo / smoke-test script

```bash
export BASE="https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1"
export THEO_KEY="theo_live_…"

# 1. Ping
curl -sS "$BASE/theo-api-ping" -H "Authorization: Bearer $THEO_KEY" | jq

# 2. Wallets
curl -sS "$BASE/theo-api-wallets" -H "Authorization: Bearer $THEO_KEY" | jq

# 3. Quote (replace source_wallet_id + supplier address)
QUOTE=$(curl -sS -X POST "$BASE/theo-api-quote" \
  -H "Authorization: Bearer $THEO_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_wallet_id": "htgc:<customer_id>",
    "amount_usd": 25,
    "supplier": {
      "name": "Demo Supplier",
      "stellar_address": "G…",
      "external_ref": "DEMO-001"
    }
  }')
echo "$QUOTE" | jq
QUOTE_ID=$(echo "$QUOTE" | jq -r .quote_id)

# 4. Pay
curl -sS -X POST "$BASE/theo-api-pay" \
  -H "Authorization: Bearer $THEO_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"quote_id\":\"$QUOTE_ID\",\"external_invoice_ref\":\"DEMO-001\"}" | jq
```

Verify on the Theo side:

- **Transactions** page shows the order with reference prefix `THEO-ODO-`.
- Status `COMPLETED`, `stellar_tx_hash` populated.
- For HTG-C source: ledger shows HTG-C burn + USDC payout.

---

## 9. Troubleshooting

| Symptom                                  | Likely cause / fix                                                     |
|------------------------------------------|------------------------------------------------------------------------|
| 401 on every call                        | Key revoked or typo. Regenerate in Settings → API & Integrations.      |
| 403 "KYB approval required"              | Org's `kyb_status` not `APPROVED`. Finish KYB review.                  |
| 410 expired right after quoting          | Clock drift on the Odoo server — sync NTP.                             |
| 502 "Payment failed: insufficient funds" | Distributor low on USDC. Admin top-up via Admin Tools.                 |
| `supplier.stellar_address` rejected      | Must start with `G`, length ≥ 50, no trailing whitespace.              |
| CORS error from browser-side JS          | Don't call from the browser — Odoo backend (Python) must call the API. |

---

## 10. Security notes

- API key is shown **once** at creation; only the SHA-256 hash is stored.
- Owner-only mint and revoke; non-owners see a read-only notice.
- Theo records `last_used_at` per key — audit usage in Settings.
- The Authorization header is the only credential — never include the key in
  query strings, URLs, logs, or error messages.
- Rotate by revoking the old key and generating a new one; update Odoo's
  config parameter and restart the worker so cached keys are dropped.

---

## 11. Roadmap (not in v1)

- Vendor mirror sync (`POST /theo-api-vendors`) so Theo can validate supplier
  details server-side.
- Non-Stellar settlement rails (USD ACH/wire, local currency cash-out).
- Per-user API keys + scopes UI.
- Webhook callback to Odoo on settlement (`payment.completed`) instead of the
  current synchronous pay call.
- OAuth 2.0 client-credentials grant as an alternative to long-lived keys.

---

## 12. Backend-led integration spec (for the Odoo wizard)

The backend is the source of truth. The plugin's job is to forward bill data,
display whatever the quote returns, and surface any error verbatim.

### 12.1 Endpoint matrix per settlement rail

| Rail    | Quote endpoint   | Pay endpoint        | Required `settlement.beneficiary` fields                 |
|---------|------------------|---------------------|-----------------------------------------------------------|
| `wire`  | `/theo-api-quote`| `/theo-api-pay-bank`| `name`, `bank_name`, `account_number`, `swift`, `country` |
| `local` | `/theo-api-quote`| `/theo-api-pay`     | `name`, `bank_name`, `account_number`, `currency`         |
| `ach`   | `/theo-api-quote`| `/theo-api-pay`     | `name`, `bank_name`, `account_number`                     |
| `usdc`  | `/theo-api-quote`| `/theo-api-pay`     | `name`, `wallet_address` (G…, ≥ 50 chars)                 |

All quote bodies must include:

- `source_wallet_id` (from `/theo-api-wallets`)
- `amount_usd` (> 0, ≤ 100,000)
- One of: `invoice_ref`, `settlement.external_ref`, or `supplier.memo`
  (health checks must use `/theo-api-ping`, **not** `/theo-api-quote`).

The off-ramp Stellar destination is **resolved server-side** for every rail
(`app_settings.owlting_omnibus_address` → env fallback). The plugin must read
`off_ramp.stellar_address` from the quote response — never hardcode it.

### 12.2 Wizard popup safety

The Odoo `theo_payment_wizard` must open its modal **before** evaluating
`response.ok`, so failures show in the dialog instead of suppressing it.

Pseudo-code:

```python
resp = http.post(url, json=body, headers={...}, timeout=30)
try:
    payload = resp.json()
except ValueError:
    payload = {"error": resp.text or "Empty response", "code": "invalid_response"}

self.open_modal(payload)              # always
if resp.status_code != 200:
    self.modal_state = "error"
    self.error_code = payload.get("code")
    self.error_message = payload.get("error")
    return                            # do NOT raise UserError — it kills the popup
# else: render quote breakdown
```

Retry policy:

- `502 on_chain_failed`, `503 destination_not_configured` → show a "Retry" button.
- All other 4xx → no auto-retry; user must edit the bill or contact ops.
- `409 quote_already_used` with a known `stellar_tx_hash` → treat as success.

### 12.3 Step-by-step trigger sequence

1. **Test connection** → `GET /theo-api-ping` (used for the Settings → Test button).
2. **Load wallets** → `GET /theo-api-wallets` (refresh on every wizard open).
3. **Quote** → `POST /theo-api-quote` with the rail-specific body above.
4. **Display** the quote: `amount_usd`, `fee_usd`, `platform_fee_usd`,
   `total_debit_usd`, `rate`, `debit_htgc`, `off_ramp.stellar_address`,
   countdown to `expires_at`.
5. **Pay** → `POST /theo-api-pay-bank` (wire) or `POST /theo-api-pay` (all other
   rails) with `{ quote_id, external_invoice_ref }`.
6. On 200, store `stellar_tx_hash` + `reference_number` on the `account.move`,
   mark the bill paid, close the wizard.

### 12.4 Idempotency contract

- The plugin SHOULD include `client_request_id` on quote requests, but the
  backend dedupes on the **business reference** anyway (`external_ref` +
  `settlement_method` + `amount_usd` + destination). Re-posting the same bill
  returns the same `quote_id` (`idempotent_replay: true`).
- `/theo-api-pay` and `/theo-api-pay-bank` are idempotent on `quote_id` — calling
  them again after a completed payment returns the original `stellar_tx_hash`
  with `idempotent_replay: true`.
