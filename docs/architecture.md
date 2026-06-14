# Theo Bridge — Architecture

> Current state: Stellar Testnet, pre-mainnet. First enterprise client: NABATCO.SA (Groupe Acra). SCF Build Award #44 application in progress, deadline June 14 2026.
>
> ⚠️ **Schema drift caveat (2026-06-14):** the data model described in this document reflects the *intended* schema as defined in `supabase/migrations/`. The live Lovable-managed database has diverged in several places (see REBUILD.md Phase 0.5 for known drifts — e.g. `ledger_entries` uses `debit`/`credit` columns in production rather than the `amount`+`side` defined in the migration). Treat this doc as the target state, not the live state, until Phase 0.5 reconciliation lands.

---

## 1. Product overview

Theo Bridge is Haiti's first Stellar anchor — a compliant B2B foreign exchange platform for Haitian importers and corporate treasuries. Businesses deposit Haitian Gourdes (HTG) via the SPIH interbank network and receive USDC in a Stellar wallet, settled in 3–5 seconds at the official BRH reference rate.

**Why Stellar:** 3–5 second finality, sub-cent fees, native multi-asset support, and the SEP-24/SEP-6 anchor standard make Stellar the only chain where a compliant HTG ↔ USD corridor is practical at the transaction sizes Haitian importers need ($1K–$1M per order).

**Long-term vision:** Stellar anchor network for emerging-market corridors — Haiti first (HTG-C), then Caribbean, then West Africa, each with a regional crypto-backed stablecoin.

---

## 2. MVP scope

### Built

- Email/password + OAuth authentication (Supabase Auth)
- KYB (Know Your Business) submission and admin review flow
- Quote engine — locks BRH rate for 15 minutes, creates an order
- Deposit flow — HTG → mint HTG-C 1:1, OR HTG → auto-convert to USDC
- Swap — HTG-C ↔ USDC on Stellar (two-leg atomic swap with compensating refund)
- Off-ramp — burn HTG-C back to issuer, record bank withdrawal
- Payout — send USDC wallet-to-wallet on Stellar (B2B payments)
- Internal transfer — move USDC between the customer's own wallets
- Wallet management — create Stellar accounts, manage trustlines, view balances
- Bank account management — save and manage HTG bank accounts for withdrawals
- Invoices — create, send, and track USDC/HTG-C invoices with QR payment links
- Billing page — itemized fee statements with PDF download
- Compliance page — live reserve proof (treasury vs. circulation), issuer flags, Stellar Explorer links, and asset disclosure panels for HTG-C (first-party, Theo-issued) and USDC (third-party, Circle)
- Admin tools — HTG-C mint/burn controls, trustline backfill, SPIH payment simulation
- Global search — debounced search across orders, payouts, and wallets
- PDF receipts — branded A4 receipts generated client-side with jsPDF
- Org team roles — invite members, assign roles (Owner / Treasury Analyst / Viewer), fine-grained permissions
- Blend yield positions — track yield positions and live-accrued interest (UI + edge functions)

### Explicitly out of scope (current stage)

- Real SPIH bank-feed matching (orders do not auto-transition out of QUOTED in production)
- Email notifications
- Quote expiry cron sweeper (stale QUOTED orders are not auto-expired)
- Mobile app
- Mainnet deployment

---

## 3. User flows

### 3a. Deposit HTG → USDC (primary flow)

```
Customer → /convert (On/Off Ramp tab "HTG")
  1. Select receive mode: "USDC" or "HTG-C"
  2. Enter HTG amount → UI fetches live BRH rate → shows USDC net (after fees)
  3. Submit → POST supabase/functions/create-quote
     - Validates KYB = APPROVED
     - Reads latest rate_snapshots row
     - Computes fee (customer.fee_bps + customer.corridor_bps)
     - Inserts orders row (status=QUOTED, 15-min expiry)
  4. Redirect → /orders/:id
     - Realtime subscription watches orders row
     - Shows SPIH payment instructions (reference number, bank details)
  5. Customer wires HTG via their bank (SPIH network)
  6. Admin (or future SPIH webhook) marks order FUNDED
  7. Admin clicks "Release USDC" → POST supabase/functions/release-usdc
     - Mints shortfall USDC to distributor if needed (testnet)
     - Distributor pays USDC to customer's Stellar address
     - Updates order: status=COMPLETED, stellar_tx_hash
  8. Customer sees COMPLETED with tx hash and can download PDF receipt
```

### 3b. HTG-C ↔ USDC swap

