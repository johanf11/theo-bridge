## Goal

Give admins a single unified transactions stream covering every customer-impacting movement: on/off-ramp conversions, USDC payouts, and Blend sweeps (deposit/withdraw) — all tagged with the customer, filterable, searchable, and exportable.

## Source of truth

`ledger_transactions` already records every movement we care about, with `kind`, `order_id`, `stellar_tx_hash`, `description`, `created_at`. Each tx has `ledger_entries`, and each entry can carry a `customer_id`. Customer tagging is in place for the kinds that matter (`FX_CONVERSION`, `USDC_PAYOUT`, `SPIH_CASH_IN`, `HTGC_*`, `BLEND_*`, `PAYOUT_USDC`).

So this is a read/aggregation feature, not a new write path — no migrations needed.

## Deliverable

New admin page: **`/admin/transactions`** ("Activity" in the sidebar) with a single chronological table of every ledger transaction, customer-resolved, filterable, exportable.

### Columns

- Time (relative + tooltip absolute)
- Customer (company name, links to admin customer view if/when added — otherwise just text + email)
- Type (mapped from `kind` to plain-English labels — see mapping below)
- Direction (in / out / internal — derived from kind)
- Amount HTG
- Amount USDC
- Reference (order `reference_number` when `order_id` present)
- Stellar tx (truncated hash → Horizon link when present)
- Status (from related order if `order_id`, else "Posted")

### Kind → label mapping (customer-facing wording, per CLAUDE.md)

| kind | Label | Direction |
|---|---|---|
| SPIH_CASH_IN | HTG received | in |
| FX_CONVERSION | HTG → USDC conversion | internal |
| USDC_PAYOUT | USDC released to customer | out |
| PAYOUT_USDC | USDC payment sent | out |
| BLEND_DEPOSIT | Yield deposit | internal |
| BLEND_WITHDRAW | Yield withdraw | internal |
| HTGC_MINT / HTGC_BURN / DISTRIBUTOR_* | shown only when "Show treasury ops" toggle is on | internal |

### Filters

- Date range (presets: 24h, 7d, 30d, all)
- Customer (searchable select — loads from `customers` table)
- Type (multi-select of the labels above)
- Free-text search across reference number and stellar tx hash
- Toggle "Show treasury / internal ops" (off by default — hides HTGC_MINT, HTGC_BURN, DISTRIBUTOR_*)

### Actions

- **Export CSV** of the current filtered view (reuses the CSV pattern already in `AdminLedger.tsx`)
- Row click → expands inline to show the per-entry debit/credit breakdown (account code, currency, amount)

### Empty / loading / errors

- Skeleton rows while loading
- "No transactions match these filters" when filtered set is empty
- Toast on fetch error

## Implementation

### Files

- **new** `src/pages/AdminTransactions.tsx`
- **edit** `src/App.tsx` — add `<Route path="/admin/transactions" element={<ProtectedRoute adminOnly><AdminTransactions /></ProtectedRoute>} />`
- **edit** `src/components/theo/Layout.tsx` — add nav item under the admin block: `{ to: "/admin/transactions", label: "Activity", icon: Activity, keywords: ["transactions", "activity", "log", "history", "ledger"] }`

### Data fetching (client-side, admin RLS already allows it)

One query, joined client-side:

```ts
// 1) transactions
supabase
  .from("ledger_transactions")
  .select("id, kind, description, order_id, stellar_tx_hash, created_at")
  .order("created_at", { ascending: false })
  .limit(500);

// 2) entries for those tx ids (one batched IN query)
supabase
  .from("ledger_entries")
  .select("transaction_id, account_id, currency, debit, credit, customer_id")
  .in("transaction_id", txIds);

// 3) orders for the tx with order_id (for reference_number, status, htg/usdc amounts)
supabase
  .from("orders")
  .select("id, reference_number, htg_amount, usdc_amount, status, customer_id")
  .in("id", orderIds);

// 4) customers (resolved from entries.customer_id ∪ orders.customer_id)
supabase
  .from("customers")
  .select("id, company_name, email")
  .in("id", customerIds);
```

Derive per-row:
- `customer_id` = first non-null entries.customer_id, else order.customer_id
- HTG amount = sum of HTG debits (or credits — pick the side that represents customer-facing direction per kind)
- USDC amount = same for USDC

Pagination: load 500 most recent; "Load more" button fetches the next 500 by `created_at < lastSeen`.

### Styling

Follow `AdminLedger.tsx` and `AdminConversions.tsx` patterns: inline styles, `theo-*` tokens, white cards on `--theo-cream`, Lucide icons only, no emoji, no gradients.

### Not in scope

- No schema changes — `ledger_entries.customer_id` already exists and is populated by the edge functions we touched in prior turns.
- No new backfill — only renders what's already posted. If older blend/payout transactions lack `customer_id` on entries, they'll show as "—" in the Customer column; we can backfill separately if you want.
- Does not replace `/admin/ledger` (which is the accounting / trial-balance view). This new page is the **operational activity stream**.
