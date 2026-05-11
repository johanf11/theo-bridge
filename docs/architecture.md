# Theo Bridge — Architecture

> Current state: Stellar Testnet, pre-mainnet. First enterprise client: NABATCO.SA (Groupe Acra). SCF Build Award #44 application in progress, deadline June 14 2026.

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
- Compliance page — live reserve proof (treasury vs. circulation), issuer flags, Stellar Explorer links
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
  2. Submit → POST supabase/functions/execute-withdraw
     - Burns HTG-C (customer wallet → HTGC_ISSUER)
     - Records htgc_withdraw order (COMPLETED)
  3. Theo manually processes HTG bank transfer (operational step)
```

### 3d. Payout (send USDC)

```
/payout
  1. Enter recipient Stellar address, name, amount, memo
  2. Submit → POST supabase/functions/send-payment
     - Pre-flight: checks recipient USDC trustline
       - If recipient is a Theo wallet: auto-establishes trustline
       - If external: returns clear error
     - Submits Stellar payment from source wallet
     - Records payouts row
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
| `/orders/:id` | `OrderStatus` | Live order status, SPIH instructions, receipt |
| `/compliance` | `Compliance` | Reserve proof, issuer flags, Stellar explorer links |
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

### Shared edge function helpers (`supabase/functions/_shared/`)

| File | Purpose |
|---|---|
| `stellar-assets.ts` | Exports `HTGC_ISSUER` constant |
| `stellar-signer.ts` | `signWithSecret`, `signWithDistributor`, `distributorKeypair`, `distributorPublicKey` — the ONLY place that reads `STELLAR_DISTRIBUTOR_SECRET` |
| `tx-limits.ts` | `assertWithinLimits(amount)` — min 1 USDC, max 1,000,000 USDC |
| `ensure-wallet-ready.ts` | Idempotent: ensures USDC + HTG-C trustlines exist and are authorized on any Theo-managed wallet |

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
| `reference_number` | text UNIQUE | Format: `THEO-{TYPE}-{6CHARS}` e.g. `THEO-CNV-A3BF7Z` |
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
| `memo` | text | Stellar memo (max 28 chars) |
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
| `saved_recipients` | Saved Stellar addresses for payouts |
| `blend_positions` | Yield position tracking |
| `spih_imports` | SPIH reconciliation import audit |
| `job_queue` | Background job queue (types: `SPIH_RECONCILE \| USDC_RELEASE \| STELLAR_CONFIRM`) |

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