```
/convert → "Swap" tab
  1. Select direction (HTG-C→USDC or USDC→HTG-C) + source wallet + amount
  2. Submit → POST supabase/functions/execute-swap
     LEG 1: customer wallet → distributor (source asset)
     LEG 2: distributor → customer wallet (destination asset)
     If leg 2 fails: auto-refund leg 1 back to customer
  3. Order recorded; receipt available
```

### 3c. Off-ramp (withdraw HTG-C → bank)

```
/convert → "Off Ramp" tab
  1. Select wallet, amount, saved bank account
  2. Submit → POST supabase/functions/withdraw-htgc
     - Burns HTG-C via clawback (issuer-signed) from the customer wallet
     - Records order: order_kind=htgc_withdrawal, status=COMPLETED,
       reference=THEO-W-{8HEX}, htg_amount=amount, usdc_amount=0, rate=1
  3. Theo manually processes HTG bank transfer (operational step)
  4. OrderStatus renders it as a "Redemption order" (HTG-C redeemed + HTG paid out)
```

### 3d. Payout (send USDC)

```
/payout
  1. Enter recipient address, name, amount
  2. Optionally enter a memo — choose TYPE first:
     - Text (MEMO_TEXT): descriptions, references. Max 28 UTF-8 bytes.
     - Number/ID (MEMO_ID): exchange destination tags (Binance, Kraken, etc.).
       Digits only, ≤ uint64.
     A persistent guide line explains which to pick before the user types.
  3. Submit → POST supabase/functions/send-payment
     - Validates memoType is present when memo is set (400 if missing)
     - Validates memo by type (byte length for text; digit range for id)
     - Pre-flight: checks recipient USDC trustline
       - Theo-managed wallet: auto-establishes trustline
       - External wallet: returns clear error
     - Submits Stellar payment with correct memo SDK type (Memo.text / Memo.id)
     - Records payouts row including memo_type column
  Saved recipients store memo + memo_type and auto-fill both on selection.
```

### 3e. Invoice

```
/invoices
  1. Create invoice (line items, currency USDC or HTG-C, payment wallet, due date)
  2. Share public link /inv/:id (no auth required for viewer)
  3. Recipient scans QR code → pays to linked wallet address
  4. Mark invoice paid manually (automated detection not yet built)
```

### 3f. Global wire

Convert tab has a "Wire" tab stub for future international wire functionality. Not implemented beyond UI.

---

## 4. System components

### Frontend pages (`src/pages/`)

| Route | Page | Purpose |
|---|---|---|
| `/` | `Landing` | Marketing page |
| `/login` `/register` | `Login` `Register` | Auth |
| `/dashboard` | `Dashboard` | Summary: balances, stacked bar chart, recent tx |
| `/transactions` | `Transactions` | Unified list of orders + payouts, filterable |
| `/balance` | `Balance` | Wallet list, live Horizon balances, wallet management |
| `/payout` | `Payout` | Send USDC, saved recipients, payout history |
| `/convert` | `Convert` | On-ramp / swap / off-ramp / wire (tabbed) |
| `/invoices` | `Invoices` | Create and manage invoices |
| `/inv/:id` | `InvoiceView` | Public invoice viewer (no auth) |
| `/orders/:id` | `OrderStatus` | Live order status, SPIH instructions, receipt. Renders per `order_kind`: deposit (`htgc_mint`), conversion (`usdc_conversion`), swap, and redemption (`htgc_withdrawal`, detected by `order_kind` or `THEO-W-` reference prefix) |
| `/compliance` | `Compliance` | Reserve proof, issuer flags, Stellar explorer links, HTG-C + USDC asset disclosure panels |
| `/billing` | `Billing` | Fee statements, PDF statement download |
| `/settings` | `Settings` | Profile, team/org roles, bank accounts |
| `/kyb` | `Kyb` | KYB submission form |
| `/admin/kyb` | `AdminKyb` | KYB review queue (admin only) |
| `/admin/conversions` | `AdminConversions` | Order management (admin only) |
| `/admin/tools` | `AdminTools` | HTG-C issuance, trustline backfill (admin only) |

### Theo-specific components (`src/components/theo/`)

| Component | Purpose |
|---|---|
| `Layout.tsx` / `AppLayout` | App shell: sidebar nav + topbar + global search |
| `AuthLayout.tsx` | Centered card shell for login/register pages |
| `ProtectedRoute.tsx` | Auth guard; `adminOnly` prop for admin routes |
| `IssuanceControls.tsx` | HTG-C mint/burn UI used in AdminTools |
| `WalletKeys.tsx` | Wallet key reveal component (calls `reveal-wallet-secret`) |
| `StatusBadge.tsx` | Order/payout status pill |

