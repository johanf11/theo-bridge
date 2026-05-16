# Phase 1 — Internal Double-Entry Shadow Ledger

Build a Modern-Treasury-style ledger inside Theo so every fiat ↔ crypto movement is recorded as paired debit + credit entries. Phase 1 covers the schema, the posting helper, hooks into the two functions that move money in the happy path (`simulate-spih-payment`, `release-usdc`), and an admin-only Ledger view. Other edge functions (`execute-swap`, `execute-withdraw`, `send-payment`, `htgc-issuance`, top-ups, blend, admin rectify/refund) and historical backfill are deferred to Phase 2.

## What you'll see when it's done

- A new admin page `/admin/ledger` showing:
  - **Trial Balance** — every ledger account with its debit total, credit total, and signed balance, grouped by account type. Sum of all balances = 0 (proof books are balanced).
  - **Transactions** — chronological list of ledger transactions, expandable to show the paired entries (account, debit, credit, currency).
  - **Reconciliation widget** — for the distributor and HTG-C issuer accounts, show *book balance* vs *live Horizon balance* side-by-side with a delta column.
- Every new order that goes through `simulate-spih-payment` → `release-usdc` writes 3 ledger transactions covering: SPIH cash-in, fiat settlement, and USDC payout (with the fee split going to a revenue account).
- A database constraint that makes it impossible to commit an unbalanced transaction (debits ≠ credits within a currency).

Existing data is **not** backfilled in Phase 1 — the ledger only reflects orders processed after this ships. Phase 2 will add an opening-balance backfill so the trial balance ties to Horizon end-to-end.

## Scope boundary

In Phase 1 the ledger is **observational only**. `release-usdc` will *post* entries, but it will not yet *block* on a reconciliation mismatch — that gate goes in Phase 2 once we've watched the ledger run clean for real orders and finished the backfill. This prevents the ledger from breaking production payouts on day one.

## Technical detail

### 1. Migration: `create_shadow_ledger`

Tables (all `numeric(20,7)` for amounts to match Stellar precision):

- **`ledger_accounts`**
  - `id uuid pk`
  - `code text unique not null` (e.g. `SPIH_BANK_HTG`, `CUSTOMER_HTG_PENDING`, `FX_CLEARING`, `DISTRIBUTOR_USDC`, `FEE_REVENUE_USDC`)
  - `name text not null`
  - `type` enum `account_type`: `ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE`
  - `currency text not null` (HTG or USDC)
  - `created_at`

- **`ledger_transactions`**
  - `id uuid pk`
  - `order_id uuid null` (no FK — keep ledger decoupled if orders ever archives)
  - `kind text not null` (e.g. `SPIH_CASH_IN`, `FIAT_SETTLEMENT`, `USDC_PAYOUT`, `HTGC_MINT`)
  - `description text`
  - `posted_by uuid null` (auth user id of admin who triggered it)
  - `created_at timestamptz default now()`

