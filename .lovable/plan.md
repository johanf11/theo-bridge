# Phase 2 — Complete the Shadow Ledger

Phase 1 wired the books for the happy-path conversion (`simulate-spih-payment` → `release-usdc`). Phase 2 closes every other path that moves value, backfills history, and turns the ledger from a passive shadow into an active gate that can block bad payouts.

## Goals

1. Every value movement in the system posts a balanced double-entry transaction — no silent on-chain moves.
2. Historical data is represented as opening-balance transactions so the trial balance reflects reality from day one.
3. `release-usdc` pre-flight reconciles book vs chain and **hard-blocks** payouts on drift > tolerance.
4. Per-customer USDC sub-ledgers replace the single `CUSTOMER_USDC_PAYABLE` pool, so we can answer "how much do we owe customer X?" from the ledger alone.
5. Admin Ledger page gains drill-down + CSV export; reconciliation card covers all chain-held accounts.

## Scope

### 1. Schema additions (migration `phase2_ledger_expansion`)

- New seed accounts:
  - `TREASURY_USDC` (ASSET / USDC) — for Blend treasury / sweeps
  - `BLEND_DEPOSITS_USDC` (ASSET / USDC) — Blend principal
  - `BLEND_YIELD_USDC` (REVENUE / USDC) — accrued interest
  - `HTGC_ISSUED` (LIABILITY / HTG) — outstanding HTG-C float
  - `FEE_REVENUE_HTG` (REVENUE / HTG) — for HTG-side fees if any
  - `OPENING_BALANCE_EQUITY` (EQUITY / both currencies)
- Per-customer USDC subaccounts: dynamic. Add `customer_id uuid null` to `ledger_accounts` + unique `(code)` still. Helper `getOrCreateCustomerUsdcAccount(customer_id)` in `_shared/ledger.ts` creates `CUSTOMER_USDC_<short_id>` on first use.
- Index `ledger_entries(account_id, currency)` for fast trial-balance.

### 2. Edge function wiring

Add `postLedger` calls (kind in parens) to:

| Function | Posting |
|---|---|
| `execute-swap` | `SWAP_HTG_USDC` or `SWAP_USDC_HTG` — multi-leg through `FX_CLEARING_*` |
| `execute-withdraw` | `WITHDRAW_USDC` — dr `CUSTOMER_USDC_<id>`, cr `DISTRIBUTOR_USDC` |
| `send-payment` | `PAYOUT_USDC` — dr `CUSTOMER_USDC_<id>`, cr `DISTRIBUTOR_USDC` |
| `htgc-issuance` | `HTGC_MINT` — dr `SPIH_BANK_HTG`, cr `HTGC_ISSUED` |
| `topup-distributor-usdc` | `DISTRIBUTOR_TOPUP` — dr `DISTRIBUTOR_USDC`, cr `TREASURY_USDC` |
| `topup-htgc` | `HTGC_MINT` (manual variant) |
| `admin-rectify-htgc` | `HTGC_RECTIFY` — adjustable entries with audit note |
| `admin-refund-distributor` | `DISTRIBUTOR_REFUND` — reverse `DISTRIBUTOR_USDC` |
| `blend-sweep` | `BLEND_DEPOSIT` — dr `BLEND_DEPOSITS_USDC`, cr `DISTRIBUTOR_USDC` |
| `blend-withdraw` | `BLEND_WITHDRAW` — reverse; accrued yield → `BLEND_YIELD_USDC` |
| `release-usdc` | Update to credit per-customer subaccount (replace `CUSTOMER_USDC_PAYABLE`) |

Wrap each posting in try/catch; **on posting failure after a successful chain tx**, write to a new `ledger_posting_failures` table with full payload so ops can replay — never silently swallow.

### 3. Historical backfill (`backfill-ledger` one-shot edge function, admin-only)

- Walk `orders` where `status = COMPLETED` → emit synthetic `SPIH_CASH_IN` + `FIAT_SETTLEMENT` + `USDC_PAYOUT` transactions dated `completed_at`.
- Walk `payouts` where `status = COMPLETED` → emit `PAYOUT_USDC`.
- Walk `blend_positions` → emit single `OPENING_BALANCE` transaction for current `deposited_usdc`.
- Any residual chain balance not explained → `OPENING_BALANCE_EQUITY` adjusting entry, flagged in a `backfill_report` table.
- Idempotent: keyed by `(source_table, source_id, kind)` via a new `ledger_transactions.source_key text unique` column.

### 4. Pre-flight reconciliation gate in `release-usdc`

Before broadcasting the Stellar tx:
1. Fetch book `DISTRIBUTOR_USDC` balance.
2. Fetch live Horizon balance.
3. If `|book − chain| > 0.01 USDC` → **reject** with HTTP 409 `LEDGER_DRIFT` and write to `ledger_posting_failures` for admin attention.
4. Same check for `SPIH_BANK_HTG` (book) vs latest `reserve_attestations.htg_balance` if attested within 24h — soft warn only.

Toggle via `LEDGER_GATE_ENABLED` env var so we can ship dark first.

### 5. Admin Ledger page upgrades

- **Reconciliation card**: rows for `DISTRIBUTOR_USDC`, `TREASURY_USDC`, `BLEND_DEPOSITS_USDC` (each with book / chain / delta / status).
- **Trial Balance card**: add per-customer expansion drawer.
- **Transactions card**: filter by `kind`, `order_id`, date range; CSV export button.
- **Posting Failures card**: new — lists `ledger_posting_failures`, with "Retry" action calling a `replay-ledger-posting` edge function.

### 6. Tests

Deno tests in `supabase/functions/_shared/ledger_test.ts`:
- Balanced posting succeeds.
- Unbalanced posting rejected by trigger.
- Currency mismatch rejected.
- `getOrCreateCustomerUsdcAccount` idempotent under concurrent calls.

## Out of scope (Phase 3)

- Customer-facing statement endpoint backed by ledger (today's PDF stays orders-based).
- Multi-currency conversion through a real FX desk (FX_CLEARING stays balanced internally).
- Audit-grade immutability (append-only enforcement, hash chaining).

## Rollout order

1. Migration + new seed accounts + per-customer helper.
2. Wire all 10 edge functions; deploy with `LEDGER_GATE_ENABLED=false`.
3. Run `backfill-ledger` in staging, verify trial balance = 0 per currency.
4. Run in prod, manually review `OPENING_BALANCE_EQUITY` adjustments.
5. Admin UI upgrades.
6. Flip `LEDGER_GATE_ENABLED=true` after one clean week.

## Verification checklist

- Trial Balance footer = `0.0000000` in both currencies after backfill.
- Every `payouts.completed_at` and `orders.completed_at` row has a matching `ledger_transactions.source_key`.
- A deliberate book/chain mismatch (drop a row from `ledger_entries` in staging) causes `release-usdc` to return 409.
- `ledger_posting_failures` is empty in steady state.