### Edge functions (`supabase/functions/`)

| Function | Auth required | Purpose |
|---|---|---|
| `create-quote` | user | Validate KYB, lock rate, create order (QUOTED) |
| `release-usdc` | admin | FUNDED → RELEASING → COMPLETED; distributor pays USDC |
| `execute-swap` | user | Two-leg HTG-C ↔ USDC swap with auto-refund |
| `execute-withdraw` | user | Burn HTG-C → record withdrawal order |
| `send-payment` | user | USDC wallet-to-wallet payout |
| `move-funds` | user | Internal USDC transfer between customer's own wallets |
| `create-wallet` | user | Generate Stellar keypair, Friendbot fund, establish trustlines |
| `reveal-wallet-secret` | user (owner) | Return `stellar_secret` for caller's own wallet |
| `htgc-issuance` | admin | Mint or burn HTG-C on Stellar |
| `fetch-brh-rate` | user | Scrape BRH "taux du jour" page, cache in rate_snapshots |
| `simulate-spih-payment` | admin | Dev tool: flip QUOTED → FUNDED, trigger release-usdc |
| `retry-swap-payout` | user | Retry a failed swap leg 2 |
| `withdraw-htgc` | user | Alias for execute-withdraw flow |
| `admin-rectify-htgc` | admin | Correct HTG-C balance discrepancies |
| `backfill-trustlines` | admin | Walk all wallets, ensure USDC + HTG-C trustlines |
| `backfill-wallet-trustlines` | admin | Variant of above |
| `blend-positions` | user | List Blend yield positions with live accrued interest |
| `blend-sweep` | admin | Sweep yield earnings from Blend pools |
| `blend-withdraw` | user | Withdraw from a Blend yield position |
| `backfill-ledger` | admin | Replay all historical orders/payouts into the ledger |
| `replay-ledger-failure` | admin | Retry a failed ledger posting from `ledger_posting_failures` |
| `admin-spih-settlement` | admin | Manual Dr FX_CLEARING_HTG / Cr SPIH_BANK_HTG entry |

### Shared edge function helpers (`supabase/functions/_shared/`)

| File | Purpose |
|---|---|
| `stellar-assets.ts` | Exports `HTGC_ISSUER` constant |
| `stellar-signer.ts` | `signWithSecret`, `signWithDistributor`, `distributorKeypair`, `distributorPublicKey` — the ONLY place that reads `STELLAR_DISTRIBUTOR_SECRET` |
| `tx-limits.ts` | `assertWithinLimits(amount)` — min 1 USDC, max 1,000,000 USDC |
| `ensure-wallet-ready.ts` | Idempotent: ensures USDC + HTG-C trustlines exist and are authorized on any Theo-managed wallet |
| `ledger.ts` | `safePostLedger` — wraps `post_ledger_entries` RPC; on failure records to `ledger_posting_failures` and returns null. `getOrCreateCustomerUsdcAccount` — idempotent per-customer USDC account upsert. |

### Supabase layer

- **Auth:** email/password + Google OAuth. Session persisted in localStorage.
- **Postgres:** RLS on every table. Service-role writes are scoped to edge functions only.
- **Realtime:** `orders` table is published (`ALTER PUBLICATION supabase_realtime ADD TABLE orders`). Used on `/orders/:id` for live status updates.
- **DB functions:** `has_role(_user_id, _role)` (security definer), `is_org_member`, `is_org_owner`, `seed_default_roles`, `protect_customer_fields` trigger, `handle_new_user` trigger.

### Stellar layer

- **HTG-C issuer:** `GDSRYZWTLQLBECKCL4TV7ZRGBZGBMSPD4V47B7Y7JSQVDJRSEXQTFCQT`
- **Distributor (hot wallet):** `GCP6VMZS3SJ4CSOT3ZVMMJIOXOHTMJK47YQ4RTUJN7P2KYKDVRCUBS2X`
- **USDC issuer:** custom testnet issuer (same keypair as HTGC issuer in testnet setup; controlled by `STELLAR_USDC_ISSUER` env var)
- **Horizon:** `https://horizon-testnet.stellar.org`
- **SDK:** `@stellar/stellar-sdk@12.3.0` (via `npm:` in Deno edge functions; `@stellar/stellar-sdk@15` in devDependencies for frontend types)
- **Wallet funding:** new wallets are funded via Stellar Friendbot (testnet only)

---

## 5. Data model

All tables are in the `public` schema with RLS enabled. Amounts use `numeric(18,7)` or `numeric(20,7)` — 7 decimal places.

### `customers`

