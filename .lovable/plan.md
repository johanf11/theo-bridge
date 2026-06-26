## Goal
Allow Odoo-integrated vendor bill payments of any size (e.g. $100K, $1M, $2M+) through the `theo-api-*` endpoints. Validation becomes: positive amount + valid settlement + sufficient balance at pay time. Web Convert UI / `create-quote` remain unchanged.

## Changes

### 1. DB migration — relax `usdc_conversion_limits`
Drop the existing constraint (currently `>= 1000 AND <= 50000`) and re-add a min-only check:
```sql
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS usdc_conversion_limits;
ALTER TABLE public.orders ADD CONSTRAINT usdc_conversion_limits CHECK (
  order_kind <> 'usdc_conversion'
  OR usdc_amount IS NULL
  OR usdc_amount >= 1000
);
```
Keep `usdc_min` (`>= 0`) as-is. No other legacy cap constraints exist.

### 2. `supabase/functions/_shared/odoo-settlement.ts`
- Add `HTGC_CONVERSION_USDC_MIN = 1000` constant (single source of truth).
- Add `odooQuoteMaxUsd(): number | null` reading optional `ODOO_QUOTE_MAX_USD` env (unset = no cap).
- No `MAX` constant — document Odoo path is uncapped by default.

### 3. `supabase/functions/theo-api-quote/index.ts`
- Remove `const MAX_USDC = 100_000` and its upper-bound check.
- Validate only: `amount_usd` finite and `> 0`.
- For HTG-C sourced quotes: validate `totalDebitUsd >= HTGC_CONVERSION_USDC_MIN`.
- Apply optional `odooQuoteMaxUsd()` ceiling → 400 `amount_out_of_range` when set and exceeded.
- Wrap the orders insert: if PG error message includes `usdc_conversion_limits`, return 400 `{ code: "amount_out_of_range", error: "Amount outside allowed range — contact support (migration may not be applied)" }` instead of a 500.

### 4. `theo-api-convert`, `theo-api-pay`, `theo-api-pay-bank`
- No new upper cap. Keep current behavior (already only minimum / status checks).
- At pay time, when the distributor USDC balance check fails, surface it as **402** `{ code: "insufficient_balance", error: "..." }` (currently returns 502 `on_chain_failed` via a thrown `Distributor short on USDC` string). Pre-check distributor balance against `usdc_amount` before submitting and short-circuit with 402 + machine code so Odoo can display a clean message.
- Do NOT call `assertWithinLimits` in any Odoo-path function (avoids the shared `MAX_SINGLE_USDC = 1_000_000` web cap). Leave `tx-limits.ts` unchanged so web/admin paths keep their $1M ceiling.

### 5. Docs — `docs/theo-odoo-integration.md`
- Remove any "max 100,000" language.
- State: no fixed Odoo quote cap; bill amount is sourced from validated ERP vendor bills. Min = $1,000 USDC equivalent for HTG-C conversions.
- Document optional `ODOO_QUOTE_MAX_USD` env as an emergency ops throttle only.
- Note pay-time oversize failures return `402 insufficient_balance`, not a product cap.

### 6. Deploy + verify
- Apply migration to project `nlbnmsiqfywskuxhqjon`.
- Redeploy: `theo-api-quote`, `theo-api-convert`, `theo-api-pay`, `theo-api-pay-bank`.
- Run the three curl acceptance tests ($87.5K, $1M, $2M) — expect 200 with `quote_id`, and 402 `insufficient_balance` at pay time if distributor is underfunded.

## Out of scope
- `create-quote` / `Convert.tsx` web UI 50K/52K limits.
- `_shared/tx-limits.ts` `MAX_SINGLE_USDC` (still applies to web/admin pay paths).
- KYB / API key scopes.
- `daily-seed` demo amounts.
