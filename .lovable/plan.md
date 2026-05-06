## Goal
Apply the new fee-tracking schema and redeploy `create-quote` so quotes persist fee breakdowns for revenue accrual.

## Steps

1. **Run migration** `20260506131324_add_fee_columns_to_orders.sql`
   - Adds nullable columns to `orders`: `fee_bps`, `theo_fee_bps`, `corridor_bps`, `fee_usdc(18,7)`, `theo_fee_usdc(18,7)`, `usdc_gross(18,7)`.
   - Idempotent (`IF NOT EXISTS`), no data backfill, no RLS changes.

2. **Redeploy edge function** `create-quote`
   - Latest code already in repo reads `fee_bps`/`corridor_bps` from the customer, computes `fee_usdc`/`theo_fee_usdc`/`usdc_gross`, persists them on the order, stores net `usdc_amount`, and returns the breakdown in the response.
   - No secrets needed (uses existing `SUPABASE_*` env).

3. **Smoke check** — fetch recent `create-quote` logs to confirm no boot errors after deploy.

## Not doing
- No frontend changes — receipt/UI updates are already in the repo (`src/lib/receipt.ts`, etc.).
- Not redeploying other functions.
- Not running the revenue-accrual SELECT (that's a manual analytics query for you to run when you want).