Central business identity. One row per registered company. Created automatically by the `handle_new_user` trigger on signup.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK auth.users | UNIQUE — one account per company |
| `company_name` | text | |
| `email` | text | |
| `kyb_status` | enum | `PENDING \| APPROVED \| REJECTED \| UNDER_REVIEW` |
| `fee_bps` | int | Theo's platform fee in bps (default 130 = 1.30%) |
| `corridor_bps` | int | Corridor/network fee in bps (default 70 = 0.70%) |
| `stellar_wallet_address` | text | Primary wallet G-address (admin-set, protected trigger) |

**Trigger:** `protect_customer_fields` prevents non-admins from changing `kyb_status` or `stellar_wallet_address`.

### `wallets`

Stellar accounts owned and managed by Theo on behalf of customers.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid FK customers | |
| `wallet_type` | enum | `CUSTOMER \| TREASURY` |
| `stellar_address` | text UNIQUE | G-address |
| `stellar_secret` | text | S-key. Column SELECT is revoked from client roles. Access only via `reveal-wallet-secret` edge fn |
| `label` | text | User-defined name |
| `usdc_balance` | numeric(20,7) | Cached balance (live balance read from Horizon) |

### `orders`

All exchange orders. Created by `create-quote`, fulfilled by `release-usdc` or `execute-swap`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid FK | |
| `order_kind` | enum | `usdc_conversion \| htgc_mint \| htgc_usdc_swap \| htgc_withdrawal` |
| `status` | enum | `CREATED → QUOTED → FUNDED → RELEASING → COMPLETED \| FAILED \| EXPIRED \| REFUNDED` |
| `reference_number` | text UNIQUE | Format: `THEO-{TYPE}-{CHARS}` e.g. `THEO-CNV-A3BF7Z`. Off-ramp redemptions use the `THEO-W-` prefix (`THEO-W-{8HEX}`), which `OrderStatus` also uses as a fallback to render the order as a redemption |
| `htg_amount` | numeric(18,2) | HTG required from customer (integers for display; stored with 2dp) |
| `usdc_amount` | numeric(20,7) | Net USDC the customer receives |
| `usdc_gross` | numeric(20,7) | Gross USDC before fees |
| `fee_usdc` | numeric(20,7) | Total fee in USDC |
| `fee_bps` | int | Total fee in bps |
| `theo_fee_bps` | int | Theo's share |
| `corridor_bps` | int | Corridor share |
| `rate` | numeric | Customer-facing HTG/USD rate |
| `spot_rate` | numeric | BRH reference rate at quote time |
| `stellar_tx_hash` | text | Stellar transaction hash |
| `quote_expires_at` | timestamptz | 15 minutes from quote creation |
| `failure_reason` | text | Populated on FAILED orders |

### `payouts`

Outbound USDC payments sent wallet-to-wallet.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `customer_id` | uuid FK | |
| `source_wallet_id` | uuid FK wallets | |
| `recipient_name` | text | |
| `recipient_address` | text | Stellar G-address |
| `amount_usdc` | numeric(18,7) | |
| `memo` | text | Stellar memo value (max 28 UTF-8 bytes for TEXT type) |
| `memo_type` | text | `'text' \| 'id'` — required when `memo` is set; stored so retries/audits can reconstruct the correct on-chain memo type |
| `status` | enum | `PENDING \| COMPLETED \| FAILED` |
| `stellar_tx_hash` | text | |

### `rate_snapshots`

BRH reference rate history. Written by `fetch-brh-rate`; read by `create-quote` and the convert UI.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `spot_rate` | numeric(10,4) | HTG per USD |
| `source` | text | `brh \| cache \| seed \| manual` |
| `captured_at` | timestamptz | |

### `reserve_attestations`

HTG reserve proofs published by the Compliance page.

| Column | Type | Notes |
|---|---|---|
| `htg_balance` | numeric | HTG held in reserve |
| `period_label` | text | e.g. "May 2026" |
| `attested_at` | timestamptz | |
| `auditor_name` | text | |
| `attestation_pdf_url` | text | |

### `invoices`

B2B invoice management.

| Column | Type | Notes |
|---|---|---|
| `currency` | text | `USDC \| HTG-C` |
| `line_items` | jsonb | Array of `{ id, description, quantity, unit_price }` |
| `status` | text | `DRAFT \| SENT \| PAID \| OVERDUE` |
| `payment_wallet_id` | uuid FK wallets | Wallet that receives payment |

### `htgc_issuance_events`

Audit log for every HTG-C mint and burn performed by the `htgc-issuance` edge function.