- **`ledger_entries`**
  - `id uuid pk`
  - `transaction_id uuid not null references ledger_transactions(id) on delete cascade`
  - `account_id uuid not null references ledger_accounts(id)`
  - `currency text not null`
  - `debit numeric(20,7) not null default 0`
  - `credit numeric(20,7) not null default 0`
  - check: exactly one of debit/credit > 0
  - check: entry.currency = account.currency (enforced via trigger since check can't reference another table)

**Balance enforcement.** A deferrable constraint trigger on `ledger_entries` runs at transaction commit and verifies, for every `transaction_id` touched, that `sum(debit) = sum(credit)` *per currency*. Raises `unbalanced ledger transaction` otherwise. Using a constraint trigger (not a CHECK constraint) because CHECK can't aggregate across rows.

**Indexes.** `ledger_entries(transaction_id)`, `ledger_entries(account_id, created_at)`, `ledger_transactions(order_id)`, `ledger_transactions(created_at desc)`.

**RLS.** Enable on all three tables. Policies: `service_role` full access; `authenticated` SELECT only when `has_role(auth.uid(), 'admin')`. No customer-facing access in Phase 1.

**Seed accounts** (inserted in the same migration):

| code | type | currency |
|---|---|---|
| `SPIH_BANK_HTG` | ASSET | HTG |
| `CUSTOMER_HTG_PENDING` | LIABILITY | HTG |
| `CUSTOMER_HTG_SETTLED` | LIABILITY | HTG |
| `FX_CLEARING_HTG` | EQUITY | HTG |
| `FX_CLEARING_USDC` | EQUITY | USDC |
| `DISTRIBUTOR_USDC` | ASSET | USDC |
| `CUSTOMER_USDC_PAYABLE` | LIABILITY | USDC |
| `FEE_REVENUE_USDC` | REVENUE | USDC |

Per-customer USDC subaccounts are deferred to Phase 2 to keep the seed list small.

### 2. Shared posting helper: `supabase/functions/_shared/ledger.ts`

```
postEntries(admin, {
  orderId,
  kind,
  description,
  postedBy,
  entries: [{ accountCode, debit?, credit?, currency }, ...]
})
```

- Resolves `accountCode` → `account_id` (cached per cold start).
- Inserts `ledger_transactions` then `ledger_entries` in one Postgres transaction via an RPC (`post_ledger_entries`) so the balance trigger fires atomically.
- The RPC is `security definer` and takes a JSON payload, so edge functions don't need raw SQL.

### 3. Wire into `simulate-spih-payment`

Right after flipping `QUOTED → FUNDED` (USDC conversion path), post:

- **kind: `SPIH_CASH_IN`** — `dr SPIH_BANK_HTG htg_amount`, `cr CUSTOMER_HTG_PENDING htg_amount`.

(HTG-C mint path posts a separate `HTGC_MINT` transaction: `dr SPIH_BANK_HTG`, `cr CUSTOMER_HTG_PENDING` — the on-chain mint itself is tracked in Phase 2 once we have an `HTGC_ISSUED` account.)

### 4. Wire into `release-usdc`

After the Stellar payment succeeds (before marking COMPLETED), post two transactions:

- **kind: `FIAT_SETTLEMENT`** — `dr CUSTOMER_HTG_PENDING htg_amount`, `cr CUSTOMER_HTG_SETTLED htg_amount`. Closes the customer's HTG liability and reflects that the fiat side is fully settled.
- **kind: `USDC_PAYOUT`** — multi-leg, all in USDC:
  - `dr CUSTOMER_HTG_SETTLED htg_amount` (HTG side) — paired against `cr FX_CLEARING_HTG htg_amount`
  - `dr FX_CLEARING_USDC usdc_gross`, `cr DISTRIBUTOR_USDC usdc_gross` (USDC leaves the hot wallet)
  - `dr CUSTOMER_USDC_PAYABLE usdc_net`, plus `dr CUSTOMER_USDC_PAYABLE fee_usdc` already covered by:
  - `cr CUSTOMER_USDC_PAYABLE usdc_gross` net of fees, `cr FEE_REVENUE_USDC fee_usdc`

  Concretely the USDC leg posts: `dr FX_CLEARING_USDC = gross`, `cr DISTRIBUTOR_USDC = gross`, `dr CUSTOMER_USDC_PAYABLE = net + fee = gross`, `cr CUSTOMER_USDC_PAYABLE = gross`, `cr FEE_REVENUE_USDC = fee`. The balance trigger validates per-currency: USDC debits = USDC credits = `gross`, HTG debits = HTG credits = `htg_amount`.

  (`FX_CLEARING_HTG` and `FX_CLEARING_USDC` are two halves of the conversion bridge — they net to zero across the system over time and let us audit FX P&L separately in Phase 2.)

If `fee_usdc` is null on legacy QUOTED orders (shouldn't happen post-migration), default to 0 and log a warning rather than crash.

### 5. Admin Ledger page: `/admin/ledger`

New file `src/pages/AdminLedger.tsx`. Three sections, vanilla shadcn Cards + Tables, brand tokens:

- **Trial Balance card** — query `ledger_entries` grouped by account, compute `sum(debit) - sum(credit)` signed by account type. Show two columns of accounts (HTG, USDC) and a footer row "Total: 0.0000000" highlighted gold when it ties.
- **Transactions card** — paginated list of `ledger_transactions` ordered `created_at desc`, click to expand a row showing the entries table. Filter by `kind` and by `order_id`.
- **Reconciliation card** — for `DISTRIBUTOR_USDC` and (Phase 2: HTG-C issued), fetch live Horizon balance via `fetchHorizonBalances(DISTRIBUTOR)` and show: Book balance, Chain balance, Delta. Color delta red if non-zero. Note in the card: *"Deltas are expected during Phase 1 because pre-existing orders are not yet backfilled."*

Add to admin nav in `src/components/theo/Layout.tsx`: `{ to: "/admin/ledger", label: "Ledger", icon: BookOpen, keywords: ["ledger","double entry","trial balance","reconciliation"] }` and a route in `src/App.tsx` guarded by `<ProtectedRoute adminOnly>`.

### 6. What is NOT in Phase 1

- No hooks in `execute-swap`, `execute-withdraw`, `send-payment`, `htgc-issuance`, `topup-distributor-usdc`, `topup-htgc`, `admin-rectify-htgc`, `admin-refund-distributor`, `blend-sweep`, `blend-withdraw`. Reconciliation deltas will be visible until Phase 2 wires these.
- No historical backfill. The Reconciliation card will note the expected mismatch.
- No pre-flight gate in `release-usdc` that blocks payouts on mismatch — added in Phase 2.
- No per-customer USDC subaccounts — single `CUSTOMER_USDC_PAYABLE` aggregate for now.
- No customer-facing ledger view.

### 7. Verification after deploy

1. Run a fresh QUOTED order through `simulate-spih-payment`.
2. Open `/admin/ledger` → Transactions card should show 3 new entries (`SPIH_CASH_IN`, `FIAT_SETTLEMENT`, `USDC_PAYOUT`) tied to that `order_id`.
3. Trial Balance footer must show `0.0000000` for both HTG and USDC columns.
4. `DISTRIBUTOR_USDC` book balance should have decreased by exactly `usdc_gross`; chain delta should equal the pre-existing untracked balance (this is the backfill gap, expected).