| Column | Type | Notes |
|---|---|---|
| `action` | text | `MINT \| BURN` |
| `amount` | numeric | |
| `destination_address` / `source_address` | text | |
| `stellar_tx_hash` | text | |
| `performed_by` | uuid FK auth.users | Admin who performed the action |

### `org_roles` / `org_members` / `role_permissions`

Per-organization team RBAC. Seeded automatically for each customer via the `seed_default_roles` function.

Default system roles:
- **Owner** — all permissions
- **Treasury Analyst** — `convert`, `payout_send`, `view_balances`
- **Viewer** — `view_balances` only

Permissions enum: `convert | payout_send | balance_view_keys | accounts_manage | view_balances`

### `user_roles`

Platform-level roles (not org-level).

| `role` | Access |
|---|---|
| `admin` | All admin pages, all edge functions, RLS bypass via `has_role()` |
| `customer` | Standard authenticated access |

### Other tables

| Table | Purpose |
|---|---|
| `bank_accounts` | Saved HTG bank accounts for withdrawals |
| `saved_recipients` | Saved Stellar addresses for payouts — includes `memo` and `memo_type` columns so exchange destination tags auto-fill on contact selection |
| `blend_positions` | Yield position tracking |
| `spih_imports` | SPIH reconciliation import audit |
| `job_queue` | Background job queue (types: `SPIH_RECONCILE \| USDC_RELEASE \| STELLAR_CONFIRM`) |

---

## 5b. Double-entry ledger

Every money event posts a balanced journal entry. The ledger is observational (Phase 1 — `LEDGER_GATE_ENABLED=false`). When the gate is enabled, ledger drift on `DISTRIBUTOR_USDC` blocks payouts.

### `ledger_accounts`

One row per account instance. System accounts have `customer_id = NULL`; per-customer USDC accounts have a `customer_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text | Chart of accounts code (e.g. `DISTRIBUTOR_USDC`, `SPIH_BANK_HTG`) |
| `name` | text | Human-readable label |
| `type` | enum | `ASSET \| LIABILITY \| EQUITY \| REVENUE \| EXPENSE` |
| `currency` | text | `USDC \| HTG` |
| `customer_id` | uuid FK | NULL for system accounts |

**Chart of accounts:**

| Code | Type | Currency | Meaning |
|---|---|---|---|
| `DISTRIBUTOR_USDC` | ASSET | USDC | Stellar hot wallet USDC balance |
| `TREASURY_USDC` | ASSET | USDC | Treasury cold wallet USDC |
| `SPIH_BANK_HTG` | ASSET | HTG | Physical HTG in SPIH segregated pool |
| `CUSTOMER_USDC_PAYABLE` | LIABILITY | USDC | System-level USDC owed to customers (no per-customer acct) |
| `FX_CLEARING_HTG` | LIABILITY | HTG | HTG committed to FX; drained by USDC→HTG outflows |
| `HTGC_ISSUED` | LIABILITY | HTG | Outstanding HTG-C on-chain (admin rectifications only) |
| `FEE_REVENUE_USDC` | REVENUE | USDC | Theo platform + corridor fees |
| `OPENING_BALANCE_USDC` | EQUITY | USDC | Historical correction equity plug (USDC) |
| `OPENING_BALANCE_HTG` | EQUITY | HTG | Historical correction equity plug (HTG) |
| `CUSTOMER_USDC_*` | ASSET | USDC | Per-customer USDC subaccount (one row per customer) |

### `ledger_transactions`

Journal header. One row per economic event.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source_key` | text UNIQUE | Idempotency key — prevents duplicate postings |
| `kind` | text | `htgc_to_usdc_swap \| usdc_to_htgc_swap \| USDC_PAYOUT \| FIAT_SETTLEMENT \| htgc_burn_withdraw \| opening_balance \| SPIH_CASH_IN \| ...` |
| `description` | text | |
| `order_id` | uuid FK orders | Populated for order-linked entries |
| `stellar_tx_hash` | text | Links to Stellar Explorer |
| `posted_by` | uuid FK auth.users | NULL for system/backfill entries |
| `created_at` | timestamptz | |

**source_key patterns:**

| Pattern | Event |
|---|---|
| `orders:{order_id}:FIAT_SETTLEMENT` | HTG deposit receipt (release-usdc) |
| `orders:{order_id}:USDC_PAYOUT` | USDC released (release-usdc) |
| `swap:{order_id}` | Atomic swap (execute-swap) |
| `orders:{order_id}:htgc_burn_withdraw` | HTG-C burn / withdrawal (execute-withdraw) |
| `spih-settlement:{ref}:{amount}` | Manual SPIH settlement |
| `correction:{code}:{reason}` | Migration correcting entry |
| `backfill:order:{order_id}` | Backfill entry |

### `ledger_entries`

Individual debit/credit lines. Two or more per transaction; must balance per currency.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `transaction_id` | uuid FK ledger_transactions | |
| `account_id` | uuid FK ledger_accounts | |
| `currency` | text | `USDC \| HTG` |
| `debit` | numeric(18,7) | |
| `credit` | numeric(18,7) | |

### `ledger_posting_failures`

Failed ledger posts captured by `safePostLedger`. Viewable and retryable from Admin › Ledger.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `source` | text | Edge function that failed (e.g. `execute-withdraw`) |
| `reason` | text | Error message |
| `payload` | jsonb | Original post payload — used for retry |
| `order_id` | uuid | |
| `stellar_tx_hash` | text | |
| `resolved_at` | timestamptz | NULL = unresolved |
| `resolved_by` | uuid FK auth.users | Admin who retried |
| `resolution_tx_id` | uuid FK ledger_transactions | |

### Ledger journal entries by event type

**HTG→USDC swap (`execute-swap`, `htgc_to_usdc`):**
```
Dr SPIH_BANK_HTG        +htg      HTG received into SPIH pool
Cr FX_CLEARING_HTG      +htg      FX obligation created
Dr DISTRIBUTOR_USDC     +usdc     USDC leaves distributor
Cr CUSTOMER_USDC        +net      Customer receives net USDC
Cr FEE_REVENUE_USDC     +fee      Fee earned
```

**USDC→HTG swap (`execute-swap`, `usdc_to_htgc`):**
```
Dr TREASURY_USDC        +usdc     USDC received at treasury
Cr CUSTOMER_USDC        +net      Customer's USDC subaccount credited
Cr FEE_REVENUE_USDC     +fee      Fee earned
Dr FX_CLEARING_HTG      +htg      FX obligation discharged
Cr SPIH_BANK_HTG        +htg      HTG leaves SPIH pool
```

**HTG deposit + USDC release (`release-usdc`):**
```
FIAT_SETTLEMENT:
  Dr SPIH_BANK_HTG      +htg      HTG received into pool
  Cr FX_CLEARING_HTG    +htg      FX obligation created

USDC_PAYOUT:
  Dr DISTRIBUTOR_USDC   +gross    USDC leaves distributor
  Cr CUSTOMER_USDC      +net      Customer receives USDC
  Cr FEE_REVENUE_USDC   +fee      Fee earned
```

**HTG-C withdrawal (`execute-withdraw`):**
```
Dr FX_CLEARING_HTG      +htg      FX obligation discharged
Cr SPIH_BANK_HTG        +htg      HTG leaves SPIH pool
```

**External USDC payout from customer wallet (`send-payment`):**
```
Dr CUSTOMER_USDC        +amount   Customer's USDC subaccount debited
Cr EXTERNAL_FLOW_USDC   +amount   USDC left the ecosystem (external counterparty)
```
Note: DISTRIBUTOR_USDC is NOT touched. The payment is signed by the customer's own Stellar keypair,
not the distributor. Only record DISTRIBUTOR_USDC when the distributor wallet actually transacts.

### Planned journals (not yet wired)

These journal kinds are defined here for pre-mainnet implementation. They do not fire today because the underlying Stellar keypairs are not yet split.

---

**`TREASURY_TO_DISTRIBUTOR_SWEEP`** — *wire before mainnet*

```
Dr DISTRIBUTOR_USDC     +amount   Hot wallet refilled
Cr TREASURY_USDC        +amount   Funds swept from treasury buffer
```

**Why this exists:**

The distributor key lives in Supabase edge function secrets — an env variable that any compromised edge function could read. Keeping $500K+ in that wallet at all times is an unacceptable single point of failure.

The solution is to keep only 1–2 days of operating float in the distributor and hold the rest in the treasury wallet, which has a separate keypair and requires multisig to move. Periodically (nightly or when the distributor balance drops below a threshold), you sweep USDC from treasury → distributor to top it up.

Without this journal entry, that on-chain sweep transaction creates a ledger delta on both wallets:
- Distributor: chain goes up, book stays the same → false positive drift
- Treasury: chain goes down, book stays the same → false negative drift

The reconciliation card shows both as broken until the journal fires.

**Trigger:** Manual admin action or automated threshold sweep (distributor balance < X USDC). Fires once per sweep transaction. `source_key = "sweep:distributor:{stellar_tx_hash}"`.

---

**`FX_REPLENISHMENT_USDC`** — *wire when FX automation is built*

```
Dr TREASURY_USDC        +amount   USDC received from FX counterparty
Cr FX_CLEARING_USDC     +amount   FX obligation closed
```

**Why this exists:**

When the treasury USDC buffer drops below threshold, Theo executes an FX forward swap: HTG leaves the SPIH pool and the FX counterparty wires USDC back. The HTG side is already recorded (`Dr FX_CLEARING_HTG / Cr SPIH_BANK_HTG` from the originating conversion). When the USDC arrives, this journal closes the matching USDC obligation and credits the treasury.

Without it, `FX_CLEARING_USDC` accumulates as a permanently open obligation and the treasury book balance never reflects FX inflows.

**Trigger:** FX settlement confirmed (wire received or Stellar payment from counterparty). `source_key = "fx-replenishment:{settlement_ref}"`. Same journal kind is used for MoneyGram/OTC settlements on large orders.

---

### Admin ledger page (`/admin/ledger`)

- **Trial balance** — per-currency debit/credit totals; must net to zero in each currency
- **SPIH Segregated Pool** — live pool balance (deposits − outflows)
- **Reconciliation** — book vs. Horizon chain balance for `DISTRIBUTOR_USDC`; drift > 0.01 USDC flags red
- **Transactions** — filterable by kind, order ID, date range; expandable journal entries; CSV export (QuickBooks-importable, one row per debit/credit line)
- **Posting Failures** — unresolved failures with Retry button (calls `replay-ledger-failure`)

---

## 6. API and integration boundaries

### BRH rate feed

- **Source:** `https://www.brh.ht/taux-du-jour/` (HTML scrape)
- **Trigger:** authenticated GET/POST to `fetch-brh-rate`
- **Caching:** returns today's cached rate if already scraped; scrapes live otherwise
- **Fallback:** returns last cached rate (never errors) with `source: "cache"` flag
- **Rate used:** BRH "TAUX DE RÉFÉRENCE" (official reference rate)

### Stellar Horizon API

Called directly from:
- Edge functions — all Stellar transaction submissions
- Frontend (`src/lib/balance.ts`) — live USDC and HTG-C balance reads via `fetch()` to `https://horizon-testnet.stellar.org/accounts/:address`
- Compliance page — live distributor balance for reserve proof

The frontend never submits transactions — only reads balances from Horizon.

### Edge function contract (common pattern)

```
Request:  POST https://nlbnmsiqfywskuxhqjon.supabase.co/functions/v1/<name>
Headers:  Authorization: Bearer <supabase-jwt>
          Content-Type: application/json
Body:     { ...function-specific fields }

Response 200: { ok: true, ...result }
Response 4xx: { error: "human-readable message" }
Response 5xx: { error: "..." }
```

All functions return CORS headers (`Access-Control-Allow-Origin: *`). All validate the JWT with `supabase.auth.getUser()` before any operation.

### create-quote request/response

```
POST { usdc_amount: number, order_kind?: "usdc_conversion" | "htgc_mint", destination_wallet_address?: string }

200 { quote_id, htg_required, usdc_amount, usdc_gross, fee_usdc, fee_bps, theo_fee_bps, rate, spot_rate, reference_number, expires_at }
```

### release-usdc request/response (admin only)

```
POST { orderId: string }

200 { ok: true, hash: string }
409 { error: "Order not in FUNDED state" }
```

### execute-swap request/response

```
POST { wallet_id, amount, direction: "htgc_to_usdc" | "usdc_to_htgc" }

200 { ok: true, orderId, hash, reference }
502 { error, leg1Hash, refundHash?, refunded? }  — leg2 failed, auto-refund attempted
```

---

## 7. Security and compliance

### Row-level security

Every table has RLS enabled. The pattern:
- Customers can only read/write their own rows (via `customer_id → customers.user_id = auth.uid()`)
- Admins bypass via `has_role(auth.uid(), 'admin')` (security-definer function)
- Service role (edge functions) bypasses RLS — used only for trusted writes

### `stellar_secret` column protection

`stellar_secret` on the `wallets` table is never returned to the client via direct query. The column is excluded from `SELECT *`. The only legitimate access path is the `reveal-wallet-secret` edge function, which:
1. Verifies the caller is authenticated
2. Verifies the wallet belongs to the caller's customer record
3. Logs the access (`console.log` — to be replaced with an audit table)
4. Returns the secret

### HTG-C compliance flags

HTG-C is issued with **Authorization Required** and **Revocable** flags on the Stellar asset. This means:
- Every trustline must be explicitly authorized by the issuer (`Operation.setTrustLineFlags({ authorized: true })`) before a wallet can receive HTG-C
- The issuer can clawback or freeze balances — required for regulatory compliance
- `ensureWalletReady()` automatically authorizes new trustlines using `STELLAR_HTGC_ISSUER_SECRET`

### KYB gating

`create-quote` enforces `kyb_status = 'APPROVED'` before creating any conversion order. KYB status is admin-controlled and protected by the `protect_customer_fields` trigger — a customer cannot self-approve.

### Transaction limits

Hard limits enforced in `_shared/tx-limits.ts` on every edge function that moves funds:
- Minimum: 1 USDC (dust rejection)
- Maximum: 1,000,000 USDC per single payment

### Quote expiry

Quotes expire after 15 minutes (`quote_expires_at`). There is no automated cron job to expire stale QUOTED orders — this is a known gap for production.

---

## 8. Signing architecture

### Current (testnet)

All Stellar signing uses secrets stored in Supabase edge function environment secrets:

| Secret | Used for |
|---|---|
| `STELLAR_DISTRIBUTOR_SECRET` | Signs all distributor → customer payments (leg 2 of swaps, USDC releases, payouts) |
| `STELLAR_HTGC_ISSUER_SECRET` | Signs HTG-C trustline authorization and mint/burn operations |

The distributor secret is accessed exclusively through `_shared/stellar-signer.ts`. No other file reads it.

Customer wallet secrets (`stellar_secret` column) are stored encrypted at rest in Postgres and read by service-role edge functions for leg 1 of swaps and customer-initiated payments.

### Planned (mainnet)

Replace `signWithDistributor()` in `_shared/stellar-signer.ts` with an HTTP call to a signing microservice:

```
AWS Lambda + CloudHSM  →  signing microservice
  Distributor key lives only in CloudHSM, never in plaintext env
  Optionally: MPC with user session share for customer wallet keys
```

The migration path is isolated to a single function body in `stellar-signer.ts`.

---

## 9. Error handling and observability

### Frontend

- Toast notifications via `sonner` (`toast.success`, `toast.error`) for all user-facing outcomes
- Edge function errors surface the `error` field from the response body
- Realtime subscription on order status uses 5s polling as a fallback

### Edge functions

- Stellar SDK errors are unwrapped: `error.response?.data` (Horizon error envelope) is stringified and returned/logged
- Auto-refund logic in `execute-swap`: if leg 2 fails, leg 1 is automatically refunded; both outcomes are logged and the `failure_reason` column is populated
- `console.error` / `console.log` — visible in Supabase edge function logs in the dashboard
- No external error tracking (Sentry, etc.) at current stage

### Supabase logs

- Edge function invocation logs: Supabase dashboard → Edge Functions → Logs
- DB slow query log: Supabase dashboard → Database → Query Performance

---

## 10. Deployment and environment

### Frontend

- Hosted on **Lovable** (lovable.app) — CI/CD from this GitHub repo
- Built with Vite + React + SWC (`@vitejs/plugin-react-swc`)
- Dev server: `bun run dev` (port 8080)

### Backend

- **Supabase project:** `nlbnmsiqfywskuxhqjon` (region: not confirmed; hosted by Supabase)
- Edge functions: deployed via Supabase CLI (`supabase functions deploy <name>`)
- Migrations: applied via Supabase CLI (`supabase db push`) or dashboard

### Testnet → Mainnet migration plan

The following changes are required to move from testnet to mainnet:

1. **Stellar network:** Change `Networks.TESTNET` → `Networks.PUBLIC` and `https://horizon-testnet.stellar.org` → `https://horizon.stellar.org` in all edge functions and `src/lib/balance.ts`. Remove Friendbot funding from `create-wallet`.

2. **USDC issuer:** Switch to Circle's mainnet USDC issuer (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`).

3. **Signing:** Replace `signWithDistributor()` with the AWS Lambda + CloudHSM microservice call.

4. **KMS for wallet secrets:** Replace plaintext `stellar_secret` storage with KMS-encrypted ciphertext.

5. **BRH rate feed:** The `fetch-brh-rate` scraper is already pointed at the live BRH site. Validate parsing on mainnet; consider a backup rate source.

6. **SPIH integration:** Implement real bank-feed matching webhook or polling to auto-transition orders from QUOTED to FUNDED.

7. **Remove dev tools:** `simulate-spih-payment` and Friendbot calls must be disabled or removed.

8. **HTG-C compliance:** Verify issuer account flags (Authorization Required, Revocable, Clawback Enabled) are set on the mainnet asset issuance.
